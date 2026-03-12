/**
 * Build deterministic Shopify tags from Rally product taxonomy fields.
 * Used for sync worker and Product Detail preview.
 *
 * Rules: lowercase, slug-safe, skip null/empty, dedupe, stable ordering.
 */

import { SHOPIFY_TAG_FIELD_MAP } from "./shopifyTagSchema";

/** Product-like shape for tag building (Rally product or snapshot). */
export interface ProductForShopifyTags {
  sportCode?: string | null;
  leagueCode?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  modelCodes?: string[] | null;
}

/**
 * Make a value safe for Shopify tags: lowercase, replace non-alphanumeric with underscore.
 * Shopify tags are typically lowercase; we keep underscores for readability (e.g. red_sox).
 */
function toTagValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 255);
}

function hasValue(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Returns a deterministic list of Shopify tags from Rally product fields.
 * Order: sport, league, team, theme, then each model. Deduped, slug-safe, no nulls.
 */
export function buildShopifyTags(product: ProductForShopifyTags | null | undefined): string[] {
  if (!product) return [];

  const out: string[] = [];

  if (hasValue(product.sportCode)) {
    out.push(`${SHOPIFY_TAG_FIELD_MAP.sportCode}:${toTagValue(product.sportCode!)}`);
  }
  if (hasValue(product.leagueCode)) {
    out.push(`${SHOPIFY_TAG_FIELD_MAP.leagueCode}:${toTagValue(product.leagueCode!)}`);
  }
  if (hasValue(product.teamCode)) {
    out.push(`${SHOPIFY_TAG_FIELD_MAP.teamCode}:${toTagValue(product.teamCode!)}`);
  }
  if (hasValue(product.themeCode)) {
    out.push(`${SHOPIFY_TAG_FIELD_MAP.themeCode}:${toTagValue(product.themeCode!)}`);
  }
  if (Array.isArray(product.modelCodes)) {
    for (const code of product.modelCodes) {
      if (hasValue(code)) {
        out.push(`${SHOPIFY_TAG_FIELD_MAP.modelCodes}:${toTagValue(code)}`);
      }
    }
  }

  return [...new Set(out)];
}
