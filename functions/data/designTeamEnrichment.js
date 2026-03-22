/**
 * Safe, structured DesignTeam metadata enrichment for canonical seed.
 * Does NOT infer rivals, mascots, or trademarked slogans — those stay empty/null unless explicitly in source JSON.
 */

"use strict";

/** US / CA state & province → neutral geographic keywords (not trademarked). */
const STATE_REGION_KEYWORDS = {
  AL: ["alabama", "southeast"],
  AK: ["alaska", "pacific"],
  AZ: ["arizona", "southwest"],
  AR: ["arkansas", "south central"],
  CA: ["california", "west coast"],
  CO: ["colorado", "mountain west"],
  CT: ["connecticut", "northeast"],
  DE: ["delaware", "mid-atlantic"],
  DC: ["washington dc", "mid-atlantic"],
  FL: ["florida", "southeast"],
  GA: ["georgia", "southeast"],
  HI: ["hawaii", "pacific"],
  ID: ["idaho", "mountain west"],
  IL: ["illinois", "midwest"],
  IN: ["indiana", "midwest"],
  IA: ["iowa", "midwest"],
  KS: ["kansas", "midwest"],
  KY: ["kentucky", "south"],
  LA: ["louisiana", "south"],
  ME: ["maine", "northeast"],
  MD: ["maryland", "mid-atlantic"],
  MA: ["massachusetts", "northeast"],
  MI: ["michigan", "midwest"],
  MN: ["minnesota", "midwest"],
  MS: ["mississippi", "south"],
  MO: ["missouri", "midwest"],
  MT: ["montana", "mountain west"],
  NE: ["nebraska", "midwest"],
  NV: ["nevada", "west"],
  NH: ["new hampshire", "northeast"],
  NJ: ["new jersey", "northeast"],
  NM: ["new mexico", "southwest"],
  NY: ["new york", "northeast"],
  NC: ["north carolina", "southeast"],
  ND: ["north dakota", "midwest"],
  OH: ["ohio", "midwest"],
  OK: ["oklahoma", "south central"],
  OR: ["oregon", "pacific northwest"],
  PA: ["pennsylvania", "northeast"],
  RI: ["rhode island", "northeast"],
  SC: ["south carolina", "southeast"],
  SD: ["south dakota", "midwest"],
  TN: ["tennessee", "south"],
  TX: ["texas", "southwest"],
  UT: ["utah", "mountain west"],
  VT: ["vermont", "northeast"],
  VA: ["virginia", "mid-atlantic"],
  WA: ["washington", "pacific northwest"],
  WV: ["west virginia", "mid-atlantic"],
  WI: ["wisconsin", "midwest"],
  WY: ["wyoming", "mountain west"],
  ON: ["ontario", "canada"],
  BC: ["british columbia", "canada", "pacific"],
  AB: ["alberta", "canada"],
  QC: ["quebec", "canada"],
  MB: ["manitoba", "canada"],
  SK: ["saskatchewan", "canada"],
  NS: ["nova scotia", "canada"],
  NB: ["new brunswick", "canada"],
};

function slugifyToken(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-+/g, "-");
}

/** Single tag: lowercase, hyphenated, a-z0-9- only */
function normalizeTag(raw) {
  const t = slugifyToken(raw);
  if (!t || t.length > 128) return null;
  return t;
}

