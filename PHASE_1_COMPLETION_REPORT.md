# Phase 1 Completion Report: Product-Only Flat Images

**Date:** 2025-02-20  
**Goal:** Prove Rally can generate a flat product image from blank + design + placement + mask, without identity/model generation, with output suitable to compare to the Photoshop reference.

---

## 1. Checklist Items Completed

### Backend (`functions/index.js`)

- **Guardrails**
  - `generateProductAssets` rejects `product_only` jobs that include `identityId`, `faceArtifactId`, or `bodyArtifactId`.
  - Product-only generation now **requires** `product.mockupUrl`; if missing, the callable throws `failed-precondition` with message: *"Product must have a mockup before generating product-only images. Run \"Generate mockup\" first."*

- **Job document**
  - Generation job now stores `inputImageUrl: product.mockupUrl` so the worker always has the mockup URL on the job (no need to re-fetch product for that).
  - `sanitizeForFirestore(jobData)` already used for all `rp_generation_jobs` writes.

- **Mock job**
  - `createMockJob` now sanitizes payload with `sanitizeForFirestore(jobData)` before `rp_mock_jobs.add(sanitized)` so no `undefined` is written.
  - Mock completion (onMockJobCreated) already writes to `products/{productId}/mockup.png` and sets `product.mockupUrl` (unchanged).

- **Prompt / resolver / asset type**
  - Already in place: `resolvePromptWithGuardrails` productOnly branch; job → asset with `assetType: "productPackshot"` and `presetMode: "productOnly"`.

### Frontend (`app/products/[slug]/page.tsx`)

- **Product Images mode**
  - `handleGenerate` sends `generationType: "product_only"` (via presetMode) and no identity/artifact IDs when `isProductOnly`; preset list is filtered to product-only only.
  - Hardcoded fallback presets: first preset has explicit `mode: "productOnly"` so "Ecommerce White" appears in Product Images even if Firestore presets are not loaded.
  - After **Generate mockup**, the page polls `refetchProduct()` every 5s (up to 2 min) so when the backend sets `product.mockupUrl`, the product-only form appears without a manual refresh.

### Types

- `lib/types/firestore.ts`: `RpGenerationType`, `RpScenePresetMode`, and job/preset types already align with `product_only` / `productOnly`; no code change.

---

## 2. Remaining Blockers / Notes

1. **Seed script must be run with Firebase credentials**  
   `node scripts/seed-scene-presets.js` from `functions/` failed locally with: *"Unable to detect a Project Id in the current environment."*  
   **Action:** Run from a machine/environment where Firebase is configured (e.g. `firebase use <projectId>` or `GOOGLE_APPLICATION_CREDENTIALS`). Until then, the **hardcoded fallback** "Ecommerce White" (with `mode: "productOnly"`) is used in Product Images, so the flow is testable without seed.

2. **E2E verification not run in this session**  
   Full E2E (create product → generate mockup → generate product-only image → confirm Firestore and asset type) was not run here (no browser automation; seed requires your Firebase project).  
   **Action:** Follow the **Verification (manual)** steps in `PHASE_1_CHECKLIST_FLAT_PRODUCT_IMAGES.md` in your environment.

3. **Image quality**  
   Phase 1 success is “Rally beats Photoshop for flat product images.” That may require prompt/negative-prompt or mask/resolution tuning after the first runs; treat as follow-up once the pipeline is verified.

4. **Other job creation paths**  
   If batch or other code creates `rp_generation_jobs` directly, ensure they use `sanitizeForFirestore` before write (only the callable and `createGenerationJob` were updated).

---

## 3. What to Verify (and Where to Look)

- **Create a product** from Design + Blank (or use an existing one).
- **Generate tab → Product Images** → click **Generate mockup**. Wait 30–60s; the form should appear when the mockup is ready (product poll).
- **Select a product-only preset** (e.g. "Ecommerce White" or, after seed, "Ecommerce Flat (White Background)"), set count/size, submit.
- **Firestore**
  - `rp_generation_jobs/<jobId>`: `generationType: "product_only"`, `presetMode: "productOnly"`, `inputImageUrl` = product mockup URL; no `identityId` / `faceArtifactId` / `bodyArtifactId`; no field value `undefined`.
  - After job completes: `rp_assets` (or your asset collection) should have an asset with `assetType: "productPackshot"`, `presetMode: "productOnly"`.
- **Console / logs**
  - On submit you should see logs like `[handleGenerate] Generation type: product_only` and `[generateProductAssets] Creating job:` with no identity/artifact IDs.
  - No Firestore errors about `undefined` in request payloads.

---

## 4. Summary

| Item | Status |
|------|--------|
| Backend guardrails (product_only + mockup required) | Done |
| inputImageUrl on job; sanitize mock job payload | Done |
| Frontend Product Images wiring + product poll after mock | Done |
| Phase 1 checklist updated | Done |
| Seed script run | Blocked on Firebase credentials (use fallback preset) |
| E2E run (screenshots/logs) | Left for you to run in your env |

The product-only path is implemented and ready for you to run end-to-end: **blank + design + placement + mask → mockup → product-only generation** with no identity/LoRA, and output typed as `productPackshot` for comparison to the Photoshop reference.
