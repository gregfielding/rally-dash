# Rally Panties — Rally Dashboard Pivot (v1)
**Title:** Rally Dashboard as a Production Engine (Illustrator is the Design Studio)  
**Audience:** Cursor (implementation instructions)  
**Primary Goal (30-day operational):** Upload a **final design PNG+PDF**, select **blank(s)** + **placement**, and automatically generate:
1) **Flat mock** (pixel-perfect overlay)  
2) **Realistic mock** (wrinkles/shadows/texture via FAL)  
3) **On-model mock** (Amber/identity via LoRA + inpaint)

> We are **de-scoping** in-dashboard “design creation”. Designs are created in **Illustrator**. Dashboard is the **rendering + asset pipeline**.

---

## 0) Why we are doing this (context for Cursor)
We went deep on identity/model work (Amber) and generative exploration. But to sell products, the critical loop is:
**Illustrator final art → blank mock → realistic mock → on-model mock → product gallery**.

AI is strongest at:
- Realism pass (texture, wrinkles, light integration)
- Scene/background variants (optional)
- On-model shots (controlled via identity + masks)

AI is weak/unreliable at:
- Print-ready vector typography/layout
- Exact brand typography consistency
- Press-ready separations

Therefore:
- **Illustrator** owns final art.
- Dashboard owns **asset management + rendering**.

---

## 1) New product workflow (MVP)
### Step A — Upload final design files
For each design:
- Upload `final_print.png` (transparent background, 3000px+ wide)
- Upload `final_print.pdf` (printer pack)
- Enter `inkColors[]` hex list (1–3 colors max)
- Select optional tags/collection

### Step B — Choose blank(s) and placement(s)
- Choose blank style/color (e.g., LA Apparel 8394 black front)
- Choose placementKey (front_center, back_center, etc.)
- Generate **Flat Mock (Draft)** (deterministic overlay)

### Step C — Generate Realistic Mock
- If blank has **mask**, run inpaint realism pass confined to print region.
- If no mask, fallback to img2img realism pass (low strength).
- Output: `mock_final_realistic.png`

### Step D — Generate On-Model
- Choose identity: Amber (LoRA)
- Choose preset pose/scene
- Apply design via inpaint mask on garment region (or use 2-stage: generate model wearing blank → inpaint print).
- Output: `on_model_image.png`

---

## 2) What to change in the app (high level)
### Keep
- Blanks Library (already built)
- Mask upload + inpaint support (already implemented)
- Mock job pipeline (Stage A overlay + Stage B realism pass)

### Remove / Deprioritize (do not build now)
- In-dashboard “AI design brief / concept generation”
- Heavy “prompt exploration” UX for designs
- Adobe Stock / Etsy scraping modules
- Shopify sync (Phase 4+)

### Add / Improve
- **Designs as asset containers** (Illustrator uploads + generated outputs)
- One-click generation UX for:
  - Flat Mock
  - Realistic Mock
  - On-Model
- Clear statuses and “what’s next” checklist
- Print pack download (PDF + colors + references)

---

## 3) Data model updates (Firestore)
### 3.1 Collections (MVP)
- `rp_designs/{designId}`
- `rp_design_assets/{assetId}`
- `rp_blanks/{blankId}` (existing)
- `rp_blank_masks/{blankId}_{view}` (existing)
- `rp_mock_jobs/{jobId}` (existing or rename to rp_generation_jobs)
- `rp_products/{productId}` (optional internal “product draft”)
- `rp_identities/{identityId}` (existing, for Amber)

> If you already have different collection names, keep them; just map fields accordingly.

### 3.2 `rp_designs/{designId}` (updated for pivot)
```ts
export type RPDesignStatus = "draft" | "ready" | "archived";

export interface RPDesignDoc {
  id: string;
  name: string;                 // "Gamer Babe - Vintage v1"
  slug: string;
  status: RPDesignStatus;

  // Source-of-truth files from Illustrator
  finalPrintPngAssetId?: string; // REQUIRED to generate anything
  finalPrintPdfAssetId?: string; // REQUIRED for print pack
  inkColors: Array<{ hex: string; name?: string }>;

  // Optional metadata
  tags: string[];
  notes?: string;

  // Convenience counters
  mockDraftCount: number;
  mockFinalCount: number;
  onModelCount: number;

  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}
```

