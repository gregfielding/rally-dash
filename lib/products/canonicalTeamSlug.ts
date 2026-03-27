/**
 * Canonical team slug for structured tags (`team:...`), Shopify collection handles, and `design_teams` doc ids.
 * Format: `slugify(full_official_team_name)` with underscores, e.g. `san_francisco_giants`, `los_angeles_dodgers`.
 * Not allowed: short city codes (`sf_giants`, `la_dodgers`) or nickname-only (`dodgers`).
 */

import type { RpTaxonomyDisplay } from "@/lib/types/firestore";

function slugifyUnderscore(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
}

/**
 * Official name must include at least city + nickname (two+ words).
 */
export function canonicalTeamSlugFromFullTeamName(fullName: string | null | undefined): string | null {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return slugifyUnderscore(s);
}

export function canonicalTeamSlugFromCityAndNickname(
  city: string | null | undefined,
  nickname: string | null | undefined
): string | null {
  const c = String(city || "").trim();
  const n = String(nickname || "").trim();
  if (!c || !n) return null;
  return slugifyUnderscore(`${c} ${n}`);
}

export function canonicalTeamSlugFromTaxonomy(t: RpTaxonomyDisplay | null | undefined): string | null {
  if (!t || typeof t !== "object") return null;
  const teamName = t.teamName != null && String(t.teamName).trim() ? String(t.teamName).trim() : null;
  if (teamName) {
    const fromFull = canonicalTeamSlugFromFullTeamName(teamName);
    if (fromFull) return fromFull;
  }
  const cityRaw = t.cityName != null && String(t.cityName).trim() ? t.cityName : t.teamCity;
  const city = cityRaw != null && String(cityRaw).trim() ? String(cityRaw).trim() : null;
  const nickRaw =
    t.teamNickname != null && String(t.teamNickname).trim()
      ? t.teamNickname
      : teamName != null && String(teamName).trim()
        ? teamName
        : null;
  const nick = nickRaw != null && String(nickRaw).trim() ? String(nickRaw).trim() : null;
  if (city && nick) {
    return canonicalTeamSlugFromCityAndNickname(city, nick);
  }
  return null;
}

export interface DesignTeamLikeForSlug {
  id?: string;
  name?: string | null;
  city?: string | null;
  teamName?: string | null;
}

export function canonicalTeamSlugFromDesignTeam(
  team: DesignTeamLikeForSlug | null | undefined,
  teamDisplayFallback: string | null | undefined
): string | null {
  if (team?.name != null && String(team.name).trim()) {
    const u = canonicalTeamSlugFromFullTeamName(String(team.name).trim());
    if (u) return u;
  }
  if (team?.city != null && String(team.city).trim() && team?.teamName != null && String(team.teamName).trim()) {
    return canonicalTeamSlugFromCityAndNickname(String(team.city).trim(), String(team.teamName).trim());
  }
  if (teamDisplayFallback) {
    return canonicalTeamSlugFromFullTeamName(teamDisplayFallback);
  }
  return null;
}
