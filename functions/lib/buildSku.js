"use strict";

/**
 * Mirrors lib/products/buildSku.ts.
 *
 * SKU format: `RP-{LEAGUE}-{TEAM}-{DESIGN}-{BLANK}-{COLOR}-{SIZE}`
 *
 * {BLANK} was added 2026-06-01 (Phase A0). Pre-A0 SKUs are 6-part
 * (no blank); parseSku still accepts them with blankCode=null.
 */

function normalizeSkuSegment(raw, maxLen) {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const cut = s.slice(0, Math.max(1, maxLen));
  return cut || "X";
}

const STANDARD_COLOR_CODE = {
  PINK: "PNK",
  BLACK: "BLK",
  WHITE: "WHT",
  NAVY: "NVY",
  RED: "RED",
  BLUE: "BLU",
  GREY: "GRY",
  GRAY: "GRY",
  GREEN: "GRN",
  PURPLE: "PPL",
  YELLOW: "YLW",
  ORANGE: "ORG",
  MAROON: "MRN",
  CYAN: "CYN",
  BROWN: "BRN",
  KHAKI: "KHK",
  OLIVE: "OLV",
  CORAL: "CRL",
  LIME: "LME",
  TEAL: "TEL",
  GOLD: "GLD",
  SILVER: "SLV",
  HEATHERGREY: "HGR",
  HEATHERGRAY: "HGR",
  ROYAL: "RYL",
  ROYALBLUE: "RYL",
  KELLY: "KLY",
  KELLYGREEN: "KLY",
  CARDINAL: "CRD",
  SCARLET: "SCR",
};

function resolveColorCodeForSku(colorName) {
  const compact = String(colorName ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact) return "XXX";
  const mapped = STANDARD_COLOR_CODE[compact];
  if (mapped) return mapped.slice(0, 3).padEnd(3, "X");
  if (compact.length <= 3) return compact.padEnd(3, "X").slice(0, 3);
  return compact.slice(0, 3);
}

/**
 * Stable design segment. Bug history (2026-06-01, Phase A0 tests):
 * the original used `normalizeSkuSegment` which "X"-pads empty inputs,
 * so the combined fam+ser was always ≥ 2 chars ("XX") and short-circuited
 * the designType/designId branches. Fixed below to skip the "X" fallback
 * in the chain so downstream fallbacks actually execute.
 */
function buildDesignCodeForSku(p) {
  const tryNormalize = (raw, maxLen) => {
    if (raw == null) return "";
    const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.slice(0, Math.max(1, maxLen));
  };
  const tc = tryNormalize(p.themeCode, 10);
  if (tc.length >= 2) return tc;
  const fam = tryNormalize(p.designFamily, 8);
  const ser = tryNormalize(p.designSeries, 6);
  const combined = `${fam}${ser}`.slice(0, 10);
  if (combined.length >= 2) return combined;
  const dt = tryNormalize(p.designType, 10);
  if (dt.length >= 2) return dt;
  const id = tryNormalize(p.designId, 8);
  if (id.length >= 2) return id;
  return "XX";
}

function buildSku(p) {
  const league = normalizeSkuSegment(p.leagueCode, 8);
  const team = normalizeSkuSegment(p.teamCode, 6);
  const design = normalizeSkuSegment(p.designCode, 10);
  const blank = normalizeSkuSegment(p.blankCode, 6);
  const color = normalizeSkuSegment(p.colorCode, 3).padEnd(3, "X").slice(0, 3);
  const size = normalizeSkuSegment(p.size, 4);
  return `RP-${league}-${team}-${design}-${blank}-${color}-${size}`;
}

/**
 * Parse a canonical `RP-…` SKU. Accepts both the new 7-part format
 * (Phase A0+) and the legacy 6-part format (pre-A0, blankCode=null).
 */
function parseSku(sku) {
  const s = String(sku ?? "").trim().toUpperCase();
  const parts = s.split("-").filter((x) => x.length > 0);
  if (parts[0] !== "RP") return null;
  if (parts.length === 7) {
    return {
      raw: s,
      leagueCode: parts[1],
      teamCode: parts[2],
      designCode: parts[3],
      blankCode: parts[4],
      colorCode: parts[5],
      size: parts[6],
    };
  }
  if (parts.length === 6) {
    return {
      raw: s,
      leagueCode: parts[1],
      teamCode: parts[2],
      designCode: parts[3],
      blankCode: null,
      colorCode: parts[4],
      size: parts[5],
    };
  }
  return null;
}

function assertDistinctSkuCandidates(skus) {
  const seen = new Set();
  for (const raw of skus) {
    const k = String(raw ?? "").trim().toUpperCase();
    if (!k) continue;
    if (seen.has(k)) {
      throw new Error(`Duplicate SKU in batch: ${k}`);
    }
    seen.add(k);
  }
}

module.exports = {
  buildSku,
  buildDesignCodeForSku,
  resolveColorCodeForSku,
  normalizeSkuSegment,
  parseSku,
  assertDistinctSkuCandidates,
};
