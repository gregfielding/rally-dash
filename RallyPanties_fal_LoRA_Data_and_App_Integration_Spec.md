# Rally Panties DesignOps — fal.ai LoRA Data + App Integration Spec (Cursor-Ready)

This document is the **complete system-of-record spec** for storing **all necessary fal.ai LoRA data** inside the Rally Panties DesignOps app, so we never “lose” an identity token (e.g., `rp_amber`) or LoRA weights URL again.

**Rule:** The browser UI is **not** the system of record. **Firestore is.**  
**Rule:** The fal.ai API key **must never** be used from the client. All fal calls go through **Cloud Functions**.

---

## 1) What “saving amberwoman” actually means

Amber is “saved” when these two things exist in Firestore:

1) An **Identity** doc with immutable `token`:
- `rp_identities/{identityId}.token = "rp_amber"`

2) A **LoRA Artifact** doc with the **weights URL** and **trigger phrase**:
- `rp_lora_artifacts/{loraId}.weightsUrl = "https://..._pytorch_lora_weights.safetensors"`
- `rp_lora_artifacts/{loraId}.triggerPhrase = "rp_amber"`

And ideally:
- `rp_identities/{identityId}.activeLoraId = loraId`

---

## 2) Store ALL fal.ai LoRA data (required fields)

### 2.1 Identity (`rp_identities/{identityId}`)

Required:
- `name: string` — "Amber"
- `token: string` — "rp_amber" (**immutable**)
- `status: "draft" | "collecting_images" | "training" | "active" | "retired"`

Active LoRA (so the app always knows what to use):
- `activeLoraId?: string`
- `activeTriggerPhrase?: string` — default `token`
- `activeLoraScaleDefault?: number` — default `0.65`
- `activeInferenceEndpoint?: string` — default `fal-ai/flux-lora` (or whichever you standardize)

Denormalized counts:
- `faceImageCount: number`
- `upperBodyCount: number`
- `fullBodyCount: number`

Audit:
- `createdAt: Timestamp`
- `updatedAt: Timestamp`

---

### 2.2 Dataset (`rp_datasets/{datasetId}`)

Required:
- `identityId: string`
- `name: string` — "Amber Face v1"
- `type: "face" | "upper_body" | "full_body" | "mixed"`
- `targetImageCount: number` — (20+ recommended for face)
- `status: "draft" | "ready" | "archived"`

Dataset versioning / change detection (for zip caching):
- `contentHash?: string` — computed hash of approved image paths + sizes
- `lastZipStoragePath?: string`
- `lastZipSignedUrl?: string`
- `lastZipCreatedAt?: Timestamp`

Audit:
- `createdAt: Timestamp`
- `updatedAt: Timestamp`

---

### 2.3 Dataset Images (`rp_dataset_images/{imageId}`)

Required:
- `datasetId: string`
- `identityId: string`
- `storagePath: string`
- `downloadUrl: string`
- `kind: "face" | "upper_body" | "full_body"`
- `source: "fal_inference" | "midjourney" | "manual_upload"`
- `isApproved: boolean`
- `createdAt: Timestamp`

Optional (but strongly recommended for reproducibility):
- `prompt?: string`
- `negativePrompt?: string`
- `seed?: number`
- `scale?: number`
- `steps?: number`
- `loraId?: string`
- `falInferenceRequestId?: string`

---

## 3) Training Jobs: Store ALL fal training data

### 3.1 Training Job (`rp_training_jobs/{jobId}`)

Required inputs:
- `identityId: string`
- `datasetId: string`
- `provider: "fal"`
- `trainerEndpoint: string`  
  Example: `fal-ai/flux-lora-portrait-trainer` (or `fal-ai/flux-lora-fast-training`)
- `triggerPhrase: string`  
  **Always store** (standardize to identity token like `rp_amber`)
- `status: "queued" | "running" | "completed" | "failed"`

Strongly recommended inputs/settings:
- `steps?: number` (example 2000)
- `learningRate?: number` (example 0.0002)
- `seed?: number` (if available)
- `captioningMode?: "none" | "auto"` (if you add captions later)

