import type { RPBlankGarmentSizeCode } from "@/lib/types/firestore";

/** Canonical order for UI and stable Shopify option value ordering (phase 1: XS–XL). */
export const GARMENT_SIZE_CODES_ORDER: readonly RPBlankGarmentSizeCode[] = ["XS", "S", "M", "L", "XL"];

const ALLOWED = new Set<string>(GARMENT_SIZE_CODES_ORDER);

/**
 * Normalize client/JSON input to a deduped subset of phase-1 codes, in canonical order.
 * Empty / invalid → null (store omits or clears field).
 */
export function normalizeGarmentSizes(input: unknown): RPBlankGarmentSizeCode[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const picked = new Set<RPBlankGarmentSizeCode>();
  for (const x of input) {
    if (typeof x === "string" && ALLOWED.has(x)) picked.add(x as RPBlankGarmentSizeCode);
  }
  if (picked.size === 0) return null;
  const out: RPBlankGarmentSizeCode[] = [];
  for (const code of GARMENT_SIZE_CODES_ORDER) {
    if (picked.has(code)) out.push(code);
  }
  return out;
}
