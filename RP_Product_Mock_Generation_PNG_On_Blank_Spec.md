# RP_Product_Mock_Generation_PNG_On_Blank_Spec.md
**Project:** Rally Panties (DesignOps)  
**Goal:** Generate product mock images by overlaying a **Design PNG** onto a **Blank garment image** with realistic print behavior (texture/wrinkles/shadows).  
**Audience:** Cursor (build-this-exactly)  
**Status:** MVP spec (simple UI, simple backend)  
**Last Updated:** 2026-01-25  

---

## 0) Context (why this exists)
You already have:
- **Blanks Library**: real LA Apparel garment blanks (style + color + front/back images + placement defaults)
- **Design Library**: uploaded **PNG** + printer **PDF** + ink **hex colors** + team tagging

Now we need the core pipeline:

> **Blank image + Design PNG + Placement → Mock Image**

It must look like real print:
- follows fabric texture and wrinkles
- includes subtle shading from folds
- avoids the “sticker pasted on” look

But MVP must be **simple** and **easy to use**:
- 3–4 inputs max
- one-button generation
- deterministic placement
- optional “Final” realism pass

---

## 1) The simple, reliable approach: Two-stage generation
### Stage A — Deterministic composite (FAST, no drift)
Use `sharp` to:
- resize PNG into safe area
- place via normalized x/y
- export **draft** image: `v0_draft.png`

### Stage B — AI realism pass (OPTIONAL “Final”)
Use **fal.ai img2img/inpaint** to:
- preserve garment/background
- preserve logo geometry/edges
- bake print into fabric texture
- export **final** image: `v1_final.png`

MVP supports both:
- **Draft** = Stage A only (instant)
- **Final** = Stage A + Stage B (more realistic)

---

## 2) UX requirements (MUST be dead-simple)
### Where it lives
Add a **Mocks** tab to **Design Detail**:
- `/designs/:designId` → tab: **Mocks**

### Inputs (MVP)
1) **Blank** (dropdown, searchable: style + color)
2) **View** (Front/Back) — default Front; only show if blank has that image
3) **Quality** (Draft / Final) — default Draft
4) *(hidden)* Placement — auto:
   - Front → `front_center`
   - Back → `back_center`

Button:
- **Generate Mock**

### Outputs
Below generator:
- Results grid (newest first)
  - Draft composite card
  - Final realistic card (if generated)
- Each card has:
  - Preview
  - Timestamp
  - **Approve** button (toggle)
  - Copy URL (optional)

### Operator flow
1) Open design “SF Giants Design 1”
2) Mocks tab
3) Select blank “8394 Bikini — Black”
4) Generate **Draft**
5) If good: generate **Final**
6) Approve best final image

---

## 3) Firestore schema (minimal + extensible)
### Collections
- `rp_mock_jobs/{jobId}` — queue + history
- `rp_mock_assets/{assetId}` — output images (draft/final)
- *(Phase 2 optional)* `rp_blank_masks/{blankId}` — print-region masks

---

### 3.1 `rp_mock_jobs/{jobId}`
```ts
type RpMockJobStatus = "queued" | "processing" | "succeeded" | "failed";

type RpMockJob = {
  id: string;

  designId: string;
  blankId: string;

  view: "front" | "back";
  placementId: "front_center" | "back_center";

  quality: "draft" | "final";

  input: {
    blankImageUrl: string;
    designPngUrl: string;
    placement: {
      x: number; y: number; scale: number;
      safeArea: { padX: number; padY: number };
      rotationDeg?: number;
    };
  };

  output?: {
    draftAssetId?: string;
    finalAssetId?: string;
  };

  attempts: number;
  error?: { message: string; code?: string; details?: any };

  createdAt: FirebaseTimestamp;
  createdByUid: string;
  updatedAt: FirebaseTimestamp;
};
```

### 3.2 `rp_mock_assets/{assetId}`
```ts
type RpMockAssetKind = "draft_composite" | "final_realistic";

type RpMockAsset = {
  id: string;

  designId: string;
  blankId: string;
  view: "front" | "back";
  placementId: "front_center" | "back_center";

  kind: RpMockAssetKind;

  image: {
    storagePath: string;
    downloadUrl: string;
    width?: number;
    height?: number;
    bytes?: number;
    contentType?: string;
  };

  provenance: {
    jobId: string;
    modelProvider?: "fal";
    modelName?: string;
    params?: Record<string, any>;
    promptHash?: string;
  };

  approved: boolean;
  approvedAt?: FirebaseTimestamp;
  approvedByUid?: string;

  createdAt: FirebaseTimestamp;
  createdByUid: string;
};
```

---

## 4) Storage layout (outputs)
Outputs go here:

```
rp/mocks/{designId}/{blankId}/{view}/{timestamp}/draft.png
rp/mocks/{designId}/{blankId}/{view}/{timestamp}/final.png
```

