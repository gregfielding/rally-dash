# Shopify readiness audit (codebase vs `shopify_readiness_master_spec.md`)

**Date:** 2026-03-27  
**Scope:** Read-only inventory of what exists, what is partial, and what is missing. No redesign.  
**Primary code paths:** `functions/shopifySync.js`, `functions/index.js` (`onShopifySyncJobCreated`), `lib/shopify/isProductReadyForShopify.ts`, `lib/types/firestore.ts` (`RpProduct`, `RpProductVariant`), `functions/lib/runCreateProductFromDesignBlankCore.js`.

---

## Executive summary

Sync today is an **MVP single-variant** flow: one `productSet` upsert with **one Shopify variant**, parent-level images, minimal metafields, and **no** Color × Size matrix, inventory policy, tax/fulfillment fields, or per-color Shopify variant mapping. Rally’s **Firestore model** already anticipates parent + color variants, SKUs on child docs, and richer shopify state—but **the worker does not read variant subcollections or push multi-variant / metafield depth** required by the master spec.

---

## 1. Product-level fields (Shopify)

| Spec / field | Status | Where populated | Notes |
|--------------|--------|-----------------|-------|
| `title` | **OK** | `runProductSync` ← `product.title` / `name` / `slug` | — |
| `body_html` | **OK** | `descriptionHtml` / `description` | — |
| `handle` | **OK** | `handle` / `slug` | Used as `ProductSetIdentifiers` |
| `product_type` | **Partial** | `product.productType` | Optional in payload (`null` if empty); readiness warns if missing (client only) |
| `tags` | **Partial** | `product.tags[]` if non-empty, else `buildShopifyTags(product)` | Structured codes (`sport:`, `league:`, …). Human-readable tags exist via `generateProductTags` **if** written to `product.tags` at create—not guaranteed in sync path alone |
| `vendor` | **Missing** | — | Not sent in `ProductSetInput`. `brand` / `vendor` exist on product from blank defaults in create core but **not mapped** in `shopifySync.js` |
| `status` | **Missing** | — | Not set explicitly (draft vs active) |
| `seo` | **Partial** | `product.seo` | Optional block |

---

## 2. Variant-level fields (Shopify)

| Spec / field | Status | Notes |
|--------------|--------|-------|
| Color option | **Missing** | No `optionValues` / product options in sync |
| Size option | **Missing** | `availableSizes` on parent is documented as UI/denorm only; **no** XS–XL Shopify variants |
| `sku` | **Partial / wrong shape** | Single variant SKU = `product.id` \|\| `handle` \|\| `slug` — **not** deterministic `RP-…` format; **`RpProductVariant.sku` unused** by sync |
| `price` | **OK** | `pricing.basePrice` |
| `compare_at_price` | **Partial** | Sent if `pricing.compareAtPrice` is a number |
| `cost` | **Missing** | Not in Admin payload; blank `defaultPricing.cost` may exist at create but **not synced** |
| `inventory_quantity` / `inventory_management` | **Missing** | Spec §7 options A/B not implemented in sync |
| `weight` / `weight_unit` | **Partial** | `shipping.defaultWeightGrams` + fixed **`GRAMS`** (spec example used lb; data model is grams—acceptable if documented) |
| `requires_shipping` | **Partial (data only)** | `shipping.requiresShipping` exists on `RpProduct` type; **not passed** to Shopify in `runProductSync` |
| `taxable` | **Missing** | — |
| `fulfillment_service` | **Missing** | Spec recommends `manual` at launch |

---

## 3. Color × Size matrix

| Question | Answer |
|----------|--------|
| Implemented? | **No** |
| Evidence | `runProductSync` builds `variants: [ { single row } ]`; worker loads **only** `rp_products/{entityId}` parent doc |
| Firestore | `RpProduct.availableSizes`, `variantSummary`, `heroVariantId`, subcollection `variants/{variantId}` **exist** but are **not** consumed by sync |

---

## 4. SKU generation

| Spec | Actual |
|------|--------|
| Deterministic decodeable SKUs (e.g. `RP-MLB-SF-C69-BLK-M`) | **Not implemented** for Shopify |
| Current | Parent-level string from id/handle/slug |
| Variant docs | `RpProductVariant.sku` optional in schema; **not wired** to Shopify sync |

---

## 5. Pricing + cost

| Area | Status |
|------|--------|
| Retail / base | **Populated** at product create from blank `defaultPricing`; synced as `price` |
| Compare-at | **Synced** when numeric |
| Cost | **Missing** from Shopify sync (and typical Admin `productSet` variant cost may need separate field—**not present** in current mutation input) |

