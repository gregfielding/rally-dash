"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type LegacyRef,
} from "react";
import type {
  RPBlank,
  RPBlankMask,
  RPPlacement,
  RpRenderTarget,
  RpRenderTargetSettings,
} from "@/lib/types/firestore";
import type { UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { useDesigns } from "@/lib/hooks/useDesignAssets";
import { useAuth } from "@/lib/providers/AuthProvider";
import {
  getDesignPreviewUrl,
  pickDesignSvgUrlForGarment,
  resolveDesignAssets,
} from "@/lib/designs/designHelpers";
import { resolveBlendedPreviewBlend8394 } from "@/lib/designs/artworkToneResolution";
import {
  firstActiveVariant,
  getBlankVariants,
  getVariantById,
  getEffectiveColorFamily,
  isMasterBlank,
  derivePlacementEngineFields8394,
  inferSimpleControls8394FromLegacy,
  normalizeSimpleControls8394,
  sizePresetToDefaultScale,
} from "@/lib/blanks";
import type { DesignDoc, RP8394SizePreset } from "@/lib/types/firestore";
import type { RPPlacementSimpleRenderControls8394 } from "@/lib/types/firestore";
import { get8394DesignTreatmentFromPlacement } from "@/lib/products/flatRenderFingerprint";
import {
  build8394PreviewMaskCss,
  build8394PreviewWarpTransform,
  fabricFeelToSaturatePercent,
  mapInkStrengthToFactorsPreview,
  mapRealismToBlendPreview,
} from "@/lib/blanks/preview8394";
import { computePlacement8394Layout } from "@/lib/blanks/placement8394Layout";
import {
  buildPreview8394TargetAuditRow,
  computePreview8394VisibleVerticalMetrics,
  getArtworkAlphaCropRectFromImageUrl,
  logPreview8394SideBySideReport,
  measureArtworkAlphaBoundsFromImageUrl,
  PREVIEW8394_COORD_AUDIT_NOTE,
  type Preview8394SideBySideReport,
} from "@/lib/blanks/preview8394CoordinateAudit";
import {
  compose8394NaturalPixelPreview,
  loadImageElement,
  mergeDisplayScaleIntoTelemetry,
  type Preview8394ParityTelemetry,
} from "@/lib/blanks/preview8394NaturalComposite";
import {
  buildPreview8394StrictSnapshotFromTelemetry,
  compare8394StrictParity,
  parseOfficial8394StrictParityJson,
  type StrictParityComparison,
} from "@/lib/blanks/preview8394StrictParity";
import {
  buildEffectiveRenderTargetSettingsMap,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
  type RenderProfileTuningLayer,
} from "@/lib/products/resolveProductRenderProfile";
import {
  DEFAULT_GARMENT_SAFE_AREA,
  DESIGN_ARTBOARD_HEIGHT_PX,
  DESIGN_ARTBOARD_WIDTH_PX,
} from "@/lib/render/designArtboardSpec";
import { proxiedImageUrlForCanvas } from "@/lib/storageImageProxyUrl";
import { httpsCallable } from "firebase/functions";
import { functions as firebaseFunctions, db as firebaseDb } from "@/lib/firebase/config";
import { doc as firestoreDoc, onSnapshot, updateDoc as firestoreUpdateDoc } from "firebase/firestore";
import type { RPBlankPreviewJob } from "@/lib/types/firestore";

/**
 * AI realism preview uses async pipeline (rp_blank_preview_jobs + onSnapshot) so the
 * synchronous callable HTTP gateway (~60s ceiling) doesn't cut off long fal.ai
 * inferences. The callable enqueues a job and returns immediately; the editor watches
 * the doc and progresses the UI as Stage A then Stage B land.
 * Spec: RALLY_BLANK_PREVIEW_RENDER.md §5.
 */
const AI_REALISM_PREVIEW_ENABLED = true;
import {
  RENDER_STYLE_PRESET_LABELS,
  RENDER_STYLE_PRESET_ORDER,
  RENDER_STYLE_TO_SIMPLE_8394,
  RENDER_STYLE_TO_ZONE_BLEND,
  matchRenderStylePreset8394,
  matchRenderStylePresetZone,
  type RenderStylePresetId,
} from "@/lib/render/renderStylePresets";
import {
  RENDER_TARGETS,
  RENDER_TARGET_LABELS,
  blendSettingsToPreviewCss,
  buildRenderTargetSettingsMap,
  cloneRenderTargetSettings,
  defaultRenderTargetForZoneView,
  getDefaultRenderTargetSettings,
  getRenderTargetPreviewUrl,
  blendSettingsToEngineBlend,
  legacyZoneBlendToBlend01,
  mergeRenderTargetSettings,
  pickRowForRenderTarget,
  renderTargetToGarmentSide,
} from "@/lib/render/renderTargetTuning";
import { TargetTuning8394Panel } from "./TargetTuning8394Panel";

const BLEND_OPTIONS = ["normal", "multiply", "overlay", "soft-light"] as const;

function placementSide(placementId: string): "front" | "back" {
  if (placementId.startsWith("back_")) return "back";
  return "front";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** UI scale slider 0–150% ↔ engine `defaultScale` (placement). */
const SCALE_PCT_MIN = 0;
const SCALE_PCT_MAX = 150;
const SCALE_ENGINE_MIN = 0.08;
const SCALE_ENGINE_MAX = 1.35;

function scalePercentFromEngine(s: number): number {
  const x = clamp(s, SCALE_ENGINE_MIN, SCALE_ENGINE_MAX);
  return Math.round(((x - SCALE_ENGINE_MIN) / (SCALE_ENGINE_MAX - SCALE_ENGINE_MIN)) * SCALE_PCT_MAX);
}

function scaleEngineFromPercent(pct: number): number {
  const t = clamp(pct, SCALE_PCT_MIN, SCALE_PCT_MAX) / SCALE_PCT_MAX;
  return SCALE_ENGINE_MIN + t * (SCALE_ENGINE_MAX - SCALE_ENGINE_MIN);
}

function sizePresetFromScale8394(scale: number): RP8394SizePreset {
  const s = scale;
  if (s < 0.46) return "small";
  if (s < 0.68) return "medium";
  if (s < 0.9) return "large";
  return "fill_safe";
}

/** Non-8394 custom print style: two abstract sliders → stored zone blend. */
function zoneCustomSlidersToBlend(fabricFeel: number, printStrength: number): { blendMode: string; blendOpacity: number } {
  const pf = clamp(fabricFeel, 0, 100) / 100;
  const ps = clamp(printStrength, 0, 100) / 100;
  const blendOpacity = clamp(0.35 + ps * 0.65, 0.3, 1);
  let blendMode = "multiply";
  if (pf < 0.28) blendMode = "normal";
  else if (pf < 0.5) blendMode = "soft-light";
  else if (pf < 0.72) blendMode = "overlay";
  else blendMode = "multiply";
  const opacityAdjust = blendOpacity * (0.7 + (1 - pf) * 0.3);
  return { blendMode, blendOpacity: clamp(opacityAdjust, 0.28, 1) };
}

function zoneBlendToApproxCustomSliders(z: {
  blendMode?: string | null;
  blendOpacity?: number | null;
} | null | undefined): { fabricFeel: number; printStrength: number } {
  const op = typeof z?.blendOpacity === "number" && Number.isFinite(z.blendOpacity) ? z.blendOpacity : 0.85;
  const mode = String(z?.blendMode || "multiply").toLowerCase();
  let fabricFeel = 75;
  if (mode === "normal") fabricFeel = 12;
  else if (mode === "soft-light") fabricFeel = 38;
  else if (mode === "overlay") fabricFeel = 58;
  const printStrength = clamp(Math.round(((op - 0.35) / 0.65) * 100), 0, 100);
  return { fabricFeel, printStrength };
}

type GarmentPreviewCanvasProps = {
  garmentUrl: string;
  side: "front" | "back";
  imgRef?: LegacyRef<HTMLImageElement | HTMLCanvasElement | null>;
  showSafeArea: boolean;
  showClipHint: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  px: number;
  py: number;
  artBase: number;
  /**
   * Optional override for the design overlay width fraction. When set, the design's
   * CSS width is `(printZoneWidthFraction * scale * 100)%` instead of the legacy
   * `(artBase * scale * 100)%`. Pass the zone's `safeArea.w` to align the CSS canvas
   * preview with what the deterministic Sharp compositor (`onMockJobCreated` /
   * `composeStageA`) outputs after the Option A safeArea-based sizing change.
   * Spec: RALLY_BLANK_PREVIEW_RENDER.md follow-up.
   */
  printZoneWidthFraction?: number | null;
  scale: number;
  overlayOpacity: number;
  overlayMixBlendMode: CSSProperties["mixBlendMode"];
  overlayFilter?: string;
  /** Default includes drop-shadow; omit shadow for sharper blended 8394 preview. */
  overlayImgClassName?: string;
  /** 8394 preview: CSS 3D/skew warp (appended after translate). */
  overlayWarpTransform?: string;
  /** 8394 preview: soft edge mask on the artwork layer. */
  overlayMaskStyle?: CSSProperties;
  overlayArtUrl: string;
  onPointerDownOverlay: (e: React.PointerEvent) => void;
  maxHeightClass: string;
  emptyOverlay?: React.ReactNode;
  /**
   * 8394: natural-pixel canvas composite (`computePlacement8394Layout`) then CSS-scale to this box.
   * Legacy display-space % overlay when false.
   */
  pixelFaithful8394?: boolean;
  /** 8394 natural canvas only: clean vs blended composite (matches preview mode). */
  composite8394Kind?: "clean" | "blended";
  /** 8394 natural canvas: render target label for telemetry. */
  renderTarget8394?: RpRenderTarget;
  blendMode8394?: string;
  blendOpacity8394?: number;
  designOpacityMultiplier8394?: number;
  canvasFilter8394?: string;
  warpEnabled8394?: boolean;
  maskEnabled8394?: boolean;
  /** Fires when natural canvas telemetry updates (resize or recompose). */
  on8394ParityTelemetry?: (t: Preview8394ParityTelemetry | null) => void;
  /**
   * `rp_blank_masks/{blankId}_{view}` PNG (white = print area). Drawn semi-transparent
   * on top of the garment so designers can see when the design overlay crosses
   * the editable region. Same mask PNG the compositor multiplies onto the design
   * RGBA in `onMockJobCreated`.
   */
  blankMaskUrl?: string | null;
  /** "off" hides overlay (default). "filled" tints the editable region. "outline" only highlights its edge. */
  blankMaskOverlayMode?: "off" | "filled" | "outline";
  /** 0–1; default 0.35. Only used in "filled" mode. */
  blankMaskOverlayOpacity?: number;
  /** Tints the grayscale mask so it pops against any garment color. Default 'magenta'. */
  blankMaskOverlayTint?: "magenta" | "cyan" | "lime";
};

const BLANK_MASK_TINT_TO_HEX: Record<NonNullable<GarmentPreviewCanvasProps["blankMaskOverlayTint"]>, string> = {
  magenta: "#ec4899",
  cyan: "#06b6d4",
  lime: "#84cc16",
};

function GarmentPreviewCanvas({
  garmentUrl,
  side,
  imgRef,
  showSafeArea,
  showClipHint,
  sx,
  sy,
  sw,
  sh,
  px,
  py,
  artBase,
  printZoneWidthFraction = null,
  scale,
  overlayOpacity,
  overlayMixBlendMode,
  overlayFilter,
  overlayImgClassName = "w-full h-full object-contain drop-shadow-md pointer-events-none select-none",
  overlayWarpTransform,
  overlayMaskStyle,
  overlayArtUrl,
  onPointerDownOverlay,
  maxHeightClass,
  emptyOverlay,
  pixelFaithful8394 = false,
  composite8394Kind = "blended",
  renderTarget8394 = "flat_back",
  blendMode8394 = "multiply",
  blendOpacity8394 = 1,
  designOpacityMultiplier8394 = 1,
  canvasFilter8394,
  warpEnabled8394 = false,
  maskEnabled8394 = false,
  on8394ParityTelemetry,
  blankMaskUrl,
  blankMaskOverlayMode = "off",
  blankMaskOverlayOpacity = 0.35,
  blankMaskOverlayTint = "magenta",
}: GarmentPreviewCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last8394TelemetryRef = useRef<Preview8394ParityTelemetry | null>(null);
  const [naturalComposeError, setNaturalComposeError] = useState<string | null>(null);
  const showArt = Boolean(overlayArtUrl);
  const useNatural8394Canvas = Boolean(pixelFaithful8394 && showArt);
  const overlayTransform =
    overlayWarpTransform && overlayWarpTransform.trim() !== ""
      ? `translate(-50%, -50%) ${overlayWarpTransform}`
      : "translate(-50%, -50%)";

  const logGarment8394CoordAudit = useCallback(() => {
    const coordDebugOn =
      process.env.NEXT_PUBLIC_DEBUG_8394_COORD_SPACE === "1" ||
      (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_COORD_SPACE") === "1");
    if (!coordDebugOn) return;
    const el =
      (wrapRef.current?.querySelector("canvas[data-natural-8394-canvas]") as HTMLCanvasElement | null) ||
      (wrapRef.current?.querySelector("img[alt^='Garment']") as HTMLImageElement | null);
    if (!el) return;
    const nw = "naturalWidth" in el && el.naturalWidth ? el.naturalWidth : el.width;
    const nh = "naturalHeight" in el && el.naturalHeight ? el.naturalHeight : el.height;
    if (!nw || !nh) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const payload = {
      kind: "preview",
      coordinateBasis: useNatural8394Canvas ? "natural_pixel_canvas_scaled" : "display_percent_overlay",
      baseGarmentNaturalPx: { w: nw, h: nh },
      baseGarmentDisplayPx: { w: cw, h: ch },
      displayScale: { x: cw / nw, y: ch / nh },
      compareToOfficial:
        useNatural8394Canvas
          ? "Composition uses computePlacement8394Layout at natural garment WxH; canvas element is scaled by CSS only."
          : "CSS % overlay — placement math is display-box relative (differs from official when scaled).",
    };
    console.log("[GARMENT8394_COORD_AUDIT]", JSON.stringify(payload));
  }, [useNatural8394Canvas]);

  useEffect(() => {
    if (!useNatural8394Canvas || !on8394ParityTelemetry) return;
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current;
      const t = last8394TelemetryRef.current;
      if (!c?.width || !t) return;
      const next = mergeDisplayScaleIntoTelemetry(t, c);
      last8394TelemetryRef.current = next;
      on8394ParityTelemetry(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [useNatural8394Canvas, on8394ParityTelemetry, garmentUrl, overlayArtUrl]);

  useEffect(() => {
    if (!useNatural8394Canvas) {
      last8394TelemetryRef.current = null;
      on8394ParityTelemetry?.(null);
      return;
    }
    let cancelled = false;
    setNaturalComposeError(null);
    (async () => {
      try {
        let crop = await getArtworkAlphaCropRectFromImageUrl(overlayArtUrl);
        if (!crop) {
          const d = await loadImageElement(overlayArtUrl);
          crop = { x: 0, y: 0, w: d.naturalWidth, h: d.naturalHeight };
        }
        const { canvas, telemetry } = await compose8394NaturalPixelPreview({
          garmentUrl,
          designUrl: overlayArtUrl,
          designCrop: crop,
          defaultX: px,
          defaultY: py,
          defaultScale: scale,
          artboardBase: artBase,
          compositeKind: composite8394Kind,
          blendMode: blendMode8394,
          blendOpacity: blendOpacity8394,
          designOpacityMultiplier: designOpacityMultiplier8394,
          canvasFilter: canvasFilter8394 ?? "none",
          warpEnabled: warpEnabled8394,
          maskEnabled: maskEnabled8394,
          renderTarget: renderTarget8394,
        });
        if (cancelled) return;
        const dest = canvasRef.current;
        if (!dest) return;
        dest.width = canvas.width;
        dest.height = canvas.height;
        const ctx = dest.getContext("2d");
        if (!ctx) throw new Error("Canvas unsupported");
        ctx.drawImage(canvas, 0, 0);
        if (imgRef && typeof imgRef === "object" && "current" in imgRef) {
          (imgRef as React.MutableRefObject<HTMLCanvasElement | HTMLImageElement | null>).current = dest;
        }
        const merged = mergeDisplayScaleIntoTelemetry(telemetry, dest);
        last8394TelemetryRef.current = merged;
        on8394ParityTelemetry?.(merged);
        logGarment8394CoordAudit();
      } catch (e) {
        if (!cancelled) {
          setNaturalComposeError(e instanceof Error ? e.message : "Compose failed");
          on8394ParityTelemetry?.(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    useNatural8394Canvas,
    garmentUrl,
    overlayArtUrl,
    px,
    py,
    scale,
    artBase,
    composite8394Kind,
    blendMode8394,
    blendOpacity8394,
    designOpacityMultiplier8394,
    canvasFilter8394,
    warpEnabled8394,
    maskEnabled8394,
    renderTarget8394,
    imgRef,
    on8394ParityTelemetry,
    logGarment8394CoordAudit,
  ]);

  useEffect(() => {
    const coordDebugOn =
      process.env.NEXT_PUBLIC_DEBUG_8394_COORD_SPACE === "1" ||
      (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_COORD_SPACE") === "1");
    if (!coordDebugOn || typeof ResizeObserver === "undefined") return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => logGarment8394CoordAudit());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [garmentUrl, logGarment8394CoordAudit, useNatural8394Canvas]);

  return (
    <div
      ref={wrapRef}
      data-garment-preview
      data-pixel-faithful-8394={useNatural8394Canvas ? "true" : undefined}
      className={`relative inline-block w-full border border-gray-200 rounded-xl bg-neutral-100 shadow-inner ${
        useNatural8394Canvas ? "overflow-hidden" : "overflow-hidden"
      }`}
    >
      {useNatural8394Canvas ? (
        <>
          <canvas
            ref={canvasRef}
            data-natural-8394-canvas
            width={1}
            height={1}
            className={`block ${maxHeightClass} w-auto max-w-full mx-auto select-none touch-none cursor-grab active:cursor-grabbing`}
            onPointerDown={onPointerDownOverlay}
            aria-label={`Garment ${side} preview`}
          />
          {naturalComposeError ? (
            <p className="text-xs text-red-700 px-2 py-1">{naturalComposeError}</p>
          ) : null}
        </>
      ) : (
        <img
          ref={imgRef as LegacyRef<HTMLImageElement>}
          src={garmentUrl}
          alt={`Garment ${side}`}
          className={`block ${maxHeightClass} w-auto max-w-full mx-auto select-none`}
          draggable={false}
          onLoad={logGarment8394CoordAudit}
        />
      )}
      <div className="absolute inset-0 pointer-events-none">
        {showSafeArea && (
          <div
            className={`absolute border-2 border-dashed border-amber-500/90 bg-amber-500/5 pointer-events-none ${
              showClipHint ? "ring-2 ring-red-400/50 ring-inset" : ""
            }`}
            style={{
              left: `${sx * 100}%`,
              top: `${sy * 100}%`,
              width: `${sw * 100}%`,
              aspectRatio: `${DESIGN_ARTBOARD_WIDTH_PX} / ${DESIGN_ARTBOARD_HEIGHT_PX}`,
              height: "auto",
              boxSizing: "border-box",
            }}
          >
            <span className="absolute top-1 left-1 text-[9px] font-bold uppercase tracking-wide text-amber-950/90 bg-white/85 px-1.5 py-0.5 rounded shadow-sm">
              Safe print area
            </span>
          </div>
        )}
        {emptyOverlay}
        {blankMaskUrl && blankMaskOverlayMode !== "off" ? (() => {
          /**
           * CSS `mask-image: url(...)` is subject to CORS even when an `<img>` from the same
           * source loads fine. Firebase Storage omits ACAO by default, so route the mask
           * through the same-origin `/api/storage-proxy` (helper handles the allowlist).
           */
          const proxiedMaskUrl = proxiedImageUrlForCanvas(blankMaskUrl);
          return (
          <div
            aria-hidden
            data-blank-mask-overlay
            data-blank-mask-mode={blankMaskOverlayMode}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            {/* Invisible <img> reuses the same w-auto/max-w-full/maxHeightClass rules
                as the garment img, so the tinted div sizes match the garment exactly
                even when natural aspect ratios diverge between mask and garment PNGs. */}
            <div className="relative">
              <img
                src={proxiedMaskUrl}
                alt=""
                aria-hidden
                draggable={false}
                className={`block ${maxHeightClass} w-auto max-w-full select-none`}
                style={{ visibility: "hidden" }}
              />
              {blankMaskOverlayMode === "filled" ? (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: BLANK_MASK_TINT_TO_HEX[blankMaskOverlayTint],
                    WebkitMaskImage: `url(${proxiedMaskUrl})`,
                    maskImage: `url(${proxiedMaskUrl})`,
                    WebkitMaskSize: "100% 100%",
                    maskSize: "100% 100%",
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    WebkitMaskPosition: "center",
                    maskPosition: "center",
                    opacity: blankMaskOverlayOpacity,
                    mixBlendMode: "screen",
                  }}
                />
              ) : (
                /* Outline: two stacked mask layers (full + slightly inset) with mask-composite
                   exclude/xor leaves only a thin ring around the shape edge. */
                <div
                  className="absolute inset-0"
                  style={
                    {
                      backgroundColor: BLANK_MASK_TINT_TO_HEX[blankMaskOverlayTint],
                      WebkitMaskImage: `url(${proxiedMaskUrl}), url(${proxiedMaskUrl})`,
                      maskImage: `url(${proxiedMaskUrl}), url(${proxiedMaskUrl})`,
                      WebkitMaskSize: "100% 100%, calc(100% - 6px) calc(100% - 6px)",
                      maskSize: "100% 100%, calc(100% - 6px) calc(100% - 6px)",
                      WebkitMaskRepeat: "no-repeat, no-repeat",
                      maskRepeat: "no-repeat, no-repeat",
                      WebkitMaskPosition: "center, center",
                      maskPosition: "center, center",
                      WebkitMaskComposite: "xor",
                      maskComposite: "exclude",
                      opacity: 0.9,
                    } as CSSProperties
                  }
                />
              )}
            </div>
          </div>
          );
        })() : null}
        {!useNatural8394Canvas && showArt ? (
          <div
            className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing will-change-transform [transform-style:preserve-3d]"
            style={{
              left: `${px * 100}%`,
              top: `${py * 100}%`,
              width: `${(printZoneWidthFraction ?? artBase) * scale * 100}%`,
              aspectRatio: `${DESIGN_ARTBOARD_WIDTH_PX} / ${DESIGN_ARTBOARD_HEIGHT_PX}`,
              height: "auto",
              transform: overlayTransform,
              opacity: overlayOpacity,
              mixBlendMode: overlayMixBlendMode,
              filter: overlayFilter,
            }}
            onPointerDown={onPointerDownOverlay}
          >
            <div className="w-full h-full overflow-hidden rounded-[1px]" style={overlayMaskStyle}>
              <img
                key={overlayArtUrl}
                src={overlayArtUrl}
                alt="Preview design"
                className={overlayImgClassName}
                draggable={false}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ProfileRow = RPPlacement & {
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  safeArea: { x: number; y: number; w: number; h: number };
  artboardBase: number;
  view: "front" | "back";
  profileStatus: NonNullable<RPPlacement["profileStatus"]>;
  notes: string;
  artboardNotes: string;
  allowedDesignAssetMode: NonNullable<RPPlacement["allowedDesignAssetMode"]>;
};

type RenderProfileBaselineMeta = {
  renderProfileStatus: "draft" | "approved";
  renderProfileNotes: string;
  supportedFront: boolean;
  supportedBack: boolean;
  preferredFlatLook8394: "" | "flat_clean" | "flat_blended";
};

function normalizeProfileRows(list: RPPlacement[] | undefined | null, styleCode?: string | null): ProfileRow[] {
  const sc = String(styleCode ?? "").trim();
  return (list ?? []).map((p) => {
    const view = (p.view === "front" || p.view === "back" ? p.view : null) ?? placementSide(p.placementId);
    const base = {
      ...p,
      defaultX: p.defaultX ?? 0.5,
      defaultY: p.defaultY ?? 0.5,
      defaultScale: p.defaultScale ?? 0.6,
      safeArea: p.safeArea ?? { ...DEFAULT_GARMENT_SAFE_AREA },
      artboardBase: p.artboardBase ?? 0.5,
      view,
      renderZoneDefaults: p.renderZoneDefaults ?? null,
      maskConfig: p.maskConfig ?? { mode: "none", notes: null },
      profileStatus: p.profileStatus === "approved" ? "approved" : "draft",
      notes: p.notes ?? "",
      artboardNotes: p.artboardNotes ?? "",
      allowedDesignAssetMode: p.allowedDesignAssetMode ?? "light_dark",
    } as ProfileRow;

    if (sc === "8394" && view === "back") {
      const inferred =
        p.simpleRenderControls8394 ??
        inferSimpleControls8394FromLegacy(p.defaultScale ?? 0.58, p.renderZoneDefaults ?? null);
      const normalized = normalizeSimpleControls8394(inferred);
      const derived = derivePlacementEngineFields8394(normalized);
      /** Persisted placement scale (continuous slider / fine tuning). Must survive refetch — do not replace with preset-only derived scale. */
      const persistedScale =
        p.defaultScale != null && Number.isFinite(Number(p.defaultScale)) ? Number(p.defaultScale) : null;
      return {
        ...base,
        simpleRenderControls8394: normalized,
        defaultScale: persistedScale ?? derived.defaultScale,
        renderZoneDefaults: derived.renderZoneDefaults,
      };
    }

    return base;
  });
}

function inferSupportedViews(rows: ProfileRow[]): ("front" | "back")[] {
  const s = new Set<"front" | "back">();
  rows.forEach((r) => s.add(r.view));
  return s.size ? Array.from(s) : ["front", "back"];
}

function effectiveZoneBlend(
  blank: RPBlank,
  side: "front" | "back",
  row: ProfileRow
): { blendMode: string; blendOpacity: number } {
  const zd = row.renderZoneDefaults;
  const rd = blank.renderDefaults;
  const sideDefaults = side === "back" ? rd?.back : rd?.front;
  const modeRaw =
    zd?.blendMode ?? sideDefaults?.blendMode ?? rd?.blendMode ?? (side === "back" ? "multiply" : "soft-light");
  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opRaw = zd?.blendOpacity ?? sideDefaults?.blendOpacity ?? rd?.blendOpacity ?? 1;
  const opacity = typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;
  return { blendMode: mode, blendOpacity: opacity };
}

function cssMixBlendMode(mode: string): string {
  const m = String(mode || "multiply").toLowerCase();
  if (m === "normal") return "normal";
  return m;
}

/** Preview PNG from library: explicit light/dark/white choice, then fallbacks. */
function pickDesignPreviewPng(
  design: DesignDoc | undefined,
  mode: "light" | "dark" | "white",
  variant: ReturnType<typeof getVariantById>
): string | null {
  if (!design) return null;
  const a = resolveDesignAssets(design);
  if (mode === "light") {
    const u = a.lightPng || a.darkPng || a.whitePng;
    if (u) return u;
  } else if (mode === "dark") {
    const u = a.darkPng || a.lightPng || a.whitePng;
    if (u) return u;
  } else {
    const u = a.whitePng || a.darkPng || a.lightPng;
    if (u) return u;
  }
  const fam = variant ? getEffectiveColorFamily(variant.colorFamily, variant.colorName) : null;
  return pickDesignSvgUrlForGarment(design, fam, "back", variant?.preferredArtworkTone ?? undefined);
}

/**
 * Render profile preview default: optional variant override, else match garment family
 * (light fabric → light artwork preview, dark fabric → dark artwork preview).
 */
function defaultPreviewArtworkModeForVariant(v: ReturnType<typeof getVariantById>): "light" | "dark" | "white" {
  if (!v) return "dark";
  const pref = v.preferredArtworkTone;
  if (pref === "light" || pref === "dark" || pref === "white") return pref;
  const fam = getEffectiveColorFamily(v.colorFamily, v.colorName);
  return fam === "light" ? "light" : "dark";
}

function toFirestorePlacement(p: ProfileRow, styleCode?: string | null): RPPlacement {
  const sc = String(styleCode ?? "").trim();
  const is8394Back = sc === "8394" && p.view === "back";

  const base: RPPlacement = {
    placementId: p.placementId,
    label: p.label,
    view: p.view,
    defaultX: p.defaultX,
    defaultY: p.defaultY,
    defaultScale: p.defaultScale,
    safeArea: p.safeArea,
    artboardBase: p.artboardBase,
    artboardNotes: p.artboardNotes.trim() || null,
    allowedDesignAssetMode: p.allowedDesignAssetMode,
    renderZoneDefaults:
      p.renderZoneDefaults &&
      (p.renderZoneDefaults.blendMode != null || p.renderZoneDefaults.blendOpacity != null)
        ? {
            blendMode: p.renderZoneDefaults.blendMode ?? null,
            blendOpacity: p.renderZoneDefaults.blendOpacity ?? null,
          }
        : null,
    maskConfig:
      p.maskConfig && (p.maskConfig.mode || p.maskConfig.notes)
        ? {
            mode: p.maskConfig.mode ?? "none",
            notes: p.maskConfig.notes ?? null,
          }
        : { mode: "none", notes: null },
    profileStatus: p.profileStatus,
    notes: p.notes.trim() || null,
  };

  if (is8394Back && p.simpleRenderControls8394) {
    const n = normalizeSimpleControls8394(p.simpleRenderControls8394);
    const d = derivePlacementEngineFields8394(n);
    const storedScale =
      p.defaultScale != null && Number.isFinite(p.defaultScale) ? p.defaultScale : d.defaultScale;
    return {
      ...base,
      simpleRenderControls8394: n,
      /** Prefer row scale so continuous slider / fine tuning persists (sizePreset stays approximate). */
      defaultScale: storedScale,
      renderZoneDefaults: {
        blendMode: d.renderZoneDefaults.blendMode,
        blendOpacity: d.renderZoneDefaults.blendOpacity,
      },
    };
  }

  return {
    ...base,
    simpleRenderControls8394: is8394Back ? null : p.simpleRenderControls8394 ?? null,
  };
}

/** Same shell as GarmentPreviewCanvas: max-h ≈ min(72vh,720px), max-w-full, off-DOM for audit. */
async function measure8394GarmentDisplayForUrl(
  url: string,
  shellWidthPx: number
): Promise<{ natural: { w: number; h: number }; display: { w: number; h: number } }> {
  const maxH = typeof window !== "undefined" ? Math.min(window.innerHeight * 0.72, 720) : 720;
  const shell = document.createElement("div");
  shell.style.cssText = `position:fixed;left:-9999px;top:0;width:${shellWidthPx}px;pointer-events:none;visibility:hidden`;
  const img = document.createElement("img");
  img.crossOrigin = "anonymous";
  img.style.display = "block";
  img.style.marginLeft = "auto";
  img.style.marginRight = "auto";
  img.style.width = "auto";
  img.style.maxWidth = "100%";
  img.style.maxHeight = `${maxH}px`;
  shell.appendChild(img);
  document.body.appendChild(shell);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Garment image failed to load for audit"));
      img.src = proxiedImageUrlForCanvas(url);
    });
    return {
      natural: { w: img.naturalWidth, h: img.naturalHeight },
      display: { w: img.clientWidth, h: img.clientHeight },
    };
  } finally {
    shell.remove();
  }
}

async function resolveDesignBoundsFor8394Audit(artUrl: string): Promise<{
  w: number;
  h: number;
  source: "alpha_scan_canvas" | "full_image_natural";
}> {
  const cropped = await measureArtworkAlphaBoundsFromImageUrl(artUrl);
  if (cropped) return { w: cropped.w, h: cropped.h, source: "alpha_scan_canvas" };
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Design image failed to load for audit"));
    img.src = proxiedImageUrlForCanvas(artUrl);
  });
  return { w: img.naturalWidth, h: img.naturalHeight, source: "full_image_natural" };
}

export function BlankRenderProfileEditor({
  blank,
  updateBlank,
  refetchBlank,
  showToast,
  masks,
  onManageMasks,
  onGenerateAiMask,
  aiMaskGeneratingForView,
}: {
  blank: RPBlank;
  updateBlank: (i: UpdateBlankInput) => Promise<unknown>;
  refetchBlank: () => void;
  showToast: (m: string, t: "success" | "error") => void;
  /** `rp_blank_masks/{blankId}_{view}` docs supplied by the parent page (already fetched there). */
  masks?: { front: RPBlankMask | null; back: RPBlankMask | null };
  /** Switch the parent tab to the Rendering tab and pre-select `view` so users can upload / replace. */
  onManageMasks?: (view: "front" | "back") => void;
  /**
   * Kick off an AI mask generation for `view` from inside the Render profile tab.
   * Parent shows the preview / Save / Refresh UI on the Rendering tab (and switches tabs to it),
   * so designers can keep tuning placement here and only briefly hop over to confirm + save.
   */
  onGenerateAiMask?: (
    view: "front" | "back",
    opts?: {
      /** "flat_<view>" (default) for shared masks; "model_<view>" for per-pose masks tied to a specific variant. */
      renderTarget?: "flat_front" | "flat_back" | "model_front" | "model_back";
      /** Required when renderTarget is model_*; identifies which variant's model photo to mask. */
      variantId?: string | null;
    }
  ) => void;
  /** True while the AI mask callable is in flight for the current view — disables the button. */
  aiMaskGeneratingForView?: "front" | "back" | null;
}) {
  const { isAdmin } = useAuth();
  const { designs, isLoading: designsLoading } = useDesigns({ hasPng: true });
  const [rows, setRows] = useState<ProfileRow[]>(() => normalizeProfileRows(blank.placements, blank.styleCode));
  const [baselineRows, setBaselineRows] = useState<ProfileRow[]>(() =>
    normalizeProfileRows(blank.placements, blank.styleCode)
  );
  const [baselineMeta, setBaselineMeta] = useState<RenderProfileBaselineMeta>(() => ({
    renderProfileStatus: (blank.renderProfileStatus ?? "draft") as "draft" | "approved",
    renderProfileNotes: blank.renderProfileNotes ?? "",
    supportedFront: true,
    supportedBack: true,
    preferredFlatLook8394:
      blank.preferredFlatLook8394 === "flat_blended" || blank.preferredFlatLook8394 === "flat_clean"
        ? blank.preferredFlatLook8394
        : "",
  }));

  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Master blank: color id, or "" = edit blank-level baseline for all colors. */
  const [variantId, setVariantId] = useState<string>(() =>
    isMasterBlank(blank) ? firstActiveVariant(blank)?.variantId ?? "" : ""
  );
  /** Library design id only — never persisted on the blank. */
  const [previewDesignId, setPreviewDesignId] = useState<string>("");
  /** Operator-chosen preview asset (light / dark / white PNG). */
  const [previewArtworkMode, setPreviewArtworkMode] = useState<"light" | "dark" | "white">(() =>
    defaultPreviewArtworkModeForVariant(
      getVariantById(blank, firstActiveVariant(blank)?.variantId ?? null)
    )
  );
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [showClipHint, setShowClipHint] = useState(false);
  /** clean = no blend on canvas; blended = current profile; compare = side-by-side */
  const [previewMode, setPreviewMode] = useState<"clean" | "blended" | "compare">("blended");
  const [previewLightbox, setPreviewLightbox] = useState(false);
  /**
   * Visualizes `rp_blank_masks/{blankId}_{view}` on top of the garment so designers
   * can see when the design overlay crosses the editable region. Local UI preference,
   * not persisted. Default `off` so the canvas isn't decorated until requested.
   */
  const [blankMaskOverlayMode, setBlankMaskOverlayMode] = useState<"off" | "outline" | "filled">("off");
  /**
   * Real Sharp-composite preview rendered by the `previewBlankRender` callable. Distinct
   * from the CSS approximation in the canvas — this is what the deterministic compositor
   * actually outputs, with the rp_blank_masks multiply applied. See RALLY_BLANK_PREVIEW_RENDER.md.
   */
  type RealPreviewResult = {
    previewUrl: string;
    width: number;
    height: number;
    bytes: number;
    stage: "A" | "B";
    stageA?: { previewUrl: string; width: number; height: number; bytes: number };
    stageB?: {
      previewUrl: string;
      falEndpoint: string;
      usedMask: boolean;
      params: {
        strength: number;
        num_inference_steps: number;
        guidance_scale: number;
        /** v5 telemetry — Stage B records the slider values it actually saw plus the
         *  derived pre-Kontext blur so the badge can prove the sliders reached AI. */
        fabric_feel?: number;
        print_strength?: number;
        pre_blur_sigma?: number;
      };
    } | null;
    maskApplied: boolean;
    maskMean: number | null;
    placementUsed: { x: number; y: number; scale: number; blendMode: string; blendOpacity: number };
    variantId: string | null;
    artworkMode?: "light" | "dark" | "white";
  };
  const [realPreview, setRealPreview] = useState<RealPreviewResult | null>(null);
  /** Loading state — "A" = Stage A only (fast), "B" = Stage A + AI realism (slow, $). */
  const [realPreviewLoading, setRealPreviewLoading] = useState<"A" | "B" | null>(null);
  const [realPreviewError, setRealPreviewError] = useState<string | null>(null);
  /** Active onSnapshot unsubscribe for the realism job — kept in a ref so re-renders don't leak listeners. */
  const realPreviewJobUnsubRef = useRef<(() => void) | null>(null);
  const [lastExplicitRenderStyle, setLastExplicitRenderStyle] = useState<RenderStylePresetId>("soft_print");
  const [explicitCustomStyle, setExplicitCustomStyle] = useState(false);
  const [renderProfileStatus, setRenderProfileStatus] = useState<"draft" | "approved">(
    blank.renderProfileStatus === "approved" ? "approved" : "draft"
  );
  const [renderProfileNotes, setRenderProfileNotes] = useState(blank.renderProfileNotes ?? "");
  const [supportedFront, setSupportedFront] = useState(true);
  const [supportedBack, setSupportedBack] = useState(true);
  const [preferredFlatLook8394, setPreferredFlatLook8394] = useState<"" | "flat_clean" | "flat_blended">(
    blank.preferredFlatLook8394 === "flat_blended" || blank.preferredFlatLook8394 === "flat_clean"
      ? blank.preferredFlatLook8394
      : ""
  );
  /**
   * Autosave indicator state for the blank-wide fields. The main "Save render profile"
   * button is per-color and per-target; these fields (status / supported sides / notes)
   * belong to the whole blank and now autosave directly to Firestore on change with a
   * short debounce, with a transient "Saved" indicator next to the section header.
   * Decouples scopes so operators don't have to bundle blank-wide changes into a
   * per-color save click.
   */
  const [blankAutosaveState, setBlankAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const blankAutosaveErrorRef = useRef<string | null>(null);
  const blankFieldsHydratedRef = useRef(false);

  const [selectedRenderTarget, setSelectedRenderTarget] = useState<RpRenderTarget>("flat_front");
  const [targetSettingsMap, setTargetSettingsMap] = useState<Record<RpRenderTarget, RpRenderTargetSettings>>(() =>
    buildRenderTargetSettingsMap(
      blank.renderProfile?.renderTargets,
      normalizeProfileRows(blank.placements, blank.styleCode),
      blank.styleCode
    )
  );
  const [baselineTargetMap, setBaselineTargetMap] = useState<Record<RpRenderTarget, RpRenderTargetSettings>>(() =>
    buildRenderTargetSettingsMap(
      blank.renderProfile?.renderTargets,
      normalizeProfileRows(blank.placements, blank.styleCode),
      blank.styleCode
    )
  );

  const imgRef = useRef<HTMLImageElement | HTMLCanvasElement>(null);
  const preview8394ColumnRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  /** Default on: natural-pixel canvas composite (official placement basis). */
  const [pixelAccurate8394Preview, setPixelAccurate8394Preview] = useState(true);
  const [preview8394Parity, setPreview8394Parity] = useState<Preview8394ParityTelemetry | null>(null);
  /** Paste one line from Cloud Functions: `[OFFICIAL8394_STRICT_PARITY] { ... }` (set OFFICIAL8394_STRICT_PARITY=1). */
  const [official8394StrictPaste, setOfficial8394StrictPaste] = useState("");

  const is8394 = useMemo(() => String(blank.styleCode || "").trim() === "8394", [blank.styleCode]);

  useEffect(() => {
    const next = normalizeProfileRows(blank.placements, blank.styleCode);
    setRows(next);
    setBaselineRows(JSON.parse(JSON.stringify(next)) as ProfileRow[]);
    setSelectedIndex((i) => {
      const maxI = Math.max(0, next.length - 1);
      if (String(blank.styleCode || "").trim() === "8394") {
        const backI = next.findIndex((r) => r.placementId === "back_center");
        if (backI >= 0) return backI;
      }
      return Math.min(i, maxI);
    });
    setRenderProfileStatus(blank.renderProfileStatus === "approved" ? "approved" : "draft");
    setRenderProfileNotes(blank.renderProfileNotes ?? "");
    const inferred = inferSupportedViews(next);
    const sr = blank.supportedRenderViews;
    if (sr && sr.length) {
      setSupportedFront(sr.includes("front"));
      setSupportedBack(sr.includes("back"));
    } else {
      setSupportedFront(inferred.includes("front"));
      setSupportedBack(inferred.includes("back"));
    }
    setPreferredFlatLook8394(
      blank.preferredFlatLook8394 === "flat_blended" || blank.preferredFlatLook8394 === "flat_clean"
        ? blank.preferredFlatLook8394
        : ""
    );
    setBaselineMeta({
      renderProfileStatus: blank.renderProfileStatus === "approved" ? "approved" : "draft",
      renderProfileNotes: blank.renderProfileNotes ?? "",
      supportedFront: sr && sr.length ? sr.includes("front") : inferred.includes("front"),
      supportedBack: sr && sr.length ? sr.includes("back") : inferred.includes("back"),
      preferredFlatLook8394:
        blank.preferredFlatLook8394 === "flat_blended" || blank.preferredFlatLook8394 === "flat_clean"
          ? blank.preferredFlatLook8394
          : "",
    });
  }, [
    blank.blankId,
    blank.placements,
    blank.renderProfileStatus,
    blank.renderProfileNotes,
    blank.supportedRenderViews,
    blank.styleCode,
    blank.preferredFlatLook8394,
  ]);

  /**
   * Autosave blank-wide fields (status / supported sides / notes / 8394 preferred
   * flat look) directly to Firestore on change with a 600ms debounce. Decoupled
   * from the main per-color / per-target "Save render profile" button so operators
   * can flip Approved or edit blank notes without triggering a per-color save.
   *
   * Guarded by an equality check vs the loaded `blank.*` props so the post-save
   * Firestore snapshot re-hydration doesn't trigger a redundant write loop.
   * (Sequence: write → snapshot fires → hydration effect updates state to the
   *  same values → this effect re-runs → no diff → skip write.)
   */
  useEffect(() => {
    if (!firebaseDb) return;
    const supportedRenderViews = [
      ...(supportedFront ? ["front" as const] : []),
      ...(supportedBack ? ["back" as const] : []),
    ];
    const trimmedNotes = renderProfileNotes.trim();
    const loadedStatus = blank.renderProfileStatus === "approved" ? "approved" : "draft";
    const loadedNotes = (blank.renderProfileNotes ?? "").trim();
    const loadedSides = (blank.supportedRenderViews ?? []).slice().sort().join(",");
    const loadedFlat = (blank.preferredFlatLook8394 ?? "") || "";
    const nextSides = supportedRenderViews.slice().sort().join(",");
    const nextFlat = (preferredFlatLook8394 || "");
    const noDiff =
      renderProfileStatus === loadedStatus &&
      trimmedNotes === loadedNotes &&
      nextSides === loadedSides &&
      nextFlat === loadedFlat;
    if (noDiff) return;
    const timer = setTimeout(async () => {
      try {
        setBlankAutosaveState("saving");
        const payload: Record<string, unknown> = {
          renderProfileStatus,
          renderProfileNotes: trimmedNotes.length > 0 ? trimmedNotes : null,
          supportedRenderViews: supportedRenderViews.length ? supportedRenderViews : null,
        };
        if (is8394) {
          payload.preferredFlatLook8394 = preferredFlatLook8394 === "" ? null : preferredFlatLook8394;
        }
        await firestoreUpdateDoc(firestoreDoc(firebaseDb!, "rp_blanks", blank.blankId), payload);
        setBlankAutosaveState("saved");
        /** Fade the "Saved" indicator back to idle after a beat so it doesn't stick. */
        setTimeout(() => setBlankAutosaveState("idle"), 2000);
      } catch (err) {
        console.error("[autosave blank-wide] failed:", err);
        blankAutosaveErrorRef.current = err instanceof Error ? err.message : String(err);
        setBlankAutosaveState("error");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [
    renderProfileStatus,
    renderProfileNotes,
    supportedFront,
    supportedBack,
    preferredFlatLook8394,
    is8394,
    blank.blankId,
    blank.renderProfileStatus,
    blank.renderProfileNotes,
    blank.supportedRenderViews,
    blank.preferredFlatLook8394,
  ]);

  useEffect(() => {
    const normalizedRows = normalizeProfileRows(blank.placements, blank.styleCode);
    const builtBlankOnly = buildRenderTargetSettingsMap(
      blank.renderProfile?.renderTargets,
      normalizedRows,
      blank.styleCode
    );
    setBaselineTargetMap(
      Object.fromEntries(
        RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(builtBlankOnly[k]!)])
      ) as Record<RpRenderTarget, RpRenderTargetSettings>
    );
    const v = variantId ? getVariantById(blank, variantId) : null;
    const built =
      isMasterBlank(blank) && variantId
        ? buildEffectiveRenderTargetSettingsMap(blank, v)
        : builtBlankOnly;
    setTargetSettingsMap(built);

    if (is8394 && isMasterBlank(blank) && variantId && v) {
      const { qa } = resolveEffectiveRenderTargetSettings(null, blank, v, selectedRenderTarget);
      console.log("[8394 CELL READ]", {
        blankId: blank.blankId,
        variantIdUsed: variantId,
        colorName: v.colorName,
        target: selectedRenderTarget,
        layerUsed: qa.primaryTuningLayer,
        colorMatrixCellExisted: qa.colorMatrixCellExisted,
        variantLegacyOverrideMerged: qa.variantTargetOverrideExisted,
      });
    } else if (is8394 && isMasterBlank(blank) && !variantId) {
      const { qa } = resolveEffectiveRenderTargetSettings(null, blank, null, selectedRenderTarget);
      console.log("[8394 CELL READ]", {
        blankId: blank.blankId,
        scope: "blank_baseline",
        variantIdUsed: "(none)",
        target: selectedRenderTarget,
        layerUsed: qa.primaryTuningLayer,
        colorMatrixCellExisted: qa.colorMatrixCellExisted,
        variantLegacyOverrideMerged: qa.variantTargetOverrideExisted,
      });
    }
  }, [
    blank.blankId,
    blank.renderProfile,
    blank.placements,
    blank.styleCode,
    blank.variants,
    blank.schemaVersion,
    variantId,
    selectedRenderTarget,
    is8394,
  ]);

  const selectedRowView = rows[selectedIndex]?.view;
  useEffect(() => {
    if (selectedRowView === "front" || selectedRowView === "back") {
      setSelectedRenderTarget(defaultRenderTargetForZoneView(selectedRowView));
    }
  }, [selectedIndex, selectedRowView]);

  const variants = useMemo(
    () => getBlankVariants(blank).filter((v) => v.isActive !== false),
    [blank]
  );

  /** Firestore read path (no draft overlay) — for matrix baseline warning + docs. */
  const persistedCellResolution = useMemo(() => {
    if (!isMasterBlank(blank) || !variantId) return null;
    const v = getVariantById(blank, variantId);
    if (!v) return null;
    return resolveEffectiveRenderTargetSettings(null, blank, v, selectedRenderTarget);
  }, [blank, variantId, selectedRenderTarget]);

  /** Firestore read path only — same merge as [8394 CELL READ]. Dev / admin UI for matrix validation. */
  const matrixCellInspector8394 = useMemo(() => {
    if (!is8394 || !isMasterBlank(blank)) return null;
    if (!isAdmin && process.env.NODE_ENV !== "development") return null;
    if (variantId) {
      if (!persistedCellResolution) return null;
      const qa = persistedCellResolution.qa;
      return {
        variantId,
        target: qa.target,
        layerUsed: qa.primaryTuningLayer,
        colorMatrixCellExisted: qa.colorMatrixCellExisted,
        variantLegacyOverrideMerged: qa.variantTargetOverrideExisted,
      };
    }
    const { qa } = resolveEffectiveRenderTargetSettings(null, blank, null, selectedRenderTarget);
    return {
      variantId: null as string | null,
      target: qa.target,
      layerUsed: qa.primaryTuningLayer,
      colorMatrixCellExisted: qa.colorMatrixCellExisted,
      variantLegacyOverrideMerged: qa.variantTargetOverrideExisted,
    };
  }, [is8394, blank, isAdmin, variantId, persistedCellResolution, selectedRenderTarget]);

  /** Master blank + a color selected: Save persists placement/blend deltas on that variant only (not blank-wide defaults). */
  const perColorSaveScope = isMasterBlank(blank) && Boolean(variantId);

  const saveScopeLabel = useMemo(() => {
    if (!is8394 || !isMasterBlank(blank)) return null;
    const vt = variantId ? getVariantById(blank, variantId) : null;
    const name = vt?.colorName ?? "Blank baseline";
    return `Saving: ${name} × ${RENDER_TARGET_LABELS[selectedRenderTarget]}`;
  }, [is8394, blank, variantId, selectedRenderTarget]);

  const didAutoPickPreviewDesign = useRef(false);
  /** Once: auto-load most recent design from library (`designs` / DesignAssets). */
  useEffect(() => {
    if (previewDesignId) didAutoPickPreviewDesign.current = true;
    if (didAutoPickPreviewDesign.current || designs.length === 0) return;
    didAutoPickPreviewDesign.current = true;
    setPreviewDesignId(designs[0]!.id);
  }, [designs, previewDesignId]);

  useEffect(() => {
    setExplicitCustomStyle(false);
  }, [selectedIndex]);

  const selected = rows[selectedIndex];
  const previewVariant = useMemo(() => {
    if (!isMasterBlank(blank)) return firstActiveVariant(blank) ?? null;
    if (variantId) return getVariantById(blank, variantId) ?? firstActiveVariant(blank) ?? null;
    return firstActiveVariant(blank) ?? null;
  }, [blank, variantId]);

  /** When garment color or artwork override changes on the variant, resync preview tone (not on unrelated blank edits). */
  const variantPreviewArtKey = useMemo(() => {
    if (!previewVariant) return "";
    return [
      previewVariant.variantId,
      previewVariant.colorFamily ?? "",
      previewVariant.preferredArtworkTone ?? "",
      previewVariant.colorName ?? "",
    ].join("|");
  }, [previewVariant]);

  /** Only when the *logical* preview variant changes — not when `blank` refetches (new object identity). */
  useEffect(() => {
    if (!previewVariant) return;
    setPreviewArtworkMode(defaultPreviewArtworkModeForVariant(previewVariant));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewVariant identity churn after Save/refetch must not reset Light/Dark/White
  }, [variantPreviewArtKey]);

  /** When the selected library design changes, keep current tone if that asset exists; else variant default then any. */
  useEffect(() => {
    if (!previewDesignId) return;
    const d = designs.find((x) => x.id === previewDesignId) as DesignDoc | undefined;
    if (!d) return;
    const a = resolveDesignAssets(d);
    const has = (m: "light" | "dark" | "white") =>
      m === "light" ? !!a.lightPng : m === "dark" ? !!a.darkPng : !!a.whitePng;

    setPreviewArtworkMode((prev) => {
      if (has(prev)) return prev;
      const pref = defaultPreviewArtworkModeForVariant(previewVariant);
      if (has(pref)) return pref;
      if (a.darkPng) return "dark";
      if (a.lightPng) return "light";
      if (a.whitePng) return "white";
      return prev;
    });
  }, [previewDesignId, designs, previewVariant]);
  const previewGarmentUrl = previewVariant
    ? getRenderTargetPreviewUrl(blank, previewVariant, selectedRenderTarget)
    : null;
  const flatBackPreviewUrl = useMemo(
    () => (previewVariant ? getRenderTargetPreviewUrl(blank, previewVariant, "flat_back") : null),
    [blank, previewVariant]
  );
  const modelBackPreviewUrl = useMemo(
    () => (previewVariant ? getRenderTargetPreviewUrl(blank, previewVariant, "model_back") : null),
    [blank, previewVariant]
  );
  const previewSide = renderTargetToGarmentSide(selectedRenderTarget);
  /**
   * Printed-side permission (supportedRenderViews): when false, no design overlay on that side in this UI.
   * Front: still allows clean display previews (garment-only); generation emits clean front images regardless.
   */
  const previewSideAllowsPrinting =
    previewSide === "front" ? supportedFront : supportedBack;

  /** Mask doc for the side currently being previewed (used for overlay + status pill + select default). */
  const currentBlankMaskDoc: RPBlankMask | null =
    (previewSide === "front" ? masks?.front : masks?.back) ?? null;
  const currentBlankMaskUrl = currentBlankMaskDoc?.mask?.downloadUrl ?? null;
  /**
   * If the operator has not yet picked a clip strategy for this zone, default to
   * `blank_mask_doc` when an `rp_blank_masks/{blankId}_{view}` doc exists, otherwise
   * `none`. The compositor has been consuming `blank_mask_doc` for all real renders
   * for some time; the `(future)` label was stale.
   */
  const defaultMaskModeForCurrentView: "none" | "blank_mask_doc" = currentBlankMaskUrl
    ? "blank_mask_doc"
    : "none";
  const tuning: RpRenderTargetSettings | null = selected
    ? targetSettingsMap[selectedRenderTarget] ??
      getDefaultRenderTargetSettings(selectedRenderTarget, selected, blank.styleCode)
    : null;

  const blankWithDraftRenderTargets = useMemo(
    () =>
      ({
        ...blank,
        renderProfile: {
          ...blank.renderProfile,
          renderTargets: targetSettingsMap,
        },
      }) as RPBlank,
    [blank, targetSettingsMap]
  );

  const resolvedTargetForEngine = useMemo(() => {
    const variantColorEdit = isMasterBlank(blank) && Boolean(variantId);
    if (variantColorEdit) {
      const s = targetSettingsMap[selectedRenderTarget];
      if (s) {
        return {
          settings: cloneRenderTargetSettings(s),
          qa: {
            target: selectedRenderTarget,
            blankTuningExisted: true,
            variantTargetOverrideExisted: true,
            productPlacementApplied: false,
            primaryTuningLayer: "color_matrix" as RenderProfileTuningLayer,
            colorMatrixCellExisted: true,
          },
        };
      }
    }
    return resolveEffectiveRenderTargetSettings(
      null,
      blankWithDraftRenderTargets,
      previewVariant ?? undefined,
      selectedRenderTarget
    );
  }, [blank, variantId, targetSettingsMap, selectedRenderTarget, blankWithDraftRenderTargets, previewVariant]);

  const engineBlendResolved = useMemo(
    () =>
      resolveEngineBlendForRenderTarget(
        null,
        blankWithDraftRenderTargets,
        previewVariant ?? undefined,
        selectedRenderTarget,
        resolvedTargetForEngine.settings.blend
      ),
    [blankWithDraftRenderTargets, previewVariant, selectedRenderTarget, resolvedTargetForEngine.settings.blend]
  );

  const copyBackTargetTuning = useCallback(
    (from: "flat_back" | "model_back", to: "flat_back" | "model_back") => {
      setTargetSettingsMap((prev) => {
        const src = prev[from];
        if (!src) return prev;
        return { ...prev, [to]: cloneRenderTargetSettings(src) };
      });
      showToast(
        `Copied ${RENDER_TARGET_LABELS[from]} → ${RENDER_TARGET_LABELS[to]} (Save to persist)`,
        "success"
      );
    },
    [showToast]
  );

  const previewDesign = useMemo(
    () => (previewDesignId ? (designs.find((x) => x.id === previewDesignId) as DesignDoc | undefined) : undefined),
    [previewDesignId, designs]
  );

  const overlayArtUrl = useMemo(() => {
    if (!previewDesignId || !previewDesign) return "";
    const png = pickDesignPreviewPng(previewDesign, previewArtworkMode, previewVariant);
    return png || getDesignPreviewUrl(previewDesign) || "";
  }, [previewDesignId, previewDesign, previewArtworkMode, previewVariant]);

  const effectiveOverlayArtUrl = previewSideAllowsPrinting ? overlayArtUrl : "";

  const run8394CoordinateAudit = useCallback(async () => {
    if (String(blank.styleCode || "").trim() !== "8394") return;
    if (!previewVariant || !effectiveOverlayArtUrl) {
      showToast("Select a design with artwork for coordinate audit.", "error");
      return;
    }
    if (!flatBackPreviewUrl || !modelBackPreviewUrl) {
      showToast("This variant needs flat back and model back preview URLs.", "error");
      return;
    }
    const row = rows[selectedIndex];
    if (!row) {
      showToast("No placement row selected.", "error");
      return;
    }
    const tun =
      targetSettingsMap[selectedRenderTarget] ??
      getDefaultRenderTargetSettings(selectedRenderTarget, row, blank.styleCode);
    const pxx = tun.placement.x;
    const pyy = tun.placement.y;
    const sc = tun.placement.scale;
    const ab = row.artboardBase ?? 0.5;
    const shellW = preview8394ColumnRef.current?.clientWidth ?? 640;
    try {
      const designBounds = await resolveDesignBoundsFor8394Audit(effectiveOverlayArtUrl);
      const [flatM, modelM] = await Promise.all([
        measure8394GarmentDisplayForUrl(flatBackPreviewUrl, shellW),
        measure8394GarmentDisplayForUrl(modelBackPreviewUrl, shellW),
      ]);
      const rowFlat = buildPreview8394TargetAuditRow({
        renderTarget: "flat_back",
        naturalWidth: flatM.natural.w,
        naturalHeight: flatM.natural.h,
        overlayPercentBasisWidth: flatM.display.w,
        overlayPercentBasisHeight: flatM.display.h,
        defaultX: pxx,
        defaultY: pyy,
        defaultScale: sc,
        artboardBase: ab,
        designCropWidth: designBounds.w,
        designCropHeight: designBounds.h,
        designBoundsSource: designBounds.source,
      });
      const rowModel = buildPreview8394TargetAuditRow({
        renderTarget: "model_back",
        naturalWidth: modelM.natural.w,
        naturalHeight: modelM.natural.h,
        overlayPercentBasisWidth: modelM.display.w,
        overlayPercentBasisHeight: modelM.display.h,
        defaultX: pxx,
        defaultY: pyy,
        defaultScale: sc,
        artboardBase: ab,
        designCropWidth: designBounds.w,
        designCropHeight: designBounds.h,
        designBoundsSource: designBounds.source,
      });
      const safeAreaNorm = row.safeArea ?? undefined;
      const [vFlat, vModel] = await Promise.all([
        computePreview8394VisibleVerticalMetrics({
          renderTarget: "flat_back",
          artUrl: effectiveOverlayArtUrl,
          blankWidthPx: flatM.natural.w,
          blankHeightPx: flatM.natural.h,
          defaultX: pxx,
          defaultY: pyy,
          defaultScale: sc,
          artboardBase: ab,
          safeAreaNorm,
        }),
        computePreview8394VisibleVerticalMetrics({
          renderTarget: "model_back",
          artUrl: effectiveOverlayArtUrl,
          blankWidthPx: modelM.natural.w,
          blankHeightPx: modelM.natural.h,
          defaultX: pxx,
          defaultY: pyy,
          defaultScale: sc,
          artboardBase: ab,
          safeAreaNorm,
        }),
      ]);
      const report: Preview8394SideBySideReport = {
        generatedAt: new Date().toISOString(),
        coordinateSpace: PREVIEW8394_COORD_AUDIT_NOTE,
        flat_back: rowFlat,
        model_back: rowModel,
        visibleContentVertical: {
          flat_back: vFlat,
          model_back: vModel,
        },
        notes: [
          "Measured display box uses the same max-height rule as the preview canvas (off‑DOM).",
          "overlayPercentBasis = that client box; official uses natural garment PNG dimensions.",
          "[8394_VISIBLE_CONTENT_V] preview: alpha mapped through fitted bitmap (uniform scale of tight crop); compare to official log with OFFICIAL8394_VISIBLE_CONTENT_V=1.",
        ],
      };
      logPreview8394SideBySideReport(report);
      showToast(
        "8394 audit logged to console: [8394_COORD_AUDIT_REPORT], [8394_VISIBLE_CONTENT_V] (preview vertical metrics).",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Coordinate audit failed", "error");
    }
  }, [
    blank.styleCode,
    rows,
    selectedIndex,
    selectedRenderTarget,
    targetSettingsMap,
    previewVariant,
    effectiveOverlayArtUrl,
    flatBackPreviewUrl,
    modelBackPreviewUrl,
    showToast,
  ]);

  const previewDesignLabel = previewDesign
    ? `${previewDesign.teamNameCache ? `${previewDesign.teamNameCache} — ` : ""}${previewDesign.name ?? previewDesignId}`
    : "";

  const hasLightPng = Boolean(previewDesign && resolveDesignAssets(previewDesign).lightPng);
  const hasDarkPng = Boolean(previewDesign && resolveDesignAssets(previewDesign).darkPng);
  const hasWhitePng = Boolean(previewDesign && resolveDesignAssets(previewDesign).whitePng);

  /**
   * 8394 dashboard preview: `mapRealismToBlendPreview` (wider visual swing than Sharp `mapRealismToBlend`).
   * Other styles: unified fabric/print curve for preview CSS.
   */
  const zoneBlend = useMemo(() => {
    if (tuning && is8394) {
      const r = Math.round(clamp(tuning.blend.fabricFeel * 100, 0, 100));
      return mapRealismToBlendPreview(r);
    }
    if (tuning) return blendSettingsToPreviewCss(tuning.blend);
    if (!selected) return { blendMode: "multiply", blendOpacity: 1 };
    return effectiveZoneBlend(blank, selected.view, selected);
  }, [blank, is8394, selected, tuning]);

  /** Browser-only: multiply preview is illegible for several garment × artwork pairs; see resolveBlendedPreviewBlend8394. */
  const zoneBlendFor8394BlendedPreview = useMemo(() => {
    if (!previewVariant || !is8394 || selected?.view !== "back") {
      return { blendMode: zoneBlend.blendMode, blendOpacity: zoneBlend.blendOpacity, previewAdjusted: false };
    }
    const fam = getEffectiveColorFamily(previewVariant.colorFamily, previewVariant.colorName);
    return resolveBlendedPreviewBlend8394(fam, previewArtworkMode, zoneBlend);
  }, [previewVariant, is8394, selected?.view, previewArtworkMode, zoneBlend]);

  const designTreatment8394 = useMemo(() => {
    if (!is8394 || !selected) {
      return { designOpacityMultiplier: 1, contrastPercent: 100, saturatePercent: 100, realism: 0 };
    }
    if (tuning) {
      const ink = mapInkStrengthToFactorsPreview(Math.round(tuning.blend.printStrength * 100));
      const saturatePercent = Math.round(
        (ink.saturatePercent * fabricFeelToSaturatePercent(tuning.blend.fabricFeel)) / 100
      );
      return {
        designOpacityMultiplier: ink.designOpacityMultiplier,
        contrastPercent: ink.contrastPercent,
        saturatePercent: clamp(saturatePercent, 68, 138),
        realism: Math.round(tuning.blend.fabricFeel * 100),
      };
    }
    const leg = get8394DesignTreatmentFromPlacement(selected);
    return {
      designOpacityMultiplier: leg.designOpacityMultiplier,
      contrastPercent: leg.contrastPercent,
      saturatePercent: 100,
      realism: leg.realism,
    };
  }, [is8394, selected, tuning]);

  const is8394SimpleBackUi = is8394 && selected?.view === "back";

  const previewOpacity =
    zoneBlendFor8394BlendedPreview.blendOpacity * designTreatment8394.designOpacityMultiplier;
  const previewFilter = `contrast(${designTreatment8394.contrastPercent}%) saturate(${designTreatment8394.saturatePercent}%)`;

  const preview8394WarpMask = useMemo(() => {
    if (!is8394 || !tuning) return { warp: "", mask: {} as CSSProperties };
    return {
      warp: build8394PreviewWarpTransform(tuning.warp, selectedRenderTarget),
      mask: build8394PreviewMaskCss(tuning.mask),
    };
  }, [is8394, tuning, selectedRenderTarget]);

  const previewQa8394 = useMemo(() => {
    if (!is8394 || !tuning) return null;
    const zb = zoneBlendFor8394BlendedPreview;
    return {
      previewResolvedBlendMode: zb.blendMode,
      previewBaseLayerOpacity: zb.blendOpacity,
      previewAdjustedForGarmentArt: zb.previewAdjusted,
      finalOverlayOpacity: previewOpacity,
      contrastPercent: designTreatment8394.contrastPercent,
      saturatePercent: designTreatment8394.saturatePercent,
      inkMultiplier: designTreatment8394.designOpacityMultiplier,
      engineResolvedBlendMode: engineBlendResolved.blendMode,
      engineResolvedBlendOpacity: engineBlendResolved.blendOpacity,
      warpEnabled: tuning.warp?.enabled === true,
      warpStrength: tuning.warp?.warpStrength ?? 0,
      verticalStretch: tuning.warp?.verticalStretch ?? 0,
      horizontalWarp: tuning.warp?.horizontalWarp ?? 0,
      maskEnabled: tuning.mask?.enabled === true,
      edgeFade: tuning.mask?.edgeFade ?? 0,
      feather: tuning.mask?.feather ?? 0,
    };
  }, [
    is8394,
    tuning,
    zoneBlendFor8394BlendedPreview,
    previewOpacity,
    designTreatment8394,
    engineBlendResolved,
  ]);

  type RowPatch = {
    defaultX?: number;
    defaultY?: number;
    defaultScale?: number;
    safeArea?: Partial<ProfileRow["safeArea"]>;
    artboardBase?: number;
    renderZoneDefaults?: Partial<NonNullable<RPPlacement["renderZoneDefaults"]>> | null;
    profileStatus?: "draft" | "approved";
    notes?: string;
    artboardNotes?: string;
    allowedDesignAssetMode?: RPPlacement["allowedDesignAssetMode"];
    maskConfig?: Partial<NonNullable<RPPlacement["maskConfig"]>>;
    label?: string;
    view?: "front" | "back";
    simpleRenderControls8394?: Partial<RPPlacementSimpleRenderControls8394>;
  };

  const updateSelected = useCallback(
    (patch: RowPatch) => {
      setRows((prev) =>
        prev.map((p, i) => {
          if (i !== selectedIndex) return p;
          const next: ProfileRow = { ...p };
          if (patch.defaultX !== undefined) next.defaultX = patch.defaultX;
          if (patch.defaultY !== undefined) next.defaultY = patch.defaultY;
          if (patch.defaultScale !== undefined) next.defaultScale = patch.defaultScale;
          const scRow = String(blank.styleCode || "").trim();
          if (
            patch.defaultScale !== undefined &&
            scRow === "8394" &&
            next.view === "back" &&
            !patch.simpleRenderControls8394
          ) {
            next.simpleRenderControls8394 = normalizeSimpleControls8394({
              ...p.simpleRenderControls8394,
              sizePreset: sizePresetFromScale8394(patch.defaultScale),
            } as RPPlacementSimpleRenderControls8394);
          }
          if (patch.artboardBase !== undefined) next.artboardBase = patch.artboardBase;
          if (patch.safeArea) next.safeArea = { ...p.safeArea, ...patch.safeArea };
          if (patch.profileStatus !== undefined) next.profileStatus = patch.profileStatus;
          if (patch.notes !== undefined) next.notes = patch.notes;
          if (patch.artboardNotes !== undefined) next.artboardNotes = patch.artboardNotes;
          if (patch.allowedDesignAssetMode !== undefined) next.allowedDesignAssetMode = patch.allowedDesignAssetMode ?? "light_dark";
          if (patch.label !== undefined) next.label = patch.label;
          if (patch.view !== undefined) next.view = patch.view;
          if (patch.renderZoneDefaults === null) {
            next.renderZoneDefaults = null;
          } else if (patch.renderZoneDefaults) {
            next.renderZoneDefaults = {
              blendMode: patch.renderZoneDefaults.blendMode ?? p.renderZoneDefaults?.blendMode ?? null,
              blendOpacity:
                patch.renderZoneDefaults.blendOpacity ?? p.renderZoneDefaults?.blendOpacity ?? null,
            };
          }
          if (patch.maskConfig) {
            next.maskConfig = {
              mode: patch.maskConfig.mode ?? p.maskConfig?.mode ?? "none",
              notes: patch.maskConfig.notes ?? p.maskConfig?.notes ?? null,
            };
          }
          const sc = String(blank.styleCode || "").trim();
          if (patch.simpleRenderControls8394 && sc === "8394" && next.view === "back") {
            const merged = normalizeSimpleControls8394({
              ...p.simpleRenderControls8394,
              ...patch.simpleRenderControls8394,
            } as RPPlacementSimpleRenderControls8394);
            const d = derivePlacementEngineFields8394(merged);
            next.simpleRenderControls8394 = merged;
            // Print-style presets only change realism/ink → blend. Do not remap scale unless size preset changed.
            if (patch.simpleRenderControls8394.sizePreset !== undefined) {
              next.defaultScale = d.defaultScale;
            }
            next.renderZoneDefaults = d.renderZoneDefaults;
          }
          return next;
        })
      );
    },
    [selectedIndex, blank.styleCode]
  );

  const patchTargetTuning = useCallback(
    (patch: Partial<RpRenderTargetSettings>) => {
      setTargetSettingsMap((prev) => {
        const cur =
          prev[selectedRenderTarget] ??
          (selected
            ? getDefaultRenderTargetSettings(selectedRenderTarget, selected, blank.styleCode)
            : null);
        if (!cur) return prev;
        return {
          ...prev,
          [selectedRenderTarget]: mergeRenderTargetSettings(cur, patch),
        };
      });
    },
    [blank.styleCode, selected, selectedRenderTarget]
  );

  const handlePointerDownOverlay = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!previewSideAllowsPrinting) return;
      const wrap = (e.currentTarget as HTMLElement).closest("[data-garment-preview]");
      const img =
        (wrap?.querySelector("canvas[data-natural-8394-canvas]") as HTMLCanvasElement | null) ||
        (wrap?.querySelector("img[alt^='Garment']") as HTMLImageElement | null) ||
        imgRef.current;
      if (!img || !selected || !tuning) return;
      const r = img.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const cx = tuning.placement.x * r.width;
      const cy = tuning.placement.y * r.height;
      dragOffsetRef.current = { x: mx - cx, y: my - cy };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const imgEl = img;

      const onMove = (ev: PointerEvent) => {
        if (!dragOffsetRef.current || !imgEl) return;
        const rect = imgEl.getBoundingClientRect();
        const px = ev.clientX - rect.left - dragOffsetRef.current.x;
        const py = ev.clientY - rect.top - dragOffsetRef.current.y;
        patchTargetTuning({
          placement: {
            x: clamp(px / rect.width, 0, 1),
            y: clamp(py / rect.height, 0, 1),
            scale: tuning.placement.scale,
          },
        });
      };

      const onUp = (ev: PointerEvent) => {
        dragOffsetRef.current = null;
        (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [selected, tuning, patchTargetTuning, previewSideAllowsPrinting]
  );

  const handleReset = () => {
    setRows(JSON.parse(JSON.stringify(baselineRows)) as ProfileRow[]);
    setRenderProfileStatus(baselineMeta.renderProfileStatus);
    setRenderProfileNotes(baselineMeta.renderProfileNotes);
    setSupportedFront(baselineMeta.supportedFront);
    setSupportedBack(baselineMeta.supportedBack);
    setPreferredFlatLook8394(baselineMeta.preferredFlatLook8394);
    const v = variantId ? getVariantById(blank, variantId) : null;
    const nextMap =
      isMasterBlank(blank) && variantId
        ? buildEffectiveRenderTargetSettingsMap(blank, v)
        : (Object.fromEntries(
            RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(baselineTargetMap[k]!)])
          ) as Record<RpRenderTarget, RpRenderTargetSettings>);
    setTargetSettingsMap(nextMap);
    showToast("Reverted to last saved render profile", "success");
  };

  /**
   * Run the same Stage A Sharp compose the production pipeline runs, with the operator's
   * current tuning (unsaved is fine). Lets you validate a blank end-to-end before bulk
   * generating products. See RALLY_BLANK_PREVIEW_RENDER.md.
   */
  const handleRealRenderPreview = async (opts?: { withRealism?: boolean }) => {
    const withRealism = opts?.withRealism === true;
    if (!firebaseFunctions || !blank?.blankId) {
      setRealPreviewError("Firebase functions not available");
      return;
    }
    if (!previewDesignId) {
      setRealPreviewError("Pick a Preview design first (top of the page).");
      return;
    }
    if (!tuning) {
      setRealPreviewError("No tuning available for the current render target.");
      return;
    }
    setRealPreviewError(null);
    setRealPreviewLoading(withRealism ? "B" : "A");
    try {
      type PreviewInput = {
        blankId: string;
        variantId: string | null;
        designId: string;
        view: "front" | "back";
        artworkMode: "light" | "dark" | "white";
        withRealism?: boolean;
        /**
         * The exact design PNG URL the CSS canvas is rendering. Passing it through
         * eliminates client/server resolver drift for designs with side-specific
         * assets (e.g. files.front.darkPng vs files.back.darkPng), so Stage A
         * composites the same image bytes the user sees in the preview canvas.
         */
        designUrlOverride?: string | null;
        placement: {
          x: number;
          y: number;
          scale: number;
          width?: number;
          height?: number;
          blendMode?: string;
          blendOpacity?: number;
          /**
           * Raw fabric-feel + print-strength sliders (0–1). Stage A already encodes these
           * indirectly via `blendMode`/`blendOpacity`, but Stage B (Kontext) needs them
           * RAW so the prompt + pre-blur can scale: higher fabric feel → stronger
           * "ink absorbed into weave" directive + bigger softening blur, lower
           * print strength → "faded vintage" framing.
           */
          fabricFeel?: number;
          printStrength?: number;
          maskConfig?: { mode?: string | null } | null;
        };
      };
      /** Sync path returns RealPreviewResult; async (withRealism) returns just the jobId. */
      type PreviewOutput = RealPreviewResult | { jobId: string; status: "queued" };
      const fn = httpsCallable<PreviewInput, PreviewOutput>(firebaseFunctions, "previewBlankRender");
      const effectiveBlend = is8394SimpleBackUi
        ? { blendMode: zoneBlendFor8394BlendedPreview.blendMode, blendOpacity: zoneBlendFor8394BlendedPreview.blendOpacity }
        : { blendMode: zoneBlend.blendMode, blendOpacity: zoneBlend.blendOpacity };
      /**
       * Pass the operator's unsaved mask-config choice so the preview honors the
       * Render profile dropdown (none vs use uploaded mask) the same way production
       * onMockJobCreated will after this PR.
       */
      /**
       * v10.1: auto-promote `none`/unset → `blank_mask_doc` whenever a mask doc
       * exists for the current blank+view. Mirrors the editor dropdown's
       * effective-mode logic so the backend renders with the same mask the
       * operator sees as "Auto-default" in the UI.
       */
      const savedMaskMode = selected?.maskConfig?.mode;
      const effectiveMaskModeForPreview = currentBlankMaskUrl && (savedMaskMode == null || savedMaskMode === "none")
        ? "blank_mask_doc"
        : (savedMaskMode ?? null);
      const maskConfigForPreview = selected
        ? { mode: effectiveMaskModeForPreview }
        : null;
      /**
       * Option A safeArea sizing (RALLY_BLANK_PREVIEW_RENDER.md follow-up): pass the zone's
       * safeArea.w/h as the print-zone width/height so the compositor sizes the design
       * relative to the printable region (matches the Render profile CSS canvas instead
       * of the legacy "0.5 × blank × scale" default).
       */
      const safeAreaForPreview = selected?.safeArea;
      /** Tear down any prior realism subscription before starting a new render. */
      if (realPreviewJobUnsubRef.current) {
        realPreviewJobUnsubRef.current();
        realPreviewJobUnsubRef.current = null;
      }

      const result = await fn({
        blankId: blank.blankId,
        variantId: previewVariant?.variantId ?? null,
        designId: previewDesignId,
        view: previewSide,
        artworkMode: previewArtworkMode,
        withRealism,
        /** Same PNG URL the CSS canvas is showing — guarantees Stage A composites identical bytes. */
        designUrlOverride: effectiveOverlayArtUrl || null,
        placement: {
          x: tuning.placement.x,
          y: tuning.placement.y,
          scale: tuning.placement.scale,
          width: safeAreaForPreview?.w,
          height: safeAreaForPreview?.h,
          blendMode: effectiveBlend.blendMode,
          blendOpacity: effectiveBlend.blendOpacity,
          /** Raw sliders so Stage B prompt + pre-blur can scale (see callable input typedef above). */
          fabricFeel: tuning.blend.fabricFeel,
          printStrength: tuning.blend.printStrength,
          maskConfig: maskConfigForPreview,
        },
      });

      const data = result.data as PreviewOutput;
      const isAsyncJob =
        data && typeof data === "object" && "jobId" in (data as Record<string, unknown>) &&
        !("previewUrl" in (data as Record<string, unknown>));

      if (isAsyncJob) {
        const { jobId } = data as { jobId: string };
        /**
         * Subscribe to the job doc and update the preview UI as stageA → stageB land.
         * Stays loading until status flips to completed / failed; the doc is the
         * source of truth, so re-renders from React don't double-fire fal.ai.
         */
        const unsub = onSnapshot(
          firestoreDoc(firebaseDb!, "rp_blank_preview_jobs", jobId),
          (snap) => {
            if (!snap.exists()) return;
            const job = snap.data() as RPBlankPreviewJob & { id?: string };
            if (job.status === "failed") {
              setRealPreviewError(job.error || "Render preview failed");
              setRealPreviewLoading(null);
              if (realPreviewJobUnsubRef.current) {
                realPreviewJobUnsubRef.current();
                realPreviewJobUnsubRef.current = null;
              }
              return;
            }
            const stageBPresent = !!(job.stageB && job.stageB.previewUrl);
            const stageAPresent = !!(job.stageA && job.stageA.previewUrl);
            if (!stageAPresent && !stageBPresent) {
              return; /* still queued / early processing — keep loading state */
            }
            const primary = stageBPresent ? job.stageB! : job.stageA!;
            const stage: "A" | "B" = stageBPresent ? "B" : "A";
            setRealPreview({
              previewUrl: primary.previewUrl,
              width: primary.width,
              height: primary.height,
              bytes: primary.bytes,
              stage,
              stageA: stageAPresent
                ? {
                    previewUrl: job.stageA!.previewUrl,
                    width: job.stageA!.width,
                    height: job.stageA!.height,
                    bytes: job.stageA!.bytes,
                  }
                : undefined,
              stageB: stageBPresent
                ? {
                    previewUrl: job.stageB!.previewUrl,
                    falEndpoint: job.stageB!.falEndpoint,
                    usedMask: job.stageB!.usedMask,
                    params: job.stageB!.params,
                  }
                : null,
              maskApplied: stageAPresent ? job.stageA!.maskApplied : false,
              maskMean: stageAPresent ? job.stageA!.maskMean ?? null : null,
              placementUsed:
                stageAPresent && job.stageA!.placementUsed
                  ? job.stageA!.placementUsed
                  : {
                      x: tuning!.placement.x,
                      y: tuning!.placement.y,
                      scale: tuning!.placement.scale,
                      blendMode: effectiveBlend.blendMode || "soft-light",
                      blendOpacity: effectiveBlend.blendOpacity ?? 0.9,
                    },
              variantId: job.variantId ?? null,
              artworkMode: job.artworkMode,
            });
            /** Once final stage is in (Stage B if requested, else Stage A), stop the spinner. */
            if (job.status === "completed") {
              setRealPreviewLoading(null);
              if (realPreviewJobUnsubRef.current) {
                realPreviewJobUnsubRef.current();
                realPreviewJobUnsubRef.current = null;
              }
            }
          },
          (subErr) => {
            console.error("[BlankRenderProfileEditor] preview-job snapshot error:", subErr);
            setRealPreviewError(subErr?.message || "Preview job subscription failed");
            setRealPreviewLoading(null);
          }
        );
        realPreviewJobUnsubRef.current = unsub;
        return; /* loading stays on until the snapshot completes or errors */
      }

      setRealPreview(data as RealPreviewResult);
      setRealPreviewLoading(null);
    } catch (err: any) {
      console.error("[BlankRenderProfileEditor] real preview failed:", err);
      setRealPreviewError(err?.message || "Render preview failed");
      setRealPreviewLoading(null);
    }
  };

  /** Cleanup any open job subscription on unmount so we don't leak listeners. */
  useEffect(() => {
    return () => {
      if (realPreviewJobUnsubRef.current) {
        realPreviewJobUnsubRef.current();
        realPreviewJobUnsubRef.current = null;
      }
    };
  }, []);

  const dismissRealPreview = () => {
    setRealPreview(null);
    setRealPreviewError(null);
    if (realPreviewJobUnsubRef.current) {
      realPreviewJobUnsubRef.current();
      realPreviewJobUnsubRef.current = null;
    }
    setRealPreviewLoading(null);
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const supportedRenderViews: ("front" | "back")[] = [];
      if (supportedFront) supportedRenderViews.push("front");
      if (supportedBack) supportedRenderViews.push("back");

      /**
       * Master blank + selected variant: one cell = variantId × renderTarget in
       * `renderProfile.renderTargetsByColor`. Used for 8394 _and_ all other
       * master blanks (e.g. TR3008, HF07) — the legacy `variant.renderTargetOverrides`
       * diff path silently dropped `fabricFeel` / `printStrength` for non-8394
       * blanks, so we always go through the matrix to preserve full slider precision.
       */
      if (isMasterBlank(blank) && variantId) {
        const tuningForSave = targetSettingsMap[selectedRenderTarget];
        if (!tuningForSave) {
          showToast("Nothing to save for this render target.", "error");
          return;
        }
        const payload = cloneRenderTargetSettings(tuningForSave);
        const nextByColor = {
          ...(blank.renderProfile?.renderTargetsByColor ?? {}),
          [variantId]: {
            ...(blank.renderProfile?.renderTargetsByColor?.[variantId] ?? {}),
            [selectedRenderTarget]: payload,
          },
        };
        const v = getVariantById(blank, variantId);
        console.log("[matrix cell SAVE]", {
          blankId: blank.blankId,
          styleCode: blank.styleCode,
          variantIdUsed: variantId,
          target: selectedRenderTarget,
          savedTo: "renderProfile.renderTargetsByColor",
          deepMergeOtherColorIds: Object.keys(nextByColor).filter((id) => id !== variantId),
          otherTargetsUntouchedForThisColor: Object.keys(nextByColor[variantId] ?? {}).filter(
            (t) => t !== selectedRenderTarget
          ),
          cellSnapshot: payload,
        });
        await updateBlank({
          blankId: blank.blankId,
          renderProfile: {
            ...(blank.renderProfile ?? {}),
            renderTargets: blank.renderProfile?.renderTargets,
            renderTargetsByColor: nextByColor,
          },
          renderProfileStatus,
          renderProfileNotes: renderProfileNotes.trim() || null,
          supportedRenderViews: supportedRenderViews.length ? supportedRenderViews : null,
          preferredFlatLook8394:
            preferredFlatLook8394 === "" ? null : preferredFlatLook8394,
        });
        await refetchBlank();
        setBaselineMeta({
          renderProfileStatus,
          renderProfileNotes,
          supportedFront,
          supportedBack,
          preferredFlatLook8394,
        });
        showToast(`Saved ${v?.colorName ?? "color"} × ${RENDER_TARGET_LABELS[selectedRenderTarget]}.`, "success");
        return;
      }

      /** 8394 master blank baseline: one key in `renderProfile.renderTargets` + zone row for that target’s side only. */
      if (is8394 && isMasterBlank(blank) && !variantId) {
        const tuningForSave = targetSettingsMap[selectedRenderTarget];
        if (!tuningForSave) {
          showToast("Nothing to save for this render target.", "error");
          return;
        }
        const mergedRt = {
          ...(blank.renderProfile?.renderTargets ?? {}),
          [selectedRenderTarget]: cloneRenderTargetSettings(tuningForSave),
        } as NonNullable<NonNullable<RPBlank["renderProfile"]>["renderTargets"]>;
        let placementsPayload = rows;
        const t = tuningForSave;
        placementsPayload = rows.map((row) => {
          if (row.view === "back" && (selectedRenderTarget === "flat_back" || selectedRenderTarget === "model_back")) {
            const simple = normalizeSimpleControls8394({
              realism: Math.round(t.blend.fabricFeel * 100),
              inkStrength: Math.round(t.blend.printStrength * 100),
              sizePreset: sizePresetFromScale8394(t.placement.scale),
            });
            const d = derivePlacementEngineFields8394(simple);
            return {
              ...row,
              defaultX: t.placement.x,
              defaultY: t.placement.y,
              defaultScale: t.placement.scale,
              simpleRenderControls8394: simple,
              renderZoneDefaults: d.renderZoneDefaults,
            };
          }
          if (row.view === "front" && (selectedRenderTarget === "flat_front" || selectedRenderTarget === "model_front")) {
            return {
              ...row,
              defaultX: t.placement.x,
              defaultY: t.placement.y,
              defaultScale: t.placement.scale,
            };
          }
          return row;
        });
        console.log("[8394 renderProfile save]", {
          blankId: blank.blankId,
          scope: "blank_baseline",
          renderTarget: selectedRenderTarget,
          payload: mergedRt[selectedRenderTarget],
        });
        await updateBlank({
          blankId: blank.blankId,
          placements: placementsPayload.map((r) => toFirestorePlacement(r, blank.styleCode)),
          renderProfile: {
            ...(blank.renderProfile ?? {}),
            renderTargets: mergedRt,
            renderTargetsByColor: blank.renderProfile?.renderTargetsByColor,
          },
          renderProfileStatus,
          renderProfileNotes: renderProfileNotes.trim() || null,
          supportedRenderViews: supportedRenderViews.length ? supportedRenderViews : null,
          preferredFlatLook8394: preferredFlatLook8394 === "" ? null : preferredFlatLook8394,
        });
        await refetchBlank();
        setRows(placementsPayload);
        setBaselineRows(JSON.parse(JSON.stringify(placementsPayload)) as ProfileRow[]);
        setBaselineTargetMap(
          Object.fromEntries(
            RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(targetSettingsMap[k]!)])
          ) as Record<RpRenderTarget, RpRenderTargetSettings>
        );
        setBaselineMeta({
          renderProfileStatus,
          renderProfileNotes,
          supportedFront,
          supportedBack,
          preferredFlatLook8394,
        });
        showToast(`Saved blank baseline × ${RENDER_TARGET_LABELS[selectedRenderTarget]}.`, "success");
        return;
      }

      // (Legacy non-8394 master+variantId branch removed: it routed through
      // diffSettingsToVariantRenderTargetOverride, which silently dropped
      // fabricFeel / printStrength changes for any non-8394-back target. The
      // master+variantId case above now handles all styleCodes via the matrix.)

      const renderTargets = Object.fromEntries(
        RENDER_TARGETS.map((t) => [t, targetSettingsMap[t]!])
      ) as NonNullable<NonNullable<RPBlank["renderProfile"]>["renderTargets"]>;
      let placementsPayload = rows;
      if (is8394) {
        const fb = targetSettingsMap.flat_back;
        const ff = targetSettingsMap.flat_front;
        placementsPayload = rows.map((row) => {
          if (row.view === "back" && fb) {
            const simple = normalizeSimpleControls8394({
              realism: Math.round(fb.blend.fabricFeel * 100),
              inkStrength: Math.round(fb.blend.printStrength * 100),
              sizePreset: sizePresetFromScale8394(fb.placement.scale),
            });
            const d = derivePlacementEngineFields8394(simple);
            return {
              ...row,
              defaultX: fb.placement.x,
              defaultY: fb.placement.y,
              defaultScale: fb.placement.scale,
              simpleRenderControls8394: simple,
              renderZoneDefaults: d.renderZoneDefaults,
            };
          }
          if (row.view === "front" && ff) {
            return {
              ...row,
              defaultX: ff.placement.x,
              defaultY: ff.placement.y,
              defaultScale: ff.placement.scale,
            };
          }
          return row;
        });
      }
      console.log("[renderProfile save] full blank profile", {
        blankId: blank.blankId,
        renderTargets,
      });
      await updateBlank({
        blankId: blank.blankId,
        placements: placementsPayload.map((r) => toFirestorePlacement(r, blank.styleCode)),
        renderProfile: {
          ...(blank.renderProfile ?? {}),
          renderTargets,
        },
        renderProfileStatus,
        renderProfileNotes: renderProfileNotes.trim() || null,
        supportedRenderViews: supportedRenderViews.length ? supportedRenderViews : null,
        preferredFlatLook8394: is8394
          ? preferredFlatLook8394 === ""
            ? null
            : preferredFlatLook8394
          : undefined,
      });
      await refetchBlank();
      setBaselineRows(JSON.parse(JSON.stringify(rows)) as ProfileRow[]);
      setBaselineTargetMap(
        Object.fromEntries(
          RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(targetSettingsMap[k]!)])
        ) as Record<RpRenderTarget, RpRenderTargetSettings>
      );
      setBaselineMeta({
        renderProfileStatus,
        renderProfileNotes,
        supportedFront,
        supportedBack,
        preferredFlatLook8394,
      });
      showToast(
        is8394
          ? "Saved. Open a linked product and tap Generate if you need fresh previews."
          : "Blank render profile saved.",
        "success"
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const applyRenderStylePreset = useCallback(
    (id: RenderStylePresetId) => {
      setExplicitCustomStyle(false);
      setLastExplicitRenderStyle(id);
      const sc = String(blank.styleCode || "").trim();
      if (sc === "8394") {
        if (selected?.view === "back") {
          const v = RENDER_STYLE_TO_SIMPLE_8394[id];
          patchTargetTuning({
            blend: {
              fabricFeel: v.realism / 100,
              printStrength: v.inkStrength / 100,
            },
          });
          return;
        }
        if (selected?.view === "front") {
          const zb = RENDER_STYLE_TO_ZONE_BLEND[id];
          const b = legacyZoneBlendToBlend01({ blendMode: zb.blendMode, blendOpacity: zb.blendOpacity });
          patchTargetTuning({
            blend: {
              fabricFeel: b.fabricFeel ?? 0.75,
              printStrength: b.printStrength ?? 0.72,
              mode: undefined,
            },
          });
          return;
        }
      }
      const zb = RENDER_STYLE_TO_ZONE_BLEND[id];
      updateSelected({ renderZoneDefaults: { blendMode: zb.blendMode, blendOpacity: zb.blendOpacity } });
    },
    [blank.styleCode, selected?.view, patchTargetTuning, updateSelected]
  );

  const applyPrintSizePreset = useCallback(
    (preset: RP8394SizePreset) => {
      const sc = String(blank.styleCode || "").trim();
      if (sc === "8394" && tuning) {
        patchTargetTuning({
          placement: {
            ...tuning.placement,
            scale: sizePresetToDefaultScale(preset),
          },
        });
        return;
      }
      updateSelected({ defaultScale: sizePresetToDefaultScale(preset) });
    },
    [blank.styleCode, patchTargetTuning, tuning, updateSelected]
  );

  const resetRenderStyleToLastPreset = useCallback(() => {
    applyRenderStylePreset(lastExplicitRenderStyle);
  }, [applyRenderStylePreset, lastExplicitRenderStyle]);

  const scale = tuning?.placement.scale ?? selected?.defaultScale ?? 0.6;
  const artBase = selected?.artboardBase ?? 0.5;
  const sx = selected?.safeArea?.x ?? DEFAULT_GARMENT_SAFE_AREA.x;
  const sy = selected?.safeArea?.y ?? DEFAULT_GARMENT_SAFE_AREA.y;
  const sw = selected?.safeArea?.w ?? DEFAULT_GARMENT_SAFE_AREA.w;
  const sh = selected?.safeArea?.h ?? DEFAULT_GARMENT_SAFE_AREA.h;
  const px = tuning?.placement.x ?? selected?.defaultX ?? 0.5;
  const py = tuning?.placement.y ?? selected?.defaultY ?? 0.5;

  useEffect(() => {
    if (String(blank.styleCode || "").trim() !== "8394") return;
    if (!previewGarmentUrl || !effectiveOverlayArtUrl) return;
    let cancelled = false;
    const garment = new Image();
    const design = new Image();
    garment.crossOrigin = "anonymous";
    design.crossOrigin = "anonymous";
    const run = () => {
      if (cancelled) return;
      if (!garment.naturalWidth || !design.naturalWidth) return;
      const layout = computePlacement8394Layout({
        blankWidthPx: garment.naturalWidth,
        blankHeightPx: garment.naturalHeight,
        defaultX: px,
        defaultY: py,
        defaultScale: scale,
        artboardBase: artBase,
        designWidthPx: design.naturalWidth,
        designHeightPx: design.naturalHeight,
      });
      const dbg =
        process.env.NEXT_PUBLIC_DEBUG_8394_PLACEMENT === "1" ||
        (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_PLACEMENT") === "1");
      if (dbg) {
        console.debug("[8394 placement preview] same formula as render8394DesignOnGarmentSharp computeLayout", layout);
      }
      const parityDbg =
        process.env.NEXT_PUBLIC_DEBUG_8394_PLACEMENT_PARITY === "1" ||
        (typeof window !== "undefined" && window.localStorage?.getItem("DEBUG_8394_PLACEMENT_PARITY") === "1");
      if (parityDbg) {
        const warpOn = tuning?.warp?.enabled === true;
        const parityPreview = {
          kind: "preview",
          renderTarget: selectedRenderTarget,
          warpEnabled: warpOn,
          artboardBaseUsed: artBase,
          centerPointPx: layout.centerPx,
          preWarpSlotRectPx: {
            x: layout.designFittedPx.leftClamped,
            y: layout.designFittedPx.topClamped,
            w: layout.designFittedPx.width,
            h: layout.designFittedPx.height,
          },
          postWarpBitmapDimensionsPx: warpOn
            ? null
            : {
                clean: { w: layout.designFittedPx.width, h: layout.designFittedPx.height },
                blended: { w: layout.designFittedPx.width, h: layout.designFittedPx.height },
              },
          finalCompositeTopLeftBlendedPx_ifWarpOffMatchesSharp: {
            x: layout.designFittedPx.leftClamped,
            y: layout.designFittedPx.topClamped,
          },
          note: warpOn
            ? "CSS 3D warp does not expose Sharp bitmap size — compare [PLACEMENT8394_PARITY] official logs for post-warp dims."
            : "Warp off: compare to official finalCompositeTopLeftPx.blended (should match if mask/crop parity).",
        };
        console.log(`[PLACEMENT8394_PARITY] ${JSON.stringify(parityPreview)}`);
      }
    };
    let loaded = 0;
    const tick = () => {
      loaded += 1;
      if (loaded >= 2) run();
    };
    garment.onload = tick;
    design.onload = tick;
    garment.src = proxiedImageUrlForCanvas(previewGarmentUrl);
    design.src = proxiedImageUrlForCanvas(effectiveOverlayArtUrl);
    return () => {
      cancelled = true;
    };
  }, [
    blank.styleCode,
    previewGarmentUrl,
    effectiveOverlayArtUrl,
    px,
    py,
    scale,
    artBase,
    selectedRenderTarget,
    tuning?.warp?.enabled,
  ]);

  /**
   * Hooks must run on every render, so the strict-parity useMemos live above the
   * `if (!rows.length)` early return below. They depend on state that exists from
   * the start of the component, so hoisting is safe.
   */
  const official8394Parsed = useMemo(
    () => parseOfficial8394StrictParityJson(official8394StrictPaste.trim()),
    [official8394StrictPaste]
  );

  const preview8394StrictSnapshot = useMemo(() => {
    if (!preview8394Parity) return null;
    return buildPreview8394StrictSnapshotFromTelemetry(preview8394Parity, {
      contrastPercent: designTreatment8394.contrastPercent,
      saturatePercent: designTreatment8394.saturatePercent,
      note: "Canvas filter mirrors ink/contrast; Sharp uses apply8394DesignTreatmentPng.",
    });
  }, [preview8394Parity, designTreatment8394]);

  const strict8394ParityCompare: StrictParityComparison | null = useMemo(() => {
    if (!preview8394StrictSnapshot || !official8394Parsed) return null;
    return compare8394StrictParity(preview8394StrictSnapshot, official8394Parsed);
  }, [preview8394StrictSnapshot, official8394Parsed]);

  if (!rows.length) {
    return (
      <div>
        <p className="text-sm text-gray-500 mb-4">
          No render zones yet. Seed this blank or add placements — each row becomes a canonical render profile (zone).
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          No placements configured.
        </div>
      </div>
    );
  }

  const zoneBlendMode = selected?.renderZoneDefaults?.blendMode ?? "";
  const zoneBlendOpacity = selected?.renderZoneDefaults?.blendOpacity;
  /** 8394: derive active print-style preset from Target tuning only (single source of truth). */
  const resolvedPrintStyleMatch: RenderStylePresetId | "custom" | null = (() => {
    if (!is8394 || !tuning) return null;
    if (selected?.view === "back") {
      return matchRenderStylePreset8394(
        Math.round(tuning.blend.fabricFeel * 100),
        Math.round(tuning.blend.printStrength * 100)
      );
    }
    if (selected?.view === "front") {
      const e = blendSettingsToEngineBlend(tuning.blend);
      return matchRenderStylePresetZone(e.blendMode, e.blendOpacity);
    }
    return null;
  })();

  const explicitZoneBlend = selected?.renderZoneDefaults;
  const hasExplicitZoneBlend = Boolean(
    explicitZoneBlend &&
      explicitZoneBlend.blendMode != null &&
      String(explicitZoneBlend.blendMode).trim() !== "" &&
      explicitZoneBlend.blendOpacity != null
  );
  const matchedRenderStyleZone =
    !is8394SimpleBackUi && hasExplicitZoneBlend
      ? matchRenderStylePresetZone(explicitZoneBlend!.blendMode, explicitZoneBlend!.blendOpacity)
      : null;

  const showRenderStyleReset =
    (is8394 && (resolvedPrintStyleMatch === "custom" || explicitCustomStyle)) ||
    (!is8394 && hasExplicitZoneBlend && (matchedRenderStyleZone === "custom" || explicitCustomStyle));

  const zoneCustomSliders = zoneBlendToApproxCustomSliders(selected?.renderZoneDefaults);
  const showZoneCustomSliders =
    Boolean(!is8394SimpleBackUi && hasExplicitZoneBlend) &&
    (matchedRenderStyleZone === "custom" || explicitCustomStyle);

  const customButtonActive =
    explicitCustomStyle ||
    (is8394 ? resolvedPrintStyleMatch === "custom" : hasExplicitZoneBlend && matchedRenderStyleZone === "custom");

  const useBlendedCanvas = previewMode === "blended" || previewMode === "compare";
  /** No drop-shadow on blended 8394 — shadow softens edges next to mix-blend. */
  const sharpBlended8394OverlayImgClass =
    "w-full h-full object-contain pointer-events-none select-none";
  const blendModeForBlendedCanvas = is8394SimpleBackUi
    ? zoneBlendFor8394BlendedPreview.blendMode
    : zoneBlend.blendMode;
  /**
   * v9 (2026-05-25): non-destructive slider preview.
   *
   * The original sliders drove `mix-blend-mode: multiply` at low opacity, which on a
   * black garment made the design near-invisible (e.g. ff=80% → multiply · op 0.49).
   * v8.3 disabled that entirely → sliders moved but nothing changed in preview, which
   * is its own UX failure.
   *
   * v9 splits the difference: sliders apply a *safe, always-visible* CSS effect that
   * approximates the AI realism look. Backend Stage A still renders clean (so Flux
   * Fill gets a color-anchored input), but the live canvas now responds to slider
   * motion within a non-destructive range:
   *
   *   - Print strength → opacity in [0.85, 1.00] (never below 0.85 → design always
   *     clearly visible; high end gives fully vivid ink).
   *   - Fabric feel    → `saturate()` in [0.82, 1.00] + `blur()` in [0, 1.2px]
   *     (slight desaturation + softness simulates ink absorbing into cotton fibers,
   *     never destructive).
   *
   * 8394 path retains its bespoke blend logic so in-progress 8394 tuning isn't
   * disturbed; only the non-8394 path (HF07 + future garments) gets this preview.
   */
  const aiPreviewOpacity = tuning && !is8394SimpleBackUi
    ? 0.85 + tuning.blend.printStrength * 0.15
    : 1;
  const aiPreviewSaturation = tuning && !is8394SimpleBackUi
    ? 1.0 - tuning.blend.fabricFeel * 0.18
    : 1.0;
  const aiPreviewBlurPx = tuning && !is8394SimpleBackUi
    ? tuning.blend.fabricFeel * 1.2
    : 0;
  const aiPreviewFilter = tuning && !is8394SimpleBackUi
    ? `saturate(${aiPreviewSaturation.toFixed(2)}) blur(${aiPreviewBlurPx.toFixed(2)}px)`
    : undefined;
  const force8394LegacyBlend = is8394SimpleBackUi;
  const canvasMixBlend = useBlendedCanvas && force8394LegacyBlend
    ? (cssMixBlendMode(blendModeForBlendedCanvas) as React.CSSProperties["mixBlendMode"])
    : "normal";
  const canvasOpacity = useBlendedCanvas && force8394LegacyBlend
    ? previewOpacity
    : (useBlendedCanvas ? aiPreviewOpacity : 1);
  const canvasFilter = useBlendedCanvas && is8394 && tuning
    ? previewFilter
    : (useBlendedCanvas ? aiPreviewFilter : undefined);

  const canvas8394Warp = is8394 && tuning ? preview8394WarpMask.warp : undefined;
  const canvas8394Mask = is8394 && tuning ? preview8394WarpMask.mask : undefined;

  const previewAssetsReady = Boolean(
    previewGarmentUrl &&
      (!previewDesignId || !previewSideAllowsPrinting || Boolean(overlayArtUrl))
  );
  const missingArtForActiveSide = Boolean(
    previewDesignId && previewSideAllowsPrinting && !overlayArtUrl
  );
  const showSafeAreaOnCanvas = showSafeArea && previewSideAllowsPrinting;

  const profileHeaderSubtitle = [blank.styleCode, blank.garmentStyle || blank.styleName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const zonesFront = rows.some((r) => r.view === "front" || placementSide(r.placementId) === "front");
  const zonesBack = rows.some((r) => r.view === "back" || placementSide(r.placementId) === "back");
  const zonesLabel = [zonesFront ? "Front" : null, zonesBack ? "Back" : null].filter(Boolean).join(" · ") || "—";

  const strictTargetMismatch =
    official8394Parsed &&
    preview8394StrictSnapshot &&
    official8394Parsed.renderTarget &&
    preview8394StrictSnapshot.renderTarget !== official8394Parsed.renderTarget;

  const strictPipelineMismatch =
    official8394Parsed &&
    preview8394StrictSnapshot &&
    official8394Parsed.renderPipelineMode &&
    official8394Parsed.renderPipelineMode !== preview8394StrictSnapshot.compositeKind;

  return (
    <div className="space-y-8">
      {/* —— A: Header —— */}
      <header className="border-b border-neutral-200 pb-6">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
          Render Profile — {profileHeaderSubtitle || blank.styleName || "Blank"}
        </h1>
        <p className="text-sm text-neutral-600 mt-1.5 max-w-3xl">
          This defines how all designs are placed and rendered on this blank.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              renderProfileStatus === "approved"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            Blank: {renderProfileStatus === "approved" ? "Ready" : "Draft"}
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-800">
            Zones: {zonesLabel}
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              previewAssetsReady ? "bg-sky-100 text-sky-900" : "bg-neutral-200 text-neutral-700"
            }`}
          >
            Preview: {previewAssetsReady ? "Ready" : "Missing assets"}
          </span>
          {/* Per-view mask status. Reads `rp_blank_masks/{blankId}_{previewSide}` from
              parent-supplied props; click to jump to the Rendering tab pre-set to that view. */}
          {currentBlankMaskDoc && currentBlankMaskUrl ? (
            <button
              type="button"
              onClick={() => onManageMasks?.(previewSide)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              title={
                currentBlankMaskDoc.source === "ai_sam"
                  ? `AI-generated mask · prompt: "${currentBlankMaskDoc.aiPrompt ?? "(default)"}" · seed: ${currentBlankMaskDoc.aiSeed ?? "?"}`
                  : currentBlankMaskDoc.source === "auto_safearea"
                    ? "Rectangular mask generated from the placement safeArea"
                    : "Mask uploaded — click to manage on the Rendering tab"
              }
            >
              <span aria-hidden>✅</span>
              {currentBlankMaskDoc.source === "ai_sam" ? <span aria-hidden>🪄</span> : null}
              {currentBlankMaskDoc.source === "auto_safearea" ? <span aria-hidden>▭</span> : null}
              <span>
                Mask ({previewSide}): Uploaded
                {currentBlankMaskDoc.mask?.width && currentBlankMaskDoc.mask?.height
                  ? ` · ${currentBlankMaskDoc.mask.width}×${currentBlankMaskDoc.mask.height}`
                  : ""}
                {currentBlankMaskDoc.mask?.bytes
                  ? ` · ${Math.round(currentBlankMaskDoc.mask.bytes / 1024)}KB`
                  : ""}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onManageMasks?.(previewSide)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200"
              title="No mask uploaded for this side — click to upload on the Rendering tab"
            >
              <span aria-hidden>⚠️</span>
              <span>Mask ({previewSide}): Missing — Upload on Rendering tab →</span>
            </button>
          )}
        </div>
        {is8394 && selectedRenderTarget === "flat_back" && !previewGarmentUrl && previewVariant ? (
          <p className="text-xs text-red-700 mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 inline-block">
            Selected variant has no flat back photo — upload on the Variants tab for a useful preview.
          </p>
        ) : null}
      </header>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 items-start">
        {/* —— B: Left controls (~40%) —— */}
        <aside className="w-full lg:w-[40%] lg:max-w-xl shrink-0 space-y-8 lg:pr-2 lg:border-r lg:border-neutral-200">
          {/* 1. Preview setup */}
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">1. Preview setup</h2>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Preview design</label>
              <select
                value={previewDesignId}
                onChange={(e) => setPreviewDesignId(e.target.value)}
                disabled={designsLoading}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-sm bg-white text-neutral-900"
              >
                <option value="">Select design from library…</option>
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.teamNameCache ? `${d.teamNameCache} — ` : ""}
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500 mt-2 leading-relaxed">
                Use a real design to position placement. This will <strong>not</strong> be saved to the blank.
              </p>
            </div>
            {isMasterBlank(blank) && variants.length > 0 ? (
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Garment color (preview photo + save scope)
                </label>
                <select
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  <option value="">Blank baseline (all colors)</option>
                  {variants.map((v) => (
                    <option key={v.variantId} value={v.variantId}>
                      {v.colorName}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">
                  A specific color: <strong className="text-neutral-700">Save</strong> writes placement overrides for that color only.
                  <strong className="text-neutral-700"> Blank baseline</strong> edits defaults shared by all colors.
                  Artwork preview uses each variant&apos;s <strong className="text-neutral-700">Light / dark (artwork)</strong> family and optional{" "}
                  <strong className="text-neutral-700">Preferred artwork tone</strong> in <strong className="text-neutral-700">Edit variant</strong>.
                </p>
              </div>
            ) : null}
            <div>
              <span className="block text-xs font-medium text-neutral-600 mb-2">Artwork variant</span>
              <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 p-0.5 bg-neutral-50 gap-0.5">
                <button
                  type="button"
                  disabled={!hasLightPng}
                  onClick={() => setPreviewArtworkMode("light")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    previewArtworkMode === "light"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Light
                </button>
                <button
                  type="button"
                  disabled={!hasDarkPng}
                  onClick={() => setPreviewArtworkMode("dark")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    previewArtworkMode === "dark"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Dark
                </button>
                <button
                  type="button"
                  disabled={!hasWhitePng}
                  onClick={() => setPreviewArtworkMode("white")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    previewArtworkMode === "white"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  White
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Render target</label>
              <select
                value={selectedRenderTarget}
                onChange={(e) => setSelectedRenderTarget(e.target.value as RpRenderTarget)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-sm bg-white text-neutral-900"
              >
                {RENDER_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {RENDER_TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500 mt-1.5 leading-snug">
                Defaults to Flat Front / Flat Back when you switch render zone. Preview image follows this target. Placement and print style below are saved per target.
              </p>
            </div>
            {/*
              Target tuning (placement + print style + diagnostics) lives inline in the same
              section as Render target above so the sliders sit immediately below the dropdown
              with no card break. Re-keyed on (variantId × selectedRenderTarget) to remount
              child state cleanly when either changes. Saves write to either blank baseline or
              per-variant override (controlled by the Garment color save-scope selector higher up).
            */}
            <div
              key={`tuning-cell-${variantId || "baseline"}-${selectedRenderTarget}`}
              className="space-y-3"
            >
            {/*
              Sliders block (placement + legacy print style) sits FIRST in this section so it
              renders directly under the Render target dropdown above. All 8394 diagnostics
              (warnings, matrix-cell inspector, copy buttons) and the non-8394 Resolved Tuning
              read-only QA block move below the sliders.
            */}
            {tuning && is8394 ? (
              <TargetTuning8394Panel
                tuning={tuning}
                patchTargetTuning={patchTargetTuning}
                selected={selected}
                selectedRenderTarget={selectedRenderTarget}
                resolvedTargetForEngine={resolvedTargetForEngine}
                engineBlendResolved={engineBlendResolved}
                sx={sx}
                sy={sy}
                sw={sw}
                sh={sh}
                artBase={artBase}
                showSafeArea={showSafeArea}
                setShowSafeArea={setShowSafeArea}
                showClipHint={showClipHint}
                setShowClipHint={setShowClipHint}
                is8394SimpleBackUi={is8394SimpleBackUi}
                updateSelected={updateSelected}
                previewQa8394={previewQa8394}
              />
            ) : tuning ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">
                    Placement tuning (this target)
                  </h3>
                  <p className="text-[11px] text-neutral-500 mb-2">
                    Overlay position/size for this photo only. Drag on preview updates these values.
                  </p>
                  <div>
                    <div className="flex justify-between text-xs text-neutral-600 mb-1">
                      <span className="font-medium text-neutral-800">Scale</span>
                      <span>{scalePercentFromEngine(tuning.placement.scale)}%</span>
                    </div>
                    <input
                      type="range"
                      min={SCALE_PCT_MIN}
                      max={SCALE_PCT_MAX}
                      step={1}
                      value={scalePercentFromEngine(tuning.placement.scale)}
                      onChange={(e) =>
                        patchTargetTuning({
                          placement: {
                            ...tuning.placement,
                            scale: scaleEngineFromPercent(Number(e.target.value)),
                          },
                        })
                      }
                      className="w-full accent-violet-600"
                    />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-neutral-600 mb-1">
                      <span className="font-medium text-neutral-800">Horizontal</span>
                      <span>{Math.round(tuning.placement.x * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(tuning.placement.x * 100)}
                      onChange={(e) =>
                        patchTargetTuning({
                          placement: {
                            ...tuning.placement,
                            x: Number(e.target.value) / 100,
                          },
                        })
                      }
                      className="w-full accent-violet-600"
                    />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-neutral-600 mb-1">
                      <span className="font-medium text-neutral-800">Vertical</span>
                      <span>{Math.round(tuning.placement.y * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(tuning.placement.y * 100)}
                      onChange={(e) =>
                        patchTargetTuning({
                          placement: {
                            ...tuning.placement,
                            y: Number(e.target.value) / 100,
                          },
                        })
                      }
                      className="w-full accent-violet-600"
                    />
                  </div>
                </div>
                {/*
                  AI realism tuning — replaced continuous sliders with 3-button pickers
                  (2026-05-25) because the Stage B prompt buckets each slider into 3 bands
                  internally (low/med/high). Continuous sliders gave the illusion of fine
                  control but ff=20 vs ff=39 produced the identical prompt. The picker UI
                  is honest about the underlying 6-preset reality and faster to tune.
                  Underlying storage stays numeric (`tuning.blend.fabricFeel`,
                  `tuning.blend.printStrength`) — buttons pin to band-center values
                  (0.2 / 0.55 / 0.85) so existing saves and backend bucketing both work.
                */}
                {(() => {
                  const ffValue = tuning.blend.fabricFeel;
                  const psValue = tuning.blend.printStrength;
                  const fabricBands = [
                    { value: 0.20, label: "Clean", caption: "Subtle fiber texture, mostly opaque ink" },
                    { value: 0.55, label: "Textured", caption: "Visible weave through ink, soft edges" },
                    { value: 0.85, label: "Worn", caption: "Pronounced fiber mottling, broken-up coverage" },
                  ] as const;
                  const strengthBands = [
                    { value: 0.20, label: "Faded", caption: "Lightly faded, washed-out" },
                    { value: 0.55, label: "Vivid", caption: "Fresh full saturation" },
                    { value: 0.85, label: "Bold", caption: "Extra bold, freshly printed" },
                  ] as const;
                  const activeFabricBand = fabricBands.reduce((acc, b) =>
                    Math.abs(b.value - ffValue) < Math.abs(acc.value - ffValue) ? b : acc, fabricBands[1]);
                  const activeStrengthBand = strengthBands.reduce((acc, b) =>
                    Math.abs(b.value - psValue) < Math.abs(acc.value - psValue) ? b : acc, strengthBands[1]);
                  return (
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-1">
                        Product preview tuning
                      </h3>
                      <p className="text-[11px] text-neutral-500 mb-3 leading-snug">
                        Live canvas previews each pick. Click <strong className="text-neutral-700">Product Preview</strong> above for the real output.
                      </p>
                      <div className="space-y-4">
                        <div>
                          <span className="block text-xs font-medium text-neutral-700 mb-1.5">Fabric feel</span>
                          <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 p-0.5 bg-neutral-50 gap-0.5 w-full">
                            {fabricBands.map((b) => {
                              const isActive = b.value === activeFabricBand.value;
                              return (
                                <button
                                  key={b.label}
                                  type="button"
                                  onClick={() => patchTargetTuning({ blend: { ...tuning.blend, fabricFeel: b.value } })}
                                  className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                    isActive
                                      ? "bg-white text-neutral-900 shadow-sm"
                                      : "text-neutral-600 hover:text-neutral-900"
                                  }`}
                                >
                                  {b.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-1 leading-snug">{activeFabricBand.caption}</p>
                        </div>
                        <div>
                          <span className="block text-xs font-medium text-neutral-700 mb-1.5">Print strength</span>
                          <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 p-0.5 bg-neutral-50 gap-0.5 w-full">
                            {strengthBands.map((b) => {
                              const isActive = b.value === activeStrengthBand.value;
                              return (
                                <button
                                  key={b.label}
                                  type="button"
                                  onClick={() => patchTargetTuning({ blend: { ...tuning.blend, printStrength: b.value } })}
                                  className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                    isActive
                                      ? "bg-white text-neutral-900 shadow-sm"
                                      : "text-neutral-600 hover:text-neutral-900"
                                  }`}
                                >
                                  {b.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-1 leading-snug">{activeStrengthBand.caption}</p>
                        </div>
                        {/*
                          DISABLED v10 (2026-05-25): "Mode (optional)" dropdown wrote to
                          `tuning.blend.mode` but is no longer read anywhere in the active
                          pipeline:
                            - Stage A backend (v8.3): forces normal blend, ignores mode.
                            - CSS canvas (v8.3): forces normal blend, ignores mode.
                            - Stage B Flux Fill prompt (v10): builds dynamic prompt from
                              ff/ps band only, never references blend.mode.
                          Hidden to declutter; restore if a later pipeline wires it back in.
                        <div>
                          <label className="block text-xs font-medium text-neutral-700 mb-1">Mode (optional)</label>
                          <select
                            value={tuning.blend.mode ?? ""}
                            onChange={(e) =>
                              patchTargetTuning({
                                blend: {
                                  ...tuning.blend,
                                  mode:
                                    e.target.value === ""
                                      ? undefined
                                      : (e.target.value as NonNullable<typeof tuning.blend.mode>),
                                },
                              })
                            }
                            className="w-full border border-neutral-300 rounded-lg px-2 py-2 text-sm bg-white text-neutral-900"
                          >
                            <option value="">Engine curve (default)</option>
                            <option value="clean">Clean</option>
                            <option value="soft">Soft</option>
                            <option value="vintage">Vintage</option>
                            <option value="bold">Bold</option>
                          </select>
                        </div>
                        */}
                      </div>
                    </div>
                  );
                })()}
                {/*
                  DISABLED v10 (2026-05-25): Legacy CSS warp (3D skew) was only ever used
                  by the 8394 deterministic compositor. AI realism (Flux Fill) now drapes
                  prints over fabric folds, so this is fully redundant for HF07 and any
                  future garment. Saved warp data on Firestore is still readable but no
                  longer surfaced in the UI. If 8394 panty needs warp tuning again,
                  re-enable behind an `is8394` guard.
                {is8394 ? (
                <details className="rounded-lg border border-neutral-200 bg-neutral-50/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-neutral-600 list-none flex items-center gap-2">
                    <span aria-hidden>▸</span>
                    Legacy: Warp &middot; now handled by AI realism
                  </summary>
                  <p className="text-[10px] text-neutral-500 italic mt-2 mb-3 leading-snug">
                    Per-target CSS warp (3D skew). Stage B (Kontext) drapes the print over fabric folds naturally — only enable warp for blanks like 8394 panties where the deterministic compositor needs it.
                  </p>
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Warp (saved)</h3>
                  <label className="flex items-center gap-2 text-sm text-neutral-800 mb-2">
                    <input
                      type="checkbox"
                      checked={tuning.warp?.enabled === true}
                      onChange={(e) =>
                        patchTargetTuning({
                          warp: { ...(tuning.warp ?? { enabled: false }), enabled: e.target.checked },
                        })
                      }
                    />
                    Enabled
                  </label>
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-600">Warp strength</span>
                      <input
                        type="number"
                        step={0.01}
                        value={tuning.warp?.warpStrength ?? 0}
                        onChange={(e) =>
                          patchTargetTuning({
                            warp: {
                              ...(tuning.warp ?? { enabled: false }),
                              warpStrength: Number(e.target.value),
                            },
                          })
                        }
                        className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-600">Vertical stretch</span>
                      <input
                        type="number"
                        step={0.01}
                        value={tuning.warp?.verticalStretch ?? 0}
                        onChange={(e) =>
                          patchTargetTuning({
                            warp: {
                              ...(tuning.warp ?? { enabled: false }),
                              verticalStretch: Number(e.target.value),
                            },
                          })
                        }
                        className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-600">Horizontal warp</span>
                      <input
                        type="number"
                        step={0.01}
                        value={tuning.warp?.horizontalWarp ?? 0}
                        onChange={(e) =>
                          patchTargetTuning({
                            warp: {
                              ...(tuning.warp ?? { enabled: false }),
                              horizontalWarp: Number(e.target.value),
                            },
                          })
                        }
                        className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-1">
                    Preview applies a CSS warp approximation (3D + skew). Sharp production may use mesh warp when
                    enabled.
                  </p>
                </div>
                </details>
                ) : null}
                — end of disabled Legacy: Warp block —
                */}
                {/*
                  DISABLED v10 (2026-05-25): Mask (saved) Feather + Edge fade values used
                  to tune a CSS feather effect at compositor time. With v10's hybrid letter
                  mask + Flux Fill inpainting + post-composite blend, the feather is now
                  derived automatically from the design alpha (fixed sigma 4 in oversample
                  space, ~2px native). These knobs save but no longer drive any output.
                  Hidden to declutter the sidebar.
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Mask (saved)</h3>
                  <label className="flex items-center gap-2 text-sm text-neutral-800 mb-2">
                    <input
                      type="checkbox"
                      checked={tuning.mask?.enabled === true}
                      onChange={(e) =>
                        patchTargetTuning({
                          mask: { ...(tuning.mask ?? { enabled: false }), enabled: e.target.checked },
                        })
                      }
                    />
                    Enabled
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-600">Feather</span>
                      <input
                        type="number"
                        step={0.01}
                        value={tuning.mask?.feather ?? 0}
                        onChange={(e) =>
                          patchTargetTuning({
                            mask: {
                              ...(tuning.mask ?? { enabled: false }),
                              feather: Number(e.target.value),
                            },
                          })
                        }
                        className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-600">Edge fade</span>
                      <input
                        type="number"
                        step={0.01}
                        value={tuning.mask?.edgeFade ?? 0}
                        onChange={(e) =>
                          patchTargetTuning({
                            mask: {
                              ...(tuning.mask ?? { enabled: false }),
                              edgeFade: Number(e.target.value),
                            },
                          })
                        }
                        className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-1">
                    These knobs ({"feather"} / {"edge fade"}) tune the soft-edge look applied at compositor time.
                    Use the <strong>MASK</strong> toggle in the preview header to overlay the uploaded
                    {" "}<code className="text-[9px]">rp_blank_masks</code> PNG on the canvas.
                  </p>
                </div>
                — end of disabled Mask (saved) block —
                */}
              </div>
            ) : null}
            {/* —— Diagnostics & resolved-tuning QA (below the sliders) —— */}
            {is8394 && isMasterBlank(blank) && variantId && persistedCellResolution && !persistedCellResolution.qa.colorMatrixCellExisted ? (
              <p
                className="text-[11px] text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug"
                role="status"
              >
                <span className="font-semibold">No color-specific tuning for this cell yet</span> — showing blank
                baseline + legacy variant merge. After you Save,{" "}
                <code className="text-[10px] bg-white/80 px-1 rounded">layerUsed</code> in{" "}
                <code className="text-[10px] bg-white/80 px-1 rounded">[8394 CELL READ]</code> should become{" "}
                <code className="text-[10px] bg-white/80 px-1 rounded">color_matrix</code>.
              </p>
            ) : null}
            {matrixCellInspector8394 ? (
              <div
                className="rounded-md border border-dashed border-amber-400/70 bg-amber-50/70 px-2 py-1.5 text-[10px] text-amber-950 leading-snug"
                title="Firestore read path (no unsaved editor state). Matches console [8394 CELL READ] for this variant × target."
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 font-sans">
                  <span className="font-semibold uppercase tracking-wide text-amber-900/85">Matrix cell (persisted)</span>
                  {process.env.NODE_ENV === "development" ? (
                    <span className="rounded px-1 bg-amber-200/90 text-[9px] font-medium text-amber-950">dev</span>
                  ) : null}
                  {isAdmin ? (
                    <span className="rounded px-1 bg-amber-200/90 text-[9px] font-medium text-amber-950">admin</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 font-mono tabular-nums">
                  <span>
                    <span className="text-amber-800/90">variantId </span>
                    <span className="text-amber-950 break-all">
                      {matrixCellInspector8394.variantId ?? "(blank baseline)"}
                    </span>
                  </span>
                  <span className="text-amber-300/90 select-none" aria-hidden>
                    ·
                  </span>
                  <span>
                    <span className="text-amber-800/90">target </span>
                    <span className="text-amber-950">{matrixCellInspector8394.target}</span>
                  </span>
                  <span className="text-amber-300/90 select-none" aria-hidden>
                    ·
                  </span>
                  <span>
                    <span className="text-amber-800/90">layerUsed </span>
                    <span className="text-amber-950">{matrixCellInspector8394.layerUsed}</span>
                  </span>
                  <span className="text-amber-300/90 select-none" aria-hidden>
                    ·
                  </span>
                  <span>
                    <span className="text-amber-800/90">matrixCell </span>
                    <span className={matrixCellInspector8394.colorMatrixCellExisted ? "text-emerald-800 font-medium" : "text-neutral-500"}>
                      {matrixCellInspector8394.colorMatrixCellExisted ? "yes" : "no"}
                    </span>
                  </span>
                  <span className="text-amber-300/90 select-none" aria-hidden>
                    ·
                  </span>
                  <span>
                    <span className="text-amber-800/90">legacyMerged </span>
                    <span
                      className={
                        matrixCellInspector8394.variantLegacyOverrideMerged
                          ? "text-amber-900 font-medium"
                          : "text-neutral-500"
                      }
                    >
                      {matrixCellInspector8394.variantLegacyOverrideMerged ? "yes" : "no"}
                    </span>
                  </span>
                </div>
              </div>
            ) : null}
            {is8394 ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyBackTargetTuning("flat_back", "model_back")}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-violet-300 bg-white text-violet-900 hover:bg-violet-100/80 font-medium"
                >
                  Copy flat_back → model_back
                </button>
                <button
                  type="button"
                  onClick={() => copyBackTargetTuning("model_back", "flat_back")}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-violet-300 bg-white text-violet-900 hover:bg-violet-100/80 font-medium"
                >
                  Copy model_back → flat_back
                </button>
              </div>
            ) : null}
            {selected && !is8394 ? (
              /*
                Collapsed v10 (2026-05-25): debug-only telemetry showing merged tuning
                values + flags (blank row present, variant override, product placement).
                Useful when answering "did my save persist?" but otherwise takes vertical
                space. Wrapped in <details> so it's one click away when needed.
              */
              <details className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 px-3 py-2 group">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-emerald-900 list-none flex items-center gap-2">
                  <span aria-hidden className="group-open:rotate-90 transition-transform">▸</span>
                  Resolved target tuning (read-only QA)
                </summary>
                <p className="text-[10px] text-emerald-900/85 mt-2 mb-2 leading-snug">
                  Effective values for <strong>{RENDER_TARGET_LABELS[selectedRenderTarget]}</strong> with the preview
                  variant (no product overrides). Matches the compositor merge order for this blank.
                </p>
                <dl className="grid grid-cols-1 gap-1 font-mono text-[10px] text-gray-900">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">placement.x</dt>
                    <dd>{resolvedTargetForEngine.settings.placement.x.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">placement.y</dt>
                    <dd>{resolvedTargetForEngine.settings.placement.y.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">placement.scale</dt>
                    <dd>{resolvedTargetForEngine.settings.placement.scale.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">blend.fabricFeel</dt>
                    <dd>{resolvedTargetForEngine.settings.blend.fabricFeel.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">blend.printStrength</dt>
                    <dd>{resolvedTargetForEngine.settings.blend.printStrength.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">blend.mode</dt>
                    <dd className="text-right break-all">
                      {resolvedTargetForEngine.settings.blend.mode != null &&
                      String(resolvedTargetForEngine.settings.blend.mode).trim() !== ""
                        ? String(resolvedTargetForEngine.settings.blend.mode)
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">engineBlend.blendMode</dt>
                    <dd>{engineBlendResolved.blendMode}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">engineBlend.blendOpacity</dt>
                    <dd>{engineBlendResolved.blendOpacity.toFixed(3)}</dd>
                  </div>
                </dl>
                <p className="text-[9px] text-emerald-900/70 mt-2 pt-2 border-t border-emerald-200/80 font-sans">
                  Flags: blank target row{" "}
                  {resolvedTargetForEngine.qa.blankTuningExisted ? "present" : "absent"} · variant target override{" "}
                  {resolvedTargetForEngine.qa.variantTargetOverrideExisted ? "yes" : "no"} · product placement{" "}
                  {resolvedTargetForEngine.qa.productPlacementApplied ? "applied" : "no"}
                </p>
              </details>
            ) : null}
            </div>
          </section>

          {/*
            DISABLED v10 (2026-05-25): Placement zone (Zone row + Zone row status) was
            relevant when blanks could have multiple `placements[]` rows per side. For
            current-scope blanks (HF07 + the 4 LA Apparel garments at 1 zone per side),
            the Render target dropdown above already picks the right placement row
            implicitly via view (front/back). Zone row status is workflow nicety that
            duplicates the blank-wide "render readiness" status further down.
            Re-enable for multi-zone blanks if/when those appear.
          (Which placements[] row is active (front vs back) — not the same as Render target)
          <section className="space-y-3 pt-2 border-t border-neutral-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Placement zone</h2>
            <p className="text-[11px] text-neutral-500 leading-snug">
              <strong>Render target</strong> above (Flat back, Model back, …) chooses which <em>photo</em> and which saved
              tuning cell. <strong>Placement zone</strong> here chooses which canonical{" "}
              <code className="text-[10px] bg-neutral-100 px-1 rounded">placements[]</code> row (e.g. back vs front) you’re
              editing for safe area, notes, and zone-level status — usually match the side of your render target.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Zone row</label>
                <select
                  value={selectedIndex}
                  onChange={(e) => setSelectedIndex(Number(e.target.value))}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  {rows.map((p, i) => (
                    <option key={p.placementId} value={i}>
                      {p.label} ({p.view === "back" ? "Back" : "Front"}) · {p.placementId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Zone row status</label>
                <select
                  value={selected?.profileStatus ?? "draft"}
                  onChange={(e) => updateSelected({ profileStatus: e.target.value as "draft" | "approved" })}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
                <p className="text-[10px] text-neutral-400 mt-1">Stored on this placement row only — not the blank-wide “render readiness” status.</p>
              </div>
            </div>
          </section>
          */}

          {/*
            DISABLED v10 (2026-05-25): "2. Zone geometry (placements[])" duplicates the
            Placement Tuning sliders above. The two were meant to be:
              - Placement Tuning = per-photo override (target-level)
              - Zone Geometry    = baseline default for the zone (row-level)
            In practice operators only use the per-photo target tuning. Baseline values
            either come from blank seed data or get patched directly via the target
            override path. Hiding to declutter; safe-area visibility checkboxes are
            re-added inline above the canvas if/when needed.
          (2. Zone geometry — non-8394 only; 8394 uses Advanced in Target tuning)
          {!is8394 ? (
          <section className="space-y-4 pt-2 border-t border-neutral-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              2. Zone geometry (placements[])
            </h2>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Saved on the placement row for this zone — safe area and default zone placement. Per-photo x/y/scale overrides
              live under <strong>Target tuning</strong> above.
            </p>
            <div>
              <div className="flex justify-between text-xs text-neutral-600 mb-1">
                <span className="font-medium text-neutral-800">Scale</span>
                <span>{scalePercentFromEngine(scale)}%</span>
              </div>
              <input
                type="range"
                min={SCALE_PCT_MIN}
                max={SCALE_PCT_MAX}
                step={1}
                value={scalePercentFromEngine(scale)}
                onChange={(e) => updateSelected({ defaultScale: scaleEngineFromPercent(Number(e.target.value)) })}
                className="w-full accent-indigo-600"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-neutral-600 mb-1">
                <span className="font-medium text-neutral-800">Horizontal</span>
                <span>{Math.round(px * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(px * 100)}
                onChange={(e) => updateSelected({ defaultX: Number(e.target.value) / 100 })}
                className="w-full accent-indigo-600"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-neutral-600 mb-1">
                <span className="font-medium text-neutral-800">Vertical</span>
                <span>{Math.round(py * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(py * 100)}
                onChange={(e) => updateSelected({ defaultY: Number(e.target.value) / 100 })}
                className="w-full accent-indigo-600"
              />
            </div>
            <p className="text-xs text-neutral-500">
              Drag the design directly on the preview for precise placement.
            </p>
            <label className="flex items-center gap-2 text-sm text-neutral-800">
              <input type="checkbox" checked={showSafeArea} onChange={(e) => setShowSafeArea(e.target.checked)} />
              Show safe print area overlay
            </label>
            {!is8394SimpleBackUi ? (
              <label className="flex items-center gap-2 text-sm text-neutral-800">
                <input type="checkbox" checked={showClipHint} onChange={(e) => setShowClipHint(e.target.checked)} />
                Clip boundary hint
              </label>
            ) : null}
          </section>
          ) : null}
          */}

          {/*
            DISABLED v10 (2026-05-25): "3. Print style" + "4. Print size" preset rows are
            redundant with controls higher up in the sidebar:
              - Print style presets wrote `fabricFeel`/`printStrength` — now controlled
                by the AI realism 3-button pickers (Clean/Textured/Worn × Faded/Vivid/Bold).
              - Print size presets wrote `defaultScale` — now controlled by the Scale
                slider in the Placement Tuning block at the top of the sidebar.
            Both sections were the operator's "quick set" path; the per-target overrides
            above now do the same job with finer (and slider-driven) control. Hiding the
            full <> fragment that wraps both sections.
          {!is8394 ? (
            <>
              (3. Print style)
              <section className="space-y-3 pt-2 border-t border-neutral-100">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">3. Print style</h2>
                {!is8394SimpleBackUi && !hasExplicitZoneBlend ? (
                  <p className="text-xs text-neutral-500">Using blank default — pick a style to set this zone.</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {RENDER_STYLE_PRESET_ORDER.map((id) => {
                    const active =
                      !explicitCustomStyle && hasExplicitZoneBlend && matchedRenderStyleZone === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => applyRenderStylePreset(id)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          active
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white text-neutral-800 border-neutral-200 hover:border-indigo-400"
                        }`}
                      >
                        {RENDER_STYLE_PRESET_LABELS[id]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setExplicitCustomStyle(true);
                      updateSelected({ renderZoneDefaults: zoneCustomSlidersToBlend(50, 72) });
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      customButtonActive
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white text-neutral-800 border-neutral-200 hover:border-indigo-400"
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {showRenderStyleReset ? (
                  <button
                    type="button"
                    onClick={resetRenderStyleToLastPreset}
                    className="text-xs font-medium text-indigo-700 hover:underline"
                  >
                    Reset to last preset
                  </button>
                ) : null}

                {showZoneCustomSliders ? (
                  <div className="grid grid-cols-1 gap-4 pt-2">
                    <div>
                      <label className="block text-sm font-medium text-neutral-800">Fabric feel</label>
                      <p className="text-xs text-neutral-500 mb-1">How much the design blends into fabric</p>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={zoneCustomSliders.fabricFeel}
                        onChange={(e) =>
                          updateSelected({
                            renderZoneDefaults: zoneCustomSlidersToBlend(
                              Number(e.target.value),
                              zoneCustomSliders.printStrength
                            ),
                          })
                        }
                        className="w-full accent-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-800">Print strength</label>
                      <p className="text-xs text-neutral-500 mb-1">Faint → bold print intensity</p>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={zoneCustomSliders.printStrength}
                        onChange={(e) =>
                          updateSelected({
                            renderZoneDefaults: zoneCustomSlidersToBlend(
                              zoneCustomSliders.fabricFeel,
                              Number(e.target.value)
                            ),
                          })
                        }
                        className="w-full accent-indigo-600"
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              (4. Print size)
              <section className="space-y-3 pt-2 border-t border-neutral-100">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">4. Print size</h2>
                <p className="text-xs text-neutral-500">Controls overall visual size relative to garment.</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["small", "Subtle"],
                      ["medium", "Standard"],
                      ["large", "Statement"],
                      ["fill_safe", "Fill safe area"],
                    ] as const
                  ).map(([preset, label]) => {
                    const active = Math.abs(scale - sizePresetToDefaultScale(preset)) < 0.04;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyPrintSizePreset(preset)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          active
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white text-neutral-800 border-neutral-200 hover:border-indigo-300"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
          — end of disabled "3. Print style" + "4. Print size" block —
          */}

          {/*
            Mask section (v10.1, 2026-05-25): hoisted out of the Advanced details below
            to sit prominently above Actions. If a mask doc exists for this blank+view
            (rp_blank_masks/{blankId}_{view}), the picker defaults to "Use uploaded mask"
            — operators no longer need to actively select it for every render.
            The auto-promote treats `mode === "none"` as "unset by default" when a mask
            exists; operators can still explicitly pick None to opt out per zone.
          */}
          {!is8394SimpleBackUi ? (() => {
            const savedMode = selected?.maskConfig?.mode;
            const effectiveMode = currentBlankMaskUrl && (savedMode == null || savedMode === "none")
              ? "blank_mask_doc"
              : (savedMode ?? defaultMaskModeForCurrentView);
            const isAutoDefault = currentBlankMaskUrl && (savedMode == null || savedMode === "none");
            return (
              <section className="space-y-2 pt-2 border-t border-neutral-100">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Mask</h2>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-600">Mask / clip strategy</span>
                  <select
                    value={effectiveMode}
                    onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
                    className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                  >
                    <option value="none">None — no clipping</option>
                    <option value="blank_mask_doc">Use uploaded mask (rp_blank_masks)</option>
                    <option value="safe_area_clip" disabled>
                      Clip to safe area (not implemented)
                    </option>
                  </select>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] mt-1">
                    {currentBlankMaskDoc && currentBlankMaskUrl ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 font-medium">
                        Mask uploaded
                        {currentBlankMaskDoc.mask?.width && currentBlankMaskDoc.mask?.height
                          ? ` · ${currentBlankMaskDoc.mask.width}×${currentBlankMaskDoc.mask.height}`
                          : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-700">
                        No mask uploaded for {previewSide}
                      </span>
                    )}
                    {isAutoDefault ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-900 font-medium">
                        Auto-default
                      </span>
                    ) : null}
                    {onManageMasks ? (
                      <button
                        type="button"
                        onClick={() => onManageMasks(previewSide)}
                        className="text-indigo-700 hover:underline font-medium"
                      >
                        Manage masks →
                      </button>
                    ) : null}
                  </div>
                  {/**
                   * Generate AI mask for the CURRENT render target. For flat targets
                   * (flat_front / flat_back) this writes to the shared blank mask
                   * `{blankId}_{view}`. For model targets it writes a per-variant
                   * mask `{blankId}_{variantId}_model_<view>` — exactly what Flux
                   * Fill on model shots will read in Phase 2.
                   *
                   * Disabled when the editor is in "blank baseline" mode and the
                   * target is a model_* surface, because model masks are inherently
                   * per-variant and don't make sense without a selected color.
                   */}
                  {onGenerateAiMask ? (() => {
                    const isModelTarget =
                      selectedRenderTarget === "model_front" ||
                      selectedRenderTarget === "model_back";
                    /**
                     * `variantId` is the editor's state (empty string when "blank baseline"
                     * is selected; a real variant id when a specific color is). Model masks
                     * require a real variant id since each color's model photo has its own
                     * silhouette.
                     */
                    const variantIdForCall = variantId && variantId.trim() ? variantId : null;
                    const canGenerate = !isModelTarget || !!variantIdForCall;
                    const targetLabel = String(selectedRenderTarget).replace("_", " ");
                    const generating = aiMaskGeneratingForView === previewSide;
                    return (
                      <div className="mt-2">
                        <button
                          type="button"
                          disabled={!canGenerate || generating}
                          onClick={() =>
                            onGenerateAiMask(previewSide, {
                              renderTarget:
                                selectedRenderTarget === "flat_front" ||
                                selectedRenderTarget === "flat_back" ||
                                selectedRenderTarget === "model_front" ||
                                selectedRenderTarget === "model_back"
                                  ? (selectedRenderTarget as
                                      | "flat_front"
                                      | "flat_back"
                                      | "model_front"
                                      | "model_back")
                                  : `flat_${previewSide}`,
                              variantId: isModelTarget ? variantIdForCall : null,
                            })
                          }
                          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
                          title={
                            isModelTarget && !variantIdForCall
                              ? "Pick a specific color/variant first — model masks are per-pose"
                              : `Use AI (SAM) to segment the print area on the ${targetLabel} photo. ~5-10s.`
                          }
                        >
                          {generating ? "Generating mask…" : `✨ Generate AI mask for ${targetLabel}`}
                        </button>
                        {isModelTarget && !variantIdForCall ? (
                          <p className="text-[10px] text-neutral-500 mt-1">
                            Switch to a specific color to enable — model masks are tied to one pose.
                          </p>
                        ) : null}
                      </div>
                    );
                  })() : null}
                </label>
              </section>
            );
          })() : null}

          {/* 5. Actions */}
          <section className="space-y-3 pt-2 border-t border-neutral-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">5. Actions</h2>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
              >
                {saving ? "Saving…" : "Save render profile"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-5 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200"
              >
                Reset
              </button>
            </div>
            {saveScopeLabel ? (
              <p className="text-[11px] font-medium text-indigo-800 bg-indigo-50/80 border border-indigo-100 rounded-md px-2 py-1.5 inline-block">
                {saveScopeLabel}
              </p>
            ) : null}
            {is8394 ? (
              <p className="text-[11px] text-neutral-600 leading-snug max-w-xl">
                {perColorSaveScope ? (
                  <>
                    For 8394, your edits apply to the render target you’re viewing. Save stores placement and tuning as
                    overrides for <strong>this garment color only</strong> (other colors keep their own overrides or the
                    blank baseline).
                  </>
                ) : (
                  <>
                    For 8394, your edits apply to whichever target you’re viewing, and when you save we also store flat
                    front and flat back on the blank so existing tools keep working.
                  </>
                )}
              </p>
            ) : null}
            <p className="text-xs text-neutral-500 leading-relaxed">
              {perColorSaveScope ? (
                <>
                  Saving writes placement and scale overrides for <strong>the selected color variant</strong> only. Choose{" "}
                  <strong>Blank baseline (all colors)</strong> above to edit defaults shared by every color.{" "}
                  <span className="text-neutral-600">
                    The <strong>Blank render readiness</strong> section below (Approved / Sides / Notes) autosaves
                    separately — it applies to the whole blank, not this color.
                  </span>
                </>
              ) : (
                <>
                  Saving updates the default placement for <strong>all products</strong> using this blank (all colors
                  unless they have their own color overrides).{" "}
                  <span className="text-neutral-600">
                    The <strong>Blank render readiness</strong> section below autosaves separately on change.
                  </span>
                </>
              )}
            </p>
          </section>

          {/* Blank-level gates (compact). Autosaves on change — see autosave effect above. */}
          <section className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-900">Blank render readiness</h3>
              {blankAutosaveState === "saving" ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-neutral-400 animate-pulse" aria-hidden />
                  Saving…
                </span>
              ) : blankAutosaveState === "saved" ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <span aria-hidden>✓</span>
                  Saved
                </span>
              ) : blankAutosaveState === "error" ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700"
                  title={blankAutosaveErrorRef.current ?? "Autosave failed — use Save render profile to persist."}
                >
                  <span aria-hidden>⚠</span>
                  Autosave failed
                </span>
              ) : (
                <span className="text-[11px] font-medium text-neutral-400">Autosaves on change</span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Overall status</label>
                <select
                  value={renderProfileStatus}
                  onChange={(e) => setRenderProfileStatus(e.target.value as "draft" | "approved")}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  <option value="draft">Draft — still tuning</option>
                  <option value="approved">Approved — OK for generation</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-3 items-center text-sm text-neutral-800">
                <span className="text-xs font-medium text-neutral-600">Supported sides</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={supportedFront} onChange={(e) => setSupportedFront(e.target.checked)} />
                  Front
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={supportedBack} onChange={(e) => setSupportedBack(e.target.checked)} />
                  Back
                </label>
              </div>
            </div>
            {is8394 ? (
              <p className="text-[11px] text-neutral-600 leading-snug max-w-xl">
                <span className="font-medium text-neutral-800">Print sides</span> control design overlay and back
                compositing. Clean front display images (flat/model) still export when sources exist, even if Front is
                unchecked.
              </p>
            ) : null}
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Blank notes (ops / handoff)</label>
              <textarea
                value={renderProfileNotes}
                onChange={(e) => setRenderProfileNotes(e.target.value)}
                rows={2}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900 placeholder:text-neutral-400"
                placeholder="e.g. Panty = back print only"
              />
            </div>
            {is8394 ? (
              <div className="pt-2 border-t border-neutral-200/80 space-y-2">
                <p className="text-xs font-semibold text-neutral-800">Preferred flat reference (8394 / QA)</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-neutral-800">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="preferredFlat8394"
                      checked={preferredFlatLook8394 === ""}
                      onChange={() => setPreferredFlatLook8394("")}
                    />
                    No preference
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="preferredFlat8394"
                      checked={preferredFlatLook8394 === "flat_clean"}
                      onChange={() => setPreferredFlatLook8394("flat_clean")}
                    />
                    Natural (flat_clean)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="preferredFlat8394"
                      checked={preferredFlatLook8394 === "flat_blended"}
                      onChange={() => setPreferredFlatLook8394("flat_blended")}
                    />
                    Fabric blend (flat_blended)
                  </label>
                </div>
              </div>
            ) : null}
          </section>

          {/*
            DISABLED v10.1 (2026-05-25): the "Advanced — numeric & mask metadata"
            collapsible held a grab-bag of fields that are now either:
              - Already exposed cleanly higher up (Mask / clip strategy → Mask section
                above 5. Actions; sliders → AI realism pickers; placement → Placement
                tuning sliders).
              - Wrote dead data that's no longer read by the v10 pipeline
                (blend.mode select, design asset mode, artboard/zone notes, etc.).
            Hiding to declutter; restore behind an admin flag if anyone needs the
            raw numeric editing surface for debugging.
          {!is8394 ? (
          <details className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
            <summary className="cursor-pointer font-medium text-neutral-800">Advanced — numeric &amp; mask metadata</summary>
            <p className="text-neutral-500 text-xs mt-2 mb-3">
              Primary editing is visual above. These fields map 1:1 to Firestore on the placement row.
            </p>
            {!is8394SimpleBackUi && (
              <div className="mb-4 p-3 rounded-lg border border-neutral-200 bg-white space-y-2">
                <p className="text-xs font-semibold text-neutral-800">Blend details (optional)</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value={zoneBlendMode || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) updateSelected({ renderZoneDefaults: null });
                      else
                        updateSelected({
                          renderZoneDefaults: {
                            blendMode: v,
                            blendOpacity: zoneBlendOpacity ?? zoneBlend.blendOpacity,
                          },
                        });
                    }}
                    className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white text-neutral-900"
                  >
                    <option value="">Inherit blank default</option>
                    {BLEND_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <label className="text-xs text-neutral-800 flex items-center gap-2">
                    Blend strength
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={zoneBlendOpacity ?? zoneBlend.blendOpacity}
                      onChange={(e) =>
                        updateSelected({
                          renderZoneDefaults: {
                            blendMode: zoneBlendMode || zoneBlend.blendMode || null,
                            blendOpacity: Number(e.target.value),
                          },
                        })
                      }
                      className="w-28"
                    />
                  </label>
                </div>
              </div>
            )}
            {is8394SimpleBackUi && (
              <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-3">
                8394 back uses simple controls above. Safe area still applies automatically.
              </p>
            )}
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${is8394SimpleBackUi ? "opacity-50 pointer-events-none" : ""}`}>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Center X</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={px}
                  onChange={(e) => updateSelected({ defaultX: Number(e.target.value) })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Center Y</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={py}
                  onChange={(e) => updateSelected({ defaultY: Number(e.target.value) })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Scale (engine)</span>
                <input
                  type="number"
                  step={0.01}
                  min={0.05}
                  max={2}
                  value={scale}
                  onChange={(e) => updateSelected({ defaultScale: Number(e.target.value) })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Artboard base</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.1}
                  max={1}
                  value={artBase}
                  onChange={(e) => updateSelected({ artboardBase: Number(e.target.value) })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
            </div>
            <p className="text-[10px] text-neutral-500 mt-3">
              Artboard: {DESIGN_ARTBOARD_WIDTH_PX}×{DESIGN_ARTBOARD_HEIGHT_PX}px (8∶5). Safe overlay uses Safe W.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe X</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sx}
                  onChange={(e) => updateSelected({ safeArea: { x: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe Y</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sy}
                  onChange={(e) => updateSelected({ safeArea: { y: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe W</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sw}
                  onChange={(e) => updateSelected({ safeArea: { w: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe H</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sh}
                  onChange={(e) => updateSelected({ safeArea: { h: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Zone label</span>
                <input
                  value={selected?.label ?? ""}
                  onChange={(e) => updateSelected({ label: e.target.value })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Canonical view</span>
                <select
                  value={selected?.view ?? "front"}
                  onChange={(e) => updateSelected({ view: e.target.value as "front" | "back" })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                >
                  <option value="front">Front</option>
                  <option value="back">Back</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Design asset mode</span>
                <select
                  value={selected?.allowedDesignAssetMode ?? "light_dark"}
                  onChange={(e) =>
                    updateSelected({
                      allowedDesignAssetMode: e.target.value as RPPlacement["allowedDesignAssetMode"],
                    })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                >
                  <option value="light_dark">Light + dark PNG</option>
                  <option value="light_only">Light PNG only</option>
                  <option value="dark_only">Dark PNG only</option>
                </select>
              </label>
              {!is8394SimpleBackUi && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-600">Mask / clip strategy</span>
                  <select
                    value={selected?.maskConfig?.mode ?? defaultMaskModeForCurrentView}
                    onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                  >
                    <option value="none">None — no clipping</option>
                    <option value="blank_mask_doc">Use uploaded mask (rp_blank_masks)</option>
                    <option value="safe_area_clip" disabled>
                      Clip to safe area (not implemented)
                    </option>
                  </select>
                  (Status + Manage masks link for the side this zone affects.)
                  <div className="flex flex-wrap items-center gap-2 text-[11px] mt-0.5">
                    {currentBlankMaskDoc && currentBlankMaskUrl ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 font-medium">
                        Mask uploaded
                        {currentBlankMaskDoc.mask?.width && currentBlankMaskDoc.mask?.height
                          ? ` · ${currentBlankMaskDoc.mask.width}×${currentBlankMaskDoc.mask.height}`
                          : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-700">
                        No mask uploaded for {previewSide}
                      </span>
                    )}
                    {onManageMasks ? (
                      <button
                        type="button"
                        onClick={() => onManageMasks(previewSide)}
                        className="text-indigo-700 hover:underline font-medium"
                      >
                        Manage masks →
                      </button>
                    ) : null}
                  </div>
                </label>
              )}
            </div>
            <label className="flex flex-col gap-1 mt-3">
              <span className="text-xs text-neutral-600">Artboard / export notes</span>
              <textarea
                value={selected?.artboardNotes ?? ""}
                onChange={(e) => updateSelected({ artboardNotes: e.target.value })}
                rows={2}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-1 mt-2">
              <span className="text-xs text-neutral-600">Zone notes</span>
              <textarea
                value={selected?.notes ?? ""}
                onChange={(e) => updateSelected({ notes: e.target.value })}
                rows={2}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
              />
            </label>
          </details>
          ) : null}
          — end of disabled Advanced details block —
          */}
        </aside>

        {/* —— C: Preview (~60%) —— sticky on desktop so controls can scroll on the page */}
        <div ref={preview8394ColumnRef} className="flex-1 min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-600">
              {previewDesignLabel ? (
                <span>
                  Preview: <span className="font-medium text-neutral-900">{previewDesignLabel}</span>
                </span>
              ) : (
                <span className="text-neutral-500">No design selected</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Cleaned up v10.2 (2026-05-25): collapsed preview header to just
                "+ AI realism" (the only button operators actually need) plus a
                small "Enlarge garment" text link. Hidden buttons:
                  - VIEW Clean/Blended/Side-by-side: CSS canvas already shows Blended
                    by default; Clean = view minus design (rare); Side-by-side
                    duplicates the AI realism result pane.
                  - MASK Off/Outline/Filled: debug visualization of rp_blank_masks
                    on the canvas. With auto-default mask application (v10.1), the
                    mask is always used — visualizing it is dev/QA only.
                  - Generate AI mask: one-time setup per blank+view. Lives behind
                    "Manage masks →" in the new Mask section above 5. Actions.
                  - Render preview (Stage A): redundant since AI realism runs
                    Stage A internally before Stage B. Operators iterating on
                    placement use the live CSS canvas (instant) instead.
              */}
              {previewGarmentUrl ? (
                <button
                  type="button"
                  onClick={() => setPreviewLightbox(true)}
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  Enlarge garment
                </button>
              ) : null}
              {AI_REALISM_PREVIEW_ENABLED ? (
                <button
                  type="button"
                  onClick={() => handleRealRenderPreview({ withRealism: true })}
                  disabled={realPreviewLoading !== null || !previewDesignId}
                  className="ml-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  title="Stage A composite + fal.ai Flux Fill inpaint pass with auto-applied mask. Takes 20-60s and costs $ per call."
                >
                  {realPreviewLoading === "B" ? "Generating product preview… (~30s)" : "✨ Product Preview"}
                </button>
              ) : null}
            </div>
            {/*
              DISABLED v10.2 (2026-05-25): original preview header button row.
              Kept as commented reference so we can restore individual controls
              (e.g. Render preview for cheap Stage-A-only iteration, or MASK
              overlay for debugging) without retyping the JSX. To restore one
              button, paste its block back into the live <div> above.
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">View</span>
                (View buttons: Clean / Blended / Side-by-side mapped through previewMode state)
                (MASK overlay buttons: Off / Outline / Filled mapped through blankMaskOverlayMode state)
                (Generate AI mask button: triggers onGenerateAiMask(previewSide))
                (Render preview button: triggers handleRealRenderPreview() — Stage A only)
              </div>
            */}
            {is8394SimpleBackUi && previewSideAllowsPrinting ? (
              <p className="text-[10px] text-neutral-400 mt-1 max-w-lg">
                Blended preview uses garment × artwork-aware blend (normal / screen where multiply would hide ink on dark
                fabric or white/light art). Sharp output may differ slightly.
                {zoneBlendFor8394BlendedPreview.previewAdjusted ? (
                  <span className="text-neutral-500"> Adjusted for this combo.</span>
                ) : null}
              </p>
            ) : null}
          </div>

          {is8394 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-800">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-neutral-300"
                  checked={pixelAccurate8394Preview}
                  onChange={(e) => setPixelAccurate8394Preview(e.target.checked)}
                />
                <span>Natural-pixel canvas (official placement basis)</span>
              </label>
              <button
                type="button"
                onClick={() => void run8394CoordinateAudit()}
                className="px-2.5 py-1 rounded-md border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 font-medium text-neutral-900"
              >
                Log coordinate audit (flat_back vs model_back)
              </button>
            </div>
          ) : null}

          {/* NATURAL PREVIEW — STRICT TELEMETRY PANEL HIDDEN — flip `STRICT_TELEMETRY_ENABLED` to `true` below to re-enable. */}
          {(() => {
            const STRICT_TELEMETRY_ENABLED = false;
            if (!STRICT_TELEMETRY_ENABLED || !is8394 || !preview8394Parity) return null;
            return (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50/95 px-3 py-2 text-[11px] text-emerald-950 space-y-2"
              role="region"
              aria-label="8394 preview strict parity"
            >
              <p className="font-sans font-semibold text-emerald-900 text-xs">Natural preview — strict telemetry</p>
              <div className="font-mono tabular-nums leading-relaxed text-emerald-950/95 text-[10px] space-y-0.5">
                <p>
                  <span className="text-emerald-700">garmentNaturalPx </span>
                  {preview8394Parity.garmentNaturalPx.w}×{preview8394Parity.garmentNaturalPx.h}
                  <span className="text-emerald-700"> · designNaturalPx </span>
                  {preview8394Parity.designNaturalPx.w}×{preview8394Parity.designNaturalPx.h}
                </p>
                <p>
                  <span className="text-emerald-700">alphaCropRectPx </span>
                  {preview8394Parity.alphaCropRectPx.x},{preview8394Parity.alphaCropRectPx.y} +{" "}
                  {preview8394Parity.alphaCropRectPx.w}×{preview8394Parity.alphaCropRectPx.h}
                </p>
                <p>
                  <span className="text-emerald-700">preWarpSlotRectPx </span>
                  {preview8394Parity.preWarpSlotRectPx.x},{preview8394Parity.preWarpSlotRectPx.y} ·{" "}
                  {preview8394Parity.preWarpSlotRectPx.w}×{preview8394Parity.preWarpSlotRectPx.h}
                </p>
                <p>
                  <span className="text-emerald-700">resizedBeforeWarp </span>
                  {preview8394Parity.resizedBitmapBeforeWarpPx.w}×{preview8394Parity.resizedBitmapBeforeWarpPx.h}
                  <span className="text-emerald-700"> · afterWarpMask </span>
                  {preview8394Parity.bitmapDimensionsAfterWarpMaskPx.w}×
                  {preview8394Parity.bitmapDimensionsAfterWarpMaskPx.h}
                </p>
                <p>
                  <span className="text-emerald-700">postEffect WxH </span>
                  clean {preview8394Parity.postEffectBitmapDimensionsPx.clean.w}×
                  {preview8394Parity.postEffectBitmapDimensionsPx.clean.h} · blended{" "}
                  {preview8394Parity.postEffectBitmapDimensionsPx.blended.w}×
                  {preview8394Parity.postEffectBitmapDimensionsPx.blended.h}
                </p>
                <p>
                  <span className="text-emerald-700">finalCompositeTopLeftPx </span>
                  {preview8394Parity.compositeKind === "blended"
                    ? `${preview8394Parity.finalCompositeTopLeftPx.blended.x},${preview8394Parity.finalCompositeTopLeftPx.blended.y}`
                    : `${preview8394Parity.finalCompositeTopLeftPx.clean.x},${preview8394Parity.finalCompositeTopLeftPx.clean.y}`}
                  <span className="text-emerald-700"> · displayedTL </span>
                  {preview8394Parity.displayedFinalCompositeTopLeftPx
                    ? `${preview8394Parity.displayedFinalCompositeTopLeftPx.x.toFixed(1)},${preview8394Parity.displayedFinalCompositeTopLeftPx.y.toFixed(1)}`
                    : "—"}
                </p>
                <p>
                  <span className="text-emerald-700">composite </span>
                  {preview8394Parity.compositeKind}
                  <span className="text-emerald-700"> · blend </span>
                  {preview8394Parity.blendModeEffective}
                  <span className="text-emerald-700"> · opacity </span>
                  {preview8394Parity.effectiveOpacityOnRaster.toFixed(4)} (in×{preview8394Parity.designOpacityMultiplier.toFixed(3)})
                </p>
                <p>
                  <span className="text-emerald-700">filter </span>
                  {preview8394Parity.canvasFilterApplied === "none" ? "none" : preview8394Parity.canvasFilterApplied}
                </p>
                <p className="text-emerald-800/85">
                  {preview8394Parity.renderTarget} · warp {preview8394Parity.warpEnabledEffective ? "on" : "off"} · mask{" "}
                  {preview8394Parity.maskEnabledEffective ? "on" : "off"} · Logs:{" "}
                  <code className="text-[9px]">[PREVIEW8394_STRICT_PARITY]</code>{" "}
                  <code className="text-[9px]">NEXT_PUBLIC_DEBUG_8394_STRICT_PARITY=1</code>
                </p>
              </div>

              <div className="border-t border-emerald-200/80 pt-2 space-y-1.5">
                <p className="font-sans font-semibold text-emerald-900 text-xs">
                  Natural preview vs official final parity
                </p>
                <label className="block text-[10px] text-emerald-800 font-sans">
                  Paste one <code className="text-[9px]">[OFFICIAL8394_STRICT_PARITY]</code> JSON object from Cloud
                  Logs (deploy with <code className="text-[9px]">OFFICIAL8394_STRICT_PARITY=1</code>)
                </label>
                <textarea
                  value={official8394StrictPaste}
                  onChange={(e) => setOfficial8394StrictPaste(e.target.value)}
                  rows={3}
                  placeholder='{"kind":"official","renderTarget":"flat_back",...}'
                  className="w-full text-[10px] font-mono rounded border border-emerald-300 bg-white px-2 py-1.5 text-neutral-900 placeholder:text-neutral-400"
                />
                {strictTargetMismatch ? (
                  <p className="text-[10px] text-amber-800 font-sans">
                    Render target mismatch: preview {preview8394StrictSnapshot?.renderTarget} vs pasted{" "}
                    {official8394Parsed?.renderTarget}
                  </p>
                ) : null}
                {strictPipelineMismatch ? (
                  <p className="text-[10px] text-amber-800 font-sans">
                    Pipeline mode mismatch: preview {preview8394StrictSnapshot?.compositeKind} vs official{" "}
                    {official8394Parsed?.renderPipelineMode} — paste the log from the same clean/blended pass.
                  </p>
                ) : null}
                {strict8394ParityCompare ? (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] font-sans">
                    {(
                      [
                        ["Placement TL + size", strict8394ParityCompare.placementParity],
                        ["Bitmap WxH (layer)", strict8394ParityCompare.bitmapSizeParity],
                        ["Alpha crop rect", strict8394ParityCompare.cropParity],
                        ["Blend mode", strict8394ParityCompare.blendParity],
                        ["Opacity / treatment", strict8394ParityCompare.treatmentParity],
                      ] as const
                    ).map(([label, ok]) => (
                      <li
                        key={label}
                        className={`flex items-center justify-between gap-2 rounded px-2 py-1 border ${
                          ok ? "border-emerald-300 bg-emerald-100/50 text-emerald-950" : "border-red-300 bg-red-50 text-red-950"
                        }`}
                      >
                        <span>{label}</span>
                        <span className="font-semibold">{ok ? "match" : "diff"}</span>
                      </li>
                    ))}
                  </ul>
                ) : official8394StrictPaste.trim() ? (
                  <p className="text-[10px] text-red-700 font-sans">Could not parse official JSON.</p>
                ) : (
                  <p className="text-[10px] text-emerald-800/80 font-sans">Paste official JSON to compare.</p>
                )}
                {strict8394ParityCompare && !strict8394ParityCompare.placementParity && strict8394ParityCompare.details.placementDeltaPx ? (
                  <p className="text-[9px] font-mono text-neutral-700">
                    Δ placement px: {strict8394ParityCompare.details.placementDeltaPx.x.toFixed(2)},{" "}
                    {strict8394ParityCompare.details.placementDeltaPx.y.toFixed(2)}
                  </p>
                ) : null}
                {strict8394ParityCompare?.likelyCanvasVsSharpRenderingOnly ? (
                  <p className="text-[9px] text-amber-900 font-sans bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    Likely warp/mask or post-treatment size shift on Sharp — not a coordinate-basis bug. See preview{" "}
                    <code className="text-[9px]">notes</code> in console.
                  </p>
                ) : null}
              </div>
            </div>
            );
          })()}

          {is8394 ? (
            <div
              className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border border-neutral-200/90 bg-neutral-50/95 px-2.5 py-1 text-[10px] text-neutral-800 leading-tight"
              role="status"
              aria-label="Preview realism QA"
              title="Blended preview: mix-blend mode, final overlay opacity (after ink), CSS contrast & saturate, warp and soft-edge mask."
            >
              <span className="font-sans font-semibold uppercase tracking-wide text-neutral-500 shrink-0">
                Preview realism QA
              </span>
              <span className="hidden sm:inline text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono tabular-nums">
                <span className="text-neutral-500">blend </span>
                <span className="text-neutral-900">
                  {previewQa8394?.previewResolvedBlendMode ?? "—"}
                </span>
              </span>
              <span className="text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono tabular-nums">
                <span className="text-neutral-500">opacity </span>
                <span className="text-neutral-900">
                  {previewQa8394 != null ? previewQa8394.finalOverlayOpacity.toFixed(3) : "—"}
                </span>
              </span>
              <span className="text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono tabular-nums">
                <span className="text-neutral-500">ctr </span>
                <span className="text-neutral-900">
                  {previewQa8394 != null ? `${previewQa8394.contrastPercent}%` : "—"}
                </span>
              </span>
              <span className="text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono tabular-nums">
                <span className="text-neutral-500">sat </span>
                <span className="text-neutral-900">
                  {previewQa8394 != null ? `${previewQa8394.saturatePercent}%` : "—"}
                </span>
              </span>
              <span className="text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono">
                <span className="text-neutral-500">warp </span>
                {previewQa8394 != null ? (
                  <span
                    className={
                      previewQa8394.warpEnabled
                        ? "text-emerald-800 font-medium"
                        : "text-neutral-400 font-medium"
                    }
                  >
                    {previewQa8394.warpEnabled ? "on" : "off"}
                  </span>
                ) : (
                  <span className="text-neutral-900">—</span>
                )}
              </span>
              <span className="text-neutral-300 select-none" aria-hidden>
                ·
              </span>
              <span className="font-mono">
                <span className="text-neutral-500">mask </span>
                {previewQa8394 != null ? (
                  <span
                    className={
                      previewQa8394.maskEnabled
                        ? "text-emerald-800 font-medium"
                        : "text-neutral-400 font-medium"
                    }
                  >
                    {previewQa8394.maskEnabled ? "on" : "off"}
                  </span>
                ) : (
                  <span className="text-neutral-900">—</span>
                )}
              </span>
            </div>
          ) : null}

          {previewGarmentUrl && !previewSideAllowsPrinting ? (
            <p
              className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug"
              role="status"
            >
              {previewSide === "front"
                ? "Front design overlay off — preview shows the garment only (no artwork). Clean front display images still generate when sources exist."
                : "Back design overlay off — preview shows the garment only. Designed back outputs are skipped when back printing is disabled."}
            </p>
          ) : null}

          {!previewGarmentUrl ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-amber-950 text-sm min-h-[320px] flex items-center justify-center text-center">
              <div>
                <p className="font-medium">No image for {RENDER_TARGET_LABELS[selectedRenderTarget]}</p>
                <p className="text-amber-800/90 mt-1">
                  {isMasterBlank(blank) ? "Upload the matching slot on the Variants tab." : "Upload on the Images tab."}{" "}
                  You can still edit target tuning and zone geometry; save when ready.
                </p>
              </div>
            </div>
          ) : !previewDesignId ? (
            <div className="relative rounded-xl border border-neutral-200 bg-neutral-50 min-h-[min(72vh,640px)] flex items-center justify-center p-8">
              <GarmentPreviewCanvas
                garmentUrl={previewGarmentUrl}
                side={previewSide}
                imgRef={imgRef}
                showSafeArea={showSafeAreaOnCanvas}
                showClipHint={showClipHint}
                sx={sx}
                sy={sy}
                sw={sw}
                sh={sh}
                px={px}
                py={py}
                artBase={artBase}
                printZoneWidthFraction={!is8394 ? selected?.safeArea?.w ?? null : null}
                scale={scale}
                overlayOpacity={0}
                overlayMixBlendMode="normal"
                overlayArtUrl=""
                onPointerDownOverlay={handlePointerDownOverlay}
                maxHeightClass="max-h-[min(72vh,720px)]"
                pixelFaithful8394={is8394 && pixelAccurate8394Preview}
                blankMaskUrl={currentBlankMaskUrl}
                blankMaskOverlayMode={blankMaskOverlayMode}
                {...(is8394 && tuning
                  ? {
                      renderTarget8394: selectedRenderTarget,
                      blendMode8394: zoneBlendFor8394BlendedPreview.blendMode,
                      blendOpacity8394: zoneBlendFor8394BlendedPreview.blendOpacity,
                      designOpacityMultiplier8394: designTreatment8394.designOpacityMultiplier,
                      canvasFilter8394: "none",
                      warpEnabled8394: tuning.warp?.enabled === true,
                      maskEnabled8394: tuning.mask?.enabled === true,
                      composite8394Kind: "clean",
                    }
                  : {})}
                emptyOverlay={
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-6">
                    <p className="text-sm font-medium text-neutral-600 bg-white/90 border border-neutral-200 rounded-lg px-4 py-3 shadow-sm text-center">
                      Select a design to begin positioning
                    </p>
                  </div>
                }
              />
            </div>
          ) : missingArtForActiveSide ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-sm text-amber-950 min-h-[320px] flex items-center justify-center text-center">
              This design has no usable PNG for the selected artwork mode. Try the other variant or pick another design.
            </div>
          ) : previewMode === "compare" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(
                [
                  { label: "Clean", blended: false },
                  { label: "Blended", blended: true },
                ] as const
              ).map(({ label, blended }) => (
                <div key={label} className="space-y-2">
                  <p className="text-xs font-semibold text-center text-neutral-700">{label}</p>
                  <GarmentPreviewCanvas
                    garmentUrl={previewGarmentUrl}
                    side={previewSide}
                    imgRef={label === "Blended" ? imgRef : undefined}
                    showSafeArea={showSafeAreaOnCanvas}
                    showClipHint={showClipHint}
                    sx={sx}
                    sy={sy}
                    sw={sw}
                    sh={sh}
                    px={px}
                    py={py}
                    artBase={artBase}
                    printZoneWidthFraction={!is8394 ? selected?.safeArea?.w ?? null : null}
                    scale={scale}
                    overlayOpacity={blended ? previewOpacity : 1}
                    overlayMixBlendMode={
                      blended
                        ? (cssMixBlendMode(blendModeForBlendedCanvas) as CSSProperties["mixBlendMode"])
                        : "normal"
                    }
                    overlayFilter={blended && is8394 && tuning ? previewFilter : undefined}
                    overlayImgClassName={
                      blended && is8394SimpleBackUi ? sharpBlended8394OverlayImgClass : undefined
                    }
                    overlayWarpTransform={canvas8394Warp}
                    overlayMaskStyle={canvas8394Mask}
                    overlayArtUrl={effectiveOverlayArtUrl}
                    onPointerDownOverlay={handlePointerDownOverlay}
                    maxHeightClass="max-h-[min(48vh,440px)]"
                    pixelFaithful8394={is8394 && pixelAccurate8394Preview}
                    blankMaskUrl={currentBlankMaskUrl}
                    blankMaskOverlayMode={blankMaskOverlayMode}
                    {...(is8394 && tuning
                      ? {
                          renderTarget8394: selectedRenderTarget,
                          blendMode8394: zoneBlendFor8394BlendedPreview.blendMode,
                          blendOpacity8394: zoneBlendFor8394BlendedPreview.blendOpacity,
                          designOpacityMultiplier8394: designTreatment8394.designOpacityMultiplier,
                          canvasFilter8394: blended ? previewFilter : "none",
                          warpEnabled8394: tuning.warp?.enabled === true,
                          maskEnabled8394: tuning.mask?.enabled === true,
                          composite8394Kind: blended ? ("blended" as const) : ("clean" as const),
                          on8394ParityTelemetry: blended ? setPreview8394Parity : undefined,
                        }
                      : {})}
                  />
                </div>
              ))}
            </div>
          ) : (
            <GarmentPreviewCanvas
              garmentUrl={previewGarmentUrl}
              side={previewSide}
              imgRef={imgRef}
              showSafeArea={showSafeAreaOnCanvas}
              showClipHint={showClipHint}
              sx={sx}
              sy={sy}
              sw={sw}
              sh={sh}
              px={px}
              py={py}
              artBase={artBase}
              printZoneWidthFraction={!is8394 ? selected?.safeArea?.w ?? null : null}
              scale={scale}
              overlayOpacity={canvasOpacity}
              overlayMixBlendMode={canvasMixBlend}
              overlayFilter={canvasFilter}
              overlayImgClassName={
                useBlendedCanvas && is8394SimpleBackUi ? sharpBlended8394OverlayImgClass : undefined
              }
              overlayWarpTransform={canvas8394Warp}
              overlayMaskStyle={canvas8394Mask}
              overlayArtUrl={effectiveOverlayArtUrl}
              onPointerDownOverlay={handlePointerDownOverlay}
              maxHeightClass="max-h-[min(72vh,720px)]"
              pixelFaithful8394={is8394 && pixelAccurate8394Preview}
              blankMaskUrl={currentBlankMaskUrl}
              blankMaskOverlayMode={blankMaskOverlayMode}
              {...(is8394 && tuning
                ? {
                    renderTarget8394: selectedRenderTarget,
                    blendMode8394: zoneBlendFor8394BlendedPreview.blendMode,
                    blendOpacity8394: zoneBlendFor8394BlendedPreview.blendOpacity,
                    designOpacityMultiplier8394: designTreatment8394.designOpacityMultiplier,
                    canvasFilter8394: useBlendedCanvas ? previewFilter : "none",
                    warpEnabled8394: tuning.warp?.enabled === true,
                    maskEnabled8394: tuning.mask?.enabled === true,
                    composite8394Kind: useBlendedCanvas ? ("blended" as const) : ("clean" as const),
                    on8394ParityTelemetry: setPreview8394Parity,
                  }
                : {})}
            />
          )}
        </div>
      </div>

      {/* Real Sharp-composite result. Sits below the CSS canvas so the operator can compare. */}
      {realPreviewError ? (
        <div className="mt-4 p-3 border border-red-200 bg-red-50 rounded-lg text-sm text-red-800">
          <strong>Render preview error:</strong> {realPreviewError}
          <button
            onClick={() => setRealPreviewError(null)}
            className="ml-3 text-red-700 underline text-xs hover:no-underline"
          >
            dismiss
          </button>
        </div>
      ) : null}
      {realPreview ? (
        <div className={`mt-4 border rounded-lg overflow-hidden ${realPreview.stage === "B" ? "border-purple-300 bg-purple-50" : "border-indigo-200 bg-indigo-50"}`}>
          <div className={`px-4 py-2 border-b flex items-center justify-between text-xs ${realPreview.stage === "B" ? "border-purple-200 bg-purple-100" : "border-indigo-200 bg-indigo-100"}`}>
            <h4 className={`font-semibold ${realPreview.stage === "B" ? "text-purple-900" : "text-indigo-900"}`}>
              {realPreview.stage === "B"
                ? "✨ Product Preview"
                : "🖼️ Real render — Stage A (deterministic)"}
            </h4>
            <div className={`flex items-center gap-3 font-mono ${realPreview.stage === "B" ? "text-purple-800" : "text-indigo-800"}`}>
              {realPreview.stage === "B" && realPreview.stageB ? (
                /*
                  Kontext (`fal-ai/flux-pro/kontext`) doesn't use the strength knob — its
                  edit intensity comes from `guidance_scale` + prompt. Show endpoint-aware
                  telemetry so "strength 0.00" doesn't get misread as "AI didn't do anything."
                  v5: include the fabric_feel / print_strength values Stage B actually saw,
                  so the operator can confirm sliders reached AI. If "ff 0.07 · ps 0.88"
                  shows up in the badge but the result still looks like a sticker, that's
                  the sliders telling Kontext to keep it sticker-like.
                */
                (() => {
                  const isKontext = (realPreview.stageB?.falEndpoint ?? "").toLowerCase().includes("kontext");
                  const ff = realPreview.stageB.params.fabric_feel;
                  const ps = realPreview.stageB.params.print_strength;
                  const blur = realPreview.stageB.params.pre_blur_sigma;
                  const sliderTrail = ff != null && ps != null
                    ? ` · ff ${ff.toFixed(2)} · ps ${ps.toFixed(2)}${blur != null ? ` · blur ${blur.toFixed(2)}` : ""}`
                    : "";
                  if (isKontext) {
                    return (
                      <span title={realPreview.stageB.falEndpoint}>
                        kontext · cfg {realPreview.stageB.params.guidance_scale.toFixed(1)} · steps {realPreview.stageB.params.num_inference_steps}{sliderTrail}
                      </span>
                    );
                  }
                  return (
                    <span title={realPreview.stageB.falEndpoint}>
                      {realPreview.stageB.usedMask ? "inpaint" : "img2img"} · strength {realPreview.stageB.params.strength.toFixed(2)}{sliderTrail}
                    </span>
                  );
                })()
              ) : null}
              <span>
                {realPreview.artworkMode ?? "light"} · {realPreview.placementUsed.blendMode} · op {realPreview.placementUsed.blendOpacity.toFixed(2)} · scale {realPreview.placementUsed.scale.toFixed(2)}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-full font-semibold ${
                  realPreview.maskApplied
                    ? "bg-emerald-200 text-emerald-900"
                    : "bg-amber-200 text-amber-900"
                }`}
                title={
                  realPreview.maskApplied
                    ? `Mask multiplied onto design (mean=${realPreview.maskMean})`
                    : realPreview.maskMean != null
                      ? `Mask skipped — looked inverted (mean=${realPreview.maskMean})`
                      : "No mask uploaded for this view"
                }
              >
                {realPreview.maskApplied ? "Mask applied" : "No mask"}
              </span>
              <button
                type="button"
                onClick={dismissRealPreview}
                className={`underline hover:no-underline ${realPreview.stage === "B" ? "text-purple-700" : "text-indigo-700"}`}
              >
                dismiss
              </button>
            </div>
          </div>
          <div className="p-4 flex items-center justify-center bg-neutral-50">
            <img
              src={proxiedImageUrlForCanvas(realPreview.previewUrl)}
              alt="Real render preview"
              className="max-h-[min(72vh,720px)] w-auto max-w-full rounded border border-neutral-200"
            />
          </div>
        </div>
      ) : null}

      {previewLightbox && previewGarmentUrl ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/75 p-4"
          role="presentation"
          onClick={() => setPreviewLightbox(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative max-w-[min(96vw,1000px)] max-h-[92vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewGarmentUrl}
              alt="Preview enlarged"
              className="max-h-[88vh] w-auto mx-auto rounded-lg shadow-2xl"
            />
            <button
              type="button"
              className="absolute -top-2 -right-2 px-3 py-1.5 rounded-lg bg-white text-neutral-800 text-sm font-semibold shadow-lg border border-neutral-200 hover:bg-neutral-50"
              onClick={() => setPreviewLightbox(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
