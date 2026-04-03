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
import type { RPBlank, RPPlacement, RpRenderTarget, RpRenderTargetSettings } from "@/lib/types/firestore";
import type { UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { useDesigns } from "@/lib/hooks/useDesignAssets";
import {
  getDesignPreviewUrl,
  pickDesignSvgUrlForGarment,
  resolveDesignAssets,
} from "@/lib/designs/designHelpers";
import {
  firstActiveVariant,
  getBlankVariants,
  getVariantById,
  getEffectiveColorFamily,
  isMasterBlank,
  derivePlacementEngineFields8394,
  inferSimpleControls8394FromLegacy,
  normalizeSimpleControls8394,
} from "@/lib/blanks";
import type { DesignDoc, RP8394SizePreset } from "@/lib/types/firestore";
import type { RPPlacementSimpleRenderControls8394 } from "@/lib/types/firestore";
import { get8394DesignTreatmentFromPlacement } from "@/lib/products/flatRenderFingerprint";
import {
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
} from "@/lib/products/resolveProductRenderProfile";
import { sizePresetToDefaultScale } from "@/lib/blanks/simpleRenderControls8394";
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
  getDefaultRenderTargetSettings,
  getRenderTargetPreviewUrl,
  mergeRenderTargetSettings,
  renderTargetToGarmentSide,
} from "@/lib/render/renderTargetTuning";

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
  overlayArtUrl,
  onPointerDownOverlay,
  maxHeightClass,
  emptyOverlay,
}: GarmentPreviewCanvasProps) {
  const showArt = Boolean(overlayArtUrl);
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
            className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing will-change-transform"
            style={{
              left: `${px * 100}%`,
              top: `${py * 100}%`,
              width: `${artBase * scale * 100}%`,
              aspectRatio: `${DESIGN_ARTBOARD_WIDTH_PX} / ${DESIGN_ARTBOARD_HEIGHT_PX}`,
              height: "auto",
              transform: "translate(-50%, -50%)",
              opacity: overlayOpacity,
              mixBlendMode: overlayMixBlendMode,
              filter: overlayFilter,
            }}
            onPointerDown={onPointerDownOverlay}
          >
            <img
              key={overlayArtUrl}
              src={overlayArtUrl}
              alt="Preview design"
              className="w-full h-full object-contain drop-shadow-md pointer-events-none select-none"
              draggable={false}
            />
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

/** Preview PNG from library: explicit light/dark operator choice, then fallbacks. */
function pickDesignPreviewPng(
  design: DesignDoc | undefined,
  mode: "light" | "dark",
  variant: ReturnType<typeof getVariantById>
): string | null {
  if (!design) return null;
  const a = resolveDesignAssets(design);
  if (mode === "light") {
    const u = a.lightPng || a.darkPng;
    if (u) return u;
  } else {
    const u = a.darkPng || a.lightPng;
    if (u) return u;
  }
  const fam = variant ? getEffectiveColorFamily(variant.colorFamily, variant.colorName) : null;
  return pickDesignSvgUrlForGarment(design, fam, "back", variant?.preferredArtworkTone ?? undefined);
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
  const [variantId, setVariantId] = useState<string | null>(() => firstActiveVariant(blank)?.variantId ?? null);
  /** Library design id only — never persisted on the blank. */
  const [previewDesignId, setPreviewDesignId] = useState<string>("");
  /** Operator-chosen preview asset (light vs dark PNG). */
  const [previewArtworkMode, setPreviewArtworkMode] = useState<"light" | "dark">("dark");
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
    const built = buildRenderTargetSettingsMap(
      blank.renderProfile?.renderTargets,
      normalizedRows,
      blank.styleCode
    );
    setTargetSettingsMap(built);
    setBaselineTargetMap(
      Object.fromEntries(
        RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(built[k]!)])
      ) as Record<RpRenderTarget, RpRenderTargetSettings>
    );
  }, [blank.blankId, blank.renderProfile, blank.placements, blank.styleCode]);

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

  useEffect(() => {
    if (!variantId && variants.length) setVariantId(variants[0].variantId);
  }, [variantId, variants]);

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

  useEffect(() => {
    if (!previewDesignId) return;
    const d = designs.find((x) => x.id === previewDesignId) as DesignDoc | undefined;
    if (!d) return;
    const a = resolveDesignAssets(d);
    if (a.darkPng) setPreviewArtworkMode("dark");
    else if (a.lightPng) setPreviewArtworkMode("light");
  }, [previewDesignId, designs]);

  const selected = rows[selectedIndex];
  const previewVariant = variantId ? getVariantById(blank, variantId) : null;
  const previewGarmentUrl = previewVariant
    ? getRenderTargetPreviewUrl(blank, previewVariant, selectedRenderTarget)
    : null;
  const previewSide = renderTargetToGarmentSide(selectedRenderTarget);
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
    return resolveEffectiveRenderTargetSettings(
      null,
      blankWithDraftRenderTargets,
      previewVariant ?? undefined,
      selectedRenderTarget
    );
  }, [blankWithDraftRenderTargets, previewVariant, selectedRenderTarget]);

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

  const previewDesignLabel = previewDesign
    ? `${previewDesign.teamNameCache ? `${previewDesign.teamNameCache} — ` : ""}${previewDesign.name ?? previewDesignId}`
    : "";

  const hasLightPng = Boolean(previewDesign && resolveDesignAssets(previewDesign).lightPng);
  const hasDarkPng = Boolean(previewDesign && resolveDesignAssets(previewDesign).darkPng);

  /** Blended canvas uses per–render-target tuning (`renderProfile`), not zone `renderZoneDefaults`. */
  const zoneBlend = useMemo(() => {
    if (tuning) return blendSettingsToPreviewCss(tuning.blend);
    if (!selected) return { blendMode: "multiply", blendOpacity: 1 };
    return effectiveZoneBlend(blank, selected.view, selected);
  }, [blank, selected, tuning]);

  const designTreatment8394 = useMemo(() => {
    if (!is8394 || !selected || selected.view !== "back") {
      return { designOpacityMultiplier: 1, contrastPercent: 100, realism: 0 };
    }
    return get8394DesignTreatmentFromPlacement(selected);
  }, [is8394, selected]);

  const previewOpacity = zoneBlend.blendOpacity * designTreatment8394.designOpacityMultiplier;
  const previewBlurPx =
    designTreatment8394.realism > 52 ? 0.35 + (designTreatment8394.realism / 100) * 0.55 : 0;
  const previewFilter =
    previewBlurPx > 0
      ? `blur(${previewBlurPx}px) contrast(${designTreatment8394.contrastPercent}%)`
      : `contrast(${designTreatment8394.contrastPercent}%)`;

  const is8394SimpleBackUi = is8394 && selected?.view === "back";

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
    [selected, tuning, patchTargetTuning]
  );

  const handleReset = () => {
    setRows(JSON.parse(JSON.stringify(baselineRows)) as ProfileRow[]);
    setRenderProfileStatus(baselineMeta.renderProfileStatus);
    setRenderProfileNotes(baselineMeta.renderProfileNotes);
    setSupportedFront(baselineMeta.supportedFront);
    setSupportedBack(baselineMeta.supportedBack);
    setPreferredFlatLook8394(baselineMeta.preferredFlatLook8394);
    setTargetSettingsMap(
      Object.fromEntries(
        RENDER_TARGETS.map((k) => [k, cloneRenderTargetSettings(baselineTargetMap[k]!)])
      ) as Record<RpRenderTarget, RpRenderTargetSettings>
    );
    showToast("Reverted to last saved render profile", "success");
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const supportedRenderViews: ("front" | "back")[] = [];
      if (supportedFront) supportedRenderViews.push("front");
      if (supportedBack) supportedRenderViews.push("back");
      const renderTargets = Object.fromEntries(
        RENDER_TARGETS.map((t) => [t, targetSettingsMap[t]!])
      ) as NonNullable<NonNullable<RPBlank["renderProfile"]>["renderTargets"]>;
      await updateBlank({
        blankId: blank.blankId,
        placements: rows.map((r) => toFirestorePlacement(r, blank.styleCode)),
        renderProfile: { renderTargets },
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
      if (sc === "8394" && selected?.view === "back") {
        const v = RENDER_STYLE_TO_SIMPLE_8394[id];
        updateSelected({ simpleRenderControls8394: { realism: v.realism, inkStrength: v.inkStrength } });
      } else {
        const zb = RENDER_STYLE_TO_ZONE_BLEND[id];
        updateSelected({ renderZoneDefaults: { blendMode: zb.blendMode, blendOpacity: zb.blendOpacity } });
      }
    },
    [blank.styleCode, selected?.view, updateSelected]
  );

  const applyPrintSizePreset = useCallback(
    (preset: RP8394SizePreset) => {
      const sc = String(blank.styleCode || "").trim();
      if (sc === "8394" && selected?.view === "back") {
        updateSelected({ simpleRenderControls8394: { sizePreset: preset } });
      } else {
        updateSelected({ defaultScale: sizePresetToDefaultScale(preset) });
      }
    },
    [blank.styleCode, selected?.view, updateSelected]
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
  const simple8394 =
    is8394SimpleBackUi && selected?.simpleRenderControls8394 ? selected.simpleRenderControls8394 : null;

  const matchedRenderStyle8394 =
    is8394SimpleBackUi && simple8394
      ? matchRenderStylePreset8394(simple8394.realism ?? 55, simple8394.inkStrength ?? 78)
      : null;

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
    (is8394SimpleBackUi && simple8394 && (matchedRenderStyle8394 === "custom" || explicitCustomStyle)) ||
    (!is8394SimpleBackUi && hasExplicitZoneBlend && (matchedRenderStyleZone === "custom" || explicitCustomStyle));

  const zoneCustomSliders = zoneBlendToApproxCustomSliders(selected?.renderZoneDefaults);
  const show8394CustomSliders =
    Boolean(is8394SimpleBackUi && simple8394) &&
    (matchedRenderStyle8394 === "custom" || explicitCustomStyle);
  const showZoneCustomSliders =
    Boolean(!is8394SimpleBackUi && hasExplicitZoneBlend) &&
    (matchedRenderStyleZone === "custom" || explicitCustomStyle);

  const customButtonActive =
    explicitCustomStyle ||
    (is8394SimpleBackUi && matchedRenderStyle8394 === "custom") ||
    (!is8394SimpleBackUi && hasExplicitZoneBlend && matchedRenderStyleZone === "custom");

  const useBlendedCanvas = previewMode === "blended" || previewMode === "compare";
  const canvasMixBlend = useBlendedCanvas
    ? (cssMixBlendMode(zoneBlend.blendMode) as React.CSSProperties["mixBlendMode"])
    : "normal";
  const canvasOpacity = useBlendedCanvas ? previewOpacity : 1;
  const canvasFilter =
    useBlendedCanvas && is8394SimpleBackUi ? previewFilter : is8394SimpleBackUi ? "contrast(100%)" : undefined;

  const previewAssetsReady = Boolean(previewGarmentUrl && (!previewDesignId || overlayArtUrl));

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
        <aside className="w-full lg:w-[40%] lg:max-w-xl shrink-0 space-y-8 lg:pr-2 lg:border-r lg:border-neutral-200 lg:min-h-[480px]">
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
            <div>
              <span className="block text-xs font-medium text-neutral-600 mb-2">Artwork variant</span>
              <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 bg-neutral-50">
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
                  Light artwork
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
                  Dark artwork
                </button>
              </div>
            </div>
            {isMasterBlank(blank) && variants.length > 0 ? (
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Garment variant (preview photo)</label>
                <select
                  value={variantId ?? ""}
                  onChange={(e) => setVariantId(e.target.value || null)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  {variants.map((v) => (
                    <option key={v.variantId} value={v.variantId}>
                      {v.colorName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>

          {/* Target tuning (renderProfile.renderTargets) */}
          <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-violet-800">
              Target tuning (render target specific)
            </h2>
            <p className="text-xs text-violet-950/80 leading-relaxed">
              <span className="font-semibold text-neutral-900">Zone geometry</span>{" "}
              <code className="text-[10px] bg-white/80 px-1 rounded">placements[]</code> — safe area, default zone
              placement, side.{" "}
              <span className="font-semibold text-neutral-900">Target tuning</span>{" "}
              <code className="text-[10px] bg-white/80 px-1 rounded">renderProfile.renderTargets[target]</code> — x/y/scale
              and blend curve for each garment photo (flat vs on-model).
            </p>
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
            {selected ? (
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
            {tuning ? (
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
                  <p className="text-[10px] text-neutral-500 mt-1">Preview does not warp the overlay yet; values persist.</p>
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

          {/* Zone + readiness row */}
          <section className="space-y-3 pt-2 border-t border-neutral-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Zone</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Render zone</label>
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
                <label className="block text-xs font-medium text-neutral-600 mb-1">Zone status</label>
                <select
                  value={selected?.profileStatus ?? "draft"}
                  onChange={(e) => updateSelected({ profileStatus: e.target.value as "draft" | "approved" })}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
            </div>
          </section>

          {/* 2. Zone geometry (placements[]) */}
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

          {/* 3. Print style */}
          <section className="space-y-3 pt-2 border-t border-neutral-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">3. Print style</h2>
            {!is8394SimpleBackUi && !hasExplicitZoneBlend ? (
              <p className="text-xs text-neutral-500">Using blank default — pick a style to set this zone.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {RENDER_STYLE_PRESET_ORDER.map((id) => {
                const active =
                  !explicitCustomStyle &&
                  (is8394SimpleBackUi ? matchedRenderStyle8394 === id : hasExplicitZoneBlend && matchedRenderStyleZone === id);
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
                  if (is8394SimpleBackUi) {
                    updateSelected({ simpleRenderControls8394: { realism: 56, inkStrength: 79 } });
                  } else {
                    updateSelected({ renderZoneDefaults: zoneCustomSlidersToBlend(50, 72) });
                  }
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

            {show8394CustomSliders && simple8394 ? (
              <div className="grid grid-cols-1 gap-4 pt-2">
                <div>
                  <label className="block text-sm font-medium text-neutral-800">Fabric feel</label>
                  <p className="text-xs text-neutral-500 mb-1">How much the design blends into fabric</p>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={simple8394.realism ?? 55}
                    onChange={(e) =>
                      updateSelected({ simpleRenderControls8394: { realism: Number(e.target.value) } })
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
                    value={simple8394.inkStrength ?? 78}
                    onChange={(e) =>
                      updateSelected({ simpleRenderControls8394: { inkStrength: Number(e.target.value) } })
                    }
                    className="w-full accent-indigo-600"
                  />
                </div>
              </div>
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
                const active = is8394SimpleBackUi
                  ? simple8394?.sizePreset === preset
                  : Math.abs(scale - sizePresetToDefaultScale(preset)) < 0.04;
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
            {is8394SimpleBackUi && simple8394 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    updateSelected({
                      defaultScale: clamp((sw / Math.max(artBase, 0.08)) * 0.42, SCALE_ENGINE_MIN, SCALE_ENGINE_MAX),
                    })
                  }
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-neutral-200 bg-white hover:border-indigo-300"
                >
                  Fit width to safe area
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateSelected({
                      defaultScale: clamp((sh / Math.max(artBase, 0.08)) * 0.42, SCALE_ENGINE_MIN, SCALE_ENGINE_MAX),
                    })
                  }
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-neutral-200 bg-white hover:border-indigo-300"
                >
                  Fit height to safe area
                </button>
              </div>
            ) : null}
          </section>

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
            <p className="text-xs text-neutral-500 leading-relaxed">
              Saving updates the default placement for <strong>all products</strong> using this blank.
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
        </aside>

        {/* —— C: Preview (~60%) —— */}
        <div className="flex-1 min-w-0 space-y-4">
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
          </div>

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
                showSafeArea={showSafeArea}
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
          ) : !overlayArtUrl ? (
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
                    showSafeArea={showSafeArea}
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
                      blended ? (cssMixBlendMode(zoneBlend.blendMode) as CSSProperties["mixBlendMode"]) : "normal"
                    }
                    overlayFilter={
                      blended && is8394SimpleBackUi
                        ? previewFilter
                        : !blended && is8394SimpleBackUi
                          ? "contrast(100%)"
                          : undefined
                    }
                    overlayArtUrl={overlayArtUrl}
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
              showSafeArea={showSafeArea}
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
              overlayArtUrl={overlayArtUrl}
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
