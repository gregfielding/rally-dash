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

/**
 * Leaf collection families. Each entry maps a Rally tag prefix → the Shopify
 * smart-collection handle prefix + title prefix.
 *
 * Phase D realignment (2026-06-01): the original map referenced `city:` and
 * `product_type:` prefixes that Rally never emits (per buildShopifyTags.ts:
 * sport / league / team / theme / model are the only emitted prefixes), so
 * collections for those families were impossible to create. Conversely,
 * `sport:` and `league:` ARE emitted by every product but were missing here,
 * so the operator could never get sport-level or league-level collections.
 *
 * The corrected map mirrors the actual tag schema. `model:` is omitted
 * deliberately — Rally treats model codes as inventory metadata (which
 * physical model wore which design), not as a customer-browseable axis.
 */
const LEAF_PREFIX = {
  sport: { handlePrefix: "sport", titlePrefix: "Sport" },
  league: { handlePrefix: "league", titlePrefix: "League" },
  team: { handlePrefix: "team", titlePrefix: "Team" },
  theme: { handlePrefix: "theme", titlePrefix: "Theme" },
  /** Ink/brand accent color (e.g. "color:orange") — cross-catalog "shop by color" collection. */
  color: { handlePrefix: "color", titlePrefix: "Color" },
};

/**
 * Map of Rally `rp_taxonomy_*` collection name → which LEAF_PREFIX family
 * its entries should sync as. Used by the proactive taxonomy-driven sync
 * (`syncSmartCollectionsFromTaxonomy`) so an operator can pre-create all
 * collections without waiting for products to reference them.
 *
 * Entity-type filter on rp_taxonomy_entities is intentional: only
 * actual TEAM-like entities (pro_team, college, club, etc.) generate
 * smart collections — drivers / brands / generic_entity stay untagged
 * until we know they're worth a collection of their own.
 */
const TAXONOMY_COLLECTION_TO_FAMILY = {
  rp_taxonomy_sports: { family: "sport", codeField: "code" },
  rp_taxonomy_leagues: { family: "league", codeField: "code" },
  rp_taxonomy_entities: {
    family: "team",
    codeField: "code",
    /** Only sync entities whose entityType belongs to one of these. */
    entityTypes: new Set([
      "pro_team",
      "college",
      "club",
      "team",
      "motorsport_team",
      "constructor",
    ]),
  },
  rp_taxonomy_themes: { family: "theme", codeField: "code" },
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

/**
 * Phase D: derive the canonical leaf-collection spec from a taxonomy entry.
 * Same shape as `leafSpecsFromTags` returns, but built from the Firestore
 * taxonomy doc directly (so we can pre-create collections before any product
 * references them).
 *
 * @param {string} family   One of LEAF_PREFIX keys ("sport"|"league"|"team"|"theme").
 * @param {string} code     The taxonomy entry's code (e.g. "SFGIANTS", "BASEBALL").
 * @param {string} name     The taxonomy entry's human-readable name (e.g. "SF Giants").
 *                          Used as the title body; `code` falls back if name is empty.
 * @returns {{family:string,fullTag:string,handle:string,title:string}|null}
 */
function buildLeafSpecFromTaxonomyEntry(family, code, name) {
  if (!LEAF_PREFIX[family]) return null;
  const codeStr = String(code || "").trim();
  if (!codeStr) return null;
  /**
   * Tag schema (matches buildShopifyTags.ts): lowercase, underscores, no special
   * chars. The code is uppercase upstream; normalize here so the rule matches
   * what products actually carry as tags.
   */
  const slugPart = codeStr.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slugPart) return null;
  const fullTag = `${family}:${slugPart}`;
  const handle = `${LEAF_PREFIX[family].handlePrefix}-` + slugPart.replace(/_/g, "-");
  const titleBody =
    typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : codeStr.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `${LEAF_PREFIX[family].titlePrefix}: ${titleBody}`;
  return { family, fullTag, handle, title };
}

/**
 * Phase D: pre-create smart collections from the Firestore taxonomy WITHOUT
 * waiting for products to reference each entry. Iterates one or more
 * rp_taxonomy_* collections, builds a leaf spec per active entry, and ensures
 * a Shopify smart collection exists for it. Writes the sync state back onto
 * each taxonomy doc so the UI can show "synced ✓" / "not synced" / error.
 *
 * Why this exists: the reactive per-product flow doesn't help an operator
 * who's building out the catalog — empty collections aren't useful, but
 * "this team has no collection because no product references it yet" IS
 * useful information. Proactive sync surfaces it.
 *
 * @param {Object} params
 * @param {FirebaseFirestore.Firestore} params.db
 * @param {string} params.store              Shopify store handle (e.g. "0c1d2c-80")
 * @param {string} params.accessToken        Shopify Admin token
 * @param {string[]} [params.collections]    Which rp_taxonomy_* collections to sync.
 *                                            Default: all four (sports/leagues/entities/themes).
 * @param {boolean} [params.dryRun]          If true, return the plan without calling Shopify.
 * @param {typeof import("firebase-admin")} params.admin
 * @returns {Promise<{summary: Array<{family, code, handle, title, status, shopifyId?, error?}>}>}
 */
