# Rally × Spec Alignment Mapping (Steps 1–3)

**Purpose:** Map the current codebase against RALLY_X_SHOPIFY_ARCHITECTURE_PART_2.md for:
1. Deterministic renderer + product/blank schema
2. Product data model normalization
3. Product Detail page sections (Merchandising, Render Setup, Media, Production, Shopify)

**Reference:** RALLY_X_SHOPIFY_ARCHITECTURE_PART_2.md §§ 3 (Firestore), 8 (Dashboard UI).

---

# 1. Deterministic Renderer + Product/Blank Schema

## 1.1 What Already Exists

| Area | Current state |
|------|----------------|
| **Renderer pipeline** | `onMockJobCreated` (functions): load blank → fetch design PNG → crop to artwork bounds → scale to placement box → blur/saturate → (optional) fabric mask → opacity → composite with blend (overlay) → save draft + product mockup. Matches Phase 1 spec (deterministic, no AI in Stage A). |
| **createMockJob** | Accepts `designId`, `blankId`, `view`, `placementId`, optional `blankImageUrl`, `designPngUrl`, `placementOverride`. Reads blank + design from Firestore; merges placement with blank placements and design placement defaults; creates job in `rp_mock_jobs`. |
| **Placement** | Supports (1) **printArea path**: when blank placement has `printArea: { x, y, width, height }`, art box = that box × scale; (2) **legacy path**: safeArea + scale, center at (x,y). User override (x, y, scale) applied; design centered in art box. |
| **Blanks** | `RPBlank` in `rp_blanks`: blankId, slug, status, supplier, styleCode, styleName, colorName, images.{front, back}, **placements[]** (placementId, label, defaultX, defaultY, defaultScale, safeArea). Used by renderer and product page. |
| **Blanks – printArea** | **Not in type:** `RPPlacement` has no `printArea`. Renderer uses `blankPlacement.printArea || {}`; when missing, width/height are undefined so **legacy path** is used (safeArea + scale). So renderer works; printArea is optional enhancement. |
| **Designs** | `DesignDoc` in `designs/`: used for mock (files.png, placementDefaults). Separate from `rp_product_designs` (product-linked design records). Mock flow uses `designs/` + design PNG URL. |
| **Product → render** | `RpProduct`: `blankId`, `designId` (single), `renderConfig` (renderSide, selectedBlankId, selectedBlankImageUrl, selectedDesignImageUrl, placementOverride). Mock job writes `products/{productId}/mockup.png` and sets `product.mockupUrl`. |

## 1.2 Schema Changes Needed (Step 1)

| Change | Where | Notes |
|--------|--------|------|
| **Add optional `printArea` to blank placements** | `lib/types/firestore.ts` → `RPPlacement` | Add `printArea?: { x: number; y: number; width: number; height: number }` (normalized 0–1). Backward compatible; renderer already handles absence. |
| **Blanks UI / seed** | `app/blanks/[blankId]/page.tsx`, `functions` getDefaultPlacements / createBlank | Optionally allow editing printArea per placement; or derive from safeArea (e.g. width = safeArea.w, height = safeArea.h, x/y from safeArea). Not required for renderer to work. |
| **Spec blend/opacity on placement** | Already in renderer | Renderer uses `placement.blendMode` (default overlay), `placement.blendOpacity` (0.87). Blank placement can override; type already allows it if we add blendMode/blendOpacity to RPPlacement. |

**Conclusion (Step 1):** Renderer is aligned. Only additive schema: `RPPlacement.printArea` (optional) and optionally `blendMode`/`blendOpacity` on `RPPlacement` for spec parity. No breaking changes.

---

# 2. Product Data Model (Step 2)

## 2.1 Spec (Part 2 § 3.3) vs Current RpProduct

