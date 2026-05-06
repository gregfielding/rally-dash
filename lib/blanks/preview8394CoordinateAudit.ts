/**
 * 8394 blank editor: compare preview DOM coordinate space vs official `computePlacement8394Layout` (natural raster).
 * Does not touch blend, tone, gallery, or blank plan.
 */

import {
  DEFAULT_GARMENT_SAFE_AREA,
  DESIGN_ARTBOARD_ASPECT_RATIO,
} from "@/lib/render/designArtboardSpec";
import { computePlacement8394Layout, type ComputePlacement8394LayoutResult } from "@/lib/blanks/placement8394Layout";
import { proxiedImageUrlForCanvas } from "@/lib/storageImageProxyUrl";

/** Matches `functions/lib/compositor8394.js` ARTWORK_BOUNDS_ALPHA_THRESHOLD */
export const PREVIEW_ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

export type Preview8394TargetAuditRow = {
  renderTarget: "flat_back" | "model_back";
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  scaleX: number;
  scaleY: number;
  scalesMatchUniformObjectContain: boolean;
  /** CSS % for overlay use this box (relative + inset-0 layer). */
  overlayPercentBasisPx: { w: number; h: number };
  overlayTopLeftDisplayPx: { x: number; y: number };
  /** Map display TL through linear (full-box) scale to natural space — matches official when placement uses full raster. */
  overlayTopLeftNaturalPxFromDisplayMap: { x: number; y: number };
  officialTopLeftNaturalPx: { x: number; y: number };
  deltaPreviewVsOfficialNaturalPx: { x: number; y: number };
  designBoundsPxUsed: { w: number; h: number };
  designBoundsSource: "alpha_scan_canvas" | "full_image_natural";
  computeLayoutOfficial: ComputePlacement8394LayoutResult;
};

/** Overlay: center at (px×W, py×H); width = artBase×scale×containerW; height from 8∶5 artboard aspect. */
export function computeOverlayTopLeftDisplayPx(
  px: number,
  py: number,
  artBase: number,
  scale: number,
  containerW: number,
  containerH: number
): { boxW: number; boxH: number; topLeftX: number; topLeftY: number; centerX: number; centerY: number } {
  const boxW = artBase * scale * containerW;
  const boxH = boxW / DESIGN_ARTBOARD_ASPECT_RATIO;
  const centerX = px * containerW;
  const centerY = py * containerH;
  const topLeftX = centerX - boxW / 2;
  const topLeftY = centerY - boxH / 2;
  return { boxW, boxH, topLeftX, topLeftY, centerX, centerY };
}

export function mapDisplayTopLeftToNaturalLinear(
  topLeftDisplayX: number,
  topLeftDisplayY: number,
  containerW: number,
  containerH: number,
  naturalW: number,
  naturalH: number
): { x: number; y: number } {
  return {
    x: (topLeftDisplayX / containerW) * naturalW,
    y: (topLeftDisplayY / containerH) * naturalH,
  };
}

/**
 * Browser mirror of server alpha-bounds crop (compositor8394 cropDesignToArtworkBounds).
 * Requires CORS-safe image URL.
 */
export async function measureArtworkAlphaBoundsFromImageUrl(
  url: string
): Promise<{ w: number; h: number } | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = proxiedImageUrlForCanvas(url);
    });
  } catch {
    return null;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { w, h };
  ctx.drawImage(img, 0, 0);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return { w, h };
  }
  const data = imageData.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > PREVIEW_ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { w, h };
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Tight alpha bounds in source image pixels (threshold matches compositor8394). */
export type ArtworkAlphaBoundsDetail = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
};

export async function getArtworkAlphaBoundsDetailFromImageUrl(url: string): Promise<ArtworkAlphaBoundsDetail | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = proxiedImageUrlForCanvas(url);
    });
  } catch {
    return null;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const data = imageData.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > PREVIEW_ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, w, h };
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Alpha bounds in source image pixels (for drawImage crop), or null to use full image. */
export async function getArtworkAlphaCropRectFromImageUrl(
  url: string
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const d = await getArtworkAlphaBoundsDetailFromImageUrl(url);
  if (!d) return null;
  return { x: d.minX, y: d.minY, w: d.w, h: d.h };
}

function mergeGarmentSafeArea8394(
  partial: Partial<{ x: number; y: number; w: number; h: number }> | null | undefined
): { x: number; y: number; w: number; h: number } {
  return {
    x: partial?.x ?? DEFAULT_GARMENT_SAFE_AREA.x,
    y: partial?.y ?? DEFAULT_GARMENT_SAFE_AREA.y,
    w: partial?.w ?? DEFAULT_GARMENT_SAFE_AREA.w,
    h: partial?.h ?? DEFAULT_GARMENT_SAFE_AREA.h,
  };
}

