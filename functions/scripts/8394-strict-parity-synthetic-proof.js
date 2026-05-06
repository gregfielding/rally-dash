#!/usr/bin/env node
/**
 * Local proof (no Firestore): synthetic garment + design → render8394DesignOnGarmentSharp
 * with OFFICIAL8394_STRICT_PARITY, then compare to a preview strict snapshot using the same
 * logic as lib/blanks/preview8394StrictParity `compare8394StrictParity`.
 *
 * Usage:
 *   cd functions && OFFICIAL8394_STRICT_PARITY=1 node scripts/8394-strict-parity-synthetic-proof.js
 */

process.env.OFFICIAL8394_STRICT_PARITY = "1";

const sharp = require("sharp");
const { cropDesignToArtworkBounds } = require("../lib/compositor8394");
const { resizeInsideDimensions8394 } = require("../lib/resizeInside8394");
const { render8394DesignOnGarmentSharp, computeLayout8394 } = require("../lib/productFlatRenderMvp");

const EPS_POS = 0.75;
const EPS_OP = 0.002;

/** Same contrast curve as lib/blanks/preview8394 mapInkStrengthToFactorsPreview / Sharp mapInk8394. */
function mapInkContrastPreview(ink0to100) {
  const i = Math.max(0, Math.min(100, ink0to100)) / 100;
  return Math.min(132, Math.max(58, 64 + i * 58));
}

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
  return {
    artboardBase: 0.5,
    safeArea: { x: 0.08, y: 0.1, w: 0.84, h: 0.55 },
  };
}

function buildBlend() {
  return {
    blendMode: "multiply",
    blendOpacity: 0.82,
    fabricFeel: 0.72,
    printStrength: 0.88,
  };
}

function buildVariant() {
  return { variantId: "synthetic", colorName: "Test", colorFamily: "dark" };
}

const ART_BASE = 0.5;

function buildLayoutPlacement(effPl, placementRow, tuning) {
  if (effPl && placementRow) {
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
  return placementRow;
}

/**
 * Mirrors compose8394NaturalPixelPreview telemetry + BlankRenderProfileEditor strict snapshot
 * (treatmentApproximation from mapInkStrengthToFactorsPreview(printStrength*100)).
 */
function buildPreviewStrictSnapshot({
  official,
  layoutPlacement,
  blankW,
  blankH,
  designNatW,
  designNatH,
  crop,
  left0,
  top0,
  fw,
  fh,
  blendOpacity,
  inkMult,
  printStrength01,
}) {
  const contrastApprox = mapInkContrastPreview(Math.round(printStrength01 * 100));
  const fitInsideSlot = resizeInsideDimensions8394(crop.width, crop.height, fw, fh);
  const destLeft = Math.max(
    0,
    Math.min(Math.round(left0 + (fw - fitInsideSlot.w) / 2), blankW - fitInsideSlot.w)
  );
  const destTop = Math.max(
    0,
    Math.min(Math.round(top0 + (fh - fitInsideSlot.h) / 2), blankH - fitInsideSlot.h)
  );
  return {
    kind: "preview",
    renderTarget: official.renderTarget,
    compositeKind: "blended",
    garmentNaturalPx: { w: blankW, h: blankH },
    designNaturalPx: { w: designNatW, h: designNatH },
    alphaCropRectPx: { x: crop.left, y: crop.top, w: crop.width, h: crop.height },
    preWarpSlotRectPx: { x: left0, y: top0, w: fw, h: fh },
    resizedBitmapBeforeWarpPx: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    bitmapDimensionsAfterWarpMaskPx: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    bitmapDimensionsAfterTreatmentPx: null,
    postEffectBitmapDimensionsPx: {
      clean: { w: fitInsideSlot.w, h: fitInsideSlot.h },
      blended: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    },
    finalCompositeTopLeftPx: {
      clean: { x: destLeft, y: destTop },
      blended: { x: destLeft, y: destTop },
    },
    blendModeEffective: "multiply",
    blendOpacityInput: blendOpacity,
    designOpacityMultiplier: inkMult,
    effectiveOpacityOnRaster: blendOpacity * inkMult,
    canvasFilterApplied: "none",
    treatmentApproximation: {
      contrastPercent: contrastApprox,
      saturatePercent: 100,
      note: "Synthetic: ink-only contrast; matches dashboard when tuning uses printStrength.",
    },
  };
}

function compare8394StrictParityInline(preview, official) {
  const details = {};
  const useBlended = preview.compositeKind === "blended";
  const prevTl = useBlended ? preview.finalCompositeTopLeftPx.blended : preview.finalCompositeTopLeftPx.clean;
  const offTl = official.finalCompositeTopLeftPx
    ? useBlended
      ? official.finalCompositeTopLeftPx.blended
      : official.finalCompositeTopLeftPx.clean
    : null;

  let placementParity = false;
  if (offTl && prevTl) {
    details.placementDeltaPx = { x: prevTl.x - offTl.x, y: prevTl.y - offTl.y };
    placementParity =
      Math.abs(details.placementDeltaPx.x) <= EPS_POS && Math.abs(details.placementDeltaPx.y) <= EPS_POS;
  }

  const prevPost = preview.postEffectBitmapDimensionsPx;
  const offPost = official.postEffectBitmapDimensionsPx;
  let bitmapSizeParity = false;
  if (prevPost && offPost) {
    details.bitmapCleanDelta = {
      w: prevPost.clean.w - offPost.clean.w,
      h: prevPost.clean.h - offPost.clean.h,
    };
    details.bitmapBlendedDelta = {
      w: prevPost.blended.w - offPost.blended.w,
      h: prevPost.blended.h - offPost.blended.h,
    };
    const cd = useBlended ? details.bitmapBlendedDelta : details.bitmapCleanDelta;
    bitmapSizeParity = Math.abs(cd.w) <= EPS_POS && Math.abs(cd.h) <= EPS_POS;
  }

  let cropParity = false;
  if (official.alphaCropRectPx && preview.alphaCropRectPx) {
    const a = preview.alphaCropRectPx;
    const b = official.alphaCropRectPx;
    details.cropDelta = { x: a.x - b.x, y: a.y - b.y, w: a.w - b.w, h: a.h - b.h };
    cropParity =
      Math.abs(details.cropDelta.x) <= EPS_POS &&
      Math.abs(details.cropDelta.y) <= EPS_POS &&
      Math.abs(details.cropDelta.w) <= EPS_POS &&
      Math.abs(details.cropDelta.h) <= EPS_POS;
  }

  const modePrev = String(preview.blendModeEffective || "").toLowerCase();
  const modeOff = String(official.blendModeInput || "").toLowerCase();
  details.blendModeMatch =
    modePrev === modeOff ||
    (modePrev === "source-over" && modeOff === "normal") ||
    (modePrev === "multiply" && modeOff === "multiply");
  const blendParity = preview.compositeKind === "clean" ? true : details.blendModeMatch === true;

  const opPrev = preview.effectiveOpacityOnRaster;
  const opOff = official.effectiveOpacityOnRaster;
  let treatmentParity = true;
  if (opOff != null && Number.isFinite(opPrev)) {
    details.opacityDelta = opPrev - opOff;
    treatmentParity = Math.abs(details.opacityDelta) <= EPS_OP;
  }
  const pt = official.treatmentEngine;
  const approx = preview.treatmentApproximation;
  if (pt && approx?.contrastPercent != null) {
    if (Math.abs((pt.contrastPercent ?? 0) - approx.contrastPercent) > 1) {
      treatmentParity = false;
      details.treatmentNote = "contrastPercent differs between Sharp treatment and CSS filter preview";
    }
  }

  return {
    placementParity,
    bitmapSizeParity,
    cropParity,
    blendParity,
    treatmentParity,
    details,
  };
}

function firstFailing(row) {
  const order = ["placementParity", "bitmapSizeParity", "cropParity", "blendParity", "treatmentParity"];
  for (const k of order) {
    if (!row[k]) return k;
  }
  return null;
}

async function makeBlank(w, h) {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 180, g: 160, b: 140, alpha: 1 },
    },
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