### 3.3 `rp_design_assets/{assetId}` (normalize everything)
```ts
export type RPAssetKind =
  | "final_print_png"
  | "final_print_pdf"
  | "mock_draft"
  | "mock_final_realistic"
  | "on_model_image"
  | "reference"
  | "other";

export interface RPDesignAssetDoc {
  id: string;
  designId: string;
  kind: RPAssetKind;

  file: {
    storagePath: string;
    downloadUrl?: string;
    contentType: string;
    bytes?: number;
    width?: number;
    height?: number;
  };

  // Link outputs to blank/placement/model
  blankId?: string;
  view?: "front"|"back";
  placementKey?: string;
  identityId?: string;

  // Provenance
  ai?: {
    provider?: "fal"|"openai"|"other";
    model?: string;
    prompt?: string;
    negativePrompt?: string;
    params?: Record<string, any>;
    usedMask?: boolean;
    maskDocId?: string;
    sourceAssetId?: string;
  };

  createdAt: any;
  createdByUid: string;
}
```

### 3.4 `rp_mock_jobs/{jobId}` (job-driven generation)
```ts
export type RPJobStage = "mock_draft" | "mock_final" | "on_model";

export interface RPMockJobDoc {
  id: string;
  designId: string;
  stage: RPJobStage;

  // Target
  blankId?: string;
  view?: "front"|"back";
  placementKey?: string;

  // Optional on-model
  identityId?: string;
  posePresetId?: string;

  // Inputs
  finalPrintPngAssetId: string; // required
  sourceDraftAssetId?: string;  // for final stage

  // Outputs
  outputAssetIds: string[];

  // Status
  status: "queued"|"running"|"success"|"error";
  error?: { message: string; code?: string };

  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}
```

---

## 4) Storage layout
```
rp/designs/{designId}/final/final_print.png
rp/designs/{designId}/final/final_print.pdf

rp/designs/{designId}/mocks/{jobId}/draft.png
rp/designs/{designId}/mocks/{jobId}/final.png

rp/designs/{designId}/on_model/{jobId}/image_01.png
rp/blank_masks/{blankId}/{view}/mask.png
```

---

## 5) Cloud Functions (MVP set)
### 5.1 `createDesign`
- Creates design doc + slug
- Initializes counters
- Validates inkColors length (1–3)

### 5.2 `uploadDesignFinals` (optional helper, UI can do direct uploads)
- Accepts asset metadata (png/pdf)
- Writes `rp_design_assets`
- Updates `rp_designs.finalPrintPngAssetId` / `finalPrintPdfAssetId`
- Sets status to `ready` when both present

### 5.3 `createMockDraftJob`
Input: `{ designId, blankId, view, placementKey }`
- Validates design has `finalPrintPngAssetId`
- Generates deterministic overlay (Canvas/Sharp)
- Writes draft asset doc kind=`mock_draft`
- Updates counters
- Marks job success

### 5.4 `createMockFinalJob`
Input: `{ designId, draftAssetId }`
- Loads draft image
- Checks `rp_blank_masks/{blankId}_{view}`
  - If exists → call FAL **inpainting**
  - else → call FAL **img2img** (strength ~0.20–0.30)
- Saves final asset kind=`mock_final_realistic`
- Records provenance (model, strength, promptHash)
- Updates counters

### 5.5 `createOnModelJob` (Phase 2, but start wiring now)
Input: `{ designId, blankId, view, placementKey, identityId, posePresetId }`
Two implementation options:
- **Option A (recommended):** Generate a model photo wearing the blank (no print) → inpaint print region using mask + finalPrintPngAssetId
- **Option B:** Directly prompt model with design described (less consistent)

