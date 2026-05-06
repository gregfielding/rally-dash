#!/usr/bin/env node
/**
 * Real product/color proof: fetch blank + design from Firestore (same path as
 * scripts/8394-placement-parity-probe.js), run compositor with **warp enabled** (mask/settings
 * from saved profile), print visible-center matrix for flat_back + model_back.
 *
 * Usage (from `functions/` with ADC or GOOGLE_APPLICATION_CREDENTIALS, network for image URLs):
 *   node scripts/8394-visible-center-matrix-real-proof.js --productId=... --variantId=...
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

const ALPHA_TH = 5;
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

async function getArtworkAlphaBoundsDetailFromBuffer(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const stride = w * 4;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const a = data[row + x * 4 + 3];
      if (a > ALPHA_TH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, w, h };
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function previewVisibleCenterY(blankW, blankH, layoutPlacement, detail) {
  const cropH = detail.h;
  const cropW = detail.w;
  const minYLocal = 0;
  const maxYLocal = detail.maxY - detail.minY;
  const { top: placedTop, resizedWidth: fw, resizedHeight: fh } = computeLayout8394(
    blankW,
    blankH,
    layoutPlacement,
    cropW,
    cropH
  );
  const visibleBottomExclusive = placedTop + ((maxYLocal + 1) / cropH) * fh;
  const visibleHeightPx = ((maxYLocal - minYLocal + 1) / cropH) * fh;
  const visibleCenterY = visibleBottomExclusive - visibleHeightPx / 2;
  void fw;
  return visibleCenterY;
}

function matrixRow(previewY, v) {
  const finalY = v.final && v.final.visibleCenterY != null ? v.final.visibleCenterY : v.visibleCenterY;
  const delta =
    previewY != null && finalY != null && Number.isFinite(previewY) && Number.isFinite(finalY)
      ? finalY - previewY
      : null;
  return {
    "preview.visibleCenterY": previewY,
    "official.preWarp.visibleCenterY": v.preWarp ? v.preWarp.visibleCenterY : null,
    "official.postWarp.visibleCenterY": v.postWarp ? v.postWarp.visibleCenterY : null,
    "official.postTreatment.visibleCenterY": v.postTreatment != null ? v.postTreatment.visibleCenterY : null,
    "official.final.visibleCenterY": finalY,
    "official.visibleCenterY - preview.visibleCenterY": delta,
    driftSourceVsPreWarp: v.driftSourceVsPreWarp != null ? v.driftSourceVsPreWarp : null,
  };
}

/** First of {postWarp, postTreatment, final} (pipeline order) where visibleCenterY > preview (downward). */
function firstPositiveDownwardAmongPostWarpPostTreatmentFinal(previewY, v) {
  const eps = 1e-6;
  const stages = [
    ["postWarp", v.postWarp && v.postWarp.visibleCenterY],
    ["postTreatment", v.postTreatment != null ? v.postTreatment.visibleCenterY : null],
    ["final", v.final && v.final.visibleCenterY != null ? v.final.visibleCenterY : v.visibleCenterY],
  ];
  for (const [name, y] of stages) {
    if (y == null || !Number.isFinite(y) || !Number.isFinite(previewY)) continue;
    if (y - previewY > eps) return name;
  }
  return null;
}

async function runOneTarget({
  product,
  variantDoc,
  blank,
  variantRow,
  design,
  renderTarget,
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

  const tuning = tuningWithWarpEnabled(savedProfile.tuning, true);
  const effPl = savedProfile.placement;

  const fetchFn = typeof fetch === "function" ? fetch.bind(global) : null;
  if (!fetchFn) throw new Error("global.fetch required (Node 18+)");

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

  const v = composeTelemetry.artwork8394VisibleVerticalMetrics;
  if (!v) throw new Error("composeTelemetry.artwork8394VisibleVerticalMetrics missing");

  const blankMeta = await sharp(blankBuffer).metadata();
  const layoutPlacement = buildLayoutPlacement(effPl, placementRow, tuning);
  const detail = await getArtworkAlphaBoundsDetailFromBuffer(designBuffer);
  const previewY = previewVisibleCenterY(blankMeta.width, blankMeta.height, layoutPlacement, detail);

  const cropped = await cropDesignToArtworkBounds(designBuffer, sharp);
  const cropMismatch = cropped.width !== detail.w || cropped.height !== detail.h;

  return {
    row: matrixRow(previewY, v),
    firstDownward_postWarp_postTreatment_final: firstPositiveDownwardAmongPostWarpPostTreatmentFinal(previewY, v),
    meta: {
      garmentUrl: savedProfile.garmentImageUrl,
      renderTreatment,
      warpEnabled: true,
      cropWxH_vs_alphaDetailWxH: cropMismatch
        ? { crop: { w: cropped.width, h: cropped.height }, alphaDetail: { w: detail.w, h: detail.h } }
        : null,
    },
  };
}

async function main() {
  const args = parseArgs();
  const productId = args.productId;
  const variantId = args.variantId;
  if (!productId || !variantId) {
    console.error("Required: --productId=... --variantId=... (Firestore variant under rp_products/{id}/variants/)");
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

  const flat = await runOneTarget({
    product,
    variantDoc,
    blank,
    variantRow,
    design,
    renderTarget: "flat_back",
  });
  const model = await runOneTarget({
    product,
    variantDoc,
    blank,
    variantRow,
    design,
    renderTarget: "model_back",
  });

  const out = {
    productId,
    variantId,
    warpEnabled: true,
    note: "blend/placement from saved profile; warp forced on; mask/settings from saved tuning",
    flat_back: flat.row,
    model_back: model.row,
    firstPositiveDownwardVsPreview_among_postWarp_postTreatment_final: {
      flat_back: flat.firstDownward_postWarp_postTreatment_final,
      model_back: model.firstDownward_postWarp_postTreatment_final,
    },
    meta: { flat_back: flat.meta, model_back: model.meta },
  };

  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
