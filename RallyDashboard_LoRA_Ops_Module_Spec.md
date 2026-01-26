# Rally Dashboard — LoRA Ops Module Spec (v1)

Owner: Rally Panties  
App: **Rally Dashboard** (Next.js + Firebase Auth + Firestore + Cloud Storage + Cloud Functions Gen2)  
Goal: Provide an internal, scalable **Model Pack (LoRA) Operations Console** to create, manage, train, version, and use “Rally Girls” packs (Amber, Maya, etc.) and their supporting datasets.

---

## 0) Design Principles

1. **System of record lives in Google Cloud**  
   - Firestore = metadata + workflow state  
   - Cloud Storage = all assets (faces, references, zips, outputs)  
   - Cloud Functions = automation & orchestration

2. **Immutable outputs**  
   - A trained LoRA (“pack version”) is immutable once `status=ready`.  
   - To change anything, create a **new version** (Pack A v2).

3. **Separation of concerns**
   - **Identity** = reusable character definition (Amber, Maya) + face gallery
   - **Reference library** = scene/pose/background references (tailgate, stadium)
   - **Training dataset** = generated zip + captions that combine identities + references
   - **Training job** = provider job + status + result model id

4. **Provider-agnostic (but start with fal)**
   - Data model supports `provider = "fal" | "replicate" | "runpod"`.
   - v1 implements `fal` only.

5. **No LoRA training “inside” the browser**
   - Training is always kicked off from Cloud Functions.
   - UI only uploads assets and triggers functions.

---

## 1) Firebase Products & GCP Services

- Firebase Auth (Google provider)
- Firestore (Native mode)
- Cloud Storage (single bucket)
- Cloud Functions (Gen2, Node.js 20)
- Cloud Scheduler (optional for polling)
- Secret Manager (store provider API keys)

---

## 2) Cloud Storage Layout (Required)

Bucket: `gs://rally-dashboard-prod` (or dev)

### 2.1 Model pack assets
```
/modelpacks/{packId}/
  /identities/{identityId}/
    /faces/
      face_0001.jpg
      face_0002.jpg
      ...
    /notes/ (optional)
  /datasets/{datasetId}/
    dataset.zip
    manifest.json
  /training/{trainingJobId}/
    provider_payload.json
    logs.txt (optional)
```

### 2.2 Reference library
```
/reference_library/{category}/{refId}.jpg
/reference_library/{category}/{refId}.json  (optional sidecar)
```

### 2.3 Outputs (optional)
```
/generated/lifestyle/{packId}/{runId}/img_0001.jpg
/generated/lifestyle/{packId}/{runId}/img_0002.jpg
```

---

## 3) Firestore Data Model (Required)

### 3.1 Collections overview
- `model_packs/{packId}`
- `model_packs/{packId}/identities/{identityId}`
- `reference_images/{refId}`
- `training_datasets/{datasetId}`
- `training_jobs/{trainingJobId}`
- `audit_logs/{logId}` (optional but recommended)

> **Note:** Keep top-level collections shallow for easy querying.

---

### 3.2 `model_packs/{packId}`
Represents a LoRA “pack” and its version.

**Fields**
- `packName: string` (e.g., "Pack A — Core")
- `packKey: string` (e.g., "pack_a_core") — stable identifier
- `version: string` (e.g., "v1", "v2")
- `provider: "fal" | "replicate" | "runpod"`
- `status: "draft" | "dataset_ready" | "training" | "ready" | "failed" | "archived"`
- `loraModelId: string | null` (provider model identifier once trained)
- `loraModelVersion: string | null` (provider version/tag if applicable)
- `recommendedPrompt: string` (brand style prompt snippet)
- `negativePrompt: string` (optional)
- `createdAt: Timestamp`
- `createdByUid: string`
- `updatedAt: Timestamp`
- `notes: string` (optional)
- `identityCount: number`
- `faceImageCount: number`
- `datasetIdActive: string | null` (points to current dataset used for training)
- `lastTrainingJobId: string | null`

**Indexes**
- Composite: `packKey + version`
- Simple: `status`, `provider`

---

### 3.3 `model_packs/{packId}/identities/{identityId}`
A reusable character inside a pack (Amber, Maya, etc.)

**Fields**
- `name: string` (internal name, e.g., "Amber")
- `token: string` (trigger token, e.g., "rp_amber")
- `bodyType: "petite" | "athletic" | "curvy" | "plus" | "tall" | "average" | "other"`
- `ageRange: "21-29" | "30-39" | "40-49" | "50+" | "unspecified"`
- `ethnicity: string` (free text, internal)
- `styleVibe: string` (e.g., "sporty girl-next-door")
- `status: "draft" | "faces_complete" | "needs_more_faces" | "archived"`
- `faceImagePaths: string[]` (optional; can omit if you prefer to list via Storage)
- `faceImageCount: number`
- `poseCoverage: { front: boolean, threeQuarter: boolean, profile: boolean, smile: boolean }` (optional)
- `createdAt: Timestamp`
- `updatedAt: Timestamp`

