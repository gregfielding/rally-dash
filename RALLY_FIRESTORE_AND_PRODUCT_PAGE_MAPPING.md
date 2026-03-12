# Rally × Shopify Spec: Firestore Alignment & Product Detail Page Mapping

**Purpose:** Align Firestore schema and Product Detail page with RALLY_X_SHOPIFY_ARCHITECTURE_PART_2.md. Minimum changes for the next UI slice; no over-migration.

**Reference:** RALLY_X_SHOPIFY_ARCHITECTURE_PART_2.md §§ 3.3–3.8, 8.1 Product Detail.

---

# Part 1: Repo Mapping — Current Schema vs Spec

## 1.1 products (rp_products)

| Spec field | Current (RpProduct) | Status | Notes |
|------------|---------------------|--------|-------|
| **id** | `id?: string` | ✅ | Exists |
| **title** | `name: string` | ⚠️ Rename/alias | Spec uses `title`; we have `name`. Add `title?` optional; UI can use `title ?? name`. |
| **handle** | `slug: string` | ✅ Alias | Same intent; add `handle?` optional or use `slug` as handle everywhere. |
| **brand** | — | ❌ Missing | Add `brand?: string`. |
| **productType** | — | ❌ Missing | Add `productType?: string`. Spec + Shopify. |
| **garmentType** | `category: RpProductCategory` | ✅ Map | We have category (panties, tank, etc.); can alias or add garmentType. |
| **teamCode / teamName / leagueCode** | — | ❌ Missing | Add when needed for catalog; optional. |
| **blankId** | `blankId?: string` | ✅ | Exists |
| **designIdFront / designIdBack** | `designId?: string` (single) | ⚠️ Extend | Add `designIdFront?`, `designIdBack?`; keep `designId` for primary/back compat. |
| **selectedBlankSide / selectedDesignSide** | `renderConfig.renderSide` | ✅ Map | Same concept; no rename needed. |
| **descriptionHtml / descriptionText** | `description?: string` | ⚠️ Extend | Add `descriptionHtml?`; keep `description` for plain text or use for both. |
| **seo: { title, description }** | — | ❌ Missing | Add `seo?: { title?: string; description?: string }`. |
| **tags** | `tags?: string[]` | ✅ | Exists |
| **collectionKeys** | — | ❌ Missing | Add `collectionKeys?: string[]`. |
| **status** | `status: RpProductStatus` | ✅ | draft \| active \| archived; spec adds "approved" \| "published" — keep current, add "published" later if needed. |
| **pricing** | — | ❌ Missing | Add later for Shopify; optional for this slice. |
| **shipping** | — | ❌ Missing | Add later; optional for this slice. |
| **media: heroFront, heroBack, gallery, modelAssets, lifestyleAssets** | `heroAssetId?`, `heroAssetPath?` (single hero) | ⚠️ Extend | Add `media?: { heroFront?: string; heroBack?: string; gallery?: string[]; modelAssets?: string[]; lifestyleAssets?: string[] }`. Keep heroAssetId/Path for back compat. |
| **production: printPdfFront, printPdfBack, printPdfMaster, printColors, productionNotes** | — | ❌ Missing | Add `production?: { printPdfFront?: string; printPdfBack?: string; printPdfMaster?: string; printColors?: string[]; productionNotes?: string }`. |
| **shopify: productId, status, lastSyncAt, lastSyncError** | — | ❌ Missing | Add `shopify?: { productId?: string; status?: 'not_synced' \| 'queued' \| 'synced' \| 'error'; lastSyncAt?: Timestamp; lastSyncError?: string }`. |
| **createdAt, updatedAt, createdBy, updatedBy** | ✅ | Exists | |

**Collection:** `rp_products` (same).

---

## 1.2 variants

