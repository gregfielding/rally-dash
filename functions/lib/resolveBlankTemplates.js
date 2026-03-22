"use strict";

/**
 * Resolve Blank title/description/tag templates with context (same contract as lib/blanks/templateTokens.ts).
 * Tokens: {teamName}, {designName}, {colorName}, {garmentStyle}, {category}, {vendor}, {league}, {city},
 *         {stadiumName}, {teamSaying}, {fanPhrase} (from Team metadata).
 */

const TOKEN_KEYS = [
  "teamName",
  "designName",
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
];

function replaceTokens(template, context) {
  let out = String(template);
  for (const key of TOKEN_KEYS) {
    const value = context[key] != null ? context[key] : "";
    const str = typeof value === "string" ? value : String(value);
    const regex = new RegExp(`\\{${key}\\}`, "gi");
    out = out.replace(regex, str);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @param {object} blank - fields: titleTemplate, descriptionTemplate, tagTemplates, colorName, styleName, styleCode, garmentCategory, shopifyDefaults
 * @param {object} context - teamName, designName, colorName, garmentStyle, category, vendor, league, city, stadiumName, teamSaying, fanPhrase
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
    colorName: String(colorName),
    garmentStyle: String(garmentStyle),
    category: String(category),
    brand: String(brand),
    vendor: String(brand),
  };

  const title =
    blank.titleTemplate != null && String(blank.titleTemplate).trim()
      ? replaceTokens(blank.titleTemplate, fullContext)
      : "";
  const description =
    blank.descriptionTemplate != null && String(blank.descriptionTemplate).trim()
      ? replaceTokens(blank.descriptionTemplate, fullContext)
      : "";

  const tags = [];
  if (Array.isArray(blank.tagTemplates) && blank.tagTemplates.length > 0) {
    const seen = new Set();
    for (const t of blank.tagTemplates) {
      if (typeof t !== "string" || !t.trim()) continue;
      const resolved = replaceTokens(t, fullContext);
      if (!resolved) continue;
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(resolved);
    }
  }

  return { title, description, tags };
}

module.exports = { resolveBlankTemplates };
