# Phase 1 Verification: Giants Heather Grey

**Product:** Giants Heather Grey (or equivalent product with design + blank)  
**Goal:** Confirm the product-only path works end-to-end with real blank, design, placement/mask, and no identity/model artifacts.

---

## Checklist

- [ ] **1. Generate mockup**  
  - "Generate mockup" runs successfully.  
  - `product.mockupUrl` is populated (e.g. in Firestore `rp_products/<productId>` or in UI when product loads).

- [ ] **2. Product Images mode**  
  - Product Images sub-tab appears under Generate.  
  - Form shows product-only presets (e.g. Ecommerce White), Image Count, Image Size — no Identity/Face/Body fields.

- [ ] **3. Ecommerce White → product_only job**  
  - Select Ecommerce White (or Ecommerce Flat), set count/size, submit.  
  - A generation job is created (success toast / job appears in list or Firestore).

- [ ] **4. Firestore job doc** (`rp_generation_jobs/<jobId>`)  
  - `generationType`: `"product_only"`  
  - `presetMode`: `"productOnly"`  
  - `inputImageUrl`: set (product mockup URL)  
  - No `identityId`, `faceArtifactId`, or `bodyArtifactId` (or they are null/absent).  
  - No field has value `undefined`.

- [ ] **5. Resulting asset** (after job completes)  
  - `assetType`: `"productPackshot"`  
  - `presetMode`: `"productOnly"`.

- [ ] **6. Visual check**  
  - Final image uses the **actual heather grey blank** and **Giants design** (placement/mask), not generic placeholder imagery.

---

## Outcome

- **All 6 pass** → Phase 1 is functionally proven. Next: quality tuning and product-scene improvements.  
- **Any fail** → Note which step and what you see (e.g. wrong assetType, missing inputImageUrl, placeholder image); we can fix and re-verify.