**Rules**
- `token` must be unique within a pack.

---

### 3.4 `reference_images/{refId}`
Pose/scene references (no identity binding).

**Fields**
- `category: "stadium" | "tailgate" | "sportsbar" | "streetwear" | "winter" | "studio" | "other"`
- `tags: string[]` (e.g., ["baseball", "daylight", "3-person"])
- `gcsPath: string` (e.g., "reference_library/stadium/abc123.jpg")
- `source: "stock" | "self" | "ai_generated" | "other"`
- `safeToUse: boolean`
- `notes: string`
- `createdAt: Timestamp`
- `createdByUid: string`

---

### 3.5 `training_datasets/{datasetId}`
Generated dataset zip + captions used for training.

**Fields**
- `packId: string`
- `status: "building" | "ready" | "failed" | "archived"`
- `zipGcsPath: string | null`
- `manifestGcsPath: string | null`
- `faceImageCount: number`
- `identityCount: number`
- `groupImageCount: number`
- `referenceImageCount: number`
- `captionStyle: "simple_tokens" | "detailed"`
- `buildOptions: {
    perIdentityFaceMin: number,
    includeGroupShots: boolean,
    groupShotCountTarget: number,
    referenceCategoryMix: Record<string, number>
  }`
- `createdAt: Timestamp`
- `createdByUid: string`
- `error: { message: string, stack?: string } | null`

---

### 3.6 `training_jobs/{trainingJobId}`
A provider training run.

**Fields**
- `packId: string`
- `datasetId: string`
- `provider: "fal"`
- `status: "queued" | "running" | "succeeded" | "failed" | "canceled"`
- `providerJobId: string`
- `providerModelId: string | null`
- `providerModelVersion: string | null`
- `requestedAt: Timestamp`
- `startedAt: Timestamp | null`
- `finishedAt: Timestamp | null`
- `progress: number | null` (0-100)
- `logs: string[]` (small; avoid huge payloads)
- `result: { loraArtifactUrl?: string, modelId?: string } | null`
- `error: { message: string, code?: string, raw?: any } | null`

---

### 3.7 Optional: `audit_logs/{logId}`
Capture operator actions (recommended for scale).

**Fields**
- `actorUid: string`
- `action: string` (e.g., "IDENTITY_FACE_UPLOADED", "DATASET_BUILT", "TRAINING_STARTED")
- `entityType: "model_pack" | "identity" | "reference_image" | "training_dataset" | "training_job"`
- `entityId: string`
- `createdAt: Timestamp`
- `metadata: Record<string, any>`

---

## 4) Security Model (Firebase Auth + RBAC)

### 4.1 Roles
Use a simple Firestore doc:
- `admins/{uid}` with `{ role: "admin" | "editor" | "viewer" }`

> v1: only `admin` can run training and dataset builds.

### 4.2 Firestore Security Rules (Draft)

```
// rules_version = '2';
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    match /admins/{uid} {
      allow read: if isAdmin();
      allow write: if false; // manage via console or privileged tooling
    }

    match /model_packs/{packId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
      match /identities/{identityId} {
        allow read: if isSignedIn();
        allow create, update, delete: if isAdmin();
      }
    }

    match /reference_images/{refId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }

    match /training_datasets/{datasetId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }

    match /training_jobs/{trainingJobId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }

    match /audit_logs/{logId} {
      allow read: if isAdmin();
      allow create: if isAdmin();
      allow update, delete: if false;
    }
  }
}
```

### 4.3 Cloud Storage Security (Recommended)
- Only authenticated users can read.
- Only admins can write.