| Spec field | Current RpProduct | Gap |
|------------|-------------------|-----|
| **title** | `name` | Alias or add `title`; prefer adding `title`, keep `name` for backward compat or migrate. |
| **handle** | `slug` | Same intent; can alias `handle` = `slug` or add `handle` and sync. |
| **descriptionHtml / descriptionText** | `description?: string` | Add `descriptionHtml`, `descriptionText` or keep single `description` and use for both until Shopify sync. |
| **seo: { title, description }** | — | Missing. Add `seo?: { title?: string; description?: string }`. |
| **tags** | `tags?: string[]` | Exists. |
| **collectionKeys** | — | Missing. Add `collectionKeys?: string[]`. |
| **heroFront / heroBack** | `heroAssetId`, `heroAssetPath` (single hero) | Spec wants separate hero_front + hero_back. Add `media?: { heroFront?: string; heroBack?: string; gallery?: string[]; modelAssets?: string[]; lifestyleAssets?: string[] }` or at least heroFront/heroBack URLs. |
| **blankId** | `blankId?: string` | Exists. |
| **designIdFront / designIdBack** | `designId?: string` (single) | Spec has front/back. Add `designIdFront?`, `designIdBack?`; keep `designId` for “primary” or current single-design flow. |
| **production: printPdfFront, printPdfBack, printColors, productionNotes** | — | Missing. Add `production?: { printPdfFront?: string; printPdfBack?: string; printPdfMaster?: string; printColors?: string[]; productionNotes?: string }`. |
| **shopify: productId, status, lastSyncAt, lastSyncError** | — | Missing. Add `shopify?: { productId?: string; status?: 'not_synced' \| 'queued' \| 'synced' \| 'error'; lastSyncAt?: Timestamp; lastSyncError?: string }`. |
| **status** | `status: RpProductStatus` (draft \| active \| archived) | Exists; spec also has "approved" \| "published". Consider adding "published" or map active → published. |
| **pricing / shipping** | — | Spec has pricing (basePrice, compareAtPrice, currencyCode), shipping (defaultWeightGrams, requiresShipping). Add when needed for Shopify sync. |

## 2.2 Schema Changes Summary (Step 2)

**Add to RpProduct (all optional for backward compatibility):**

- `title?: string` (and/or treat `name` as title in UI)
- `handle?: string` (and/or alias to `slug`)
- `descriptionHtml?: string`, `descriptionText?: string`
- `seo?: { title?: string; description?: string }`
- `collectionKeys?: string[]`
- `media?: { heroFront?: string; heroBack?: string; gallery?: string[]; modelAssets?: string[]; lifestyleAssets?: string[] }`
- `designIdFront?: string`, `designIdBack?: string`
- `production?: { printPdfFront?: string; printPdfBack?: string; printPdfMaster?: string; printColors?: string[]; productionNotes?: string }`
- `shopify?: { productId?: string; status?: string; lastSyncAt?: Timestamp; lastSyncError?: string }`

**Migration:** Existing docs unchanged. New fields populated by UI and sync; `name`/`slug` can be shown as title/handle until fields are set.

---

# 3. Product Detail Page Sections (Step 3)

## 3.1 Spec Sections vs Current UI

| Spec section | Current state | Exists? |
|--------------|----------------|--------|
| **A — Merchandising** | Overview tab: name, status, category, baseProductKey, colorway, description, AI trigger/scale. No: title, handle, brand, product type, tags, collection keys, SEO title/description. | Partial |
| **B — Render Setup** | Inside **Generate** tab: blank selector, design selector, side (front/back), “Edit placement”, master composite preview, “Generate mockup”, “Regenerate mockup”. Matches spec. | Yes |
| **C — Media** | **Assets** tab: grid of assets, approve, delete, add to collection. No: hero_front / hero_back **slots**, “assign hero slot”, gallery/on-model/lifestyle slots, “push to Shopify”. | Partial |
| **D — Variants** | No size/SKU/price table. No variants collection or subcollection. Spec expects editable size table (size, SKU, price, compare-at, weight, inventory, active). | Missing |
| **E — Production** | No section. Spec: front PDF, back PDF, print colors, production notes, printer routing, production spec version. | Missing |
| **F — Shopify** | No section. Spec: Shopify product id, variant ids, last sync, sync status/error, open in Shopify, push update, publish/unpublish. | Missing |

**Current tabs:** Overview | Designs | Assets | Inspiration | Generate | Settings.

