/**
 * Parse batch design filenames.
 *
 * **Canonical (preferred):** `{league}_{…identity…}_{tone}.ext`
 * - Final token before the extension: **LIGHT | DARK | WHITE** (artwork tone)
 * - **designKey** = all tokens except the last (tone); encodes design identity only
 * - Print placement is **not** in the filename — use blank `defaultPrintSides` + product build
 *
 * **Legacy (still accepted):** `{league}_{…}_front|back_{tone}.ext`
 * - `_front_` / `_back_` are **legacy metadata only**; they do not override blank placement rules
 *
 * Examples:
 * - mlb_sf_giants_city_69_light.png  → canonical (city_69 theme; team slug from tokens before `city`)
 * - mlb_sf_giants_city_69_back_dark.png → legacy (filenameLegacySide = back)
 *
 * **Shorthand:** `mlb_baltimore_orioles_69_light` (digits only after team) is treated like City 69: `designFamily`
 * becomes `city_69` and the team slug is `baltimore_orioles` (full identity). Prefer explicit
 * `…_city_69_light` when ambiguous.
 */

import { designFileKindFromSideToneExt, designFileKindFromToneExt } from "@/lib/designs/designAssetKinds";
import type { DesignFileKind } from "@/lib/designs/designAssetKinds";

const SUPPORTED_EXT = new Set(["png", "svg", "pdf"]);
const KNOWN_SIDES = new Set(["FRONT", "BACK"]);
const KNOWN_TONES = new Set(["LIGHT", "DARK", "WHITE"]);
/** Canonical: league + ≥1 identity segment + tone */
const MIN_TOKENS_CANONICAL = 3;
/** Legacy: league + … + side + tone */
const MIN_TOKENS_LEGACY = 5;

export interface ParsedDesignFilename {
  league: string;
  /** Same design across files; stored as `importKey` (excludes tone; legacy also excludes side). */
  designKey: string;
  /** @deprecated Alias for `designKey` */
  baseKey: string;
  /** Taxonomy / product key segment (classic: WILL_DROP_FOR; rich theme: city_69) */
  designFamily: string;
  /** Entity token for taxonomy (e.g. GIANTS, DODGERS) */
  team: string;
  /**
   * Legacy filenames only: `front` | `back` from `_front_` / `_back_` tokens.
   * `null` for side-agnostic canonical names — **not** a placement hint.
   * @deprecated Prefer `filenameLegacySide`
   */
  side: string | null;
  /**
   * Set only when a legacy `_front_` / `_back_` segment is present in the filename.
   * Null for canonical files. Not used as the source of truth for garment placement.
   */
  filenameLegacySide: "front" | "back" | null;
  /** Garment artwork tone from filename: LIGHT | DARK | WHITE */
  garmentTone: string;
  /** @deprecated Same as garmentTone (legacy name) */
  variant: string;
  extension: string;
  filename: string;
}

export type ParseStatus =
  | "valid"
  | "invalid_format"
  | "missing_token"
  | "unsupported_extension"
  | "unknown_garment_tone";

