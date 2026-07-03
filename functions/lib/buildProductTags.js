"use strict";

/**
 * Canonical dual-layer product tags (human + structured). Keep in sync with lib/products/buildProductTags.ts.
 * @see rally_tag_system_spec.md
 */

const { canonicalTeamSlugFromTaxonomy } = require("./canonicalTeamSlug");

function slugifyUnderscore(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
}

function normalizeTheme(themeName, themeCode) {
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

/**
 * @param {object} product - Must include `taxonomy` (full row) and optional top-level sportCode, leagueCode, themeCode fallbacks.
 * @returns {string[]}
 */
function buildProductTags(product) {
  if (!product || typeof product !== "object") return [];
  const t = product.taxonomy && typeof product.taxonomy === "object" ? product.taxonomy : {};
  const leagueCode = t.leagueCode != null && String(t.leagueCode).trim() ? t.leagueCode : product.leagueCode;
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

  const out = [];
  const seen = new Set();
  for (const x of [...human, ...structured]) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function tagsNormalizedFromTags(tags) {
  return tags.map((t) => String(t).toLowerCase());
}

module.exports = {
  buildProductTags,
  tagsNormalizedFromTags,
  normalizeTheme,
  slugifyUnderscore,
};
