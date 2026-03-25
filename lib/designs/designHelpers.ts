import type { DesignDoc, DesignGarmentSideAssetUrls, RPBlankVariant } from "@/lib/types/firestore";
import { getEffectiveColorFamily } from "@/lib/blanks/colorFamily";

export type GarmentSide = "front" | "back";

type FlatAssetUrls = {
  lightPng: string | null;
  darkPng: string | null;
  lightSvg: string | null;
  darkSvg: string | null;
  svg: string | null;
  lightPdf: string | null;
  darkPdf: string | null;
  pdf: string | null;
};

/** Legacy flat URLs only (no side-aware nesting). */
function resolveLegacyFlatAssetUrls(design: DesignDoc | null | undefined): FlatAssetUrls {
  if (!design) {
    return {
      lightPng: null,
      darkPng: null,
      lightSvg: null,
      darkSvg: null,
      svg: null,
      lightPdf: null,
      darkPdf: null,
      pdf: null,
    };
  }
  const a = design.assets || {};
  const f = design.files || {};
  const lightSvg =
    a.lightSvg ?? f.lightSvg?.downloadUrl ?? f.svg?.downloadUrl ?? null;
  const darkSvg = a.darkSvg ?? f.darkSvg?.downloadUrl ?? null;
  const lightPdf = a.lightPdf ?? f.lightPdf?.downloadUrl ?? f.pdf?.downloadUrl ?? null;
  const darkPdf = a.darkPdf ?? f.darkPdf?.downloadUrl ?? null;
  return {
    lightPng: a.lightPng ?? f.lightPng?.downloadUrl ?? f.png?.downloadUrl ?? null,
    darkPng: a.darkPng ?? f.darkPng?.downloadUrl ?? null,
    lightSvg,
    darkSvg,
    svg:
      a.svg ??
      f.svg?.downloadUrl ??
      f.lightSvg?.downloadUrl ??
      f.darkSvg?.downloadUrl ??
      null,
    lightPdf,
    darkPdf,
    pdf:
      a.pdf ??
      f.pdf?.downloadUrl ??
      f.lightPdf?.downloadUrl ??
      f.darkPdf?.downloadUrl ??
      null,
  };
}

function sideHasNestedPng(design: DesignDoc, side: GarmentSide): boolean {
  const a = design.assets?.[side];
  const f = design.files?.[side];
  return !!(a?.lightPng || a?.darkPng || f?.lightPng?.downloadUrl || f?.darkPng?.downloadUrl);
}

function hasAnySideAwareAssets(design: DesignDoc): boolean {
  return sideHasNestedPng(design, "front") || sideHasNestedPng(design, "back");
}

/**
 * When legacy flat `assets.lightPng` / `darkPng` exist but no nested side URLs, map them to a side.
 * Rule: `supportedSides` only → that side; otherwise **back** (typical apparel default).
 */
function legacyFlatTargetsSide(design: DesignDoc, side: GarmentSide): boolean {
  const flat = resolveLegacyFlatAssetUrls(design);
  const hasLegacy = !!(flat.lightPng || flat.darkPng);
  if (!hasLegacy || hasAnySideAwareAssets(design)) return false;

  const ss = design.supportedSides?.map((s) => String(s).trim().toLowerCase()) ?? [];
  if (ss.length === 1) {
    if (ss[0] === "front") return side === "front";
    if (ss[0] === "back") return side === "back";
  }
  return side === "back";
}

/**
 * Resolved URLs for one print side (front or back), merging nested `assets`/`files` with legacy flat fallbacks.
 */
export function resolveDesignSideAssets(
  design: DesignDoc | null | undefined,
  side: GarmentSide
): FlatAssetUrls {
  if (!design) {
    return resolveLegacyFlatAssetUrls(null);
  }
  const a = design.assets?.[side];
  const f = design.files?.[side];
  const pick = (slot: keyof DesignGarmentSideAssetUrls): string | null =>
    (a?.[slot] as string | null | undefined) ??
    (f?.[slot as keyof typeof f] as { downloadUrl?: string } | undefined)?.downloadUrl ??
    null;

  let lightPng = pick("lightPng");
  let darkPng = pick("darkPng");
  let lightSvg = pick("lightSvg");
  let darkSvg = pick("darkSvg");
  let lightPdf = pick("lightPdf");
  let darkPdf = pick("darkPdf");

  const flat = resolveLegacyFlatAssetUrls(design);
  if (legacyFlatTargetsSide(design, side)) {
    lightPng = lightPng ?? flat.lightPng;
    darkPng = darkPng ?? flat.darkPng;
    lightSvg = lightSvg ?? flat.lightSvg;
    darkSvg = darkSvg ?? flat.darkSvg;
    lightPdf = lightPdf ?? flat.lightPdf;
    darkPdf = darkPdf ?? flat.darkPdf;
  }

  const svg =
    lightSvg || darkSvg || flat.svg
      ? lightSvg || darkSvg || flat.svg
      : null;
  const pdf =
    lightPdf || darkPdf || flat.pdf
      ? lightPdf || darkPdf || flat.pdf
      : null;

  return {
    lightPng,
    darkPng,
    lightSvg,
    darkSvg,
    svg,
    lightPdf,
    darkPdf,
    pdf,
  };
}

