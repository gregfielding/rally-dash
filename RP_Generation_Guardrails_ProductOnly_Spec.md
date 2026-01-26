# Rally Panties DesignOps — Generation Guardrails + Product-Only Packshots (Cursor-Ready “Build This Exactly” Spec)
Owner: Rally Panties DesignOps  
App: Rally Panties DesignOps (React + Firebase + Cloud Functions)  
AI/Image provider: fal.ai (flux-lora) via Cloud Functions  
Last updated: 2026-01-20

---

## 0) Why this spec exists (problem statement)
You are seeing three failure modes in generated assets:

1) **Identity drift**: “Amber” outputs a generic blonde model that doesn’t match the trained Amber LoRA.
2) **Wardrobe failures**: “underwear” prompts sometimes produce topless/nude outputs.
3) **Wrong subject**: sometimes a male model appears due to weak subject constraints.

This spec introduces:
- **ScenePreset.mode**: `onModel` vs `productOnly`
- **Guardrail prompt clamping** for underwear categories and `onModel` presets
- **Identity locking rules** (scale defaults, resolver composition, debug visibility)
- **UI behavior**: hide identity/artifacts for `productOnly`, require identity for `onModel`
- **Seed presets**: Product Packshot White + Improved on-model underwear presets
- **Developer diagnostics**: store `resolvedPrompt`, `resolvedNegativePrompt`, `resolvedLoras` and a human-readable `resolverTrace`

This is designed to be implemented incrementally without breaking existing Product System workflows.

---

## 1) High-level workflow (end state)
### 1.1 On-model generation (Amber wearing product)
**User flow**
1. Open Product → Generate tab
2. Choose Scene Preset with `mode=onModel` (e.g., “Studio Editorial – On Model”)
3. Select Identity (required) (e.g., Amber)
4. Select Face Artifact (optional but recommended)
5. Select Body Artifact (optional)
6. Set scales (defaults apply)
7. Click Generate

**System behavior**
- Prompt resolver injects:
  - Identity trigger token (e.g., `rp_amber`)
  - Gender constraints and wardrobe constraints
  - Nudity-negative prompt clamp
- Generation job records:
  - resolved prompt, negative prompt, lora list with weights
  - trace of how resolver composed the final prompt

### 1.2 Product-only packshots (no model)
**User flow**
1. Open Product → Generate tab
2. Choose Scene Preset with `mode=productOnly` (e.g., “Product Packshot White”)
3. Identity + face/body artifact selectors are hidden/disabled
4. Click Generate

**System behavior**
- Prompt resolver enforces “no model, no person, no mannequin” negative prompt
- Uses product-only template, optionally with a product LoRA trigger if available
- Results are stored as assets with `assetType=productPackshot`

---

## 2) Data model changes (Firestore + TypeScript)

### 2.1 Scene Preset schema changes
**Collection**: `rp_scene_presets/{presetId}`

Add fields:
```ts
export type RpScenePresetMode = "onModel" | "productOnly";

export interface RpScenePreset {
  id: string;
  name: string;
  slug: string; // unique
  description?: string;

  mode: RpScenePresetMode; // NEW

  // Existing:
  size: "square" | "portrait" | "landscape";
  promptTemplate: string;
  negativePromptTemplate?: string;

  // NEW guardrail toggles:
  requireIdentity?: boolean; // defaults: true for onModel, false for productOnly
  allowFaceArtifact?: boolean; // defaults: true for onModel
  allowBodyArtifact?: boolean; // defaults: true for onModel
  allowProductArtifact?: boolean; // defaults: true

  // NEW defaults
  defaultFaceScale?: number; // recommend 0.80 for onModel
  defaultBodyScale?: number; // recommend 0.60 for onModel
  defaultProductScale?: number; // recommend 0.90
  defaultImageCount?: number; // recommend 4
  defaultSeed?: string | null;

  // NEW safety
  safetyProfile?: "none" | "underwear_strict" | "general_safe"; // see clamp logic
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
```

