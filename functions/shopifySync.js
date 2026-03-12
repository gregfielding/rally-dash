"use strict";

/**
 * Shopify catalog sync (MVP). Used by onShopifySyncJobCreated.
 * - productSet (create/update product + files + single variant + metafields)
 * - Config via process.env.SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN or functions.config().shopify
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const { buildShopifyTags } = require("./buildShopifyTags");

const SHOPIFY_API_VERSION = "2024-01";

/**
 * Get Shopify store and access token. Prefer env vars, then functions.config().
 * @returns {{ store: string, accessToken: string }}
 */
function getShopifyConfig() {
  const store = process.env.SHOPIFY_STORE || (typeof require("firebase-functions").config === "function" && require("firebase-functions").config().shopify?.store);
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || (typeof require("firebase-functions").config === "function" && require("firebase-functions").config().shopify?.access_token);
  if (!store || !accessToken) {
    throw new Error("Shopify not configured: set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN (env or functions.config().shopify)");
  }
  return { store: store.replace(/\.myshopify\.com$/, ""), accessToken };
}

/**
 * Server-side readiness (same rules as client isProductReadyForShopify).
 * @param {object} product - Rally product (Firestore snapshot data)
 * @returns {{ ready: boolean, missing: string[] }}
 */
function readinessCheck(product) {
  const missing = [];
  if (!product) return { ready: false, missing: ["Product"] };
  if (!product.title?.trim()) missing.push("Title");
  if (!product.handle?.trim()) missing.push("Handle");
  if (!product.blankId?.trim()) missing.push("Blank");
  if (typeof product.pricing?.basePrice !== "number" || product.pricing.basePrice < 0) missing.push("Price");
  if (typeof product.shipping?.defaultWeightGrams !== "number" || product.shipping.defaultWeightGrams < 0) missing.push("Weight");
  if (!product.media?.heroFront?.trim()) missing.push("Hero front");
  return { ready: missing.length === 0, missing };
}

/**
 * Run GraphQL against Shopify Admin API.
 * @param {string} store - store name without .myshopify.com
 * @param {string} accessToken
 * @param {string} query - GraphQL document
 * @param {object} [variables]
 * @returns {Promise<object>} response.data or throws on errors
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

/**
 * Build ProductSetInput and run productSet (upsert by handle). Includes one variant and rally metafields.
 * Media: heroFront (required), heroBack (optional) via originalSource URLs.
 * @param {object} product - Rally product
 * @param {string} store
 * @param {string} accessToken
 * @returns {Promise<{ productId: string, variantId: string | null }>}
 */
async function runProductSync(product, store, accessToken) {
  const files = [];
  if (product.media?.heroFront) {
    files.push({
      originalSource: product.media.heroFront,
      contentType: "IMAGE",
      alt: (product.title || product.handle || "").slice(0, 512),
    });
  }
  if (product.media?.heroBack) {
    files.push({
      originalSource: product.media.heroBack,
      contentType: "IMAGE",
      alt: ((product.title || product.handle) + " (back)").slice(0, 512),
    });
  }
  if (files.length === 0) {
    throw new Error("At least one hero image (heroFront) is required");
  }

  const price = String(Number(product.pricing?.basePrice ?? 0).toFixed(2));
  const weight = Number(product.shipping?.defaultWeightGrams ?? 0);
  const sku = (product.id || product.handle || product.slug || "rally").slice(0, 255);

  const metafields = [];
  if (product.blankId) metafields.push({ namespace: "rally", key: "blank_id", value: String(product.blankId), type: "single_line_text_field" });
  if (product.designIdFront) metafields.push({ namespace: "rally", key: "design_front_id", value: String(product.designIdFront), type: "single_line_text_field" });
  if (product.designIdBack) metafields.push({ namespace: "rally", key: "design_back_id", value: String(product.designIdBack), type: "single_line_text_field" });
  if (product.production?.printPdfFront) metafields.push({ namespace: "rally", key: "print_pdf_front", value: String(product.production.printPdfFront), type: "single_line_text_field" });
  if (product.production?.printPdfBack) metafields.push({ namespace: "rally", key: "print_pdf_back", value: String(product.production.printPdfBack), type: "single_line_text_field" });
  if (product.production?.productionNotes) metafields.push({ namespace: "rally", key: "production_notes", value: String(product.production.productionNotes).slice(0, 5000), type: "multi_line_text_field" });

  const input = {
    title: (product.title || product.name || product.slug || "").slice(0, 255),
    handle: (product.handle || product.slug || "").slice(0, 255),
    descriptionHtml: (product.descriptionHtml || product.description || "").slice(0, 100000) || null,
    productType: (product.productType || "").slice(0, 255) || null,
    tags: buildShopifyTags(product).slice(0, 250).map((t) => String(t).slice(0, 255)),
    files,
    variants: [
      {
        price,
        weight,
        weightUnit: "GRAMS",
        sku: sku || undefined,
        compareAtPrice: typeof product.pricing?.compareAtPrice === "number" ? String(Number(product.pricing.compareAtPrice).toFixed(2)) : undefined,
      },
    ],
  };
  if (product.seo?.title || product.seo?.description) {
    input.seo = {};
    if (product.seo.title) input.seo.title = String(product.seo.title).slice(0, 70);
    if (product.seo.description) input.seo.description = String(product.seo.description).slice(0, 320);
  }
  if (metafields.length) input.metafields = metafields;

  const mutation = `
    mutation productSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(synchronous: true, input: $input, identifier: $identifier) {
        product {
          id
          variants(first: 1) { nodes { id } }
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

  const variantId = productNode.variants?.nodes?.[0]?.id || null;
  return {
    productId: productNode.id,
    variantId,
  };
}

module.exports = {
  getShopifyConfig,
  readinessCheck,
  runProductSync,
  shopifyGraphQL,
};