/**
 * Vertical placement of visible ink vs garment / safe-area bottoms (8394 preview, same placement math as official).
 * Maps alpha bounds through the fitted bitmap (uniform resize-inside of the alpha crop) to garment Y.
 */
export type Preview8394VisibleContentVerticalMetrics = {
  kind: "preview";
  renderTarget: "flat_back" | "model_back";
  placedBitmapTopLeftPx: { x: number; y: number };
  placedBitmapSizePx: { w: number; h: number };
  alphaBoundsInPlacedBitmapPx: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    w: number;
    h: number;
  };
  visibleBottomEdgeYExclusivePx: number;
  garmentRasterHeightPx: number;
  distanceVisibleBottomToGarmentBottomPx: number;
  safeAreaNormMerged: { x: number; y: number; w: number; h: number };
  safeAreaBottomY_px: number;
  distanceVisibleBottomToSafeAreaBottomPx: number;
  /** Height of visible alpha in garment Y px (scaled from crop). */
  visibleHeightPx: number;
  /** `visibleBottomEdgeYExclusivePx - visibleHeightPx / 2` (garment raster). */
  visibleCenterY: number;
};

/** Subset of official `artwork8394VisibleVerticalMetrics` needed to fill matrix rows (paste from Functions log). */
export type Official8394VisibleCenterSlice = {
  preWarp?: { visibleCenterY: number };
  postWarp?: { visibleCenterY: number };
  postTreatment?: { visibleCenterY: number } | null;
  final?: { visibleCenterY: number };
  visibleCenterY?: number;
  driftSourceVsPreWarp?: string | null;
};

/** One target row: keys match the comparison checklist (flat_back / model_back). */
export type VisibleCenterMatrix8394Row = {
  "preview.visibleCenterY": number | null;
  "official.preWarp.visibleCenterY": number | null;
  "official.postWarp.visibleCenterY": number | null;
  "official.postTreatment.visibleCenterY": number | null;
  "official.final.visibleCenterY": number | null;
  "official.visibleCenterY - preview.visibleCenterY": number | null;
  driftSourceVsPreWarp: string | null;
};

export function build8394VisibleCenterMatrix894(input: {
  preview: {
    flat_back: Preview8394VisibleContentVerticalMetrics | null;
    model_back: Preview8394VisibleContentVerticalMetrics | null;
  };
  official?: {
    flat_back: Official8394VisibleCenterSlice | null;
    model_back: Official8394VisibleCenterSlice | null;
  } | null;
}): { flat_back: VisibleCenterMatrix8394Row; model_back: VisibleCenterMatrix8394Row } {
  const mk = (
    p: Preview8394VisibleContentVerticalMetrics | null,
    o: Official8394VisibleCenterSlice | null | undefined
  ): VisibleCenterMatrix8394Row => {
    const py = p?.visibleCenterY ?? null;
    const finalY = o?.final?.visibleCenterY ?? o?.visibleCenterY ?? null;
    const delta = py != null && finalY != null ? finalY - py : null;
    return {
      "preview.visibleCenterY": py,
      "official.preWarp.visibleCenterY": o?.preWarp?.visibleCenterY ?? null,
      "official.postWarp.visibleCenterY": o?.postWarp?.visibleCenterY ?? null,
      "official.postTreatment.visibleCenterY":
        o?.postTreatment != null && typeof o.postTreatment.visibleCenterY === "number"
          ? o.postTreatment.visibleCenterY
          : null,
      "official.final.visibleCenterY": finalY,
      "official.visibleCenterY - preview.visibleCenterY": delta,
      driftSourceVsPreWarp: o?.driftSourceVsPreWarp ?? null,
    };
  };
  return {
    flat_back: mk(input.preview.flat_back, input.official?.flat_back ?? null),
    model_back: mk(input.preview.model_back, input.official?.model_back ?? null),
  };
}

