#!/usr/bin/env node
/**
 * One-shot Shopify push smoke test. Patches the minimum missing product-level
 * fields (pricing, shipping, shopifyStatus, status) on a target rp_products
 * doc, creates a `shopifySyncJobs` doc to fire the `onShopifySyncJobCreated`
 * trigger, then polls until the job lands or fails.
 *
 * Default target: BVXhCaEZd9fZ2kj4Q5xe (San Francisco Giants 69 Panty —
 * an existing draft product that was created before the 8394 blank had
 * defaultPricing/defaultShipping set, so its product-level pricing/shipping
 * fields are unset even though all 20 variants are fully rendered).
 *
 * Pushes as Shopify DRAFT status (not ACTIVE) so the product is invisible to
 * customers until manually published in Shopify Admin. Smoke test only —
 * we'll lift to ACTIVE once the pipeline is proven.
 *
 * Usage (from functions/):
 *   node scripts/shopify-smoke-push.js
 *   node scripts/shopify-smoke-push.js --product-id=<id> --dry-run
 *   node scripts/shopify-smoke-push.js --product-id=<id>  # apply + sync
 */

"use strict";

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const rc = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.firebaserc"), "utf8"));
    return rc?.projects?.default;
  } catch (_) {}
  return undefined;
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: getProjectId() });
}

const db = admin.firestore();

function parseFlag(name, fallback) {
  const prefix = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(prefix));
  return f ? f.slice(prefix.length) : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const productId = parseFlag("product-id", "BVXhCaEZd9fZ2kj4Q5xe");

async function main() {
  console.log(`[smoke] Loading rp_products/${productId}…`);
  const productRef = db.collection("rp_products").doc(productId);
  const snap = await productRef.get();
  if (!snap.exists) {
    console.error(`[fatal] Product ${productId} not found`);
    process.exit(1);
  }
  const product = snap.data();
  console.log(`[smoke] Title:       ${product.title}`);
  console.log(`[smoke] Handle:      ${product.handle}`);
  console.log(`[smoke] Blank:       ${product.blankId}`);
  console.log(`[smoke] Status:      ${product.status}`);
  console.log(`[smoke] LaunchState: ${product.launchStatus}`);
  console.log(`[smoke] Pricing:     ${JSON.stringify(product.pricing ?? null)}`);
  console.log(`[smoke] Shipping:    ${JSON.stringify(product.shipping ?? null)}`);

  /** Pull the blank's default pricing + shipping so we use the same values
   *  freshly-launched products would get going forward. */
  const blankSnap = await db.collection("rp_blanks").doc(product.blankId).get();
  if (!blankSnap.exists) {
    console.error(`[fatal] Blank ${product.blankId} not found`);
    process.exit(1);
  }
  const blank = blankSnap.data();
  const blankPricing = blank.defaultPricing || {};
  const blankShipping = blank.defaultShipping || {};
  const blankShopify = blank.shopifyDefaults || {};
  console.log(`[smoke] Blank pricing default:  ${JSON.stringify(blankPricing)}`);
  console.log(`[smoke] Blank shipping default: ${JSON.stringify(blankShipping)}`);

  /** Compute the patch. Only fill product-level fields if they're empty. */
  const patch = {};
  if (typeof product.pricing?.basePrice !== "number") {
    const basePrice = typeof blankPricing.retailPrice === "number" ? blankPricing.retailPrice : 25;
    const currencyCode = blankPricing.currencyCode || "USD";
    patch.pricing = { basePrice, currencyCode };
  }
  if (typeof product.shipping?.defaultWeightGrams !== "number") {
    const defaultWeightGrams =
      typeof blankShipping.defaultWeightGrams === "number" ? blankShipping.defaultWeightGrams : 50;
    const requiresShipping =
      typeof blankShipping.requiresShipping === "boolean" ? blankShipping.requiresShipping : true;
    patch.shipping = { defaultWeightGrams, requiresShipping };
  }
  if (!product.productType) {
    patch.productType = blankShopify.productType || "Underwear";
  }
  if (!product.brand) {
    patch.brand = blankShopify.brand || "Rally Panties";
  }
  /** Smoke test: push as DRAFT so customers can't see this until verified. */
  patch.shopifyStatus = "DRAFT";
  /** Mark ready so the sync gate accepts it. */
  patch.status = "shopify_ready";
  patch.launchStatus = "READY";

  console.log("\n[smoke] Proposed product patch:");
  console.log(JSON.stringify(patch, null, 2));

  if (dryRun) {
    console.log("\n[smoke] DRY-RUN — no writes. Re-run without --dry-run to apply + sync.");
    return;
  }

  /** Write product patch */
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await productRef.update(patch);
  console.log(`\n[smoke] ✓ Patched rp_products/${productId}`);

  /**
   * Create the sync job doc — onShopifySyncJobCreated picks it up. Schema
   * matches what the trigger validates (functions/index.js:8401):
   *   entityType: "product"
   *   action:     "create_or_update"
   *   entityId:   <productId>
   * Anything else fails with "Unsupported job: entityType=... action=...".
   */
  const jobRef = await db.collection("shopifySyncJobs").add({
    entityType: "product",
    action: "create_or_update",
    entityId: productId,
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "queued",
    source: "smoke-test-script",
    notes: "First end-to-end smoke push to verify Shopify connection + readiness gate + data mapping. Pushing as Shopify DRAFT status.",
  });
  console.log(`[smoke] ✓ Created shopifySyncJobs/${jobRef.id} (queued)`);

  /** Poll the job + product for the next 90s */
  console.log("\n[smoke] Watching the job (90s timeout)…");
  const deadline = Date.now() + 90_000;
  let lastJobStatus = "queued";
  let lastShopifyStatus = product.shopify?.status ?? null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const [jobSnap, prodSnap] = await Promise.all([jobRef.get(), productRef.get()]);
    const job = jobSnap.data();
    const p = prodSnap.data();
    if (job?.status !== lastJobStatus) {
      console.log(`  [t+${Math.floor((Date.now() - (deadline - 90_000)) / 1000)}s] job.status: ${lastJobStatus} → ${job?.status}`);
      lastJobStatus = job?.status;
    }
    const newShopifyStatus = p?.shopify?.status ?? null;
    if (newShopifyStatus !== lastShopifyStatus) {
      console.log(`  product.shopify.status: ${lastShopifyStatus} → ${newShopifyStatus}`);
      lastShopifyStatus = newShopifyStatus;
    }
    if (job?.status === "completed" || job?.status === "failed") {
      console.log("\n[smoke] Final job state:");
      console.log(JSON.stringify(job, null, 2));
      console.log("\n[smoke] Final product.shopify:");
      console.log(JSON.stringify(p?.shopify ?? null, null, 2));
      if (p?.shopify?.productId) {
        console.log(`\n[smoke] ✓ Shopify product created: gid://shopify/Product/${p.shopify.productId}`);
        console.log("[smoke]   → check in admin: https://0c1d2c-80.myshopify.com/admin/products");
      }
      return;
    }
  }
  console.log("[smoke] ⚠ Timed out after 90s. Check shopifySyncJobs/" + jobRef.id + " manually.");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
