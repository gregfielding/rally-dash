/**
 * Phase 1 storefront filtering (Search & Discovery + theme).
 * Parent product model: one Shopify product per parent; color lives on variants — configure the theme
 * so collection grids show one card per product (not per variant).
 */

/** Facets to enable in Phase 1 (minimal). */
export const STOREFRONT_FILTERS_PHASE1 = {
  /** Variant option (e.g. Color) — standard Shopify variant option. */
  colorVariantOption: true,
  /** Style — driven by structured tag `product_type:{slug}` (and/or product type if synced). */
  styleFromProductTypeTag: true,
  /** Optional — only if the UI stays simple. */
  optionalTeam: true,
  optionalTheme: true,
} as const;

/**
 * Cities: available as collections (`city-{slug}`) and as filters in collection UI;
 * not listed in LAUNCH_TOP_NAV.
 */
export const CITIES_NAV_EXCLUDED = true;