**Migration behavior**
- Existing presets should be migrated to include:
  - `mode="onModel"` (unless they are obviously product-only; but safe default is onModel)
  - `requireIdentity=true`, `allowFaceArtifact=true`, `allowBodyArtifact=true`, `allowProductArtifact=true`
  - `safetyProfile="general_safe"`
  - `defaultFaceScale=0.75`, `defaultBodyScale=0.60`, `defaultProductScale=0.90`

### 2.2 Generation Job schema additions (debug + clamps)
**Collection**: `rp_generation_jobs/{jobId}`

Add:
```ts
export interface RpResolvedLora {
  artifactId: string;
  type: "face" | "body" | "product";
  weight: number;
  trigger?: string; // optional (for debugging)
}

export interface RpGenerationJob {
  id: string;
  productId: string;
  productSlug: string;
  presetId: string;
  presetMode: "onModel" | "productOnly"; // store snapshot

  identityId?: string | null; // optional for productOnly
  faceArtifactId?: string | null;
  bodyArtifactId?: string | null;
  productArtifactId?: string | null;

  faceScale?: number;
  bodyScale?: number;
  productScale?: number;

  imageCount: number;
  size: "square" | "portrait" | "landscape";
  seed?: string | null;

  // NEW — final resolved values saved for postmortem/debug
  resolvedPrompt: string;
  resolvedNegativePrompt: string;
  resolvedLoras: RpResolvedLora[];
  resolverTrace: string[]; // human-readable steps

  // Existing status fields:
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  error?: { message: string; code?: string } | null;
}
```

### 2.3 Asset schema improvements (type/intent)
**Collection**: `rp_product_assets/{assetId}` (or per-product subcollection if you used that)

Add:
```ts
export type RpAssetType =
  | "onModelImage"
  | "productPackshot"
  | "lifestyleImage"
  | "socialPost"
  | "videoShort"
  | "other";

export interface RpProductAsset {
  id: string;
  productId: string;
  jobId?: string;
  assetType: RpAssetType; // NEW
  status: "draft" | "approved" | "published";
  storagePath?: string;
  publicUrl?: string;
  width?: number;
  height?: number;

  // helpful metadata
  identityId?: string | null;
  presetId?: string;
  presetMode?: "onModel" | "productOnly";
  createdAt: FirebaseFirestore.Timestamp;
}
```

---

## 3) Prompt resolver “guardrails” (must implement)
**File**: `functions/src/rp/promptResolver.ts` (or your chosen path)

### 3.1 Resolver inputs
```ts
export interface ResolvePromptInput {
  product: RpProduct;
  preset: RpScenePreset;
  identity?: RpIdentity | null;
  faceArtifact?: RpLoraArtifact | null;
  bodyArtifact?: RpLoraArtifact | null;
  productArtifact?: RpLoraArtifact | null;

  faceScale?: number;
  bodyScale?: number;
  productScale?: number;

  // optional overrides for testing
  additionalPrompt?: string;
  additionalNegativePrompt?: string;
}
```

### 3.2 Resolver outputs
```ts
export interface ResolvePromptOutput {
  prompt: string;
  negativePrompt: string;
  loras: RpResolvedLora[];
  trace: string[];
}
```

### 3.3 Token conventions
- **Identity trigger phrase**: stored on identity record (e.g., `identity.triggerPhrase = "rp_amber"`)
- **Product trigger phrase**: stored on product record (optional; e.g., `rp_sfg_panty_1` once product LoRA exists)
- Scene template tokens:
  - `{productName}`
  - `{productColorway}`
  - `{productCategory}`
  - `{identityTrigger}` (only if identity exists)
  - `{identityDescriptor}` (optional)
  - `{designDescriptor}` (optional)
  - `{printMethod}`, `{placement}`, `{inkColors}` (optional, if design selected)

### 3.4 Guardrail clamp rules (core)
#### Rule A — preset.mode enforcement
- If `preset.mode === "productOnly"`:
  - Ignore identity, face/body artifacts even if provided
  - Add to negative prompt: `person, model, mannequin, body, hands, legs, torso, wearing`
  - Add to positive prompt: `no model, no person, product only, laid flat or floating packshot`
  - Set `trace += ["preset.mode=productOnly → stripped identity + face/body artifacts"]`

