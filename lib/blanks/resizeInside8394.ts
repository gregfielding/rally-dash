/**
 * Pixel dimensions after `sharp(buf).resize(boxW, boxH, { fit: "inside" })` for integer WxH.
 *
 * Secondary dimension uses integer division with **round-half-to-even** (IEEE / libvips `rint`),
 * not `Math.round` (which is half-away-from-zero in JS, so `Math.round(246.5) === 247` while Sharp
 * yields 246 for the same rational).
 */

function divRoundTiesToEven(num: number, den: number): number {
  const n = Math.floor(Math.max(0, num));
  const d = Math.max(1, Math.floor(den));
  const q = Math.floor(n / d);
  const r = n - q * d;
  const cmp = 2 * r - d;
  if (cmp < 0) return q;
  if (cmp > 0) return q + 1;
  return q % 2 === 0 ? q : q + 1;
}

export function resizeInsideDimensions8394(
  designWidthPx: number,
  designHeightPx: number,
  boxWidthPx: number,
  boxHeightPx: number
): { w: number; h: number } {
  const dw = Math.max(1, Math.floor(designWidthPx));
  const dh = Math.max(1, Math.floor(designHeightPx));
  const bw = Math.max(1, Math.floor(boxWidthPx));
  const bh = Math.max(1, Math.floor(boxHeightPx));
  const widthLimited = bw * dh <= bh * dw;
  if (widthLimited) {
    const w = bw;
    const h = Math.max(1, Math.min(bh, divRoundTiesToEven(dh * bw, dw)));
    return { w, h };
  }
  const h = bh;
  const w = Math.max(1, Math.min(bw, divRoundTiesToEven(dw * bh, dh)));
  return { w, h };
}
