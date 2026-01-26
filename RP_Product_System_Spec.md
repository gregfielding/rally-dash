# Rally Panties DesignOps — Product System (Build Spec for Cursor)
**File:** `RP_Product_System_Spec.md`  
**Goal:** Add a *Product* domain layer (business/CMS layer) on top of existing LoRA Ops so merch/design users can manage products, designs, and generated assets (images + later video) without living inside LoRA Ops.

This spec assumes your existing stack:
- **Frontend:** React + MUI
- **Backend:** Firebase (Firestore + Storage) + Cloud Functions
- **AI Provider:** fal.ai (`fal-ai/flux-lora`) through Cloud Functions
- Existing sections: **LoRA Ops** (Packs, Identities, Reference Library, Datasets, Training Jobs) and **Dashboard** (Generate New Design, Bulk Generate, Review Queue)

---

## 0) Why this exists
LoRA Ops is infrastructure (datasets/artifacts/weights). The Product system is the **business layer**:
- Defines products (SKU-like records)
- Links each product to a **Product LoRA** (and optionally to a blank template)
- Stores **prompt presets** and **generation scenarios**
- Stores **generated assets** (photoshoots, ecommerce, social, etc.)
- Enables review/approve/publish flow
- Makes it easy to say: **“Show Amber wearing Giants Panty 1 in black in a studio shoot”**

---

## 1) Domain model (3-layer pipeline)
**Identity × Product × Scene → Output Assets**
- Identity: `rp_amber` (face) + optional `rp_amber_body` (body)
- Product: `rp_sfg_panty_1` (product LoRA trained from blanks / product dataset)
- Scene: prompt presets (ecommerce, lifestyle, social, etc.)
- Output: images (and later videos) stored per Product and Scenario, with approval states

---

## 2) Firestore collections & schemas

> Use the same conventions you already use (timestamps, createdBy, status enums).  
> All documents should include: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, and optional `archivedAt`.

### 2.1 `rp_products/{productId}`
Represents a sellable product/colorway (SKU-like).

**productId naming recommendation**
- Human readable: `SFGIANTS_PANTY_1_BLACK`
- Also store `slug` (lowercase) for URLs: `sfgiants-panty-1-black`

**Schema**
```ts
type RpProductStatus = "draft" | "active" | "archived";
type RpProductCategory = "panties" | "bralette" | "tank" | "tee" | "other";

type RpProduct = {
  productId: string;              // doc id
  slug: string;                   // for route /products/:slug
  name: string;                   // "SF Giants Classic Black"
  description?: string;

  category: RpProductCategory;
  baseProductKey: string;         // "SFGIANTS_PANTY_1" (style family)
  colorway: {
    name: string;                 // "Black"
    hex?: string;                 // "#000000"
  };

  supplier?: {
    supplierName?: string;
    supplierSku?: string;
    styleCode?: string;
  };

  // AI Links (core)
  ai: {
    productArtifactId?: string;   // reference to rp_lora_artifacts doc (Product LoRA)
    productTrigger?: string;      // e.g. "rp_sfg_panty_1"
    productRecommendedScale?: number; // e.g. 0.9
    blankTemplateId?: string;     // optional: pointer to a "blank template" record
  };

  // Workflow
  status: RpProductStatus;        // "draft" until ready
  tags?: string[];

  // Simple analytics
  counters?: {
    assetsTotal?: number;
    assetsApproved?: number;
    assetsPublished?: number;
  };

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedBy: string;
};
```

---

### 2.2 `rp_product_designs/{designId}`
Represents a “design” within a product family (e.g., the PNG/logo concept).  
**This is where you attach your PNG artwork** and/or text metadata for the design.

**Schema**
```ts
type RpDesignStatus = "draft" | "active" | "archived";

type RpProductDesign = {
  designId: string;               // doc id
  productId: string;              // parent SKU record
  name: string;                   // "SFGIANTS Panty 1 - Wordmark"
  code: string;                   // "SFGIANTS_PANTY_1_WORDMARK_A" (versioned)
  status: RpDesignStatus;

  artwork: {
    // Upload your artwork (transparent PNG / SVG etc.)
    sourcePngPath?: string;       // Storage path
    sourceSvgPath?: string;
    previewPath?: string;         // optional pre-render
    width?: number;
    height?: number;
    notes?: string;
  };

  // Optional: record how the artwork is applied to the garment blank
  placement?: {
    zone?: "front_center" | "front_left" | "back_center" | "back_left" | "waistband" | "other";
    // normalized box in [0..1] relative to blank template image
    bbox?: { x: number; y: number; w: number; h: number };
    rotationDeg?: number;
  };

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedBy: string;
};
```