- If `preset.mode === "onModel"`:
  - Require identity if `preset.requireIdentity !== false`
  - Add gender/subject constraints:
    - Positive: `adult woman, female model`
    - Negative: `man, male, boy`
  - `trace += ["preset.mode=onModel → enforced female subject constraints"]`

#### Rule B — underwear strict safety profile
Trigger condition:
- `preset.safetyProfile === "underwear_strict"`
  OR `product.category in ["panties", "underwear", "lingerie"]` AND `preset.mode === "onModel"`

Then clamp:
- Positive wardrobe constraints:
  - `wearing matching bra or bralette and panties, fully covered, no nudity`
- Negative nudity constraints:
  - `nude, topless, nipples, areola, exposed breasts, naked, explicit`
- `trace += ["underwear_strict clamp applied (wardrobe + nudity negative)"]`

#### Rule C — identity locking hint
If `identity` exists:
- Ensure the **identity trigger** appears early (front-loaded):
  - Start prompt with: `{identityTrigger}, {identityDescriptor}`
- `trace += ["identity trigger front-loaded"]`

#### Rule D — scale defaults
If missing:
- use preset defaults
- else fallback to global defaults:
  - onModel: face=0.80, body=0.60, product=0.90
  - productOnly: product=1.0 (or 0.9), face/body unused

Store these values back to job doc.

### 3.5 Implementation pseudocode (build this)
```ts
export function resolvePrompt(input: ResolvePromptInput): ResolvePromptOutput {
  const trace: string[] = [];
  const loras: RpResolvedLora[] = [];

  const { product, preset } = input;

  let prompt = preset.promptTemplate;
  let negative = preset.negativePromptTemplate ?? "";

  const mode = preset.mode ?? "onModel";

  // 1) Apply mode rules
  if (mode === "productOnly") {
    trace.push("preset.mode=productOnly → stripped identity + face/body artifacts");
    // strip identity/face/body
    // add product-only constraints
    prompt = `clean ecommerce packshot, product only, ${prompt}`;
    negative = joinNeg(negative, "person, model, mannequin, body, hands, legs, torso, wearing");
  } else {
    trace.push("preset.mode=onModel → enforced female subject constraints");
    prompt = joinPos("adult woman, female model", prompt);
    negative = joinNeg(negative, "man, male, boy");
  }

  // 2) Identity injection (onModel only)
  if (mode === "onModel") {
    if ((preset.requireIdentity ?? true) && !input.identity) {
      throw new Error("Identity required for this preset");
    }
    if (input.identity) {
      const trig = input.identity.triggerPhrase;
      prompt = joinPos(`${trig}, blonde hair, blue-green eyes`, prompt);
      trace.push("identity trigger front-loaded");
    }
  }

  // 3) Underwear strict clamp
  const isUnderwear = ["panties", "underwear", "lingerie"].includes(product.category);
  const strict = preset.safetyProfile === "underwear_strict" || (isUnderwear && mode === "onModel");
  if (strict) {
    prompt = joinPos("wearing matching bra or bralette and panties, fully covered, no nudity", prompt);
    negative = joinNeg(negative, "nude, topless, nipples, areola, exposed breasts, naked, explicit");
    trace.push("underwear_strict clamp applied (wardrobe + nudity negative)");
  }

  // 4) Lora stacking
  // Only include face/body if onModel and allowed
  if (mode === "onModel") {
    if ((preset.allowFaceArtifact ?? true) && input.faceArtifact) {
      loras.push({ artifactId: input.faceArtifact.id, type: "face", weight: clamp01(input.faceScale ?? preset.defaultFaceScale ?? 0.80) });
    }
    if ((preset.allowBodyArtifact ?? true) && input.bodyArtifact) {
      loras.push({ artifactId: input.bodyArtifact.id, type: "body", weight: clamp01(input.bodyScale ?? preset.defaultBodyScale ?? 0.60) });
    }
  }

  // product LoRA allowed in both modes
  if ((preset.allowProductArtifact ?? true) && input.productArtifact) {
    loras.push({ artifactId: input.productArtifact.id, type: "product", weight: clamp01(input.productScale ?? preset.defaultProductScale ?? 0.90) });
  }

  // 5) Append caller-specified overrides (rare)
  if (input.additionalPrompt) prompt = joinPos(prompt, input.additionalPrompt);
  if (input.additionalNegativePrompt) negative = joinNeg(negative, input.additionalNegativePrompt);

  // 6) Token replacements
  prompt = prompt
    .replaceAll("{productName}", product.name)
    .replaceAll("{productColorway}", product.colorwayName ?? "")
    .replaceAll("{productCategory}", product.category ?? "");

  // 7) Cleanup
  prompt = normalize(prompt);
  negative = normalize(negative);

  return { prompt, negativePrompt: negative, loras, trace };
}
```

