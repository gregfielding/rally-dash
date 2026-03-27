/**
 * Launch storefront top-level navigation (Shopify Online Store theme / menu JSON).
 * Cities are collections + filters only — not in top nav (see rally_tag_system_spec).
 */

export interface LaunchNavItem {
  label: string;
  /** Storefront path (Liquid-relative), e.g. /collections/teams */
  href: string;
}

/** Exact nav order for Phase 1. Hub links match smart collections created in functions/lib/shopifySmartCollections.js */
export const LAUNCH_TOP_NAV: readonly LaunchNavItem[] = [
  { label: "Shop All", href: "/collections/all" },
  { label: "Teams", href: "/collections/teams" },
  { label: "Styles", href: "/collections/styles" },
  { label: "Themes", href: "/collections/themes" },
  { label: "New Arrivals", href: "/collections/new-arrivals" },
] as const;
