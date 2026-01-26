# Rally Panties DesignOps — Product-Only vs On-Model Generation (Cursor-Ready Spec)

Owner: Rally Panties DesignOps  
Scope: **Products → Generate tab**, **rp_generation_jobs**, prompt resolution, scene preset filtering  
Goal: Support **two generation modes**:
1. **product_only** — catalog/product photography (no human/model)
2. **on_model** — identity + face/body artifacts (Amber wearing product)

This spec is designed to be pasted into Cursor and implemented as-is.

---

## 0) Why this exists (the problem)

Right now, the Generate tab is implicitly “on-model”:
- `Identity` is required
- Face/Body artifacts are present
- Prompts assume a human subject

But the business needs *product-only* shots too:
- flat lay / centered product
- ecommerce white background
- PDP thumbnails + variant images
- no model, no skin, no body

We will implement a **Generation Type** toggle and a **mode-aware prompt resolver**.

---

## 1) New concept: Generation Type

### 1.1 Enum

```ts
export type RpGenerationType = "product_only" | "on_model";
```

### 1.2 Behavior Summary

| Mode | Identity | Face/Body Artifacts | Output |
|------|----------|----------------------|--------|
| `product_only` | **not used** | **not used** | Product-only images on clean background |
| `on_model` | **required** | optional (recommended) | Model wearing product in scene |

---

## 2) Firestore schema updates

### 2.1 rp_generation_jobs (add fields)

Collection already exists in your system. Add/ensure these fields:

```ts
export type RpGenerationJob = {
  id: string;

  // existing
  productId: string;
  productKey: string;          // e.g., SFGIANTS_PANTY_1
  scenePresetId: string;
  imageCount: number;
  imageSize: "square" | "portrait" | "landscape";

  // NEW
  generationType: RpGenerationType; // "product_only" | "on_model"

  // on_model-only (nullable)
  identityId?: string | null;
  faceArtifactId?: string | null;
  bodyArtifactId?: string | null;

  // optional stacking scales
  faceScale?: number;  // 0..1
  bodyScale?: number;  // 0..1
  productScale?: number; // 0..1

  // resolved prompt fields (recommended)
  resolvedPrompt?: string;
  resolvedNegativePrompt?: string;

  // status
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
```

**Validation rule**:
- If `generationType === "product_only"` → `identityId`, `faceArtifactId`, `bodyArtifactId` must be null/undefined.
- If `generationType === "on_model"` → `identityId` is required.

### 2.2 rp_scene_presets (add supportedModes)

Add to each scene preset:

```ts
export type RpScenePreset = {
  id: string;
  name: string; // "Ecommerce White"
  // existing prompt templates...
  promptTemplate: string;
  negativePromptTemplate?: string;

  // NEW
  supportedModes: RpGenerationType[]; // e.g. ["product_only","on_model"]

  defaultImageSize?: "square" | "portrait" | "landscape";
};
```

Seed rules:
- **Ecommerce White**: `["product_only","on_model"]`
- **Studio Editorial**: `["on_model"]`
- **Lifestyle Outdoor**: `["on_model"]`

---

## 3) UI — Generate tab changes (Products → /products/:slug → Generate)

### 3.1 Add “Generation Type” toggle (top of form)

Add a radio group or segmented control:

- Label: **Generation Type**
- Options:
  - **Product only**
  - **On model**
- Default: `on_model` (keep current behavior)

MUI suggestion:
- `ToggleButtonGroup` (preferred) or `RadioGroup`.

### 3.2 Conditional field rendering

#### If `generationType === "product_only"`:
- Hide/disable:
  - Identity selector
  - Face Artifact selector + Face Scale slider
  - Body Artifact selector + Body Scale slider
- Keep:
  - Scene Preset selector
  - Product Scale slider
  - Image Count
  - Image Size
- Add helper text:
  - “Product-only mode generates catalog-style product shots without any person.”

#### If `generationType === "on_model"`:
- Keep existing UI:
  - Identity required
  - Face/body artifacts optional
  - scales shown
  - Product scale shown

### 3.3 Scene preset filtering based on mode

In `Generate` UI, your presets dropdown should filter to:

```ts
presets.filter(p => p.supportedModes.includes(generationType))
```

If none:
- show a warning: “No presets support this mode. Seed presets or update supportedModes.”

---

## 4) Backend — Cloud Function updates

You already have:
- `generateProductAssets` — creates generation jobs with prompt resolution
- `onRpGenerationJobCreated` — fake worker producing placeholder assets

### 4.1 generateProductAssets (payload + validation)

Update request payload:

```ts
type GenerateProductAssetsRequest = {
  productId: string;
  scenePresetId: string;
  generationType: RpGenerationType;

  // only for on_model
  identityId?: string;
  faceArtifactId?: string;
  bodyArtifactId?: string;

  // optional
  imageCount?: number;
  imageSize?: "square" | "portrait" | "landscape";
  faceScale?: number;
  bodyScale?: number;
  productScale?: number;
};
```

Validation (Zod recommended):