| Spec | Current repo | Status |
|------|--------------|--------|
| **Collection** `VARIANT_<id>` (spec) / e.g. `rp_variants` | No variants collection; no RpVariant type | ❌ Missing |
| **Fields:** productId, optionValues (size, color), title, sku, price, compareAtPrice, weightGrams, taxable, inventoryTracked, inventoryPolicy, active, shopify.* | — | — |

**Recommendation:** Do **not** add variants collection or type in this slice. Add in a later slice when building the Variants section (size/SKU/price table). Minimum for Product Detail page is product-level fields only.

---

## 1.3 productAssets (mediaAssets) — rp_product_assets

| Spec field | Current (RpProductAsset) | Status | Notes |
|------------|---------------------------|--------|-------|
| **id, productId** | ✅ | Exists | |
| **blankId, designId, side** | designId?, (no blankId/side) | ⚠️ Extend | Add `blankId?`, `side?: "front" \| "back"` if needed for slot assignment. |
| **assetType** | `assetType: RpAssetType` | ✅ Map | We have onModelImage, productPackshot, etc.; spec has mockup, productPackshot, product_scene, model_scene, hero, detail. Align with heroSlot. |
| **source** | (jobId, generationJobId, etc.) | ⚠️ | Add `source?: "deterministic_renderer" \| "manual_upload" \| "ai_product_generation" \| "ai_model_generation"` for spec parity; optional. |
| **fileUrl** | `downloadUrl?`, `publicUrl?` | ✅ Alias | Use publicUrl or downloadUrl as fileUrl in UI. |
| **thumbnailUrl, width, height** | thumbnailPath?, width?, height? | ✅ | Exists |
| **approved** | `status: RpAssetStatus` (approved \| draft \| etc.) | ✅ Map | approved = (status === "approved"). |
| **heroSlot** | — | ❌ Missing | Add `heroSlot?: "hero_front" \| "hero_back"` so product page can assign assets to hero slots. |
| **shopify: fileId, mediaId** | — | ❌ Missing | Add later with Shopify sync; optional for this slice. |

**Recommendation:** Add only `heroSlot?: "hero_front" \| "hero_back"` to RpProductAsset in this slice. Rest when wiring Media section.

---

## 1.4 productionSpecs

| Spec | Current repo | Status |
|------|--------------|--------|
| **Collection** `PRODUCTION_<id>` | No collection; no type | ❌ Missing |
| **Fields:** productId, variantIds, blankId, printPdfFront/Back/Master, printColors, placementNotes, printerRoutingKey, packNotes, active | — | — |

**Recommendation:** Do **not** add productionSpecs collection in this slice. Store production **on the product** as `product.production` (printPdfFront, printPdfBack, printColors, productionNotes). productionSpecs can be introduced later when linking variants to production (e.g. for printer handoff).

---

## 1.5 Shopify sync status (on product)

| Spec (product.shopify) | Current | Status |
|------------------------|---------|--------|
| productId | — | ❌ Add on product |
| status: not_synced \| queued \| synced \| error | — | ❌ Add on product |
| lastSyncAt, lastSyncError | — | ❌ Add on product |

**Recommendation:** Add `shopify` object on RpProduct (see 1.1). No separate collection needed for this slice.

---

# Part 2: Recommended Minimum Schema Changes

**Scope:** Only what the Product Detail page needs for: title, handle, description, SEO, tags, collection keys, blankId, designIdFront/Back, heroFront/heroBack, printPdfFront/Back, Shopify sync status. No variants collection, no productionSpecs collection, no migration of existing data.

## 2.1 RpProduct (lib/types/firestore.ts)

**Add (all optional):**

