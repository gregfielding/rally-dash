#!/usr/bin/env node

/**
 * Seed `rp_scene_templates/flatlay_boutique` — soft boutique / feminine flat lay.
 *
 * Usage (from functions/):
 *   node scripts/seed-flatlay-boutique-scene-template.js
 */

const admin = require("firebase-admin");

const DOC_ID = "flatlay_boutique";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const ref = db.collection("rp_scene_templates").doc(DOC_ID);
  const payload = {
    name: "Flatlay Boutique",
    sceneKey: DOC_ID,
    sceneType: "flatlay_boutique",
    status: "active",
    templateMode: "deterministic",
    templateVersion: 1,
    description: "Decorative boutique-style flat lay; strongest for panties, bralettes, and women’s tops.",
    blankCategoriesAllowed: ["panties", "bralettes", "tees"],
    supportsFront: true,
    supportsBack: true,
    supportsPerColor: true,
    defaultGenerationScope: "manual_only",
    defaultGalleryRole: "pdp_alt",
    gallerySort: 54,
    autoApproveDefault: true,
    garmentPlacement: { x: 0.5, y: 0.55, scale: 0.44 },
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
    usageTags: ["pdp", "flatlay", "boutique"],
    notes:
      "Set backgroundAssetUrl or SCENE_FLATLAY_BOUTIQUE_BACKGROUND_URL. Gallery order 54 (after wood 52).",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-flatlay-boutique-scene-template",
  };

  const existing = await ref.get();
  if (!existing.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = "seed-flatlay-boutique-scene-template";
  }

  await ref.set(payload, { merge: true });
  console.log("Wrote rp_scene_templates/" + DOC_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
