/**
 * Standardized automated tag generation for Generated Products.
 *
 * Rules:
 * - City tags come only from Team.city (proper case); no manual city tags.
 * - Tags are deterministic: Team (city, team name, league), Design (design type), Blank (garment type, garment color).
 * - displayTags: proper case for UI/Shopify.
 * - tagsNormalized: slug-like for filtering/search (not shown in UI).
 */

import type { DesignThemeValue } from "@/lib/types/firestore";
import type { RPBlankGarmentCategory } from "@/lib/types/firestore";
import { DESIGN_THEME_LABELS, designThemeLabel } from "@/lib/designs/designThemes";

// ---------------------------------------------------------------------------
// Design theme (stored as designType) → display label
// ---------------------------------------------------------------------------

/** @deprecated Use `DESIGN_THEME_LABELS` or `designThemeLabel` from `@/lib/designs/designThemes` */
export const DESIGN_TYPE_LABELS = DESIGN_THEME_LABELS;

export function designTypeToDisplayLabel(designType: DesignThemeValue | string | null | undefined): string | null {
  if (designType == null || designType === "") return null;
  const label = designThemeLabel(designType);
  if (label === "—") return null;
  return label;
}

// ---------------------------------------------------------------------------
// Garment category → display label (e.g. "Panty")
// ---------------------------------------------------------------------------

export const GARMENT_CATEGORY_LABELS: Record<RPBlankGarmentCategory, string> = {
  panty: "Panty",
  thong: "Thong",
  tank: "Tank",
  crewneck: "Crewneck",
};

export function garmentCategoryToDisplayLabel(
  category: RPBlankGarmentCategory | string | null | undefined
): string | null {
  if (!category) return null;
  const key = category as RPBlankGarmentCategory;
  if (GARMENT_CATEGORY_LABELS[key]) return GARMENT_CATEGORY_LABELS[key];
  return toProperCase(String(category));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure value is proper case (e.g. "San Francisco") for display tags. */
export function toProperCase(value: string): string {
  const s = value.trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Normalized form for filtering/search only. Not displayed to users.
 * e.g. "San Francisco" → "san-francisco"
 */
export function normalizeTagForFilter(displayTag: string): string {
  return displayTag
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

// ---------------------------------------------------------------------------
// Source shapes (minimal; no free-form inputs)
// ---------------------------------------------------------------------------

export interface ProductTagTeamSource {
  /** City from Team; always proper case in tags (e.g. "San Francisco"). */
  city?: string | null;
  /** Team nickname (e.g. "Giants"). */
  teamName?: string | null;
  /** League label (e.g. "MLB"). */
  league?: string | null;
}

export interface ProductTagDesignSource {
  designType?: DesignThemeValue | string | null;
  /** Normalized snake_case series slug; emits tag `series:{value}`. */
  designSeries?: string | null;
}

export interface ProductTagBlankSource {
  garmentCategory: RPBlankGarmentCategory | string;
  /** Garment color (e.g. "Black", "Heather Grey"); already proper case in schema. */
  colorName: string;
}

export interface ProductTagSources {
  team: ProductTagTeamSource | null;
  design: ProductTagDesignSource | null;
  blank: ProductTagBlankSource | null;
}

export interface GeneratedProductTags {
  /** Display tags (proper case); use for UI and Shopify. */
  displayTags: string[];
  /** Normalized tags for filtering/search; do not display. */
  normalizedTags: string[];
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate deterministic product tags from Team, Design, and Blank only.
 * City comes only from Team.city (proper-cased). No manual/free-form tags.
 */
export function generateProductTags(sources: ProductTagSources): GeneratedProductTags {
  const displayTags: string[] = [];
  const normalizedTags: string[] = [];

  function add(display: string): void {
    if (!display.trim()) return;
    const proper = toProperCase(display);
    if (!proper) return;
    displayTags.push(proper);
    normalizedTags.push(normalizeTagForFilter(proper));
  }

  const { team, design, blank } = sources;

  // Team: city (only from Team; proper case), team name, league
  if (team) {
    if (team.city && typeof team.city === "string") {
      add(team.city.trim());
    }
    if (team.teamName && typeof team.teamName === "string") {
      add(team.teamName.trim());
    }
    if (team.league && typeof team.league === "string") {
      add(team.league.trim());
    }
  }

  // Design: design type label (e.g. "City 69")
  if (design?.designType) {
    const label = designTypeToDisplayLabel(design.designType);
    if (label) add(label);
  }

  // Blank: garment type (e.g. "Panty"), garment color (e.g. "Black")
  if (blank) {
    const garmentLabel = garmentCategoryToDisplayLabel(blank.garmentCategory);
    if (garmentLabel) add(garmentLabel);
    if (blank.colorName && typeof blank.colorName === "string") {
      add(blank.colorName.trim());
    }
  }

  // Dedupe while preserving order (first occurrence wins)
  const seenDisplay = new Set<string>();
  const seenNorm = new Set<string>();
  const outDisplay: string[] = [];
  const outNormalized: string[] = [];
  for (let i = 0; i < displayTags.length; i++) {
    const d = displayTags[i];
    const n = normalizedTags[i];
    const normKey = n.toLowerCase();
    if (seenDisplay.has(d) || seenNorm.has(normKey)) continue;
    seenDisplay.add(d);
    seenNorm.add(normKey);
    outDisplay.push(d);
    outNormalized.push(n);
  }

  const seriesRaw = design?.designSeries != null ? String(design.designSeries).trim().toLowerCase() : "";
  if (seriesRaw) {
    const seriesTag = `series:${seriesRaw}`;
    if (!seenDisplay.has(seriesTag) && !seenNorm.has(seriesTag)) {
      outDisplay.push(seriesTag);
      outNormalized.push(seriesTag);
    }
  }

  return { displayTags: outDisplay, normalizedTags: outNormalized };
}
