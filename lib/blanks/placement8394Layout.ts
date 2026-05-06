/**
 * Single source of truth for 8394 placement math shared by:
 * - Blank render profile: natural-pixel canvas preview (`compose8394NaturalPixelPreview` → draw at designFittedPx TL)
 * - Legacy DOM preview (when natural-pixel mode off): left/top % + width % + translate(-50%,-50%) on the displayed box
 * - `functions/lib/productFlatRenderMvp.js` → `computeLayout8394` / `render8394DesignOnGarmentSharp`
 *
 * Audit (keep in sync with server):
 * 1. Coordinate space: normalized `defaultX` / `defaultY` in 0–1 map to the **full blank raster**
 *    (same as CSS percentage of the garment `<img>` box).
 * 2. Anchor: **center** of the print area at `(defaultX × W, defaultY × H)`; the art box
 *    (`artboardBase × defaultScale` on each axis) is centered there; the design is **max-fit**
 *    inside that box (letterboxing), then placed at the resulting **top-left** (integer rounded).
 * 3. Garment bounds: **full image pixels**. `safeArea` is not used for placement (guide overlay only).
 * 4. Order: **scale-to-fit** inside the art box, **then** translate to top-left (+ clamp).
 */

import { resizeInsideDimensions8394 } from "@/lib/blanks/resizeInside8394";

export const PLACEMENT_8394_DEFAULT_ARTBOARD_BASE = 0.5;

export type ComputePlacement8394LayoutArgs = {
  blankWidthPx: number;
  blankHeightPx: number;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  /** Same as blank row `artboardBase` / canvas `artBase` (defaults 0.5). */
  artboardBase: number;
  designWidthPx: number;
  designHeightPx: number;
};

export type ComputePlacement8394LayoutResult = {
  audit: {
    coordinateSpace: string;
    anchorOrigin: string;
    garmentBounds: string;
    scaleVsTranslateOrder: string;
  };
  centerPx: { x: number; y: number };
  artBoxPx: { w: number; h: number; leftTop: number; topTop: number };
  designFittedPx: {
    width: number;
    height: number;
    left: number;
    top: number;
    leftClamped: number;
    topClamped: number;
  };
};

export function computePlacement8394Layout(args: ComputePlacement8394LayoutArgs): ComputePlacement8394LayoutResult {
  const bw = args.blankWidthPx;
  const bh = args.blankHeightPx;
  const x = args.defaultX;
  const y = args.defaultY;
  const effectiveScale = args.defaultScale;
  const ab = args.artboardBase;
  const dw = args.designWidthPx;
  const dh = args.designHeightPx;

  const centerXpx = Math.round(x * bw);
  const centerYpx = Math.round(y * bh);
  const artBoxPxW = Math.round(bw * ab * effectiveScale);
  const artBoxPxH = Math.round(bh * ab * effectiveScale);
  const left0 = Math.round(centerXpx - artBoxPxW / 2);
  const top0 = Math.round(centerYpx - artBoxPxH / 2);
  const fitted = resizeInsideDimensions8394(dw, dh, artBoxPxW, artBoxPxH);
  const resizedWidth = fitted.w;
  const resizedHeight = fitted.h;
  const left = Math.round(left0 + (artBoxPxW - resizedWidth) / 2);
  const top = Math.round(top0 + (artBoxPxH - resizedHeight) / 2);
  const leftClamped = Math.max(0, Math.min(left, bw - resizedWidth));
  const topClamped = Math.max(0, Math.min(top, bh - resizedHeight));

  return {
    audit: {
      coordinateSpace:
        "Normalized 0–1: defaultX/defaultY map to pixel centers on the full blank raster (matches CSS % of garment box).",
      anchorOrigin:
        "Center-anchored art box at (defaultX×W, defaultY×H); design max-fits inside, then top-left + clamp.",
      garmentBounds: "Full blank image pixels; safeArea is guide-only and does not offset placement.",
      scaleVsTranslateOrder: "Resize design to fit art box, then translate to rounded top-left (clamped to blank).",
    },
    centerPx: { x: centerXpx, y: centerYpx },
    artBoxPx: { w: artBoxPxW, h: artBoxPxH, leftTop: left0, topTop: top0 },
    designFittedPx: {
      width: resizedWidth,
      height: resizedHeight,
      left,
      top,
      leftClamped,
      topClamped,
    },
  };
}
