"use strict";

/**
 * Shopify catalog sync (parent + Color × Size variants). Used by onShopifySyncJobCreated.
 * - productSet (2024-07+): productOptions Color + Size, N variants, per-variant media file + metafields
 * - Config: SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN or functions.config().shopify
 *
 * Launch defaults (documented): inventory not tracked (`inventoryItem.tracked: false`), policy CONTINUE,
 * taxable from Rally (default true), requiresShipping from Rally shipping (default true), weight on inventory item.
 * `fulfillment_service` is not set on ProductVariantSetInput; Shopify uses the store’s manual fulfillment default.
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const { buildShopifyTags } = require("./buildShopifyTags");
const { primaryVariantImageUrlForShopify } = require("./lib/variantShopifyMedia");

const SHOPIFY_API_VERSION = "2024-07";

const SIZE_OPTION_ORDER = ["XS", "S", "M", "L", "XL"];

/**
 * @returns {{ store: string, accessToken: string }}
 */
function getShopifyConfig() {
  const store =
    process.env.SHOPIFY_STORE ||
    (typeof require("firebase-functions").config === "function" &&
      require("firebase-functions").config().shopify?.store);
  const accessToken =
    process.env.SHOPIFY_ACCESS_TOKEN ||
    (typeof require("firebase-functions").config === "function" &&
      require("firebase-functions").config().shopify?.access_token);
  if (!store || !accessToken) {
    throw new Error(
      "Shopify not configured: set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN (env or functions.config().shopify)"
    );
  }
  return { store: store.replace(/\.myshopify\.com$/, ""), accessToken };
}

/**
 * Normalize stored Shopify GID or legacy numeric id.
 * @param {string | null | undefined} id
 * @param {"ProductVariant" | "Product"} kind
 */
