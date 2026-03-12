"use strict";

/**
 * Build deterministic Shopify tags from Rally product taxonomy fields.
 * Mirrors lib/shopify/buildShopifyTags.ts for the sync worker.
 * Rules: lowercase, slug-safe, skip null/empty, dedupe, stable ordering.
 * Do NOT include blankId or designFamily.
 */

const TAG_PREFIX = {
  sportCode: "sport",
  leagueCode: "league",
  teamCode: "team",
  themeCode: "theme",
  modelCodes: "model",
};

function toTagValue(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 255);
}

function hasValue(s) {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * @param {object} product - Rally product (or snapshot) with optional sportCode, leagueCode, teamCode, themeCode, modelCodes[]
 * @returns {string[]} Deterministic list of Shopify tags
 */
function buildShopifyTags(product) {
  if (!product) return [];

  const out = [];

  if (hasValue(product.sportCode)) {
    out.push(`${TAG_PREFIX.sportCode}:${toTagValue(product.sportCode)}`);
  }
  if (hasValue(product.leagueCode)) {
    out.push(`${TAG_PREFIX.leagueCode}:${toTagValue(product.leagueCode)}`);
  }
  if (hasValue(product.teamCode)) {
    out.push(`${TAG_PREFIX.teamCode}:${toTagValue(product.teamCode)}`);
  }
  if (hasValue(product.themeCode)) {
    out.push(`${TAG_PREFIX.themeCode}:${toTagValue(product.themeCode)}`);
  }
  if (Array.isArray(product.modelCodes)) {
    for (const code of product.modelCodes) {
      if (hasValue(code)) {
        out.push(`${TAG_PREFIX.modelCodes}:${toTagValue(code)}`);
      }
    }
  }

  return [...new Set(out)];
}

module.exports = { buildShopifyTags };
