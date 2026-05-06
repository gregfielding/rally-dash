"use strict";

/**
 * Keep in sync with `lib/blanks/resizeInside8394.ts` (used by Next app).
 * @param {number} designWidthPx
 * @param {number} designHeightPx
 * @param {number} boxWidthPx
 * @param {number} boxHeightPx
 * @returns {{ w: number; h: number }}
 */
function divRoundTiesToEven(num, den) {
  const n = Math.floor(Math.max(0, num));
  const d = Math.max(1, Math.floor(den));
  const q = Math.floor(n / d);
  const r = n - q * d;
  const cmp = 2 * r - d;
  if (cmp < 0) return q;
  if (cmp > 0) return q + 1;
  return q % 2 === 0 ? q : q + 1;
}

function resizeInsideDimensions8394(designWidthPx, designHeightPx, boxWidthPx, boxHeightPx) {
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

module.exports = { resizeInsideDimensions8394 };
