#!/usr/bin/env node

/**
 * Seed `rp_scene_templates/body_model` — fixed-angle body + mask + flat_clean.back (panties / 8394).
 *
 * Set `backgroundAssetUrl` (body), `maskAssetUrl` (garment region, same frame as body), optional shadows/lighting.
 * Or use env: BODY_MODEL_BASE_IMAGE_URL, BODY_MODEL_MASK_URL, BODY_MODEL_SHADOW_URL, BODY_MODEL_LIGHTING_URL.
 *
 * Usage (from functions/):
 *   node scripts/seed-body-model-scene-template.js
 */

const admin = require("firebase-admin");

const DOC_ID = "body_model";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const ref = db.collection("rp_scene_templates").doc(DOC_ID);
  const payload = {
    name: "Body model (back)",
    sceneKey: DOC_ID,
    sceneType: "body_model",
    status: "active",
    templateMode: "deterministic",
    templateVersion: 1,
    description:
      "Deterministic worn look: body base + mask + variant flat_clean.back. No face; fixed camera. Panties / back-print catalog.",
    blankCategoriesAllowed: ["panties"],
    supportsFront: false,
    supportsBack: true,
    supportsPerColor: true,
    defaultGenerationScope: "manual_only",
    defaultGalleryRole: "pdp_alt",
    sceneOutputGalleryRole: "alt_scene_primary",
    gallerySort: 38,
    autoApproveDefault: false,
    garmentPlacement: { x: 0.5, y: 0.48, scale: 0.42 },
    renderDefaults: {
      outputWidth: 1200,
      outputHeight: 1600,
      imageFormat: "png",
    },
    backgroundAssetUrl: null,
    maskAssetUrl: null,
    shadowAssetUrl: null,
    lightingAssetUrl: null,
    preferredSourceKinds: ["commerce_back_clean"],
    usageTags: ["pdp", "panties", "worn", "deterministic"],
    notes:
      "Requires art: body PNG + mask aligned to same dimensions. Source: flat_clean.back only. Set autoApproveDefault true after QC.",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-body-model-scene-template",
  };

  const existing = await ref.get();
  if (!existing.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = "seed-body-model-scene-template";
  }

  await ref.set(payload, { merge: true });
  console.log("Wrote rp_scene_templates/" + DOC_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
