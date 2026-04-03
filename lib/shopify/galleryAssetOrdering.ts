/**
 * Gallery ordering policy (locked):
 * - Sort keys: approvalState (approved / pending / rejected tiers), then galleryRole, then gallerySort.
 * - Storefront-style previews exclude rejected assets.
 * - Commerce heroes/flats stay first in PDP preview; deterministic scene URLs append in this order.
 * - Typical `gallerySort` ladder for scenes: body_model 38, neutral_hanger 40, backdrop_neutral 50,
 *   flatlay_wood 52, flatlay_boutique 54 (overridable per `rp_scene_templates` doc).
 */

import type {
  RpGalleryRole,
  RpProductAsset,
  RpSceneAssetApprovalState,
} from "@/lib/types/firestore";

/** Lower = earlier in gallery. */
export function approvalTierForGallery(asset: RpProductAsset): number {
  const st = asset.status;
  if (st === "rejected") return 2;
  const a = asset.approvalState as RpSceneAssetApprovalState | undefined;
  if (a === "rejected") return 2;
  if (a === "approved" || a === "auto_approved") return 0;
  if (a === "needs_review" || a === "pending_review") return 1;
  if (st === "approved" || st === "published") return 0;
  return 1;
}

const GALLERY_ROLE_ORDER: Record<RpGalleryRole, number> = {
  hero_front: 5,
  hero_back: 10,
  gallery_primary: 15,
  gallery_secondary: 25,
  alt_scene_primary: 40,
  alt_scene_secondary: 50,
  social_scene: 60,
};

export function galleryRoleRank(role: RpGalleryRole | undefined): number {
  if (!role) return 1000;
  return GALLERY_ROLE_ORDER[role] ?? 500;
}

function createdAtMs(asset: RpProductAsset): number {
  const t = asset.createdAt as { toMillis?: () => number; seconds?: number } | undefined;
  if (t?.toMillis) return t.toMillis();
  if (typeof t?.seconds === "number") return t.seconds * 1000;
  return 0;
}

/**
 * Deterministic sort for `rp_product_assets` rows when building PDP / storefront lists.
 */
export function compareRpProductAssetsForGallery(a: RpProductAsset, b: RpProductAsset): number {
  const d0 = approvalTierForGallery(a) - approvalTierForGallery(b);
  if (d0 !== 0) return d0;
  const d1 = galleryRoleRank(a.galleryRole) - galleryRoleRank(b.galleryRole);
  if (d1 !== 0) return d1;
  const sa = a.gallerySort ?? 9999;
  const sb = b.gallerySort ?? 9999;
  const d2 = sa - sb;
  if (d2 !== 0) return d2;
  return createdAtMs(b) - createdAtMs(a);
}

export function sortRpProductAssetsForGallery(assets: RpProductAsset[]): RpProductAsset[] {
  return [...assets].sort(compareRpProductAssetsForGallery);
}

export function isRejectedForGallery(asset: RpProductAsset): boolean {
  if (asset.status === "rejected") return true;
  return asset.approvalState === "rejected";
}

/** Deterministic scene / typed gallery rows (avoid duplicating untyped legacy rows in storefront preview). */
export function isDeterministicSceneOrGalleryTypedAsset(asset: RpProductAsset): boolean {
  if (asset.sourceType === "deterministic_scene") return true;
  const k = asset.semanticAssetKind;
  if (typeof k === "string" && k.startsWith("scene_")) return true;
  return !!asset.sceneTemplateSlug || !!asset.sceneTemplateId;
}

/**
 * Variant-scoped assets for parent products; for legacy single-doc products, all assets match.
 */
export function assetBelongsToVariantGallery(
  asset: RpProductAsset,
  variantDocId: string | undefined,
  treatsAsParentProduct: boolean
): boolean {
  if (!treatsAsParentProduct) return true;
  if (!variantDocId) return false;
  if (!asset.variantDocId) return false;
  return asset.variantDocId === variantDocId;
}

/**
 * Ordered image URLs from assets for storefront preview (commerce URLs should be prepended separately).
 */
export function orderedGalleryAssetUrlsForVariant(
  assets: RpProductAsset[],
  variantDocId: string | undefined,
  treatsAsParentProduct: boolean,
  mode: "storefront" | "admin"
): string[] {
  const scoped = assets.filter((a) => assetBelongsToVariantGallery(a, variantDocId, treatsAsParentProduct));
  const typed = scoped.filter((a) => isDeterministicSceneOrGalleryTypedAsset(a));
  const vis = mode === "storefront" ? typed.filter((a) => !isRejectedForGallery(a)) : typed;
  return sortRpProductAssetsForGallery(vis).map((a) => (a.publicUrl || a.downloadUrl || "").trim()).filter(Boolean);
}
