# Renderer correctness — debug checklist

Use this when testing: **Front = blank only, Back = Giants design, Generate for view = Back.**

The UI sends a single job with `view: "back"` and the **back** config (blank URL, design URL, placement). The renderer must use only those inputs.

---

## 1. Correct blank side is used

**Frontend:** `app/products/[slug]/page.tsx` — `handleGenerateMockup` uses `config = generateView === "front" ? effectiveFrontConfig : effectiveBackConfig`. So for Generate view = Back, `config.blankImageUrl` is `effectiveBackConfig.blankImageUrl` (back blank URL from `renderSetup.back.blankImageUrl` or fallback).

**Payload:** `createMockJob({ view: "back", blankImageUrl: config.blankImageUrl, ... })` → back blank URL is sent explicitly.

**Backend:** `functions/index.js` `createMockJob` (≈5596–5650). Uses `inputBlankUrl` when provided; else `blank.images[view].downloadUrl`. So with our payload it uses the provided URL (back blank). **Check:** Log or verify the URL in the job doc `input.blankImageUrl` is the back blank, not the front.

**Worker:** `onMockJobCreated` (≈5765–5770) fetches `blankImageUrl` from `input` and uses it. No `view`-based branch that could swap to front. **If wrong:** Ensure no code path overwrites `blankImageUrl` with a front URL.

---

## 2. Correct back design asset is used

**Frontend:** For Generate view = Back, `config.designAssetUrl` = `effectiveBackConfig.designAssetUrl` (Giants back design PNG). `config.designAssetId` = back design id. Both are sent: `designPngUrl: config.designAssetUrl`, `designId: config.designAssetId`.

**Backend:** `createMockJob` (≈5619–5629). Uses `inputDesignUrl` when provided; else `design.files.png.downloadUrl`. We send `designPngUrl` explicitly, so the back design URL is used. **Check:** Job doc `input.designPngUrl` should be the Giants back design PNG URL.

**Worker:** `onMockJobCreated` (≈5773–5777) fetches `designPngUrl` from `input`. **If wrong:** Confirm no fallback to design doc or front design URL.

---

## 3. Front design is not leaking into the render

**Frontend:** For Generate view = Back we only send back config. We never send `effectiveFrontConfig.designAssetUrl` when view is back. So front design URL is never in the payload.

**Backend:** `createMockJob` does not receive or store a “front” design URL; it has a single `designPngUrl` in the job input. **If front leaks:** Search for any use of `designId` or design doc that could pull the “primary” or front design (e.g. `design.files.png` used instead of `inputDesignUrl` when view is back). Current code uses `inputDesignUrl` when provided, so no leak there. Worker only uses `input.designPngUrl`; no second design source.

---

## 4. placementKey and placementOverride are applied correctly

**Frontend:** Sends `placementId: config.placementKey` (e.g. `"back_center"`) and `placementOverride: { x, y, scale }` from `config.placementOverride` (from `renderSetup.back`).

**Backend:** `createMockJob` (≈5652–5699). `placementId` is validated for the given `view` (back → back_center etc.). Placement is resolved from blank then design; then **master override** (≈5693–5699): `inputPlacementOverride.x/y/scale/width/height` overwrite `placement`. So product-level override is applied last. **Check:** Log resolved `placement` after line ≈5701; confirm it matches Render Setup (e.g. back_center + your x, y, scale).

**Worker:** Uses `placement` from `input` (≈5795–5814) for center (x, y), scale, and art box. **If wrong:** Verify `placement.x`, `placement.y`, `placement.scale` in the job doc and that the worker uses them (not a default or front placement).

---

## 5. Design bounds detection is applied before scaling

**Worker:** `onMockJobCreated` (≈5779–5785). Order: fetch design PNG → **cropDesignToArtworkBounds(designBuffer)** → then use cropped dimensions for scaling. So artwork bounds are applied **before** any scale/size math.

**Function:** `cropDesignToArtworkBounds` (≈5543) crops the design buffer to the visible artwork (alpha threshold). Returned `width`/`height` are the cropped size; scaling (≈5817–5826) uses these. **If wrong:** Check that `cropDesignToArtworkBounds` runs and that later code uses `designWidth`/`designHeight` (from crop), not the original PNG dimensions.

---

## Quick verification (Generate for view = Back)

1. **Job doc** `rp_mock_jobs/{jobId}`: `view === "back"`, `input.blankImageUrl` = back blank URL, `input.designPngUrl` = Giants back design URL, `input.placement` has your x, y, scale.
2. **Logs:** `[createMockJob] Resolved placement: ...` and `[onMockJobCreated] Fetching blank image: ...` / `Fetching design PNG: ...` show the same URLs.
3. **Output:** Mockup shows back blank + Giants design only; no front design or front blank.

If any of these fail, use the section above for that number to trace the code path and fix.
