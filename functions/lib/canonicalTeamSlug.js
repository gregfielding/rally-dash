"use strict";

/**
 * Single canonical team slug for tags, collections, and design_teams document ids:
 * slugify(full official team name) → e.g. san_francisco_giants, los_angeles_dodgers.
 * No short forms (sf_giants, la_dodgers, dodgers).
 */

function slugifyUnderscore(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
}

/**
 * @param {string} fullName - Official name e.g. "San Francisco Giants"
 * @returns {string|null}
 */
function canonicalTeamSlugFromFullTeamName(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return slugifyUnderscore(s);
}

function canonicalTeamSlugFromCityAndNickname(city, nickname) {
  const c = String(city || "").trim();
  const n = String(nickname || "").trim();
  if (!c || !n) return null;
  return slugifyUnderscore(`${c} ${n}`);
}

/**
 * @param {object} t - RpTaxonomyDisplay-like
 */
function canonicalTeamSlugFromTaxonomy(t) {
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

/**
 * @param {object} team - design_teams fields + optional id
 * @param {string} [teamDisplayFallback] - from buildTeamDisplayName(team, design)
 */
function canonicalTeamSlugFromDesignTeam(team, teamDisplayFallback) {
  if (team && team.name && String(team.name).trim()) {
    const u = canonicalTeamSlugFromFullTeamName(team.name);
    if (u) return u;
  }
  if (team && team.city && team.teamName) {
    const u = canonicalTeamSlugFromCityAndNickname(team.city, team.teamName);
    if (u) return u;
  }
  if (teamDisplayFallback) {
    return canonicalTeamSlugFromFullTeamName(teamDisplayFallback);
  }
  return null;
}

module.exports = {
  slugifyUnderscore,
  canonicalTeamSlugFromFullTeamName,
  canonicalTeamSlugFromCityAndNickname,
  canonicalTeamSlugFromTaxonomy,
  canonicalTeamSlugFromDesignTeam,
};
