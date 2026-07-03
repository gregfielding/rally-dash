/**
 * Canonical dual-layer product tags (human-readable + structured). Source of truth for Dashboard + Functions.
 * @see rally_tag_system_spec.md — keep in sync with functions/lib/buildProductTags.js
 */

import type { RpProduct, RpTaxonomyDisplay, RPBlank } from "@/lib/types/firestore";
import { canonicalTeamSlugFromTaxonomy } from "@/lib/products/canonicalTeamSlug";

export function slugifyUnderscore(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
}

export function normalizeTheme(themeName: string | null | undefined, themeCode: string | null | undefined): string | null {
  if (themeName != null && String(themeName).trim()) {
    return String(themeName)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }
  if (themeCode != null && String(themeCode).trim()) {
    return String(themeCode)
      .trim()
      .toLowerCase()
      .replace(/^city_/i, "");
  }
  return null;
}

export interface ProductLikeForTags {
  taxonomy?: RpTaxonomyDisplay | null;
  sportCode?: string | null;
  leagueCode?: string | null;
  themeCode?: string | null;
  /** Ink/brand accent color (e.g. "ORANGE") — independent of garment fabric color. */
  accentColor?: string | null;
}

/**
 * Deterministic tag list: 6 human-readable + 6 structured (order), deduped, no legacy slug noise.
 */
export function buildProductTags(product: ProductLikeForTags | null | undefined): string[] {
  if (!product || typeof product !== "object") return [];
  const t = product.taxonomy && typeof product.taxonomy === "object" ? product.taxonomy : ({} as RpTaxonomyDisplay);
  const leagueCode =
    t.leagueCode != null && String(t.leagueCode).trim() ? t.leagueCode : product.leagueCode;
  const sportCode = t.sportCode != null && String(t.sportCode).trim() ? t.sportCode : product.sportCode;
  const themeCode = t.themeCode != null && String(t.themeCode).trim() ? t.themeCode : product.themeCode;

  const cityName = t.cityName != null && String(t.cityName).trim() ? String(t.cityName).trim() : null;
  const citySlug =
    t.citySlug != null && String(t.citySlug).trim()
      ? String(t.citySlug).trim()
      : cityName
        ? slugifyUnderscore(cityName)
        : null;

  const teamName = t.teamName != null && String(t.teamName).trim() ? String(t.teamName).trim() : null;
  /** Full-city canonical slug only; see canonicalTeamSlug.ts — never nickname-only or short city codes. */
  const teamSlug =
    canonicalTeamSlugFromTaxonomy(t) ??
    (t.teamSlug != null && String(t.teamSlug).trim() ? String(t.teamSlug).trim() : null);

  const leagueName = t.leagueName != null && String(t.leagueName).trim() ? String(t.leagueName).trim() : null;
  const sportName = t.sportName != null && String(t.sportName).trim() ? String(t.sportName).trim() : null;

  const themeName = t.themeName != null && String(t.themeName).trim() ? String(t.themeName).trim() : null;

  /** Ink/brand accent color (e.g. "ORANGE") — independent of garment fabric color. */
  const accentColor =
    t.accentColor != null && String(t.accentColor).trim() ? t.accentColor : product.accentColor;
  const accentColorName =
    accentColor != null && String(accentColor).trim()
      ? String(accentColor).trim().charAt(0).toUpperCase() + String(accentColor).trim().slice(1).toLowerCase()
      : null;
  const accentColorSlug = accentColorName ? slugifyUnderscore(accentColorName) : null;

  const productTypeName =
    t.productTypeName != null && String(t.productTypeName).trim() ? String(t.productTypeName).trim() : null;
  const productTypeSlug =
    t.productTypeSlug != null && String(t.productTypeSlug).trim()
      ? String(t.productTypeSlug).trim()
      : productTypeName
        ? slugifyUnderscore(productTypeName)
        : null;

  const human = [cityName, teamName, leagueName, sportName, themeName, productTypeName, accentColorName].filter(
    Boolean
  );

  const themePart = normalizeTheme(themeName, themeCode);
  const structured = [
    citySlug ? `city:${citySlug}` : null,
    teamSlug ? `team:${teamSlug}` : null,
    leagueCode != null && String(leagueCode).trim() ? `league:${String(leagueCode).trim().toLowerCase()}` : null,
    sportCode != null && String(sportCode).trim() ? `sport:${String(sportCode).trim().toLowerCase()}` : null,
    themePart ? `theme:${themePart}` : null,
    productTypeSlug ? `product_type:${productTypeSlug}` : null,
    accentColorSlug ? `color:${accentColorSlug}` : null,
  ].filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...human, ...structured]) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function tagsNormalizedFromTags(tags: string[]): string[] {
  return tags.map((x) => String(x).toLowerCase());
}

/** Bikini Panty for 8394; otherwise short garment label → slug. */
/** Recompute tags from persisted product + blank (merchandising save; no manual tag merge). */
export function buildProductTagsFromRpProduct(product: RpProduct, blank?: RPBlank | null): string[] {
  const pt = buildProductTypeForTags(blank ?? null);
  const t = { ...(product.taxonomy ?? {}) };
  t.productTypeName = pt.productTypeName;
  t.productTypeSlug = pt.productTypeSlug;
  return buildProductTags({
    taxonomy: t,
    sportCode: product.sportCode ?? null,
    leagueCode: product.leagueCode ?? null,
    themeCode: product.themeCode ?? null,
    accentColor: product.accentColor ?? null,
  });
}

export function buildProductTypeForTags(blank: RPBlank | null | undefined): {
  productTypeName: string;
  productTypeSlug: string;
} {
  if (!blank) {
    return { productTypeName: "Apparel", productTypeSlug: "apparel" };
  }
  const sc = String(blank.styleCode || "").trim();
  if (sc === "8394") {
    return { productTypeName: "Bikini Panty", productTypeSlug: "bikini_panty" };
  }
  const cat = String(blank.garmentCategory || blank.category || "panty").toLowerCase();
  let word = "Apparel";
  if (cat === "panty") word = "Panty";
  else if (cat === "thong") word = "Thong";
  else if (cat === "tank") word = "Tank";
  else if (cat === "crewneck") word = "Crewneck";
  const gs = String(blank.garmentStyle || blank.styleName || "").toLowerCase();
  if (word === "Panty" && gs.includes("bikini")) {
    return { productTypeName: "Bikini Panty", productTypeSlug: "bikini_panty" };
  }
  return { productTypeName: word, productTypeSlug: slugifyUnderscore(word) };
}
