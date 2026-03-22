"use strict";

/**
 * Keep in sync with lib/print/standardPrintInks.ts (hex + CMYK logic).
 * Merged into every design on create/update for printer orders.
 */

const STANDARD_OFF_BLACK_HEX = "#111111";
const STANDARD_OFF_WHITE_HEX = "#F5F5F5";

function normalizePrintHex(hex) {
  const s = String(hex || "")
    .trim()
    .replace(/^#/, "");
  if (s.length === 3) {
    return (s[0] + s[0] + s[1] + s[1] + s[2] + s[2]).toUpperCase();
  }
  return s.length === 6 ? s.toUpperCase() : s.toUpperCase();
}

function displayPrintHex(hex) {
  const n = normalizePrintHex(hex);
  if (n.length === 6 && /^[0-9A-F]+$/i.test(n)) return `#${n.toUpperCase()}`;
  return String(hex || "").trim();
}

function hexToCmyk(hex) {
  const n = normalizePrintHex(hex);
  if (n.length !== 6) return { c: 0, m: 0, y: 0, k: 100 };
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }
  const c = Math.round(((1 - r - k) / (1 - k)) * 100);
  const m = Math.round(((1 - g - k) / (1 - k)) * 100);
  const y = Math.round(((1 - b - k) / (1 - k)) * 100);
  const kk = Math.round(k * 100);
  return { c, m, y, k: kk };
}

const STANDARD_INKS = [
  {
    hex: STANDARD_OFF_BLACK_HEX,
    name: "Off Black",
    role: "standard_off_black",
    notes: "Canonical off-black for all Rally print orders",
  },
  {
    hex: STANDARD_OFF_WHITE_HEX,
    name: "Off White",
    role: "standard_off_white",
    notes: "Canonical off-white for all Rally print orders",
  },
];

function mergeStandardDesignInks(colors) {
  const list = (Array.isArray(colors) ? colors : []).map((c) => ({
    ...c,
    hex: displayPrintHex(c.hex).toUpperCase(),
  }));
  const seen = new Set(list.map((c) => normalizePrintHex(c.hex)));
  const out = [...list];
  for (const std of STANDARD_INKS) {
    const key = normalizePrintHex(std.hex);
    if (!seen.has(key)) {
      out.push({ ...std });
      seen.add(key);
    }
  }
  return out;
}

function enrichDesignColorsWithCmyk(colors) {
  return colors.map((c) => {
    const has =
      c.cmyk &&
      typeof c.cmyk.c === "number" &&
      typeof c.cmyk.m === "number" &&
      typeof c.cmyk.y === "number" &&
      typeof c.cmyk.k === "number";
    const cmyk = has ? { c: c.cmyk.c, m: c.cmyk.m, y: c.cmyk.y, k: c.cmyk.k } : hexToCmyk(c.hex);
    return { ...c, cmyk };
  });
}

function normalizeColorsForFirestore(colors) {
  const merged = mergeStandardDesignInks(colors);
  return enrichDesignColorsWithCmyk(merged).map((c) => ({
    hex: String(c.hex).toUpperCase(),
    name: c.name || null,
    role: c.role || "team_primary",
    notes: c.notes || null,
    cmyk: c.cmyk,
  }));
}

module.exports = {
  STANDARD_OFF_BLACK_HEX,
  STANDARD_OFF_WHITE_HEX,
  hexToCmyk,
  mergeStandardDesignInks,
  enrichDesignColorsWithCmyk,
  normalizeColorsForFirestore,
  normalizePrintHex,
};
