# Cursor Instructions: Verify fal.ai Inference Contract (Endpoint, LoRA Payload, Sizes, Output)

Greg needs **ground-truth evidence** of what fal.ai expects/returns for LoRA inference so we can finalize:
1) Which inference endpoint we’re truly using  
2) How LoRAs must be passed (array key + field names)  
3) Supported image sizes + output format  
4) Whether multi‑LoRA stacking works and how ordering/scale behaves

Please follow the steps below **exactly**, then paste back the requested artifacts (payload + response) in one message.

---

## 0) Goal

Run at least **one** real `runGeneration` call against fal.ai and capture:

- the **resolved endpoint URL** used
- the **exact request payload** we send to fal
- the **exact response JSON** returned by fal (trim huge blobs)

We will use these to lock the final request contract (loras/adapters key names, weights field, size field, etc.).

---

## 1) Confirm which inference endpoint is used

### A) Find the effective endpoint string
In the Cloud Function `runGeneration` (or wherever we resolve it), we currently do something like:

- `effectiveEndpoint = endpoint || activeInferenceEndpoint || "fal-ai/flux-lora"`
- then `resolveFalUrl(effectiveEndpoint)` to get the URL.

**Action:** Add a log line **right before** the fetch call:

```ts
logger.info("[runGeneration] effectiveEndpoint", { effectiveEndpoint });
logger.info("[runGeneration] resolvedUrl", { url });
```

Where `url` is the final URL passed to `fetch()`.

**We need:** the `effectiveEndpoint` string **and** the final `url`.

---

## 2) Log the EXACT request payload sent to fal

### A) Log the payload after it is fully constructed
Immediately before `fetch(url, { ... body: JSON.stringify(falPayload) ... })`, log:

```ts
logger.info("[runGeneration] falPayload", falPayload);
```

**Critical:** This must be the *final* payload after:
- prompt normalization (trigger phrase enforcement)
- loras resolution (weightsUrl lookup, default scales)
- image size mapping
- any endpoint-specific mapping (if any)

---

## 3) Log the EXACT response JSON from fal

Right after:

```ts
const json = await response.json();
```

Log it:

```ts
logger.info("[runGeneration] falResponseMeta", json);
```

If the response contains huge base64 blobs, log a sanitized version:

```ts
const safeJson = { ...json };
// remove/trim big fields if needed
logger.info("[runGeneration] falResponseMeta", safeJson);
```

But ideally keep:
- request id fields (`request_id`, `id`, etc.)
- output URLs fields (`images`, `outputs`, `url`, etc.)
- any validation warnings/errors

---

## 4) Deploy + Run ONE controlled generation from the UI

### A) Deploy functions
Deploy the updated functions:

```bash
firebase deploy --only functions
```

### B) Run a controlled test (single LoRA)
In the app UI (Artifacts → Test Generate):

- Identity: **Amber**
- Use **one** LoRA only (no body/product yet)
- Scale: **0.65**
- Size: **portrait**
- Num images: **2**
- Seed: blank or fixed (either is fine)

Click **Run Test Generation**.

---

## 5) Retrieve and paste back the evidence

You can get the evidence from either:

### Option A: Cloud Logging (preferred)
Find the logs:
- `[runGeneration] effectiveEndpoint`
- `[runGeneration] resolvedUrl`
- `[runGeneration] falPayload`
- `[runGeneration] falResponseMeta`

### Option B: Firestore rp_generations doc
Open the newest doc in:
- `rp_generations/{genId}`

Copy:
- `endpoint`
- `falRequestId`
- `falRequestPayload`
- `falResponseMeta`
- `resultImageUrls`
- `imageSize`
- `numImages`

---

## 6) Paste back EXACTLY this to Greg (single message)

Please paste the following, **verbatim** (trim huge blobs only):

### A) Endpoint resolution
```json
{
  "effectiveEndpoint": "...",
  "resolvedUrl": "https://api.fal.ai/...."
}
```

### B) Request payload sent to fal
```json
{ ... falPayload ... }
```

### C) Response JSON returned by fal
```json
{ ... falResponseMeta ... }
```

### D) If available, the extracted images
```json
{
  "resultImageUrls": ["https://...", "..."],
  "falRequestId": "..."
}
```

---

## 7) IMPORTANT questions to answer explicitly (based on the evidence)

From the real payload/response, answer:

1) **Which endpoint** are we hitting?
   - `fal-ai/flux-lora`?
   - `flux-2/lora`?
   - something else?

2) **LoRA passing contract**:
   - Is it `loras` or `lora` or `adapters`?
   - What is the weights key: `weights`, `path`, `url`, `weights_url`, `weightsUrl`?
   - What is the scale key: `scale`, `strength`, something else?
   - Are multiple LoRAs allowed in one request?
   - Does order matter?

3) **Image sizing contract**:
   - Does fal accept `{ w, h }`, `{ width, height }`, `image_size` enum, or something else?
   - Which sizes are supported?
   - What output format is returned (URL list, objects with `.url`, etc.)?

---

## 8) Next after you paste evidence (for Cursor context)

Once we have real evidence, we will:
- update `runGeneration` to match fal’s **actual** schema
- finalize multi‑LoRA stacking for:
  - identity + body
  - identity + body + product
- lock default scales and size presets

That’s it — we just need the real contract from fal.ai.
