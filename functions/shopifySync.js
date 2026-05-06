"use strict";

/**
 * Shopify catalog sync (parent + Color × Size variants). Used by onShopifySyncJobCreated.
 * - productSet (2024-07+): productOptions Color + Size, N variants, per-variant media file + metafields
 * - Config: SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN or functions.config().shopify
 *
 * Launch defaults (documented): inventory not tracked (`inventoryItem.tracked: false`), policy CONTINUE,
 * taxable from Rally (default true), requiresShipping from Rally shipping (default true), weight on inventory item.
 * `fulfillment_service` is not set on ProductVariantSetInput; Shopify uses the store’s manual fulfillment default.
 *
 * Product media: v1 uses one featured image per variant (`primaryVariantImageUrlForShopify`). A future multi-image
 * gallery should order variant-scoped `rp_product_assets` the same way as the dashboard:
 * `lib/shopify/galleryAssetOrdering.ts` (approvalState → galleryRole → gallerySort).
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const { buildShopifyTags } = require("./buildShopifyTags");
const {
  primaryVariantImageUrlForShopify,
  mergeInheritedMediaForReadiness8394,
} = require("./lib/variantShopifyMedia");

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
 * @param {{ variantDocs?: object[]; mediaFallback?: { heroFront?: string; heroBack?: string; mockupUrl?: string }; printSides?: { effectiveFront?: boolean; effectiveBack?: boolean } | null }} [options]
 * @returns {{ ready: boolean, missing: string[] }}
 */