async function syncSmartCollectionsFromTaxonomy({
  db,
  store,
  accessToken,
  collections,
  dryRun = false,
  admin,
}) {
  const targetCollections =
    Array.isArray(collections) && collections.length > 0
      ? collections.filter((c) => TAXONOMY_COLLECTION_TO_FAMILY[c])
      : Object.keys(TAXONOMY_COLLECTION_TO_FAMILY);

  const summary = [];
  const tick = () =>
    admin && admin.firestore && admin.firestore.FieldValue
      ? admin.firestore.FieldValue.serverTimestamp()
      : new Date();

  for (const collectionName of targetCollections) {
    const cfg = TAXONOMY_COLLECTION_TO_FAMILY[collectionName];
    const snap = await db.collection(collectionName).where("active", "==", true).get();
    console.log(
      `[syncSmartCollectionsFromTaxonomy] ${collectionName}: ${snap.size} active entries`
    );

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      /** Entity-type filter (only applicable to rp_taxonomy_entities). */
      if (cfg.entityTypes && data.entityType && !cfg.entityTypes.has(data.entityType)) {
        continue;
      }
      const spec = buildLeafSpecFromTaxonomyEntry(cfg.family, data[cfg.codeField], data.name);
      if (!spec) {
        summary.push({
          family: cfg.family,
          docId: doc.id,
          code: data[cfg.codeField] || null,
          status: "skipped_invalid",
        });
        continue;
      }

      if (dryRun) {
        summary.push({
          family: spec.family,
          docId: doc.id,
          code: data[cfg.codeField],
          handle: spec.handle,
          title: spec.title,
          tagRule: spec.fullTag,
          status: "dry_run",
        });
        continue;
      }

      const rules = [{ column: "tag", relation: "equals", condition: spec.fullTag }];
      try {
        const r = await ensureSmartCollectionREST(store, accessToken, {
          title: spec.title,
          handle: spec.handle,
          rules,
          sort_order: "best-selling",
        });
        const status = r.created ? "created" : "already_exists";
        /**
         * Best-effort write of sync state. If this fails the collection still
         * exists in Shopify; the operator just won't see "synced ✓" in the UI.
         */
        try {
          await doc.ref.update({
            shopifySmartCollection: {
              id: r.id || null,
              handle: spec.handle,
              title: spec.title,
              tagRule: spec.fullTag,
              syncedAt: tick(),
              syncStatus: status,
            },
            updatedAt: tick(),
          });
        } catch (writeErr) {
          console.warn(
            `[syncSmartCollectionsFromTaxonomy] Failed to update ${collectionName}/${doc.id}:`,
            writeErr && writeErr.message
          );
        }
        summary.push({
          family: spec.family,
          docId: doc.id,
          code: data[cfg.codeField],
          handle: spec.handle,
          title: spec.title,
          shopifyId: r.id || null,
          status,
        });
      } catch (e) {
        console.warn(
          `[syncSmartCollectionsFromTaxonomy] ${collectionName}/${doc.id} failed:`,
          e && e.message
        );
        try {
          await doc.ref.update({
            shopifySmartCollection: {
              handle: spec.handle,
              title: spec.title,
              tagRule: spec.fullTag,
              syncStatus: "error",
              syncError: String(e.message || e).slice(0, 500),
              syncedAt: tick(),
            },
            updatedAt: tick(),
          });
        } catch (writeErr) {
          // Swallow secondary failure
        }
        summary.push({
          family: spec.family,
          docId: doc.id,
          code: data[cfg.codeField],
          handle: spec.handle,
          title: spec.title,
          status: "error",
          error: String(e.message || e).slice(0, 500),
        });
      }
    }
  }

  return { summary };
}

/**
 * Phase D: read-only status report on which taxonomy entries have synced
 * smart collections vs which are missing. Compares Firestore (source of
 * truth) against `shopifySmartCollection.syncStatus` on each doc — no
 * Shopify GraphQL hit per entry, so it's cheap (single doc reads).
 *
 * @returns {Promise<{rows: Array<{family, docId, code, name, expectedHandle, status, shopifyId?, syncedAt?, error?}>}>}
 */
async function getShopifySmartCollectionsStatus({ db, collections }) {
  const targetCollections =
    Array.isArray(collections) && collections.length > 0
      ? collections.filter((c) => TAXONOMY_COLLECTION_TO_FAMILY[c])
      : Object.keys(TAXONOMY_COLLECTION_TO_FAMILY);

  const rows = [];
  for (const collectionName of targetCollections) {
    const cfg = TAXONOMY_COLLECTION_TO_FAMILY[collectionName];
    const snap = await db.collection(collectionName).where("active", "==", true).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (cfg.entityTypes && data.entityType && !cfg.entityTypes.has(data.entityType)) {
        continue;
      }
      const spec = buildLeafSpecFromTaxonomyEntry(cfg.family, data[cfg.codeField], data.name);
      if (!spec) continue;
      const synced = data.shopifySmartCollection || null;
      rows.push({
        collection: collectionName,
        family: cfg.family,
        docId: doc.id,
        code: data[cfg.codeField],
        name: data.name || null,
        expectedHandle: spec.handle,
        expectedTitle: spec.title,
        tagRule: spec.fullTag,
        status: synced ? synced.syncStatus || "unknown" : "not_synced",
        shopifyId: synced ? synced.id || null : null,
        syncedAt: synced ? synced.syncedAt || null : null,
        error: synced ? synced.syncError || null : null,
      });
    }
  }
  return { rows };
}

module.exports = {
  LEAF_PREFIX,
  HUBS,
  NEW_ARRIVALS,
  TAXONOMY_COLLECTION_TO_FAMILY,
  leafSpecsFromTags,
  buildLeafSpecFromTaxonomyEntry,
  tagsFromProduct,
  ensureLeafCollectionsForProduct,
  ensureGlobalSmartCollections,
  ensureShopifyCollectionsAfterProductSync,
  syncSmartCollectionsFromTaxonomy,
  getShopifySmartCollectionsStatus,
  slugToHandlePart: (slug) => String(slug || "").replace(/_/g, "-"),
};
