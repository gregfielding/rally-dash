# RALLY_RENDER_CORE_UNIFICATION.md

**Goal (operator's words):** "One engine that drives the rendering properties, and that same
engine is used for blank rendering (saving the default settings per product/color/view),
Shopify preview, and the final store image."

The contract: **what you tune on the blank render profile IS what ships — on every surface,
flat and on-body.** Today it isn't, because rendering logic is forked across ~5 paths.

## STATUS (live)
- ✅ **P1** — flat editor "Product Preview" runs the product engine (byte-parity).
- ✅ **R2** — chest-quad warp folded into the product engine (`render8394`). *Dormant:* no blank
  has a persisted `modelPrintQuad` yet (audited 8394/HF07/TR3008/8390), so it's quad-READY, not
  yet visible. Set a quad on a model photo and it ships.
- ✅ **R3** — editor **model** preview now runs the product engine too → on-body editor preview ==
  shipped on-body image by construction. Verified on panty model_back (scale 1.0875).
- ✅ **R4** — live CSS drag-canvas now uses the engine-resolved blend (`engineBlendResolved`)
  instead of its own preview formula, so canvas blend params match the product. (Canvas is still
  a CSS approximation — mix-blend ≠ Sharp; the byte-exact preview is the Product Preview button.)
- ✅ **R5** — Flux VTON realism placement now resolves from `resolveEffectiveRenderTargetSettings`
  (was legacy `blankVariant.renderTargets`, which fell back to centered scale-0.5). The AI realism
  layer now positions/sizes the design per the same per-(color,view) profile. Verified panty HG
  model_back → scale 1.0875.

**RenderCore complete (P1–R5).** Every surface — blank editor (canvas + exact Product Preview),
Shopify preview, final flat + on-body image, and the Flux realism layer — reads ONE engine's
per-(color, view) settings. Remaining work is data/assets, not rendering: apparel model photos +
persisting a chest-quad (see warning above).
- ⚠️ **Apparel on-body not set up:** HF07 crewneck has **no model photos** (renders flat-lay only);
  TR3008 tank + 8390 thong have **0 variants**. Only the 8394 panty has on-body renders today.

---

## 1. Audit — the current paths

| # | Surface | Engine today | On the unified engine? |
|---|---------|--------------|------------------------|
| 1 | Flat product image (Shopify preview, final) | `officialProductFlatCompose` → `render8394DesignOnGarmentSharp` + `resolveSavedBlankRenderProfile` | ✅ canonical |
| 2 | On-body product image (Shopify preview, final) | `officialProductModelCompose` → **same** `render8394` + `resolveSavedBlankRenderProfile` | ✅ canonical |
| 3 | Flat editor "Product Preview" | `composeFlatPreviewParity` → `render8394` (P1) | ✅ matches #1 byte-for-byte |
| 4 | **Model editor "Product Preview"** | `composeStageA` → `warpDesignToQuad` (chest-quad) | ❌ different warp than #2 |
| 5 | **CSS live drag-canvas** | Browser CSS + `zoneCustomSlidersToBlend` (client's own blend formula) | ❌ different math than the engine |
| 6 | Flux VTON realism (optional) | `composeStageB` / `enqueueProductModelRealism` (AI inpaint) | ⚠️ inherently non-deterministic; should still consume profile placement |

**Good news:** the product renders (#1, #2) already share one engine
(`render8394DesignOnGarmentSharp` + `resolveSavedBlankRenderProfile`), and P1 put the flat
editor preview (#3) on it too. The divergence the operator sees is in the **editor** (#4, #5)
and one dropped setting:

### The two confirmed "tuned-but-dropped" bugs
- **Per-color scale** — FIXED (P1). Product reads `renderTargetsByColor[color][view]`.
- **Chest-quad warp** — OPEN. The 4-corner quad is applied only in `composeStageA` (editor).
  The product engine (`render8394` / `pipeWarpMaskForDesignLayer`) uses `tuning.warp`
  (horizontal/vertical stretch) and is never handed the quad. So on-body warp tuning never
  ships.

### Duplicated rendering math (the root smell)
- Client `zoneCustomSlidersToBlend` (blendMode/opacity) ≠ server `mapRealism8394` /
  `blendSettingsToEngineBlend`. The CSS canvas can never exactly match the engine while it
  derives blend itself.
- Two warp implementations: `warpDesignToQuad` (homography, editor) vs `pipeWarpMaskForDesignLayer`
  (stretch, engine).

---

## 2. The RenderCore contract

A single module (`functions/lib/renderCore.js`) that owns ALL rendering-property resolution and
deterministic compositing. Every surface imports it; nothing re-derives.

```
resolveRenderProfile(blank, colorVariantId, renderTarget, product?) → {
  placement: { scale, x, y, safeArea, artboardBase },
  blend:     { blendMode, blendOpacity },
  warp:      { quad? , horizontalWarp, verticalStretch, warpStrength, enabled },
  mask:      { enabled, feather, edgeFade },
  garmentImageUrl, designImageUrl, treatment   // resolved per (color, view)
}                                  // = today's resolveSavedBlankRenderProfile, hardened as THE API

composeDeterministic(profile, garmentBuf, designBuf) → imageBuffer
                                   // = render8394DesignOnGarmentSharp, with quad warp folded in
```

- **Properties resolved once, server-side, per (product/color/view)** — exactly the granularity
  the operator asked for. The client never recomputes them; it reads them back.
- **One warp**: the chest-quad becomes part of `composeDeterministic` (canonical), so the product
  honors it. `tuning.warp` stays as a fallback when no quad is set.
- Surfaces:
  - Flat + on-body product renders → `composeDeterministic` (already are, minus the quad).
  - Editor "Product Preview" (flat + model) → `composeDeterministic` with `product=null`
    (P1 pattern, extended to model).
  - CSS live canvas → reads server-resolved blend/scale (or is explicitly an approximate
    positioner); stops computing its own blend.
  - Flux VTON realism → consumes `resolveRenderProfile().placement` so AI output is sized/placed
    from the profile.

---

## 3. Phased build (each phase ends with a verification gate)

- **R1 — Formalize the core.** Extract `renderCore.js` re-exporting the canonical
  `resolveRenderProfile` + `composeDeterministic`. No behavior change; one import surface. Grep-prove
  no other module re-derives placement/blend.
- **R2 — Fold the chest-quad into the engine.** Port `warpDesignToQuad` into `composeDeterministic`
  (driven by `profile.warp.quad`), so on-body product renders use the quad the operator tuned.
  *Gate:* render panty on-body via the engine and the editor — pixel-diff ≈ 0.
- **R3 — Model editor preview parity.** Generalize `composeFlatPreviewParity` (or add
  `composeModelPreviewParity`) so the model "Product Preview" runs `composeDeterministic`.
  *Gate:* editor model preview == on-body product image.
- **R4 — Kill client blend math.** Editor saves RAW sliders only; CSS canvas reads
  server-resolved blend (debounced callable) or is labeled approximate; remove
  `zoneCustomSlidersToBlend` divergence. *Gate:* CSS canvas vs Product Preview within tolerance.
- **R5 — VTON placement.** Flux realism consumes `resolveRenderProfile().placement`. *Gate:*
  on-body AI image sized/placed from the profile.

Verification harness (reused from P1): for a (blank,color,view), resolve the profile, render via
the engine, and assert the editor preview and the product image agree.

---

## 4. Open decision for the operator

**Which warp is canonical for the on-body image?**
- **(A) Chest-quad homography** — the realistic 4-corner warp you drag on the model photo
  (recommended; it's why you built L1–L9). R2 ports it into the engine. *Cost: real work, but it's
  the realistic result.*
- **(B) `tuning.warp` stretch** — what ships today. Simpler, but ignores the quad. *Then we delete
  the quad UI to stop the confusion.*

Everything else (per-color/per-view settings, blend, scale, mask) is already decided and partly
shipped; the warp is the one fork that needs your call before R2.
