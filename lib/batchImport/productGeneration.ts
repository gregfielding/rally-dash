/**
 * Phase 3: Product generation from batch-imported designs.
 * Product identity key, title/handle generation per RALLY_BATCH_IMPORT_PHASE3_PRODUCT_GENERATION_SPEC.
 */

export interface ParsedForProduct {
  leagueCode: string;
  designFamily: string;
  teamCode: string;
  side: string; // "FRONT" | "BACK"
  variant: string;
}

/**
 * Normalize a segment for the product identity key: uppercase, spaces/hyphens → underscores.
 */
function normalizeKeySegment(s: string): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

/**
 * Product identity key for deterministic deduplication. Side is NOT part of the key.
 * Format: leagueCode_designFamily_teamCode_blankId_variant
 * Example: MLB_WILL_DROP_FOR_GIANTS_HEATHER_GREY_BIKINI_LIGHT
 *
 * FRONT and BACK imports for the same (league, family, team, blank, variant) map to the same product.
 */
export function productIdentityKey(
  leagueCode: string,
  designFamily: string,
  teamCode: string,
  blankId: string,
  variant: string
): string {
  return [
    normalizeKeySegment(leagueCode),
    normalizeKeySegment(designFamily),
    normalizeKeySegment(teamCode),
    normalizeKeySegment(blankId),
    normalizeKeySegment(variant),
  ].join("_");
}

/**
 * Humanize a token for display (e.g. WILL_DROP_FOR → Will Drop For, GIANTS → Giants).
 */
export function humanizeToken(s: string): string {
  if (!s) return "";
  return s
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Default product title: {Design Family Humanized} {Team Humanized} – {Blank Name}
 * Example: Will Drop For Giants – Heather Grey Bikini Panty
 */
export function productTitle(parsed: ParsedForProduct, blankName: string): string {
  const family = humanizeToken(parsed.designFamily);
  const team = humanizeToken(parsed.teamCode);
  const blank = (blankName || "Product").trim();
  return `${family} ${team} – ${blank}`;
}

/**
 * Slug-safe handle: {design-family}-{team}-{blank-slug}
 * Example: will-drop-for-giants-heather-grey-bikini-panty
 */
export function productHandle(parsed: ParsedForProduct, blankSlug: string): string {
  const family = parsed.designFamily
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const team = parsed.teamCode
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const blank = (blankSlug || "blank")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return [family, team, blank].filter(Boolean).join("-");
}

/**
 * Generate a URL-safe slug from a string (for product.slug).
 */
export function slugFromString(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