export interface ParseResult {
  parsed: ParsedDesignFilename | null;
  status: ParseStatus;
  message?: string;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

function baseNameWithoutExt(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return filename;
  return filename.slice(0, lastDot);
}

/**
 * Normalize a slug token for comparison: lowercase, hyphens → underscores.
 * Both `sf-giants` (Firestore convention) and `sf_giants` (filename token)
 * should compare equal so operators don't have to remember which separator
 * goes where.
 */
function normalizeSlugForCompare(s: string): string {
  return s.toLowerCase().replace(/-/g, "_");
}

function splitMiddleForTeamAndFamily(
  middle: string[],
  options?: { knownTeamSlugs?: Set<string> }
): { designFamily: string; team: string } {
  if (middle.length === 0) {
    return { designFamily: "", team: "" };
  }

  const isCity69 =
    middle.length >= 2 &&
    middle[middle.length - 2]!.toLowerCase() === "city" &&
    /^\d+$/.test(middle[middle.length - 1]!);

  if (isCity69) {
    const identity = middle.slice(0, -2);
    const theme = middle.slice(-2).join("_");
    return {
      designFamily: theme,
      team: identity.length ? identity[identity.length - 1]! : "",
    };
  }

  /** `…_baltimore_orioles_69` — trailing `69` without `city` (City 69 theme). Other trailing digits stay generic. */
  const isTrailing69Series = middle.length >= 2 && middle[middle.length - 1] === "69";
  if (isTrailing69Series) {
    const identity = middle.slice(0, -1);
    return {
      designFamily: "city_69",
      team: identity.join("_"),
    };
  }

  /**
   * v2 (2026-05-25): registry-aware multi-token team matching.
   *
   * Previous behavior: team = last middle token, designFamily = everything
   * before. Brittle — `mlb_sf_giants_pillows_dark` parsed team="pillows"
   * (wrong) because the team slug "sf_giants" spans two tokens.
   *
   * New behavior when `knownTeamSlugs` is passed: try multi-token windows
   * against the registry (normalized: lowercase, hyphens treated as
   * underscores). Pick the FIRST match found in this priority order:
   *   1. Tail-first (current convention): try middle.slice(-n).join("_")
   *      for n from len down to 2. Matches `mlb_pillows_sf_giants_dark`
   *      where team=sf_giants is trailing.
   *   2. Head-first (natural English order): try middle.slice(0, n).join("_")
   *      for n from len down to 2. Matches `mlb_sf_giants_pillows_dark`
   *      where team=sf_giants is leading.
   *   3. Single-token tail fallback (legacy behavior): team = last token,
   *      designFamily = everything before.
   *
   * Falls back to legacy single-token behavior when `knownTeamSlugs` is
   * undefined OR no multi-token window matches a registered team.
   */
  if (options?.knownTeamSlugs && options.knownTeamSlugs.size > 0) {
    const normalizedRegistry = new Set<string>();
    for (const slug of options.knownTeamSlugs) {
      normalizedRegistry.add(normalizeSlugForCompare(slug));
    }

    /** Tail-first: try the longest trailing window first. */
    for (let n = middle.length; n >= 2; n--) {
      const candidate = middle.slice(-n).join("_").toLowerCase();
      if (normalizedRegistry.has(candidate)) {
        return {
          designFamily: middle.slice(0, -n).join("_"),
          team: candidate,
        };
      }
    }

    /** Head-first: try the longest leading window. */
    for (let n = middle.length; n >= 2; n--) {
      const candidate = middle.slice(0, n).join("_").toLowerCase();
      if (normalizedRegistry.has(candidate)) {
        return {
          designFamily: middle.slice(n).join("_"),
          team: candidate,
        };
      }
    }

    /** Single-token head match (e.g., `mlb_dodgers_pillows_dark`). */
    const headSingle = middle[0]!.toLowerCase();
    if (normalizedRegistry.has(headSingle)) {
      return {
        designFamily: middle.slice(1).join("_"),
        team: headSingle,
      };
    }
  }

  /** Legacy single-token tail fallback. */
  const team = middle[middle.length - 1]!;
  const designFamily = middle.slice(0, -1).join("_");
  return { designFamily, team };
}

/**
 * Parse options.
 *
 * `knownTeamSlugs` — optional registry of team slugs from `design_teams`
 * collection (or wherever teams are stored). When provided, the parser
 * attempts multi-token team matches before falling back to the legacy
 * "team = last middle token" rule. Hyphens and underscores in slugs are
 * compared as equal so `sf-giants` (Firestore) matches `sf_giants` (filename).
 */
export interface ParseDesignFilenameOptions {
  knownTeamSlugs?: Set<string>;
}

export function parseDesignFilename(
  filePathOrName: string,
  options?: ParseDesignFilenameOptions
): ParseResult {
  const filename = filePathOrName.split(/[/\\]/).pop() ?? filePathOrName;
  const ext = getExtension(filename);
  if (!ext) {
    return { parsed: null, status: "invalid_format", message: "No extension" };
  }
  if (!SUPPORTED_EXT.has(ext)) {
    return { parsed: null, status: "unsupported_extension", message: `Extension .${ext} not supported` };
  }

  const base = baseNameWithoutExt(filename);
  const tokens = base.split("_").filter(Boolean);
  if (tokens.length < MIN_TOKENS_CANONICAL) {
    return {
      parsed: null,
      status: "missing_token",
      message: `Need at least ${MIN_TOKENS_CANONICAL} underscore-separated parts (e.g. league_team_light)`,
    };
  }

  const garmentToneRaw = tokens[tokens.length - 1]!;
  if (!KNOWN_TONES.has(garmentToneRaw.toUpperCase())) {
    return {
      parsed: null,
      status: "unknown_garment_tone",
      message: `Last segment must be artwork tone LIGHT, DARK, or WHITE (got "${garmentToneRaw}")`,
    };
  }

  const secondLast = tokens.length >= 2 ? tokens[tokens.length - 2]! : "";
  const looksLegacySide = KNOWN_SIDES.has(secondLast.toUpperCase());

  let filenameLegacySide: "front" | "back" | null = null;
  let league: string;
  let middle: string[];
  let designKey: string;

  if (looksLegacySide) {
    if (tokens.length < MIN_TOKENS_LEGACY) {
      return {
        parsed: null,
        status: "missing_token",
        message: `Legacy filenames with _front_/_back_ need at least ${MIN_TOKENS_LEGACY} parts (e.g. league_…_back_light)`,
      };
    }
    filenameLegacySide = secondLast.toLowerCase() === "front" ? "front" : "back";
    league = tokens[0]!;
    middle = tokens.slice(1, -2);
    if (middle.length < 1) {
      return { parsed: null, status: "missing_token", message: "Missing identity segment between league and side" };
    }
    designKey = [league, ...middle].join("_");
  } else {
    league = tokens[0]!;
    middle = tokens.slice(1, -1);
    if (middle.length < 1) {
      return {
        parsed: null,
        status: "missing_token",
        message: "Missing identity segment between league and artwork tone",
      };
    }
    designKey = [league, ...middle].join("_");
  }

  const { designFamily, team } = splitMiddleForTeamAndFamily(middle, options);
  const garmentTone = garmentToneRaw;

  const parsed: ParsedDesignFilename = {
    league,
    designKey,
    baseKey: designKey,
    designFamily,
    team,
    side: filenameLegacySide,
    filenameLegacySide,
    garmentTone,
    variant: garmentTone,
    extension: ext,
    filename,
  };
  return { parsed, status: "valid" };
}

/** Callable / storage kind for this file (side-agnostic → legacy flat tone slots; legacy side → nested side). */
export function importKindForParsedFile(parsed: ParsedDesignFilename): DesignFileKind {
  if (parsed.filenameLegacySide) {
    return designFileKindFromSideToneExt(parsed.filenameLegacySide, parsed.garmentTone, parsed.extension);
  }
  return designFileKindFromToneExt(parsed.garmentTone, parsed.extension);
}

export function suggestedDesignName(parsed: ParsedDesignFilename): string {
  const toTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const id = parsed.designKey.split("_").slice(1).map(toTitle).join(" ");
  const tone = toTitle(parsed.garmentTone);
  if (parsed.filenameLegacySide) {
    return `${id} (${toTitle(parsed.filenameLegacySide)} ${tone})`.trim();
  }
  return `${id} (${tone})`.trim();
}

export type GroupedDesignRow = {
  designKey: string;
  /** @deprecated Same as designKey */
  baseKey: string;
  parsed: ParsedDesignFilename;
  files: {
    file: File;
    ext: string;
    kind: DesignFileKind;
    /** Legacy-only; null when file used canonical side-agnostic naming */
    filenameLegacySide: "front" | "back" | null;
  }[];
  /** Distinct legacy filename sides in this group (empty if all files are canonical) */
  legacyFilenameSides: string[];
};

/**
 * Group files by designKey (identity only; excludes tone and legacy side segment).
 */
export function groupParsedFiles(
  results: Array<{ file: File; result: ParseResult }>
): Map<string, GroupedDesignRow> {
  const map = new Map<string, GroupedDesignRow>();
  for (const { file, result } of results) {
    if (result.status !== "valid" || !result.parsed) continue;
    const key = result.parsed.designKey;
    const kind = importKindForParsedFile(result.parsed);
    const filenameLegacySide = result.parsed.filenameLegacySide;
    const existing = map.get(key);
    const entry = { file, ext: result.parsed.extension, kind, filenameLegacySide };
    if (existing) {
      existing.files.push(entry);
      if (filenameLegacySide && !existing.legacyFilenameSides.includes(filenameLegacySide)) {
        existing.legacyFilenameSides.push(filenameLegacySide);
      }
    } else {
      map.set(key, {
        designKey: key,
        baseKey: key,
        parsed: result.parsed,
        files: [entry],
        legacyFilenameSides: filenameLegacySide ? [filenameLegacySide] : [],
      });
    }
  }
  return map;
}
