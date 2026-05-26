#!/usr/bin/env node
/**
 * Burn-it-down cleanup of the rp_blanks + rp_products catalog (Path A from the
 * 2026-05-25 cleanup planning).
 *
 * Problem state:
 *   - `rp_blanks` has 25 docs. Only 4 are real masters (schemaVersion=2,
 *     status=active). The other 21 are draft duplicates from prior iterations
 *     that clutter queries and confused the earlier patch-* scripts (which
 *     used .limit(1) and grabbed whichever doc Firestore returned first —
 *     often a non-master draft).
 *   - `rp_products` has 1 doc (BVXhCaEZd9fZ2kj4Q5xe) — the SF Giants 69 panty
 *     used for the Shopify smoke-test push. Leaving it around creates noise
 *     for the next clean launch test.
 *
 * What this script does:
 *   1. List all rp_blanks docs and flag the 4 masters vs the 21 to archive.
 *   2. Archive non-masters by setting `status: "archived"` (reversible — sets
 *      a flag rather than deleting; ops can restore by flipping back to draft
 *      or active).
 *   3. Optionally delete the test rp_products doc (gated behind --delete-product).
 *   4. Print a final report of the master 4 + their template/pricing/shipping
 *      status so the next step (re-running patch scripts) can verify masters
 *      are fully populated.
 *
 * Out of scope for this script (manual steps):
 *   - Delete the Shopify draft product the smoke test created
 *     (`gid://shopify/Product/8290566242348`). Do this in Shopify Admin
 *     directly OR via a Shopify GraphQL `productDelete` call.
 *   - Re-run the 3 patch scripts (after this) against the real masters.
 *
 * Usage:
 *   node scripts/cleanup-blank-catalog.js --dry-run
 *   node scripts/cleanup-blank-catalog.js
 *   node scripts/cleanup-blank-catalog.js --delete-product
 */

"use strict";

const admin = require("firebase-admin");
const path = require("path");

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const rc = JSON.parse(require("fs").readFileSync(path.resolve(__dirname, "../../.firebaserc"), "utf8"));
    return rc?.projects?.default;
  } catch (_) {}
  return undefined;
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: getProjectId() });
}

const db = admin.firestore();
const dryRun = process.argv.includes("--dry-run");
const deleteProduct = process.argv.includes("--delete-product");

/**
 * Doc id of the smoke-test rp_products doc to delete (if --delete-product).
 * Hard-coded because this is a one-off cleanup; if you need to delete a
 * different product, edit here OR use Firestore console.
 */
const TEST_PRODUCT_ID = "BVXhCaEZd9fZ2kj4Q5xe";

function isActiveMaster(data) {
  return data.schemaVersion === 2 && data.status === "active";
}

