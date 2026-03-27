/**
 * Color family derivation for Blank.
 * Drives default garment artwork mapping (light vs dark vs white); blank variant `preferredArtworkTone` can override.
 * All new/edited blanks should explicitly store colorFamily; this is fallback for backward compatibility.
 */

import type { RPBlankColorFamily } from "@/lib/types/firestore";
import type { RPBlankColorName } from "@/lib/types/firestore";

/**
 * Garment colors treated as **dark** for artwork tone resolution (try light → white → dark PNG first).
 * Includes deep blues so light-colored ink reads crisp (not muddy dark-on-blue). Case-insensitive.
 */
const DARK_COLOR_NAMES_LOWER: Set<string> = new Set([
  "black",
  "midnight navy",
  "navy",
  "indigo",
  "blue",
  "royal blue",
  "cobalt",
  "heather blue",
  "dark blue",
]);

/**
 * Derive color family from color name when Blank has no explicit colorFamily.
 * Used for backward compatibility only; new blanks should set colorFamily explicitly.
 */
export function deriveColorFamily(colorName: RPBlankColorName | string | null | undefined): RPBlankColorFamily {
  if (!colorName || typeof colorName !== "string") return "light";
  const normalized = colorName.trim().toLowerCase();
  if (DARK_COLOR_NAMES_LOWER.has(normalized)) return "dark";
  return "light";
}

/**
 * Effective color family for a blank: explicit colorFamily or derived from colorName.
 */
export function getEffectiveColorFamily(
  colorFamily: RPBlankColorFamily | null | undefined,
  colorName: RPBlankColorName | string | null | undefined
): RPBlankColorFamily {
  if (colorFamily === "light" || colorFamily === "dark") return colorFamily;
  return deriveColorFamily(colorName);
}
