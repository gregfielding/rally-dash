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
  RPBlankVariantRenderProfileSideOverride,
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
  diffSettingsToVariantRenderTargetOverride,
  getDefaultRenderTargetSettings,
  getRenderTargetPreviewUrl,
  blendSettingsToEngineBlend,
  legacyZoneBlendToBlend01,
  mergeRenderTargetSettings,
  mergeVariantRenderTargetOverrides,
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
  imgRef?: LegacyRef<HTMLImageElement>;
  showSafeArea: boolean;
  showClipHint: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  px: number;
  py: number;
  artBase: number;
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
}: GarmentPreviewCanvasProps) {
  const showArt = Boolean(overlayArtUrl);
  const overlayTransform =
    overlayWarpTransform && overlayWarpTransform.trim() !== ""
      ? `translate(-50%, -50%) ${overlayWarpTransform}`
      : "translate(-50%, -50%)";
  return (
    <div
      data-garment-preview
      className="relative inline-block w-full border border-gray-200 rounded-xl bg-neutral-100 overflow-hidden shadow-inner"
    >
      <img
        ref={imgRef}
        src={garmentUrl}
        alt={`Garment ${side}`}
        className={`block ${maxHeightClass} w-auto max-w-full mx-auto select-none`}
        draggable={false}
      />
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
        {showArt ? (
          <div
            className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing will-change-transform [transform-style:preserve-3d]"
            style={{
              left: `${px * 100}%`,
              top: `${py * 100}%`,
              width: `${artBase * scale * 100}%`,
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

export function BlankRenderProfileEditor({
  blank,
  updateBlank,
  refetchBlank,
  showToast,
}: {
  blank: RPBlank;
  updateBlank: (i: UpdateBlankInput) => Promise<unknown>;
  refetchBlank: () => void;
  showToast: (m: string, t: "success" | "error") => void;
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

  const imgRef = useRef<HTMLImageElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

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
  const previewSide = renderTargetToGarmentSide(selectedRenderTarget);
  /**
   * Printed-side permission (supportedRenderViews): when false, no design overlay on that side in this UI.
   * Front: still allows clean display previews (garment-only); generation emits clean front images regardless.
   */
  const previewSideAllowsPrinting =
    previewSide === "front" ? supportedFront : supportedBack;
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
      const img = (wrap?.querySelector("img") as HTMLImageElement | null) || imgRef.current;
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

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const supportedRenderViews: ("front" | "back")[] = [];
      if (supportedFront) supportedRenderViews.push("front");
      if (supportedBack) supportedRenderViews.push("back");

      const savingColorVariant = isMasterBlank(blank) && Boolean(variantId);

      /** 8394 master: one cell = variantId × renderTarget in `renderProfile.renderTargetsByColor`. */
      if (is8394 && isMasterBlank(blank) && variantId) {
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
        console.log("variantId used (save):", variantId);
        console.log("[8394 SAVE RESULT]", {
          blankId: blank.blankId,
          variantIdUsed: variantId,
          target: selectedRenderTarget,
          savedTo: "renderTargetsByColor",
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
        console.log(
          "[8394 VERIFY READ] After save, check the next [8394 CELL READ] log once Firestore client updates blank.renderProfile."
        );
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

      if (savingColorVariant && !is8394) {
        const normalizedRows = normalizeProfileRows(blank.placements, blank.styleCode);
        const blankBase = buildRenderTargetSettingsMap(
          blank.renderProfile?.renderTargets,
          normalizedRows,
          blank.styleCode
        );
        const patch: Partial<Record<RpRenderTarget, RPBlankVariantRenderProfileSideOverride | null>> = {};
        for (const t of RENDER_TARGETS) {
          const row = pickRowForRenderTarget(normalizedRows, t);
          if (!row) continue;
          patch[t] = diffSettingsToVariantRenderTargetOverride(
            targetSettingsMap[t]!,
            blankBase[t]!,
            row,
            blank.styleCode
          );
        }
        const mergedVariants = mergeVariantRenderTargetOverrides(getBlankVariants(blank), variantId, patch);
        console.log("[renderProfile save] variant overrides (non-8394 master)", {
          blankId: blank.blankId,
          variantId,
          patch,
        });
        await updateBlank({
          blankId: blank.blankId,
          variants: mergedVariants,
          renderProfileStatus,
          renderProfileNotes: renderProfileNotes.trim() || null,
          supportedRenderViews: supportedRenderViews.length ? supportedRenderViews : null,
          preferredFlatLook8394: undefined,
        });
        await refetchBlank();
        setBaselineMeta({
          renderProfileStatus,
          renderProfileNotes,
          supportedFront,
          supportedBack,
          preferredFlatLook8394,
        });
        showToast("Saved placement overrides for this color.", "success");
        return;
      }

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

  const scale = tuning?.placement.scale ?? selected?.defaultScale ?? 0.6;
  const artBase = selected?.artboardBase ?? 0.5;
  const sx = selected?.safeArea?.x ?? DEFAULT_GARMENT_SAFE_AREA.x;
  const sy = selected?.safeArea?.y ?? DEFAULT_GARMENT_SAFE_AREA.y;
  const sw = selected?.safeArea?.w ?? DEFAULT_GARMENT_SAFE_AREA.w;
  const sh = selected?.safeArea?.h ?? DEFAULT_GARMENT_SAFE_AREA.h;
  const px = tuning?.placement.x ?? selected?.defaultX ?? 0.5;
  const py = tuning?.placement.y ?? selected?.defaultY ?? 0.5;

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
  const canvasMixBlend = useBlendedCanvas
    ? (cssMixBlendMode(blendModeForBlendedCanvas) as React.CSSProperties["mixBlendMode"])
    : "normal";
  const canvasOpacity = useBlendedCanvas ? previewOpacity : 1;
  const canvasFilter = useBlendedCanvas && is8394 && tuning ? previewFilter : undefined;

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
          </section>

          {/* Target tuning — key resets local focus when switching matrix cell */}
          <section
            key={`tuning-cell-${variantId || "baseline"}-${selectedRenderTarget}`}
            className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4"
          >
            <h2 className="text-xs font-bold uppercase tracking-wider text-violet-800">
              Target tuning (render target specific)
            </h2>
            {is8394 ? (
              <p className="text-xs text-violet-950/80 leading-relaxed">
                These controls tune <strong>{RENDER_TARGET_LABELS[selectedRenderTarget]}</strong> for{" "}
                {isMasterBlank(blank) && variantId ? (
                  <>
                    this color in{" "}
                    <code className="text-[10px] bg-white/80 px-1 rounded">renderProfile.renderTargetsByColor</code> (
                    one cell per variant × target).
                  </>
                ) : (
                  <>
                    <code className="text-[10px] bg-white/80 px-1 rounded">renderProfile.renderTargets</code> (blank
                    baseline).
                  </>
                )}{" "}
                Presets are shortcuts only.
              </p>
            ) : (
              <p className="text-xs text-violet-950/80 leading-relaxed">
                <span className="font-semibold text-neutral-900">Zone geometry</span>{" "}
                <code className="text-[10px] bg-white/80 px-1 rounded">placements[]</code> — safe area, default zone
                placement, side.{" "}
                <span className="font-semibold text-neutral-900">Target tuning</span>{" "}
                <code className="text-[10px] bg-white/80 px-1 rounded">renderProfile.renderTargets[target]</code> — x/y/scale
                and blend curve for each garment photo (flat vs on-model).
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-neutral-800 mb-1">Render target</label>
              <select
                value={selectedRenderTarget}
                onChange={(e) => setSelectedRenderTarget(e.target.value as RpRenderTarget)}
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
              >
                {RENDER_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {RENDER_TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-neutral-600 mt-1.5">
                Defaults to Flat Front / Flat Back when you switch render zone. Preview image follows this target.
              </p>
            </div>
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
              <div className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 px-3 py-2.5">
                <h3 className="text-[10px] font-bold uppercase tracking-wide text-emerald-900 mb-1">
                  Resolved target tuning (read-only QA)
                </h3>
                <p className="text-[10px] text-emerald-900/85 mb-2 leading-snug">
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
              </div>
            ) : null}
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
              <div className="space-y-5 pt-2 border-t border-violet-200/80">
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
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">
                    Print style / blend (this target)
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <div className="flex justify-between text-xs text-neutral-600 mb-1">
                        <span className="font-medium text-neutral-800">Fabric feel</span>
                        <span>{Math.round(tuning.blend.fabricFeel * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(tuning.blend.fabricFeel * 100)}
                        onChange={(e) =>
                          patchTargetTuning({
                            blend: { ...tuning.blend, fabricFeel: Number(e.target.value) / 100 },
                          })
                        }
                        className="w-full accent-violet-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-neutral-600 mb-1">
                        <span className="font-medium text-neutral-800">Print strength</span>
                        <span>{Math.round(tuning.blend.printStrength * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(tuning.blend.printStrength * 100)}
                        onChange={(e) =>
                          patchTargetTuning({
                            blend: { ...tuning.blend, printStrength: Number(e.target.value) / 100 },
                          })
                        }
                        className="w-full accent-violet-600"
                      />
                    </div>
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
                  </div>
                </div>
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
                  <p className="text-[10px] text-neutral-500 mt-1">Mask is not drawn on this canvas yet.</p>
                </div>
              </div>
            ) : null}
          </section>

          {/* Which placements[] row is active (front vs back) — not the same as Render target (flat vs model photo) */}
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

          {/* 2. Zone geometry (placements[]) — full section; 8394 uses Advanced in Target tuning instead */}
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

          {!is8394 ? (
            <>
              {/* 3. Print style */}
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

              {/* 4. Print size */}
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
                  <strong>Blank baseline (all colors)</strong> above to edit defaults shared by every color.
                </>
              ) : (
                <>
                  Saving updates the default placement for <strong>all products</strong> using this blank (all colors
                  unless they have their own color overrides).
                </>
              )}
            </p>
          </section>

          {/* Blank-level gates (compact) */}
          <section className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-900">Blank render readiness</h3>
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
                    value={selected?.maskConfig?.mode ?? "none"}
                    onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                  >
                    <option value="none">None (MVP)</option>
                    <option value="blank_mask_doc">Use rp_blank_masks doc (future)</option>
                    <option value="safe_area_clip">Clip to safe area (future)</option>
                  </select>
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
        </aside>

        {/* —— C: Preview (~60%) —— sticky on desktop so controls can scroll on the page */}
        <div className="flex-1 min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
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
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">View</span>
              {(["clean", "blended", "compare"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPreviewMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    previewMode === m
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-neutral-700 border-neutral-200 hover:border-indigo-300"
                  }`}
                >
                  {m === "clean" ? "Clean" : m === "blended" ? "Blended" : "Side-by-side"}
                </button>
              ))}
              {previewGarmentUrl ? (
                <button
                  type="button"
                  onClick={() => setPreviewLightbox(true)}
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  Enlarge garment
                </button>
              ) : null}
            </div>
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
                scale={scale}
                overlayOpacity={0}
                overlayMixBlendMode="normal"
                overlayArtUrl=""
                onPointerDownOverlay={handlePointerDownOverlay}
                maxHeightClass="max-h-[min(72vh,720px)]"
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
            />
          )}
        </div>
      </div>

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
