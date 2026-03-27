"use strict";

/**
 * Auto-create Shopify smart collections from structured Rally tags (single source of truth).
 * Uses Admin REST smart_collections.json + GraphQL for existence checks.
 * @see rally_tag_system_spec.md
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const { shopifyGraphQL } = require("../shopifySync");

const SHOPIFY_API_VERSION = "2024-01";

/** Leaf collection families: tag equals full tag string; handle uses prefix + slug with _ → - */
const LEAF_PREFIX = {
  team: { handlePrefix: "team", titlePrefix: "Team" },
  city: { handlePrefix: "city", titlePrefix: "City" },
  product_type: { handlePrefix: "style", titlePrefix: "Style" },
  theme: { handlePrefix: "theme", titlePrefix: "Theme" },
};

/** Hub collections for top-level nav (tag contains prefix). */
const HUBS = [
  {
    handle: "teams",
    title: "Teams",
    rule: { column: "tag", relation: "contains", condition: "team:" },
  },
  {
    handle: "styles",
    title: "Styles",
    rule: { column: "tag", relation: "contains", condition: "product_type:" },
  },
  {
    handle: "themes",
    title: "Themes",
    rule: { column: "tag", relation: "contains", condition: "theme:" },
  },
];

const NEW_ARRIVALS = {
  handle: "new-arrivals",
  title: "New Arrivals",
  /** Broad rule so membership is not tag-defined; ordering is date-based via sort_order. */
  rules: [{ column: "variant_price", relation: "greater_than", condition: "0" }],
  sort_order: "created-desc",
};

function adminRestUrl(store, path) {
  return `https://${store}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${path}`;
}

/**
 * @param {string[]} tags
 * @returns {{ family: string, fullTag: string, handle: string, title: string }[]}
 */
function leafSpecsFromTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of tags || []) {
    const t = String(raw).trim();
    if (!t) continue;
    const idx = t.indexOf(":");
    if (idx <= 0) continue;
    const family = t.slice(0, idx).trim();
    const rest = t.slice(idx + 1).trim();
    if (!LEAF_PREFIX[family] || !rest) continue;
    const slugPart = rest;
    const handle =
      `${LEAF_PREFIX[family].handlePrefix}-` + slugPart.replace(/_/g, "-");
    const key = `${family}:${slugPart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pretty = slugPart.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const title = `${LEAF_PREFIX[family].titlePrefix}: ${pretty}`;
    out.push({ family, fullTag: t, handle, title });
  }
  return out;
}

function tagsFromProduct(product) {
  if (Array.isArray(product?.tags)) return product.tags.map((x) => String(x).trim()).filter(Boolean);
  if (typeof product?.tags === "string") {
    return product.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {string} store
 * @param {string} accessToken
 * @param {string} handle
 * @returns {Promise<boolean>}
 */
async function collectionExistsByHandle(store, accessToken, handle) {
  const q = `
    query($q: String!) {
      collections(first: 1, query: $q) {
        edges {
          node {
            id
            handle
          }
        }
      }
    }
  `;
  try {
    const data = await shopifyGraphQL(store, accessToken, q, { q: `handle:${handle}` });
    const node = data?.collections?.edges?.[0]?.node || data?.collections?.nodes?.[0];
    return !!(node && node.handle === handle);
  } catch (e) {
    console.warn("[shopifySmartCollections] collectionExistsByHandle GraphQL failed:", handle, e.message);
    return false;
  }
}

/**
 * Create smart collection via REST (idempotent: skip if handle exists).
 * @returns {Promise<{ created: boolean, id?: string }>}
 */
async function ensureSmartCollectionREST(store, accessToken, { title, handle, rules, sort_order = "best-selling" }) {
  if (await collectionExistsByHandle(store, accessToken, handle)) {
    return { created: false };
  }

  const body = {
    smart_collection: {
      title: title.slice(0, 255),
      handle: handle.slice(0, 255),
      disjunctive: false,
      rules,
      sort_order,
    },
  };

  const url = adminRestUrl(store, "smart_collections.json");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const errStr = typeof parsed === "object" ? JSON.stringify(parsed) : String(text);
    const dup =
      res.status === 422 &&
      (/Handle has already been taken|already been taken|handle/i.test(errStr) ||
        (parsed?.errors && String(parsed.errors).includes("handle")));
    if (dup) return { created: false };
    throw new Error(`Shopify REST ${res.status} smart_collections.json: ${errStr.slice(0, 800)}`);
  }
  const sc = parsed?.smart_collection;
  const id = sc?.id != null ? String(sc.id) : undefined;
  return { created: true, id };
}

/**
 * Ensure leaf smart collections for each structured tag on the product.
 * @param {object} product - Rally product
 */
async function ensureLeafCollectionsForProduct(product, store, accessToken) {
  const specs = leafSpecsFromTags(tagsFromProduct(product));
  const results = [];
  for (const spec of specs) {
    const rules = [{ column: "tag", relation: "equals", condition: spec.fullTag }];
    try {
      const r = await ensureSmartCollectionREST(store, accessToken, {
        title: spec.title,
        handle: spec.handle,
        rules,
        sort_order: "best-selling",
      });
      results.push({ handle: spec.handle, ...r });
    } catch (e) {
      console.warn("[shopifySmartCollections] leaf collection failed:", spec.handle, e.message);
      results.push({ handle: spec.handle, error: e.message });
    }
  }
  return results;
}

/** Hub + New Arrivals (call after sync; cheap when collections already exist). */
async function ensureGlobalSmartCollections(store, accessToken) {
  const out = [];
  for (const hub of HUBS) {
    try {
      const r = await ensureSmartCollectionREST(store, accessToken, {
        title: hub.title,
        handle: hub.handle,
        rules: [hub.rule],
        sort_order: "best-selling",
      });
      out.push({ kind: "hub", handle: hub.handle, ...r });
    } catch (e) {
      console.warn("[shopifySmartCollections] hub failed:", hub.handle, e.message);
      out.push({ kind: "hub", handle: hub.handle, error: e.message });
    }
  }
  try {
    const r = await ensureSmartCollectionREST(store, accessToken, {
      title: NEW_ARRIVALS.title,
      handle: NEW_ARRIVALS.handle,
      rules: NEW_ARRIVALS.rules,
      sort_order: NEW_ARRIVALS.sort_order,
    });
    out.push({ kind: "new_arrivals", ...r });
  } catch (e) {
    console.warn("[shopifySmartCollections] new arrivals failed:", e.message);
    out.push({ kind: "new_arrivals", error: e.message });
  }
  return out;
}

/**
 * Run after a successful product sync: leaf collections for this product's tags + shared hubs/new arrivals.
 */
async function ensureShopifyCollectionsAfterProductSync(product, store, accessToken) {
  const leaf = await ensureLeafCollectionsForProduct(product, store, accessToken);
  const global = await ensureGlobalSmartCollections(store, accessToken);
  return { leaf, global };
}

module.exports = {
  LEAF_PREFIX,
  HUBS,
  NEW_ARRIVALS,
  leafSpecsFromTags,
  tagsFromProduct,
  ensureLeafCollectionsForProduct,
  ensureGlobalSmartCollections,
  ensureShopifyCollectionsAfterProductSync,
  slugToHandlePart: (slug) => String(slug || "").replace(/_/g, "-"),
};