export async function computePreview8394VisibleVerticalMetrics(input: {
  renderTarget: "flat_back" | "model_back";
  artUrl: string;
  blankWidthPx: number;
  blankHeightPx: number;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  artboardBase: number;
  safeAreaNorm?: Partial<{ x: number; y: number; w: number; h: number }> | null;
}): Promise<Preview8394VisibleContentVerticalMetrics | null> {
  const detail = await getArtworkAlphaBoundsDetailFromImageUrl(input.artUrl);
  if (!detail) return null;

  const layout = computePlacement8394Layout({
    blankWidthPx: input.blankWidthPx,
    blankHeightPx: input.blankHeightPx,
    defaultX: input.defaultX,
    defaultY: input.defaultY,
    defaultScale: input.defaultScale,
    artboardBase: input.artboardBase,
    designWidthPx: detail.w,
    designHeightPx: detail.h,
  });

  const cropH = detail.h;
  const cropW = detail.w;
  /** Tight alpha bbox equals the crop used for layout; bounds are already crop-local (0 … w/h). */
  const minYLocal = 0;
  const maxYLocal = detail.maxY - detail.minY;
  const minXLocal = 0;
  const maxXLocal = detail.maxX - detail.minX;

  const fh = layout.designFittedPx.height;
  const fw = layout.designFittedPx.width;
  const placedTop = layout.designFittedPx.topClamped;
  const placedLeft = layout.designFittedPx.leftClamped;

  const alphaMinYInPlaced = (minYLocal / cropH) * fh;
  const alphaMaxYInPlaced = (maxYLocal / cropH) * fh;
  const alphaMinXInPlaced = (minXLocal / cropW) * fw;
  const alphaMaxXInPlaced = (maxXLocal / cropW) * fw;

  const visibleBottomExclusive = placedTop + ((maxYLocal + 1) / cropH) * fh;
  const visibleHeightPx = ((maxYLocal - minYLocal + 1) / cropH) * fh;
  const visibleCenterY = visibleBottomExclusive - visibleHeightPx / 2;
  const gh = input.blankHeightPx;
  const safe = mergeGarmentSafeArea8394(input.safeAreaNorm);
  const safeBottomY = (safe.y + safe.h) * gh;

  return {
    kind: "preview",
    renderTarget: input.renderTarget,
    placedBitmapTopLeftPx: { x: placedLeft, y: placedTop },
    placedBitmapSizePx: { w: fw, h: fh },
    alphaBoundsInPlacedBitmapPx: {
      minX: alphaMinXInPlaced,
      minY: alphaMinYInPlaced,
      maxX: alphaMaxXInPlaced,
      maxY: alphaMaxYInPlaced,
      w: alphaMaxXInPlaced - alphaMinXInPlaced,
      h: alphaMaxYInPlaced - alphaMinYInPlaced,
    },
    visibleBottomEdgeYExclusivePx: visibleBottomExclusive,
    garmentRasterHeightPx: gh,
    distanceVisibleBottomToGarmentBottomPx: gh - visibleBottomExclusive,
    safeAreaNormMerged: safe,
    safeAreaBottomY_px: safeBottomY,
    distanceVisibleBottomToSafeAreaBottomPx: safeBottomY - visibleBottomExclusive,
    visibleHeightPx,
    visibleCenterY,
  };
}

export function buildPreview8394TargetAuditRow(input: {
  renderTarget: "flat_back" | "model_back";
  naturalWidth: number;
  naturalHeight: number;
  /** Percentage basis = `.relative` wrap client box (same as `absolute inset-0` overlay context). */
  overlayPercentBasisWidth: number;
  overlayPercentBasisHeight: number;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  artboardBase: number;
  designCropWidth: number;
  designCropHeight: number;
  designBoundsSource?: "alpha_scan_canvas" | "full_image_natural";
}): Preview8394TargetAuditRow {
  const {
    renderTarget,
    naturalWidth,
    naturalHeight,
    overlayPercentBasisWidth: cw,
    overlayPercentBasisHeight: ch,
    defaultX: px,
    defaultY: py,
    defaultScale,
    artboardBase,
    designCropWidth,
    designCropHeight,
    designBoundsSource: designBoundsSourceIn,
  } = input;
  const designBoundsSource = designBoundsSourceIn ?? "alpha_scan_canvas";

  const scaleX = cw / naturalWidth;
  const scaleY = ch / naturalHeight;
  const uniform = Math.abs(scaleX - scaleY) < 1e-5;

  const o = computeOverlayTopLeftDisplayPx(px, py, artboardBase, defaultScale, cw, ch);
  const natFromDisplay = mapDisplayTopLeftToNaturalLinear(o.topLeftX, o.topLeftY, cw, ch, naturalWidth, naturalHeight);

  const computeLayoutOfficial = computePlacement8394Layout({
    blankWidthPx: naturalWidth,
    blankHeightPx: naturalHeight,
    defaultX: px,
    defaultY: py,
    defaultScale,
    artboardBase,
    designWidthPx: designCropWidth,
    designHeightPx: designCropHeight,
  });

  const officialTL = {
    x: computeLayoutOfficial.designFittedPx.leftClamped,
    y: computeLayoutOfficial.designFittedPx.topClamped,
  };

  return {
    renderTarget,
    naturalWidth,
    naturalHeight,
    displayedWidth: cw,
    displayedHeight: ch,
    scaleX,
    scaleY,
    scalesMatchUniformObjectContain: uniform,
    overlayPercentBasisPx: { w: cw, h: ch },
    overlayTopLeftDisplayPx: { x: o.topLeftX, y: o.topLeftY },
    overlayTopLeftNaturalPxFromDisplayMap: natFromDisplay,
    officialTopLeftNaturalPx: officialTL,
    deltaPreviewVsOfficialNaturalPx: {
      x: natFromDisplay.x - officialTL.x,
      y: natFromDisplay.y - officialTL.y,
    },
    designBoundsPxUsed: { w: designCropWidth, h: designCropHeight },
    designBoundsSource,
    computeLayoutOfficial,
  };
}