> NOTE: In Phase 1, you can skip smart placement and just store the artwork + notes.  
> In Phase 2/3, you can implement AI placement or template warping.

---

### 2.3 `rp_scene_presets/{presetId}`
Reusable prompt templates that define how to render assets.

**Schema**
```ts
type RpSceneType = "ecommerce" | "studio" | "lifestyle" | "social" | "ugc" | "video";

type RpScenePreset = {
  presetId: string;
  name: string;                   // "Ecommerce White Seamless"
  sceneType: RpSceneType;

  // Prompt templates. Use token placeholders.
  promptTemplate: string;
  negativePromptTemplate?: string;

  // Suggested generation settings
  defaults: {
    imageSize: "square" | "portrait" | "landscape";
    imageCount: number;           // default 4
    seed?: number;
    // artifact scales
    faceScale?: number;           // e.g. 0.75
    bodyScale?: number;           // e.g. 0.6
    productScale?: number;        // e.g. 0.9
  };

  // Guardrails
  requiredTokens?: string[];      // ["{IDENTITY_TRIGGER}", "{PRODUCT_TRIGGER}"]

  isActive: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedBy: string;
};
```

**Token placeholders**
- `{IDENTITY_TRIGGER}` e.g. `rp_amber`
- `{PRODUCT_TRIGGER}` e.g. `rp_sfg_panty_1`
- `{DESIGN_CODE}` e.g. `SFGIANTS_PANTY_1_WORDMARK_A`
- `{COLORWAY_NAME}` e.g. `black`
- `{SCENE_NOTES}` freeform
- `{CAMERA}` e.g. `real camera look, 85mm, shallow depth of field`
- `{LIGHTING}` e.g. `soft studio lighting, clean neutral background`

---

### 2.4 `rp_generation_jobs/{jobId}`
Tracks a generation request (images now; video later).  
This is your durable record and idempotency anchor.

**Schema**
```ts
type RpJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type RpGenerationJob = {
  jobId: string;
  productId: string;
  designId?: string;
  identityId: string;             // e.g. "amber" or artifact ref
  presetId: string;

  // Resolved prompt (final strings actually sent)
  prompt: string;
  negativePrompt?: string;

  // Artifact stacking
  artifacts: {
    faceArtifactId?: string;
    faceScale?: number;

    bodyArtifactId?: string;
    bodyScale?: number;

    productArtifactId?: string;
    productScale?: number;
  };

  // Provider request metadata
  provider: "fal";
  endpoint: "fal-ai/flux-lora";
  params: {
    imageCount: number;
    size: "square" | "portrait" | "landscape";
    seed?: number;
  };

  status: RpJobStatus;
  attempts: number;
  lastError?: {
    message: string;
    code?: string;
    raw?: any;
  };

  // Output
  outputs?: {
    images?: Array<{
      storagePath: string;
      width?: number;
      height?: number;
      sha256?: string;
    }>;
  };

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedBy: string;
};
```

---

### 2.5 `rp_product_assets/{assetId}`
Each generated image or video becomes an “asset” with status and metadata.
Assets are attached to:
- product
- optional design
- scenario (preset)
- identity

**Schema**
```ts
type RpAssetType = "image" | "video";
type RpAssetStatus = "draft" | "approved" | "published" | "rejected";

type RpProductAsset = {
  assetId: string;
  productId: string;
  designId?: string;
  presetId: string;
  identityId: string;

  type: RpAssetType;
  status: RpAssetStatus;

  storagePath: string;
  thumbnailPath?: string;

  // Provenance
  generationJobId?: string;
  prompt?: string;
  negativePrompt?: string;
  artifacts?: RpGenerationJob["artifacts"];

  // Simple rating/notes for review workflow
  review?: {
    rating?: number;              // 1-5
    notes?: string;
    reviewedBy?: string;
    reviewedAt?: FirebaseFirestore.Timestamp;
  };

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedBy: string;
};
```

---

## 3) Storage layout (Firebase Storage)
Use predictable paths:

```
/rp/products/{productId}/designs/{designId}/artwork/source.png
/rp/products/{productId}/assets/{assetId}.png
/rp/products/{productId}/assets/thumbs/{assetId}.jpg
/rp/scene_presets/{presetId}/example.png (optional)
/rp/blanks/{blankTemplateId}/front.png
/rp/blanks/{blankTemplateId}/back.png
```

---

## 4) UI/Routes (React + MUI)
Add a top nav item: **Products**

### 4.1 Pages
1. **Products List** `/products`
   - Table / cards: name, category, baseProductKey, colorway, status, counters
   - Search (client-side initially; later server-side)
   - Actions: Create Product, Open, Archive

