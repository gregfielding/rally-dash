# Phase 3: Product Generation from Imported Designs — Pre-Implementation

This document answers the three questions that should be decided before implementing optional product generation from batch-imported designs.

---

## 1. Product-generation inputs needed

- **Design selection**
  - **Option A (filter):** Design family + league + variant (e.g. `WILL_DROP_FOR`, `MLB`, `LIGHT`) → yields all designs with that `importKey` pattern (one per team/side). User then picks which of those to turn into products.
  - **Option B (explicit):** User selects specific design(s) from a list (e.g. from the Batch Import results or Design Library filtered by `importKey` / batch fields).
  - **Option C (from import):** “Create products from this import” — use the same grouped set that was just imported (same `grouped` keys), optionally filtered by family/league/variant.

- **Blank(s)**  
  At least one **blankId**. Required so the product has a garment and so we can resolve **blank front/back image URLs** for `renderSetup`.

- **Optional (for later model/mockup generation)**  
  Identity IDs, scene preset, images-per-product. Not required for *creating* the product record; only for running mockup or on-model generation after products exist.

**Recommended minimum for Phase 3:**  
Design selection (filter or selection over imported designs) + **one or more blankIds**. One product is created per **(design, blank)** pair (or per design if we restrict to one blank).

---

## 2. How imported designs map to front vs back product fields

- Each **imported design** has **one side** in its key: `supportedSides: [side]` (e.g. `["front"]` or `["back"]`), from the filename token `SIDE` in `LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT`.

- **Mapping rule:**
  - Design with `supportedSides: ["front"]` (and design PNG URL) → set product **designIdFront**, and **renderSetup.front** design + placement.
  - Design with `supportedSides: ["back"]` → set **designIdBack** and **renderSetup.back**.
  - If a product is created from a **single** design (e.g. back-only): set only that side; the other side stays unset (no design on front, or no design on back).
  - If a product is created from **two** designs (same logical “product” but front + back): e.g. same league + family + team + variant, one design with side `front`, one with side `back` → set both **designIdFront** and **designIdBack**, and both **renderSetup.front** and **renderSetup.back**.

- **Legacy single designId:**  
  For products that only ever have one design (one side), the existing **designId** field can be set to that design for backward compatibility; **designIdFront** / **designIdBack** and **renderSetup** remain the source of truth for rendering.

- **Summary:**  
  `design.supportedSides[0]` (or the side from the design’s `importKey`) drives whether the design is applied to the product’s **front** or **back** (and thus **designIdFront** vs **designIdBack** and **renderSetup.front** vs **renderSetup.back**).

---

## 3. How renderSetup is initialized when products are created from imported designs

- **Per-side config** (see `RALLY_RENDER_SETUP_DATA_MODEL.md`):  
  `renderSetup.front` and `renderSetup.back` each have:  
  `blankAssetId`, `blankImageUrl`, `designAssetId`, `designAssetUrl`, `placementKey`, `placementOverride`, (optional) `blendMode`, `blendOpacity`.

- **At product creation time**, for each side that has a selected design:

  1. **Blank:**  
     Use the chosen **blankId**. Load blank doc and get the image URL for that side (e.g. `blank.images.front.downloadUrl` or equivalent). Set:
     - `renderSetup[side].blankAssetId` = blankId (or the blank’s stable id).
     - `renderSetup[side].blankImageUrl` = that URL.

  2. **Design:**  
     Use the design’s PNG from `design.files.png.downloadUrl` (and design id). Set:
     - `renderSetup[side].designAssetId` = design.id.
     - `renderSetup[side].designAssetUrl` = design PNG URL.

  3. **Placement:**  
     Set sensible defaults so the renderer works without user editing:
     - `placementKey`: e.g. `"front_center"` or `"back_center"` (per side).
     - `placementOverride`: e.g. `{ x: 0.5, y: 0.5, scale: 0.6 }` or leave null if the blank defines defaults.

  4. **Blend (optional):**  
     `blendMode: "multiply"`, `blendOpacity: 87` (or omit and let renderer use defaults).

- **Product fields to set together:**  
  - `blankId`  
  - `designId` (if single design) and/or `designIdFront` / `designIdBack`  
  - `renderSetup.front` and/or `renderSetup.back` as above  
  - `baseProductKey` (e.g. `DESIGN_${designId}_BLANK_${blankId}` or a composite for front+back)  
  - Name, slug, status, etc., as in existing product-creation logic.

- **Idempotency:**  
  Re-running “create products from these designs” for the same (design(s), blank) should either reuse an existing product (e.g. by `baseProductKey` or by designId+blankId for single-design products) or clearly indicate “product already exists” and skip/create accordingly.

---

## Next steps

- Finish any Phase 2 UX/results polishing (e.g. “Skipped” count in results, or filter by status).
- Implement Phase 3: optional product generation from imported designs using the inputs and mapping rules above, with **renderSetup** initialized as in section 3 so new products are render-ready.
