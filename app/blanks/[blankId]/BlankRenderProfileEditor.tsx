"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RPBlank, RPPlacement } from "@/lib/types/firestore";
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
import type { DesignDoc } from "@/lib/types/firestore";
import type { RPPlacementSimpleRenderControls8394 } from "@/lib/types/firestore";
import { get8394DesignTreatmentFromPlacement, getBackBlendForFlatRender } from "@/lib/products/flatRenderFingerprint";
import { DEFAULT_SAMPLE_DESIGNS, getDefaultSampleById } from "@/lib/render/defaultSampleDesigns";
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

const BLEND_OPTIONS = ["normal", "multiply", "overlay", "soft-light"] as const;

function placementSide(placementId: string): "front" | "back" {
  if (placementId.startsWith("back_")) return "back";
  return "front";
}

function blankImageForSide(blank: RPBlank, variantId: string | null, side: "front" | "back"): string | null {
  const v = variantId ? getVariantById(blank, variantId) : firstActiveVariant(blank);
  if (v?.images) {
    const url =
      side === "front"
        ? v.images.front?.downloadUrl ?? blank.images?.front?.downloadUrl
        : v.images.back?.downloadUrl ?? blank.images?.back?.downloadUrl;
    if (url) return url;
  }
  if (blank.images) {
    return side === "front"
      ? blank.images.front?.downloadUrl ?? blank.images.back?.downloadUrl ?? null
      : blank.images.back?.downloadUrl ?? blank.images.front?.downloadUrl ?? null;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
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
      return {
        ...base,
        simpleRenderControls8394: normalized,
        defaultScale: derived.defaultScale,
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

/** Light garment → dark artwork overlay; dark garment → light artwork overlay (readable on fabric). */
function pickDesignArtUrlForVariant(design: DesignDoc | undefined, variant: ReturnType<typeof getVariantById>): string | null {
  if (!design) return null;
  const a = resolveDesignAssets(design);
  const fam = variant ? getEffectiveColorFamily(variant.colorFamily, variant.colorName) : null;
  const svgUrl = pickDesignSvgUrlForGarment(design, fam);
  if (!variant) return a.lightPng || a.darkPng || svgUrl || null;
  if (fam === "dark") {
    return a.lightPng || a.darkPng || svgUrl || null;
  }
  return a.darkPng || a.lightPng || svgUrl || null;
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
    return {
      ...base,
      simpleRenderControls8394: n,
      defaultScale: d.defaultScale,
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
  const [sampleDesignId, setSampleDesignId] = useState<string>("");
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [showClipHint, setShowClipHint] = useState(false);
  /** clean = no blend on canvas; blended = current profile; compare = side-by-side */
  const [previewMode, setPreviewMode] = useState<"clean" | "blended" | "compare">("blended");
  const [previewLightbox, setPreviewLightbox] = useState(false);
  const [lastExplicitRenderStyle, setLastExplicitRenderStyle] = useState<RenderStylePresetId>("soft_print");
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

  const variants = useMemo(
    () => getBlankVariants(blank).filter((v) => v.isActive !== false),
    [blank]
  );

  useEffect(() => {
    if (!variantId && variants.length) setVariantId(variants[0].variantId);
  }, [variantId, variants]);

  useEffect(() => {
    if (sampleDesignId) return;
    if (designs.length > 0) setSampleDesignId(designs[0]!.id);
    else if (DEFAULT_SAMPLE_DESIGNS[0]) setSampleDesignId(DEFAULT_SAMPLE_DESIGNS[0].id);
  }, [designs, sampleDesignId]);

  const selected = rows[selectedIndex];
  const side = selected ? selected.view : "front";
  const garmentUrl = blankImageForSide(blank, variantId, side);
  const previewVariant = variantId ? getVariantById(blank, variantId) : null;

  const overlayArtUrl = useMemo(() => {
    const fb = getDefaultSampleById(sampleDesignId);
    if (fb) return fb.url;
    const d = designs.find((x) => x.id === sampleDesignId);
    if (!d) return DEFAULT_SAMPLE_DESIGNS[0]?.url ?? "";
    return (
      pickDesignArtUrlForVariant(d as DesignDoc, previewVariant) ||
      getDesignPreviewUrl(d) ||
      DEFAULT_SAMPLE_DESIGNS[0]?.url ||
      ""
    );
  }, [sampleDesignId, designs, previewVariant]);

  const zoneBlend = useMemo(() => {
    if (!selected) return { blendMode: "multiply", blendOpacity: 1 };
    if (is8394 && selected.view === "back" && previewVariant) {
      return getBackBlendForFlatRender(blank, previewVariant, selected);
    }
    return effectiveZoneBlend(blank, side, selected);
  }, [blank, is8394, previewVariant, selected, side]);

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
            next.defaultScale = d.defaultScale;
            next.renderZoneDefaults = d.renderZoneDefaults;
          }
          return next;
        })
      );
    },
    [selectedIndex, blank.styleCode]
  );

  const handlePointerDownOverlay = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = (e.currentTarget as HTMLElement).closest("[data-garment-preview]");
      const img = (wrap?.querySelector("img") as HTMLImageElement | null) || imgRef.current;
      if (!img || !selected) return;
      const r = img.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const cx = selected.defaultX * r.width;
      const cy = selected.defaultY * r.height;
      dragOffsetRef.current = { x: mx - cx, y: my - cy };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const imgEl = img;

      const onMove = (ev: PointerEvent) => {
        if (!dragOffsetRef.current || !imgEl) return;
        const rect = imgEl.getBoundingClientRect();
        const px = ev.clientX - rect.left - dragOffsetRef.current.x;
        const py = ev.clientY - rect.top - dragOffsetRef.current.y;
        updateSelected({
          defaultX: clamp(px / rect.width, 0, 1),
          defaultY: clamp(py / rect.height, 0, 1),
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
    [selected, updateSelected]
  );

  const handleReset = () => {
    setRows(JSON.parse(JSON.stringify(baselineRows)) as ProfileRow[]);
    setRenderProfileStatus(baselineMeta.renderProfileStatus);
    setRenderProfileNotes(baselineMeta.renderProfileNotes);
    setSupportedFront(baselineMeta.supportedFront);
    setSupportedBack(baselineMeta.supportedBack);
    setPreferredFlatLook8394(baselineMeta.preferredFlatLook8394);
    showToast("Reverted to last saved render profile", "success");
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const supportedRenderViews: ("front" | "back")[] = [];
      if (supportedFront) supportedRenderViews.push("front");
      if (supportedBack) supportedRenderViews.push("back");
      await updateBlank({
        blankId: blank.blankId,
        placements: rows.map((r) => toFirestorePlacement(r, blank.styleCode)),
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

  const scale = selected?.defaultScale ?? 0.6;
  const artBase = selected?.artboardBase ?? 0.5;
  const sx = selected?.safeArea?.x ?? DEFAULT_GARMENT_SAFE_AREA.x;
  const sy = selected?.safeArea?.y ?? DEFAULT_GARMENT_SAFE_AREA.y;
  const sw = selected?.safeArea?.w ?? DEFAULT_GARMENT_SAFE_AREA.w;
  const sh = selected?.safeArea?.h ?? DEFAULT_GARMENT_SAFE_AREA.h;
  const px = selected?.defaultX ?? 0.5;
  const py = selected?.defaultY ?? 0.5;

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
    (is8394SimpleBackUi && simple8394 && matchedRenderStyle8394 === "custom") ||
    (!is8394SimpleBackUi && hasExplicitZoneBlend && matchedRenderStyleZone === "custom");

  const artworkUsageLabel =
    previewVariant &&
    (getEffectiveColorFamily(previewVariant.colorFamily, previewVariant.colorName) === "dark"
      ? "LIGHT"
      : "DARK");

  const useBlendedCanvas = previewMode === "blended" || previewMode === "compare";
  const canvasMixBlend = useBlendedCanvas
    ? (cssMixBlendMode(zoneBlend.blendMode) as React.CSSProperties["mixBlendMode"])
    : "normal";
  const canvasOpacity = useBlendedCanvas ? previewOpacity : 1;
  const canvasFilter =
    useBlendedCanvas && is8394SimpleBackUi ? previewFilter : is8394SimpleBackUi ? "contrast(100%)" : undefined;

  const previewReady = Boolean(garmentUrl && overlayArtUrl);

  const backZoneRow = rows.find((r) => r.placementId === "back_center" || r.view === "back");
  const previewHasBackImage = previewVariant?.images?.back?.downloadUrl;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
        <p className="font-semibold text-slate-900">Canonical render profile</p>
        <p className="text-xs mt-1 leading-relaxed text-slate-700">
          This blank render profile is the <strong>default for every product</strong> that uses this blank. Products{" "}
          <strong>inherit</strong> these placement and zone settings automatically unless an operator adds a{" "}
          <strong>product-level override</strong> on the product page (advanced).
        </p>
        <p className="text-xs mt-2 text-slate-600">
          <strong>Saving here</strong> updates default render behavior for products that follow the blank — regenerate mocks or
          flat renders on a product if you need fresh output after a profile change.
        </p>
      </div>
      {is8394 && (
        <div className="rounded-xl border-2 border-indigo-300/80 bg-gradient-to-br from-indigo-50 via-white to-violet-50/50 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-indigo-950 tracking-tight">8394 — back print tuning</h2>
              <p className="text-sm text-indigo-900/85 mt-1">
                Simple mockup-style controls: pick a <strong>Render Style</strong>, size, then <strong>drag</strong> the print.
                Save when it looks right — products pick this up when you generate there.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                    renderProfileStatus === "approved"
                      ? "bg-emerald-200 text-emerald-900"
                      : "bg-amber-200 text-amber-900"
                  }`}
                >
                  Blank: {renderProfileStatus === "approved" ? "Render-ready" : "Draft (tuning)"}
                </span>
                {backZoneRow && (
                  <span
                    className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                      backZoneRow.profileStatus === "approved"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    Zone status: {backZoneRow.profileStatus}
                  </span>
                )}
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                    previewReady ? "bg-sky-100 text-sky-900" : "bg-gray-200 text-gray-700"
                  }`}
                >
                  Preview: {previewReady ? "Ready" : "Missing assets"}
                </span>
              </div>
              {!previewHasBackImage && previewVariant && (
                <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                  Selected variant has no back photo — upload on Variants tab for a useful preview.
                </span>
              )}
            </div>
          </div>
          <ol className="list-decimal list-inside text-sm text-indigo-950 space-y-2 marker:font-semibold">
            <li>
              Pick <strong>garment color</strong> and a <strong>sample design</strong> (built-in samples work if the library is
              empty).
            </li>
            <li>
              Choose <strong>Render Style</strong> → <strong>size</strong> → <strong>drag</strong> to position. Use{" "}
              <strong>Fabric Feel</strong> / <strong>Print Strength</strong> only if you want fine control.
            </li>
            <li>
              <strong>Save</strong>, then on a product tap <strong>Generate</strong> if previews need refreshing.
            </li>
          </ol>
          <div className="rounded-lg border border-indigo-200 bg-white/70 px-3 py-3 space-y-2">
            <p className="text-xs font-semibold text-indigo-950">Preferred reference (Merch / QA)</p>
            <p className="text-[11px] text-indigo-900/80">
              When both previews exist, which one should the team treat as the main reference? (Does not change how images are
              built.)
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-indigo-950">
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
                Natural preview <span className="text-indigo-500 text-xs">(flat_clean)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="preferredFlat8394"
                  checked={preferredFlatLook8394 === "flat_blended"}
                  onChange={() => setPreferredFlatLook8394("flat_blended")}
                />
                Fabric blend <span className="text-indigo-500 text-xs">(flat_blended)</span>
              </label>
            </div>
          </div>
          <p className="text-xs text-indigo-800/80">
            Blank editor link:{" "}
            <code className="bg-indigo-100/80 px-1.5 py-0.5 rounded">/blanks/{blank.blankId}?tab=renderProfile</code>
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Blank render readiness</h3>
        <p className="text-xs text-slate-600">
          Style-level defaults only. Each product still uses its own color variant, design, and generated previews.
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Overall status</label>
            <select
              value={renderProfileStatus}
              onChange={(e) => setRenderProfileStatus(e.target.value as "draft" | "approved")}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="draft">Draft — still tuning</option>
              <option value="approved">Approved — OK for generation</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            <span className="text-xs font-medium text-slate-600">Supported sides</span>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={supportedFront} onChange={(e) => setSupportedFront(e.target.checked)} />
              Front
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={supportedBack} onChange={(e) => setSupportedBack(e.target.checked)} />
              Back
            </label>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Blank notes (ops / handoff)</label>
          <textarea
            value={renderProfileNotes}
            onChange={(e) => setRenderProfileNotes(e.target.value)}
            rows={2}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-[#999999]"
            placeholder="e.g. Panty = back print only; tank = front center only"
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex px-2.5 py-1 rounded-full font-semibold ${
              (selected?.profileStatus ?? "draft") === "approved"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            Zone status: {selected?.profileStatus ?? "draft"}
          </span>
          <span
            className={`inline-flex px-2.5 py-1 rounded-full font-semibold ${
              previewReady ? "bg-sky-100 text-sky-900" : "bg-gray-200 text-gray-700"
            }`}
          >
            Preview ready: {previewReady ? "Yes" : "No"}
          </span>
          {artworkUsageLabel && (
            <span className="inline-flex px-2.5 py-1 rounded-full font-semibold bg-violet-100 text-violet-900">
              Using: {artworkUsageLabel} artwork
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#737373]">
          Designs are placed visually here; linked products inherit these defaults when you generate flat renders.
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Render zone</label>
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[220px] bg-white text-gray-900"
            >
              {rows.map((p, i) => (
                <option key={p.placementId} value={i}>
                  {p.label} ({p.view === "back" ? "Back" : "Front"}) · {p.placementId}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zone status</label>
            <select
              value={selected?.profileStatus ?? "draft"}
              onChange={(e) => updateSelected({ profileStatus: e.target.value as "draft" | "approved" })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
            >
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          {isMasterBlank(blank) && variants.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {is8394 ? "Preview variant (8394 garment photo)" : "Garment image (variant)"}
              </label>
              <select
                value={variantId ?? ""}
                onChange={(e) => setVariantId(e.target.value || null)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[200px] bg-white text-gray-900"
              >
                {variants.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.colorName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-[220px] flex-1 max-w-md">
            <label className="block text-xs font-medium text-gray-600 mb-1">Preview artwork</label>
            <p className="text-[10px] text-[#737373] mb-1">
              Pick a <strong>built-in sample</strong> or any <strong>design from your library</strong> (requires light/dark PNGs
              for real designs). This only affects the blank preview — not saved products until you generate there.
            </p>
            <select
              value={sampleDesignId}
              onChange={(e) => setSampleDesignId(e.target.value)}
              disabled={designsLoading}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full bg-white text-gray-900"
            >
              <optgroup label="Built-in samples">
                {DEFAULT_SAMPLE_DESIGNS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {designs.length > 0 ? (
                <optgroup label="From design library">
                  {designs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.teamNameCache ? `${d.teamNameCache} — ` : ""}
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className="text-xs font-semibold text-gray-700">Preview mode</span>
          {(["clean", "blended", "compare"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPreviewMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                previewMode === m
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
              }`}
            >
              {m === "clean" ? "Clean" : m === "blended" ? "Blended" : "Side-by-side"}
            </button>
          ))}
          {garmentUrl && (
            <button
              type="button"
              onClick={() => setPreviewLightbox(true)}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Enlarge preview
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-6 items-end border-t border-gray-100 pt-4">
          {(is8394SimpleBackUi && simple8394) || !is8394SimpleBackUi ? (
            <div className="w-full space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-800">Render Style</span>
                {is8394SimpleBackUi && matchedRenderStyle8394 === "custom" && (
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    Custom
                  </span>
                )}
                {!is8394SimpleBackUi && !hasExplicitZoneBlend && (
                  <span className="text-[10px] text-gray-600">Using blank default — pick a style to override</span>
                )}
                {!is8394SimpleBackUi && hasExplicitZoneBlend && matchedRenderStyleZone === "custom" && (
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    Custom
                  </span>
                )}
                {showRenderStyleReset && (
                  <button
                    type="button"
                    onClick={resetRenderStyleToLastPreset}
                    className="text-xs font-medium text-indigo-700 hover:underline"
                  >
                    Reset to preset
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {RENDER_STYLE_PRESET_ORDER.map((id) => {
                  const active = is8394SimpleBackUi
                    ? matchedRenderStyle8394 === id
                    : hasExplicitZoneBlend && matchedRenderStyleZone === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyRenderStylePreset(id)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border shadow-sm transition-colors ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-800 border-gray-200 hover:border-indigo-400"
                      }`}
                    >
                      {RENDER_STYLE_PRESET_LABELS[id]}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {is8394SimpleBackUi && simple8394 ? (
            <>
              <div className="flex-1 min-w-[200px] max-w-[220px]">
                <label className="block text-xs font-medium text-gray-700 mb-1">Fabric Feel</label>
                <p className="text-[10px] text-[#737373] mb-1">How much the design blends into the garment</p>
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
              <div className="flex-1 min-w-[200px] max-w-[220px]">
                <label className="block text-xs font-medium text-gray-700 mb-1">Print Strength</label>
                <p className="text-[10px] text-[#737373] mb-1">Faint print → bold print</p>
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
              <div className="flex-1 min-w-[min(100%,320px)]">
                <span className="block text-xs font-medium text-gray-700 mb-1">Print size</span>
                <p className="text-[10px] text-[#737373] mb-2">
                  Subtle = minimal branding · Standard = typical retail · Statement = oversized
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["small", "Subtle"],
                      ["medium", "Standard"],
                      ["large", "Statement"],
                      ["fill_safe", "Fill safe area"],
                    ] as const
                  ).map(([preset, label]) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateSelected({ simpleRenderControls8394: { sizePreset: preset } })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        simple8394.sizePreset === preset
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] font-medium text-gray-700 mt-2">Fit to safe area</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateSelected({
                        defaultScale: clamp((sw / Math.max(artBase, 0.08)) * 0.42, 0.12, 1.25),
                      })
                    }
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 bg-white hover:border-indigo-300"
                  >
                    Width
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelected({
                        defaultScale: clamp((sh / Math.max(artBase, 0.08)) * 0.42, 0.12, 1.25),
                      })
                    }
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 bg-white hover:border-indigo-300"
                  >
                    Height
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelected({ simpleRenderControls8394: { sizePreset: "fill_safe" } })}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 bg-white hover:border-indigo-300"
                  >
                    Fill zone
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 min-w-[200px] max-w-xs">
                <label className="block text-xs font-medium text-gray-600 mb-1">Print size (drag to position)</label>
                <input
                  type="range"
                  min={0.15}
                  max={1.2}
                  step={0.01}
                  value={scale}
                  onChange={(e) => updateSelected({ defaultScale: Number(e.target.value) })}
                  className="w-full accent-indigo-600"
                />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={showSafeArea} onChange={(e) => setShowSafeArea(e.target.checked)} />
            Show safe area
          </label>
          {!is8394SimpleBackUi && (
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={showClipHint} onChange={(e) => setShowClipHint(e.target.checked)} />
              Clip boundary hint
            </label>
          )}
        </div>

        {is8394SimpleBackUi ? (
          <p className="text-xs text-[#737373]">
            <strong>Position:</strong> drag the print on the garment. The preview updates as you go; save to apply on products
            when you generate there.
          </p>
        ) : (
          <p className="text-xs text-[#737373]">
            Preview approximates how the print will sit on fabric. Product generation follows the same rules as this preview.
          </p>
        )}
      </div>

      {!garmentUrl ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 text-sm">
          No <strong>{side}</strong> garment image for preview
          {isMasterBlank(blank) ? " (upload on Variants)" : " (upload on Images)"}. You can still save numbers in Advanced.
        </div>
      ) : previewMode === "compare" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-full mx-auto">
          {(
            [
              { label: "Clean", blended: false },
              { label: "Blended", blended: true },
            ] as const
          ).map(({ label, blended }) => (
            <div key={label} className="space-y-1">
              <p className="text-xs font-semibold text-center text-gray-800">{label}</p>
              <div
                data-garment-preview
                className="relative inline-block w-full border border-gray-200 rounded-lg bg-gray-100 overflow-hidden shadow-inner"
              >
                <img
                  ref={label === "Blended" ? imgRef : undefined}
                  src={garmentUrl}
                  alt={`Garment ${side}`}
                  className="block max-h-[min(50vh,420px)] w-auto max-w-full mx-auto select-none"
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
                  <div
                    className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing"
                    style={{
                      left: `${px * 100}%`,
                      top: `${py * 100}%`,
                      width: `${artBase * scale * 100}%`,
                      aspectRatio: `${DESIGN_ARTBOARD_WIDTH_PX} / ${DESIGN_ARTBOARD_HEIGHT_PX}`,
                      height: "auto",
                      transform: "translate(-50%, -50%)",
                      opacity: blended ? previewOpacity : 1,
                      mixBlendMode: blended
                        ? (cssMixBlendMode(zoneBlend.blendMode) as React.CSSProperties["mixBlendMode"])
                        : "normal",
                      filter:
                        blended && is8394SimpleBackUi
                          ? previewFilter
                          : is8394SimpleBackUi
                            ? "contrast(100%)"
                            : undefined,
                    }}
                    onPointerDown={handlePointerDownOverlay}
                  >
                    <img
                      src={overlayArtUrl}
                      alt="Sample design"
                      className="w-full h-full object-contain drop-shadow-md pointer-events-none select-none"
                      draggable={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          data-garment-preview
          className="relative inline-block max-w-full mx-auto border border-gray-200 rounded-lg bg-gray-100 overflow-hidden shadow-inner"
        >
          <img
            ref={imgRef}
            src={garmentUrl}
            alt={`Garment ${side}`}
            className="block max-h-[min(70vh,720px)] w-auto max-w-full mx-auto select-none"
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
            <div
              className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing"
              style={{
                left: `${px * 100}%`,
                top: `${py * 100}%`,
                width: `${artBase * scale * 100}%`,
                aspectRatio: `${DESIGN_ARTBOARD_WIDTH_PX} / ${DESIGN_ARTBOARD_HEIGHT_PX}`,
                height: "auto",
                transform: "translate(-50%, -50%)",
                opacity: canvasOpacity,
                mixBlendMode: canvasMixBlend,
                filter: canvasFilter,
              }}
              onPointerDown={handlePointerDownOverlay}
            >
              <img
                src={overlayArtUrl}
                alt="Sample design"
                className="w-full h-full object-contain drop-shadow-md pointer-events-none select-none"
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}

      {previewLightbox && garmentUrl ? (
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
              src={garmentUrl}
              alt="Preview enlarged"
              className="max-h-[88vh] w-auto mx-auto rounded-lg shadow-2xl"
            />
            <button
              type="button"
              className="absolute -top-2 -right-2 px-3 py-1.5 rounded-lg bg-white text-gray-800 text-sm font-semibold shadow-lg border border-gray-200 hover:bg-gray-50"
              onClick={() => setPreviewLightbox(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save render profile"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          Reset
        </button>
      </div>

      <details className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
        <summary className="cursor-pointer font-medium text-gray-800">Advanced — numeric & mask metadata</summary>
        <p className="text-[#737373] text-xs mt-2 mb-3">
          Primary editing is visual above. These fields map 1:1 to Firestore on the placement row.
        </p>
        {!is8394SimpleBackUi && (
          <div className="mb-4 p-3 rounded-lg border border-gray-200 bg-white space-y-2">
            <p className="text-xs font-semibold text-gray-800">Blend details (optional)</p>
            <p className="text-[10px] text-[#737373]">
              Prefer <strong>Render Style</strong> presets in the main editor. Use this only for a custom engine blend.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={zoneBlendMode || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    updateSelected({ renderZoneDefaults: null });
                  } else {
                    updateSelected({
                      renderZoneDefaults: {
                        blendMode: v,
                        blendOpacity: zoneBlendOpacity ?? zoneBlend.blendOpacity,
                      },
                    });
                  }
                }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900"
              >
                <option value="">Inherit blank default</option>
                {BLEND_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label className="text-xs text-gray-800 flex items-center gap-2">
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
            8394 back uses simple controls above. Safe area still applies automatically; no manual mask editing in MVP.
          </p>
        )}
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${is8394SimpleBackUi ? "opacity-50 pointer-events-none" : ""}`}>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Center X</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={px}
              onChange={(e) => updateSelected({ defaultX: Number(e.target.value) })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Center Y</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={py}
              onChange={(e) => updateSelected({ defaultY: Number(e.target.value) })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Scale</span>
            <input
              type="number"
              step={0.01}
              min={0.1}
              max={2}
              value={scale}
              onChange={(e) => updateSelected({ defaultScale: Number(e.target.value) })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Artboard base</span>
            <input
              type="number"
              step={0.05}
              min={0.1}
              max={1}
              value={artBase}
              onChange={(e) => updateSelected({ artboardBase: Number(e.target.value) })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
        </div>
        <p className="text-[10px] text-[#737373] mt-3">
          <strong>Artboard:</strong> design files are{" "}
          <span className="font-mono">
            {DESIGN_ARTBOARD_WIDTH_PX}×{DESIGN_ARTBOARD_HEIGHT_PX}px
          </span>{" "}
          (8∶5). The <strong>orange safe overlay</strong> is drawn with that aspect using <strong>Safe W</strong> (Safe H
          below is still saved for masks / other tools and may differ from the overlay height).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Safe X</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={sx}
              onChange={(e) => updateSelected({ safeArea: { x: Number(e.target.value) } })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Safe Y</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={sy}
              onChange={(e) => updateSelected({ safeArea: { y: Number(e.target.value) } })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Safe W</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={sw}
              onChange={(e) => updateSelected({ safeArea: { w: Number(e.target.value) } })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Safe H</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={sh}
              onChange={(e) => updateSelected({ safeArea: { h: Number(e.target.value) } })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Zone label</span>
            <input
              value={selected?.label ?? ""}
              onChange={(e) => updateSelected({ label: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Canonical view</span>
            <select
              value={selected?.view ?? "front"}
              onChange={(e) => updateSelected({ view: e.target.value as "front" | "back" })}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            >
              <option value="front">Front</option>
              <option value="back">Back</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Design asset mode</span>
            <select
              value={selected?.allowedDesignAssetMode ?? "light_dark"}
              onChange={(e) =>
                updateSelected({
                  allowedDesignAssetMode: e.target.value as RPPlacement["allowedDesignAssetMode"],
                })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
            >
              <option value="light_dark">Light + dark PNG</option>
              <option value="light_only">Light PNG only</option>
              <option value="dark_only">Dark PNG only</option>
            </select>
          </label>
          {!is8394SimpleBackUi && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-600">Mask / clip strategy</span>
              <select
                value={selected?.maskConfig?.mode ?? "none"}
                onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
              >
                <option value="none">None (MVP)</option>
                <option value="blank_mask_doc">Use rp_blank_masks doc (future)</option>
                <option value="safe_area_clip">Clip to safe area (future)</option>
              </select>
            </label>
          )}
        </div>
        <label className="flex flex-col gap-1 mt-3">
          <span className="text-xs text-gray-600">Artboard / export notes</span>
          <textarea
            value={selected?.artboardNotes ?? ""}
            onChange={(e) => updateSelected({ artboardNotes: e.target.value })}
            rows={2}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 mt-2">
          <span className="text-xs text-gray-600">Zone notes</span>
          <textarea
            value={selected?.notes ?? ""}
            onChange={(e) => updateSelected({ notes: e.target.value })}
            rows={2}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
          />
        </label>
      </details>
    </div>
  );
}
