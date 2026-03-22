import type { DesignDoc } from "@/lib/types/firestore";

/** Resolve URLs from canonical `assets` or legacy `files.*.downloadUrl`. Legacy single `files.png` maps to light garment only. */
export function resolveDesignAssets(design: DesignDoc | null | undefined): {
  lightPng: string | null;
  darkPng: string | null;
  lightSvg: string | null;
  darkSvg: string | null;
  /** Any vector URL (legacy single slot or either variant) */
  svg: string | null;
  lightPdf: string | null;
  darkPdf: string | null;
  /** Any PDF URL (legacy or either variant) */
  pdf: string | null;
} {
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
  const a = design.assets;
  const f = design.files || {};
  const lightSvg =
    a?.lightSvg ?? f.lightSvg?.downloadUrl ?? f.svg?.downloadUrl ?? null;
  const darkSvg = a?.darkSvg ?? f.darkSvg?.downloadUrl ?? null;
  const lightPdf =
    a?.lightPdf ?? f.lightPdf?.downloadUrl ?? f.pdf?.downloadUrl ?? null;
  const darkPdf = a?.darkPdf ?? f.darkPdf?.downloadUrl ?? null;
  return {
    lightPng: a?.lightPng ?? f.lightPng?.downloadUrl ?? f.png?.downloadUrl ?? null,
    darkPng: a?.darkPng ?? f.darkPng?.downloadUrl ?? null,
    lightSvg,
    darkSvg,
    svg:
      a?.svg ??
      f.svg?.downloadUrl ??
      f.lightSvg?.downloadUrl ??
      f.darkSvg?.downloadUrl ??
      null,
    lightPdf,
    darkPdf,
    pdf:
      a?.pdf ??
      f.pdf?.downloadUrl ??
      f.lightPdf?.downloadUrl ??
      f.darkPdf?.downloadUrl ??
      null,
  };
}

/** Light garment PNG URL (includes legacy single-PNG as light-only). */
export function getDesignAssetLightPngUrl(design: DesignDoc | null | undefined): string | null {
  return resolveDesignAssets(design).lightPng;
}

/** Dark garment PNG URL. */
export function getDesignAssetDarkPngUrl(design: DesignDoc | null | undefined): string | null {
  return resolveDesignAssets(design).darkPng;
}

/**
 * Preview image: prefer light garment asset, then dark, then SVG.
 * @deprecated Use resolveDesignAssets for explicit variant selection.
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

/** True if any usable PNG exists for legacy flows (preview / batch). */
export function designHasUsablePng(design: DesignDoc | null | undefined): boolean {
  const u = resolveDesignAssets(design);
  return !!(u.lightPng || u.darkPng);
}

/** Both light and dark garment PNGs present (complete pipeline). */
export function designHasLightAndDarkPng(design: DesignDoc | null | undefined): boolean {
  const u = resolveDesignAssets(design);
  return !!(u.lightPng && u.darkPng);
}

/**
 * Whether this design's raster artwork should apply on the given garment side (preview, render setup, mockup).
 * - Uses `supportedSides` when set (e.g. batch import: `['back']` for back-only art).
 * - Otherwise infers from `placementDefaults`: if only front_* or only back_* ids appear, restricts to that side.
 * - If both front and back appear in defaults (e.g. front_center + back_center), treats as both sides (legacy).
 */
export function designSupportsGarmentSide(
  design: DesignDoc | null | undefined,
  side: "front" | "back"
): boolean {
  if (!design) return false;
  const ss = design.supportedSides;
  if (Array.isArray(ss) && ss.length > 0) {
    const norm = ss.map((s) => String(s).trim().toLowerCase());
    if (side === "front") return norm.includes("front");
    return norm.includes("back");
  }

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

/** How the design doc encodes `supportedSides` for editors (Design Detail → Print sides). */
export type DesignPrintSidesMode = "both" | "front" | "back";

export function getDesignPrintSidesMode(design: DesignDoc | null | undefined): DesignPrintSidesMode {
  if (!design) return "both";
  const ss = design.supportedSides;
  if (!Array.isArray(ss) || ss.length === 0) return "both";
  const norm = ss.map((s) => String(s).trim().toLowerCase());
  const hasF = norm.includes("front");
  const hasB = norm.includes("back");
  if (hasF && hasB) return "both";
  if (hasB && !hasF) return "back";
  if (hasF && !hasB) return "front";
  return "both";
}

export type CompletenessLevel = "complete" | "partial" | "missing";

/**
 * Complete only when: name, team, design theme (`designType` field), light garment PNG, dark garment PNG.
 * Legacy single PNG → counts as light only; dark missing → incomplete.
 */
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
  if (!hasLight) missing.push("light garment PNG");
  if (!hasDark) missing.push("dark garment PNG");

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

/** @deprecated Prefer designGarmentAssetBadges */
export function designAssetsLabel(design: DesignDoc): string {
  const a = designAssetsInventory(design);
  const yn = (ok: boolean) => (ok ? "✓" : "—");
  return `Light ${yn(a.light)} · Dark ${yn(a.dark)} · SVG ${yn(a.svg)} · PDF ${yn(a.pdf)}`;
}

/** Badges for Designs Library table: Light Garment / Dark Garment */
export function designGarmentAssetBadges(design: DesignDoc): { light: boolean; dark: boolean } {
  const u = resolveDesignAssets(design);
  return { light: !!u.lightPng, dark: !!u.darkPng };
}

/**
 * Renderer hook: pick garment-variant URL (not ink). Align with your blank `colorFamily` / `garment.colorFamily`.
 * Example: `colorFamily === "dark"` → dark garment overlay.
 */
export function pickDesignAssetUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined
): string | null {
  const u = resolveDesignAssets(design);
  if (garmentColorFamily === "dark") return u.darkPng;
  return u.lightPng;
}

/** Print-ready PDF by garment color family; falls back to legacy single `pdf` / other variant. */
export function pickDesignPdfUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined
): string | null {
  const u = resolveDesignAssets(design);
  if (garmentColorFamily === "dark") {
    return u.darkPdf ?? u.lightPdf ?? u.pdf ?? null;
  }
  return u.lightPdf ?? u.darkPdf ?? u.pdf ?? null;
}

/** Production SVG by garment color family; falls back to legacy single `svg` / other variant. */
export function pickDesignSvgUrlForGarment(
  design: DesignDoc | null | undefined,
  garmentColorFamily: string | null | undefined
): string | null {
  const u = resolveDesignAssets(design);
  if (garmentColorFamily === "dark") {
    return u.darkSvg ?? u.lightSvg ?? u.svg ?? null;
  }
  return u.lightSvg ?? u.darkSvg ?? u.svg ?? null;
}
