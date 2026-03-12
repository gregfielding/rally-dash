# Phase 1 Checklist: Rally Beats Photoshop for Flat Product Images

**Goal:** Rally can produce white-background, product-only (flat) images that match or exceed the quality of the reference Photoshop mockup, with minimal manual steps.

---

## Scope

- **In scope:** Product-only generation path (blank + design + placement + mask → mockup → product scene with Ecommerce Flat preset). No identity/LoRA required. Payloads safe for Firestore.
- **Out of scope for Phase 1:** Model images, MLB automation, realism-pass tuning, other scene presets.

---

## Code / File-Level Tasks

### 1. Generate UI and modes ✅ (done)

- **`app/products/[slug]/page.tsx`**
  - [x] Generate tab split into **Product Images** (default) and **Model Images** sub-tabs.
  - [x] Product Images: no Identity / Face / Body LoRA fields; only product-only presets, Image Count, Image Size (and any product-only preset params).
  - [x] Model Images: full identity/artifact form; submit disabled when `!product.mockupUrl`; banner when no mockup.
  - [x] “Generate mockup” when product has design + blank but no mockup; calls `createMockJob(designId, blankId, productId)`.

### 2. Ecommerce Flat preset ✅ (done)

- **`functions/scripts/seed-scene-presets.js`**
  - [x] Preset **“Ecommerce Flat (White Background)”** with `mode: "productOnly"`, slug `ecommerce-flat-white`, `supportedModes: ["product_only"]`.
- **Firestore**
  - [ ] Run seed so preset exists: from `functions/`, `node scripts/seed-scene-presets.js` (or equivalent for your env).

### 3. Payload sanitization ✅ (done)

- **`functions/index.js`**
  - [x] `sanitizeForFirestore(value)` recursively strips `undefined` (omit keys in objects, `null` in arrays); leaves Timestamps and non-plain objects (e.g. `FieldValue.serverTimestamp()`) unchanged.
  - [x] `generateProductAssetsImpl` and `createGenerationJob` use `sanitizeForFirestore(jobData)` before writing to `rp_generation_jobs`.

### 4. Backend product-only flow

- **`functions/index.js`**
  - [x] **Guardrails:** `generateProductAssets` rejects `product_only` jobs that include `identityId` / `faceArtifactId` / `bodyArtifactId`. Product-only also requires `product.mockupUrl` (fail with failed-precondition if missing).
  - [x] **Prompt/resolver:** For `generationType === "product_only"`, no identity/face/body LoRAs attached; `resolvePromptWithGuardrails` productOnly branch used.
  - [x] **Job → asset:** When processing a `product_only` job, asset is written with `assetType: "productPackshot"` and `presetMode: "productOnly"`.
  - [x] **inputImageUrl:** Job document stores `inputImageUrl: product.mockupUrl` so worker uses mockup as input.

### 5. Mock job → product mockup

- **`functions/index.js`** (onMockJobCreated / mock job completion)
  - [x] When mock job completes and `job.productId` is set: save final image to `products/{productId}/mockup.png` and set `product.mockupUrl`.
  - [x] Mock job payload is sanitized with `sanitizeForFirestore(jobData)` before writing to `rp_mock_jobs`.

### 6. Frontend wiring

- **`app/products/[slug]/page.tsx`**
  - [x] Product Images mode: `handleGenerate` sends `generationType: "product_only"` (via presetMode) and no identity/artifact IDs when `isProductOnly`; selected preset is product-only only.
  - [x] Preset list in Product Images mode: filter to presets where `mode === "productOnly"` or `supportedModes?.includes("product_only")`. Hardcoded fallback includes Ecommerce White with `mode: "productOnly"`.
  - [x] After "Generate mockup", product is polled so when `product.mockupUrl` is set the form appears without manual refresh.
- **`lib/hooks/useRPProductMutations.ts`** (or wherever generation is triggered)
  - [x] For product-only: `identityId` and face/body artifacts only sent when `isOnModel`; `generationType` derived from preset mode.

### 7. Types and consistency

- **`lib/types/firestore.ts`**
  - [ ] `RpGenerationType`, `RpScenePresetMode`, and job/preset types align with `product_only` / `productOnly` (already present; no change if already correct).

---

## Remaining Blockers / Risks

1. **Preset in Firestore:** Ecommerce Flat must exist in `rp_scene_presets` (or equivalent). Run seed script if not already run.
2. **Image quality bar:** Phase 1 success is “Rally beats Photoshop for flat product images.” That may require tuning prompt/negative prompt, mask strictness, or resolution for the product_only pipeline; track as follow-up if first runs are close but not there.
3. **Mock job dependency:** Product Images flow depends on mock job producing a good base image (blank + design + placement + mask). If that step is weak, product-only scene output will be limited; consider listing “mock job quality” as a Phase 1 verification step.
4. **Undefined in other job types:** Sanitization is applied in the paths you updated; if other code paths create `rp_generation_jobs` (e.g. batch, scheduled), ensure they also use `sanitizeForFirestore` before write.

---

## Verification (manual)

- [ ] Create a product from Design + Blank; run “Generate mockup”; wait for completion; confirm `product.mockupUrl` is set.
- [ ] In Generate → Product Images, select “Ecommerce Flat (White Background)”, set count/size, submit; confirm job is created with `generationType: "product_only"` and no identity/artifact fields.
- [ ] In Firestore, open the created job doc; confirm no field has value `undefined`.
- [ ] When job completes, confirm asset is stored and tagged as product-only (e.g. `productPackshot` / `presetMode: "productOnly"`).
- [ ] Compare one generated flat product image to the Photoshop reference; note whether Phase 1 quality bar is met or what’s left to tune.

---

## Summary

| Area                | Status   | Notes                                                                 |
|---------------------|----------|-----------------------------------------------------------------------|
| Generate UI split   | Done     | Product vs Model modes; no identity in Product.                      |
| Ecommerce Flat      | Done     | In seed script; run seed for Firestore (or use hardcoded fallback).   |
| Payload sanitize    | Done     | Recursive; mock + generation jobs; safe for FieldValue.              |
| Backend guardrails  | Done     | product_only requires mockup; rejects identity/artifacts.            |
| Job → asset typing  | Done     | productPackshot / presetMode productOnly.                            |
| Mock → mockupUrl   | Done     | onMockJobCreated writes product mockup; createMockJob sanitized.     |
| Frontend wiring     | Done     | Product Images sends product_only; product poll after mock.            |
| Phase 1 checklist   | This doc | Code/file tasks + blockers + verification steps.                      |

Next: run seed (if needed), run through verification list, then iterate on product_only prompt/quality until “Rally beats Photoshop for flat product images” is achieved.
