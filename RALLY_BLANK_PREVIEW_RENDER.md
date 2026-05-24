# Real-render preview on the blank Render profile tab

## Context

Today the Render profile preview is a **CSS approximation** — it shows the design as an `<img>` overlaid on the garment, plus the safe area rect and an optional mask overlay. It does NOT clip the design with the mask, apply blend in pixel space, or run the deterministic Sharp compose. So an operator tuning a blank can't actually trust that "this looks right in the editor" → "this will look right in production renders."

That's a problem for Greg's milestone ("one design → 4 photoreal products with confidence at bulk-generation time"). You need to validate blank tuning *before* fanning out to N products.

This spec adds a callable that runs the same Sharp pipeline `onMockJobCreated` runs (Stage A only, no fal.ai realism), but at the **blank** level — no product required.

---

## 1. New callable: `previewBlankRender`

**File:** new — `functions/lib/blankPreviewRender.js` + register in `functions/index.js`.

**Input (passed from the editor's current tuning state — supports unsaved changes):**

```ts
{
  blankId: string;
  variantId: string;          // which variant photo to composite on
  designId: string;           // which design to preview with
  view: "front" | "back";
  placement: {
    x: number;                // 0–1, center
    y: number;                // 0–1, center
    scale: number;            // 0–1, fraction of print box
    width?: number;           // 0–1 normalized print area width
    height?: number;          // 0–1 normalized print area height
    blendMode?: string;       // sharp blend mode; default "soft-light"
    blendOpacity?: number;    // 0–1; default 0.9
  };
}
```

**Behavior:**

1. Auth gate: admin via `admins/{uid}`.
2. Pull blank, variant (from `blank.variants[]`), design.
3. Pick variant photo (flatFront or flatBack) — mirror `getVariantFlatFrontUrl` / `getVariantFlatBackUrl` with fallback to `blank.images[view]`.
4. Pick design PNG via the existing `designPngUrlForProcessing` rule (lightPng → darkPng).
5. Run the **same Stage A pipeline** as `onMockJobCreated`:
   - Crop design to artwork bounds
   - Scale design to print area
   - Resize → blur → desaturate → mask multiply (from `rp_blank_masks/{blankId}_{view}`) → opacity → premultiply
   - Composite onto variant photo with `blendMode`
6. Save to Storage at `rp/blank_previews/{blankId}/{view}/_preview_{timestamp}.png`.
7. Return preview URL + dimensions + telemetry.

**No Firestore writes for products, no Stage B (AI realism), no rp_mock_jobs doc.** Pure preview.

**Cost:** ~$0 (Sharp on Cloud Functions). Latency: 2–5s for 1500×1500.

**Cleanup:** preview files accumulate; out of scope for v1. A future Storage lifecycle rule can delete `_preview_*` files older than 24h.

---

## 2. UI on the Render profile tab

**File:** `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`.

Add a **"Render preview"** button in the same toolbar as VIEW / MASK toggles. Click → callable → loading state → replace (or sit next to) the existing CSS preview with the returned PNG.

Pass the current editor state (`tuning.placement`, `tuning.blend`, etc.) so it previews **unsaved** changes — Greg edits placement, hits "Render preview," sees real output, iterates.

The user already has design + variant + view selected on the editor; pass those through.

Reuse the existing `proxiedImageUrlForCanvas` helper so the displayed PNG goes through `/api/storage-proxy` (same CORS concern as the mask overlay).

---

## 3. Acceptance criteria

- On any blank's Render profile tab, a "Render preview" button kicks off a real Sharp composite within 5s.
- The output PNG shows the design **actually clipped by the mask** (the whole point) — if you drag the design overlay outside the print zone, the preview shows the clipping.
- Re-clicking with new placement/blend values re-runs.
- Save behavior is unchanged: Save persists the tuning to the Blank as before.
- 8394 and non-8394 (HF07, etc.) both work — this callable does NOT gate on styleCode.

---

## 4. Files touched

| File | Why |
|---|---|
| `functions/lib/blankPreviewRender.js` *(new)* | Factory returns the callable handler. Reimplements Stage A inline (helpers duplicated from index.js for now; refactor to shared lib later). |
| `functions/index.js` | Register `previewBlankRender` callable. |
| `app/blanks/[blankId]/BlankRenderProfileEditor.tsx` | Button + state + preview display. |

No schema changes. No new collections. Storage gets a new top-level prefix (`rp/blank_previews/`); existing rules cover it under admin auth.

---

## 5. Out of scope (v1)

- Stage B (fal.ai realism). **Backend is implemented and deployed** under
  `withRealism: true` on the `previewBlankRender` callable; UI button is hidden behind
  `AI_REALISM_PREVIEW_ENABLED` in `BlankRenderProfileEditor.tsx`. Reason: the synchronous
  Firebase callable HTTP gateway gives up at ~60s while flux inpaint/img2img typically
  needs 20–60s plus polling overhead, so the call regularly fails with `408 / CORS`
  even though the function is still running. Re-enable after refactoring to an async
  job pattern (submit → Firestore job doc → client subscribes via onSnapshot, same shape
  as `rp_generation_jobs`).
- Comparison sliders / side-by-side. Just show the new render.
- Caching preview by content hash. Re-run on every click.
- Model-on views (`model_front`, `model_back`). Flat targets first; model views need warp/displacement which lives in `compositor8394::applyDesignWarp8394` and isn't generic yet.
