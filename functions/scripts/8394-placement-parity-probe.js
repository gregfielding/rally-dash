#!/usr/bin/env node
/**
 * Offline parity probe: run `render8394DesignOnGarmentSharp` for flat_back + model_back with warp OFF and ON.
 * Compare `[PLACEMENT8394_PARITY]` lines (set OFFICIAL_PLACEMENT_PARITY_LOG=1) or read composeTelemetry.placement8394LayoutDebug.
 *
 * Usage (from `functions/` with ADC or GOOGLE_APPLICATION_CREDENTIALS):
 *   OFFICIAL_PLACEMENT_PARITY_LOG=1 node scripts/8394-placement-parity-probe.js --productId=... --variantId=...
 *
 * `variantId` = Firestore doc id under `rp_products/{productId}/variants/{variantId}` (same as PDP variant).
 *
 * Regenerate storefront assets: use Dashboard **Generate** on the product, or call `generateProductFlatRenders`
 * after deploy; this script does **not** upload — it only prints parity JSON for the same compositor path.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const sharp = require("sharp");

const { resolveSavedBlankRenderProfile, findBlankVariantById } = require("../lib/resolveSavedBlankRenderProfile");
const { getPlacementRowForSide } = require("../lib/resolveProductRenderProfile");
const { resolveBackRenderTreatment, resolveBlendedPreviewBlend8394 } = require("../lib/artworkToneResolution");
const { getEffectiveColorFamilyForBlankPreview } = require("../lib/designPickForBlankPreview");
const { cropDesignToArtworkBounds } = require("../lib/compositor8394");
const { render8394DesignOnGarmentSharp, computeLayout8394 } = require("../lib/productFlatRenderMvp");

const ART_BASE = 0.5;

function buildLayoutPlacement(effPl, placementRow, tuning) {
  if (effPl && placementRow) {
    return {
      ...placementRow,
      defaultX: tuning.settings.placement.x,
      defaultY: tuning.settings.placement.y,
      defaultScale: tuning.settings.placement.scale,
      safeArea: effPl.safeArea,
      artboardBase:
        effPl.artboardBase != null && Number.isFinite(Number(effPl.artboardBase))
          ? Number(effPl.artboardBase)
          : placementRow.artboardBase != null && Number.isFinite(Number(placementRow.artboardBase))
            ? Number(placementRow.artboardBase)
            : ART_BASE,
    };
  }
  return placementRow;
}

function mergePlacementSource(parent, variantDoc) {
  if (!variantDoc || typeof variantDoc !== "object") return parent;
  return {
    ...parent,
    renderSetup: variantDoc.renderSetup || parent.renderSetup,
    placementOverrides: variantDoc.placementOverrides != null ? variantDoc.placementOverrides : parent.placementOverrides,
    renderOverrides: variantDoc.renderOverrides != null ? variantDoc.renderOverrides : parent.renderOverrides,
  };
}

function tryProjectIdFromServiceAccountJson() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p || typeof p !== "string") return null;
  try {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) return null;
    const j = JSON.parse(fs.readFileSync(abs, "utf8"));
    return j.project_id ? String(j.project_id) : null;
  } catch {
    return null;
  }
}

function resolveProjectIdForInit() {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    null;
  if (fromEnv) return fromEnv.trim();
  const fromJson = tryProjectIdFromServiceAccountJson();
  if (fromJson) return fromJson;
  try {
    const fp = path.join(__dirname, "..", "..", ".firebaserc");
    if (fs.existsSync(fp)) {
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (j.projects && j.projects.default) return String(j.projects.default);
    }
  } catch {
    /* ignore */
  }
  return null;
}

const _pid = resolveProjectIdForInit();
if (!admin.apps.length) {
  if (_pid) admin.initializeApp({ projectId: _pid });
  else admin.initializeApp();
}

const db = admin.firestore();

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function tuningWithWarpEnabled(base, enabled) {
  const w = base.settings.warp || {};
  return {
    ...base,
    settings: {
      ...base.settings,
      warp: { ...w, enabled: enabled === true },
    },
  };
}

