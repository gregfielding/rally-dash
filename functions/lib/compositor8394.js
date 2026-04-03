"use strict";

/**
 * 8394 deterministic design-layer transforms (warp, mask) and front artwork URL resolution.
 *
 * ## Warp (when `warp.enabled === true`)
 * - **warpStrength** (0–1+, clamped): Scales how strong skew + vertical scale feel. Higher = more slant from horizontalWarp and more height change from verticalStretch.
 * - **verticalStretch** (-0.4–0.4): Relative height scale of the design layer: `height' = height * (1 + verticalStretch * (0.25 + 0.75 * warpStrength))` before shear.
 * - **horizontalWarp** (-0.4–0.4): Horizontal shear via Sharp `affine([[1, shear], [0, 1]])` with `shear = horizontalWarp * warpStrength * 0.45`. Positive leans the print to the right toward the bottom.
 *
 * ## Mask (when `mask.enabled === true`)
 * - **feather** (0–0.5): Gaussian blur sigma `0.5 + feather * 8` on the whole RGBA layer after edge fade — softens hard cut edges.
 * - **edgeFade** (0–1): Within the outer ~12% band of the layer (from each edge), alpha is multiplied by `1 - edgeFade * t²` where `t` is 0 at the inner boundary and 1 at the pixel — reduces “sticker” halos at the perimeter.
 *
 * Disabled or missing `warp` / `mask` leaves pixels unchanged (aside from downstream compositing).
 */

const { pickRasterUrlForVariant } = require("./artworkToneResolution");

const ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function sideHasNestedPng(files, assets, side) {
  const a = assets && assets[side];
  const f = files && files[side];
  return !!(
    (a && (a.lightPng || a.darkPng || a.whitePng)) ||
    (f && f.lightPng && f.lightPng.downloadUrl) ||
    (f && f.darkPng && f.darkPng.downloadUrl) ||
    (f && f.whitePng && f.whitePng.downloadUrl)
  );
}

function hasAnySideAwarePngAssets(design) {
  const f = design.files || {};
  const a = design.assets || {};
  return sideHasNestedPng(f, a, "front") || sideHasNestedPng(f, a, "back");
}

function legacyFlatTargetsSide(design, side) {
  const a = design.assets || {};
  const f = design.files || {};
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  const hasLegacy = !!(legL || legD);
  if (!hasLegacy || hasAnySideAwarePngAssets(design)) return false;
  const ss = (design.supportedSides || []).map((s) => String(s).trim().toLowerCase());
  if (ss.length === 1) {
    if (ss[0] === "front") return side === "front";
    if (ss[0] === "back") return side === "back";
  }
  return side === "back";
}

function resolveFrontSidePngUrls(design) {
  const a = design.assets || {};
  const f = design.files || {};
  const nsA = a.front || {};
  const nsF = f.front || {};
  let lightPng = nsA.lightPng || (nsF.lightPng && nsF.lightPng.downloadUrl) || null;
  let darkPng = nsA.darkPng || (nsF.darkPng && nsF.darkPng.downloadUrl) || null;
  let whitePng = nsA.whitePng || (nsF.whitePng && nsF.whitePng.downloadUrl) || null;
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  const legW = a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null;
  if (legacyFlatTargetsSide(design, "front")) {
    lightPng = lightPng != null && lightPng !== "" ? lightPng : legL;
    darkPng = darkPng != null && darkPng !== "" ? darkPng : legD;
    whitePng = whitePng != null && whitePng !== "" ? whitePng : legW;
  }
  return { lightPng, darkPng, whitePng };
}

function deriveColorFamilyFromName(colorName) {
  const dark = new Set([
    "black",
    "midnight navy",
    "navy",
    "indigo",
    "blue",
    "royal blue",
    "cobalt",
    "heather blue",
    "dark blue",
  ]);
  const n = String(colorName || "")
    .trim()
    .toLowerCase();
  return dark.has(n) ? "dark" : "light";
}

function getEffectiveColorFamily(colorFamily, colorName) {
  if (colorFamily === "light" || colorFamily === "dark") return colorFamily;
  return deriveColorFamilyFromName(colorName);
}

function pickDesignFrontPngForVariant(design, blankVariantRow, productVariantDoc) {
  const colorName =
    (productVariantDoc &&
      typeof productVariantDoc.colorName === "string" &&
      productVariantDoc.colorName.trim()) ||
    blankVariantRow.colorName;
  const pvFam = productVariantDoc && productVariantDoc.colorFamily;
  const fam = getEffectiveColorFamily(
    pvFam === "light" || pvFam === "dark" ? pvFam : blankVariantRow.colorFamily,
    colorName
  );
  const pvPref = productVariantDoc && productVariantDoc.preferredArtworkTone;
  const pref =
    pvPref === "light" || pvPref === "dark" || pvPref === "white" ? pvPref : blankVariantRow.preferredArtworkTone;
  const u = resolveFrontSidePngUrls(design);
  return pickRasterUrlForVariant(
    { lightPng: u.lightPng, darkPng: u.darkPng, whitePng: u.whitePng },
    fam,
    pref
  );
}