2. **Product Detail** `/products/:slug`
   - Tabs:
     - Overview
     - Designs
     - Assets
     - Generate
     - Settings
   - Overview shows: hero image, status, linked LoRA artifact, counters

3. **Design Detail** `/products/:slug/designs/:designId`
   - Upload artwork PNG
   - Placement metadata (optional)
   - Linked assets

4. **Generate** tab (inside Product Detail)
   - Select Identity (Amber default)
   - Select Design (optional)
   - Select Scene Preset
   - Shows resolved prompt preview
   - Artifact stacking controls:
     - Face artifact dropdown
     - Body artifact dropdown
     - Product artifact dropdown
     - Scales sliders
   - Button: **Generate (4)** → creates `rp_generation_jobs` and triggers worker
   - Show Latest Results grid; one-click “Add to Assets”

5. **Assets** tab
   - Grid of assets with filter chips:
     - Draft / Approved / Published
     - Preset type
     - Identity
   - Approve / Reject / Publish actions
   - Set Hero image

---

## 5) Cloud Functions (backend)
You already run fal.ai calls through Cloud Functions. Extend that pattern.

### 5.1 Function: `createProduct`
**Callable** (admin only)
- Creates `rp_products/{productId}` with slug and defaults

### 5.2 Function: `createProductDesign`
**Callable**
- Creates `rp_product_designs/{designId}` linked to product

### 5.3 Function: `generateProductAssets`
**Callable**
- Inputs: `productId, designId?, presetId, identity refs, overrides`
- Creates `rp_generation_jobs/{jobId}` with:
  - resolved prompt
  - resolved artifacts + scales
  - provider params
  - status `queued`

### 5.4 Trigger: `onRpGenerationJobCreated`
**Firestore onCreate** for `rp_generation_jobs/{jobId}`
- Enqueue Cloud Task: `processRpGenerationJob`

### 5.5 Worker: `processRpGenerationJob`
**HTTP** (Cloud Tasks)
- Loads job doc
- Calls fal endpoint `fal-ai/flux-lora` with:
  - prompt, negative_prompt
  - LoRA weights stacking list (face/body/product)
  - image count, size, seed
- Saves images to Storage
- Writes `outputs.images[]` back to job
- Creates `rp_product_assets` as `draft` by default (or optionally only when user clicks “Add to Assets”)

**Idempotency**
- Use jobId as idempotency key.
- If job status is `succeeded`, exit.

### 5.6 Function: `setAssetStatus`
**Callable**
- Change status: draft → approved → published
- Audit write (`reviewedBy`, timestamps)

### 5.7 Function: `setProductHeroAsset`
**Callable**
- Stores hero asset id/path on `rp_products/{productId}`

---

## 6) Prompt resolution logic (server-side)
You want consistent prompts. Put token replacement in backend.

### 6.1 Resolver: `resolvePrompt(preset, context)`
Inputs:
- preset templates
- identity trigger
- product trigger
- design code
- colorway
- any user notes

Pseudo:
```ts
function resolveTokens(template: string, ctx: Record<string,string>) {
  return template.replace(/\{([A-Z0-9_]+)\}/g, (_, key) => ctx[key] ?? "");
}
```

Also:
- auto-append camera/lighting defaults if not provided
- auto-add negative prompt hair guardrails when identity is Amber and you want blonde stable

---

## 7) Artifact stacking model (how you pass LoRAs to fal)
Your UI already supports “Body Artifact” dropdown and “Scale (0.65)” slider. Extend to include Product Artifact.

### 7.1 Standard stacking order
1) Face LoRA (Identity)  
2) Body LoRA (optional)  
3) Product LoRA  
4) (Later) Design overlay LoRA / ControlNet / Inpainting pass

### 7.2 Recommended scale bands (starting point)
- Face (Identity): **0.7–0.8**
- Body: **0.6–0.7**
- Product: **0.8–1.0**

If hair color slips:
- Increase **face scale**, not body.

---

## 8) “AI apply PNG to blank” (roadmap)
You mentioned: “apply PNG onto supplier blanks with wrinkles/shadows.”  
That can be solved two ways:

### Option A (fast): template warp + shading pass
- Use a blank template with known UV/warp mapping
- Apply PNG via 2D transform + mild displacement map
- Add shading via multiply overlay from blank’s luminance
- This is deterministic, cheap, and good for ecommerce mockups

### Option B (best): AI inpainting / image-to-image
- Input: blank image + png art + mask area
- Run an inpainting or img2img pass that:
  - respects fabric texture
  - preserves seams
  - generates realistic print interaction
- Store output as a “rendered blank” for product listing

