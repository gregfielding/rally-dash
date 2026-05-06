#!/usr/bin/env node
/**
 * One-off proof: 2-row visible-center matrix (flat_back, model_back) vs preview.visibleCenterY.
 * Same synthetic inputs as scripts/8394-strict-parity-synthetic-proof.js (warp off).
 */

const sharp = require("sharp");
const { cropDesignToArtworkBounds } = require("../lib/compositor8394");
const { render8394DesignOnGarmentSharp, computeLayout8394 } = require("../lib/productFlatRenderMvp");

const ALPHA_TH = 5;
const ART_BASE = 0.5;

function buildMinimalPlacementRow() {
  return {
    placementId: "back_center",
    view: "back",
    defaultX: 0.5,
    defaultY: 0.42,
    defaultScale: 0.58,
    artboardBase: 0.5,
    simpleRenderControls8394: { realism: 72, inkStrength: 88, sizePreset: "medium" },
  };
}

function buildTuning() {
  return {
    settings: {
      placement: { x: 0.5, y: 0.42, scale: 0.58 },
      blend: { fabricFeel: 0.72, printStrength: 0.88, blendMode: "multiply", blendOpacity: 0.82 },
      warp: { enabled: false, warpStrength: 0.35, verticalStretch: 0, horizontalWarp: 0 },
      mask: { enabled: false, feather: 0.08, edgeFade: 0.12 },
    },
  };
}

function buildEffPl() {
  return { artboardBase: 0.5, safeArea: { x: 0.08, y: 0.1, w: 0.84, h: 0.55 } };
}

function buildBlend() {
  return { blendMode: "multiply", blendOpacity: 0.82, fabricFeel: 0.72, printStrength: 0.88 };
}

function buildVariant() {
  return { variantId: "synthetic", colorName: "Test", colorFamily: "dark" };
}

function buildLayoutPlacement(effPl, placementRow, tuning) {
  return {
    ...placementRow,
    defaultX: tuning.settings.placement.x,
    defaultY: tuning.settings.placement.y,
    defaultScale: tuning.settings.placement.scale,
    safeArea: effPl.safeArea,
    artboardBase:
      effPl.artboardBase != null && Number.isFinite(Number(effPl.artboardBase))
        ? Number(effPl.artboardBase)
        : placementRow.artboardBase != null && Number.isFinite(Number(placementRow.artboardBase))
          ? Number(placementRow.artboardBase)
          : ART_BASE,
  };
}

