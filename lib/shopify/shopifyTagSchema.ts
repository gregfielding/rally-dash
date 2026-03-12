/**
 * Canonical Rally → Shopify tag mapping for Smart Collections.
 * Used by buildShopifyTags and the Shopify sync worker.
 *
 * Maps product fields to tag prefix. Do NOT include blankId or designFamily as Shopify tags.
 */

export const SHOPIFY_TAG_FIELD_MAP = {
  sportCode: "sport",
  leagueCode: "league",
  teamCode: "team",
  themeCode: "theme",
  modelCodes: "model",
} as const;

export type ShopifyTagField = keyof typeof SHOPIFY_TAG_FIELD_MAP;

/** Fields that are never emitted as Shopify tags (internal only). */
export const SHOPIFY_TAG_EXCLUDED_FIELDS = ["blankId", "designFamily"] as const;
