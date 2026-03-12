/**
 * Batch import taxonomy resolution.
 * Resolves parsed filename tokens against rp_taxonomy_* collections.
 * No guessing: only exact code matches. Unresolved = null.
 */

import type {
  RpTaxonomyLeague,
  RpTaxonomyEntity,
  RpTaxonomyDesignFamily,
} from "@/lib/types/firestore";

/** Normalize token to taxonomy code form: UPPER_SNAKE */
export function tokenToCode(token: string): string {
  return token
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

export interface ResolvedLeague {
  leagueCode: string;
  sportCode: string;
}

export interface ResolvedEntity {
  teamCode: string;
  sportCode: string;
}

/** Resolve league token (e.g. "MLB") against taxonomy. Exact code match only. */
export function resolveLeague(
  token: string,
  leagues: RpTaxonomyLeague[]
): ResolvedLeague | null {
  const code = tokenToCode(token);
  if (!code) return null;
  const league = leagues.find((l) => l.code === code);
  if (!league?.sportCode) return null;
  return { leagueCode: league.code, sportCode: league.sportCode };
}

/** Resolve team/entity token (e.g. "GIANTS") against taxonomy. Optional filter by leagueCode. */
export function resolveEntity(
  token: string,
  entities: RpTaxonomyEntity[],
  leagueCode?: string | null
): ResolvedEntity | null {
  const code = tokenToCode(token);
  if (!code) return null;
  let list = entities;
  if (leagueCode) {
    list = entities.filter((e) => e.leagueCode === leagueCode);
  }
  const entity = list.find((e) => e.code === code);
  if (!entity?.sportCode) return null;
  return { teamCode: entity.code, sportCode: entity.sportCode };
}

/** Resolve design family token (e.g. "WILL_DROP_FOR") against taxonomy. Exact code match only. */
export function resolveDesignFamily(
  token: string,
  designFamilies: RpTaxonomyDesignFamily[]
): string | null {
  const code = tokenToCode(token);
  if (!code) return null;
  const family = designFamilies.find((f) => f.code === code);
  return family ? family.code : null;
}

export interface ResolvedTaxonomy {
  sportCode: string | null;
  leagueCode: string | null;
  teamCode: string | null;
  themeCode: string | null;
  designFamily: string | null;
  /** Warnings for unresolved tokens (no guessing; store only resolved) */
  warnings: string[];
}

/**
 * Resolve parsed filename tokens to taxonomy codes.
 * Only sets fields that resolve; unresolved stay null. Warnings list unresolved tokens.
 */
export function resolveParsedTaxonomy(
  parsed: { league: string; designFamily: string; team: string },
  leagues: RpTaxonomyLeague[],
  entities: RpTaxonomyEntity[],
  designFamilies: RpTaxonomyDesignFamily[]
): ResolvedTaxonomy {
  const warnings: string[] = [];
  let sportCode: string | null = null;
  let leagueCode: string | null = null;
  let teamCode: string | null = null;
  const themeCode: string | null = null;
  let designFamily: string | null = null;

  const leagueRes = resolveLeague(parsed.league, leagues);
  if (leagueRes) {
    leagueCode = leagueRes.leagueCode;
    sportCode = leagueRes.sportCode;
  } else if (parsed.league) {
    warnings.push(`League "${parsed.league}" not found in taxonomy`);
  }

  const entityRes = resolveEntity(parsed.team, entities, leagueCode);
  if (entityRes) {
    teamCode = entityRes.teamCode;
    if (!sportCode) sportCode = entityRes.sportCode;
  } else if (parsed.team) {
    warnings.push(`Team/entity "${parsed.team}" not found in taxonomy`);
  }

  const familyCode = resolveDesignFamily(parsed.designFamily, designFamilies);
  if (familyCode) {
    designFamily = familyCode;
  } else if (parsed.designFamily) {
    warnings.push(`Design family "${parsed.designFamily}" not found in taxonomy`);
  }

  return {
    sportCode,
    leagueCode,
    teamCode,
    themeCode,
    designFamily,
    warnings,
  };
}

export type ResolutionStatus =
  | "Resolved"
  | "Unresolved team"
  | "Unresolved league"
  | "Unresolved design family"
  | "Partial resolution";

/**
 * Explicit resolution status for display in batch import preview.
 * Order: single missing → specific status; multiple missing → Partial resolution.
 */
export function resolutionStatus(resolved: ResolvedTaxonomy): ResolutionStatus {
  const hasLeague = resolved.leagueCode != null;
  const hasTeam = resolved.teamCode != null;
  const hasFamily = resolved.designFamily != null;
  if (hasLeague && hasTeam && hasFamily) return "Resolved";
  if (!hasTeam) return "Unresolved team";
  if (!hasLeague) return "Unresolved league";
  if (!hasFamily) return "Unresolved design family";
  return "Partial resolution";
}
