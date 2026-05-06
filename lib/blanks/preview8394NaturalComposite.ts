/**
 * 8394 blank preview: compose garment + design at natural garment pixels, then scale for display.
 * Placement uses `computePlacement8394Layout` — same fitted TL + fitted WxH as `computeLayout8394` / Sharp.
 */

import { computePlacement8394Layout, type ComputePlacement8394LayoutResult } from "@/lib/blanks/placement8394Layout";
import { resizeInsideDimensions8394 } from "@/lib/blanks/resizeInside8394";
import { proxiedImageUrlForCanvas } from "@/lib/storageImageProxyUrl";

export type AlphaCropRectPx = { x: number; y: number; w: number; h: number };

export type Preview8394ParityTelemetry = {
  kind: "preview";
  coordinateBasis: "natural_pixel_canvas";
  renderTarget: string;
  compositeKind: "clean" | "blended";
  warpEnabledEffective: boolean;
  maskEnabledEffective: boolean;
  artboardBaseUsed: number;
  garmentNaturalPx: { w: number; h: number };
  designNaturalPx: { w: number; h: number };
  compositionCanvasPx: { w: number; h: number };
  /** Same as Sharp alpha extract rect (source design pixel space). */
  alphaCropRectPx: AlphaCropRectPx;
  centerPointPx: { x: number; y: number };
  /** Fitted design top-left + fitted WxH — matches official `preWarpSlotRectPx` (left0/top0 are fitted TL). */
  preWarpSlotRectPx: { x: number; y: number; w: number; h: number };
  croppedDesignWxH: { w: number; h: number };
  resizedBitmapBeforeWarpPx: { w: number; h: number };
  /** Preview does not run Sharp warp/mask; dimensions match pre-warp unless noted in `notes`. */
  bitmapDimensionsAfterWarpMaskPx: { w: number; h: number };
  /** Canvas filter does not change raster size; null unless we add a measurable resize step. */
  bitmapDimensionsAfterTreatmentPx: { w: number; h: number } | null;
  postEffectBitmapDimensionsPx: {
    clean: { w: number; h: number };
    blended: { w: number; h: number };
  };
  finalCompositeTopLeftPx: {
    clean: { x: number; y: number };
    blended: { x: number; y: number };
  };
  finalOutputWidthHeight: { w: number; h: number };
  displayScaleApplied?: { scaleX: number; scaleY: number; uniform: boolean };
  displayedFinalCompositeTopLeftPx?: { x: number; y: number };
  /** Canvas GCO / CSS blend name for logs. */
  blendModeEffective: string;
  blendOpacityInput: number;
  designOpacityMultiplier: number;
  effectiveOpacityOnRaster: number;
  canvasFilterApplied: string;
  previewToOfficialDeltaPx: { x: number; y: number };
  layout: ComputePlacement8394LayoutResult;
  notes: string[];
  parityLinePreview: {
    kind: "preview";
    renderTarget: string;
    warpEnabledEffective: boolean;
    artboardBaseUsed: number;
    centerPointPx: { x: number; y: number };
    preWarpSlotRectPx: { x: number; y: number; w: number; h: number };
    postWarpBitmapDimensionsPx: {
      clean: { w: number; h: number };
      blended: { w: number; h: number };
    };
    finalCompositeTopLeftBlendedPx: { x: number; y: number };
  };
};