## 3.2 What Can Be Implemented Now (Before Shopify Sync)

- **Section A (Merchandising):** Yes. Add fields to product (title, handle, description, SEO, tags, collection keys) and a dedicated “Merchandising” block or tab with form + save. Can reuse Overview or add a “Merchandising” sub-section/tab.
- **Section B (Render Setup):** Done. Already in Generate tab; can move to its own tab “Render Setup” for spec alignment if desired.
- **Section C (Media):** Partially. Add hero slot concept: `media.heroFront`, `media.heroBack`; UI to “Set as hero front/back” from assets and show which asset is in which slot. Gallery/model/lifestyle can be lists of URLs or asset IDs; “push to Shopify” disabled until Step 4.
- **Section D (Variants):** Can implement **structure only**: add `variants` to RpProduct (array of { size, sku, price, compareAtPrice, weight, … }) or create `rp_variants` collection and a simple size/SKU/price table with save. No Shopify variant sync until Step 4.
- **Section E (Production):** Yes. Add Production block: production PDFs (front/back/master), print colors, production notes, printer routing. Persist to `product.production`. No printer handoff until Step 5.
- **Section F (Shopify):** **Read-only** can be implemented now: show `product.shopify` (productId, status, lastSyncAt, error). “Open in Shopify” link if productId exists. “Push update” / “Publish” buttons can be disabled or no-op until Step 4.

## 3.3 Suggested Section Order for Implementation

1. **Merchandising** — Add schema fields + form (title, handle, description, SEO, tags, collection keys). Smallest slice: one form, one save path.
2. **Production** — Add `production` object + form (PDFs, print colors, notes). No backend beyond Firestore.
3. **Media slots** — Add hero front/back assignment in Assets tab; persist to `media.heroFront` / `media.heroBack`.
4. **Variants (table)** — Add variants array or collection + editable size/SKU/price table.
5. **Shopify (read-only)** — Show sync status and “Open in Shopify”; enable actions in Step 4.

---

# 4. Smallest Next Implementation Slice

**Recommended first slice:** **Product schema normalization (Step 2) + Merchandising section (Section A).**

1. **Schema (lib/types/firestore.ts)**  
   Add to `RpProduct` (optional):  
   `title`, `handle`, `descriptionHtml`, `descriptionText`, `seo`, `collectionKeys`, `media`, `designIdFront`, `designIdBack`, `production`, `shopify` as above.

2. **Product detail – Merchandising block**  
   - In product page (e.g. Overview tab or new “Merchandising” area): form with Title, Handle, Description (HTML or plain), SEO Title, SEO Description, Tags, Collection keys (e.g. comma-separated or tag input).  
   - On save: update product in Firestore with new fields. Use `title ?? name`, `handle ?? slug` for display when new fields are empty.

3. **No changes to renderer or blanks** for this slice (renderer already aligned; blank printArea can be a follow-up).

**Second slice:** Add **Production** section (Section E): `production` object + form (print PDF URLs, print colors, production notes), save to `product.production`.

**Third slice:** Add **Media** hero slots: in Assets tab, “Set as hero front” / “Set as hero back” writing to `product.media.heroFront` / `product.media.heroBack`, and show current hero front/back in Overview or Media section.

---

# 5. Summary Table

| Step | What exists | Schema changes | UI sections to add |
|------|-------------|----------------|--------------------|
| **1. Renderer + schema** | Renderer done; blanks have placements (no printArea in type) | Add optional `printArea` (and optionally blend) to `RPPlacement` | — |
| **2. Product model** | name, slug, description, tags, blankId, designId, renderConfig, mockupUrl, heroAssetId/Path | Add title, handle, seo, collectionKeys, media, designIdFront/Back, production, shopify | — |
| **3. Product Detail** | Overview, Designs, Assets, Inspiration, Generate (incl. Render Setup), Settings | — | A Merchandising (form), C Media (hero slots), D Variants (table), E Production (form), F Shopify (read-only then actions) |

**Smallest next slice:** Extend RpProduct with spec fields (optional) + add Merchandising section (title, handle, description, SEO, tags, collection keys) with save.
