/**
 * Infer league, team slug, theme, and display strings from a design identity key (no tone suffix).
 * Example: mlb_san_francisco_giants_city_69 → city_69 theme, team san_francisco_giants, series 69
 */

import type { DesignDesignType } from "@/lib/types/firestore";

export interface InferredIdentity {
  leagueToken: string;
  leagueCode: string;
  /** Underscore-separated team slug for matching design_teams.id */
  teamSlugCandidate: string;
  /** e.g. city_69, will_drop_for */
  themeSlugCandidate: string | null;
  /** Numeric or campaign series when applicable */
  designSeriesCandidate: string | null;
  designType: DesignDesignType;
  /** Human-readable theme fragment for design title */
  themeDisplayName: string;
}

function humanizeWords(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parse identity from designKey (same as parseDesignFilename `designKey`).
 */
export function inferIdentityFromDesignKey(designKey: string): InferredIdentity {
  const tokens = designKey.split("_").filter(Boolean);
  if (tokens.length < 2) {
    return {
      leagueToken: tokens[0] || "unknown",
      leagueCode: (tokens[0] || "UNK").toUpperCase(),
      teamSlugCandidate: "",
      themeSlugCandidate: null,
      designSeriesCandidate: null,
      designType: "custom_one_off",
      themeDisplayName: "",
    };
  }

  const leagueToken = tokens[0]!;
  const leagueCode = leagueToken.toUpperCase();
  const n = tokens.length;

  // ..._city_<digits>  (City 69 style, explicit)
  if (n >= 4 && tokens[n - 2]!.toLowerCase() === "city" && /^\d+$/.test(tokens[n - 1]!)) {
    const series = tokens[n - 1]!;
    const teamSlugCandidate = tokens.slice(1, n - 2).join("_");
    const themeSlugCandidate = `city_${series}`;
    return {
      leagueToken,
      leagueCode,
      teamSlugCandidate,
      themeSlugCandidate,
      designSeriesCandidate: series,
      designType: "city_69",
      themeDisplayName: `City ${series}`,
    };
  }

  // ..._69 shorthand (e.g. mlb_baltimore_orioles_69) — City 69 theme; other numeric tails stay generic
  if (n >= 3 && tokens[n - 1] === "69") {
    const series = "69";
    const teamSlugCandidate = tokens.slice(1, n - 1).join("_");
    if (teamSlugCandidate) {
      return {
        leagueToken,
        leagueCode,
        teamSlugCandidate,
        themeSlugCandidate: "city_69",
        designSeriesCandidate: series,
        designType: "city_69",
        themeDisplayName: "City 69",
      };
    }
  }

  // Generic: last token = loose "team nickname" in old parser; treat tail as theme slug
  const teamSlugCandidate = tokens.slice(1, -1).join("_");
  const themeToken = tokens[n - 1]!;
  const themeSlugCandidate = tokens.length > 2 ? themeToken : null;

  return {
    leagueToken,
    leagueCode,
    teamSlugCandidate: teamSlugCandidate || themeToken,
    themeSlugCandidate,
    designSeriesCandidate: /^\d+$/.test(themeToken) ? themeToken : null,
    designType: "custom_one_off",
    themeDisplayName: humanizeWords(themeSlugCandidate || themeToken),
  };
}

export function identityKeyToSlug(identityKey: string): string {
  return identityKey
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_/g, "-");
}