fal request tracking (must-have):
- `falRequestId?: string` — the provider job id / request id returned by fal
- `falRequestPayload?: Record<string, any>` — store sanitized payload (no secrets)
- `falResponseMeta?: Record<string, any>` — store status responses from fal polling

Timings:
- `startedAt?: Timestamp`
- `completedAt?: Timestamp`

Failure info:
- `error?: string`

Outputs (must-have on completion):
- `loraWeightsUrl?: string` — the `.safetensors` URL
- `previewImageUrls?: string[]` — any previews the trainer returns
- `outputFiles?: Array<{ name: string; url: string }>` — if fal provides multiple files

Optional but recommended:
- `loraWeightsStoragePath?: string` — if mirrored into Firebase Storage
- `logsUrl?: string` — if trainer exposes logs

---

## 4) LoRA Artifacts: Store ALL “use this LoRA” data

### 4.1 LoRA Artifact (`rp_lora_artifacts/{loraId}`)

Required:
- `identityId: string`
- `trainingJobId: string`
- `provider: "fal"`
- `weightsUrl: string` — `.safetensors` URL from fal
- `triggerPhrase: string` — usually `rp_amber`
- `status: "active" | "inactive" | "archived"`

Recommended:
- `name: string` — "Amber LoRA v1"
- `trainerEndpoint: string`
- `datasetId: string`
- `recommendedScaleMin: number` — 0.45
- `recommendedScaleMax: number` — 0.75
- `defaultScale: number` — 0.65
- `notes?: string`

Optional:
- `weightsStoragePath?: string` — if mirrored
- `qualityRating?: number` — 1–5 internal rating
- `testPrompt?: string` — a canonical prompt you always run

Audit:
- `createdAt: Timestamp`

---

## 5) Inference Generations: Store ALL fal inference data

### 5.1 Generation (`rp_generations/{genId}`)

Required:
- `identityId: string`
- `loraId: string`
- `provider: "fal"`
- `endpoint: string` — ex `fal-ai/flux-lora`
- `prompt: string`
- `scale: number`
- `resultImageUrls: string[]`
- `createdAt: Timestamp`

Strongly recommended:
- `negativePrompt?: string`
- `steps?: number`
- `seed?: number`
- `imageSize?: { w: number; h: number }`
- `numImages?: number`

fal request tracking (must-have):
- `falRequestId?: string`
- `falRequestPayload?: Record<string, any>` (sanitized)
- `falResponseMeta?: Record<string, any>`

Optional:
- `mirroredStoragePaths?: string[]` — if you copy images to Storage
- `selectedAsHero?: boolean`
- `addedToDatasetId?: string` — if user chooses “Add to Dataset”
- `savedToReferenceLibrary?: boolean`

---

## 6) Backend-only fal.ai integration (Cloud Functions Gen2)

### 6.1 Secrets / config

Store the fal API key in a secure location:
- **Preferred:** Google Secret Manager + Gen2 functions secrets
- **Alternative:** functions config env (less ideal)

**Never expose fal key to the React app.**

---

### 6.2 Required Cloud Functions (HTTP or Callable)

#### A) `createDatasetZip(datasetId)`
Purpose: zip approved dataset images, upload zip to Storage, return signed URL for fal.

Inputs:
- `datasetId: string`

Outputs:
- `zipStoragePath: string`
- `zipSignedUrl: string`
- `contentHash: string`

Rules:
- Only include images where `isApproved == true`
- For face datasets, warn/block if `< 15`, recommend `>= 20`

---

#### B) `startFalLoraTraining({ identityId, datasetId, trainerEndpoint, triggerPhrase, steps, learningRate })`
Purpose: create Firestore training job, call fal trainer, store fal request id.

Inputs:
- `identityId: string`
- `datasetId: string`
- `trainerEndpoint: string`
- `triggerPhrase: string` (default identity token)
- `steps?: number`
- `learningRate?: number`

Outputs:
- `jobId: string`
- `falRequestId: string`

