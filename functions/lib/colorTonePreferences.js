"use strict";

/**
 * Global color-name → preferred-design-tone rules. Server mirror of
 * lib/blanks/colorTonePreferences.ts — keep in sync.
 *
 * See the TS file for full rationale. Today: any pink-family color name maps
 * to WHITE so a white-ink design prints crisp on pink fabric.
 */

/**
 * Substring matchers (case-insensitive). The first matching entry wins.
 * @type {Array<{ match: string, preferredTone: "light"|"dark"|"white", reason: string }>}
 */
const COLOR_TONE_PATTERNS = [
  { match: "pink", preferredTone: "white", reason: "pink fabric → white ink reads crisp" },
];

/** Look up the system-wide preferred tone for a color name. Returns null when no rule matches. */
function colorNameToPreferredTone(colorName) {
  if (!colorName || typeof colorName !== "string") return null;
  const haystack = colorName.toLowerCase();
  for (const p of COLOR_TONE_PATTERNS) {
    if (haystack.includes(p.match)) return p.preferredTone;
  }
  return null;
}

/**
 * Per-variant explicit override wins, then the color-name map, then null.
 * @param {string|null|undefined} colorName
 * @param {string|null|undefined} explicit
 * @returns {"light"|"dark"|"white"|null}
 */
function resolveEffectivePreferredTone(colorName, explicit) {
  if (explicit === "light" || explicit === "dark" || explicit === "white") {
    return explicit;
  }
  return colorNameToPreferredTone(colorName);
}

module.exports = {
  colorNameToPreferredTone,
  resolveEffectivePreferredTone,
};