function toShopifyGid(id, kind) {
  if (!id) return undefined;
  const s = String(id).trim();
  if (!s) return undefined;
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${kind}/${s}`;
}

/**
 * Server-side readiness — keep aligned with `lib/shopify/isProductReadyForShopify.ts`.
 * @param {object} product
 * @param {{ variantDocs?: object[]; mediaFallback?: { heroFront?: string; heroBack?: string; mockupUrl?: string } }} [options]
 * @returns {{ ready: boolean, missing: string[] }}
 */
function readinessCheck(product, options = {}) {
  const missing = [];
  if (!product) return { ready: false, missing: ["Product"] };

  const variantDocs = Array.isArray(options.variantDocs) ? options.variantDocs : [];

  if (!product.title?.trim()) missing.push("Title");
  if (!product.handle?.trim()) missing.push("Handle");
  if (!product.blankId?.trim()) missing.push("Blank");
  if (typeof product.pricing?.basePrice !== "number" || product.pricing.basePrice < 0) {
    missing.push("Price");
  }
  if (typeof product.shipping?.defaultWeightGrams !== "number" || product.shipping.defaultWeightGrams < 0) {
    missing.push("Weight");
  }

  const blankStyle = String(product.blankStyleCode || "").trim();
  const is8394 = blankStyle === "8394";
  const isParentKind = product.productKind === "parent";
  const useMatrix = variantDocs.length > 0;

  if (useMatrix) {
    const active = variantDocs.filter((v) => v.status !== "archived");
    if (!active.length) {
      missing.push("Active variants");
    } else {
      let needSku = false;
      let needOpts = false;
      let needImg = false;
      for (const v of active) {
        if (!String(v.sku || "").trim()) needSku = true;
        const c = String((v.optionValues && v.optionValues.color) || "").trim();
        const sz = String((v.optionValues && v.optionValues.size) || "").trim();
        if (!c || !sz) needOpts = true;
        if (!primaryVariantImageUrlForShopify(v, product.blankStyleCode)) needImg = true;
      }
      if (needSku) missing.push("SKU on every active variant");
      if (needOpts) missing.push("Color × Size on every active variant");
      if (needImg) {
        missing.push("Variant image (each active variant needs hero, mockup, or flat render)");
      }
    }
  } else if (isParentKind) {
    missing.push("Active variants");
  } else {
    const fb = options.mediaFallback || null;
    const effHeroFront = (product.media?.heroFront?.trim() || fb?.heroFront?.trim() || "").trim();
    const effHeroBack = (product.media?.heroBack?.trim() || fb?.heroBack?.trim() || "").trim();
    const effMockup = (fb?.mockupUrl?.trim() || "").trim();
    if (is8394) {
      const hasHeroBack = !!effHeroBack || !!effMockup;
      const hasHeroFront = !!effHeroFront;
      if (!hasHeroBack && !hasHeroFront) {
        missing.push("Hero back or hero front (8394 is back-print; use back blended or blank front)");
      }
    } else if (!effHeroFront) {
      missing.push("Hero front");
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * @param {object} product
 */
function buildLegacySyntheticVariant(product) {
  const color =
    product.colorway && product.colorway.name ? String(product.colorway.name).trim() : "Default";
  const sizes = product.availableSizes;
  const size = Array.isArray(sizes) && sizes.length > 0 ? String(sizes[0]) : "One Size";
  return {
    firestoreDocId: null,
    shopify: product.shopify || {},
    optionValues: { color, size },
    sku: String(product.handle || product.slug || "rally").slice(0, 255),
    media: product.media,
    mockupUrl: product.mockupUrl || null,
    flatRenders: product.flatRenders || null,
    pricing: product.pricing,
    shipping: product.shipping,
    taxable: true,
    designId: product.designId,
    blankVariantId: product.blankVariantId,
    designIdFront: product.designIdFront,
    designIdBack: product.designIdBack,
    status: "active",
  };
}

/**
 * @param {object} v
 * @param {object} parent
 */
function resolveVariantPricing(v, parent) {
  const pb = v.pricing && typeof v.pricing.basePrice === "number" ? v.pricing : parent.pricing;
  return {
    basePrice: pb && typeof pb.basePrice === "number" ? pb.basePrice : 0,
    compareAtPrice: pb && typeof pb.compareAtPrice === "number" ? pb.compareAtPrice : undefined,
  };
}

/**
 * @param {object} v
 * @param {object} parent
 */
function resolveVariantShipping(v, parent) {
  const s = v.shipping && typeof v.shipping.defaultWeightGrams === "number" ? v.shipping : parent.shipping;
  const grams = s && typeof s.defaultWeightGrams === "number" ? s.defaultWeightGrams : 0;
  const requiresShipping = s && s.requiresShipping === false ? false : true;
  return { defaultWeightGrams: grams, requiresShipping };
}

/**
 * @param {string[]} sizes
 */
function sortSizeValues(sizes) {
  const set = new Set(sizes);
  const out = [];
  for (const s of SIZE_OPTION_ORDER) {
    if (set.has(s)) out.push(s);
  }
  const rest = [...set].filter((x) => !SIZE_OPTION_ORDER.includes(x)).sort();
  return out.concat(rest);
}

/**
 * @param {object} product
 * @param {object[]} variantDocs - raw Firestore variant rows (+ optional `firestoreDocId`)
 * @param {string} store
 * @param {string} accessToken
 * @returns {Promise<{ productId: string, variantLinks: { rallyDocId: string | null, sku: string, shopifyVariantId: string }[] }>}
 */
async function runProductSync(product, variantDocs, store, accessToken) {
  const useMatrix = Array.isArray(variantDocs) && variantDocs.length > 0;
  if (product.productKind === "parent" && !useMatrix) {
    throw new Error("Parent products require variant subdocuments; Rally child variants are the SKU source of truth.");
  }
  const activeVariants = useMatrix
    ? variantDocs.filter((v) => v.status !== "archived")
    : [buildLegacySyntheticVariant(product)];

  if (!activeVariants.length) {
    throw new Error("No active variants to sync");
  }

  activeVariants.sort((a, b) => {
    const ca = String((a.optionValues && a.optionValues.color) || "");
    const cb = String((b.optionValues && b.optionValues.color) || "");
    if (ca !== cb) return ca.localeCompare(cb);
    const sa = String((a.optionValues && a.optionValues.size) || "");
    const sb = String((b.optionValues && b.optionValues.size) || "");
    const ia = SIZE_OPTION_ORDER.indexOf(sa);
    const ib = SIZE_OPTION_ORDER.indexOf(sb);
    const ra = ia === -1 ? 100 : ia;
    const rb = ib === -1 ? 100 : ib;
    if (ra !== rb) return ra - rb;
    return sa.localeCompare(sb);
  });

  const colorSet = new Set();
  const sizeSet = new Set();
  for (const v of activeVariants) {
    colorSet.add(String((v.optionValues && v.optionValues.color) || "").trim());
    sizeSet.add(String((v.optionValues && v.optionValues.size) || "").trim());
  }
  const uniqueColors = [...colorSet].filter(Boolean).sort();
  const uniqueSizes = sortSizeValues([...sizeSet].filter(Boolean));
  if (!uniqueColors.length || !uniqueSizes.length) {
    throw new Error("Variants must define Color and Size option values");
  }

  /** @type {Map<string, { originalSource: string, contentType: string, alt: string, filename: string }>} */
  const filesByUrl = new Map();
  for (const v of activeVariants) {
    const url = primaryVariantImageUrlForShopify(v, product.blankStyleCode);
    if (!url) continue;
    if (filesByUrl.has(url)) continue;
    const sku = String(v.sku || "img").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    filesByUrl.set(url, {
      originalSource: url,
      contentType: "IMAGE",
      alt: ((product.title || product.handle || "") + " " + sku).slice(0, 512),
      filename: `rally-${sku}.png`,
    });
  }
  const files = [...filesByUrl.values()];
  if (!files.length) {
    throw new Error("At least one variant image URL is required for Shopify sync");
  }

  const productMetafields = [];
  if (product.blankId) {
    productMetafields.push({
      namespace: "rally",
      key: "blank_id",
      value: String(product.blankId),
      type: "single_line_text_field",
    });
  }
  if (product.teamId) {
    productMetafields.push({
      namespace: "rally",
      key: "team_id",
      value: String(product.teamId),
      type: "single_line_text_field",
    });
  }
  if (product.themeCode) {
    productMetafields.push({
      namespace: "rally",
      key: "theme_code",
      value: String(product.themeCode),
      type: "single_line_text_field",
    });
  }
  if (product.designId) {
    productMetafields.push({
      namespace: "rally",
      key: "design_id",
      value: String(product.designId),
      type: "single_line_text_field",
    });
  }
  if (product.designIdFront) {
    productMetafields.push({
      namespace: "rally",
      key: "design_front_id",
      value: String(product.designIdFront),
      type: "single_line_text_field",
    });
  }
  if (product.designIdBack) {
    productMetafields.push({
      namespace: "rally",
      key: "design_back_id",
      value: String(product.designIdBack),
      type: "single_line_text_field",
    });
  }
  if (product.production?.printPdfFront) {
    productMetafields.push({
      namespace: "rally",
      key: "print_pdf_front",
      value: String(product.production.printPdfFront),
      type: "single_line_text_field",
    });
  }
  if (product.production?.printPdfBack) {
    productMetafields.push({
      namespace: "rally",
      key: "print_pdf_back",
      value: String(product.production.printPdfBack),
      type: "single_line_text_field",
    });
  }
  if (product.production?.productionNotes) {
    productMetafields.push({
      namespace: "rally",
      key: "production_notes",
      value: String(product.production.productionNotes).slice(0, 5000),
      type: "multi_line_text_field",
    });
  }

  const variants = [];
  let pos = 0;
  for (const v of activeVariants) {
    pos += 1;
    const color = String((v.optionValues && v.optionValues.color) || "").trim();
    const size = String((v.optionValues && v.optionValues.size) || "").trim();
    const sku = String(v.sku || "").trim();
    const imgUrl = primaryVariantImageUrlForShopify(v, product.blankStyleCode);
    const pricing = resolveVariantPricing(v, product);
    const shipping = resolveVariantShipping(v, product);
    const grams = Number(shipping.defaultWeightGrams || 0);
    const gid = toShopifyGid(v.shopify && v.shopify.variantId, "ProductVariant");

    /** @type {Record<string, unknown>} */
    const inventoryItem = {
      tracked: false,
      requiresShipping: shipping.requiresShipping !== false,
    };
    if (grams > 0) {
      inventoryItem.measurement = {
        weight: { value: grams, unit: "GRAMS" },
      };
    }

    /** @type {object[]} */
    const vMetas = [];
    if (v.blankVariantId) {
      vMetas.push({
        namespace: "rally",
        key: "blank_variant_id",
        value: String(v.blankVariantId),
        type: "single_line_text_field",
      });
    }
    const designRef = v.designId || v.designIdFront || product.designId;
    if (designRef) {
      vMetas.push({
        namespace: "rally",
        key: "design_id",
        value: String(designRef),
        type: "single_line_text_field",
      });
    }

    /** @type {Record<string, unknown>} */
    const row = {
      id: gid,
      position: pos,
      sku,
      price: String(Number(pricing.basePrice).toFixed(2)),
      taxable: v.taxable !== false,
      optionValues: [
        { optionName: "Color", name: color },
        { optionName: "Size", name: size },
      ],
      inventoryItem,
      inventoryPolicy: "CONTINUE",
    };
    if (typeof pricing.compareAtPrice === "number" && Number.isFinite(pricing.compareAtPrice)) {
      row.compareAtPrice = String(Number(pricing.compareAtPrice).toFixed(2));
    }
    if (imgUrl) {
      const fm = filesByUrl.get(imgUrl);
      if (fm) {
        row.file = {
          originalSource: fm.originalSource,
          contentType: fm.contentType,
          filename: fm.filename,
        };
      }
    }
    if (vMetas.length) row.metafields = vMetas;
    variants.push(row);
  }

  const input = {
    title: (product.title || product.name || product.slug || "").slice(0, 255),
    handle: (product.handle || product.slug || "").slice(0, 255),
    descriptionHtml:
      (product.descriptionHtml || product.description || "").slice(0, 100000) || null,
    productType: (product.productType || "").slice(0, 255) || null,
    vendor: (product.brand && String(product.brand).trim()) || "Rally",
    status: "ACTIVE",
    tags: (Array.isArray(product.tags) && product.tags.length > 0
      ? product.tags
      : buildShopifyTags(product)
    )
      .slice(0, 250)
      .map((t) => String(t).slice(0, 255)),
    files,
    productOptions: [
      { name: "Color", position: 1, values: uniqueColors.map((name) => ({ name })) },
      { name: "Size", position: 2, values: uniqueSizes.map((name) => ({ name })) },
    ],
    variants,
  };

  if (product.seo?.title || product.seo?.description) {
    input.seo = {};
    if (product.seo.title) input.seo.title = String(product.seo.title).slice(0, 70);
    if (product.seo.description) input.seo.description = String(product.seo.description).slice(0, 320);
  }
  if (productMetafields.length) input.metafields = productMetafields;

  const mutation = `
    mutation productSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(synchronous: true, input: $input, identifier: $identifier) {
        product {
          id
          variants(first: 250) {
            nodes {
              id
              sku
              selectedOptions { name value }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    input,
    identifier: { handle: (product.handle || product.slug || "").trim() },
  };

  const data = await shopifyGraphQL(store, accessToken, mutation, variables);
  const result = data.productSet;
  if (result.userErrors && result.userErrors.length > 0) {
    const msg = result.userErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify productSet userErrors: ${msg}`);
  }
  const productNode = result.product;
  if (!productNode || !productNode.id) {
    throw new Error("Shopify productSet did not return product id");
  }

  const shopifyVariants = productNode.variants && productNode.variants.nodes ? productNode.variants.nodes : [];
  /** @type {{ rallyDocId: string | null, sku: string, shopifyVariantId: string }[]} */
  const variantLinks = [];
  const bySku = new Map();
  for (const node of shopifyVariants) {
    const s = node.sku && String(node.sku).trim();
    if (s) bySku.set(s.toUpperCase(), node.id);
  }
  for (const v of activeVariants) {
    const sku = String(v.sku || "").trim();
    const shopifyVariantId = bySku.get(sku.toUpperCase()) || null;
    if (!shopifyVariantId) {
      throw new Error(`Shopify did not return variant id for SKU ${sku}`);
    }
    variantLinks.push({
      rallyDocId: v.firestoreDocId != null ? String(v.firestoreDocId) : null,
      sku,
      shopifyVariantId,
    });
  }

  return {
    productId: productNode.id,
    variantLinks,
  };
}

/**
 * @param {string} store
 * @param {string} accessToken
 * @param {string} query
 * @param {object} [variables]
 */
async function shopifyGraphQL(store, accessToken, query, variables = {}) {
  const url = `https://${store}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

module.exports = {
  getShopifyConfig,
  readinessCheck,
  runProductSync,
  shopifyGraphQL,
  toShopifyGid,
};
