/**
 * Blank / variant eligibility: which teams may pair with a blank variant at generation time.
 * Garment colors are **only** defined on blank `variants[]`; eligibility only filters teams.
 */

import type {
  DesignTeam,
  RPBlank,
  RPBlankEligibility,
  RPBlankVariant,
  RPBlankVariantEligibilityOverride,
} from "@/lib/types/firestore";

/** UI + rule chips — extend as taxonomy grows */
export const TEAM_COLOR_FAMILY_OPTIONS = [
  "black",
  "white",
  "grey",
  "red",
  "blue",
  "navy",
  "green",
  "orange",
  "purple",
  "teal",
  "pink",
  "yellow",
] as const;

export type TeamColorFamilyOption = (typeof TEAM_COLOR_FAMILY_OPTIONS)[number];

/** Effective rules after merging variant override (when enabled). */
export interface EffectiveBlankEligibility {
  source: "master" | "variant";
  allowedLeagues: string[];
  allowAllTeamsInAllowedLeagues: boolean;
  matchTeamColorFamilies: boolean;
  allowedTeamColorFamilies: string[];
  supportedDesignZones: string[];
  supportedProductFamilies: string[];
  includedTeamIds: string[];
  excludedTeamIds: string[];
}

function normLeague(t: DesignTeam): string | null {
  const id = t.leagueId?.trim();
  if (id) return id;
  const l = t.league?.trim();
  return l || null;
}

function teamInAllowedLeagues(team: DesignTeam, leagues: string[]): boolean {
  if (leagues.length === 0) return true;
  const nl = normLeague(team);
  if (!nl) return false;
  const upper = leagues.map((x) => x.trim().toUpperCase());
  return upper.includes(nl.toUpperCase());
}

/** Team matches color rule if it has any colorFamilies intersecting allowed (case-insensitive). */
export function teamMatchesColorFamilies(team: DesignTeam, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const fam = team.colorFamilies;
  if (!fam?.length) return false;
  const allow = new Set(allowed.map((c) => c.trim().toLowerCase()));
  return fam.some((f) => allow.has(String(f).trim().toLowerCase()));
}

function normalizeMaster(e: RPBlankEligibility | null | undefined): Omit<EffectiveBlankEligibility, "source"> {
  return {
    allowedLeagues: (e?.allowedLeagues ?? []).filter(Boolean),
    allowAllTeamsInAllowedLeagues: e?.allowAllTeamsInAllowedLeagues !== false,
    matchTeamColorFamilies: e?.matchTeamColorFamilies === true,
    allowedTeamColorFamilies: (e?.allowedTeamColorFamilies ?? []).filter(Boolean),
    supportedDesignZones: (e?.supportedDesignZones ?? []).filter(Boolean),
    supportedProductFamilies: (e?.supportedProductFamilies ?? []).filter(Boolean),
    includedTeamIds: (e?.includedTeamIds ?? []).filter(Boolean),
    excludedTeamIds: (e?.excludedTeamIds ?? []).filter(Boolean),
  };
}

function normalizeVariantOverride(
  o: RPBlankVariantEligibilityOverride | null | undefined
): Omit<EffectiveBlankEligibility, "source" | "supportedDesignZones" | "supportedProductFamilies"> | null {
  if (!o || o.enabled !== true) return null;
  return {
    allowedLeagues: (o.allowedLeagues ?? []).filter(Boolean),
    allowAllTeamsInAllowedLeagues: o.allowAllTeamsInAllowedLeagues !== false,
    matchTeamColorFamilies: o.matchTeamColorFamilies === true,
    allowedTeamColorFamilies: (o.allowedTeamColorFamilies ?? []).filter(Boolean),
    includedTeamIds: (o.includedTeamIds ?? []).filter(Boolean),
    excludedTeamIds: (o.excludedTeamIds ?? []).filter(Boolean),
  };
}

/**
 * Merge master blank eligibility with optional variant override.
 * Design zones / product families are master-only (variant does not redefine in schema).
 */
