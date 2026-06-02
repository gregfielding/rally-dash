"use strict";

/**
 * Hex → coarse color name. Flux Fill (and Kolors VTO, and probably any future
 * text-conditioned VTON provider) responds better to color names than raw hex.
 * Buckets keyed on dominant HSV region — close enough for the model to paint
 * the right hue, not a precision color match. The hex is still appended after
 * the name for fine-tuning ("orange (#FF6B00)") so the model gets both signals.
 *
 * Extracted from `blankPreviewRender.js` so the Phase B provider files can
 * import it without pulling in the entire 1400-line preview-render module
 * (which would create a circular dependency: blankPreviewRender → providers →
 * blankPreviewRender).
 *
 * Keep the bucket boundaries STABLE. If two consecutive Flux Fill calls
 * disagree on whether a hex is "orange" or "red" because the boundary moved,
 * the prompt color clause flips and the output drifts. Test before touching.
 *
 * @param {unknown} hex  e.g. "#FF6B00"; non-string / non-#-prefixed returns null.
 * @returns {string|null} One of black/white/gray/red/orange/yellow/green/cyan/blue/purple/magenta.
 */
function hexToColorName(hex) {
  if (typeof hex !== "string" || !hex.startsWith("#")) return null;
  const h = hex.replace("#", "").toLowerCase();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max < 32) return "black";
  if (min > 220) return "white";
  if (delta < 25 && max > 100 && max < 200) return "gray";
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 200) return "cyan";
  if (hue < 255) return "blue";
  if (hue < 290) return "purple";
  return "magenta";
}

module.exports = { hexToColorName };