function readinessCheck(product, options = {}) {
  const missing = [];
  if (!product) return { ready: false, missing: ["Product"] };

  const variantDocs = Array.isArray(options.variantDocs) ? options.variantDocs : [];
  const printSides =
    options.printSides != null
      ? options.printSides
      : product.fulfillmentSummary && product.fulfillmentSummary.printSides
        ? product.fulfillmentSummary.printSides
        : null;

  const normalizedVariants = variantDocs.map((v) => ({
    ...v,
    id:
      v.id != null
        ? String(v.id)
        : v.firestoreDocId != null
          ? String(v.firestoreDocId)
          : "",
  }));
  const byId = new Map(normalizedVariants.filter((v) => v.id).map((v) => [v.id, v]));

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
        const vid =
          v.id != null ? String(v.id) : v.firestoreDocId != null ? String(v.firestoreDocId) : "";
        const merged = mergeInheritedMediaForReadiness8394(vid ? { ...v, id: vid } : v, byId);
        if (!primaryVariantImageUrlForShopify(merged, product.blankStyleCode, printSides)) needImg = true;
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
      const backOnly =
        printSides && printSides.effectiveBack === true && printSides.effectiveFront === false;
      if (backOnly) {
        if (!hasHeroBack) {
          missing.push("Hero back or mockup (8394 back-only)");
        }
      } else if (!hasHeroBack && !hasHeroFront) {
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
  const printSides =
    product.fulfillmentSummary && product.fulfillmentSummary.printSides
      ? product.fulfillmentSummary.printSides
      : null;
  const activeVariants = useMatrix
    ? variantDocs.filter((v) => v.status !== "archived")
    : [buildLegacySyntheticVariant(product)];

  if (!activeVariants.length) {
    throw new Error("No active variants to sync");
  }

  /** Same as readiness: size rows may inherit media from the primary size before fanout completes. */
  const byIdForSync = new Map();
  for (const v of activeVariants) {
    const id =
      v.firestoreDocId != null ? String(v.firestoreDocId) : v.id != null ? String(v.id) : "";
    if (id) byIdForSync.set(id, { ...v, id });
  }
  function mergeVariantForSync(v) {
    const id =
      v.firestoreDocId != null ? String(v.firestoreDocId) : v.id != null ? String(v.id) : "";
    return mergeInheritedMediaForReadiness8394(id ? { ...v, id } : v, byIdForSync);
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
    const url = primaryVariantImageUrlForShopify(mergeVariantForSync(v), product.blankStyleCode, printSides);
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

  const rawVariantMode = product.shopifyVariantMode;
  /** @type {"legacy"|"color"|"color_size"} */
  const syncMode =
    rawVariantMode === "color"
      ? "color"
      : rawVariantMode === "color_size"
        ? "color_size"
        : "legacy";

  /** First variant row per color (stable order) — used when syncMode === "color". */
  const byColorFirst = new Map();
  for (const v of activeVariants) {
    const c = String((v.optionValues && v.optionValues.color) || "").trim();
    if (!c) continue;
    if (!byColorFirst.has(c)) byColorFirst.set(c, v);
  }
  const collapsedByColor = [...byColorFirst.values()].sort((a, b) => {
    const ca = String((a.optionValues && a.optionValues.color) || "");
    const cb = String((b.optionValues && b.optionValues.color) || "");
    return ca.localeCompare(cb);
  });

  /**
   * @param {object} v
   * @param {{ colorSizeOptions: boolean, variantTitle?: string | null }} shape
   */
  function buildVariantRow(v, shape) {
    const color = String((v.optionValues && v.optionValues.color) || "").trim();
    const size = String((v.optionValues && v.optionValues.size) || "").trim();
    const sku = String(v.sku || "").trim();
    const imgUrl = primaryVariantImageUrlForShopify(mergeVariantForSync(v), product.blankStyleCode, printSides);
    const pricing = resolveVariantPricing(v, product);
    const shipping = resolveVariantShipping(v, product);
    const grams = Number(shipping.defaultWeightGrams || 0);
    const gid = toShopifyGid(v.shopify && v.shopify.variantId, "ProductVariant");

    const inventoryItem = {
      tracked: false,
      requiresShipping: shipping.requiresShipping !== false,
    };
    if (grams > 0) {
      inventoryItem.measurement = {
        weight: { value: grams, unit: "GRAMS" },
      };
    }

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
      sku,
      price: String(Number(pricing.basePrice).toFixed(2)),
      taxable: v.taxable !== false,
      inventoryItem,
      inventoryPolicy: "CONTINUE",
    };
    if (shape.variantTitle && String(shape.variantTitle).trim()) {
      row.title = String(shape.variantTitle).trim().slice(0, 255);
    }
    if (shape.colorSizeOptions) {
      row.optionValues = [
        { optionName: "Color", name: color },
        { optionName: "Size", name: size },
      ];
    } else {
      row.optionValues = [{ optionName: "Color", name: color }];
    }
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
    return row;
  }

  const variants = [];
  let pos = 0;

  if (syncMode === "color") {
    for (const v of collapsedByColor) {
      pos += 1;
      const color = String((v.optionValues && v.optionValues.color) || "").trim();
      const row = buildVariantRow(v, { colorSizeOptions: false, variantTitle: color });
      row.position = pos;
      variants.push(row);
    }
  } else {
    for (const v of activeVariants) {
      pos += 1;
      const color = String((v.optionValues && v.optionValues.color) || "").trim();
      const size = String((v.optionValues && v.optionValues.size) || "").trim();
      const title =
        syncMode === "color_size" && color && size ? `${color} / ${size}`.slice(0, 255) : null;
      const row = buildVariantRow(v, { colorSizeOptions: true, variantTitle: title || undefined });
      row.position = pos;
      variants.push(row);
    }
  }

  let productOptions;
  if (syncMode === "color") {
    productOptions = [{ name: "Color", position: 1, values: uniqueColors.map((name) => ({ name })) }];
  } else {
    productOptions = [
      { name: "Color", position: 1, values: uniqueColors.map((name) => ({ name })) },
      { name: "Size", position: 2, values: uniqueSizes.map((name) => ({ name })) },
    ];
  }

  try {
    console.log(
      "[SHOPIFY_VARIANT_MODE]",
      JSON.stringify({
        productId: product.id || null,
        shopifyVariantMode: rawVariantMode != null ? rawVariantMode : null,
        effectiveMode: syncMode,
        variantCount: variants.length,
        optionStructure: syncMode === "color" ? "Color" : "Color+Size",
      })
    );
  } catch (_) {
    /* ignore */
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
    productOptions,
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

  function rallyIdFromVariantDoc(v) {
    if (v.id != null && String(v.id).trim()) return String(v.id).trim();
    if (v.firestoreDocId != null && String(v.firestoreDocId).trim()) return String(v.firestoreDocId).trim();
    return null;
  }

  if (syncMode === "color") {
    const colorToGid = new Map();
    for (const v of collapsedByColor) {
      const sku = String(v.sku || "").trim();
      const shopifyVariantId = bySku.get(sku.toUpperCase()) || null;
      if (!shopifyVariantId) {
        throw new Error(`Shopify did not return variant id for SKU ${sku} (color mode)`);
      }
      const color = String((v.optionValues && v.optionValues.color) || "").trim();
      colorToGid.set(color, shopifyVariantId);
    }
    for (const v of activeVariants) {
      const sku = String(v.sku || "").trim();
      const color = String((v.optionValues && v.optionValues.color) || "").trim();
      const shopifyVariantId = colorToGid.get(color) || null;
      if (!shopifyVariantId) {
        throw new Error(`Shopify variant mapping missing for color "${color}" (SKU ${sku})`);
      }
      variantLinks.push({
        rallyDocId: rallyIdFromVariantDoc(v),
        sku,
        shopifyVariantId,
      });
    }
  } else {
    for (const v of activeVariants) {
      const sku = String(v.sku || "").trim();
      const shopifyVariantId = bySku.get(sku.toUpperCase()) || null;
      if (!shopifyVariantId) {
        throw new Error(`Shopify did not return variant id for SKU ${sku}`);
      }
      variantLinks.push({
        rallyDocId: rallyIdFromVariantDoc(v),
        sku,
        shopifyVariantId,
      });
    }
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