/** Default side for legacy single-pair designs and overview previews. */
export function getDefaultDesignAssetSide(design: DesignDoc | null | undefined): GarmentSide {
  if (!design) return "back";
  const ss = design.supportedSides?.map((s) => String(s).trim().toLowerCase()) ?? [];
  if (ss.length === 1 && ss[0] === "front") return "front";
  if (ss.length === 1 && ss[0] === "back") return "back";
  if (sideHasNestedPng(design, "back") && !sideHasNestedPng(design, "front")) return "back";
  if (sideHasNestedPng(design, "front") && !sideHasNestedPng(design, "back")) return "front";
  return "back";
}

/**
 * Flattened garment URLs for the design’s **default print side** (backward compatible with pre–side-aware docs).
 * Prefer `resolveDesignSideAssets` when you know front vs back (e.g. product placement).
 */
export function resolveDesignAssets(design: DesignDoc | null | undefined): FlatAssetUrls {
  if (!design) return resolveLegacyFlatAssetUrls(null);
  return resolveDesignSideAssets(design, getDefaultDesignAssetSide(design));
}

/** True if any side (or legacy flat) has a usable PNG for previews / batch gates. */
export function designHasUsablePng(design: DesignDoc | null | undefined): boolean {
  if (!design) return false;
  const f = resolveDesignSideAssets(design, "front");
  const b = resolveDesignSideAssets(design, "back");
  return !!(f.lightPng || f.darkPng || b.lightPng || b.darkPng);
}

/** Both light and dark garment PNGs for the **default** side. */
export function designHasLightAndDarkPng(design: DesignDoc | null | undefined): boolean {
  const u = resolveDesignAssets(design);
  return !!(u.lightPng && u.darkPng);
}

function derivePrintSidesFromAssetPresence(design: DesignDoc): DesignPrintSidesMode | null {
  const hasF =
    !!(resolveDesignSideAssets(design, "front").lightPng || resolveDesignSideAssets(design, "front").darkPng);
  const hasB =
    !!(resolveDesignSideAssets(design, "back").lightPng || resolveDesignSideAssets(design, "back").darkPng);
  if (hasF && hasB) return "both";
  if (hasB && !hasF) return "back";
  if (hasF && !hasB) return "front";
  return null;
}

/**
 * Whether this design’s raster artwork should apply on the given garment side.
 * Uses `supportedSides` when set; otherwise asset presence; then placement defaults.
 */
export function designSupportsGarmentSide(
  design: DesignDoc | null | undefined,
  side: GarmentSide
): boolean {
  if (!design) return false;
  const ss = design.supportedSides;
  if (Array.isArray(ss) && ss.length > 0) {
    const norm = ss.map((s) => String(s).trim().toLowerCase());
    if (side === "front") return norm.includes("front");
    return norm.includes("back");
  }

  const derived = derivePrintSidesFromAssetPresence(design);
  if (derived === "front") return side === "front";
  if (derived === "back") return side === "back";
  if (derived === "both") return true;

  const defs = design.placementDefaults ?? [];
  if (defs.length > 0) {
    const ids = defs.map((d) => String(d.placementId || "").toLowerCase());
    const hasFront = ids.some((id) => id.includes("front"));
    const hasBack = ids.some((id) => id.includes("back"));
    if (hasFront && hasBack) return true;
    if (hasFront && !hasBack) return side === "front";
    if (hasBack && !hasFront) return side === "back";
  }

  return true;
}

/**
 * How the design doc maps to the Design page “Print sides” control.
 * Firestore field: **`supportedSides`** (string array: `front`, `back`). When unset / empty, derived from which
 * side keys have assets (`assets.front` / `assets.back`), then placement defaults.
 */
export type DesignPrintSidesMode = "both" | "front" | "back";

export function getDesignPrintSidesMode(design: DesignDoc | null | undefined): DesignPrintSidesMode {
  if (!design) return "both";
  const ss = design.supportedSides;
  if (Array.isArray(ss) && ss.length > 0) {
    const norm = ss.map((s) => String(s).trim().toLowerCase());
    const hasF = norm.includes("front");
    const hasB = norm.includes("back");
    if (hasF && hasB) return "both";
    if (hasB && !hasF) return "back";
    if (hasF && !hasB) return "front";
    return "both";
  }

  const fromAssets = derivePrintSidesFromAssetPresence(design);
  if (fromAssets) return fromAssets;

  const defs = design.placementDefaults ?? [];
  if (defs.length > 0) {
    const ids = defs.map((d) => String(d.placementId || "").toLowerCase());
    const hasFront = ids.some((id) => id.includes("front"));
    const hasBack = ids.some((id) => id.includes("back"));
    if (hasFront && hasBack) return "both";
    if (hasBack && !hasFront) return "back";
    if (hasFront && !hasBack) return "front";
  }

  return "both";
}