Optional thumbnails:
```
rp/mocks/{...}/thumb.jpg
```

---

## 5) Backend functions (simple + proven)
### 5.1 Callable: `createMockJob`
UI calls this.

Input:
```ts
{ designId, blankId, view, quality }
```

Validation:
- Design must have `files.png`
- Blank must have `images.front` or `images.back` for requested view

Resolution:
- placementId:
  - front → `front_center`
  - back → `back_center`
- placement values:
  - prefer **blank placements** if present
  - else use global default: `x=0.5,y=0.5,scale=0.6,padX=0.2,padY=0.2`

Write:
- `rp_mock_jobs/{jobId}` with status `queued`

Return:
```ts
{ jobId }
```

---

### 5.2 Worker: `onMockJobCreated` (Firestore trigger)
Trigger: `rp_mock_jobs/{jobId}` onCreate

Steps:
1) set job.status = `processing`
2) **Stage A**: deterministic composite → save `draft.png` → create `rp_mock_assets` doc (draft)
3) if job.quality == `final`:
   - **Stage B**: call fal.ai img2img/inpaint using draft image
   - save `final.png` → create `rp_mock_assets` doc (final)
4) set job.status = `succeeded` and store assetIds
5) on error: set job.status = `failed` + error message

---

## 6) Stage A — Deterministic composite (sharp)
### Placement math (MVP)
Normalized placement in [0..1]:

- safe bounds:
  - safeLeft = padX
  - safeRight = 1 - padX
  - safeTop = padY
  - safeBottom = 1 - padY

- safeW = safeRight - safeLeft
- safeH = safeBottom - safeTop
- base = min(safeW, safeH)
- artBox = base * scale

Convert to pixels:
- artBoxPx = artBox * blankWidthPx
- centerXpx = x * blankWidthPx
- centerYpx = y * blankHeightPx

Resize design PNG to fit within `artBoxPx` using “contain”.
Composite at:
- left = centerXpx - artW/2
- top = centerYpx - artH/2

Blend mode:
- MVP: normal composite, opacity 1.0

Output: `draft.png`

---

## 7) Stage B — AI realism pass (fal.ai)
### Requirements
Use an endpoint that supports **img2img** or **inpaint**.

Input:
- the `draft.png` from Stage A

Prompt (must preserve logo):
> “Studio product photo of the same garment. The artwork is screen printed directly onto the fabric. Preserve garment shape, seams, and lighting. The print follows fabric texture and wrinkles with subtle ink absorption and shading. Keep the artwork geometry and edges exactly the same. Do not change background.”

Negative:
> “distort logo, change text, redraw artwork, add text, change garment shape, change straps/waistband, change background, add objects, blur”

Defaults:
- denoise/strength: **0.20**
- steps: moderate
- size: same as input

Store provenance on asset:
- model name
- params
- prompt hash

Output: `final.png`

---

## 8) Approvals (simple)
In UI, each asset can be approved.

Write:
- `rp_mock_assets/{assetId}.approved = true`
- set `approvedAt`, `approvedByUid`

MVP can allow multiple approved; later enforce “one approved per (designId, blankId, view)”.

---

## 9) Security rules (MVP admin-only)
Firestore:
```rules
match /rp_mock_jobs/{jobId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.token.admin == true;
}
match /rp_mock_assets/{assetId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.token.admin == true;
}
```

Storage:
```rules
match /rp/mocks/{allPaths=**} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.token.admin == true;
}
```

---

## 10) Hooks (minimal)
- `useMockJobs({ designId, blankId, view })`
- `useMockAssets({ designId, blankId, view })`
- `useCreateMockJob()`
- `useApproveMockAsset()`

---

## 11) Task order (build in this exact order)
### Phase 1 — Draft only (prove correctness)
1) Add TS types for jobs/assets
2) Add Firestore rules + Storage rules
3) Implement Stage A composite worker with `sharp`
4) Build Mocks tab UI (Generate Draft + results grid)
5) Implement Approve toggle

### Phase 2 — Final realism pass (fal.ai)
6) Add fal call when `quality=final`
7) Add UI toggle for Final
8) Store provenance

### Phase 3 — Masks (optional quality upgrade)
9) Add `rp_blank_masks` per blank view
10) Use inpaint mask to limit edits to print region

---

## 12) Acceptance criteria
- Draft mock generation on any blank completes in < 10 seconds.
- Placement looks correct and consistent.
- Final image looks like fabric print (not sticker) without logo distortion.
- Approved assets are stored and can be reused later for product pages/Shopify.

---

## 13) Cursor instructions
Build exactly as written.
Prioritize simplicity:
- minimal UI inputs
- strong defaults
Start with Phase 1 (Draft) before adding AI realism complexity.
