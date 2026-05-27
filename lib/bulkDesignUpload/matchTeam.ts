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

/**
 * Build a list of candidate team slugs (priority order) so `matchDesignTeamMulti`
 * can recover when the parser's `parsedTeam` is ambiguous (e.g. just `giants`)
 * but `inferred.teamSlugCandidate` from designKey is specific. Each candidate
 * is independently fed through the match chain.
 */
export function buildTeamSlugCandidates(
  parsedTeam: string,
  inferred: InferredIdentity
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  };
  push(resolveTeamSlugForMatch(parsedTeam, inferred));
  push(inferred.teamSlugCandidate);
  push(parsedTeam);
  return out;
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

  /**
   * Loose-overlap fallback is dangerous when the candidate is a short nickname
   * like `giants` (matches BOTH `sf_giants` AND `new_york_giants`; Firestore
   * iteration is alphabetical so `new_york_giants` would always win). Require
   * leagueHint to disambiguate and require a unique match — otherwise fail
   * closed so we don't silently mis-assign teams.
   */
  {
    const overlap = teams.filter(
      (t) =>
        leagueMatchesTeam(t, leagueHint) &&
        (normKey(t.id).includes(candNorm) || candNorm.includes(normKey(t.id)))
    );
    if (overlap.length === 1) {
      warnings.push(`Team matched loosely by id overlap: ${overlap[0]!.id}`);
      return { team: overlap[0]!, warnings };
    }
    if (overlap.length > 1) {
      warnings.push(
        `Ambiguous loose match for "${teamSlugCandidate}" within league ${
          leagueHint || "(any)"
        }: ${overlap.map((t) => t.id).join(", ")}`
      );
    }
  }

  const candParts = cand.split("_").filter(Boolean);
  {
    const byName = teams.filter((t) => {
      if (!leagueMatchesTeam(t, leagueHint)) return false;
      const nameNorm = normKey(t.name || "");
      return candParts.every((p) => p.length > 2 && nameNorm.includes(normKey(p)));
    });
    if (byName.length === 1) {
      warnings.push(`Team matched by name tokens: ${byName[0]!.name}`);
      return { team: byName[0]!, warnings };
    }
    if (byName.length > 1) {
      warnings.push(
        `Ambiguous name-token match for "${teamSlugCandidate}" within league ${
          leagueHint || "(any)"
        }: ${byName.map((t) => t.id).join(", ")}`
      );
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
    if (byNick.length > 1) {
      warnings.push(
        `Ambiguous nickname+league match for "${teamSlugCandidate}" in ${
          leagueHint || "(any)"
        }: ${byNick.map((t) => t.id).join(", ")}`
      );
    }
  }

  warnings.push(`No design_teams match for slug "${teamSlugCandidate}"`);
  return { team: null, warnings };
}

/**
 * Try each candidate slug through `matchDesignTeam`; return the first hit.
 * Used to recover when the parsed team token is ambiguous (e.g., `giants`)
 * but the inferred candidate from designKey is specific.
 */
export function matchDesignTeamMulti(
  candidates: string[],
  teams: DesignTeam[],
  options?: MatchDesignTeamOptions
): { team: DesignTeam | null; warnings: string[] } {
  const aggregated: string[] = [];
  for (const cand of candidates) {
    const { team, warnings } = matchDesignTeam(cand, teams, options);
    if (team) {
      return { team, warnings: [...aggregated, ...warnings] };
    }
    aggregated.push(...warnings);
  }
  return { team: null, warnings: aggregated };
}
