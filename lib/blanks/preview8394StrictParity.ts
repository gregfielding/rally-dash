/**
 * Strict parity: natural-canvas preview vs official Sharp `official8394StrictParity` / composeTelemetry.
 * Paste `[OFFICIAL8394_STRICT_PARITY]` JSON in the blank editor to compare.
 */

import type { AlphaCropRectPx, Preview8394ParityTelemetry } from "./preview8394NaturalComposite";

/** Subset of official `official8394StrictParity` from productFlatRenderMvp.js */
export type Official8394StrictParitySnapshot = {
  kind?: "official";
  renderTarget?: string;
  /** "clean" | "blended" — must match dashboard preview composite mode for TL/size parity. */
  renderPipelineMode?: string;
  renderTreatment?: string;
  garmentNaturalPx?: { w: number; h: number };
  designNaturalPx?: { w: number | null; h: number | null };
  alphaCropRectPx?: AlphaCropRectPx;
  fittedSlotTopLeftPx?: { x: number; y: number };
  fittedSlotDimensionsPx?: { w: number; h: number };
  resizedBitmapBeforeWarpPx?: { w: number; h: number };
  bitmapDimensionsAfterWarpMaskPx?: { w: number; h: number };
  bitmapDimensionsAfterTreatmentPx?: { w: number; h: number } | null;
  postEffectBitmapDimensionsPx?: {
    clean: { w: number; h: number };
    blended: { w: number; h: number };
  } | null;
  finalCompositeTopLeftPx?: {
    clean: { x: number; y: number };
    blended: { x: number; y: number };
  } | null;
  sharpBlendModeUsed?: string;
  blendModeInput?: string;
  blendOpacityInput?: number;
  effectiveOpacityOnRaster?: number | null;
  treatmentEngine?: {
    contrastPercent?: number;
    realism?: number;
    designOpacityMultiplier?: number;
  } | null;
  warpApplied?: boolean;
  maskApplied?: boolean;
};

export type Preview8394StrictSnapshot = {
  kind: "preview";
  renderTarget: string;
  compositeKind: "clean" | "blended";
  garmentNaturalPx: { w: number; h: number };
  designNaturalPx: { w: number; h: number };
  alphaCropRectPx: AlphaCropRectPx;
  /** Same meaning as official `preWarpSlotRectPx`: fitted TL + fitted WxH (not art-box TL). */
  preWarpSlotRectPx: { x: number; y: number; w: number; h: number };
  resizedBitmapBeforeWarpPx: { w: number; h: number };
  /** Preview: no Sharp warp — same as resized before warp unless we add canvas warp. */
  bitmapDimensionsAfterWarpMaskPx: { w: number; h: number };
  bitmapDimensionsAfterTreatmentPx: { w: number; h: number } | null;
  postEffectBitmapDimensionsPx: {
    clean: { w: number; h: number };
    blended: { w: number; h: number };
  };
  finalCompositeTopLeftPx: {
    clean: { x: number; y: number };
    blended: { x: number; y: number };
  };
  displayedFinalCompositeTopLeftPx?: { x: number; y: number };
  blendModeEffective: string;
  blendOpacityInput: number;
  designOpacityMultiplier: number;
  effectiveOpacityOnRaster: number;
  canvasFilterApplied: string;
  treatmentApproximation?: {
    contrastPercent?: number;
    saturatePercent?: number;
    note: string;
  };
};

export type StrictParityComparison = {
  placementParity: boolean;
  bitmapSizeParity: boolean;
  cropParity: boolean;
  blendParity: boolean;
  treatmentParity: boolean;
  /** True if any mismatch is only explainable as canvas-vs-Sharp (both sides logged). */
  likelyCanvasVsSharpRenderingOnly: boolean;
  details: {
    placementDeltaPx?: { x: number; y: number };
    bitmapCleanDelta?: { w: number; h: number };
    bitmapBlendedDelta?: { w: number; h: number };
    cropDelta?: { x: number; y: number; w: number; h: number };
    blendModeMatch?: boolean;
    opacityDelta?: number;
    treatmentNote?: string;
  };
};

