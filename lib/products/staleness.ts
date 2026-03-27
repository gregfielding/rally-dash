/**
 * Product staleness and identity helpers.
 *
 * Canonical rules (see RALLY_MASTER_BLANK_SCHEMA.md):
 * - Master Blank = style-level object; Blank Variant = color-level object.
 * - Color is defined on variants, not master blank.
 * - Generated Product = blank + blankVariant + design + team.
 * - Master blank edits do not silently mutate products; products become stale instead.
 */

import type { RpProduct } from "@/lib/types/firestore";
import type { Timestamp } from "firebase/firestore";

/** Normalize a segment for productIdentityKey: uppercase, replace spaces with underscore, strip invalid. */
function normalizeKeySegment(s: string | null | undefined): string {
  if (s == null || typeof s !== "string") return "";
  return String(s)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 128) || "";
}

/**
 * Build canonical product identity key.
 * Format: {leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantIdOrLegacy}
 * Canonical source for team: prefer DesignTeam.teamCode (or design.teamCode), fallback DesignTeam.id.
 */
export function buildProductIdentityKey(params: {
  leagueCode: string | null | undefined;
  teamCode: string | null | undefined;
  designId: string;
  blankId: string;
  blankVariantIdOrLegacy: string;
  /** Garment size (e.g. XS, M); omit for legacy single-variant keys. */
  garmentSizeCode?: string | null;
}): string {
  const league = normalizeKeySegment(params.leagueCode) || "LEAGUE";
  const team = normalizeKeySegment(params.teamCode) || "TEAM";
  const design = normalizeKeySegment(params.designId) || "";
  const blank = normalizeKeySegment(params.blankId) || "";
  const variant = normalizeKeySegment(params.blankVariantIdOrLegacy) || "legacy";
  const parts = [league, team, design, blank, variant].filter(Boolean);
  const sizeSeg = normalizeKeySegment(params.garmentSizeCode ?? "");
  if (sizeSeg) parts.push(sizeSeg);
  return parts.join("_");
}

/** Parent product dedupe: team + design + blank (no color/variant segment). */
export function buildParentProductIdentityKey(params: {
  leagueCode: string | null | undefined;
  teamCode: string | null | undefined;
  designId: string;
  blankId: string;
}): string {
  const league = normalizeKeySegment(params.leagueCode) || "LEAGUE";
  const team = normalizeKeySegment(params.teamCode) || "TEAM";
  const design = normalizeKeySegment(params.designId) || "";
  const blank = normalizeKeySegment(params.blankId) || "";
  return [league, team, design, blank].filter(Boolean).join("_");
}

/** Get numeric "version" from a blank for comparison: version if set, else updatedAt ms. */
export function getBlankVersionValue(blank: {
  version?: number | null;
  updatedAt?: Timestamp | { toMillis(): number } | null;
}): number | null {
  if (blank.version != null && typeof blank.version === "number") return blank.version;
  const u = blank.updatedAt;
  if (u && typeof (u as { toMillis?: () => number }).toMillis === "function") {
    return (u as { toMillis(): number }).toMillis();
  }
  return null;
}

/** Get numeric "version" from a design for comparison: updatedAt ms (or version if we add it later). */
export function getDesignVersionValue(design: {
  updatedAt?: Timestamp | { toMillis(): number } | null;
  version?: number | null;
}): number | null {
  if (design.version != null && typeof design.version === "number") return design.version;
  const u = design.updatedAt;
  if (u && typeof (u as { toMillis?: () => number }).toMillis === "function") {
    return (u as { toMillis(): number }).toMillis();
  }
  return null;
}

/** Product is stale vs blank when blank’s current version is newer than product’s blankVersionUsed. */
export function isBlankStale(
  product: { blankVersionUsed?: number | null },
  currentBlank: { version?: number | null; updatedAt?: Timestamp | { toMillis(): number } | null }
): boolean {
  const used = product.blankVersionUsed;
  if (used == null) return false; // no snapshot to compare
  const current = getBlankVersionValue(currentBlank);
  if (current == null) return false;
  return current > used;
}

/** Product is stale vs design when design’s current version is newer than product’s designVersionUsed. */
export function isDesignStale(
  product: { designVersionUsed?: number | null },
  currentDesign: { updatedAt?: Timestamp | { toMillis(): number } | null; version?: number | null }
): boolean {
  const used = product.designVersionUsed;
  if (used == null) return false;
  const current = getDesignVersionValue(currentDesign);
  if (current == null) return false;
  return current > used;
}