If you use Firebase Storage rules:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isSignedIn() { return request.auth != null; }
    function isAdmin() { return isSignedIn() && firestore.exists(/databases/(default)/documents/admins/$(request.auth.uid)); }

    match /{allPaths=**} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
  }
}
```

---

## 5) Cloud Functions (Gen2) — Required Endpoints

All functions are callable by authenticated admins only.

### 5.1 `createModelPack`
**Type:** Callable HTTPS (`onCall`)  
**Input:** `{ packName, packKey, version, provider }`  
**Output:** `{ packId }`  
**Logic:** Create `model_packs/{packId}` status `draft`.

---

### 5.2 `createIdentity`
**Type:** Callable HTTPS (`onCall`)  
**Input:** `{ packId, name, token, bodyType, ageRange, ethnicity, styleVibe }`  
**Output:** `{ identityId }`  
**Logic:** Create identity doc; validate unique token in pack.

---

### 5.3 `getSignedUploadUrl` (optional)
**Type:** HTTPS (`onRequest`) or callable  
**Input:** `{ packId, identityId?, refCategory?, fileName, contentType }`  
**Output:** `{ uploadUrl, gcsPath }`  
**Logic:** Create a signed URL to upload directly to GCS.

> Alternative: upload via Firebase Storage client SDK. Signed URLs are optional.

---

### 5.4 `registerUploadedAsset`
**Type:** Callable  
**Input:** `{ type: "face"|"reference", packId?, identityId?, refId?, gcsPath }`  
**Output:** `{ ok: true }`  
**Logic:** Update counts and doc references after upload.

---

### 5.5 `buildTrainingDatasetZip`
**Type:** Callable (admin-only)  
**Input:**
```
{
  packId: string,
  captionStyle: "simple_tokens"|"detailed",
  perIdentityFaceMin: number,
  includeGroupShots: boolean,
  groupShotCountTarget: number,
  referenceCategoryMix: { stadium: 10, tailgate: 10, sportsbar: 5, streetwear: 5 }
}
```
**Output:** `{ datasetId }`

**Logic (high level):**
1. Validate pack exists and `status` in `draft|dataset_ready`.
2. Enumerate identity face images from Storage (or from Firestore paths).
3. Select a balanced set per identity: min `perIdentityFaceMin`.
4. Select reference images according to `referenceCategoryMix` (where `safeToUse=true`).
5. Generate captions:
   - Single identity: `"token, female sports fan, commercial photography"`
   - Group images: include multiple tokens when available.
6. Package into zip:
   - `/images/*.jpg`
   - `/captions/*.txt` matching filenames
   - `manifest.json`
7. Upload zip to:
   `modelpacks/{packId}/datasets/{datasetId}/dataset.zip`
8. Create `training_datasets/{datasetId}` status `ready`
9. Update `model_packs/{packId}.datasetIdActive = datasetId` and `status="dataset_ready"`

---

### 5.6 `startFalTraining`
**Type:** Callable (admin-only)  
**Input:** `{ packId: string, datasetId?: string }`  
**Output:** `{ trainingJobId }`

**Logic:**
1. Resolve datasetId (prefer input, else `model_packs.datasetIdActive`).
2. Ensure dataset is `ready`.
3. Create `training_jobs/{trainingJobId}` status `queued`.
4. Call fal trainer API with dataset zip URL and webhook URL.
5. Store `providerJobId`.
6. Update `model_packs/{packId}.status="training"`, `lastTrainingJobId=trainingJobId`.

**Secrets:** fal API key in Secret Manager.

---

### 5.7 `falWebhook`
**Type:** HTTPS `onRequest`  
**Auth:** verify shared secret header/signature

**Logic:**
- Find `training_jobs` by `providerJobId`
- Update status/progress
- On success: write `providerModelId` (+ version) and update `model_packs` to `ready`

---

### 5.8 `pollTrainingJobs` (optional)
If webhooks aren’t reliable, use Cloud Scheduler + polling.

---

## 6) UI/UX Spec (Next.js Routes)

### 6.1 Routes
- `/lora` — Packs list
- `/lora/packs/new`
- `/lora/packs/[packId]`
- `/lora/packs/[packId]/identities`
- `/lora/packs/[packId]/identities/[identityId]`
- `/lora/references`
- `/lora/references/new`
- `/lora/datasets/[datasetId]`
- `/lora/training/[trainingJobId]`

### 6.2 Required actions
On Pack detail:
- Create identity
- Upload faces to identities
- Build dataset zip
- Start training
- View training progress
- Archive pack

---

## 7) Prompt & Caption Templates (v1)

### 7.1 Identity caption
`{token}, female sports fan, commercial photography`

### 7.2 Group caption
`{tokenA}, {tokenB}, female sports fans, candid cheering, commercial photography`

### 7.3 Brand style prompt (store on pack)
“Clean commercial lifestyle photography, natural skin texture, realistic lighting, sports fan energy, tasteful and playful, not explicit, brand-safe.”

### 7.4 Negative prompt
“logo, trademark, watermark, explicit nudity, pornographic, text artifacts, deformed hands, extra fingers, blurry.”

---

## 8) Acceptance Criteria

- Admin can create packs and identities
- Admin can upload face images and view them
- Admin can upload/tag reference images
- Admin can build dataset zip + manifest in GCS
- Admin can start training and see job progress
- Successful training writes `loraModelId` to pack and locks pack to `ready`

---

## 9) v2 Enhancements (Not MVP)

- True group-training image generation
- Identity quality scoring (pose coverage checks)
- Inference module (Route B) to generate lifestyle images from packs
- Auto-rotate cast for campaigns
- Cost throttling & budgets
