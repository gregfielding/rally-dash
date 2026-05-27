#!/usr/bin/env node

/**
 * Inspect SF Giants products + their generation jobs to see why they're stuck
 * at "generating_assets" with no images.
 *
 * Usage (from functions/):
 *   GCLOUD_PROJECT=rally-dash node scripts/inspect-sf-giants-products.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function ts(d) {
  return d && d.toDate ? d.toDate().toISOString() : null;
}

async function main() {
  // 4 product ids the design spawned (from logs)
  const TARGET_IDS = [
    "Ch9CxTZdZgouzSOYRekr", // tank
    "S2JBJOD71egMEDVP35aj", // thong
    "mIrikKfLsu6QR1h7Ja0A", // crewneck
  ];
  console.log("=== Targeted SF Giants products spawned by onDesignCreated ===\n");
  const prodSnap = { docs: [] };
  for (const id of TARGET_IDS) {
    const snap = await db.collection("rp_products").doc(id).get();
    if (snap.exists) prodSnap.docs.push(snap);
  }
  // Also list all products whose name contains "Giants"
  const fullSnap = await db.collection("rp_products").get();
  for (const d of fullSnap.docs) {
    const p = d.data();
    if (/giants/i.test(p.name || "") || /giants/i.test(p.title || "")) {
      if (!TARGET_IDS.includes(d.id)) prodSnap.docs.push(d);
    }
  }
  prodSnap.size = prodSnap.docs.length;
  console.log(`Found ${prodSnap.size} products.\n`);

  for (const doc of prodSnap.docs) {
    const p = doc.data();
    console.log(`---- ${doc.id} (${p.name || p.title}) ----`);
    console.log(
      JSON.stringify(
        {
          id: doc.id,
          name: p.name,
          slug: p.slug,
          teamId: p.teamId,
          blankId: p.blankId,
          designId: p.designId,
          launchStatus: p.launchStatus,
          assetsStatus: p.assetsStatus,
          shopifyStatus: p.shopifyStatus,
          shopifyReady: p.shopifyReady,
          assetBatchId: p.assetBatchId || p.currentAssetBatchId,
          productIdentityKey: p.productIdentityKey,
          createdAt: ts(p.createdAt),
          updatedAt: ts(p.updatedAt),
        },
        null,
        2
      )
    );

    // Variants
    const variants = await doc.ref.collection("variants").get();
    console.log(`  variants: ${variants.size}`);
    let withImages = 0;
    let withMedia = 0;
    for (const v of variants.docs) {
      const vd = v.data();
      if (vd.images && vd.images.length > 0) withImages++;
      if (vd.media && vd.media.length > 0) withMedia++;
    }
    console.log(`  variants with images: ${withImages}, with media: ${withMedia}`);

    // Asset batch
    const batchId = p.assetBatchId || p.currentAssetBatchId;
    if (batchId) {
      const batchSnap = await db.collection("rp_product_asset_batches").doc(batchId).get();
      if (batchSnap.exists) {
        const b = batchSnap.data();
        console.log(`  batch ${batchId}:`);
        console.log(
          JSON.stringify(
            {
              status: b.status,
              progress: b.progress,
              counts: b.counts,
              error: b.error,
              createdAt: ts(b.createdAt),
              updatedAt: ts(b.updatedAt),
            },
            null,
            2
          )
        );
        const tasksSnap = await batchSnap.ref.collection("tasks").get();
        const taskCounts = {};
        for (const t of tasksSnap.docs) {
          const s = t.data().status || "unknown";
          taskCounts[s] = (taskCounts[s] || 0) + 1;
        }
        console.log(`  batch tasks (${tasksSnap.size}): ${JSON.stringify(taskCounts)}`);
        // Show a couple errors
        const errored = tasksSnap.docs
          .filter((d) => d.data().status === "error" || d.data().status === "failed")
          .slice(0, 3);
        for (const e of errored) {
          console.log(`  task error: ${e.id} -> ${e.data().error || e.data().errorMessage}`);
        }
      } else {
        console.log(`  batch ${batchId}: NOT FOUND`);
      }
    } else {
      console.log("  (no assetBatchId)");
    }
    console.log("");
  }

  console.log("\n=== recent rp_generation_jobs (last 30, any status) ===");
  const jobsSnap = await db
    .collection("rp_generation_jobs")
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();
  for (const j of jobsSnap.docs) {
    const jd = j.data();
    console.log(
      JSON.stringify(
        {
          id: j.id,
          status: jd.status,
          jobType: jd.jobType,
          productId: jd.productId,
          variantId: jd.variantId,
          designId: jd.designId,
          blankId: jd.blankId,
          error: jd.error || jd.errorMessage,
          createdAt: ts(jd.createdAt),
          updatedAt: ts(jd.updatedAt),
        },
        null,
        2
      )
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