async function runTarget(label, blankBuffer, designBuffer, placementRow, tuning, effPl, variant, blend, renderTarget) {
  const layoutPlacement = buildLayoutPlacement(effPl, placementRow, tuning);
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

  const official = composeTelemetry.official8394StrictParity;
  const blankMeta = await sharp(blankBuffer).metadata();
  const designMeta = await sharp(designBuffer).metadata();
  const cropped = await cropDesignToArtworkBounds(designBuffer, sharp);
  const { left: left0, top: top0, resizedWidth: fw, resizedHeight: fh } = computeLayout8394(
    blankMeta.width,
    blankMeta.height,
    layoutPlacement,
    cropped.width,
    cropped.height
  );

  const inkMult =
    composeTelemetry.derived8394Engine && composeTelemetry.derived8394Engine.designOpacityMultiplier != null
      ? composeTelemetry.derived8394Engine.designOpacityMultiplier
      : 1;

  const previewSnap = buildPreviewStrictSnapshot({
    official,
    layoutPlacement,
    blankW: blankMeta.width,
    blankH: blankMeta.height,
    designNatW: designMeta.width,
    designNatH: designMeta.height,
    crop: { left: cropped.left, top: cropped.top, width: cropped.width, height: cropped.height },
    left0,
    top0,
    fw,
    fh,
    blendOpacity: blend.blendOpacity,
    inkMult,
    printStrength01: tuning.settings.blend.printStrength,
  });

  const cmp = compare8394StrictParityInline(previewSnap, official);
  return { label, official, previewSnap, compare: cmp, firstFailing: firstFailing(cmp) };
}

async function main() {
  const placementRow = buildMinimalPlacementRow();
  const tuning = buildTuning();
  const effPl = buildEffPl();
  const variant = buildVariant();
  const blend = buildBlend();

  const designBuffer = await makeDesign();
  const flatBlank = await makeBlank(1400, 1800);
  const modelBlank = await makeBlank(1200, 2200);

  const flat = await runTarget("flat_back", flatBlank, designBuffer, placementRow, tuning, effPl, variant, blend, "flat_back");
  const model = await runTarget("model_back", modelBlank, designBuffer, placementRow, tuning, effPl, variant, blend, "model_back");

  function summarize(run) {
    const c = run.compare;
    return {
      firstFailing: run.firstFailing,
      rows: {
        placementParity: c.placementParity,
        bitmapSizeParity: c.bitmapSizeParity,
        cropParity: c.cropParity,
        blendParity: c.blendParity,
        treatmentParity: c.treatmentParity,
      },
      details: c.details,
    };
  }

  console.log(JSON.stringify({ flat_back: summarize(flat), model_back: summarize(model) }, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
