/**
 * Parse batch design filenames.
 *
 * Convention: `{league}_{...identity + theme...}_{side}_{garmentTone}.ext`
 * - `side` = second-to-last token: FRONT | BACK
 * - `garmentTone` = last token: LIGHT | DARK
 * - **designKey** (import grouping) = all tokens except the last two (same design, multiple sides/tones/formats)
 *
 * Examples:
 * - mlb_los_angeles_dodgers_city_69_back_light.png
 * - MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png (classic)
 */

import { designFileKindFromSideToneExt } from "@/lib/designs/designAssetKinds";
import type { DesignFileKind } from "@/lib/designs/designAssetKinds";

const SUPPORTED_EXT = new Set(["png", "svg", "pdf"]);
const KNOWN_SIDES = new Set(["FRONT", "BACK"]);
const KNOWN_TONES = new Set(["LIGHT", "DARK"]);
/** league + at least one middle segment + side + tone */
const MIN_TOKENS = 5;

export interface ParsedDesignFilename {
  league: string;
  /** Same design across files; stored as `importKey` (excludes side + garmentTone). */
  designKey: string;
  /** @deprecated Alias for `designKey` */
  baseKey: string;
  /** Taxonomy / product key segment (classic: WILL_DROP_FOR; rich theme: city_69) */
  designFamily: string;
  /** Entity token for taxonomy (e.g. GIANTS, DODGERS) */
  team: string;
  side: string;
  /** Garment tone: light | dark (screen / ink on light vs dark garment) */
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
  | "unknown_side"
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

function splitMiddleForTeamAndFamily(middle: string[]): { designFamily: string; team: string } {
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

  const team = middle[middle.length - 1]!;
  const designFamily = middle.slice(0, -1).join("_");
  return { designFamily, team };
}

export function parseDesignFilename(filePathOrName: string): ParseResult {
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
  if (tokens.length < MIN_TOKENS) {
    return {
      parsed: null,
      status: "missing_token",
      message: `Need at least ${MIN_TOKENS} underscore-separated parts (league … side garmentTone)`,
    };
  }

  const garmentToneRaw = tokens[tokens.length - 1]!;
  const sideRaw = tokens[tokens.length - 2]!;

  if (!KNOWN_SIDES.has(sideRaw.toUpperCase())) {
    return {
      parsed: null,
      status: "unknown_side",
      message: `Side must be FRONT or BACK, got ${sideRaw}`,
    };
  }
  if (!KNOWN_TONES.has(garmentToneRaw.toUpperCase())) {
    return {
      parsed: null,
      status: "unknown_garment_tone",
      message: `Garment tone must be LIGHT or DARK, got ${garmentToneRaw}`,
    };
  }

  const league = tokens[0]!;
  const middle = tokens.slice(1, -2);
  if (middle.length < 1) {
    return { parsed: null, status: "missing_token", message: "Missing identity segment between league and side" };
  }

  const designKey = [league, ...middle].join("_");
  const { designFamily, team } = splitMiddleForTeamAndFamily(middle);

  const side = sideRaw;
  const garmentTone = garmentToneRaw;

  const parsed: ParsedDesignFilename = {
    league,
    designKey,
    baseKey: designKey,
    designFamily,
    team,
    side,
    garmentTone,
    variant: garmentTone,
    extension: ext,
    filename,
  };
  return { parsed, status: "valid" };
}

/** Callable / storage kind for this file (side-aware). */
export function importKindForParsedFile(parsed: ParsedDesignFilename): DesignFileKind {
  return designFileKindFromSideToneExt(parsed.side, parsed.garmentTone, parsed.extension);
}

export function suggestedDesignName(parsed: ParsedDesignFilename): string {
  const toTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const id = parsed.designKey.split("_").slice(1).map(toTitle).join(" ");
  return `${id} (${toTitle(parsed.side)} ${toTitle(parsed.garmentTone)})`.trim();
}

export type GroupedDesignRow = {
  designKey: string;
  /** @deprecated Same as designKey */
  baseKey: string;
  parsed: ParsedDesignFilename;
  files: { file: File; ext: string; kind: DesignFileKind; side: string }[];
  /** Distinct print sides present in this group (e.g. front + back) */
  sides: string[];
};

/**
 * Group files by designKey (excludes side + garmentTone).
 */
export function groupParsedFiles(
  results: Array<{ file: File; result: ParseResult }>
): Map<string, GroupedDesignRow> {
  const map = new Map<string, GroupedDesignRow>();
  for (const { file, result } of results) {
    if (result.status !== "valid" || !result.parsed) continue;
    const key = result.parsed.designKey;
    const kind = importKindForParsedFile(result.parsed);
    const side = result.parsed.side.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.files.push({ file, ext: result.parsed.extension, kind, side });
      if (!existing.sides.includes(side)) existing.sides.push(side);
    } else {
      map.set(key, {
        designKey: key,
        baseKey: key,
        parsed: result.parsed,
        files: [{ file, ext: result.parsed.extension, kind, side }],
        sides: [side],
      });
    }
  }
  return map;
}
