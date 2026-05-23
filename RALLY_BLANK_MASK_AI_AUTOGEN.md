# Auto-generate blank print-zone masks with AI (SAM via fal.ai)

## Context

The mask system is wired end-to-end (`RALLY_BLANK_MASK_RENDER_PROFILE_INTEGRATION.md`).
Today, masks come from either:

1. **Photoshop hand-tracing** — Greg opens the variant photo, pen-tools a chest panel,
   exports a black/white PNG, uploads it via the Rendering tab Masks section.
2. **"Auto-generate from SafeArea"** — produces a rectangular mask from the placement's
   safe-area. Fast, but a rectangle is wrong for any rumpled garment (HF07 crewneck is
   the canonical case — the print zone is bounded by shoulder seams, neckline ribbing,
   and waistband ribbing, not a rect).

The friction lives in (1). Hand-tracing every blank doesn't scale, and it's the gate on
"upload one design → 4 photoreal products" for any garment that isn't a clean rectangle.

This spec adds a third option: **"Generate mask with AI"**, powered by SAM (Segment
Anything Model) via fal.ai. One click, preview, refresh-if-wrong, save.

The mask UI we just shipped (status pills, overlay toggle, Manage masks link) is
re-used as-is — no new chrome. This spec only adds the *generation source*.

---

## 1. New callable: `generateBlankMaskViaSam`

**File:** new — `functions/lib/blankMaskGeneration.js` + register the callable in
`functions/index.js`. Keep `index.js` thin: it just wires the callable to the lib.

**Input:**
```ts
{
  blankId: string;
  view: "front" | "back";
  prompt?: string;         // default: "chest panel inside seams" (front) / "back torso panel" (back)
  seed?: number;           // default: random; if provided, deterministic
}
```

**Output:**
```ts
{
  previewMaskUrl: string;        // signed read URL for the generated PNG
  previewMaskStoragePath: string; // rp/blank_masks/{blankId}/{view}/_ai_preview_{timestamp}.png
  width: number;
  height: number;
  prompt: string;
  seed: number;
  meanGrayscale: number;          // for the existing inversion sanity check
}
```

**Behavior:**

1. Auth gate: same `isAdmin()` rule the existing upload handler uses
   (`app/blanks/[blankId]/page.tsx` lines 715–795).
2. Load the blank doc, find a reference image. Source order:
   - `blank.referenceImages[view]` if exists, else
   - first variant's `flat_${view}_clean` image (per `variantRenderSources.js`), else
   - throw with a clear message ("Blank has no `front` reference image — upload one on
     the Identity tab first").
3. Call fal.ai's SAM endpoint (`fal-ai/sam-2-image` or current production model). Pass
   the reference image and the prompt as text-prompted segmentation.
4. Normalize the returned mask:
   - Resize to the reference image's exact pixel dimensions (the existing compositor
     resizes again per-render, but storing at native dimensions makes the editor preview
     pixel-perfect against the variant photo).
   - Grayscale, strict black/white (threshold at 128) — same normalization
     `onMockJobCreated` does at line ~8025.
   - Compute `meanGrayscale` and reject if mean < 30 or mean > 230 (SAM occasionally
     returns inverted or near-empty masks; surface a clean error instead of a useless PNG).
5. Save to Storage at `rp/blank_masks/{blankId}/{view}/_ai_preview_{timestamp}.png`.
   **Underscore prefix** so it's clearly a preview, not the live mask.
6. Do **not** touch the canonical `rp/blank_masks/{blankId}/{view}/mask.png` or write
   to `rp_blank_masks/{blankId}_{view}` here. Preview only.
7. Return the signed URL + metadata for the client to render.

**fal.ai integration:**
- Use the existing `FAL_API_KEY` pattern from `runGeneration` in `index.js`.
- Don't invent new env vars. Use `functions.config().fal.key` fallback for parity.
- Timeout: 60s. SAM usually returns in 2–4s.