function extractParity(composeTelemetry) {
  const d = composeTelemetry && composeTelemetry.placement8394LayoutDebug;
  if (!d) return null;
  return {
    renderTarget: d.renderTarget,
    warpEnabledEffective: d.warpEnabledEffective,
    artboardBaseUsed: d.artboardBaseUsed,
    centerPointPx: d.centerPointPx,
    preWarpSlotRectPx: d.preWarpSlotRectPx,
    postWarpBitmapDimensionsPx: d.postWarpBitmapDimensionsPx,
    finalCompositeTopLeftPx: d.finalCompositeTopLeftPx,
    deltaBlendedVsPreWarpSlotTopLeftPx: d.deltaBlendedVsPreWarpSlotTopLeftPx,
  };
}

async function runOneScenario({
  product,
  variantDoc,
  blank,
  variantRow,
  design,
  renderTarget,
  warpEnabled,
}) {
  const placementProduct = mergePlacementSource(product, variantDoc);
  const savedProfile = resolveSavedBlankRenderProfile({
    blank,
    blankVariantId: variantRow.variantId,
    design,
    product: placementProduct,
    renderTarget,
  });
  if (!savedProfile || !savedProfile.garmentImageUrl || !savedProfile.resolvedDesignUrl) {
    throw new Error(`resolveSavedBlankRenderProfile failed for ${renderTarget}`);
  }
  const side = renderTarget === "flat_front" || renderTarget === "model_front" ? "front" : "back";
  const pkResolved =
    (savedProfile.placement && savedProfile.placement.placementId && String(savedProfile.placement.placementId).trim()) ||
    (side === "front" ? "front_center" : "back_center");

  const placementRow = getPlacementRowForSide(blank, side, pkResolved);
  if (!placementRow) throw new Error(`No placement row for ${side} ${pkResolved}`);

  const blankGarmentFam = getEffectiveColorFamilyForBlankPreview(variantRow.colorFamily, variantRow.colorName);
  const resolvedToneRef = savedProfile.resolvedTone || "dark";
  const renderTreatment = resolveBackRenderTreatment(blankGarmentFam, resolvedToneRef);
  let blend = savedProfile.engineBlend;
  if (renderTreatment === "blended") {
    const adj = resolveBlendedPreviewBlend8394(blankGarmentFam, resolvedToneRef, blend);
    blend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
  }

  const tuning = tuningWithWarpEnabled(savedProfile.tuning, warpEnabled);
  const effPl = savedProfile.placement;

  const fetchFn = typeof fetch === "function" ? fetch.bind(global) : null;
  if (!fetchFn) throw new Error("global.fetch required");

  const blankResp = await fetchFn(savedProfile.garmentImageUrl);
  if (!blankResp.ok) throw new Error(`Garment HTTP ${blankResp.status}`);
  const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

  const designResp = await fetchFn(savedProfile.resolvedDesignUrl);
  if (!designResp.ok) throw new Error(`Design HTTP ${designResp.status}`);
  const designBuffer = Buffer.from(await designResp.arrayBuffer());

  const renderSelectionLog = [];
  const { composeTelemetry } = await render8394DesignOnGarmentSharp({
    sharp,
    blankBuffer,
    designBuffer,
    tuning,
    blend,
    placementRow,
    effPl,
    variant: variantRow,
    target: renderTarget,
    renderTreatment,
    renderSelectionLog,
    debugArtifacts: null,
  });

  const blankMeta = await sharp(blankBuffer).metadata();
  const designMeta = await sharp(designBuffer).metadata();
  const cropped = await cropDesignToArtworkBounds(designBuffer, sharp);

  const layoutPlacement = buildLayoutPlacement(effPl, placementRow, tuning);
  const layoutCheck = computeLayout8394(
    blankMeta.width,
    blankMeta.height,
    layoutPlacement,
    cropped.width,
    cropped.height
  );

  return {
    parity: extractParity(composeTelemetry),
    layoutCheckPreWarpTopLeft: { x: layoutCheck.left, y: layoutCheck.top },
    garmentPx: { w: blankMeta.width, h: blankMeta.height },
    designNaturalPx: { w: designMeta.width, h: designMeta.height },
    croppedDesignPx: { w: cropped.width, h: cropped.height },
  };
}