function dedupeTags(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const n = normalizeTag(x);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Merge explicit tags with city, nickname, league, id/slug/teamCode for search.
 */
function buildNormalizedTags(team) {
  const fromSource = Array.isArray(team.tags) ? team.tags : [];
  const extra = [];
  const lc = team.leagueCode || team.leagueId || team.league;
  if (lc) extra.push(String(lc).toLowerCase());
  if (team.slug) extra.push(team.slug);
  if (team.teamCode) extra.push(String(team.teamCode).toLowerCase().replace(/_/g, "-"));
  if (team.id) extra.push(team.id.replace(/_/g, "-"));
  if (team.city) extra.push(slugifyToken(team.city));
  if (team.teamName) extra.push(slugifyToken(team.teamName));
  if (team.name) extra.push(slugifyToken(team.name));
  return dedupeTags([...fromSource, ...extra]);
}

function buildRegionFromState(state) {
  if (!state || typeof state !== "string") return [];
  const code = state.trim().toUpperCase();
  const row = STATE_REGION_KEYWORDS[code];
  return row ? row.map((r) => slugifyToken(r)).filter(Boolean) : [];
}

/**
 * Generic social-style hashtags from slug / teamCode (no trademarked slogans).
 * Example: sf-giants → #sf-giants, #sfgiants
 */
function buildHashtagsFromSlug(slug, teamCode) {
  const out = [];
  if (slug && typeof slug === "string") {
    const s = slug.trim().toLowerCase();
    if (s) {
      out.push(`#${s}`);
      const compact = s.replace(/-/g, "");
      if (compact && compact !== s) out.push(`#${compact}`);
    }
  }
  if (teamCode && typeof teamCode === "string") {
    const c = String(teamCode).trim().toLowerCase().replace(/_/g, "");
    if (c) {
      const h = `#${c}`;
      if (!out.includes(h)) out.push(h);
    }
  }
  return [...new Set(out)];
}

function validateFanPhraseEntry(entry, label) {
  if (!entry || typeof entry !== "object") throw new Error(`${label}: invalid fanPhrase`);
  const text = entry.text != null ? String(entry.text).trim() : "";
  if (!text) throw new Error(`${label}: fanPhrase.text required`);
  const type = entry.type != null ? String(entry.type).trim() : "unknown";
  const verified = entry.verified === true;
  return { text, type, verified };
}

function normalizeFanPhrases(arr, label) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) throw new Error(`${label}: fanPhrases must be an array`);
  return arr.map((e, i) => validateFanPhraseEntry(e, `${label}[${i}]`));
}

/**
 * Apply safe defaults and normalizations. Source JSON may override region, rivals, mascot, hashtags, fanPhrases.
 * fanPhrases: never auto-filled here — must be explicit; not safe for automated product copy without human review.
 */
function enrichDesignTeamMetadata(team, label) {
  team.tags = buildNormalizedTags(team);

  const regionFromState = buildRegionFromState(team.state);
  if (Array.isArray(team.region) && team.region.length > 0) {
    team.region = dedupeTags(team.region.map((r) => slugifyToken(String(r))));
  } else {
    team.region = regionFromState.length ? regionFromState : [];
  }

  if (Array.isArray(team.rivals) && team.rivals.length > 0) {
    team.rivals = [...new Set(team.rivals.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  } else {
    team.rivals = [];
  }

  if (team.mascot != null && String(team.mascot).trim() !== "") {
    team.mascot = String(team.mascot).trim();
  } else {
    team.mascot = null;
  }

  if (Array.isArray(team.hashtags) && team.hashtags.length > 0) {
    team.hashtags = team.hashtags.map((h) => {
      const s = String(h).trim();
      if (!s) return null;
      const withHash = s.startsWith("#") ? s : `#${s}`;
      return withHash.toLowerCase();
    }).filter(Boolean);
    team.hashtags = [...new Set(team.hashtags)];
  } else {
    team.hashtags = buildHashtagsFromSlug(team.slug, team.teamCode);
  }

  if (Array.isArray(team.fanPhrases) && team.fanPhrases.length > 0) {
    team.fanPhrases = normalizeFanPhrases(team.fanPhrases, `${label}.fanPhrases`);
  } else {
    team.fanPhrases = [];
  }

  return team;
}

module.exports = {
  enrichDesignTeamMetadata,
  normalizeTag,
  dedupeTags,
  buildNormalizedTags,
  buildRegionFromState,
  buildHashtagsFromSlug,
};
