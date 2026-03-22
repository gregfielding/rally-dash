import type { RpProduct, RpProductFlatRendersMvp } from "@/lib/types/firestore";

export type FlatBlendedSourceView = "front" | "back";

/**
 * Prefer front flat_blended (crewneck / tees), then back (e.g. 8394 MVP).
 */
export function pickFlatBlendedUrlForScene(
  flatRenders: RpProductFlatRendersMvp | null | undefined
): { url: string; view: FlatBlendedSourceView } | null {
  const front = flatRenders?.flat_blended?.front;
  const back = flatRenders?.flat_blended?.back;
  if (front?.url) return { url: front.url, view: "front" };
  if (back?.url) return { url: back.url, view: "back" };
  return null;
}

export function productHasFlatBlendedForScene(product: RpProduct | null | undefined): boolean {
  return pickFlatBlendedUrlForScene(product?.flatRenders) != null;
}
