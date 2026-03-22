/**
 * Canonical off-black / off-white inks for every Rally print order (sRGB hex + derived CMYK).
 * CMYK is computed from hex (sRGB → CMYK); treat as production reference until press profiles are verified.
 */

import type { DesignColor, RpInkColor } from "@/lib/types/firestore";

export const STANDARD_OFF_BLACK_HEX = "#111111" as const;
export const STANDARD_OFF_WHITE_HEX = "#F5F5F5" as const;

export type CmykValues = { c: number; m: number; y: number; k: number };

/** Normalize to #RRGGBB uppercase for comparison. */
export function normalizePrintHex(hex: string | null | undefined): string {
  const s = String(hex || "")
    .trim()
    .replace(/^#/, "");
  if (s.length === 3) {
    const a = s[0] + s[0];
    const b = s[1] + s[1];
    const c = s[2] + s[2];
    return `${a}${b}${c}`.toUpperCase();
  }
  if (s.length === 6) return s.toUpperCase();
  return s.toUpperCase();
}

export function displayPrintHex(hex: string): string {
  const n = normalizePrintHex(hex);
  if (n.length === 6 && /^[0-9A-F]+$/i.test(n)) return `#${n.toUpperCase()}`;
  return String(hex || "").trim();
}

/**
 * sRGB hex (#RRGGBB) → CMYK (0–100 integers). K-heavy neutrals are expected for Off Black.
 */
export function hexToCmyk(hex: string): CmykValues {
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

export function formatCmyk(cmyk: CmykValues): string {
  return `C${cmyk.c} M${cmyk.m} Y${cmyk.y} K${cmyk.k}`;
}

const OFF_BLACK_NORM = normalizePrintHex(STANDARD_OFF_BLACK_HEX);
const OFF_WHITE_NORM = normalizePrintHex(STANDARD_OFF_WHITE_HEX);

const STANDARD_DESIGN_COLORS: DesignColor[] = [
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

/** Append standard inks if this hex is not already in the list (any role). */
export function mergeStandardDesignInks(colors: DesignColor[]): DesignColor[] {
  const list = colors.map((c) => ({ ...c, hex: displayPrintHex(c.hex) }));
  const seen = new Set(list.map((c) => normalizePrintHex(c.hex)));
  const out = [...list];
  for (const std of STANDARD_DESIGN_COLORS) {
    const key = normalizePrintHex(std.hex);
    if (!seen.has(key)) {
      out.push({ ...std });
      seen.add(key);
    }
  }
  return out;
}

export type ResolvedPrintInk = DesignColor & { cmyk: CmykValues };

/** Ensure every swatch has CMYK (stored or computed). */
export function enrichDesignColorsWithCmyk(colors: DesignColor[]): ResolvedPrintInk[] {
  return colors.map((c) => {
    const cmyk =
      c.cmyk &&
      typeof c.cmyk.c === "number" &&
      typeof c.cmyk.m === "number" &&
      typeof c.cmyk.y === "number" &&
      typeof c.cmyk.k === "number"
        ? { c: c.cmyk.c, m: c.cmyk.m, y: c.cmyk.y, k: c.cmyk.k }
        : hexToCmyk(c.hex);
    return { ...c, cmyk };
  });
}

/**
 * Full palette for UI / printer handoff: team + custom colors, then standard inks if missing, all with CMYK.
 */
export function resolveDesignInkPaletteForDisplay(colors: DesignColor[] | null | undefined): ResolvedPrintInk[] {
  const merged = mergeStandardDesignInks(colors ?? []);
  return enrichDesignColorsWithCmyk(merged);
}

function enrichRpInk(ink: RpInkColor): RpInkColor {
  if (!ink.hex) return { ...ink };
  const cmyk =
    ink.cmyk &&
    typeof ink.cmyk.c === "number" &&
    typeof ink.cmyk.m === "number" &&
    typeof ink.cmyk.y === "number" &&
    typeof ink.cmyk.k === "number"
      ? ink.cmyk
      : hexToCmyk(ink.hex);
  return { ...ink, cmyk };
}

/** Product-design ink rows: same standards + CMYK on every hex. */
export function resolveRpInkColorsWithStandard(inks: RpInkColor[] | null | undefined): RpInkColor[] {
  const base = [...(inks || [])];
  const seen = new Set(base.map((i) => normalizePrintHex(i.hex || "")).filter(Boolean));
  if (!seen.has(OFF_BLACK_NORM)) {
    base.push({
      name: "Off Black",
      hex: STANDARD_OFF_BLACK_HEX,
      cmyk: hexToCmyk(STANDARD_OFF_BLACK_HEX),
      notes: "Canonical off-black for all Rally print orders",
    });
  }
  if (!seen.has(OFF_WHITE_NORM)) {
    base.push({
      name: "Off White",
      hex: STANDARD_OFF_WHITE_HEX,
      cmyk: hexToCmyk(STANDARD_OFF_WHITE_HEX),
      notes: "Canonical off-white for all Rally print orders",
    });
  }
  return base.map(enrichRpInk);
}
