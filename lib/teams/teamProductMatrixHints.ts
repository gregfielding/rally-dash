/**
 * Neutral vs team-color hints for Team Product Matrix UI and optional bulk seeding.
 * Suggestions are computed — only `approvedVariantIds` in Firestore counts as approved.
 */

import type { DesignTeam, RPBlank, RPBlankVariant } from "@/lib/types/firestore";
import { computeEligibleTeams, getEffectiveEligibility } from "@/lib/blanks/eligibility";

/** Substrings in variant color names treated as neutral bases (safe bulk defaults). */
const NEUTRAL_NAME_TOKENS = [
  "black",
  "white",
  "off-white",
  "off white",
  "natural",
  "heather",
  "grey",
  "gray",
  "charcoal",
  "ivory",
  "cream",
  "bone",
  "oat",
  "sand",
  "taupe",
  "beige",
  "stone",
  "ash",
  "silver",
  "pearl",
] as const;

/**
 * Map `DesignTeam.colorFamilies` entries to patterns on blank `variant.colorName`.
 * Used for "Suggested" badges only — not approval.
 */
const FAMILY_TO_PATTERNS: Record<string, RegExp[]> = {
  black: [/\bblack\b/i],
  white: [/\bwhite\b/i, /\boff[\s-]white\b/i, /\bivory\b/i],
  grey: [/\bgrey\b/i, /\bgray\b/i, /\bheather\b/i],
  navy: [/\bnavy\b/i],
  blue: [/\bblue\b/i, /\broyal\b/i, /\bcelestial\b/i],
  red: [/\bred\b/i, /\bmaroon\b/i, /\bscarlet\b/i, /\burgundy\b/i],
  green: [/\bgreen\b/i, /\bolive\b/i],
  orange: [/\borange\b/i],
  purple: [/\bpurple\b/i, /\bviolet\b/i],
  teal: [/\bteal\b/i, /\baqua\b/i, /\bturquoise\b/i],
  pink: [/\bpink\b/i, /\bfuchsia\b/i, /\bmagenta\b/i],
  yellow: [/\byellow\b/i, /\bgold\b/i],
};

export function isNeutralGarmentVariantName(colorName: string | null | undefined): boolean {
  if (!colorName || typeof colorName !== "string") return false;
  const n = colorName.trim().toLowerCase();
  if (!n) return false;
  return NEUTRAL_NAME_TOKENS.some((t) => n.includes(t));
}

export function variantMatchesTeamColorFamilies(
  colorName: string | null | undefined,
  teamFamilies: string[] | null | undefined
): boolean {
  if (!colorName?.trim() || !teamFamilies?.length) return false;
  if (isNeutralGarmentVariantName(colorName)) return false;
  const n = colorName;
  for (const fam of teamFamilies) {
    const key = String(fam).trim().toLowerCase();
    const patterns = FAMILY_TO_PATTERNS[key];
    if (patterns?.some((re) => re.test(n))) return true;
  }
  return false;
}

/**
 * True if this team passes merged blank+variant eligibility (same engine as blank editor preview).
 * When eligibility is unset (`notConfigured`), treat as broadly eligible.
 */
export function isTeamEligibleForVariant(
  team: DesignTeam,
  blank: RPBlank,
  variant: RPBlankVariant | null
): boolean {
  const rules = getEffectiveEligibility(blank, variant);
  const { teams, notConfigured } = computeEligibleTeams([team], rules);
  if (notConfigured) return true;
  return teams.some((t) => t.id === team.id);
}

export function neutralEligibleVariantIds(team: DesignTeam, blank: RPBlank): string[] {
  const variants = blank.variants ?? [];
  const out: string[] = [];
  for (const v of variants) {
    if (v.isActive === false) continue;
    if (!isTeamEligibleForVariant(team, blank, v)) continue;
    if (!isNeutralGarmentVariantName(v.colorName)) continue;
    out.push(v.variantId);
  }
  return out;
}
