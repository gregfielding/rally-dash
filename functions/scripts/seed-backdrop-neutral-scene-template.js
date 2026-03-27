#!/usr/bin/env node

/**
 * Seed `rp_scene_templates/backdrop_neutral` — plain studio backdrop for most garment categories.
 *
 * Usage (from functions/):
 *   node scripts/seed-backdrop-neutral-scene-template.js
 */

const admin = require("firebase-admin");

const DOC_ID = "backdrop_neutral";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const ref = db.collection("rp_scene_templates").doc(DOC_ID);
  const payload = {
    name: "Backdrop Neutral",
    sceneKey: DOC_ID,
    sceneType: "backdrop",
    status: "active",
    templateMode: "deterministic",
    templateVersion: 1,
    description: "Front/back commerce cutout on a neutral studio backdrop; works across tops and intimates.",
    blankCategoriesAllowed: ["panties", "tees", "tanks", "crewnecks", "bralettes"],
    supportsFront: true,
    supportsBack: true,
    supportsPerColor: true,
    defaultGenerationScope: "manual_only",
    defaultGalleryRole: "pdp_alt",
    autoApproveDefault: true,
    garmentPlacement: { x: 0.5, y: 0.52, scale: 0.58 },
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
    usageTags: ["pdp", "universal", "studio"],
    notes:
      "Set backgroundAssetUrl to HTTPS image or SCENE_BACKDROP_NEUTRAL_BACKGROUND_URL on Cloud Functions. Secondary alt scene vs hanger (gallerySort 50).",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-backdrop-neutral-scene-template",
  };

  const existing = await ref.get();
  if (!existing.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = "seed-backdrop-neutral-scene-template";
  }

  await ref.set(payload, { merge: true });
  console.log("Wrote rp_scene_templates/" + DOC_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
