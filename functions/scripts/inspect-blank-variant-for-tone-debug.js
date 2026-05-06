#!/usr/bin/env node
/**
 * Read-only diagnostic: dump the resolution that the 8394 engine would produce for one
 * (blank, color, design) combination so we can see whether the washed-out render is
 * caused by data (preferredArtworkTone, missing whitePng), routing (blended vs clean),
 * or compositor numbers.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=rally-dash node scripts/inspect-blank-variant-for-tone-debug.js \
 *     --blank-id=fAHbUEeLBWiou0qS9RAW --color-name=Black --product-slug=los-angeles-dodgers-69-panty
 */

"use strict";

const admin = require("firebase-admin");
const path = require("path");

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const firebasercPath = path.resolve(__dirname, "../../.firebaserc");
    const firebaserc = JSON.parse(require("fs").readFileSync(firebasercPath, "utf8"));
    if (firebaserc?.projects?.default) return firebaserc.projects.default;
  } catch (_) {}
  return undefined;
}

if (!admin.apps.length) {
  const projectId = getProjectId();
  admin.initializeApp(projectId ? { projectId } : {});
}

const db = admin.firestore();

const {
  resolveBackRenderTreatment,
  resolveBlendedPreviewBlend8394,
  pickRasterUrlForVariant,
} = require("../lib/artworkToneResolution");

function parseFlag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const blankId = parseFlag("blank-id", "fAHbUEeLBWiou0qS9RAW");
const targetColor = parseFlag("color-name", "Black");
const productSlug = parseFlag("product-slug", null);
const productId = parseFlag("product-id", null);
const designIdArg = parseFlag("design-id", null);

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function mapRealismToBlendPreview(realism) {
  const r = Math.max(0, Math.min(100, realism));
  let mode;
  if (r < 22) mode = "normal";
  else if (r < 46) mode = "soft-light";
  else if (r < 70) mode = "overlay";
  else mode = "multiply";
  const t = r / 100;
  const op = Math.max(0.4, Math.min(0.97, 0.44 + (1 - t) * 0.52));
  return { blendMode: mode, blendOpacity: op };
}

function getEffectiveColorFamily(variant) {
  if (variant?.colorFamily === "light" || variant?.colorFamily === "dark") return variant.colorFamily;
  const n = norm(variant?.colorName);
  if (!n) return "light";
  if (
    n.includes("black") ||
    n.includes("navy") ||
    n.includes("charcoal") ||
    n.includes("dark") ||
    n.includes("midnight")
  ) {
    return "dark";
  }
  return "light";
}

async function resolveDesignDocFromProduct() {
  if (designIdArg) {
    const snap = await db.collection("designs").doc(designIdArg).get();
    if (snap.exists) return { designId: designIdArg, design: snap.data() };
    return null;
  }
  let productSnap = null;
  if (productId) {
    productSnap = await db.collection("rp_products").doc(productId).get();
  } else if (productSlug) {
    const q = await db.collection("rp_products").where("slug", "==", productSlug).limit(1).get();
    if (!q.empty) productSnap = q.docs[0];
  }
  if (!productSnap?.exists) return null;
  const product = productSnap.data();
  const designId =
    product.designIdBack ?? product.designId ?? product.designIdFront ?? null;
  if (!designId) return { product };
  const snap = await db.collection("designs").doc(designId).get();
  return { product, designId, design: snap.exists ? snap.data() : null };
}

async function main() {
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) {
    console.error(`rp_blanks/${blankId} does not exist`);
    process.exit(1);
  }
  const blank = blankSnap.data() || {};
  const variants = Array.isArray(blank.variants) ? blank.variants : [];
  const variant = variants.find((v) => norm(v?.colorName) === norm(targetColor));
  if (!variant) {
    console.error(
      `no variant ${targetColor} on rp_blanks/${blankId}.\n` +
        `available: ${variants.map((v) => v?.colorName).join(", ")}`
    );
    process.exit(1);
  }

  const colorFamily = getEffectiveColorFamily(variant);

  console.log("=== BLANK VARIANT ===");
  console.log({
    blankDocPath: `rp_blanks/${blankId}`,
    variantId: variant.variantId,
    colorName: variant.colorName,
    colorFamilyEffective: colorFamily,
    colorFamilyStored: variant.colorFamily ?? null,
    preferredArtworkTone: variant.preferredArtworkTone ?? null,
  });

  const realism = variant?.simpleRenderControls8394?.realism ??
    blank?.simpleRenderControls8394?.realism ?? 52;
  const inkStrength = variant?.simpleRenderControls8394?.inkStrength ??
    blank?.simpleRenderControls8394?.inkStrength ?? 95;

  const designResolve = await resolveDesignDocFromProduct();
  if (!designResolve?.design) {
    console.log("\n(no design doc resolved — pass --design-id, --product-slug, or --product-id)");
    return;
  }
  const { design, designId } = designResolve;
  const a = design.assets ?? {};
  const triple = {
    lightPng: typeof a.lightPng === "string" ? a.lightPng : null,
    darkPng: typeof a.darkPng === "string" ? a.darkPng : null,
    whitePng: typeof a.whitePng === "string" ? a.whitePng : null,
  };

  console.log("\n=== DESIGN BACK ASSETS (presence) ===");
  console.log({
    designId,
    designName: design.name ?? design.code ?? null,
    hasLightPng: !!triple.lightPng,
    hasDarkPng: !!triple.darkPng,
    hasWhitePng: !!triple.whitePng,
  });

  const picked = pickRasterUrlForVariant(triple, colorFamily, variant.preferredArtworkTone);
  console.log("\n=== TONE RESOLUTION (engine) ===");
  console.log({
    resolvedTone: picked.ref,
    resolvedUrl: picked.url ? "<has url>" : null,
  });

  const treatment = resolveBackRenderTreatment(colorFamily, picked.ref);
  console.log("\n=== RENDER TREATMENT ===");
  console.log({
    renderTreatment: treatment,
    meaning:
      treatment === "clean"
        ? "Sharp uses blend: 'over' (full alpha) — should be crisp."
        : "Sharp applies fabric blend (multiply/overlay) — design integrates into garment.",
  });

  const baseBlend = mapRealismToBlendPreview(realism);
  const adjusted = resolveBlendedPreviewBlend8394(colorFamily, picked.ref, baseBlend);

  console.log("\n=== BLEND NUMBERS (preview side) ===");
  console.log({
    realismSlider: realism,
    inkStrengthSlider: inkStrength,
    baseBlendFromRealism: baseBlend,
    adjustedForGarmentXTone: adjusted,
  });

  console.log("\n=== ENGINE BEHAVIOR (Sharp output) ===");
  if (treatment === "clean") {
    console.log({
      engineBlendMode: "over",
      engineBlendOpacity: 1.0,
      note: "Engine ignores the realism opacity for clean treatment — design is composited at 100% alpha.",
    });
  } else {
    console.log({
      engineBlendMode: adjusted.blendMode,
      engineBlendOpacity: adjusted.blendOpacity,
      note: "Engine uses the adjusted blend for blended treatment (mix of mode + opacity below 1).",
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
