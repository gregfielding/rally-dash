#!/usr/bin/env node

/**
 * Read-only: verify smart collections exist in Shopify Admin (by handle).
 *
 * Requires SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN.
 *
 * Usage (from functions/):
 *   npm run shopify:verify-collections
 *
 * Spot-check handles assume structured tags from Rally taxonomy:
 *   team:los_angeles_dodgers → team-los-angeles-dodgers
 *   team:sf_giants          → team-sf-giants  (Giants in design team data)
 *   product_type:bikini_panty → style-bikini-panty
 *   theme:69                 → theme-69
 *
 * If a leaf is missing, run `npm run shopify:ensure-collections` (hubs) or sync a product
 * that carries those tags, or: `node scripts/ensure-shopify-smart-collections.js --product-id=<id>`
 */

const shopifySync = require("../shopifySync");
const { HUBS, NEW_ARRIVALS } = require("../lib/shopifySmartCollections");

const LAUNCH_NAV_PATHS = [
  { label: "Shop All", path: "/collections/all" },
  { label: "Teams hub", path: "/collections/teams" },
  { label: "Styles hub", path: "/collections/styles" },
  { label: "Themes hub", path: "/collections/themes" },
  { label: "New Arrivals", path: "/collections/new-arrivals" },
];

/** Leaf collections to spot-check (handles = tag slug with _ → -). */
const SPOT_LEAF_HANDLES = [
  { name: "Dodgers (LA)", handle: "team-los-angeles-dodgers", tag: "team:los_angeles_dodgers" },
  { name: "Giants (SF)", handle: "team-san-francisco-giants", tag: "team:san_francisco_giants" },
  { name: "Bikini Panty", handle: "style-bikini-panty", tag: "product_type:bikini_panty" },
  { name: "Theme 69", handle: "theme-69", tag: "theme:69" },
];

async function collectionNodeByHandle(store, accessToken, handle) {
  const q = `
    query($q: String!) {
      collections(first: 1, query: $q) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const data = await shopifySync.shopifyGraphQL(store, accessToken, q, { q: `handle:${handle}` });
  const node = data?.collections?.edges?.[0]?.node || data?.collections?.nodes?.[0];
  if (node && node.handle === handle) return node;
  return null;
}

async function main() {
  const { store, accessToken } = shopifySync.getShopifyConfig();

  console.log("Store:", store);
  console.log("\n--- Launch nav URLs (Online Store paths) ---");
  for (const row of LAUNCH_NAV_PATHS) {
    console.log(`  ${row.label.padEnd(14)} ${row.path}`);
  }

  const hubHandles = [...HUBS.map((h) => h.handle), NEW_ARRIVALS.handle];
  console.log("\n--- Hub + New Arrivals (must exist for nav) ---");
  let missing = 0;
  for (const handle of hubHandles) {
    const node = await collectionNodeByHandle(store, accessToken, handle);
    if (!node) missing += 1;
    console.log(node ? `  OK   ${handle} — ${node.title}` : `  MISS ${handle}`);
  }

  console.log("\n--- Spot-check leaf collections ---");
  for (const row of SPOT_LEAF_HANDLES) {
    const node = await collectionNodeByHandle(store, accessToken, row.handle);
    if (!node) missing += 1;
    const line = node
      ? `  OK   ${row.handle} — ${node.title}`
      : `  MISS ${row.handle} (tag ${row.tag})`;
    console.log(line);
  }

  console.log(
    missing
      ? `\nMissing ${missing} collection(s). Run npm run shopify:ensure-collections and/or sync products.`
      : "\nAll checked handles present."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
