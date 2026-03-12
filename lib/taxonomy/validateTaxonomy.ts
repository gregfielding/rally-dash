/**
 * Taxonomy validation rules for design and product classification.
 *
 * Rules:
 * - teamCode requires leagueCode and sportCode
 * - leagueCode requires sportCode
 * - sportCode may be null only when the item is purely thematic/lifestyle
 *   (no league, no team). Examples: PANTY_DROP, PEPTIDES, COUNTRY_CLUB.
 *
 * College entities: use sportCode = COLLEGE_SPORTS, leagueCode = NCAA,
 * teamCode = school code (e.g. COLORADO), even when the design is not
 * sport-specific (football/basketball).
 */

export interface TaxonomyClassification {
  sportCode: string | null;
  leagueCode: string | null;
  teamCode: string | null;
}

export interface TaxonomyValidationResult {
  valid: boolean;
  message?: string;
}

function hasValue(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Validates sport/league/team hierarchy before save.
 * Returns { valid: true } or { valid: false, message }.
 */
export function validateTaxonomyClassification(
  classification: TaxonomyClassification
): TaxonomyValidationResult {
  const { sportCode, leagueCode, teamCode } = classification;
  const hasSport = hasValue(sportCode);
  const hasLeague = hasValue(leagueCode);
  const hasTeam = hasValue(teamCode);

  if (hasTeam && !hasLeague) {
    return { valid: false, message: "Team requires League. Select a League (e.g. NCAA for college)." };
  }
  if (hasTeam && !hasSport) {
    return { valid: false, message: "Team requires Sport. Select a Sport (e.g. COLLEGE_SPORTS for college)." };
  }
  if (hasLeague && !hasSport) {
    return { valid: false, message: "League requires Sport. Sport can be left empty only for purely thematic/lifestyle products." };
  }

  return { valid: true };
}