---

## 6. Inventory strategy

| Spec §7 | Actual |
|---------|--------|
| Option A (soft / high qty) or B (tracked) | **Neither** explicitly set in `runProductSync` |

---

## 7. Shipping + weight

| Spec | Actual |
|------|--------|
| Weight on every variant | **Yes** for the **one** variant, from `defaultWeightGrams` |
| Unit | **Hard-coded `GRAMS`** |
| `requires_shipping` | **Not** sent |

---

## 8. Tax + fulfillment

| Field | In sync payload? |
|-------|------------------|
| `taxable` | No |
| `fulfillment_service` | No |

---

## 9. Media in Shopify payload

| Spec | Actual |
|------|--------|
| Per-color package | **No** — only `product.media.heroFront` / `heroBack` URLs on **parent** |
| Variant subcollection media | **Not** read by worker |
| Readiness gap | **Server** `readinessCheck` in `shopifySync.js` only checks **parent** `product.media`; **does not** apply client’s `mediaFallback` from hero variant (`isProductReadyForShopify` on product page **does**). Parent-only heroes can cause **false “not ready”** or **wrong images** on sync for multi-color parents |

---

## 10. Metafields

| Metafield (spec §13) | In `runProductSync`? |
|----------------------|----------------------|
| `blank_id` | Yes (`rally.blank_id`) |
| Design ids | Yes (`design_front_id`, `design_back_id`) |
| Print PDFs / notes | Yes |
| `design_id` (single) | Partial (front/back split only) |
| `blank_variant_id` | **No** |
| `team_id` | **No** |
| `theme_code` | **No** (theme may appear only in tags if `product.tags` populated) |
| `render_profile_id` | **No** |
| Front/back image URLs | **No** |

---

## 11. Order mapping readiness

| Spec path | Actual |
|-----------|--------|
| Shopify variant id + SKU | Parent stores `shopify.productId` + `shopify.variantId` for **one** variant only |
| Child variants | `RpProductVariant.shopify.variantId` **typed** but worker **never** updates variant docs |
| Line item → Rally | **Insufficient** for multi-color: no stable per-color Shopify variant id or per-color SKU from sync |

---

## 12. Readiness gates (spec §15 vs code)

| Gate | Client (`isProductReadyForShopify`) | Server (`readinessCheck`) |
|------|-------------------------------------|---------------------------|
| Title, handle, blank, price, weight | Yes | Yes |
| Hero images (8394) | Uses optional **variant fallback** | **No** fallback — parent `media` only |

---

## 13. Final gap list (priority-neutral)

**Blocking “master spec complete” (not an ordered roadmap):**

1. Multi-variant Shopify product: **Color** (+ later **Size**) with option definitions and one Admin variant per sellable SKU.  
2. Sync worker must **read** `rp_products/{id}/variants/*` (or equivalent) and **map** each to Shopify variants; update **each** `RpProductVariant.shopify.variantId`.  
3. Deterministic **SKU** generation and storage; sync **variant.sku**, not parent id slug.  
4. **Vendor**, **status**, **inventory policy**, **taxable**, **fulfillment_service**, **requires_shipping** in payload (or explicit Shopify defaults documented).  
5. **Cost** (if required for operations) via Admin API fields supported by your API version.  
6. **Per-color (and per-size) images** + Shopify’s variant ↔ image association strategy (spec §11–12).  
7. **Metafields** for `blank_variant_id`, `team_id`, `theme_code`, and any order-reconciliation ids you standardize on.  
8. Align **server readiness** with **client readiness** (hero variant media fallback for parent products).  
9. **Order ingestion** path: verify webhook/worker can resolve line items using stored ids + SKUs once (1)–(3) exist.

---

## 14. Files referenced

- `functions/shopifySync.js` — `readinessCheck`, `runProductSync`  
- `functions/index.js` — `onShopifySyncJobCreated`  
- `lib/shopify/isProductReadyForShopify.ts`  
- `lib/shopify/buildShopifyTags.ts` / `functions/buildShopifyTags.js`  
- `lib/types/firestore.ts` — `RpProduct`, `RpProductVariant`, `ShopifySyncJob`  
- `functions/lib/runCreateProductFromDesignBlankCore.js` — initial `pricing`, `shipping`, `brand`, `vendor` on product  

---

*This audit satisfies §18 of `shopify_readiness_master_spec.md`. Next spec step (§20): fill gaps, then declare Shopify contract complete before expanding lifestyle imagery.*