Output:
- kind=`on_model_image` assets
- provenance stored

> Keep this behind a feature flag until Amber is consistent.

---

## 6) Prompts (keep minimal and locked)
### 6.1 Realism pass (mock_final)
**Prompt (img2img / inpaint):**
"Studio product photo of the same garment. The artwork is screen printed directly onto the fabric. Preserve the design exactly. Add realistic fabric texture, subtle wrinkles, accurate lighting, and natural shadows. Do not change the logo or text."

**Negative:**
"distort logo, change text, redraw artwork, add new text, add logos, change colors, blur, low-res, artifacts"

Parameters:
- `strength`: 0.20–0.30 (img2img), 0.25–0.35 (inpaint)
- steps: 24–32
- guidance: 3–5

### 6.2 On-model pass (later)
Keep locked presets per pose/scene; do not allow freeform until stable.

---

## 7) UI updates (MVP)
### 7.1 Navigation
- Designs
- Blanks
- Identities (Amber)

### 7.2 Designs List
Columns:
- Name
- Status (draft/ready)
- Finals present (PNG/PDF chips)
- Mock finals count
- On-model count
- Updated

Primary CTA: **Create Design**

### 7.3 Design Detail (4 tabs only)
1) **Overview**
   - name, tags, ink colors
   - checklist: PNG ✅ / PDF ✅ / Mock Final ✅ / On-model (optional)
2) **Final Files**
   - Upload PNG (required)
   - Upload PDF (required)
   - Ink colors editor
3) **Mockups**
   - Select blank + view + placement
   - Buttons: Generate Draft, Generate Final
   - Gallery: draft + final (side-by-side)
4) **Print Pack**
   - Show PDF, ink colors
   - Button: Download ZIP (function)

> Remove “AI design brief” and “concepts” from this surface area for now.

---

## 8) Firestore Rules (role-based)
Assume you already have roles. Use same pattern.
- Read: authenticated users
- Write: admin only (or role >= admin)

Collections to cover:
- rp_designs
- rp_design_assets
- rp_mock_jobs
- rp_print_packs (if present)

---

## 9) Storage Rules
Paths:
- `rp/designs/**` : authenticated read/write (admin write recommended)
- `rp/blank_masks/**` : authenticated read, admin write
- Keep consistent with your current Storage rules.

---

## 10) Implementation task order (Cursor — do in this order)
### Phase 1 (Must-have to sell) — 1–4 days
1. **Update Firestore types** for rp_designs + rp_design_assets + rp_mock_jobs.
2. **Designs UI**:
   - Designs list
   - Design detail (Overview + Final Files + Mockups + Print Pack)
3. **Final file upload** in UI:
   - Save assets in Storage
   - Create rp_design_assets
   - Update rp_design doc pointers
4. **Mock Draft generation**:
   - Wire existing overlay function to new design-based workflow
5. **Mock Final realism pass**:
   - Use mask if exists else img2img fallback (already implemented patterns)
6. **Print pack ZIP export** (basic):
   - zip: final_print.pdf, final_print.png, colors.json, final_mock.png (if exists)

### Phase 2 (On-model) — 3–7 days (parallel)
7. Define 3 pose presets for Amber (studio standing, casual indoor, outdoor).
8. Implement `createOnModelJob` behind a feature flag.
9. UI tab section “On-model (Beta)” with generate button.

### Phase 3 (Nice-to-have)
10. Scene variants (bed shot, locker room) as additional job stages.
11. Product drafts + Shopify sync (only after you have 10 SKUs).

---

## 11) Acceptance criteria (what “done” means)
A design is “operational” when:
- Final PNG uploaded ✅
- Final PDF uploaded ✅
- At least 1 blank mock final generated ✅
- Print pack ZIP downloads ✅

The business is “operational” when:
- You can produce **10 operational designs** in a week
- Each design can generate mocks across **3 blanks** consistently

---

# Deliverable for Cursor
**Implement Phase 1** exactly as described, then stop.  
Do not re-add AI design tooling. Focus on production outputs.
