import type { RpProduct } from "@/lib/types/firestore";

/** Trimmed URL or empty string. */
export function trimMediaUrl(u: unknown): string {
  return typeof u === "string" ? u.trim() : "";
}

type VariantMediaShape = {
  media?: { heroFront?: string | null; heroBack?: string | null } | null;
  mockupUrl?: string | null;
  flatRenders?: RpProduct["flatRenders"] | null;
};

/**
 * Primary image URL for this sellable variant’s Shopify featured media.
 * 8394 (back-print): prefers back hero / mockup, then front; other styles prefer front.
 * Falls back to deterministic flat renders when heroes are absent.
 */
export function primaryVariantImageUrlForShopify(
  variant: VariantMediaShape | null | undefined,
  blankStyleCode: string | null | undefined
): string {
  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    return (
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(variant?.mockupUrl) ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr?.flat_blended?.back?.url) ||
      trimMediaUrl(fr?.flat_clean?.front?.url) ||
      ""
    );
  }
  return (
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(variant?.mockupUrl) ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr?.flat_clean?.front?.url) ||
    trimMediaUrl(fr?.flat_blended?.back?.url) ||
    ""
  );
}
