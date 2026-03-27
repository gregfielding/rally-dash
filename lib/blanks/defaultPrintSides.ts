import { getDefaultPrintSidesForStyleCode } from "@/lib/rp/blanks/styleRegistry";
import type { RPBlank, RPBlankDefaultPrintSides, RPBlankGarmentCategory } from "@/lib/types/firestore";

/** Category-based defaults when `blank.defaultPrintSides` is unset (fallback only; prefer style registry). */
export function garmentCategoryDefaultPrintSides(
  garmentCategory: RPBlankGarmentCategory | string | null | undefined
): RPBlankDefaultPrintSides {
  const c = String(garmentCategory || "").toLowerCase();
  if (c === "panty" || c === "thong") return "back_only";
  if (c === "tank" || c === "crewneck") return "front_only";
  return "both";
}

/**
 * Effective garment default for print placement:
 * 1. `blank.defaultPrintSides` when set on the document
 * 2. Else `STYLE_REGISTRY[styleCode].defaultPrintSides` for known LAA styles
 * 3. Else category-based inference (legacy / unknown styles)
 */
export function inferDefaultPrintSides(blank: RPBlank | null | undefined): RPBlankDefaultPrintSides {
  if (!blank) return "both";
  const d = blank.defaultPrintSides;
  if (d === "front_only" || d === "back_only" || d === "both") return d;
  const fromStyle = getDefaultPrintSidesForStyleCode(blank.styleCode);
  if (fromStyle) return fromStyle;
  return garmentCategoryDefaultPrintSides(blank.garmentCategory);
}
