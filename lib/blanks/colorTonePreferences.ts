/**
 * Global color-name → preferred-design-tone rules.
 *
 * Sits between the per-variant explicit `preferredArtworkTone` override and the
 * coarse light/dark color-family fallback in the artwork-tone resolver.
 *
 * Today: any pink-family color name maps to WHITE — a white-ink design prints
 * crisp and high-contrast on pink fabric, where the LIGHT-toned design (default
 * for light-family garments) would read as a wash.
 *
 * Extend this list as new "always X" rules emerge (e.g. heather greys, certain
 * pastels). Keep matches case-insensitive substring so future SKU names like
 * "Heather Pink" or "Vintage Pink" inherit the rule without a code change.
 *
 * Mirror: functions/lib/colorTonePreferences.js — keep in sync.
 */

import type { RPBlankArtworkTone } from "@/lib/types/firestore";

/**
 * Substring matchers (case-insensitive). The first matching entry wins.
 * Ordering matters: most-specific patterns first if you ever add a pair that
 * could both match.
 */
interface ColorTonePattern {
  /** Lowercased substring that must appear in `colorName.toLowerCase()`. */
  match: string;
  preferredTone: RPBlankArtworkTone;
  /** Human-readable note for logs / debug. */
  reason: string;
}

const COLOR_TONE_PATTERNS: ColorTonePattern[] = [
  { match: "pink", preferredTone: "white", reason: "pink fabric → white ink reads crisp" },
];

/**
 * Look up the system-wide preferred tone for a color name. Returns `null` when
 * no rule matches — the caller should fall back to per-variant override or the
 * light/dark family default.
 */
export function colorNameToPreferredTone(
  colorName: string | null | undefined
): RPBlankArtworkTone | null {
  if (!colorName || typeof colorName !== "string") return null;
  const haystack = colorName.toLowerCase();
  for (const p of COLOR_TONE_PATTERNS) {
    if (haystack.includes(p.match)) return p.preferredTone;
  }
  return null;
}

/**
 * Effective preferred tone: per-variant explicit override wins, then the
 * color-name map, then null (caller falls back to family default).
 *
 * Use this anywhere you'd previously have passed `variant.preferredArtworkTone`
 * directly to the resolver — it adds the global rule without changing the
 * downstream fallback chain.
 */
export function resolveEffectivePreferredTone(
  colorName: string | null | undefined,
  explicit: RPBlankArtworkTone | null | undefined
): RPBlankArtworkTone | null {
  if (explicit === "light" || explicit === "dark" || explicit === "white") {
    return explicit;
  }
  return colorNameToPreferredTone(colorName);
}