```ts
const schema = z.object({
  productId: z.string().min(1),
  scenePresetId: z.string().min(1),
  generationType: z.enum(["product_only","on_model"]),
  identityId: z.string().optional(),
  faceArtifactId: z.string().optional(),
  bodyArtifactId: z.string().optional(),
  imageCount: z.number().int().min(1).max(12).default(4),
  imageSize: z.enum(["square","portrait","landscape"]).default("square"),
  faceScale: z.number().min(0).max(1).default(0.75),
  bodyScale: z.number().min(0).max(1).default(0.6),
  productScale: z.number().min(0).max(1).default(0.9),
}).superRefine((val, ctx) => {
  if (val.generationType === "on_model") {
    if (!val.identityId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "identityId required for on_model" });
  }
  if (val.generationType === "product_only") {
    if (val.identityId || val.faceArtifactId || val.bodyArtifactId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "identity/face/body not allowed in product_only" });
    }
  }
});
```

### 4.2 Prompt resolver: mode-aware templates

Create `resolveGenerationPrompts.ts` with:

```ts
type ResolvePromptArgs = {
  generationType: RpGenerationType;
  product: RpProduct;
  scenePreset: RpScenePreset;
  // on-model only:
  identity?: RpIdentity | null;
};

export function resolvePrompt(args: ResolvePromptArgs): { prompt: string; negative?: string } {
  if (args.generationType === "product_only") return resolveProductOnly(args);
  return resolveOnModel(args);
}
```

#### 4.2.1 Product-only prompt (recommended baseline)

**Prompt (example):**

```
Clean ecommerce product photography of a women's bikini-cut panty.
No person, no model, no mannequin.
Centered product, front view, accurate fabric texture, visible seams and stitching,
soft natural shadow, white seamless background, studio lighting, high resolution.
```

**Negative:**

```
person, model, body, legs, skin, mannequin, human, hands, torso, nude, lingerie model
```

#### 4.2.2 On-model prompt (existing behavior)

Use current scene preset + identity base tokens and include product wearing context.

---

## 5) Worker behavior

### 5.1 Fake worker (current) — add mode annotation

When `onRpGenerationJobCreated` creates placeholder assets, set:
- `asset.meta.generationType = job.generationType`

(Optionally: different placeholders for product_only vs on_model.)

### 5.2 Real worker (future) — model vs product pipeline

When you replace with fal.ai:
- `product_only` → endpoint/pipeline optimized for product shots
- `on_model` → LoRA stacking (face/body/product)

This spec only requires storing `generationType` so you can split later without schema changes.

---

## 6) Product-only scene presets (seed data)

Add/ensure the 3 presets have supportedModes.

Example JSON for seeding:

```js
[
  {
    name: "Ecommerce White",
    supportedModes: ["product_only","on_model"],
    defaultImageSize: "square",
    promptTemplate: "Ecommerce studio shot, clean white seamless background, commercial product photography, {{MODE_SPECIFIC_PROMPT}}",
    negativePromptTemplate: "{{MODE_SPECIFIC_NEGATIVE}}"
  },
  {
    name: "Studio Editorial",
    supportedModes: ["on_model"],
    defaultImageSize: "portrait",
    promptTemplate: "Studio editorial fashion photography, clean neutral background, {{MODE_SPECIFIC_PROMPT}}"
  },
  {
    name: "Lifestyle Outdoor",
    supportedModes: ["on_model"],
    defaultImageSize: "landscape",
    promptTemplate: "Outdoor lifestyle photography, daylight, shallow depth of field, {{MODE_SPECIFIC_PROMPT}}"
  }
]
```

Resolver expands `{{MODE_SPECIFIC_PROMPT}}` differently by mode.

---

## 7) UX copy (recommended)

- Product only helper: “Generates clean catalog shots of the product without a model.”
- On model helper: “Generates images of a selected identity wearing the product in the chosen scene.”

---

## 8) Implementation checklist (do in this order)

1. Types: add `RpGenerationType` + update `RpGenerationJob` and `RpScenePreset`.
2. Firestore: migrate/seed presets with `supportedModes`.
3. UI: toggle + conditional rendering + preset filtering.
4. Function: update `generateProductAssets` to accept `generationType`.
5. Prompt resolver: `resolvePrompt()` with product_only vs on_model branches.
6. Worker: store `generationType` on assets.
7. QA.

---

## 9) QA test plan

### Product-only
- Product → Generate → select **Product only**
- Preset: Ecommerce White → Generate
- Verify job has `generationType="product_only"` and no identity fields.

### On-model
- Select **On model**
- Identity: Amber + artifacts
- Generate and verify identity is set.

---

## 10) Future extension: “Blank overlay” realism (Phase 2+)

For perfect print realism (wrinkles/shadows/texture), add:
- base blank images (front/back) per base product + colorway
- a design PNG (transparent)
- a compositing step OR img2img/inpaint pipeline

Keep the same `generationType` and add:
- `productBlankFrontUrl`, `productBlankBackUrl`, `designPngUrl`
- `applyDesignMode: "composite" | "img2img" | "inpaint"`

---

## TL;DR

Add `generationType` (product_only | on_model), filter presets by supportedModes, hide identity/artifacts for product_only, and resolve prompts differently per mode.
