/**
 * Parse design filenames per RALLY_BATCH_DESIGN_IMPORT_AND_NAMING_SPEC.
 * Format: LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT.ext
 * Example: MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png
 */

const SUPPORTED_EXT = new Set(["png", "svg", "pdf"]);
const KNOWN_SIDES = new Set(["FRONT", "BACK"]);
const MIN_TOKENS = 5; // LEAGUE + at least one designFamily token + TEAM + SIDE + VARIANT

export interface ParsedDesignFilename {
  league: string;
  designFamily: string;
  team: string;
  side: string;
  variant: string;
  extension: string;
  /** Base key for grouping: LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT (no extension) */
  baseKey: string;
  /** Original filename (no path) */
  filename: string;
}

export type ParseStatus =
  | "valid"
  | "invalid_format"
  | "missing_token"
  | "unsupported_extension"
  | "unknown_side";

export interface ParseResult {
  parsed: ParsedDesignFilename | null;
  status: ParseStatus;
  message?: string;
}

/**
 * Get extension from filename (lowercase, no dot).
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Get base name without extension.
 */
function baseNameWithoutExt(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return filename;
  return filename.slice(0, lastDot);
}

/**
 * Parse a design filename into structured fields.
 * DESIGNNAME can contain underscores (e.g. WILL_DROP_FOR), so we take:
 * - league = first token
 * - team, side, variant = last three tokens
 * - designFamily = everything between league and those three, joined by _
 */
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
    return { parsed: null, status: "missing_token", message: `Need at least ${MIN_TOKENS} underscore-separated parts` };
  }

  const league = tokens[0];
  const team = tokens[tokens.length - 3];
  const side = tokens[tokens.length - 2];
  const variant = tokens[tokens.length - 1];
  const designFamily = tokens.slice(1, -3).join("_");

  if (!KNOWN_SIDES.has(side.toUpperCase())) {
    return {
      parsed: null,
      status: "unknown_side",
      message: `Side must be FRONT or BACK, got ${side}`,
    };
  }

  const baseKey = `${league}_${designFamily}_${team}_${side}_${variant}`;
  const parsed: ParsedDesignFilename = {
    league,
    designFamily,
    team,
    side,
    variant,
    extension: ext,
    baseKey,
    filename,
  };
  return { parsed, status: "valid" };
}

/**
 * Human-friendly suggested design name from parsed data.
 * Example: WILL_DROP_FOR, GIANTS, BACK, LIGHT → "Will Drop For Giants Back Light"
 */
export function suggestedDesignName(parsed: ParsedDesignFilename): string {
  const toTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const family = parsed.designFamily.split("_").map(toTitle).join(" ");
  const team = toTitle(parsed.team);
  const side = toTitle(parsed.side);
  const variant = toTitle(parsed.variant);
  return `${family} ${team} ${side} ${variant}`;
}

/**
 * Group files by base key (same design, different formats).
 */
export function groupParsedFiles(
  results: Array<{ file: File; result: ParseResult }>
): Map<
  string,
  {
    baseKey: string;
    parsed: ParsedDesignFilename;
    files: { file: File; ext: string }[];
  }
> {
  const map = new Map<
    string,
    {
      baseKey: string;
      parsed: ParsedDesignFilename;
      files: { file: File; ext: string }[];
    }
  >();
  for (const { file, result } of results) {
    if (result.status !== "valid" || !result.parsed) continue;
    const key = result.parsed.baseKey;
    const existing = map.get(key);
    if (existing) {
      existing.files.push({ file, ext: result.parsed.extension });
    } else {
      map.set(key, {
        baseKey: key,
        parsed: result.parsed,
        files: [{ file, ext: result.parsed.extension }],
      });
    }
  }
  return map;
}
