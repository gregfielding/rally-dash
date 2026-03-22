/**
 * Canonical DesignTeam dataset — Phase 1 (MLB, NFL, NBA, NHL, MLS).
 * Source files: mlbDesignTeams.js + mlbCanonicalMeta.json, *DesignTeams.json per league.
 * Used by scripts/seed-design-teams-phase1.js and seedDesignTeamsCanonicalPhase1 callable.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { MLB_DESIGN_TEAMS } = require("./mlbDesignTeams");
const { enrichTeamColors } = require("./teamColorUtils");
const { enrichDesignTeamMetadata } = require("./designTeamEnrichment");

const ALLOWED_COLOR_FAMILIES = [
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
];

const ALLOWED_SET = new Set(ALLOWED_COLOR_FAMILIES);

/** Map common aliases to canonical tokens */
const COLOR_ALIASES = {
  gray: "grey",
  gold: "yellow",
  silver: "grey",
  maroon: "red",
  crimson: "red",
};

function loadJson(filename) {
  const p = path.join(__dirname, filename);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeColorFamilies(families) {
  if (!Array.isArray(families) || families.length === 0) {
    throw new Error("colorFamilies must be a non-empty array");
  }
  const out = [];
  for (const raw of families) {
    const k = String(raw || "")
      .trim()
      .toLowerCase();
    const canon = COLOR_ALIASES[k] || k;
    if (!ALLOWED_SET.has(canon)) {
      throw new Error(`Invalid colorFamily "${raw}" → "${canon}"; allowed: ${ALLOWED_COLOR_FAMILIES.join(", ")}`);
    }
    if (!out.includes(canon)) out.push(canon);
  }
  if (out.length === 0) throw new Error("colorFamilies normalized to empty");
  return out.slice(0, 3);
}

function validateTeamRecord(t, idx) {
  const label = t.id || `#${idx}`;
  if (!t.id || typeof t.id !== "string") throw new Error(`${label}: missing id`);
  if (!t.name || typeof t.name !== "string") throw new Error(`${label}: missing name`);
  if (!t.teamCode || typeof t.teamCode !== "string") throw new Error(`${label}: missing teamCode`);
  if (!/^[A-Z0-9_]+$/.test(t.teamCode)) throw new Error(`${label}: teamCode must be uppercase alphanumeric/underscore`);
  if (!t.slug || typeof t.slug !== "string") throw new Error(`${label}: missing slug`);
  if (!t.primaryColorHex || typeof t.primaryColorHex !== "string") throw new Error(`${label}: missing primaryColorHex`);
  t.colorFamilies = normalizeColorFamilies(t.colorFamilies);
  if (!t.leagueCode) t.leagueCode = t.leagueId || t.league;
  if (!t.leagueId) t.leagueId = t.leagueCode;
  if (!t.league) t.league = t.leagueCode;
}

function finalizeTeamRecord(t, idx) {
  const label = t.id || `#${idx}`;
  validateTeamRecord(t, idx);
  enrichTeamColors(t, label);
  if (!Array.isArray(t.teamColors) || t.teamColors.length < 1) {
    throw new Error(`${label}: teamColors must include at least one color`);
  }
  if (t.printVerificationStatus !== "verified" && t.printVerificationStatus !== "derived") {
    t.printVerificationStatus = "derived";
  }
  enrichDesignTeamMetadata(t, label);
}

function indexVerifiedMlbById(verifiedRaw) {
  if (verifiedRaw.teams && Array.isArray(verifiedRaw.teams)) {
    const byId = {};
    for (const row of verifiedRaw.teams) {
      if (!row.id) throw new Error("mlbVerifiedBrandColors: team row missing id");
      byId[row.id] = row;
    }
    return byId;
  }
  return verifiedRaw;
}

function buildMlbCanonical() {
  const meta = loadJson("mlbCanonicalMeta.json");
  const verified = indexVerifiedMlbById(loadJson("mlbVerifiedBrandColors.json"));
  return MLB_DESIGN_TEAMS.map((t) => {
    const m = meta[t.id];
    if (!m) throw new Error(`mlbCanonicalMeta.json missing key: ${t.id}`);
    const v = verified[t.id];
    if (!v) throw new Error(`mlbVerifiedBrandColors.json missing team id: ${t.id}`);
    if (v.colorVerificationStatus !== "verified") {
      throw new Error(`${t.id}: MLB colors must have colorVerificationStatus \"verified\"`);
    }
    return {
      ...t,
      leagueCode: "MLB",
      leagueId: t.leagueId || "MLB",
      league: t.league || "MLB",
      teamCode: m.teamCode,
      slug: m.slug,
      stadiumName: m.stadiumName || null,
      teamSaying: null,
      fanPhrase: null,
      fullName: t.name,
      teamColors: v.teamColors,
      primaryColorHex: v.primaryColorHex,
      secondaryColorHex: v.secondaryColorHex,
      colorFamilies: v.colorFamilies,
      colorVerificationStatus: v.colorVerificationStatus,
      printVerificationStatus: v.printVerificationStatus === "verified" ? "verified" : "derived",
    };
  });
}

function buildCanonicalDesignTeamsPhase1() {
  const mlb = buildMlbCanonical();
  const nfl = loadJson("nflDesignTeams.json");
  const nba = loadJson("nbaDesignTeams.json");
  const nhl = loadJson("nhlDesignTeams.json");
  const mls = loadJson("mlsDesignTeams.json");

  const all = [...mlb, ...nfl, ...nba, ...nhl, ...mls];
  all.forEach((t, i) => finalizeTeamRecord(t, i));

  const byLeague = {};
  for (const t of all) {
    const code = t.leagueCode || t.leagueId || "UNKNOWN";
    byLeague[code] = (byLeague[code] || 0) + 1;
  }

  return { teams: all, countsByLeague: byLeague, allowedColorFamilies: [...ALLOWED_SET] };
}

/** Lazy singleton for callers */
let _cached = null;
function getCanonicalDesignTeamsPhase1() {
  if (!_cached) _cached = buildCanonicalDesignTeamsPhase1();
  return _cached;
}

module.exports = {
  ALLOWED_COLOR_FAMILIES,
  normalizeColorFamilies,
  buildCanonicalDesignTeamsPhase1,
  getCanonicalDesignTeamsPhase1,
  enrichTeamColors,
  enrichDesignTeamMetadata: require("./designTeamEnrichment").enrichDesignTeamMetadata,
};
