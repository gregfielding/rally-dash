#!/usr/bin/env node

/**
 * Clean up the 4 SF Giants products that were spawned by the over-eager Phase 2
 * auto-launch (before we restricted it to 8394 only):
 *   - tank      Ch9CxTZdZgouzSOYRekr  (TR3008 — no pipeline yet)
 *   - thong     S2JBJOD71egMEDVP35aj  (8390  — no pipeline yet)
 *   - thong     jD3ATvD9PumfkA31epX7  (8390, materializing duplicate)
 *   - crewneck  mIrikKfLsu6QR1h7Ja0A  (HF07  — no pipeline yet)
 *
 * Then clear the autoLaunchProductsAt marker on design 0PrHjyUSVE7a390HDb4U so
 * the (now 8394-only) onDesignCreated trigger can re-fire and spawn the panty.
 *
 * Usage (from functions/):
 *   GCLOUD_PROJECT=rally-dash node scripts/cleanup-sf-giants-dead-stubs.js --dry-run
 *   GCLOUD_PROJECT=rally-dash node scripts/cleanup-sf-giants-dead-stubs.js
 */

"use strict";

const admin = require("firebase-admin");

const DESIGN_ID = "0PrHjyUSVE7a390HDb4U";
const PRODUCT_IDS = [
  "Ch9CxTZdZgouzSOYRekr",
  "S2JBJOD71egMEDVP35aj",
  "jD3ATvD9PumfkA31epX7",
  "mIrikKfLsu6QR1h7Ja0A",
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
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE WRITES"}\n`);

  for (const id of PRODUCT_IDS) {
    const ref = db.collection("rp_products").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`product ${id}: not found (skipping)`);
      continue;
    }
    const data = snap.data();
    console.log(
      `product ${id}: name="${data.name || data.title}", blankId=${data.blankId}, launchStatus=${data.launchStatus}`
    );
    if (dryRun) {
      console.log(`  → would delete rp_products/${id} + variants subcollection`);
      continue;
    }
    const v = await deleteSubcollection(ref, "variants");
    if (v > 0) console.log(`  ✓ deleted ${v} variants`);
    await ref.delete();
    console.log(`  ✓ deleted rp_products/${id}`);
  }

  console.log("");

  const designRef = db.collection("designs").doc(DESIGN_ID);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    console.log(`design ${DESIGN_ID}: not found`);
    return;
  }
  const d = designSnap.data();
  console.log(
    `design ${DESIGN_ID}: name="${d.name}", autoLaunchProductsAt=${
      d.autoLaunchProductsAt && d.autoLaunchProductsAt.toDate
        ? d.autoLaunchProductsAt.toDate().toISOString()
        : d.autoLaunchProductsAt
    }`
  );

  if (dryRun) {
    console.log(
      `  → would clear autoLaunchProductsAt/Status/Results so onDesignCreated re-fires (8394-only now)`
    );
    return;
  }

  await designRef.update({
    autoLaunchProductsAt: admin.firestore.FieldValue.delete(),
    autoLaunchProductsStatus: admin.firestore.FieldValue.delete(),
    autoLaunchProductsResults: admin.firestore.FieldValue.delete(),
  });
  console.log(`  ✓ cleared autoLaunch markers — trigger will re-fire on next write`);

  // The above update IS itself a write to the doc, so onWrite will fire automatically.
  // But to be safe, also bump updatedAt to guarantee a re-fire.
  await designRef.update({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ bumped updatedAt to trigger onDesignCreated`);

  console.log("\nCleanup complete. Watch functions logs — only the 8394 panty should be spawned.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