function mapBlendModeToCanvas(mode: string): GlobalCompositeOperation {
  const m = String(mode || "multiply").toLowerCase();
  if (m === "multiply") return "multiply";
  if (m === "overlay") return "overlay";
  if (m === "soft-light") return "soft-light";
  if (m === "normal") return "source-over";
  return "multiply";
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url.slice(0, 80)}`));
    img.src = proxiedImageUrlForCanvas(url);
  });
}

/**
 * Composite at natural garment dimensions. Does not run Sharp warp/mask; telemetry separates stages for diff vs official.
 */
export async function compose8394NaturalPixelPreview(args: {
  garmentUrl: string;
  designUrl: string;
  designCrop: AlphaCropRectPx;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  artboardBase: number;
  compositeKind: "clean" | "blended";
  blendMode: string;
  blendOpacity: number;
  designOpacityMultiplier: number;
  canvasFilter: string;
  warpEnabled: boolean;
  maskEnabled?: boolean;
  renderTarget: string;
}): Promise<{ canvas: HTMLCanvasElement; telemetry: Preview8394ParityTelemetry }> {
  const [garmentImg, designImg] = await Promise.all([
    loadImageElement(args.garmentUrl),
    loadImageElement(args.designUrl),
  ]);

  const bw = garmentImg.naturalWidth;
  const bh = garmentImg.naturalHeight;
  if (!bw || !bh) throw new Error("Invalid garment dimensions");

  const dwNat = designImg.naturalWidth;
  const dhNat = designImg.naturalHeight;

  const cropW = args.designCrop.w;
  const cropH = args.designCrop.h;
  const layout = computePlacement8394Layout({
    blankWidthPx: bw,
    blankHeightPx: bh,
    defaultX: args.defaultX,
    defaultY: args.defaultY,
    defaultScale: args.defaultScale,
    artboardBase: args.artboardBase,
    designWidthPx: cropW,
    designHeightPx: cropH,
  });

  const fw = layout.designFittedPx.width;
  const fh = layout.designFittedPx.height;
  const fittedLeft = layout.designFittedPx.leftClamped;
  const fittedTop = layout.designFittedPx.topClamped;
  const sx = args.designCrop.x;
  const sy = args.designCrop.y;
  const sw = args.designCrop.w;
  const sh = args.designCrop.h;

  /** Matches Sharp `resize(fittedWx, fittedH, { fit: "inside" })` on the cropped design — may be smaller than the slot on one axis. */
  const fitInsideSlot = resizeInsideDimensions8394(cropW, cropH, fw, fh);
  const destLeft = Math.max(0, Math.min(Math.round(fittedLeft + (fw - fitInsideSlot.w) / 2), bw - fitInsideSlot.w));
  const destTop = Math.max(0, Math.min(Math.round(fittedTop + (fh - fitInsideSlot.h) / 2), bh - fitInsideSlot.h));

  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(garmentImg, 0, 0, bw, bh);

  const notes: string[] = [];
  if (args.warpEnabled) {
    notes.push(
      "Preview: no Sharp mesh warp — bitmapDimensionsAfterWarpMaskPx matches resized (browser cannot mirror applyDesignWarp8394 exactly)."
    );
  }
  if (args.maskEnabled) {
    notes.push("Preview: no Sharp edge mask — official may soften alpha at edges.");
  }

  const blendModeEffective =
    args.compositeKind === "clean" ? "source-over" : mapBlendModeToCanvas(args.blendMode);
  const ink = args.designOpacityMultiplier;
  const effectiveOpacityOnRaster =
    args.compositeKind === "clean" ? 1 : Math.min(1, Math.max(0, args.blendOpacity * ink));

  if (args.compositeKind === "clean") {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.drawImage(designImg, sx, sy, sw, sh, destLeft, destTop, fitInsideSlot.w, fitInsideSlot.h);
  } else {
    ctx.globalCompositeOperation = blendModeEffective;
    ctx.globalAlpha = effectiveOpacityOnRaster;
    ctx.filter = args.canvasFilter && args.canvasFilter.trim() && args.canvasFilter !== "none" ? args.canvasFilter : "none";
    ctx.drawImage(designImg, sx, sy, sw, sh, destLeft, destTop, fitInsideSlot.w, fitInsideSlot.h);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
  }

  const tlClean = { x: destLeft, y: destTop };
  const tlBlended = { x: destLeft, y: destTop };

  const maskEnabled = args.maskEnabled === true;

  const telemetry: Preview8394ParityTelemetry = {
    kind: "preview",
    coordinateBasis: "natural_pixel_canvas",
    renderTarget: args.renderTarget,
    compositeKind: args.compositeKind,
    warpEnabledEffective: args.warpEnabled,
    maskEnabledEffective: maskEnabled,
    artboardBaseUsed: args.artboardBase,
    garmentNaturalPx: { w: bw, h: bh },
    designNaturalPx: { w: dwNat, h: dhNat },
    compositionCanvasPx: { w: bw, h: bh },
    alphaCropRectPx: { x: sx, y: sy, w: sw, h: sh },
    centerPointPx: layout.centerPx,
    preWarpSlotRectPx: {
      x: fittedLeft,
      y: fittedTop,
      w: fw,
      h: fh,
    },
    croppedDesignWxH: { w: cropW, h: cropH },
    resizedBitmapBeforeWarpPx: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    bitmapDimensionsAfterWarpMaskPx: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    bitmapDimensionsAfterTreatmentPx: null,
    postEffectBitmapDimensionsPx: {
      clean: { w: fitInsideSlot.w, h: fitInsideSlot.h },
      blended: { w: fitInsideSlot.w, h: fitInsideSlot.h },
    },
    finalCompositeTopLeftPx: {
      clean: tlClean,
      blended: tlBlended,
    },
    finalOutputWidthHeight: { w: bw, h: bh },
    blendModeEffective,
    blendOpacityInput: args.blendOpacity,
    designOpacityMultiplier: ink,
    effectiveOpacityOnRaster,
    canvasFilterApplied:
      args.compositeKind === "blended" && args.canvasFilter && args.canvasFilter !== "none"
        ? args.canvasFilter
        : "none",
    previewToOfficialDeltaPx: { x: 0, y: 0 },
    layout,
    notes,
    parityLinePreview: {
      kind: "preview",
      renderTarget: args.renderTarget,
      warpEnabledEffective: args.warpEnabled,
      artboardBaseUsed: args.artboardBase,
      centerPointPx: layout.centerPx,
      preWarpSlotRectPx: {
        x: fittedLeft,
        y: fittedTop,
        w: fw,
        h: fh,
      },
      postWarpBitmapDimensionsPx: {
        clean: { w: fitInsideSlot.w, h: fitInsideSlot.h },
        blended: { w: fitInsideSlot.w, h: fitInsideSlot.h },
      },
      finalCompositeTopLeftBlendedPx: tlBlended,
    },
  };

  const dbg =
    process.env.NEXT_PUBLIC_DEBUG_8394_PLACEMENT_PARITY === "1" ||
    (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_PLACEMENT_PARITY") === "1");
  const strictDbg =
    process.env.NEXT_PUBLIC_DEBUG_8394_STRICT_PARITY === "1" ||
    (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_STRICT_PARITY") === "1");
  if (dbg) {
    console.log(`[PLACEMENT8394_PARITY] ${JSON.stringify(telemetry.parityLinePreview)}`);
    console.log("[PREVIEW8394_NATURAL_CANVAS]", JSON.stringify(telemetry));
  }
  if (strictDbg || dbg) {
    console.log(`[PREVIEW8394_STRICT_PARITY] ${JSON.stringify(telemetry)}`);
  }

  return { canvas, telemetry };
}

export function mergeDisplayScaleIntoTelemetry(
  t: Preview8394ParityTelemetry,
  canvasEl: HTMLCanvasElement
): Preview8394ParityTelemetry {
  const cw = canvasEl.clientWidth;
  const ch = canvasEl.clientHeight;
  const bw = canvasEl.width;
  const bh = canvasEl.height;
  const scaleX = bw > 0 ? cw / bw : 1;
  const scaleY = bh > 0 ? ch / bh : 1;
  const uniform = Math.abs(scaleX - scaleY) < 0.001;
  const tl =
    t.compositeKind === "blended" ? t.finalCompositeTopLeftPx.blended : t.finalCompositeTopLeftPx.clean;
  return {
    ...t,
    displayScaleApplied: { scaleX, scaleY, uniform },
    displayedFinalCompositeTopLeftPx: {
      x: tl.x * scaleX,
      y: tl.y * scaleY,
    },
  };
}
