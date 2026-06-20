/**
 * Phase L — shared CSS matrix3d quad-warp math.
 *
 * The 4-corner chest quad (`RPModelPrintQuad`, normalized 0..1 over the model
 * photo) is consumed in three places that MUST agree pixel-for-pixel:
 *   1. The "Set chest quad" editor modal (live drag preview).
 *   2. The blank render-profile live preview (so the operator sees the warp
 *      reflected the instant a quad is saved — without waiting for a server
 *      render).
 *   3. The server renderer (`functions/lib/perspectiveWarp.js#warpDesignToQuad`)
 *      which maps the design's rectangle (0,0)->TL, (W,0)->TR, (W,H)->BR,
 *      (0,H)->BL via a homography onto the full model-photo canvas.
 *
 * Browsers can reproduce #3's homography for free via CSS `matrix3d` on a 1x1
 * unit element. This module owns that math so the two client previews share one
 * implementation and can't drift from each other (they previously had a private
 * copy inside the modal). The math is the standard "general 2D projection"
 * technique: solve the unit-square -> destination-quad homography and emit the
 * column-major 4x4 matrix CSS expects.
 */

export type QuadCornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

/** Clockwise from top-left — same order the server's homography expects. */
export const QUAD_CORNER_ORDER: QuadCornerKey[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
];

/** A quad whose 4 corners are normalized fractions (0..1) of the photo box. */
export type NormalizedQuad = Record<QuadCornerKey, { x: number; y: number }>;

/**
 * CSS matrix3d for mapping a quad (normalized 0..1) onto a rendered box of
 * `width` x `height` CSS pixels. Returns null if the box has no area or the
 * homography is degenerate (collinear corners). Apply to a 1px x 1px element
 * with `transform-origin: 0 0`.
 */
export function quadToMatrix3d(
  quad: NormalizedQuad,
  width: number,
  height: number
): string | null {
  if (!width || !height) return null;
  const dst = QUAD_CORNER_ORDER.map(
    (k) => [quad[k].x * width, quad[k].y * height] as [number, number]
  );
  return matrix3dForQuad(dst);
}

/**
 * Compute a CSS matrix3d string that maps the unit square (0,0)-(1,1) onto the
 * 4 destination corners (in container px, order TL,TR,BR,BL). Emits the 4x4
 * column-major matrix CSS expects (z row identity).
 */
export function matrix3dForQuad(dst: Array<[number, number]>): string | null {
  const src: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const H = general2DProjection(src, dst);
  if (!H) return null;
  if (!H[8]) return null;
  // Normalize so H[8] = 1.
  for (let i = 0; i < 9; i++) H[i] /= H[8];
  // CSS matrix3d is column-major 4x4. Map the 3x3 homography
  // [a b c; d e f; g h i] into the 4x4 (x,y,1) projective form.
  const m = [
    H[0], H[3], 0, H[6],
    H[1], H[4], 0, H[7],
    0, 0, 1, 0,
    H[2], H[5], 0, H[8],
  ];
  return `matrix3d(${m.map((v) => round(v)).join(",")})`;
}

function round(v: number): number {
  return Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(8));
}

/** Solve the 3x3 projective transform mapping 4 src -> 4 dst points. */
function general2DProjection(
  src: Array<[number, number]>,
  dst: Array<[number, number]>
): number[] | null {
  // Build the basis-to-quad transforms for src and dst, then compose:
  // H = dstBasis . inverse(srcBasis).
  const s = basisToPoints(src);
  const d = basisToPoints(dst);
  if (!s || !d) return null;
  const sInv = adj3(s);
  return multmm(d, sInv);
}

function basisToPoints(p: Array<[number, number]>): number[] | null {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const v = multmv(adj3(m), [p[3][0], p[3][1], 1]);
  return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

function multmm(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[3 * i + k] * b[3 * k + j];
      r[3 * i + j] = sum;
    }
  }
  return r;
}

function multmv(m: number[], v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function adj3(m: number[]): number[] {
  return [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
}
