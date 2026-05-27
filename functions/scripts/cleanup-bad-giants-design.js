#!/usr/bin/env node

/**
 * Delete the bad design tedzCLzxN9jfvYvWiUki (mis-tagged as New York Giants /
 * NFL when it should have been San Francisco Giants / MLB) and the three
 * products spawned from it. Idempotent.
 *
 * Usage (from functions/):
 *   node scripts/cleanup-bad-giants-design.js --dry-run
 *   node scripts/cleanup-bad-giants-design.js
 *
 * Set GCLOUD_PROJECT or run `firebase use rally-dash` first.
 */

"use strict";

const admin = require("firebase-admin");

const BAD_DESIGN_ID = "tedzCLzxN9jfvYvWiUki";
const BAD_PRODUCT_IDS = [
  "Ctcw75GX3dlwOeAHvLZ5",
  "XIZA8jU9Rqgfv1fca1A2",
  "ZLQh1Kj0msLM0pKExrM7",
];

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function deleteSubcollection(parentRef, name) {
  const snap = await parentRef.collection(name).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE WRITES"}`);
  console.log("");

  // Products first (they reference the design)
  for (const id of BAD_PRODUCT_IDS) {
    const ref = db.collection("rp_products").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`product ${id}: not found (skipping)`);
      continue;
    }
    const data = snap.data();
    console.log(
      `product ${id}: name="${data.name || data.title}", teamId=${data.teamId}, blankId=${data.blankId}`
    );
    if (dryRun) {
      console.log(`  → would delete rp_products/${id} (and any variants subcollection)`);
      continue;
    }
    // Delete variants subcollection first if present
    const variantsRemoved = await deleteSubcollection(ref, "variants");
    if (variantsRemoved > 0) {
      console.log(`  ✓ deleted ${variantsRemoved} variants`);
    }
    await ref.delete();
    console.log(`  ✓ deleted rp_products/${id}`);
  }

  console.log("");

  const designRef = db.collection("designs").doc(BAD_DESIGN_ID);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    console.log(`design ${BAD_DESIGN_ID}: not found (skipping)`);
  } else {
    const d = designSnap.data();
    console.log(
      `design ${BAD_DESIGN_ID}: name="${d.name}", teamId=${d.teamId}, league=${d.leagueCode}, importKey=${d.importKey}`
    );
    if (dryRun) {
      console.log(`  → would delete designs/${BAD_DESIGN_ID}`);
    } else {
      await designRef.delete();
      console.log(`  ✓ deleted designs/${BAD_DESIGN_ID}`);
    }
  }

  console.log("");
  console.log(dryRun ? "Dry-run done. Re-run without --dry-run to delete." : "Cleanup complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
