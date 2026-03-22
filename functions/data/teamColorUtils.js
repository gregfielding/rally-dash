/**
 * DesignTeam color helpers: hex normalization, approximate CMYK, teamColors assembly.
 * CMYK is a print-oriented approximation (0–100 integers per channel), not ICC-profile exact.
 */

"use strict";

const HEX_RE = /^#?([0-9A-Fa-f]{6})$/;

/** Representative sRGB anchors for eligibility family matching (not full gamuts). */
const FAMILY_ANCHOR_HEX = {
  black: "#000000",
  white: "#FFFFFF",
  grey: "#808080",
  red: "#CE1224",
  blue: "#0066CC",
  navy: "#00205B",
  green: "#00843D",
  orange: "#FF5722",
  purple: "#4A148C",
  teal: "#007C92",
  pink: "#E91E8C",
  yellow: "#FFD200",
};

function normalizeHex(hex) {
  if (hex == null || typeof hex !== "string") throw new Error("hex must be a string");
  const m = String(hex).trim().match(HEX_RE);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  return `#${m[1].toUpperCase()}`;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * sRGB → CMYK approximation (device-independent rough values for seed data).
 */
function rgbToCmyk(r, g, b) {
  const r0 = r / 255;
  const g0 = g / 255;
  const b0 = b / 255;
  const k = 1 - Math.max(r0, g0, b0);
  if (k >= 0.9999) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }
  const d = 1 - k;
  const c = (1 - r0 - k) / d;
  const m = (1 - g0 - k) / d;
  const y = (1 - b0 - k) / d;
  return {
    c: Math.round(Math.min(100, Math.max(0, c * 100))),
    m: Math.round(Math.min(100, Math.max(0, m * 100))),
    y: Math.round(Math.min(100, Math.max(0, y * 100))),
    k: Math.round(Math.min(100, Math.max(0, k * 100))),
  };
}

function hexToCmyk(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToCmyk(r, g, b);
}

function colorDistanceRgb(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Which normalized color family is closest to this hex (for pairing with colorFamilies list). */
function nearestColorFamily(hex) {
  const rgb = hexToRgb(hex);
  let best = "grey";
  let bestD = Infinity;
  for (const [fam, h] of Object.entries(FAMILY_ANCHOR_HEX)) {
    const anchor = hexToRgb(h);
    const d = colorDistanceRgb(rgb, anchor);
    if (d < bestD) {
      bestD = d;
      best = fam;
    }
  }
  return best;
}

/**
 * Pick a secondary hex from colorFamilies that differs from primary and isn't redundant with primary hex.
 */
function suggestSecondaryHex(primaryHex, colorFamilies) {
  const primaryNorm = normalizeHex(primaryHex);
  const primaryFam = nearestColorFamily(primaryNorm);
  const families = Array.isArray(colorFamilies) ? colorFamilies : [];

  for (const fam of families) {
    if (fam === primaryFam) continue;
    const candidate = FAMILY_ANCHOR_HEX[fam];
    if (!candidate) continue;
    const cn = normalizeHex(candidate);
    if (cn === primaryNorm) continue;
    return cn;
  }
  return null;
}

function colorEntry(role, name, hex) {
  const h = normalizeHex(hex);
  return {
    role: typeof role === "string" && role.trim() ? role.trim() : "primary",
    name: name == null || name === "" ? null : String(name),
    hex: h,
    cmyk: hexToCmyk(h),
  };
}

function validateColorEntry(entry, label) {
  if (!entry || typeof entry !== "object") throw new Error(`${label}: invalid color entry`);
  const role = entry.role;
  if (role == null || String(role).trim() === "") throw new Error(`${label}: missing role`);
  const hex = normalizeHex(entry.hex);
  const cmyk = entry.cmyk;
  if (!cmyk || typeof cmyk !== "object") throw new Error(`${label}: missing cmyk`);
  for (const k of ["c", "m", "y", "k"]) {
    const v = cmyk[k];
    if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 100) {
      throw new Error(`${label}: cmyk.${k} must be number 0–100`);
    }
  }
  const out = {
    role: String(role).trim(),
    name: entry.name == null || entry.name === "" ? null : String(entry.name),
    hex,
    cmyk: {
      c: Math.round(cmyk.c),
      m: Math.round(cmyk.m),
      y: Math.round(cmyk.y),
      k: Math.round(cmyk.k),
    },
  };
  if (Object.prototype.hasOwnProperty.call(entry, "pantone")) {
    const p = entry.pantone;
    out.pantone = p == null || String(p).trim() === "" ? null : String(p).trim();
  }
  return out;
}

/**
 * Build teamColors + convenience hex fields from seed row.
 * If `team.teamColors` is already provided, normalizes hex/CMYK and syncs primary/secondary convenience fields.
 */
function enrichTeamColors(team, label) {
  if (Array.isArray(team.teamColors) && team.teamColors.length > 0) {
    const normalized = team.teamColors.map((c, i) => {
      const filled = { ...c, cmyk: c.cmyk && typeof c.cmyk === "object" ? c.cmyk : hexToCmyk(c.hex) };
      return validateColorEntry(filled, `${label}.teamColors[${i}]`);
    });
    team.teamColors = normalized;
    team.primaryColorHex = normalized[0].hex;
    const sec = normalized.find((c) => c.role === "secondary");
    team.secondaryColorHex = sec ? sec.hex : null;
    return team;
  }

  if (!team.primaryColorHex) throw new Error(`${label}: primaryColorHex or teamColors required`);

  const primary = colorEntry("primary", team.primaryColorName ?? null, team.primaryColorHex);
  const colors = [primary];

  let secondaryHex = team.secondaryColorHex ? normalizeHex(team.secondaryColorHex) : null;
  if (!secondaryHex) {
    secondaryHex = suggestSecondaryHex(primary.hex, team.colorFamilies);
  } else if (secondaryHex === primary.hex) {
    secondaryHex = null;
  }

  if (secondaryHex) {
    colors.push(colorEntry("secondary", team.secondaryColorName ?? null, secondaryHex));
  }

  if (team.tertiaryColorHex) {
    const th = normalizeHex(team.tertiaryColorHex);
    if (th !== primary.hex && th !== secondaryHex) {
      colors.push(colorEntry("tertiary", team.tertiaryColorName ?? null, th));
    }
  }

  team.teamColors = colors;
  team.primaryColorHex = primary.hex;
  team.secondaryColorHex = secondaryHex;
  return team;
}

module.exports = {
  normalizeHex,
  hexToRgb,
  rgbToCmyk,
  hexToCmyk,
  nearestColorFamily,
  suggestSecondaryHex,
  FAMILY_ANCHOR_HEX,
  enrichTeamColors,
  validateColorEntry,
};