```ts
// Merchandising (spec alignment)
title?: string;                    // display title; fallback: name
handle?: string;                   // URL handle; fallback: slug
descriptionHtml?: string;          // HTML description
descriptionText?: string;          // plain text (optional)
seo?: {
  title?: string;
  description?: string;
};
collectionKeys?: string[];        // e.g. ["mlb", "giants"]

// Design (spec: front/back)
designIdFront?: string;
designIdBack?: string;
// keep designId for primary/back compat

// Media (spec: hero slots + gallery)
media?: {
  heroFront?: string;   // URL or assetId
  heroBack?: string;
  gallery?: string[];
  modelAssets?: string[];
  lifestyleAssets?: string[];
};
// keep heroAssetId, heroAssetPath for back compat

// Production (spec)
production?: {
  printPdfFront?: string;
  printPdfBack?: string;
  printPdfMaster?: string;
  printColors?: string[];
  productionNotes?: string;
};

// Shopify sync (spec)
shopify?: {
  productId?: string;
  status?: "not_synced" | "queued" | "synced" | "error";
  lastSyncAt?: Timestamp;
  lastSyncError?: string;
};

// Optional merchandising
brand?: string;
productType?: string;
```

**Rename / normalize:** None. Keep `name` and `slug`; UI uses `title ?? name`, `handle ?? slug`.

## 2.2 RpProductAsset (lib/types/firestore.ts)

**Add:**

```ts
heroSlot?: "hero_front" | "hero_back";
```

## 2.3 Do NOT add in this slice

- variants collection or RpVariant type
- productionSpecs collection or type
- shopifySyncJobs (add when implementing sync worker)
- ordersCache (add with webhooks)

---

# Part 3: Smallest Implementation Slice (First)

**Goal:** Product Detail page supports the minimum fields and has clear section structure aligned to spec, with **Merchandising** fully wired and saved.

**Slice 1 — “Merchandising + schema”:**

1. **Schema:** Add to RpProduct and RpProductAsset the fields in § 2.1 and § 2.2.
2. **Product Detail page sections:** Organize content into five section blocks (Merchandising, Render Setup, Media, Production, Shopify) so each has a clear place. Existing “Render Setup” lives inside Generate tab — keep it there but label it; optionally add a **Merchandising** tab or a **Merchandising** block at top of Overview.
3. **Merchandising section (implement fully):**
   - Fields: Title, Handle, Description (textarea), SEO Title, SEO Description, Tags (comma or tag input), Collection keys (comma or tag input).
   - Read: `product.title ?? product.name`, `product.handle ?? product.slug`, `product.description` or `product.descriptionHtml`, `product.seo?.title`, `product.seo?.description`, `product.tags`, `product.collectionKeys`.
   - Save: Update `rp_products` with `title`, `handle`, `descriptionHtml` (or `description`), `seo`, `tags`, `collectionKeys`. Use a single update (e.g. `updateProduct` or inline `updateDoc`).
4. **Production section (placeholder):** Show “Print PDF Front/Back, print colors, production notes” as read-only or simple inputs that write to `product.production`. No file upload yet if out of scope.
5. **Shopify section (read-only):** Show `product.shopify?.status`, `product.shopify?.lastSyncError`, “Open in Shopify” link if productId exists. Buttons “Push to Shopify” / “Publish” disabled or hidden until sync is built.
6. **Media / hero slots:** In Assets tab, add “Set as hero front” / “Set as hero back” that set `product.media.heroFront` / `product.media.heroBack` to that asset’s URL (or asset id) and optionally set asset `heroSlot`. Display current hero front/back in Overview or Media section.

**Smallest first deliverable:** Schema changes + **Merchandising section** (form + save). Then Production (form + save), then Media hero slots, then Shopify read-only.

---

# Part 4: Concrete Files / Components / Functions to Touch

## 4.1 Schema (this slice)

| File | Change |
|------|--------|
| `lib/types/firestore.ts` | Add to `RpProduct`: title, handle, descriptionHtml, descriptionText, seo, collectionKeys, designIdFront, designIdBack, media, production, shopify, brand, productType. Add to `RpProductAsset`: heroSlot. |

## 4.2 Product Detail page — sections and Merchandising

