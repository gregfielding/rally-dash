import type { RpProduct } from "@/lib/types/firestore";
import { isProductReadyForShopify } from "@/lib/shopify/isProductReadyForShopify";

export type AttentionReason =
  | "description"
  | "metadata"
  | "images"
  | "shopify_sync";

export function productAttentionReasons(product: RpProduct): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  const hasDescription =
    !!(product.descriptionHtml?.trim() || product.description?.trim());
  if (!hasDescription) reasons.push("description");

  const hasCoreMetadata =
    !!product.title?.trim() &&
    !!product.handle?.trim() &&
    !!(product.sportCode || product.leagueCode || product.themeCode);
  if (!hasCoreMetadata) reasons.push("metadata");

  const hasMockupOrHero =
    !!(product.mockupUrl ||
      product.media?.heroFront ||
      product.heroAssetPath);
  if (!hasMockupOrHero) reasons.push("images");

  const { ready } = isProductReadyForShopify(product);
  const synced = !!product.shopify?.productId;
  const syncError = !!product.shopify?.lastSyncError;
  // Needs Shopify attention: failed sync, or ready to publish but not synced yet
  if (syncError || (ready && !synced)) {
    reasons.push("shopify_sync");
  }

  return reasons;
}

export function labelAttentionReason(r: AttentionReason): string {
  switch (r) {
    case "description":
      return "Description";
    case "metadata":
      return "Metadata";
    case "images":
      return "Mockups / images";
    case "shopify_sync":
      return "Shopify / sync";
    default:
      return r;
  }
}