Must do:
- Create `rp_training_jobs/{jobId}` with `status="queued"` then `"running"`
- Persist `falRequestId`
- Persist sanitized request payload (no secrets)

---

#### C) `pollFalTrainingJob({ jobId })`
Purpose: poll fal status and finalize job.

Inputs:
- `jobId: string`

Outputs:
- `{ status: "...", loraWeightsUrl?: string }`

Must do on completion:
- Save `loraWeightsUrl`
- Save previews / output files
- Create `rp_lora_artifacts/{loraId}`
- Optionally mirror weights into Storage
- Set `rp_identities.activeLoraId = loraId` (if desired default behavior)

---

#### D) `runFalInference({ identityId, loraId, endpoint, prompt, negativePrompt, scale, steps, seed, numImages, imageSize })`
Purpose: run inference and persist all generation data.

Inputs:
- `identityId: string`
- `loraId: string`
- `endpoint: string` (default `fal-ai/flux-lora`)
- `prompt: string`
- `negativePrompt?: string`
- `scale: number` (default 0.65)
- `steps?: number`
- `seed?: number`
- `numImages?: number`
- `imageSize?: { w: number; h: number }`

Outputs:
- `genId: string`
- `resultImageUrls: string[]`

Must do:
- Persist `falRequestId`, request payload (sanitized), response meta
- Save `resultImageUrls`
- Optionally mirror images to Storage for long-term stable URLs

---

## 7) UI: New “LoRA Training” tab (what to build)

### 7.1 Identity page additions (Amber)
- Show `token` with copy button
- Show Active LoRA with:
  - `name`
  - `weightsUrl` (copy)
  - `defaultScale` slider (writes to `activeLoraScaleDefault`)
- Buttons:
  - **Upload / Approve Images**
  - **Create Dataset**
  - **Start Training**
  - **Open Playground**

### 7.2 Training Jobs page
- Table: identity, dataset, endpoint, triggerPhrase, status, started, completed
- Actions:
  - Poll status
  - View output files
  - Create artifact (if not auto)
  - Set active LoRA

### 7.3 Playground (Inference)
- Identity selector
- LoRA selector (default active)
- Prompt presets dropdown
- Scale slider
- Run button
- Results gallery with actions:
  - **Save to Reference Library**
  - **Add to Dataset**

---

## 8) “Option B”: Adding body images next

**Best practice:** Train face identity first, then either:
- **Option B1 (recommended):** Make a **separate dataset + separate LoRA** for body/fashion poses (“Amber Body v1”), so you don’t distort face identity.
- **Option B2:** If you must do one LoRA, only add body images after you have 30–60 high-quality images and you are okay with some drift.

### Body dataset minimums (starter)
- 20–40 full-body images
- variety of:
  - standing, walking, sitting
  - different outfits
  - indoor/outdoor
- avoid:
  - extreme stylization
  - heavy face occlusion (sunglasses, masks) unless that’s part of identity

---

## 9) Acceptance Criteria (must pass)

- You can create Identity `rp_amber`
- You can upload/approve a dataset of ≥20 face images
- You can start training from inside the app and store `falRequestId`
- You can poll to completion and store `weightsUrl`
- A LoRA Artifact doc is created with `weightsUrl` + `triggerPhrase`
- Identity can select this artifact as active
- Playground inference stores prompts/settings/results and can “save” a liked image into Reference Library / Dataset

---

## 10) Copy/paste seed values for Amber

Identity:
- `name`: Amber
- `token`: `rp_amber`
- `activeLoraScaleDefault`: 0.65
- `activeInferenceEndpoint`: `fal-ai/flux-lora`

First Face dataset:
- `name`: Amber Face v1
- `type`: face
- `targetImageCount`: 20

First training job params:
- `trainerEndpoint`: `fal-ai/flux-lora-portrait-trainer`
- `triggerPhrase`: `rp_amber`
- `steps`: 2000
- `learningRate`: 0.0002

LoRA artifact defaults:
- `recommendedScaleMin`: 0.45
- `recommendedScaleMax`: 0.75
- `defaultScale`: 0.65
