#!/usr/bin/env node

/**
 * Ensure Shopify smart collections (hubs + new arrivals + leaf collections from product tags).
 *
 * Requires SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN (env or firebase functions:config).
 *
 * Usage (from functions/):
 *   node scripts/ensure-shopify-smart-collections.js
 *   node scripts/ensure-shopify-smart-collections.js --product-id=<rp_products doc id>
 *
 * Without --product-id: creates hub collections (teams, styles, themes) + new-arrivals only.
 * With --product-id: also ensures leaf collections for that product's structured tags (team:, city:, etc.).
 */

const admin = require("firebase-admin");
const shopifySync = require("../shopifySync");
const shopifySmartCollections = require("../lib/shopifySmartCollections");

async function main() {
  const args = process.argv.slice(2);
  const productArg = args.find((a) => a.startsWith("--product-id="));
  const productId = productArg ? productArg.split("=").slice(1).join("=").trim() : null;

  const { store, accessToken } = shopifySync.getShopifyConfig();

  if (productId) {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const db = admin.firestore();
    const snap = await db.collection("rp_products").doc(productId).get();
    if (!snap.exists) {
      console.error("Product not found:", productId);
      process.exit(1);
    }
    const product = snap.data();
    const r = await shopifySmartCollections.ensureShopifyCollectionsAfterProductSync(product, store, accessToken);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const r = await shopifySmartCollections.ensureGlobalSmartCollections(store, accessToken);
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
