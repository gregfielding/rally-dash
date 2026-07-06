"use strict";

/**
 * Phase L — deterministic perspective warp for placing a design across the
 * chest of a model standing at an angle.
 *
 * The problem (see audit): Stage A pastes the design as a flat 2D rectangle,
 * and Flux Fill preserves that flat geometry — so an angled body gets a
 * flat-sticker design. The fix: warp the design through a homography onto a
 * 4-corner "chest quad" that the operator sets ONCE per (fixed) model photo,
 * so the design follows the chest plane's perspective. Deterministic — the
 * same design renders with identical geometry every time. AI (Flux Fill) is
 * then used only for fabric texture, where non-determinism doesn't matter.
 *
 * This module is the geometry core:
 *   - computeHomography(src[4], dst[4]) — solve the 3×3 projective transform
 *     mapping 4 source corners → 4 destination corners (Direct Linear
 *     Transform, 8 equations / 8 unknowns + Gaussian elimination).
 *   - invertHomography(H) — 3×3 matrix inverse (used for inverse-sampling).
 *   - applyHomography(H, x, y) — project a single point.
 *   - warpDesignToQuad({...}) — Sharp rasterizer: inverse-sample the design
 *     into a full model-photo-sized RGBA buffer, transparent outside the quad.
 *
 * The math functions are pure + unit-tested; warpDesignToQuad is a thin
 * raster wrapper around them.
 *
 * Corner-order convention (used everywhere): [TL, TR, BR, BL] — top-left,
 * top-right, bottom-right, bottom-left, clockwise from top-left. Source
 * design corners map (0,0)=TL → (W,0)=TR → (W,H)=BR → (0,H)=BL.
 */

/**
 * Solve a linear system A·x = b via Gaussian elimination with partial pivoting.
 * A is n×n (array of rows), b is length n. Returns x (length n) or throws on
 * a singular matrix (degenerate quad).
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  // Augmented matrix.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest abs value in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error("perspectiveWarp: singular matrix (degenerate quad — corners collinear or coincident)");
    }
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/**
 * Compute the 3×3 homography H (returned as a flat length-9 array, row-major,
 * with h[8] normalized to 1) mapping 4 source points → 4 destination points.
 *
 * @param {Array<{x:number,y:number}>} src  exactly 4 points
 * @param {Array<{x:number,y:number}>} dst  exactly 4 points (same order)
 * @returns {number[]} length-9 [h00,h01,h02, h10,h11,h12, h20,h21,1]
 */
function computeHomography(src, dst) {
  if (!Array.isArray(src) || !Array.isArray(dst) || src.length !== 4 || dst.length !== 4) {
    throw new Error("perspectiveWarp.computeHomography: need exactly 4 src + 4 dst points");
  }
  // For each correspondence (x,y)->(X,Y), two rows:
  //   x*h00 + y*h01 + h02 - X*x*h20 - X*y*h21 = X
  //   x*h10 + y*h11 + h12 - Y*x*h20 - Y*y*h21 = Y
  // Unknowns: h00,h01,h02,h10,h11,h12,h20,h21 (8). h22 fixed = 1.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinearSystem(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Project a point (x,y) through homography H (length-9). Returns {x,y}. */
function applyHomography(H, x, y) {
  const denom = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom,
  };
}

