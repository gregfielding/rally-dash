/**
 * Deterministic Shopify collection handles for structured Rally tags (handles only: underscores → hyphens).
 * Mirrors functions/lib/shopifySmartCollections.js — keep in sync when changing rules.
 */

export type StructuredLeafFamily = "team" | "city" | "product_type" | "theme";

const HANDLE_PREFIX: Record<StructuredLeafFamily, string> = {
  team: "team",
  city: "city",
  product_type: "style",
  theme: "theme",
};

/** Slug segment uses underscores in tags; handles use hyphens. */
export function slugSegmentToHandlePart(slug: string): string {
  return String(slug || "")
    .trim()
    .replace(/_/g, "-");
}

/**
 * @param family - prefix before `:` on the product tag
 * @param slugSegment - value after `:`, e.g. los_angeles_dodgers
 */
export function structuredTagToCollectionHandle(family: StructuredLeafFamily, slugSegment: string): string {
  const part = slugSegmentToHandlePart(slugSegment);
  if (!part) return "";
  return `${HANDLE_PREFIX[family]}-${part}`;
}

/** Hub smart collections (tag contains) — same handles as LAUNCH_TOP_NAV where applicable. */
export const HUB_COLLECTION_HANDLES = {
  teams: "teams",
  styles: "styles",
  themes: "themes",
  newArrivals: "new-arrivals",
} as const;
