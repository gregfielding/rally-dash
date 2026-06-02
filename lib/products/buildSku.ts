/**
 * Deterministic Shopify SKUs: `RP-{LEAGUE}-{TEAM}-{DESIGN}-{BLANK}-{COLOR}-{SIZE}`
 *
 * The {BLANK} segment was added 2026-06-01 (Phase A0) so launching the same
 * design across multiple blanks for one team doesn't collide. Without it,
 * "SF Giants Pillows Heather Grey XS" produced the same SKU on panty, thong,
 * tank, and crewneck — and the duplicate-SKU precheck blocked all but the
 * first blank from spawning variants.
 *
 * Immutable once written on `rp_products/.../variants/*`. Legacy 6-part SKUs
 * (without {BLANK}) are still parseable for backward compat with any
 * pre-Phase-A0 docs that survived cleanup; `parseSku` returns blankCode=null
 * for those.
 */

export function normalizeSkuSegment(raw: string | null | undefined, maxLen: number): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const cut = s.slice(0, Math.max(1, maxLen));
  return cut || "X";
}

/** Standardized 3-letter garment / ink color codes (extend as catalog grows). */
const STANDARD_COLOR_CODE: Record<string, string> = {
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

/**
 * Map blank / product color name → 3-letter `colorCode` for SKUs.
 */
export function resolveColorCodeForSku(colorName: string | null | undefined): string {
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

export interface BuildDesignCodeParams {
  designFamily?: string | null;
  designSeries?: string | null;
  themeCode?: string | null;
  designType?: string | null;
  designId: string;
}

/**
 * Stable design segment from taxonomy + design fields (hyphen-free, ≤10 chars).
 * Prefers explicit `themeCode` when usable; else `designFamily` + `designSeries`; else `designType`; else `designId`.
 */
export function buildDesignCodeForSku(p: BuildDesignCodeParams): string {
  const tc = normalizeSkuSegment(p.themeCode, 10);
  if (tc.length >= 2) return tc;
  const fam = normalizeSkuSegment(p.designFamily, 8);
  const ser = normalizeSkuSegment(p.designSeries, 6);
  const combined = `${fam}${ser}`.replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (combined.length >= 2) return combined;
  const dt = normalizeSkuSegment(p.designType, 10);
  if (dt.length >= 2) return dt;
  return normalizeSkuSegment(p.designId, 8);
}

export interface BuildSkuParams {
  leagueCode: string;
  teamCode: string;
  designCode: string;
  /**
   * Blank style code segment (e.g. "8394", "TR3008", "HF07"). Required as of
   * Phase A0 (2026-06-01) — disambiguates same-design-across-blanks SKUs that
   * previously collided on the duplicate-SKU precheck. Source: `blank.styleCode`.
   */
  blankCode: string;
  /** Three-letter code from `resolveColorCodeForSku` (or equivalent). */
  colorCode: string;
  size: string;
}

export function buildSku(p: BuildSkuParams): string {
  const league = normalizeSkuSegment(p.leagueCode, 8);
  const team = normalizeSkuSegment(p.teamCode, 6);
  const design = normalizeSkuSegment(p.designCode, 10);
  const blank = normalizeSkuSegment(p.blankCode, 6);
  const color = normalizeSkuSegment(p.colorCode, 3).padEnd(3, "X").slice(0, 3);
  const size = normalizeSkuSegment(p.size, 4);
  return `RP-${league}-${team}-${design}-${blank}-${color}-${size}`;
}

export interface ParsedSku {
  raw: string;
  leagueCode: string;
  teamCode: string;
  designCode: string;
  /** Null for legacy 6-part SKUs written before Phase A0. */
  blankCode: string | null;
  colorCode: string;
  size: string;
}

/**
 * Parse a canonical `RP-…` SKU; returns null if shape is invalid. Accepts
 * both the new 7-part format and the legacy 6-part format (no blank code).
 */
export function parseSku(sku: string): ParsedSku | null {
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
    /** Legacy SKU — pre-Phase-A0. blankCode unknown; downstream callers should
     *  treat null as "ambiguous which blank this is on." */
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

/** Throws if the list contains duplicate SKUs (case-insensitive). */
export function assertDistinctSkuCandidates(skus: string[]): void {
  const seen = new Set<string>();
  for (const raw of skus) {
    const k = String(raw ?? "").trim().toUpperCase();
    if (!k) continue;
    if (seen.has(k)) {
      throw new Error(`Duplicate SKU in batch: ${k}`);
    }
    seen.add(k);
  }
}