async function main() {
  console.log("┌──────────────────────────────────────────────────────────────────");
  console.log("│ Blank catalog cleanup (Path A)");
  console.log("└──────────────────────────────────────────────────────────────────\n");

  /** 1. Inventory rp_blanks. */
  const blanksSnap = await db.collection("rp_blanks").get();
  const masters = [];
  const nonMasters = [];
  blanksSnap.forEach((d) => {
    const data = d.data();
    const row = {
      id: d.id,
      styleCode: data.styleCode,
      styleName: data.styleName,
      status: data.status,
      schemaVersion: data.schemaVersion,
      hasDescTemplate: !!data.descriptionTemplate,
      hasShopifyDefaults: !!(data.shopifyDefaults && Object.keys(data.shopifyDefaults).length > 0),
      defaultPricing: data.defaultPricing,
      defaultShipping: data.defaultShipping,
    };
    if (isActiveMaster(data)) masters.push(row);
    else nonMasters.push(row);
  });

  console.log(`Total rp_blanks docs:    ${blanksSnap.size}`);
  console.log(`Active masters (keep):   ${masters.length}`);
  console.log(`Non-master/draft:        ${nonMasters.length}\n`);

  /** 2. Show the masters. */
  console.log("=== Active masters (KEEP) ===");
  masters
    .sort((a, b) => (a.styleCode || "").localeCompare(b.styleCode || ""))
    .forEach((m) => {
      const flags = [
        m.hasDescTemplate ? "✓template" : "✗template",
        m.hasShopifyDefaults ? "✓shopifyDefaults" : "✗shopifyDefaults",
        m.defaultPricing ? "✓pricing" : "✗pricing",
        m.defaultShipping ? "✓shipping" : "✗shipping",
      ].join("  ");
      console.log(`  ${m.styleCode.padEnd(8)} ${m.id}  ${m.styleName}`);
      console.log(`    ${flags}`);
    });

  /** 3. Show the non-masters to archive. */
  console.log("\n=== Non-master / draft (ARCHIVE) ===");
  const toArchive = nonMasters.filter((d) => d.status !== "archived");
  toArchive
    .sort((a, b) => (a.styleCode || "").localeCompare(b.styleCode || ""))
    .forEach((d) => {
      console.log(
        `  ${(d.styleCode || "?").padEnd(8)} ${d.id}  status=${d.status}  schemaV=${d.schemaVersion}  ${d.styleName}`
      );
    });
  if (toArchive.length === 0) {
    console.log("  (nothing to archive — all non-masters already archived or none exist)");
  }

  /** 4. Test product. */
  console.log("\n=== Test rp_products to delete ===");
  const testProductRef = db.collection("rp_products").doc(TEST_PRODUCT_ID);
  const testProductSnap = await testProductRef.get();
  if (testProductSnap.exists) {
    console.log(`  rp_products/${TEST_PRODUCT_ID} exists`);
    console.log(`    title:      ${testProductSnap.data().title}`);
    console.log(`    status:     ${testProductSnap.data().status}`);
    console.log(`    shopify.productId: ${testProductSnap.data().shopify?.productId ?? "(none)"}`);
    if (!deleteProduct) {
      console.log("  (skipped — pass --delete-product to delete this rp_products doc)");
    }
  } else {
    console.log(`  rp_products/${TEST_PRODUCT_ID} doesn't exist (already deleted?)`);
  }

  console.log("");

  if (dryRun) {
    console.log("─── DRY-RUN — no writes. Re-run without --dry-run to apply. ───");
    return;
  }

  /** 5. Apply archival. */
  if (toArchive.length > 0) {
    const batch = db.batch();
    for (const d of toArchive) {
      batch.update(db.collection("rp_blanks").doc(d.id), {
        status: "archived",
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        archivedReason: "Cleanup 2026-05-25: non-master duplicate of " + d.styleCode + " (keep id was the active master)",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`✓ Archived ${toArchive.length} non-master rp_blanks docs`);
  }

  /** 6. Apply test-product deletion (if flagged). */
  if (deleteProduct && testProductSnap.exists) {
    /** Also delete the variants subcollection first — Firestore doesn't cascade. */
    const variants = await testProductRef.collection("variants").get();
    if (variants.size > 0) {
      const batch = db.batch();
      variants.forEach((v) => batch.delete(v.ref));
      await batch.commit();
      console.log(`✓ Deleted ${variants.size} variant subdocs under rp_products/${TEST_PRODUCT_ID}`);
    }
    await testProductRef.delete();
    console.log(`✓ Deleted rp_products/${TEST_PRODUCT_ID}`);
  } else if (deleteProduct && !testProductSnap.exists) {
    console.log("  Skipped product delete — doc didn't exist");
  } else if (!deleteProduct) {
    console.log(`  Skipped product delete — pass --delete-product to delete rp_products/${TEST_PRODUCT_ID}`);
  }

  console.log("\n── Cleanup complete ──");
  console.log("Next step: re-run the patch scripts so each master has correct copy/pricing:");
  console.log("  node scripts/patch-bikini-panty-shopify-defaults.js  --dry-run");
  console.log("  node scripts/patch-thong-shopify-defaults.js          --dry-run");
  console.log("  node scripts/patch-tank-shopify-defaults.js           --dry-run");
  console.log("  node scripts/patch-hf07-shopify-defaults.js           --dry-run");
  console.log("(Then re-run without --dry-run if the proposed patches look right.)");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