Helper requirements:
- `joinPos(a,b)` ensures comma separation and no doubles
- `joinNeg(a,b)` same
- `normalize()` trims, collapses whitespace, removes duplicate commas
- `clamp01(n)` clamps 0..1 and rounds to 2 decimals

---

## 4) Cloud Functions updates

### 4.1 `generateProductAssets` must save resolved prompt + trace
**File**: `functions/src/rp/generateProductAssets.ts`

Responsibilities:
1. Load product, preset, identity (optional), artifacts (optional)
2. Call `resolvePrompt()`
3. Create `rp_generation_jobs` doc including:
   - `resolvedPrompt`, `resolvedNegativePrompt`, `resolvedLoras`, `resolverTrace`
   - `presetMode` snapshot
4. Enqueue worker (real or fake)
5. Return `{jobId}`

### 4.2 Worker must never create explicit content
Even if prompts drift, the worker should:
- Reject if resolved prompt contains forbidden nudity tokens OR if no negative prompt includes “nude/topless” for underwear
- Mark job failed with error `SAFETY_GUARDRAIL_BLOCKED`

This ensures we don’t store bad outputs.

### 4.3 Add “productOnly packshot” preset seeding
Add seed script updates:
- `Product Packshot White` (mode=productOnly)
- `Underwear Studio On-Model` (mode=onModel, safetyProfile=underwear_strict)
- Update existing presets to include `mode` and default scales

---

## 5) Frontend UI changes (Generate tab)

### 5.1 Generate form behavior
**File**: `src/pages/products/ProductGenerateTab.tsx` (or your actual path)

When preset selected:
- If `preset.mode === "productOnly"`:
  - Hide Identity dropdown
  - Hide Face Artifact + Face Scale
  - Hide Body Artifact + Body Scale
  - Disable these values in state (set to null)
  - Set help text: “Product-only packshot (no model)”

- If `preset.mode === "onModel"`:
  - Identity dropdown required (unless preset.requireIdentity=false)
  - Face/body selectors visible per allowFaceArtifact/allowBodyArtifact
  - Default slider values from preset defaults

### 5.2 Add “Output Type” chips (optional but recommended)
Display a chip in the form:
- `On-Model` or `Product Only`

### 5.3 Add “Debug” collapsible panel (developer-only)
Show:
- resolvedPrompt
- resolvedNegativePrompt
- resolvedLoras (artifact ids + weights)
- resolverTrace list

Only visible if:
- `process.env.NODE_ENV !== "production"` OR user is admin

This will dramatically speed up iteration.

---

## 6) “Amber doesn’t look like Amber” — enforced settings
### 6.1 Default scales (onModel)
These are the recommended defaults to reduce drift:
- Face scale: **0.80**
- Body scale: **0.60**
- Product scale: **0.90**

### 6.2 Identity descriptor policy
Do **not** overload the prompt with competing identity descriptors. Use only:
- `rp_amber, blonde hair, blue-green eyes`

Avoid adding “freckles, big smile, etc.” in presets unless you want to override Amber.

---

## 7) Prevent male models by construction
When `mode=onModel`, always clamp:
- Positive: `adult woman, female model`
- Negative: `man, male, boy`

This alone prevents most male outputs.

---

## 8) Firestore rules updates
Update rules to allow reading presets and jobs, writing jobs/assets for admin users.