async function cropDesignToArtworkBounds(designBuffer, sharp) {
  const meta = await sharp(designBuffer).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return { buffer: designBuffer, width: w || 1, height: h || 1 };

  const raw = await sharp(designBuffer).ensureAlpha().raw().toBuffer({ depth: 8, resolveWithObject: false });

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = raw[i + 3];
      if (a > ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boundsW = maxX >= minX ? maxX - minX + 1 : w;
  const boundsH = maxY >= minY ? maxY - minY + 1 : h;
  if (boundsW < 1 || boundsH < 1) {
    return { buffer: designBuffer, width: w, height: h };
  }

  const cropped = await sharp(designBuffer)
    .extract({ left: minX, top: minY, width: boundsW, height: boundsH })
    .png()
    .toBuffer();

  return { buffer: cropped, width: boundsW, height: boundsH };
}

/**
 * @param {Buffer} buf
 * @param {import("sharp")} sharpLib
 * @param {object|null|undefined} warp
 * @returns {Promise<Buffer>}
 */
async function applyDesignWarp8394(buf, sharpLib, warp) {
  if (!warp || warp.enabled !== true) return buf;
  const ws = clamp(Number(warp.warpStrength != null ? warp.warpStrength : 0.35), 0, 1.5);
  const vert = clamp(Number(warp.verticalStretch != null ? warp.verticalStretch : 0), -0.4, 0.4);
  const horiz = clamp(Number(warp.horizontalWarp != null ? warp.horizontalWarp : 0), -0.4, 0.4);

  let pipeline = sharpLib(buf).ensureAlpha();
  const m0 = await pipeline.metadata();
  const w0 = m0.width | 0;
  const h0 = m0.height | 0;
  if (!w0 || !h0) return buf;

  const yScale = 1 + vert * (0.25 + 0.75 * ws);
  if (Math.abs(yScale - 1) > 0.0005) {
    const nh = Math.max(1, Math.round(h0 * yScale));
    pipeline = pipeline.resize({
      width: w0,
      height: nh,
      fit: "fill",
      kernel: sharpLib.kernel.lanczos3,
    });
  }

  const shear = horiz * ws * 0.45;
  if (Math.abs(shear) < 0.0001) {
    return pipeline.png().toBuffer();
  }

  const interpolator =
    sharpLib.interpolators && sharpLib.interpolators.nohalo
      ? sharpLib.interpolators.nohalo
      : sharpLib.interpolators && sharpLib.interpolators.cubic
        ? sharpLib.interpolators.cubic
        : undefined;

  const affineOpts = {
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  };
  if (interpolator) affineOpts.interpolator = interpolator;

  return pipeline
    .affine(
      [
        [1, shear],
        [0, 1],
      ],
      affineOpts
    )
    .png()
    .toBuffer();
}

/**
 * @param {Buffer} buf
 * @param {import("sharp")} sharpLib
 * @param {object|null|undefined} mask
 * @returns {Promise<Buffer>}
 */
async function applyDesignMask8394(buf, sharpLib, mask) {
  if (!mask || mask.enabled !== true) return buf;
  const feather = clamp(Number(mask.feather != null ? mask.feather : 0), 0, 0.5);
  const edgeFade = clamp(Number(mask.edgeFade != null ? mask.edgeFade : 0), 0, 1);

  const { data, info } = await sharpLib(buf).ensureAlpha().raw().toBuffer({ depth: 8, resolveWithObject: true });
  const w = info.width | 0;
  const h = info.height | 0;
  const ch = info.channels | 0;
  if (ch !== 4 || !w || !h) return buf;

  const band = Math.max(2, Math.min(w, h) * 0.12);

  if (edgeFade > 0.0001) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
        const t = dist >= band ? 0 : 1 - dist / band;
        const fade = 1 - edgeFade * t * t;
        data[i + 3] = Math.round(data[i + 3] * fade);
      }
    }
  }

  let out = await sharpLib(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  if (feather > 0.0001) {
    const sigma = 0.5 + feather * 8;
    out = await sharpLib(out).blur(sigma).png().toBuffer();
  }
  return out;
}

function snapshotWarp(warp) {
  if (!warp || typeof warp !== "object") return { enabled: false };
  return {
    enabled: warp.enabled === true,
    warpStrength: warp.warpStrength != null ? Number(warp.warpStrength) : null,
    verticalStretch: warp.verticalStretch != null ? Number(warp.verticalStretch) : null,
    horizontalWarp: warp.horizontalWarp != null ? Number(warp.horizontalWarp) : null,
  };
}

function snapshotMask(mask) {
  if (!mask || typeof mask !== "object") return { enabled: false };
  return {
    enabled: mask.enabled === true,
    feather: mask.feather != null ? Number(mask.feather) : null,
    edgeFade: mask.edgeFade != null ? Number(mask.edgeFade) : null,
  };
}

module.exports = {
  applyDesignWarp8394,
  applyDesignMask8394,
  pickDesignFrontPngForVariant,
  resolveFrontSidePngUrls,
  cropDesignToArtworkBounds,
  snapshotWarp,
  snapshotMask,
};