| File | Change |
|------|--------|
| `app/products/[slug]/page.tsx` | 1) Add Merchandising block (form: title, handle, description, SEO title/description, tags, collection keys; save to product). 2) Use `product.title ?? product.name` in header. 3) Add Production block (inputs for printPdfFront, printPdfBack, printColors, productionNotes → product.production). 4) Add Shopify block (read-only status, lastSyncError, “Open in Shopify” link). 5) In Assets tab, add “Set as hero front” / “Set as hero back” and persist to product.media and optionally asset.heroSlot. 6) Ensure Render Setup remains in Generate tab and is labeled as “Render Setup”. |

## 4.3 Hooks / mutations

| File | Change |
|------|--------|
| `lib/hooks/useRPProducts.ts` | No change if product update is done via generic update (e.g. `updateDoc` in page or existing mutation). |
| `lib/hooks/useRPProductMutations.ts` | Add or extend `updateProduct(productId, partial)` to accept new fields (title, handle, descriptionHtml, seo, tags, collectionKeys, production, media, shopify) so the page can call a single update. |

## 4.4 Functions (Cloud)

| File | Change |
|------|--------|
| `functions/index.js` | None for this slice. When product is updated from UI, no function required. Mock job and product update (mockupUrl) already use productId; ensure any new product fields are not stripped by sanitization if you add server-side product update later. |

## 4.5 Optional new component

| File | Change |
|------|--------|
| `app/products/[slug]/components/ProductMerchandisingForm.tsx` (new) | Extract Merchandising form into a component: title, handle, description, SEO title/description, tags, collection keys; onSubmit calls updateProduct. Reusable and keeps page.tsx smaller. |

---

# Part 5: Section Wiring Summary (Product Detail Page)

| Section | Location | Minimum wiring |
|---------|----------|----------------|
| **Merchandising** | New block on Overview tab (or dedicated “Merchandising” tab) | Form: title, handle, description, SEO title/description, tags, collection keys. Save to product. |
| **Render Setup** | Already in Generate tab | Keep as-is. Uses blankId, designId (or designIdFront/Back when we add), renderConfig, placementOverride. |
| **Media** | Assets tab + Overview/Media block | Hero slots: “Set as hero front/back” → product.media.heroFront/heroBack; show current hero images. |
| **Production** | New block (Overview or new tab) | Form: printPdfFront, printPdfBack, printColors, productionNotes. Save to product.production. |
| **Shopify** | New block (Overview or new tab) | Read-only: shopify.status, shopify.lastSyncError, “Open in Shopify” link. Buttons disabled until sync. |

---

# Part 6: Concrete Files Touched (Implemented)

| File | Change |
|------|--------|
| `lib/types/firestore.ts` | Added to RpProduct: title, handle, descriptionHtml, descriptionText, seo, collectionKeys, brand, productType, designIdFront, designIdBack, media{}, production{}, shopify{}. Added to RpProductAsset: heroSlot. |
| `app/products/[slug]/page.tsx` | Header uses product.title ?? product.name and product.handle ?? product.slug. Added Merchandising section (form + save). Added Production section (form + save). Added Shopify section (read-only status, lastSyncError, Open in Shopify link). Added Media section (display hero front/back; assign in Assets). AssetsTab: added onSetHeroSlot prop and "Hero front" / "Hero back" buttons; parent implements updateDoc on product.media and asset.heroSlot. |

**Note:** The "Open in Shopify" link uses a placeholder store path; replace `YOUR_STORE` with your Shopify admin store identifier or use an env var (e.g. `NEXT_PUBLIC_SHOPIFY_STORE`) when implementing sync.

---

# End of Mapping

**Done in this pass:** Schema changes (§ 2.1, 2.2), Merchandising + Production + Shopify + Media sections wired, hero slot assignment in Assets tab. **Next:** Variants section (size/SKU/price table) when needed; Shopify sync worker and "Push to Shopify" when implementing Step 4.
