/**
 * Explicit per-color render source URLs on master blank variants.
 * Legacy `images.front` / `images.back` map to flat slots when dedicated slots are empty.
 */

import type { RPBlank, RPBlankVariant, RPImageRef } from "@/lib/types/firestore";

function pickUrl(ref: RPImageRef | null | undefined): string | null {
  const u = ref?.downloadUrl?.trim();
  return u || null;
}

export function getVariantFlatBackUrl(blank: RPBlank, variant: RPBlankVariant): string | null {
  const im = variant.images;
  return pickUrl(im?.flatBack) || pickUrl(im?.back) || pickUrl(blank.images?.back) || null;
}

export function getVariantFlatFrontUrl(blank: RPBlank, variant: RPBlankVariant): string | null {
  const im = variant.images;
  return pickUrl(im?.flatFront) || pickUrl(im?.front) || pickUrl(blank.images?.front) || null;
}

/** Model / “butt” blank — variant only (no style-level fallback). */
export function getVariantModelBackUrl(_blank: RPBlank, variant: RPBlankVariant): string | null {
  return pickUrl(variant.images?.modelBack);
}

export function getVariantModelFrontUrl(_blank: RPBlank, variant: RPBlankVariant): string | null {
  return pickUrl(variant.images?.modelFront);
}