Example (pseudo):
- `rp_scene_presets`: read for authenticated users, write for admin
- `rp_generation_jobs`: read for admin, create for admin
- `rp_product_assets`: read for admin, write for worker/admin

---

## 9) Acceptance tests (manual + automated)

### 9.1 Manual checks (must pass)
1. Select `Product Packshot White`:
   - Identity selector hidden
   - Generated images contain no people
2. Select `Underwear Studio On-Model`:
   - Identity required
   - Generated images always show bra/bralette + panties (no topless)
3. Identity drift:
   - If face scale=0.80, most images match Amber
   - Lowering face scale should increase drift (expected)

### 9.2 Automated unit tests (functions)
Create tests for:
- resolvePrompt:
  - productOnly strips identity/artifacts
  - underwear_strict adds wardrobe + nudity negatives
  - onModel clamps female subject & negative male
- generateProductAssets:
  - job doc includes resolved fields

---

## 10) Implementation plan (do in order)

### Phase 1 — Schema + resolver + seed presets (1–2 PRs)
- Add `mode`, `safetyProfile`, default scales to presets
- Implement `resolvePrompt()`
- Update `generateProductAssets` to store resolved values
- Seed `Product Packshot White` + update underwear onModel preset

### Phase 2 — UI behavior (1 PR)
- Modify Generate tab:
  - hide/show identity/artifacts based on preset.mode
  - use preset defaults
- Add Debug panel

### Phase 3 — Worker safety hard block (1 PR)
- Add guardrail checks in worker
- Fail jobs safely if unsafe

---

## 11) Seed preset definitions (copy/paste)

### 11.1 Product Packshot White (productOnly)
```json
{
  "name": "Product Packshot White",
  "slug": "product-packshot-white",
  "mode": "productOnly",
  "size": "square",
  "safetyProfile": "general_safe",
  "requireIdentity": false,
  "allowFaceArtifact": false,
  "allowBodyArtifact": false,
  "allowProductArtifact": true,
  "defaultProductScale": 0.95,
  "defaultImageCount": 4,
  "promptTemplate": "clean ecommerce packshot of {productName} ({productColorway}), laid flat, centered, pure white background, soft studio shadow, high detail fabric texture, realistic stitching, product only, no model, no person",
  "negativePromptTemplate": "person, model, mannequin, body, wearing, hands, legs, torso, lifestyle scene, clutter, text overlay, watermark"
}
```

### 11.2 Underwear Studio On-Model (onModel, strict)
```json
{
  "name": "Underwear Studio On-Model",
  "slug": "underwear-studio-on-model",
  "mode": "onModel",
  "size": "square",
  "safetyProfile": "underwear_strict",
  "requireIdentity": true,
  "allowFaceArtifact": true,
  "allowBodyArtifact": true,
  "allowProductArtifact": true,
  "defaultFaceScale": 0.80,
  "defaultBodyScale": 0.60,
  "defaultProductScale": 0.90,
  "defaultImageCount": 4,
  "promptTemplate": "{identityTrigger}, adult woman, female model, studio lighting, clean neutral background, wearing matching bra or bralette and panties, fully covered, no nudity, commercial fashion photography, realistic skin texture",
  "negativePromptTemplate": "nude, topless, nipples, areola, exposed breasts, naked, explicit, man, male, boy, porn, sexual act, fetish, watermark, text overlay"
}
```

---

## 12) Notes for Cursor
- Keep changes small and testable.
- Ensure every job stores resolvedPrompt and resolverTrace.
- Don’t rely on “remembering” Amber via prose; always include the trigger token.
- Treat `productOnly` as a first-class mode, not a hack.

---

## 13) Definition of done (DOD)
- ✅ `Product Packshot White` generates product-only images with no humans
- ✅ `Underwear Studio On-Model` never generates topless/nude outputs
- ✅ On-model outputs consistently match Amber when face scale >= 0.80
- ✅ Generation job docs include resolvedPrompt/resolvedNegativePrompt/resolvedLoras/resolverTrace
- ✅ Generate tab UI hides identity/artifacts for productOnly presets and requires identity for onModel
