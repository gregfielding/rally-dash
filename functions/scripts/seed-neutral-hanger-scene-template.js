#!/usr/bin/env node

/**
 * Seed `rp_scene_templates/neutral_hanger` for Phase 2 deterministic hanger scene.
 * Background URL may be omitted here if you use SCENE_HANGER_CREWNECK_BACKGROUND_URL on functions.
 *
 * Usage (from functions/):
 *   node scripts/seed-neutral-hanger-scene-template.js
 */

const admin = require("firebase-admin");

const DOC_ID = "neutral_hanger";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const ref = db.collection("rp_scene_templates").doc(DOC_ID);
  const payload = {
    name: "Neutral Hanger",
    sceneKey: DOC_ID,
    sceneType: "hanger",
    status: "active",
    templateMode: "deterministic",
    templateVersion: 1,
    description: "Garment on neutral studio / wall hanger; best for tees, tanks, crewnecks.",
    productTypesAllowed: ["tshirt", "tank", "crewneck", "bikini_panty"],
    blankCategoriesAllowed: ["panties", "tees", "tanks", "crewnecks"],
    supportsFront: true,
    supportsBack: false,
    supportsPerColor: true,
    defaultGenerationScope: "manual_only",
    defaultGalleryRole: "pdp_alt",
    autoApproveDefault: true,
    garmentPlacement: { x: 0.5, y: 0.46, scale: 0.52 },
    renderDefaults: {
      outputWidth: 1200,
      outputHeight: 1600,
      imageFormat: "png",
    },
    backgroundAssetUrl: null,
    shadowAssetUrl: null,
    maskAssetUrl: null,
    preferredSourceKinds: [
      "commerce_front_blended",
      "commerce_front_hero",
      "commerce_back_blended",
      "commerce_back_hero",
    ],
    usageTags: ["pdp", "apparel", "tops"],
    notes: "Set backgroundAssetUrl to HTTPS image or rely on SCENE_HANGER_CREWNECK_BACKGROUND_URL on Cloud Functions.",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-neutral-hanger-scene-template",
  };

  const existing = await ref.get();
  if (!existing.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = "seed-neutral-hanger-scene-template";
  }

  await ref.set(payload, { merge: true });
  console.log("Wrote rp_scene_templates/" + DOC_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
