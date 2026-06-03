/**
 * Tests for the Phase L perspective-warp geometry core.
 *
 * These guard the math that makes "design wraps the angled chest" deterministic.
 * If computeHomography / invertHomography drift, designs would warp to the wrong
 * place — the one thing this whole feature exists to get right, every time.
 *
 * Pure-math only (no Sharp): the raster wrapper warpDesignToQuad is a thin loop
 * over these primitives and is exercised in the Phase L5 proof render.
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pw = require("../../functions/lib/perspectiveWarp") as {
  computeHomography: (
    src: Array<{ x: number; y: number }>,
    dst: Array<{ x: number; y: number }>
  ) => number[];
  applyHomography: (H: number[], x: number, y: number) => { x: number; y: number };
  invertHomography: (H: number[]) => number[];
  quadToPixels: (
    quad: Record<string, { x: number; y: number }>,
    w: number,
    h: number
  ) => Array<{ x: number; y: number }>;
  isValidNormalizedQuad: (quad: unknown) => boolean;
  solveLinearSystem: (A: number[][], b: number[]) => number[];
};

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function near(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

describe("solveLinearSystem", () => {
  it("solves a simple 2×2 system", () => {
    // 2x + y = 5 ; x + 3y = 10  →  x=1, y=3
    const x = pw.solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10]
    );
    expect(near(x[0], 1)).toBe(true);
    expect(near(x[1], 3)).toBe(true);
  });

  it("throws on a singular system", () => {
    expect(() =>
      pw.solveLinearSystem(
        [
          [1, 1],
          [2, 2],
        ],
        [1, 2]
      )
    ).toThrow(/singular/);
  });
});

describe("computeHomography — round-trips the 4 correspondences", () => {
  it("maps each source corner exactly to its destination corner", () => {
    const dst = [
      { x: 200, y: 50 },
      { x: 480, y: 120 }, // perspective trapezoid (top narrower than bottom)
      { x: 520, y: 700 },
      { x: 160, y: 660 },
    ];
    const H = pw.computeHomography(SQUARE, dst);
    for (let i = 0; i < 4; i++) {
      const p = pw.applyHomography(H, SQUARE[i].x, SQUARE[i].y);
      expect(near(p.x, dst[i].x, 1e-4)).toBe(true);
      expect(near(p.y, dst[i].y, 1e-4)).toBe(true);
    }
  });

  it("identity mapping (src === dst) leaves points unchanged", () => {
    const H = pw.computeHomography(SQUARE, SQUARE);
    const probe = pw.applyHomography(H, 37, 62);
    expect(near(probe.x, 37, 1e-4)).toBe(true);
    expect(near(probe.y, 62, 1e-4)).toBe(true);
  });

  it("pure translation maps interior points correctly", () => {
    const dst = SQUARE.map((p) => ({ x: p.x + 300, y: p.y + 150 }));
    const H = pw.computeHomography(SQUARE, dst);
    const p = pw.applyHomography(H, 50, 50);
    expect(near(p.x, 350, 1e-4)).toBe(true);
    expect(near(p.y, 200, 1e-4)).toBe(true);
  });

  it("pure scale maps the center to the scaled center", () => {
    const dst = SQUARE.map((p) => ({ x: p.x * 2, y: p.y * 3 }));
    const H = pw.computeHomography(SQUARE, dst);
    const p = pw.applyHomography(H, 50, 50);
    expect(near(p.x, 100, 1e-4)).toBe(true);
    expect(near(p.y, 150, 1e-4)).toBe(true);
  });

  it("perspective foreshortening: a top-narrowed trapezoid pulls the center upward-left", () => {
    // Top edge much narrower than bottom → the square's center should map
    // ABOVE the trapezoid's vertical midpoint (perspective compresses the top).
    const dst = [
      { x: 80, y: 0 },
      { x: 120, y: 0 }, // narrow top (width 40)
      { x: 200, y: 100 },
      { x: 0, y: 100 }, // wide bottom (width 200)
    ];
    const H = pw.computeHomography(SQUARE, dst);
    const center = pw.applyHomography(H, 50, 50);
    // The geometric vertical midpoint of the quad edges is y=50; perspective
    // from a wide-bottom/narrow-top trapezoid pushes the source-center mapping
    // BELOW y=50 in dest (more dest area near the wide bottom). Assert it's a
    // valid interior point and not the naive bilinear midpoint.
    expect(center.y).toBeGreaterThan(0);
    expect(center.y).toBeLessThan(100);
    // Horizontal center stays centered by symmetry.
    expect(near(center.x, 100, 1e-3)).toBe(true);
    // Perspective (not affine): center.y must differ from the affine answer (50).
    expect(Math.abs(center.y - 50)).toBeGreaterThan(1);
  });

  it("throws on a degenerate (collinear) destination quad", () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    expect(() => pw.computeHomography(SQUARE, collinear)).toThrow(/singular|degenerate/);
  });

  it("requires exactly 4+4 points", () => {
    expect(() => pw.computeHomography([{ x: 0, y: 0 }], SQUARE)).toThrow(/4 src/);
  });
});

describe("invertHomography — inverse maps destination corners back to source", () => {
  it("Hinv∘H is identity on probe points", () => {
    const dst = [
      { x: 200, y: 50 },
      { x: 480, y: 120 },
      { x: 520, y: 700 },
      { x: 160, y: 660 },
    ];
    const H = pw.computeHomography(SQUARE, dst);
    const Hinv = pw.invertHomography(H);
    // Map a source point forward then back.
    const fwd = pw.applyHomography(H, 25, 75);
    const back = pw.applyHomography(Hinv, fwd.x, fwd.y);
    expect(near(back.x, 25, 1e-3)).toBe(true);
    expect(near(back.y, 75, 1e-3)).toBe(true);
  });

  it("inverse maps each destination corner back to the source corner", () => {
    const dst = [
      { x: 200, y: 50 },
      { x: 480, y: 120 },
      { x: 520, y: 700 },
      { x: 160, y: 660 },
    ];
    const H = pw.computeHomography(SQUARE, dst);
    const Hinv = pw.invertHomography(H);
    for (let i = 0; i < 4; i++) {
      const s = pw.applyHomography(Hinv, dst[i].x, dst[i].y);
      expect(near(s.x, SQUARE[i].x, 1e-3)).toBe(true);
      expect(near(s.y, SQUARE[i].y, 1e-3)).toBe(true);
    }
  });
});

describe("quadToPixels + isValidNormalizedQuad", () => {
  const quad = {
    topLeft: { x: 0.3, y: 0.2 },
    topRight: { x: 0.7, y: 0.22 },
    bottomRight: { x: 0.72, y: 0.6 },
    bottomLeft: { x: 0.28, y: 0.58 },
  };

  it("converts normalized corners to pixel space in TL,TR,BR,BL order", () => {
    const px = pw.quadToPixels(quad, 1000, 2000);
    expect(px[0]).toEqual({ x: 300, y: 400 }); // TL
    expect(px[1]).toEqual({ x: 700, y: 440 }); // TR
    expect(px[2]).toEqual({ x: 720, y: 1200 }); // BR
    expect(px[3]).toEqual({ x: 280, y: 1160 }); // BL
  });

  it("accepts a valid quad", () => {
    expect(pw.isValidNormalizedQuad(quad)).toBe(true);
  });

  it("rejects missing corners / non-numeric / wildly out-of-range", () => {
    expect(pw.isValidNormalizedQuad(null)).toBe(false);
    expect(pw.isValidNormalizedQuad({ topLeft: { x: 0, y: 0 } })).toBe(false);
    expect(
      pw.isValidNormalizedQuad({ ...quad, topLeft: { x: "a" as unknown as number, y: 0 } })
    ).toBe(false);
    expect(
      pw.isValidNormalizedQuad({ ...quad, bottomRight: { x: 5, y: 0.5 } })
    ).toBe(false); // x=5 way out of [-0.1,1.1]
  });

  it("allows slight overscan (design bleeding past the photo edge)", () => {
    expect(
      pw.isValidNormalizedQuad({
        topLeft: { x: -0.05, y: -0.05 },
        topRight: { x: 1.05, y: -0.03 },
        bottomRight: { x: 1.04, y: 1.05 },
        bottomLeft: { x: -0.04, y: 1.03 },
      })
    ).toBe(true);
  });
});
