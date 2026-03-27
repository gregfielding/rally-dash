/**
 * Master blank + variants model helpers.
 * Legacy: documents with top-level colorName and no variants (or schemaVersion !== 2).
 */

import type { RPBlank, RPBlankVariant, RPImageRef } from "@/lib/types/firestore";
import { deriveColorFamily } from "./colorFamily";

export const MASTER_BLANK_SCHEMA_VERSION = 2;

export function isMasterBlank(blank: Pick<RPBlank, "schemaVersion" | "variants">): boolean {
  return blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION;
}

/** Legacy: one doc = one color, no master variants array */
export function isLegacyBlank(blank: Pick<RPBlank, "schemaVersion" | "variants" | "colorName">): boolean {
  if (isMasterBlank(blank)) return false;
  const v = blank.variants;
  if (v && v.length > 0) return false;
  return Boolean(blank.colorName);
}

export function getEffectiveCategory(blank: RPBlank): string {
  return blank.category ?? blank.garmentCategory ?? "";
}

export function synthesizeLegacyVariant(blank: RPBlank): RPBlankVariant {
  const colorName = String(blank.colorName ?? "Default");
  return {
    variantId: "legacy",
    colorName,
    colorHex: blank.colorHex ?? null,
    colorFamily: blank.colorFamily ?? deriveColorFamily(colorName),
    isActive: true,
    sortOrder: 0,
    images: {
      front: blank.images?.front ?? null,
      back: blank.images?.back ?? null,
      detail: null,
    },
    preferredArtworkTone: null,
  };
}

/** Effective variants: master `variants[]` or a single synthetic row for legacy docs */
export function getBlankVariants(blank: RPBlank): RPBlankVariant[] {
  if (blank.variants && blank.variants.length > 0) return blank.variants;
  if (blank.colorName || (blank.images?.front || blank.images?.back)) {
    return [synthesizeLegacyVariant(blank)];
  }
  return [];
}

export function getVariantById(blank: RPBlank, variantId: string | null | undefined): RPBlankVariant | null {
  if (!variantId) return null;
  return getBlankVariants(blank).find((v) => v.variantId === variantId) ?? null;
}

export function countActiveVariants(blank: RPBlank): number {
  return getBlankVariants(blank).filter((v) => v.isActive !== false).length;
}

export function firstActiveVariant(blank: RPBlank): RPBlankVariant | null {
  const list = getBlankVariants(blank).filter((v) => v.isActive !== false);
  return list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

function pickImageUrl(ref: RPImageRef | null | undefined): string | null {
  return ref?.downloadUrl ?? null;
}

/** First preview URL for library row (first active variant with front image) */
export function getMasterBlankPreviewUrl(blank: RPBlank): string | null {
  const v = firstActiveVariant(blank);
  if (!v) return pickImageUrl(blank.images?.front);
  return pickImageUrl(v.images?.front) ?? pickImageUrl(v.images?.back) ?? pickImageUrl(blank.images?.front);
}

export function variantHasFrontBack(v: RPBlankVariant): { front: boolean; back: boolean } {
  return {
    front: Boolean(v.images?.front?.downloadUrl),
    back: Boolean(v.images?.back?.downloadUrl),
  };
}

export function newVariantId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