async function makeBlank(w, h) {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 180, g: 160, b: 140, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function makeDesign() {
  const w = 640;
  const h = 400;
  const svg = `<svg width="${w}" height="${h}"><rect x="40" y="30" width="${w - 80}" height="${h - 60}" fill="rgba(20,120,200,0.92)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Mirrors lib/blanks/preview8394CoordinateAudit alpha scan (threshold 5). */
async function getArtworkAlphaBoundsDetailFromBuffer(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const stride = w * 4;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const a = data[row + x * 4 + 3];
      if (a > ALPHA_TH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, w, h };
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Same formula as computePreview8394VisibleVerticalMetrics (tight crop = layout design size). */
function previewVisibleCenterY(blankW, blankH, layoutPlacement, detail) {
  const cropH = detail.h;
  const cropW = detail.w;
  const minYLocal = 0;
  const maxYLocal = detail.maxY - detail.minY;
  const minXLocal = 0;
  const maxXLocal = detail.maxX - detail.minX;
  const { left: placedLeft, top: placedTop, resizedWidth: fw, resizedHeight: fh } = computeLayout8394(
    blankW,
    blankH,
    layoutPlacement,
    cropW,
    cropH
  );
  void minXLocal;
  void maxXLocal;
  const visibleBottomExclusive = placedTop + ((maxYLocal + 1) / cropH) * fh;
  const visibleHeightPx = ((maxYLocal - minYLocal + 1) / cropH) * fh;
  const visibleCenterY = visibleBottomExclusive - visibleHeightPx / 2;
  void fw;
  return { visibleCenterY, visibleBottomExclusive, visibleHeightPx, placedTop, fh };
}

function matrixRow(previewY, v) {
  const finalY = v.final && v.final.visibleCenterY != null ? v.final.visibleCenterY : v.visibleCenterY;
  const delta =
    previewY != null && finalY != null && Number.isFinite(previewY) && Number.isFinite(finalY)
      ? finalY - previewY
      : null;
  return {
    "preview.visibleCenterY": previewY,
    "official.preWarp.visibleCenterY": v.preWarp ? v.preWarp.visibleCenterY : null,
    "official.postWarp.visibleCenterY": v.postWarp ? v.postWarp.visibleCenterY : null,
    "official.postTreatment.visibleCenterY": v.postTreatment != null ? v.postTreatment.visibleCenterY : null,
    "official.final.visibleCenterY": finalY,
    "official.visibleCenterY - preview.visibleCenterY": delta,
    driftSourceVsPreWarp: v.driftSourceVsPreWarp != null ? v.driftSourceVsPreWarp : null,
  };
}

/** First pipeline stage (vs preview) where center Y is strictly greater than preview (downward on garment). */
function firstDownwardStageVsPreview(previewY, v) {
  const eps = 1e-6;
  const stages = [
    ["preWarp", v.preWarp && v.preWarp.visibleCenterY],
    ["postWarp", v.postWarp && v.postWarp.visibleCenterY],
    ["postTreatment", v.postTreatment != null ? v.postTreatment.visibleCenterY : null],
    ["final", v.final && v.final.visibleCenterY != null ? v.final.visibleCenterY : v.visibleCenterY],
  ];
  for (const [name, y] of stages) {
    if (y == null || !Number.isFinite(y) || !Number.isFinite(previewY)) continue;
    if (y - previewY > eps) return name;
  }
  return null;
}

async function run() {
  const placementRow = buildMinimalPlacementRow();
  const tuning = buildTuning();
  const effPl = buildEffPl();
  const variant = buildVariant();
  const blend = buildBlend();
  const layoutPlacement = buildLayoutPlacement(effPl, placementRow, tuning);

  const designBuffer = await makeDesign();
  const detail = await getArtworkAlphaBoundsDetailFromBuffer(designBuffer);
  const cropped = await cropDesignToArtworkBounds(designBuffer, sharp);
  if (cropped.width !== detail.w || cropped.height !== detail.h) {
    console.warn(
      "[proof] crop WxH vs alpha detail WxH:",
      cropped.width,
      cropped.height,
      detail.w,
      detail.h
    );
  }

  async function oneTarget(renderTarget, blankBuffer) {
    const bm = await sharp(blankBuffer).metadata();
    const prev = previewVisibleCenterY(bm.width, bm.height, layoutPlacement, detail);
    const { composeTelemetry } = await render8394DesignOnGarmentSharp({
      sharp,
      blankBuffer,
      designBuffer,
      tuning,
      blend,
      placementRow,
      effPl,
      variant,
      target: renderTarget,
      renderTreatment: "blended",
      renderSelectionLog: [],
      debugArtifacts: null,
    });
    const v = composeTelemetry.artwork8394VisibleVerticalMetrics;
    return { previewY: prev.visibleCenterY, v, row: matrixRow(prev.visibleCenterY, v) };
  }

  const flatBlank = await makeBlank(1400, 1800);
  const modelBlank = await makeBlank(1200, 2200);
  const flat = await oneTarget("flat_back", flatBlank);
  const model = await oneTarget("model_back", modelBlank);

  const f1 = firstDownwardStageVsPreview(flat.previewY, flat.v);
  const f2 = firstDownwardStageVsPreview(model.previewY, model.v);

  console.log(JSON.stringify({ flat_back: flat.row, model_back: model.row }, null, 0));
  console.log(
    "---",
    "firstDownwardVsPreview_flat_back:",
    f1,
    "firstDownwardVsPreview_model_back:",
    f2
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