async function main() {
  process.env.OFFICIAL_PLACEMENT_PARITY_LOG = process.env.OFFICIAL_PLACEMENT_PARITY_LOG || "1";

  const args = parseArgs();
  const productId = args.productId;
  const variantId = args.variantId;
  if (!productId || !variantId) {
    console.error("Required: --productId=... --variantId=...");
    process.exit(1);
  }

  const productSnap = await db.collection("rp_products").doc(productId).get();
  if (!productSnap.exists) throw new Error("Product not found");
  const product = productSnap.data();

  const variantSnap = await db.collection("rp_products").doc(productId).collection("variants").doc(variantId).get();
  if (!variantSnap.exists) throw new Error("Variant not found");
  const variantDoc = variantSnap.data();

  const blankId = product.blankId;
  if (!blankId) throw new Error("Product missing blankId");
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new Error("Blank not found");
  const blank = blankSnap.data();

  const blankVariantId = variantDoc.blankVariantId || product.blankVariantId;
  if (!blankVariantId) throw new Error("Missing blankVariantId on variant/product");
  const variantRow = findBlankVariantById(blank, blankVariantId);
  if (!variantRow) throw new Error("Blank variant row not found");

  const designId =
    (variantDoc.designId && String(variantDoc.designId).trim()) ||
    (product.designId && String(product.designId).trim()) ||
    null;
  if (!designId) throw new Error("No designId on product/variant");
  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) throw new Error("Design not found");
  const design = designSnap.data();

  const targets = ["flat_back", "model_back"];
  const warps = [false, true];
  const report = { productId, variantId, scenarios: [] };

  for (const renderTarget of targets) {
    for (const warpEnabled of warps) {
      const row = await runOneScenario({
        product,
        variantDoc,
        blank,
        variantRow,
        design,
        renderTarget,
        warpEnabled,
      });
      report.scenarios.push({
        renderTarget,
        warpEnabled,
        ...row,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));

  const flatOff = report.scenarios.find((s) => s.renderTarget === "flat_back" && s.warpEnabled === false);
  const flatOn = report.scenarios.find((s) => s.renderTarget === "flat_back" && s.warpEnabled === true);
  const modelOff = report.scenarios.find((s) => s.renderTarget === "model_back" && s.warpEnabled === false);
  const modelOn = report.scenarios.find((s) => s.renderTarget === "model_back" && s.warpEnabled === true);

  function deltaWarp(off, on) {
    if (!off?.parity?.finalCompositeTopLeftPx || !on?.parity?.finalCompositeTopLeftPx) return null;
    const a = off.parity.finalCompositeTopLeftPx.blended;
    const b = on.parity.finalCompositeTopLeftPx.blended;
    return { x: b.x - a.x, y: b.y - a.y };
  }

  function deltaLayoutVsOfficial(off) {
    if (!off?.parity?.finalCompositeTopLeftPx || !off.layoutCheckPreWarpTopLeft) return null;
    const a = off.parity.finalCompositeTopLeftPx.blended;
    const b = off.layoutCheckPreWarpTopLeft;
    return { x: a.x - b.x, y: a.y - b.y };
  }

  console.log("\n--- SUMMARY (for A / B / C) ---\n");
  console.log(
    JSON.stringify(
      {
        A_warpOff_placementMathVsComposite: {
          flat_back_deltaOfficialBlendedVsComputeLayout8394: deltaLayoutVsOfficial(flatOff),
          model_back_deltaOfficialBlendedVsComputeLayout8394: deltaLayoutVsOfficial(modelOff),
        },
        B_warpOnVsWarpOff_blendedTopLeftDelta: {
          flat_back: deltaWarp(flatOff, flatOn),
          model_back: deltaWarp(modelOff, modelOn),
        },
        C_interpretation: {
          if_A_xy_near_zero:
            "Placement math matches composite when warp off (any residual is mask/treatment/crop).",
          if_A_nonzero_but_B_matches_flat:
            "Investigate mask/8394 treatment; warp not the cause for flat.",
          if_B_nonzero:
            "Warp changes composite TL — expect CSS vs Sharp warp to differ when warp on.",
        },
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
