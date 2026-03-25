"use strict";

/**
 * Resolve Blank title/description/tag templates with context (same contract as lib/blanks/templateTokens.ts).
 * Supports {token} and {{token}}. Canonical keys plus aliases (teamCity → city, designStyle → design theme label).
 * After substitution, strips any remaining template artifacts so stored values are never template source.
 */

const BASE_KEYS = [
  "teamName",
  "teamNameFull",
  "designName",
  "designShortName",
  "designSeries",
  "colorName",
  "garmentStyle",
  "category",
  "brand",
  "vendor",
  "league",
  "city",
  "stadiumName",
  "teamSaying",
  "fanPhrase",
  "designThemeSlug",
  "designTheme",
  "designStyle",
  "teamCity",
];

/**
 * @param {string} s
 * @returns {string}
 */
function stripUnresolvedTemplateArtifacts(s) {
  let out = String(s);
  out = out.replace(/\{\{[^{}]+\}\}/g, "");
  out = out.replace(/\{[^{}]+\}/g, "");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} template
 * @param {object} context
 */
function replaceTokens(template, context) {
  let out = String(template);
  const keys = [...BASE_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const value = context[key] != null ? context[key] : "";
    const str = typeof value === "string" ? value : String(value);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "gi"), str);
    out = out.replace(new RegExp(`\\{${escaped}\\}`, "gi"), str);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @param {object} blank - fields: titleTemplate, descriptionTemplate, tagTemplates, colorName, styleName, styleCode, garmentCategory, shopifyDefaults
 * @param {object} context - teamName, designName, colorName, garmentStyle, category, vendor, league, city, stadiumName, teamSaying, fanPhrase, designThemeSlug, designTheme, designStyle, teamCity
 * @returns {{ title: string, description: string, tags: string[] }}
 */
function resolveBlankTemplates(blank, context) {
  const colorName = context.colorName ?? blank.colorName ?? "";
  const garmentStyle =
    blank.garmentStyle ?? blank.styleName ?? blank.styleCode ?? context.garmentStyle ?? "";
  const category =
    (blank.shopifyDefaults && blank.shopifyDefaults.productType) ??
    blank.category ??
    blank.garmentCategory ??
    context.category ??
    "";
  const brand =
    (blank.shopifyDefaults && blank.shopifyDefaults.brand) ??
    (blank.shopifyDefaults && blank.shopifyDefaults.vendor) ??
    context.brand ??
    context.vendor ??
    "";

  const fullContext = {
    ...context,
    teamNameFull:
      context.teamNameFull != null && String(context.teamNameFull).trim()
        ? String(context.teamNameFull)
        : context.teamName != null
          ? String(context.teamName)
          : "",
    designShortName:
      context.designShortName != null && String(context.designShortName).trim()
        ? String(context.designShortName)
        : "",
    designSeries:
      context.designSeries != null && String(context.designSeries).trim()
        ? String(context.designSeries).trim()
        : "",
    colorName: String(colorName),
    garmentStyle: String(garmentStyle),
    category: String(category),
    brand: String(brand),
    vendor: String(brand),
    teamCity: context.teamCity != null ? String(context.teamCity) : context.city != null ? String(context.city) : "",
    designStyle:
      context.designStyle != null && String(context.designStyle).trim()
        ? String(context.designStyle)
        : context.designThemeLabel != null
          ? String(context.designThemeLabel)
          : "",
  };

  const rawTitle =
    blank.titleTemplate != null && String(blank.titleTemplate).trim()
      ? replaceTokens(blank.titleTemplate, fullContext)
      : "";
  const rawDescription =
    blank.descriptionTemplate != null && String(blank.descriptionTemplate).trim()
      ? replaceTokens(blank.descriptionTemplate, fullContext)
      : "";

  let title = stripUnresolvedTemplateArtifacts(rawTitle);
  let description = stripUnresolvedTemplateArtifacts(rawDescription);
  title = stripUnresolvedTemplateArtifacts(title);
  description = stripUnresolvedTemplateArtifacts(description);

  const tags = [];
  if (Array.isArray(blank.tagTemplates) && blank.tagTemplates.length > 0) {
    const seen = new Set();
    for (const t of blank.tagTemplates) {
      if (typeof t !== "string" || !t.trim()) continue;
      const resolved = stripUnresolvedTemplateArtifacts(replaceTokens(t, fullContext));
      if (!resolved) continue;
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(resolved);
    }
  }

  return { title, description, tags };
}

module.exports = { resolveBlankTemplates, stripUnresolvedTemplateArtifacts, replaceTokens };
