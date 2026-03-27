import type {
  DesignDoc,
  DesignFile,
  DesignGarmentSideAssetUrls,
  DesignGarmentSideFiles,
  RPBlankArtworkTone,
  RPBlankVariant,
} from "@/lib/types/firestore";
import { getEffectiveColorFamily } from "@/lib/blanks/colorFamily";
import {
  pickAssetUrlForVariant,
  pickRasterUrlForVariant,
  type ArtworkToneSlot,
} from "@/lib/designs/artworkToneResolution";

export type GarmentSide = "front" | "back";

type FlatAssetUrls = {
  lightPng: string | null;
  darkPng: string | null;
  whitePng: string | null;
  lightSvg: string | null;
  darkSvg: string | null;
  whiteSvg: string | null;
  svg: string | null;
  lightPdf: string | null;
  darkPdf: string | null;
  whitePdf: string | null;
  pdf: string | null;
};

/** Legacy flat URLs only (no side-aware nesting). */
function resolveLegacyFlatAssetUrls(design: DesignDoc | null | undefined): FlatAssetUrls {
  if (!design) {
    return {
      lightPng: null,
      darkPng: null,
      whitePng: null,
      lightSvg: null,
      darkSvg: null,
      whiteSvg: null,
      svg: null,
      lightPdf: null,
      darkPdf: null,
      whitePdf: null,
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
    whitePng: a.whitePng ?? f.whitePng?.downloadUrl ?? null,
    lightSvg,
    darkSvg,
    whiteSvg: a.whiteSvg ?? f.whiteSvg?.downloadUrl ?? null,
    svg:
      a.svg ??
      f.svg?.downloadUrl ??
      f.lightSvg?.downloadUrl ??
      f.darkSvg?.downloadUrl ??
      null,
    lightPdf,
    darkPdf,
    whitePdf: a.whitePdf ?? f.whitePdf?.downloadUrl ?? null,
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
  return !!(
    a?.lightPng ||
    a?.darkPng ||
    a?.whitePng ||
    f?.lightPng?.downloadUrl ||
    f?.darkPng?.downloadUrl ||
    f?.whitePng?.downloadUrl
  );
}

function hasAnySideAwareAssets(design: DesignDoc): boolean {
  return sideHasNestedPng(design, "front") || sideHasNestedPng(design, "back");
}

/**
 * When legacy flat `assets.lightPng` / `darkPng` / `whitePng` exist but no nested side URLs, map them for resolution.
 * - `supportedSides` length 1 → that garment side only.
 * - Otherwise (unset / both): same tone files apply to **any** requested print side — placement comes from blank/product build.
 */
function legacyFlatTargetsSide(design: DesignDoc, side: GarmentSide): boolean {
  const flat = resolveLegacyFlatAssetUrls(design);
  const hasLegacy = !!(flat.lightPng || flat.darkPng || flat.whitePng);
  if (!hasLegacy || hasAnySideAwareAssets(design)) return false;

  const ss = design.supportedSides?.map((s) => String(s).trim().toLowerCase()) ?? [];
  if (ss.length === 1) {
    if (ss[0] === "front") return side === "front";
    if (ss[0] === "back") return side === "back";
  }
  if (ss.length === 0 || (ss.includes("front") && ss.includes("back"))) {
    return true;
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
  let whitePng = pick("whitePng");
  let lightSvg = pick("lightSvg");
  let darkSvg = pick("darkSvg");
  let whiteSvg = pick("whiteSvg");
  let lightPdf = pick("lightPdf");
  let darkPdf = pick("darkPdf");
  let whitePdf = pick("whitePdf");

  const flat = resolveLegacyFlatAssetUrls(design);
  if (legacyFlatTargetsSide(design, side)) {
    lightPng = lightPng ?? flat.lightPng;
    darkPng = darkPng ?? flat.darkPng;
    whitePng = whitePng ?? flat.whitePng;
    lightSvg = lightSvg ?? flat.lightSvg;
    darkSvg = darkSvg ?? flat.darkSvg;
    whiteSvg = whiteSvg ?? flat.whiteSvg;
    lightPdf = lightPdf ?? flat.lightPdf;
    darkPdf = darkPdf ?? flat.darkPdf;
    whitePdf = whitePdf ?? flat.whitePdf;
  }

  const svg =
    lightSvg || darkSvg || whiteSvg || flat.svg
      ? lightSvg || darkSvg || whiteSvg || flat.svg
      : null;
  const pdf =
    lightPdf || darkPdf || whitePdf || flat.pdf
      ? lightPdf || darkPdf || whitePdf || flat.pdf
      : null;

  return {
    lightPng,
    darkPng,
    whitePng,
    lightSvg,
    darkSvg,
    whiteSvg,
    svg,
    lightPdf,
    darkPdf,
    whitePdf,
    pdf,
  };
}

export type DesignSideFileSlot = keyof DesignGarmentSideFiles;

function legacyRootDesignFileForSlot(design: DesignDoc, slot: DesignSideFileSlot): DesignFile | undefined {
  const f = design.files;
  if (!f) return undefined;
  switch (slot) {
    case "lightPng":
      return f.lightPng ?? f.png;
    case "darkPng":
      return f.darkPng;
    case "whitePng":
      return f.whitePng;
    case "lightSvg":
      return f.lightSvg ?? f.svg;
    case "darkSvg":
      return f.darkSvg;
    case "whiteSvg":
      return f.whiteSvg;
    case "lightPdf":
      return f.lightPdf ?? f.pdf;
    case "darkPdf":
      return f.darkPdf;
    case "whitePdf":
      return f.whitePdf;
    default:
      return undefined;
  }
}

function flatAssetUrlForSlot(u: FlatAssetUrls, slot: DesignSideFileSlot): string | null {
  const v = u[slot];
  return v && typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Design detail **Files** tab: show thumbnails for nested `files.{front,back}`, legacy root files,
 * and `assets` URLs (same merge rules as `resolveDesignSideAssets`).
 */
export function resolveFilesTabSlotDisplay(
  design: DesignDoc,
  side: GarmentSide,
  slot: DesignSideFileSlot
): {
  previewUrl: string | null;
  file: DesignFile | null;
  /** Set when the row is driven by legacy root or assets URL mapping, not `files[side][slot]` */
  isMappedFallback?: boolean;
} {
  const nested = design.files?.[side]?.[slot];
  if (nested?.downloadUrl) {
    return { previewUrl: nested.downloadUrl, file: nested };
  }

  if (legacyFlatTargetsSide(design, side)) {
    const lf = legacyRootDesignFileForSlot(design, slot);
    if (lf?.downloadUrl) {
      return { previewUrl: lf.downloadUrl, file: lf, isMappedFallback: true };
    }
  }

  const merged = resolveDesignSideAssets(design, side);
  const url = flatAssetUrlForSlot(merged, slot);
  if (url) {
    return { previewUrl: url, file: null, isMappedFallback: true };
  }
  return { previewUrl: null, file: null };
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
  return !!(f.lightPng || f.darkPng || f.whitePng || b.lightPng || b.darkPng || b.whitePng);
}

/** Both light and dark garment PNGs for the **default** side. */
export function designHasLightAndDarkPng(design: DesignDoc | null | undefined): boolean {
  const u = resolveDesignAssets(design);
  return !!(u.lightPng && u.darkPng);
}

function derivePrintSidesFromAssetPresence(design: DesignDoc): DesignPrintSidesMode | null {
  const f = resolveDesignSideAssets(design, "front");
  const b = resolveDesignSideAssets(design, "back");
  const hasF = !!(f.lightPng || f.darkPng || f.whitePng);
  const hasB = !!(b.lightPng || b.darkPng || b.whitePng);
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
 * Which sides have artwork assets — maps to the Design page “Artwork sides available” control.
 * Firestore field: **`supportedSides`** (`front` / `back`). When unset / empty, derived from nested assets
 * or side-agnostic flat tone files, then placement defaults. Does **not** control garment print placement
 * (see blank `defaultPrintSides`); batch-import filename `front`/`back` tokens are legacy-only.
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
  if (u.whitePng) parts.push("W");
  if (u.lightSvg) parts.push("Lsvg");
  if (u.darkSvg) parts.push("Dsvg");
  if (u.whiteSvg) parts.push("Wsvg");
  if (!u.lightSvg && !u.darkSvg && !u.whiteSvg && u.svg) parts.push("SVG");
  if (u.lightPdf) parts.push("Lpdf");
  if (u.darkPdf) parts.push("Dpdf");
  if (u.whitePdf) parts.push("Wpdf");
  if (!u.lightPdf && !u.darkPdf && !u.whitePdf && u.pdf) parts.push("PDF");
  return parts.length ? parts.join("·") : "—";
}

export function designAssetsInventory(design: DesignDoc): {
  light: boolean;
  dark: boolean;
  white: boolean;
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
    white: !!u.whitePng,
    legacyPngOnly: legacyOnly,
    svg: !!(u.lightSvg || u.darkSvg || u.whiteSvg || u.svg),
    pdf: !!(u.lightPdf || u.darkPdf || u.whitePdf || u.pdf),
  };
}

export function designGarmentAssetBadges(design: DesignDoc): { light: boolean; dark: boolean; white: boolean } {
  const u = resolveDesignAssets(design);
  return { light: !!u.lightPng, dark: !!u.darkPng, white: !!u.whitePng };
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
    u.whitePng ||
    u.lightSvg ||
    u.darkSvg ||
    u.whiteSvg ||
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

function effectiveFamilyFromStrings(
  garmentColorFamily: string | null | undefined,
  colorName?: string | null
) {
  return getEffectiveColorFamily(
    garmentColorFamily === "light" || garmentColorFamily === "dark" ? garmentColorFamily : undefined,
    colorName
  );
}

/**
 * Pick raster URL for a blank variant’s garment color family on a **specific print side**
 * (e.g. `back` for 8394 flat render MVP).
 */
export function pickDesignPngUrlForVariant(
  design: DesignDoc,
  variant: Pick<RPBlankVariant, "colorFamily" | "colorName" | "preferredArtworkTone">,
  placementSide: GarmentSide = "back"
): { url: string | null; ref: ArtworkToneSlot | null } {
  const fam = getEffectiveColorFamily(variant.colorFamily, variant.colorName);
  const u = resolveDesignSideAssets(design, placementSide);
  return pickRasterUrlForVariant(
    {
      lightPng: u.lightPng,
      darkPng: u.darkPng,
      whitePng: u.whitePng,
    },
    fam,
    variant.preferredArtworkTone
  );
}

export function pickDesignAssetUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back",
  preferredArtworkTone?: RPBlankArtworkTone | null,
  colorName?: string | null
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  const fam = effectiveFamilyFromStrings(garmentColorFamily, colorName);
  return pickRasterUrlForVariant(
    { lightPng: u.lightPng, darkPng: u.darkPng, whitePng: u.whitePng },
    fam,
    preferredArtworkTone
  ).url;
}

export function pickDesignPdfUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back",
  preferredArtworkTone?: RPBlankArtworkTone | null,
  colorName?: string | null
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  const fam = effectiveFamilyFromStrings(garmentColorFamily, colorName);
  const { url } = pickAssetUrlForVariant(
    { light: u.lightPdf, dark: u.darkPdf, white: u.whitePdf },
    fam,
    preferredArtworkTone
  );
  if (url) return url;
  return u.pdf ?? null;
}

export function pickDesignSvgUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined,
  placementSide: GarmentSide = "back",
  preferredArtworkTone?: RPBlankArtworkTone | null,
  colorName?: string | null
): string | null {
  const u = resolveDesignSideAssets(design, placementSide);
  const fam = effectiveFamilyFromStrings(garmentColorFamily, colorName);
  const { url } = pickAssetUrlForVariant(
    { light: u.lightSvg, dark: u.darkSvg, white: u.whiteSvg },
    fam,
    preferredArtworkTone
  );
  if (url) return url;
  return u.svg ?? null;
}