**Spec for Phase 2**
- Add `rp_blank_renders/{renderId}`
- Callable: `renderBlankWithArtwork`
- Inputs: blankTemplateId, artworkPath, placement bbox/mask
- Output: `renderedBlankPath`

---

## 9) Security rules (high-level)
- Only admin roles can create/edit products/designs/presets
- Any logged-in role may view published assets (if you want)
- All draft assets restricted to admins

> Implement similar to your existing role checks in LoRA Ops.

---

## 10) Implementation plan (Cursor-friendly)
### Phase 1 (MVP)
- Firestore collections: products, designs, scene presets, generation jobs, assets
- Products list + product detail page with tabs
- Generate tab: select preset + identity + product artifact + run generation
- Assets tab: approve/publish

### Phase 2
- Blank templates & PNG upload in design
- Render blank with artwork (deterministic or AI)
- Product LoRA training UI improvements + link artifact to product automatically

### Phase 3
- Video generation jobs
- Social post composer + auto-crops
- Shopify export

---

## 11) Seed data (create these presets immediately)
Create 3 presets in `rp_scene_presets`:

### Preset: Ecommerce White
**promptTemplate**
```
{IDENTITY_TRIGGER}, blonde hair, blue-green eyes, fair warm skin tone,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
full body head-to-toe, standing naturally, relaxed posture,
ecommerce studio photo, seamless white background,
realistic fabric texture, natural wrinkles, accurate shadows,
sharp focus, real camera look
```
**negativePromptTemplate**
```
dark hair, brunette, brown hair, black hair, red hair, auburn hair,
cartoon, CGI, plastic skin, blurry, extra limbs, deformed hands
```

### Preset: Studio Editorial
**promptTemplate**
```
{IDENTITY_TRIGGER}, blonde hair, natural makeup,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
studio editorial fashion photography, neutral backdrop,
soft directional light, cinematic, shallow depth of field,
high-end lingerie campaign look, realistic skin texture
```

### Preset: Lifestyle Outdoor
**promptTemplate**
```
{IDENTITY_TRIGGER}, blonde hair, bright daylight,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
lifestyle outdoor photo, candid, natural smile,
realistic shadows, authentic camera grain, high-end look
```

---

## 12) Dev notes / pitfalls
- Keep product LoRA training datasets free of faces/identity
- Keep identity prompts consistent to reduce drift
- Use negative prompt hair guardrail + higher face scale when needed
- Save resolved prompts inside job docs (don’t rely on preset staying unchanged)
- Add idempotency to job processing to prevent duplicates

---

## 13) Deliverables checklist (what Cursor should build)
- [ ] Firestore types + Zod schemas for all collections above
- [ ] UI: Products list + Product detail with tabs
- [ ] UI: Scene preset manager (admin-only simple CRUD)
- [ ] Callable functions: createProduct, createProductDesign, generateProductAssets, setAssetStatus, setProductHeroAsset
- [ ] Firestore trigger + Cloud Task worker for generation jobs
- [ ] Storage upload helpers for artwork PNGs and generated assets
- [ ] Basic approval workflow on Assets tab

---

## Appendix A — Suggested file/folder layout
```
/src/pages/products/ProductsList.tsx
/src/pages/products/ProductDetail.tsx
/src/pages/products/tabs/ProductOverviewTab.tsx
/src/pages/products/tabs/ProductDesignsTab.tsx
/src/pages/products/tabs/ProductAssetsTab.tsx
/src/pages/products/tabs/ProductGenerateTab.tsx
/src/pages/products/DesignDetail.tsx

/src/components/products/ProductHeroCard.tsx
/src/components/products/AssetGrid.tsx
/src/components/products/GenerateForm.tsx
/src/components/products/ScenePresetSelect.tsx

/src/lib/firestore/rpProducts.ts
/src/lib/firestore/rpDesigns.ts
/src/lib/firestore/rpAssets.ts
/src/lib/firestore/rpPresets.ts
/src/lib/firestore/rpJobs.ts

/functions/src/callables/createProduct.ts
/functions/src/callables/createProductDesign.ts
/functions/src/callables/generateProductAssets.ts
/functions/src/callables/setAssetStatus.ts
/functions/src/callables/setProductHeroAsset.ts

/functions/src/triggers/onRpGenerationJobCreated.ts
/functions/src/workers/processRpGenerationJob.ts
/functions/src/lib/promptResolver.ts
/functions/src/lib/falClient.ts
/functions/src/lib/storage.ts
```

---

## Appendix B — Minimal UI decisions
- Products should be top-level nav (not inside LoRA Ops)
- LoRA Ops remains for training, dataset management, and artifact debugging
- Product Detail becomes the place merch/design lives day-to-day

---

**End of spec.**