export function getEffectiveEligibility(
  blank: Pick<RPBlank, "eligibility">,
  variant?: Pick<RPBlankVariant, "eligibilityOverride"> | null
): EffectiveBlankEligibility {
  const master = normalizeMaster(blank.eligibility ?? null);
  const vo = normalizeVariantOverride(variant?.eligibilityOverride ?? null);
  if (vo) {
    return {
      source: "variant",
      ...vo,
      supportedDesignZones: master.supportedDesignZones,
      supportedProductFamilies: master.supportedProductFamilies,
    };
  }
  return {
    source: "master",
    ...master,
  };
}

export interface EligibleTeamsResult {
  teams: DesignTeam[];
  /** True if master has no eligibility block and no variant override enabled */
  notConfigured: boolean;
  /** Human-readable notes for preview */
  notes: string[];
}

/**
 * Compute eligible teams for preview / future batch generation.
 *
 * Precedence:
 * 1. Scope to allowed leagues (if any)
 * 2. If allow all in leagues: keep all in scope, else narrow (see below)
 * 3. Apply color-family filter when enabled
 * 4. Union includedTeamIds (force include)
 * 5. Remove excludedTeamIds
 */
export function computeEligibleTeams(
  allTeams: DesignTeam[],
  rules: EffectiveBlankEligibility
): EligibleTeamsResult {
  const notes: string[] = [];
  const excluded = new Set(rules.excludedTeamIds);
  const includedIds = new Set(rules.includedTeamIds);
  const byId = new Map(allTeams.map((t) => [t.id, t]));

  const colorFilterOn =
    rules.matchTeamColorFamilies && rules.allowedTeamColorFamilies.length > 0;
  const colorOk = (t: DesignTeam) =>
    !colorFilterOn || teamMatchesColorFamilies(t, rules.allowedTeamColorFamilies);

  let pool: DesignTeam[] = [];

  if (rules.allowedLeagues.length > 0) {
    const inLeague = allTeams.filter((t) => teamInAllowedLeagues(t, rules.allowedLeagues));
    if (rules.allowAllTeamsInAllowedLeagues) {
      pool = colorFilterOn ? inLeague.filter(colorOk) : [...inLeague];
      if (colorFilterOn) notes.push("Teams in selected leagues filtered by color families.");
    } else {
      if (colorFilterOn) {
        pool = inLeague.filter(colorOk);
        notes.push("All teams in leagues off: showing league teams that match color families.");
      } else {
        pool = inLeague.filter((t) => includedIds.has(t.id));
        if (pool.length === 0 && inLeague.length > 0) {
          notes.push(
            "Turn on “Allow all teams in selected leagues”, enable color matching, or add included teams."
          );
        }
      }
    }
  } else {
    if (colorFilterOn) {
      pool = allTeams.filter(colorOk);
      notes.push("No leagues selected — previewing all teams that match color families.");
    } else if (includedIds.size > 0) {
      pool = [];
      notes.push("No leagues — only explicitly included teams will be eligible.");
    } else {
      pool = [];
      notes.push("Select allowed leagues and/or enable color-family matching / included teams.");
    }
  }

  const seen = new Set(pool.map((t) => t.id));
  for (const id of includedIds) {
    const t = byId.get(id);
    if (t && !seen.has(id)) {
      pool.push(t);
      seen.add(id);
    }
  }

  let matched = pool.filter((t) => !excluded.has(t.id));

  const notConfigured =
    rules.allowedLeagues.length === 0 &&
    !colorFilterOn &&
    includedIds.size === 0;

  return {
    teams: matched.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    notConfigured,
    notes,
  };
}

/** Master + optional variant for preview column on variant row */
export function getEffectiveEligibilityForVariant(
  blank: Pick<RPBlank, "eligibility">,
  variant: RPBlankVariant | null | undefined
): EffectiveBlankEligibility {
  return getEffectiveEligibility(blank, variant ?? null);
}
