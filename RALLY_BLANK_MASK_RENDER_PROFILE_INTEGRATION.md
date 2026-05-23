# Cursor — wire up blank masks on the Render profile tab

## Context

The blank-mask system is **already built and live** end-to-end. We just have stale
"(future)" labels and a missing preview overlay that make it look unfinished from
the editor UI.

Verified current state (May 2026):

**Schema** — `lib/types/firestore.ts`
- `RPBlankMask` (line ~3539): one Firestore doc per `{blankId}_{view}`,
  shape `{ mask: RPImageRef, mode: "inpaint", view: "front"|"back", ... }`.
  White = editable (print area), black = protected.
- `RpMaskSettings` (line ~2397): inline `feather` / `edgeFade` knobs on
  `RpRenderTargetSettings`.
- `RPPlacementMaskConfig` (line ~2594): per-zone clip strategy with values
  `"none" | "blank_mask_doc" | "safe_area_clip"`.

**Storage** — `rp/blank_masks/{blankId}/{view}/mask.png`.

**Compositor** — `functions/index.js` `onMockJobCreated` around line 7675:
already fetches `rp_blank_masks/{blankId}_{view}`, runs an inversion sanity check
(skips when grayscale mean < 80 so an inverted mask doesn't zero the design), and
multiplies the mask onto the design's RGBA buffer before blend / opacity. There's
a second consumer around line 7995 in the body-model path. **Both are live.**

**Upload UI** — `app/blanks/[blankId]/page.tsx` lines ~1549–1730:
the **Rendering** tab already has a complete Masks section (front/back toggle,
side-by-side blank reference + mask preview, Upload + Replace + "Auto-generate
from SafeArea", status summary). It writes Storage + Firestore correctly.

**What's stale / missing on the Render profile tab** — `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`:
1. Lines 3214–3216: the `Mask / clip strategy` `<select>` still labels
   `blank_mask_doc` and `safe_area_clip` as `"(future)"` even though the compositor
   has been consuming `blank_mask_doc` for some time.
2. Line ~2624: `<p>Mask is not drawn on this canvas yet.</p>` — the placement
   preview canvas does not overlay the actual mask PNG. Designers tuning position
   / scale can't see the mask boundary, so they can't tell when a design crosses
   the shoulder seam, runs off the chest panel, or hits the ribbing.
3. There's no indicator on the Render profile tab telling you a mask exists at
   all — you have to switch to the Rendering tab to find that out.

The HF07 Heavy Fleece Crewneck (and any future blank where the print zone isn't
a clean rectangle) is the use case that surfaces this gap. The crewneck's chest
panel needs to clip at the shoulder seams, neckline ribbing, and waistband — a
real PNG mask, not a `safeArea` rectangle.

The aim of this brief is to close those three gaps **without** introducing a new
top-level tab. Masks belong with placement geometry — they're the same concern.

---

## 1. Promote `blank_mask_doc` from `(future)` → live default

**File:** `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`
**Lines:** 3206–3219 (the `Mask / clip strategy` block).

The compositor has been reading `rp_blank_masks/{blankId}_{view}` for real renders.
The label is just lying about what's live.

**Change:**

```tsx
// before
<select
  value={selected?.maskConfig?.mode ?? "none"}
  onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
  …
>
  <option value="none">None (MVP)</option>
  <option value="blank_mask_doc">Use rp_blank_masks doc (future)</option>
  <option value="safe_area_clip">Clip to safe area (future)</option>
</select>

// after
<select
  value={selected?.maskConfig?.mode ?? defaultMaskModeForBlank}
  onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
  …
>
  <option value="none">None — no clipping</option>
  <option value="blank_mask_doc">Use uploaded mask (rp_blank_masks)</option>
  <option value="safe_area_clip" disabled>Clip to safe area (not implemented)</option>
</select>
```

Where `defaultMaskModeForBlank` is computed as: `"blank_mask_doc"` if a mask doc
exists for this blank+view, otherwise `"none"`.

Add a small status pill next to the select — green "Mask uploaded · 1024×1024"
when the doc exists, neutral "No mask uploaded" when it doesn't, with a link
labeled "Manage masks →" that switches to the Rendering tab and pre-selects this
view (the page already has `setMaskView` and `setActiveTab` — wire them up).

`safe_area_clip` should stay disabled until someone actually implements that
branch in the compositor. Until then, leaving it enabled is a foot-gun.

---

## 2. Render the mask as an overlay on the Render profile preview canvas

**File:** `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`
**Component:** `GarmentPreviewCanvas` (around line 217), and the parent that
passes its props.

The component already accepts an `overlayMaskStyle?: CSSProperties` prop, but
that's currently used only for the 8394 soft-edge CSS mask, **not** for showing
the mask PNG on top of the garment.

Add a new prop:

```ts
type GarmentPreviewCanvasProps = {
  …
  /** rp_blank_masks PNG for this view, drawn semi-transparent on top of the garment image. */
  blankMaskUrl?: string | null;
  /** 0–1; default 0.35. */
  blankMaskOverlayOpacity?: number;
  /** 'magenta' | 'cyan' | 'lime' — colorize the mask so it pops against any garment color. Default 'magenta'. */
  blankMaskOverlayTint?: "magenta" | "cyan" | "lime";
  /** Show / hide toggle from parent. */
  showBlankMaskOverlay?: boolean;
};
```

Render layer order, top to bottom:
1. Design overlay (existing, draggable)
2. **NEW**: Blank mask overlay — when `showBlankMaskOverlay && blankMaskUrl`,
   render an `<img>` absolutely positioned, same `object-contain` sizing as the
   garment image, with `mix-blend-mode: screen`, the chosen tint color applied
   as `filter: drop-shadow` or via a CSS mask (the simplest approach is to use
   the PNG as a CSS `mask-image` on a tinted div), and the configured opacity.
3. Safe-area dashed rectangle (existing, `showSafeArea`).
4. Garment photo (existing).

The "tint" approach works well because the mask is grayscale: load the PNG into
a `<div>` whose background is the tint color, then `-webkit-mask-image: url(...)`
clips the tinted div to the mask's white pixels. Result: a magenta (or cyan or
lime) translucent shape exactly matching the editable region.

Add a toolbar control next to the existing **VIEW: Clean / Blended / Side-by-side**
group:

```
MASK: [Off] [Outline] [Filled]
```

- **Off** — no overlay (default when no mask exists, to avoid suggesting one is
  there).
- **Outline** — render only the mask edge (use a CSS filter or a thin `outline`
  via mask-image + a slightly-shrunk inverted mask). Useful when the designer
  wants to see the design clearly with just the mask boundary visible.
- **Filled** — translucent tint fill.

Persist the toggle in component-local state only; this is a viewing preference,
not a saved field.

The point: when a designer drags the design overlay around, they should see in
real time whether their bounding box pokes outside the editable region. The
compositor already clips at render time — the editor should show the same edge.

---

## 3. Show a mask-status indicator on the Render profile tab header

**File:** `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`

Right now the header pills show `Blank: Draft · Zones: Front · Back · Preview: Ready`.
Add one more pill per zone the user is editing:

```
Mask (front): ✅ Uploaded · 2048×2048 · 247KB
Mask (back):  ⚠️ Missing — Upload on Rendering tab →
```

Pill should reflect the mask state for the *currently selected zone* (front vs
back), and the link should switch tabs + set `maskView` accordingly. This is
purely informational, so it can read from a parent-passed prop or a small SWR
hook against `rp_blank_masks/{blankId}_{view}`.

---

## 4. (Optional, V2) Inline upload from the Render profile tab

If we eventually want to retire the separate Rendering-tab Masks section and put
everything in one place, the existing upload handler (`handleMaskFileSelect`,
`handleMaskUpload` in `page.tsx` lines 715–795) can be lifted into a shared hook
(`useBlankMaskUpload(blankId, view)`) and consumed from both tabs.

Don't do this in the same PR as 1–3 — ship the visibility / labeling fixes first,
see if the Rendering-tab section actually feels redundant in practice.

---

## 5. (Forward-looking, not in this PR) Displacement / fabric pass

The current compositor does mask × design + blend mode + opacity. It does **not**
multiply a fabric-displacement (wrinkle / shadow) layer over the design. On dark
colorways (Vintage Black, Navy, Burgundy) that means a dark print on dark fabric
can lose all texture and look flatter than a real screen-print would.

If we want fabric-realism on dark variants, we'd extend `RPBlankMask` to:

```ts
export interface RPBlankMask {
  …existing fields
  displacementMap?: RPImageRef | null;  // grayscale wrinkle pass, optional
  displacementOpacity?: number | null;  // 0–1, default ~0.4
}
```

…and add a Sharp step in `onMockJobCreated` that screens or multiplies the
displacement map over the design buffer between mask-clip and final blend.

**Don't ship this in the integration PR.** Let HF07 prove out with print-zone
masking first; revisit if the dark colorway renders feel flat.

---

## Acceptance criteria

- On the **Render profile** tab for HF07 (any blank, really), the **Mask / clip
  strategy** dropdown:
  - No longer says "(future)" anywhere.
  - Defaults to `blank_mask_doc` when an `rp_blank_masks/{blankId}_{view}` doc
    exists, otherwise `none`.
  - `safe_area_clip` is shown but disabled.
- A status pill near the dropdown shows mask state (uploaded with dimensions, or
  missing with a link that takes you to the Rendering tab pre-set to the right
  view).
- The placement **preview canvas** has a **MASK: Off / Outline / Filled** toggle
  in its header. When set to Filled and a mask exists, the editable region is
  visible as a translucent magenta (or chosen tint) shape over the garment.
  Dragging the design overlay against the mask boundary makes overhang visible
  immediately.
- Switching the **Zone row** between Front and Back swaps which mask PNG is
  overlaid — front zone shows the front mask, back zone shows the back mask.
- The **Rendering** tab Masks section is unchanged and still works. No regressions
  in upload, replace, or auto-generate-from-SafeArea.
- The compositor (`functions/index.js`) is **not modified** in this PR. Mask
  consumption already works; this is purely an editor-side visibility fix.

## Files touched

- `app/blanks/[blankId]/BlankRenderProfileEditor.tsx` — labels, default value,
  status pill, `GarmentPreviewCanvas` props + overlay rendering, MASK toggle.
- `app/blanks/[blankId]/page.tsx` — only if the "Manage masks →" link from §1
  needs new tab+view URL params or a `setActiveTab("rendering")` callback exposed
  to the Render profile section.
- (Optional) a small new component file
  `app/blanks/[blankId]/BlankMaskOverlay.tsx` if the overlay logic gets messy
  inside `GarmentPreviewCanvas`.

No schema, Firestore-rules, or Cloud Functions changes in this PR.

## Out of scope (tracked separately)

- Drawing / editing masks in-browser (paint a print zone on the canvas and save
  it). Today, masks are produced in Photoshop or via the existing
  `auto-generate-from-SafeArea` rectangle generator.
- Per-color (variant-level) mask overrides. Right now masks are at the
  `{blankId}_{view}` level — same mask across all colorways. For HF07 that's
  fine because the pose is identical across all 6 colors.
- Displacement / fabric-realism layer (see §5).