**Cost note:** ~$0.005/call. With Refresh re-rolls, expect 1–3 calls per blank-view.
Cheap enough that we don't need to throttle aggressively; per-uid rate limit is fine
(say, 30 calls / 10 min — same shape as the rest of the codebase if there is one).

---

## 2. New callable: `commitBlankMaskFromPreview`

Same shape as the existing upload, just promotes an `_ai_preview_*.png` to the canonical
location and writes the `rp_blank_masks` doc.

**Input:**
```ts
{
  blankId: string;
  view: "front" | "back";
  previewMaskStoragePath: string;
  prompt: string;
  seed: number;
}
```

**Behavior:**

1. Copy the bytes from preview path → `rp/blank_masks/{blankId}/{view}/mask.png`
   (overwriting whatever was there — `replace` semantics, same as the existing upload
   flow at `page.tsx:884`).
2. Write `rp_blank_masks/{blankId}_{view}` with:
   ```ts
   {
     mask: RPImageRef,             // downloadUrl, width, height, bytes
     mode: "inpaint",
     view: "front" | "back",
     source: "ai_sam",             // NEW field, see §4
     aiPrompt: string,             // NEW
     aiSeed: number,               // NEW
     lockedAt: null,               // NEW — Greg locks manually on success
     updatedAt: serverTimestamp(),
   }
   ```
3. Delete the preview file from Storage (best-effort; don't fail the call if delete fails).

We **could** do this entirely client-side (the client already has the preview URL — it
could fetch the bytes and call the existing upload handler). But doing it server-side
is one round-trip vs. three, avoids re-decoding, and keeps the cost meter on the server.

---

## 3. UI: a single AI button in the Masks section

**File:** `app/blanks/[blankId]/page.tsx`, the existing Masks section
(lines ~1549–1730 per the integration doc — actual line numbers will have shifted
post-commit `676a142`; grep for `Auto-generate from SafeArea`).

Replace the existing "Auto-generate from SafeArea" button with **two** sibling buttons:

```
[ Generate with AI ↻ ]  [ From SafeArea (fallback) ]
```

Why keep SafeArea: zero-cost, deterministic, instant. Useful when SAM is rate-limited
or returns garbage. Don't delete a working tool.

**"Generate with AI" flow:**

1. Click → button shows spinner, disabled. Status: `"Asking SAM to find the print zone…"`.
2. On success: render the returned `previewMaskUrl` in the side-by-side preview slot
   where the live mask would normally go. Show a header strip:
   `🪄 AI preview · prompt: "chest panel inside seams" · seed: 4729 · mean: 142`
   plus two buttons:
   - **Save** (primary) → calls `commitBlankMaskFromPreview`, then refreshes the page
     state. The mask doc that was just written drives the existing status pill / overlay
     / Render profile dropdown — all of which now show "Uploaded".
   - **Refresh ↻** → re-calls `generateBlankMaskViaSam` with a new seed. Optionally an
     editable text input above for the prompt, but keep the default prompt sensible so
     Greg rarely needs it.
3. On error: red banner with the actual error text from fal.ai. Don't swallow.

**Don't** auto-commit on first generate. The whole point is "preview, refresh until
good, then save." Saving is the deliberate act.

---

## 4. Schema: extend `RPBlankMask`

**File:** `lib/types/firestore.ts` — find `RPBlankMask` (per the integration doc, line
~3539; verify post-commit).

Add four optional fields. Use `?:` everywhere — none of these are required for the
compositor's existing path to work.

```ts
export interface RPBlankMask {
  // ...existing fields
  /** How this mask was produced. Defaults to "manual_upload" for legacy docs. */
  source?: "manual_upload" | "ai_sam" | "auto_safearea";
  /** SAM text prompt used to generate this mask. Only when source==="ai_sam". */
  aiPrompt?: string;
  /** Random seed used to generate this mask. Only when source==="ai_sam". */
  aiSeed?: number;
  /**
   * Timestamp the operator explicitly locked this mask. Production renders should
   * never silently re-generate a locked mask. Compositor enforcement is OUT OF SCOPE
   * for this PR — for now we just write the field so a follow-up can read it.
   */
  lockedAt?: FirebaseFirestore.Timestamp | null;
}
```

No migration needed. Legacy docs continue to work (all new fields optional).

Mirror the type in `functions/lib/` if there's a shared types file — there isn't a
strict shared types module on the functions side today, so just match the field names
in the new callable's writes.

---

## 5. Status pill source badge (small editor polish)

**File:** `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`

The "✅ Mask (front): Uploaded · 2048×2048 · 247KB" pill we just shipped should also
show provenance when known. One char:

```
Mask (front): ✅ Uploaded 🪄 · 2048×2048 · 247KB     // ai_sam
Mask (front): ✅ Uploaded · 2048×2048 · 247KB        // manual_upload (no badge)
Mask (front): ✅ Uploaded ▭ · 2048×2048 · 247KB      // auto_safearea
```

Lets Greg see at a glance which blanks still have rectangle/manual masks and which
ones already went through AI. Five-line change.

---

## 6. Out of scope for this PR

- **Compositor enforcement of `lockedAt`.** Today, `onMockJobCreated:7675` re-reads
  `rp_blank_masks/{blankId}_{view}` every render. We're not changing that. The lock
  flag exists so a future PR can add: "if lockedAt && lastRenderedMaskHash !== currentMaskHash,
  warn." That's a separate concern.
- **Auto-warp / displacement.** Greg's second use case ("arc/stretch on a model's
  butt") is real but lives in a different layer (`compositor8394::applyDesignWarp8394`,
  plus AI displacement for non-8394 model views). Tackle after auto-mask ships.