const EPS_POS = 0.75;
const EPS_OP = 0.002;

function parseContrastSaturateFromFilter(filter: string): { contrast?: number; saturate?: number } {
  const c = /contrast\(([\d.]+)%\)/.exec(filter);
  const s = /saturate\(([\d.]+)%\)/.exec(filter);
  return {
    contrast: c ? Number(c[1]) : undefined,
    saturate: s ? Number(s[1]) : undefined,
  };
}

/**
 * Compare preview strict snapshot to official strict parity log (same renderTarget + composite path).
 */
export function compare8394StrictParity(
  preview: Preview8394StrictSnapshot,
  official: Official8394StrictParitySnapshot
): StrictParityComparison {
  const details: StrictParityComparison["details"] = {};
  const useBlended = preview.compositeKind === "blended";

  const prevTl = useBlended
    ? preview.finalCompositeTopLeftPx.blended
    : preview.finalCompositeTopLeftPx.clean;
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
  const blendParity =
    preview.compositeKind === "clean" ? true : details.blendModeMatch === true;

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

  const likelyCanvasVsSharpRenderingOnly =
    !placementParity || !bitmapSizeParity
      ? Boolean(
          official.warpApplied ||
            (official.bitmapDimensionsAfterTreatmentPx &&
              (official.bitmapDimensionsAfterTreatmentPx.w !== official.resizedBitmapBeforeWarpPx?.w ||
                official.bitmapDimensionsAfterTreatmentPx.h !== official.resizedBitmapBeforeWarpPx?.h))
        )
      : false;

  return {
    placementParity,
    bitmapSizeParity,
    cropParity,
    blendParity,
    treatmentParity,
    likelyCanvasVsSharpRenderingOnly,
    details,
  };
}

export function parseOfficial8394StrictParityJson(raw: string): Official8394StrictParitySnapshot | null {
  let s = raw.trim();
  const bracket = /\[OFFICIAL8394_STRICT_PARITY\]\s*/.exec(s);
  if (bracket) s = s.slice(bracket[0].length).trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try {
    const o = JSON.parse(s) as unknown;
    if (!o || typeof o !== "object") return null;
    return o as Official8394StrictParitySnapshot;
  } catch {
    return null;
  }
}

export function buildPreview8394StrictSnapshotFromTelemetry(
  t: Preview8394ParityTelemetry,
  treatmentApproximation?: Preview8394StrictSnapshot["treatmentApproximation"]
): Preview8394StrictSnapshot {
  const filter = t.canvasFilterApplied ?? "";
  const parsed = parseContrastSaturateFromFilter(filter);
  return {
    kind: "preview",
    renderTarget: t.renderTarget,
    compositeKind: t.compositeKind,
    garmentNaturalPx: t.garmentNaturalPx,
    designNaturalPx: t.designNaturalPx,
    alphaCropRectPx: t.alphaCropRectPx,
    preWarpSlotRectPx: t.preWarpSlotRectPx,
    resizedBitmapBeforeWarpPx: t.resizedBitmapBeforeWarpPx,
    bitmapDimensionsAfterWarpMaskPx: t.bitmapDimensionsAfterWarpMaskPx,
    bitmapDimensionsAfterTreatmentPx: t.bitmapDimensionsAfterTreatmentPx,
    postEffectBitmapDimensionsPx: t.postEffectBitmapDimensionsPx,
    finalCompositeTopLeftPx: t.finalCompositeTopLeftPx,
    displayedFinalCompositeTopLeftPx: t.displayedFinalCompositeTopLeftPx,
    blendModeEffective: t.blendModeEffective,
    blendOpacityInput: t.blendOpacityInput,
    designOpacityMultiplier: t.designOpacityMultiplier,
    effectiveOpacityOnRaster: t.effectiveOpacityOnRaster,
    canvasFilterApplied: t.canvasFilterApplied,
    treatmentApproximation:
      treatmentApproximation ??
      (parsed.contrast != null
        ? {
            contrastPercent: parsed.contrast,
            saturatePercent: parsed.saturate,
            note: "Parsed from canvas ctx.filter string; Sharp uses different kernels.",
          }
        : undefined),
  };
}
