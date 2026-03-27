#!/usr/bin/env node

/**
 * Seed `rp_scene_templates/flatlay_wood` — lifestyle wood-surface flat lay.
 *
 * Usage (from functions/):
 *   node scripts/seed-flatlay-wood-scene-template.js
 */

const admin = require("firebase-admin");

const DOC_ID = "flatlay_wood";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const ref = db.collection("rp_scene_templates").doc(DOC_ID);
  const payload = {
    name: "Flatlay Wood",
    sceneKey: DOC_ID,
    sceneType: "flatlay_floor",
    status: "active",
    templateMode: "deterministic",
    templateVersion: 1,
    description: "Garment on a minimal wood-surface flat lay; good for panties, tees, tanks, crewnecks.",
    blankCategoriesAllowed: ["panties", "tees", "tanks", "crewnecks", "bralettes"],
    supportsFront: true,
    supportsBack: true,
    supportsPerColor: true,
    defaultGenerationScope: "manual_only",
    defaultGalleryRole: "pdp_alt",
    /** Parity with functions/lib/sceneRenderFlatlayJobs.js (optional override) */
    gallerySort: 52,
    autoApproveDefault: true,
    garmentPlacement: { x: 0.5, y: 0.56, scale: 0.46 },
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
    usageTags: ["pdp", "flatlay", "lifestyle"],
    notes:
      "Set backgroundAssetUrl or SCENE_FLATLAY_WOOD_BACKGROUND_URL on Cloud Functions. Gallery order 52 (after backdrop 50).",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-flatlay-wood-scene-template",
  };

  const existing = await ref.get();
  if (!existing.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = "seed-flatlay-wood-scene-template";
  }

  await ref.set(payload, { merge: true });
  console.log("Wrote rp_scene_templates/" + DOC_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