export type Preview8394SideBySideReport = {
  generatedAt: string;
  coordinateSpace: string;
  flat_back: Preview8394TargetAuditRow | null;
  model_back: Preview8394TargetAuditRow | null;
  /** Same placement inputs as rows; vertical ink vs garment seam / safe-area (preview-side). */
  visibleContentVertical?: {
    flat_back: Preview8394VisibleContentVerticalMetrics | null;
    model_back: Preview8394VisibleContentVerticalMetrics | null;
  };
  notes: string[];
};

export function logPreview8394SideBySideReport(
  report: Preview8394SideBySideReport,
  officialByTarget?: {
    flat_back: Official8394VisibleCenterSlice | null;
    model_back: Official8394VisibleCenterSlice | null;
  } | null
): void {
  if (typeof console === "undefined" || !console.table) {
    return;
  }
  const rows = [report.flat_back, report.model_back].filter(Boolean) as Preview8394TargetAuditRow[];
  console.log("[8394_COORD_AUDIT_REPORT]", report);
  if (report.visibleContentVertical) {
    const v = report.visibleContentVertical;
    const matrix = build8394VisibleCenterMatrix894({
      preview: { flat_back: v.flat_back, model_back: v.model_back },
      official: officialByTarget ?? null,
    });
    console.log("[8394_VISIBLE_CONTENT_V]", {
      kind: "preview",
      flat_back: v.flat_back,
      model_back: v.model_back,
    });
    console.log("[8394_VISIBLE_CENTER_MATRIX]", {
      source: "preview",
      flat_back: matrix.flat_back,
      model_back: matrix.model_back,
    });
  }
  console.table(
    rows.map((r) => ({
      target: r.renderTarget,
      natural: `${r.naturalWidth}×${r.naturalHeight}`,
      display: `${r.displayedWidth.toFixed(0)}×${r.displayedHeight.toFixed(0)}`,
      scaleX: r.scaleX.toFixed(6),
      scaleY: r.scaleY.toFixed(6),
      uniform: r.scalesMatchUniformObjectContain,
      overlayTL_display: `${r.overlayTopLeftDisplayPx.x.toFixed(1)},${r.overlayTopLeftDisplayPx.y.toFixed(1)}`,
      overlayTL_nat: `${r.overlayTopLeftNaturalPxFromDisplayMap.x.toFixed(2)},${r.overlayTopLeftNaturalPxFromDisplayMap.y.toFixed(2)}`,
      officialTL_nat: `${r.officialTopLeftNaturalPx.x},${r.officialTopLeftNaturalPx.y}`,
      delta_nat: `${r.deltaPreviewVsOfficialNaturalPx.x.toFixed(2)},${r.deltaPreviewVsOfficialNaturalPx.y.toFixed(2)}`,
      designBounds: `${r.designBoundsPxUsed.w}×${r.designBoundsPxUsed.h} (${r.designBoundsSource})`,
    }))
  );
}

export const PREVIEW8394_COORD_AUDIT_NOTE =
  "Legacy preview: CSS % overlay uses the displayed garment box. Natural-pixel mode: compose at garment natural WxH via computePlacement8394Layout, then CSS-scale the single canvas — compare [PREVIEW8394_NATURAL_CANVAS] / parityLinePreview to official [PLACEMENT8394_PARITY].";
