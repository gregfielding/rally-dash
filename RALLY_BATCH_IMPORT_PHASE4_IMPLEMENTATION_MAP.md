# Phase 4 Batch Hero Render — Repo Mapping & Implementation Plan

This document maps **RALLY_BATCH_IMPORT_PHASE4_BATCH_HERO_RENDER_SPEC.md** to the current repo and describes the job model, files touched, and smallest implementation slice.

---

## 1. Renderer pieces that already exist (reused)

| Spec requirement | Current repo | Reuse |
|------------------|--------------|--------|
| **Deterministic pipeline** (§4) | `functions/index.js`: **onMockJobCreated** (Firestore trigger on `rp_mock_jobs/{jobId}` onCreate) | **Full reuse.** Pipeline: fetch blank + design PNG → crop design to artwork bounds → scale to placement → optional fabric mask → blend + opacity → composite → export PNG. No diffusion/AI. |
| **Explicit URLs** | `createMockJob` accepts **blankImageUrl**, **designPngUrl**, **placementOverride** (and resolves from blank/design if omitted) | **Reuse.** Batch Hero passes URLs from `renderSetup.front` / `renderSetup.back` so product-level config drives the render. |
| **Per-side (front/back)** | Jobs have **view: "front" \| "back"**; worker uses it for placement and blank image selection | **Reuse.** One job per product+side. |
| **Product-linked output** | When **productId** is set, worker already writes `product.mockupUrl` and product mockup to Storage | **Extended.** When **heroSlot** is set, worker also creates `rp_product_assets` doc and sets `product.media.heroFront` or `product.media.heroBack`. |

**Conclusion:** No new renderer implementation. The existing deterministic mock pipeline is reused; only the **output** behavior is extended (hero asset + media slot) when `heroSlot` is present on the job.

---

## 2. Job model

| Spec (§10) | Choice |
|------------|--------|
| **Reuse vs new collection** | **Reuse existing mock job system** with a clear “hero” mode. |
| **Collection** | **rp_mock_jobs** (unchanged). |
| **Job payload** | Existing: `designId`, `blankId`, `view`, `quality`, `productId`, `input: { blankImageUrl, designPngUrl, placement }`. **Added:** `heroSlot: "hero_front" \| "hero_back" \| null`. When `productId` + `heroSlot` are set, completion creates product asset and updates `product.media`. |
| **Status flow** | Unchanged: `queued` → `processing` → (on success) job completes; worker creates draft mock asset, then if `heroSlot` creates product asset and updates product. No separate “succeeded” doc field required; success is implied by completion. |
| **Overwrite** | Not stored on the job. Handled in the **UI**: “skip if hero exists” vs “replace” controls whether the client enqueues a job for that product+side. |

So: **one rp_mock_jobs document per requested (product, side)**; job model = existing mock job + optional `heroSlot`; overwrite is client-side only.

---

## 3. Files / components / functions touched

| Area | File(s) | Change |
|------|---------|--------|
| **Firestore types** | `lib/types/firestore.ts` | Already has `RpProductAsset.heroSlot`, `RpProduct.media.heroFront` / `heroBack`. No change. |
| **Mock job API** | `functions/index.js` | **createMockJob:** accept optional `heroSlot`; persist on job. **onMockJobCreated:** when `job.productId` and `job.heroSlot` set: write hero image to Storage, add `rp_product_assets` doc (productId, designId, blankId, assetType, presetMode, status, heroSlot, publicUrl, …), merge-update `product.media.heroFront` / `heroBack`. |
| **Client job input** | `lib/hooks/useMockAssets.ts` | **CreateMockJobInput:** add optional `heroSlot?: "hero_front" \| "hero_back"`. |
| **Batch Hero UI** | **New:** `app/products/batch-hero/page.tsx` | Product list (from `useProducts`), checkboxes, filters (e.g. missing hero front/back), options (sides: front/back/both; overwrite: skip/replace). Validation (eligible per §5). Run: for each selected product+side call `createMockJob` with `productId`, `view`, `blankImageUrl`, `designPngUrl`, `placementOverride`, `heroSlot`. Results table: product, side, action (created / skipped existing / skipped ineligible / failed), detail. |
| **Products entry** | `app/products/page.tsx` | Link/button: **Batch Hero Render** → `/products/batch-hero`. |

Optional later (not in smallest slice):

- Filter by blank / team / design family (client-side or indexed queries).
- “Mark as rendered” product status when all requested sides succeed.
- Results: link to created asset (requires storing assetId in results or refetching by productId + heroSlot).

---

## 4. Smallest implementation slice to get Batch Hero Render working

1. **Backend (functions)**  
   - In **createMockJob:** read optional `heroSlot`; validate `"hero_front"` \| `"hero_back"`; store on job.  
   - In **onMockJobCreated:** after saving draft composite and (if `productId`) product mockup:  
     - If `job.heroSlot === "hero_front"` or `"hero_back"`:  
       - Save hero image to e.g. `products/{productId}/hero/{view}/{timestamp}.png`.  
       - Create `rp_product_assets` doc (productId, jobId, designId, blankId, assetType: `"productPackshot"`, presetMode: `"productOnly"`, status: `"approved"`, heroSlot, publicUrl, …).  
       - Update `product.media` (merge existing media; set only the corresponding `heroFront` or `heroBack`).

2. **Client (hook)**  
   - Add **heroSlot** to **CreateMockJobInput** and pass it through to the callable.

3. **Batch Hero page**  
   - **New** `app/products/batch-hero/page.tsx`:  
     - Load products (`useProducts`).  
     - Options: sides (front / back / both), overwrite (skip existing / replace).  
     - Quick filters: e.g. “Missing hero front”, “Missing hero back”.  
     - Table: checkbox, product (link), Front ready, Back ready, Hero front, Hero back, Missing.  
     - Eligibility: §5 (blankImageUrl, designAssetUrl, placementKey or placementOverride per side).  
     - Run: for each selected product and requested side, if eligible and (overwrite or no existing hero), call `createMockJob` with `productId`, `view`, URLs from renderSetup, `placementOverride`, `heroSlot`.  
     - Results: summary counts + table (product, side, action, detail).

4. **Entry point**  
   - On Products page, add a **Batch Hero Render** button linking to `/products/batch-hero`.

**Out of slice for MVP:**  
- Filter by blank/team/design family.  
- “Mark as rendered” status.  
- Asset link in results (can add once assetId is known or refetched).  
- Optional `renderSignature` on assets (§13).

---

## 5. Status: already implemented

Phase 4 is **already implemented** in this repo:

- **createMockJob** accepts and stores **heroSlot**; **onMockJobCreated** creates the hero asset and updates **product.media.heroFront** / **heroBack** when **productId** + **heroSlot** are set.  
- **CreateMockJobInput** includes **heroSlot**.  
- **app/products/batch-hero/page.tsx** implements product selection, validation, options (sides + overwrite), quick filters, run batch, and per-product/per-side results.  
- Products page has a **Batch Hero Render** link to `/products/batch-hero`.

If you want to extend the implementation, the next useful additions are:

- **Filters:** by blank, team, design family (e.g. from product tags or `productIdentityKey`).  
- **Optional:** “Mark products as rendered” when all requested hero sides succeed.  
- **Results:** link to the created asset (e.g. by refetching assets for productId and matching heroSlot, or by returning assetId from a follow-up read after jobs complete).
