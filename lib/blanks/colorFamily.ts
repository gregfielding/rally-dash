/**
 * Color family derivation for Blank.
 * Drives which Design asset the renderer uses: lightPng vs darkPng.
 * All new/edited blanks should explicitly store colorFamily; this is fallback for backward compatibility.
 */

import type { RPBlankColorFamily } from "@/lib/types/firestore";
import type { RPBlankColorName } from "@/lib/types/firestore";

/** Colors that use the dark design asset (design.assets.darkPng). */
const DARK_COLOR_NAMES: Set<string> = new Set([
  "Black",
  "Midnight Navy",
  "Navy",
  "Indigo",
]);

/**
 * Derive color family from color name when Blank has no explicit colorFamily.
 * Used for backward compatibility only; new blanks should set colorFamily explicitly.
 */
export function deriveColorFamily(colorName: RPBlankColorName | string | null | undefined): RPBlankColorFamily {
  if (!colorName || typeof colorName !== "string") return "light";
  const normalized = colorName.trim();
  if (DARK_COLOR_NAMES.has(normalized)) return "dark";
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