- **Per-variant mask overrides.** Today masks are `{blankId}_{view}` — same mask across
  colorways. That's fine for HF07 since the pose is identical across all 6 colors.
- **Drawing/painting masks in-browser.** Editing the AI's output by hand inside the
  dashboard is a nice-to-have, not P0. If SAM is consistently 90% right, the right
  workflow is "regenerate with a better prompt" not "fix it in canvas."

---

## 7. Acceptance criteria

- On the Rendering tab Masks section, "Generate with AI" appears next to a (renamed)
  "From SafeArea (fallback)". The existing manual Upload / Replace still works.
- Clicking "Generate with AI" on a blank with a valid reference image returns a preview
  within ~10s. The preview renders in the side-by-side slot.
- Refresh re-rolls with a new seed (or the user-supplied seed/prompt).
- Save commits the mask; the existing status pill, overlay, and Render profile dropdown
  pick up the new mask without a page refresh (read from `masks` state — already SWR-y).
- The mask record persists `source: "ai_sam"`, `aiPrompt`, `aiSeed`, `lockedAt: null`.
- The Render profile tab status pill shows the 🪄 source badge.
- An HF07 render kicked off after Save shows the print clipped at the seams.
- Compositor (`functions/index.js`) is **not modified**. (Same constraint as the v1
  integration PR — mask consumption already works.)

---

## 8. Files touched

| File | Why |
|---|---|
| `functions/lib/blankMaskGeneration.js` *(new)* | Pure callable bodies: `generateBlankMaskViaSam`, `commitBlankMaskFromPreview` |
| `functions/index.js` | Register the two callables. Imports from the new lib. |
| `app/blanks/[blankId]/page.tsx` | Two new buttons, preview pane state machine (`idle / generating / preview / committing`), error banner |
| `app/blanks/[blankId]/BlankRenderProfileEditor.tsx` | Source-badge emoji on status pill |
| `lib/types/firestore.ts` | Extend `RPBlankMask` (4 optional fields) |
| `lib/firebase/callables.ts` *(or wherever callables are exported client-side)* | Wire the two new callables |

No new collections. No new Storage rules. No new Firestore rules — `rp_blank_masks`
is already gated by `isAdmin()`.

## 9. Effort estimate

~1.5 days of focused work, mostly UI state machine + fal.ai contract verification.
The hard parts (the mask doc plumbing, the editor overlay) are already shipped.