/** Invert a 3×3 matrix given as length-9 row-major. Throws if singular. */
function invertHomography(H) {
  const a = H[0], b = H[1], c = H[2];
  const d = H[3], e = H[4], f = H[5];
  const g = H[6], h = H[7], i = H[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error("perspectiveWarp.invertHomography: singular matrix");
  }
  const invDet = 1 / det;
  return [
    A * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    C * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Convert a normalized quad (corners as 0..1 fractions of the output image)
 * to absolute pixel coordinates. Accepts {topLeft,topRight,bottomRight,bottomLeft}
 * each {x,y}. Returns [TL,TR,BR,BL] in pixel space.
 */
function quadToPixels(quad, outputWidth, outputHeight) {
  const toPx = (pt) => ({
    x: Number(pt.x) * outputWidth,
    y: Number(pt.y) * outputHeight,
  });
  return [
    toPx(quad.topLeft),
    toPx(quad.topRight),
    toPx(quad.bottomRight),
    toPx(quad.bottomLeft),
  ];
}

/** Validate a normalized quad object: 4 named corners, each with x,y in [−0.1, 1.1]. */
function isValidNormalizedQuad(quad) {
  if (!quad || typeof quad !== "object") return false;
  const names = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  for (const n of names) {
    const c = quad[n];
    if (!c || typeof c.x !== "number" || typeof c.y !== "number") return false;
    // Allow a little overscan so a design can bleed slightly past the photo edge.
    if (c.x < -0.1 || c.x > 1.1 || c.y < -0.1 || c.y > 1.1) return false;
  }
  return true;
}

/**
 * Rasterize the design into the destination quad on a transparent canvas the
 * size of the model photo. Returns a PNG Buffer (RGBA, outputWidth×outputHeight)
 * with the warped design where the quad is and transparency elsewhere — ready
 * to Sharp.composite() onto the model photo.
 *
 * Uses inverse mapping + bilinear sampling: iterate the quad's dest bounding
 * box, map each dest pixel back to design space via H⁻¹, sample. This avoids
 * holes that a forward scatter would leave.
 *
 * @param {Object} params
 * @param {import('sharp')} params.sharp
 * @param {Buffer} params.designBuffer  RGBA-capable design PNG (any size)
 * @param {Object} params.quad          normalized {topLeft,topRight,bottomRight,bottomLeft}
 * @param {number} params.outputWidth   model photo width (px)
 * @param {number} params.outputHeight  model photo height (px)
 * @returns {Promise<Buffer>} PNG buffer, outputWidth×outputHeight, RGBA
 */
async function warpDesignToQuad({ sharp, designBuffer, quad, outputWidth, outputHeight }) {
  if (!isValidNormalizedQuad(quad)) {
    throw new Error("perspectiveWarp.warpDesignToQuad: invalid normalized quad");
  }
  const W = Math.max(1, Math.round(outputWidth));
  const Hh = Math.max(1, Math.round(outputHeight));

  /**
   * Aspect-fit (2026-07-05): the homography maps the design RECTANGLE onto the
   * quad, so artwork whose aspect differs from the quad's was stretched to fill
   * it — wide single-line text designs (3600×310) came out vertically smeared
   * on-body while the flat path (which preserves aspect) was clean. Letterbox
   * the design onto a transparent canvas matching the quad's pixel aspect
   * BEFORE computing the warp; the design then keeps its proportions centered
   * inside the quad. Square-ish artwork (aspect ≈ quad) is visually unchanged.
   * Lives here so BOTH callers (engine + editor preview) stay identical.
   */
  const preMeta = await sharp(designBuffer).metadata();
  const dPts = quadToPixels(quad, W, Hh);
  const edge = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const quadW = (edge(dPts[0], dPts[1]) + edge(dPts[3], dPts[2])) / 2;
  const quadH = (edge(dPts[0], dPts[3]) + edge(dPts[1], dPts[2])) / 2;
  const quadAspect = quadH > 0 ? quadW / quadH : 1;
  const designAspect = preMeta.height > 0 ? preMeta.width / preMeta.height : 1;
  let fittedBuffer = designBuffer;
  if (Number.isFinite(quadAspect) && Number.isFinite(designAspect) && Math.abs(designAspect - quadAspect) / quadAspect > 0.01) {
    let canvasW;
    let canvasH;
    if (designAspect >= quadAspect) {
      canvasW = preMeta.width;
      canvasH = Math.max(1, Math.round(preMeta.width / quadAspect));
    } else {
      canvasH = preMeta.height;
      canvasW = Math.max(1, Math.round(preMeta.height * quadAspect));
    }
    fittedBuffer = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: designBuffer,
          left: Math.round((canvasW - preMeta.width) / 2),
          top: Math.round((canvasH - preMeta.height) / 2),
        },
      ])
      .png()
      .toBuffer();
  }

  // Load design as raw RGBA + its native dimensions.
  const { data: srcData, info: srcInfo } = await sharp(fittedBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sW = srcInfo.width;
  const sH = srcInfo.height;
  const sChannels = srcInfo.channels; // 4 after ensureAlpha

  // Source corners (design rectangle) → destination quad (pixel space).
  const srcPts = [
    { x: 0, y: 0 }, // TL
    { x: sW, y: 0 }, // TR
    { x: sW, y: sH }, // BR
    { x: 0, y: sH }, // BL
  ];
  const dstPts = quadToPixels(quad, W, Hh);

  // Forward homography src→dst, then invert for sampling dst→src.
  const Hfwd = computeHomography(srcPts, dstPts);
  const Hinv = invertHomography(Hfwd);

  // Dest bounding box (clamped to canvas).
  const xs = dstPts.map((p) => p.x);
  const ys = dstPts.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(Hh - 1, Math.ceil(Math.max(...ys)));

  const out = Buffer.alloc(W * Hh * 4); // zero = transparent

  // Bilinear sample helper on the source design.
  const sample = (sx, sy) => {
    if (sx < 0 || sy < 0 || sx > sW - 1 || sy > sH - 1) return null;
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(sW - 1, x0 + 1);
    const y1 = Math.min(sH - 1, y0 + 1);
    const fx = sx - x0;
    const fy = sy - y0;
    const idx = (xx, yy) => (yy * sW + xx) * sChannels;
    const lerp = (a, bb, t) => a + (bb - a) * t;
    const px = [0, 0, 0, 0];
    for (let ch = 0; ch < 4; ch++) {
      const c00 = srcData[idx(x0, y0) + ch];
      const c10 = srcData[idx(x1, y0) + ch];
      const c01 = srcData[idx(x0, y1) + ch];
      const c11 = srcData[idx(x1, y1) + ch];
      const top = lerp(c00, c10, fx);
      const bot = lerp(c01, c11, fx);
      px[ch] = lerp(top, bot, fy);
    }
    return px;
  };

  for (let dy = minY; dy <= maxY; dy++) {
    for (let dx = minX; dx <= maxX; dx++) {
      // Map dest pixel center back to source design coords.
      const s = applyHomography(Hinv, dx + 0.5, dy + 0.5);
      const px = sample(s.x, s.y);
      if (!px) continue;
      const a = px[3];
      if (a <= 0) continue;
      const o = (dy * W + dx) * 4;
      out[o] = Math.round(px[0]);
      out[o + 1] = Math.round(px[1]);
      out[o + 2] = Math.round(px[2]);
      out[o + 3] = Math.round(a);
    }
  }

  return sharp(out, { raw: { width: W, height: Hh, channels: 4 } }).png().toBuffer();
}

module.exports = {
  solveLinearSystem,
  computeHomography,
  applyHomography,
  invertHomography,
  quadToPixels,
  isValidNormalizedQuad,
  warpDesignToQuad,
};