export type CompletenessLevel = "complete" | "partial" | "missing";

export function computeDesignCompleteness(design: DesignDoc): {
  level: CompletenessLevel;
  label: string;
  detail: string;
} {
  const hasName = !!design.name?.trim();
  const hasTeam = !!design.teamId?.trim();
  const hasType = !!design.designType;
  const u = resolveDesignAssets(design);
  const hasLight = !!u.lightPng;
  const hasDark = !!u.darkPng;

  if (hasName && hasTeam && hasType && hasLight && hasDark) {
    return { level: "complete", label: "Complete", detail: "Ready for generation" };
  }

  const missing: string[] = [];
  if (!hasName) missing.push("name");
  if (!hasTeam) missing.push("team");
  if (!hasType) missing.push("design type");
  if (!hasLight) missing.push("light garment PNG (default side)");
  if (!hasDark) missing.push("dark garment PNG (default side)");

  const partial = hasName || hasTeam || hasType || hasLight || hasDark;

  return {
    level: partial ? "partial" : "missing",
    label: partial ? "Partial" : "Missing",
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "Incomplete",
  };
}

export function designFileSummary(design: DesignDoc): string {
  const u = resolveDesignAssets(design);
  const parts: string[] = [];
  if (u.lightPng) parts.push("L");
  if (u.darkPng) parts.push("D");
  if (u.lightSvg) parts.push("Lsvg");
  if (u.darkSvg) parts.push("Dsvg");
  if (!u.lightSvg && !u.darkSvg && u.svg) parts.push("SVG");
  if (u.lightPdf) parts.push("Lpdf");
  if (u.darkPdf) parts.push("Dpdf");
  if (!u.lightPdf && !u.darkPdf && u.pdf) parts.push("PDF");
  return parts.length ? parts.join("·") : "—";
}

export function designAssetsInventory(design: DesignDoc): {
  light: boolean;
  dark: boolean;
  legacyPngOnly: boolean;
  svg: boolean;
  pdf: boolean;
} {
  const u = resolveDesignAssets(design);
  const f = design.files || {};
  const legacyOnly = !!(f.png?.downloadUrl && !f.lightPng?.downloadUrl && !f.darkPng?.downloadUrl);
  return {
    light: !!u.lightPng,
    dark: !!u.darkPng,
    legacyPngOnly: legacyOnly,
    svg: !!(u.lightSvg || u.darkSvg || u.svg),
    pdf: !!(u.lightPdf || u.darkPdf || u.pdf),
  };
}

export function designGarmentAssetBadges(design: DesignDoc): { light: boolean; dark: boolean } {
  const u = resolveDesignAssets(design);
  return { light: !!u.lightPng, dark: !!u.darkPng };
}

/**
 * Preview image: prefer default side light PNG, then dark, then SVGs.
 * @deprecated Prefer `resolveDesignSideAssets` when side is known.
 */
export function getDesignPreviewUrl(design: DesignDoc | null | undefined): string | undefined {
  const u = resolveDesignAssets(design);
  return (
    u.lightPng ||
    u.darkPng ||
    u.lightSvg ||
    u.darkSvg ||
    u.svg ||
    undefined
  );
}

/** Light garment PNG URL for default side (includes legacy single-PNG as light-only). */
export function getDesignAssetLightPngUrl(design: DesignDoc | null | undefined): string | null {
  return resolveDesignAssets(design).lightPng;
}

export function getDesignAssetDarkPngUrl(design: DesignDoc | null | undefined): string | null {
  return resolveDesignAssets(design).darkPng;
}

/**
 * Pick raster URL for a blank variant’s garment color family on a **specific print side**
 * (e.g. `back` for 8394 flat render MVP).
 */
export function pickDesignPngUrlForVariant(
  design: DesignDoc,
  variant: Pick<RPBlankVariant, "colorFamily" | "colorName">,
  placementSide: GarmentSide = "back"
): { url: string | null; ref: "light" | "dark" } {
  const fam = getEffectiveColorFamily(variant.colorFamily, variant.colorName);
  const u = resolveDesignSideAssets(design, placementSide);
  if (fam === "dark") {
    return { url: u.darkPng ?? u.lightPng, ref: u.darkPng ? "dark" : "light" };
  }
  return { url: u.lightPng ?? u.darkPng, ref: u.lightPng ? "light" : "dark" };
}

export function pickDesignAssetUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back"
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  if (garmentColorFamily === "dark") return u.darkPng;
  return u.lightPng;
}

export function pickDesignPdfUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back"
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  if (garmentColorFamily === "dark") {
    return u.darkPdf ?? u.lightPdf ?? u.pdf ?? null;
  }
  return u.lightPdf ?? u.darkPdf ?? u.pdf ?? null;
}

export function pickDesignSvgUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back"
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  if (garmentColorFamily === "dark") {
    return u.darkSvg ?? u.lightSvg ?? u.svg ?? null;
  }
  return u.lightSvg ?? u.darkSvg ?? u.svg ?? null;
}
