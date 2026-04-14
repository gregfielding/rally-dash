/**
 * Match `design_teams` row from filename-derived team slug.
 */

import type { DesignTeam } from "@/lib/types/firestore";
import type { InferredIdentity } from "./inferIdentity";

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Filename slugs often compress cities ("newyork") while `design_teams.id` uses short codes ("ny_yankees").
 * Values are canonical Firestore document ids under `design_teams`.
 */
const TEAM_SLUG_ALIASES: Record<string, string> = {
  newyork_yankees: "ny_yankees",
  new_york_yankees: "ny_yankees",
  newyork_mets: "ny_mets",
  new_york_mets: "ny_mets",
  sanfrancisco_giants: "sf_giants",
  san_francisco_giants: "sf_giants",
  losangeles_dodgers: "los_angeles_dodgers",
  los_angeles_dodgers: "los_angeles_dodgers",
  losangeles_angels: "los_angeles_angels",
  los_angeles_angels: "los_angeles_angels",
};

function leagueMatchesTeam(
  t: DesignTeam,
  leagueHint: string | null | undefined
): boolean {
  if (leagueHint == null || String(leagueHint).trim() === "") return true;
  const h = String(leagueHint).trim().toUpperCase();
  const lc = String(t.leagueCode || t.leagueId || t.league || "")
    .trim()
    .toUpperCase();
  return !lc || lc === h;
}

/**
 * `splitMiddleForTeamAndFamily` uses the last middle token as `parsed.team` — for themes like `…_69` that token is
 * the numeric series, not a team. Prefer `inferred.teamSlugCandidate` in that case.
 */
export function resolveTeamSlugForMatch(parsedTeam: string, inferred: InferredIdentity): string {
  if (inferred.designType === "city_69") {
    return inferred.teamSlugCandidate;
  }
  const pt = String(parsedTeam ?? "").trim();
  const inf = String(inferred.teamSlugCandidate ?? "").trim();
  if (/^\d+$/.test(pt) && inf.length > 0) {
    return inf;
  }
  return pt || inf;
}

export type MatchDesignTeamOptions = {
  /** First designKey token (e.g. `mlb`) → match `design_teams.leagueCode` when nickname matching. */
  leagueHint?: string | null;
};

/**
 * Prefer exact id match, then slug, then teamCode, then substring / tag overlap.
 */
export function matchDesignTeam(
  teamSlugCandidate: string,
  teams: DesignTeam[],
  options?: MatchDesignTeamOptions
): { team: DesignTeam | null; warnings: string[] } {
  const warnings: string[] = [];
  const cand = teamSlugCandidate.trim();
  if (!cand) {
    return { team: null, warnings: ["Missing team slug in identity"] };
  }

  const candNorm = normKey(cand);
  const leagueHint = options?.leagueHint;

  const aliasTarget = TEAM_SLUG_ALIASES[cand.toLowerCase()];
  if (aliasTarget) {
    for (const t of teams) {
      if (t.id === aliasTarget) {
        warnings.push(`Team matched via filename alias → ${aliasTarget}`);
        return { team: t, warnings };
      }
    }
  }

  for (const t of teams) {
    if (t.id === cand || t.id.toLowerCase() === cand.toLowerCase()) {
      return { team: t, warnings };
    }
  }

  for (const t of teams) {
    if (t.slug && normKey(t.slug) === candNorm) return { team: t, warnings };
    if (t.teamCode && normKey(t.teamCode) === candNorm) return { team: t, warnings };
    if (t.name && normKey(t.name) === candNorm) return { team: t, warnings };
  }

  for (const t of teams) {
    if (normKey(t.id).includes(candNorm) || candNorm.includes(normKey(t.id))) {
      warnings.push(`Team matched loosely by id overlap: ${t.id}`);
      return { team: t, warnings };
    }
  }

  const candParts = cand.split("_").filter(Boolean);
  for (const t of teams) {
    const nameNorm = normKey(t.name || "");
    const hit = candParts.every((p) => p.length > 2 && nameNorm.includes(normKey(p)));
    if (hit) {
      warnings.push(`Team matched by name tokens: ${t.name}`);
      return { team: t, warnings };
    }
  }

  const lastTok = candParts.length ? candParts[candParts.length - 1]! : "";
  if (lastTok.length > 2) {
    const nick = normKey(lastTok);
    const byNick = teams.filter(
      (t) =>
        leagueMatchesTeam(t, leagueHint) &&
        t.teamName &&
        normKey(t.teamName) === nick
    );
    if (byNick.length === 1) {
      warnings.push(`Team matched by nickname + league: ${byNick[0]!.teamName}`);
      return { team: byNick[0]!, warnings };
    }
  }

  warnings.push(`No design_teams match for slug "${teamSlugCandidate}"`);
  return { team: null, warnings };
}
