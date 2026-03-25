import type { RpProduct } from "@/lib/types/firestore";

/** Human-readable labels for required fields (used in missing[] and UI). */
const REQUIRED_LABELS: Record<string, string> = {
  title: "Title",
  handle: "Handle",
  blankId: "Blank",
  price: "Price",
  weight: "Weight",
  heroFront: "Hero front",
};

/** Human-readable labels for recommended fields (used in warnings[]). */
const RECOMMENDED_LABELS: Record<string, string> = {
  heroBack: "Hero back",
  productType: "Product type",
  tags: "Tags",
  printPdfFront: "Print PDF front",
  printPdfBack: "Print PDF back",
};

export type ShopifyReadinessResult = {
  ready: boolean;
  missing: string[];
  warnings: string[];
};

/**
 * Determines if a product has the minimum required data for Shopify sync.
 * Required: title, handle, blankId, price, weight, and at least one hero image.
 * For blankStyleCode 8394 (back-print panty), heroBack and/or heroFront suffices (back blended + optional blank front).
 * Recommended (warn only): second hero side, productType, tags, printPdfFront, printPdfBack.
 */
export function isProductReadyForShopify(product: RpProduct | null | undefined): ShopifyReadinessResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!product) {
    return { ready: false, missing: ["Product"], warnings: [] };
  }

  // Required
  if (!product.title?.trim()) missing.push(REQUIRED_LABELS.title);
  if (!product.handle?.trim()) missing.push(REQUIRED_LABELS.handle);
  if (!product.blankId?.trim()) missing.push(REQUIRED_LABELS.blankId);
  if (typeof product.pricing?.basePrice !== "number" || product.pricing.basePrice < 0) {
    missing.push(REQUIRED_LABELS.price);
  }
  if (typeof product.shipping?.defaultWeightGrams !== "number" || product.shipping.defaultWeightGrams < 0) {
    missing.push(REQUIRED_LABELS.weight);
  }

  const blankStyle = String(product.blankStyleCode || "").trim();
  const is8394BackPrimary = blankStyle === "8394";
  if (is8394BackPrimary) {
    const hasHeroBack = !!product.media?.heroBack?.trim();
    const hasHeroFront = !!product.media?.heroFront?.trim();
    if (!hasHeroBack && !hasHeroFront) {
      missing.push("Hero back or hero front (8394 is back-print; use back blended or blank front)");
    }
  } else if (!product.media?.heroFront?.trim()) {
    missing.push(REQUIRED_LABELS.heroFront);
  }

  // Recommended (warn, do not block)
  if (!product.media?.heroBack?.trim()) warnings.push(RECOMMENDED_LABELS.heroBack);
  if (!product.productType?.trim()) warnings.push(RECOMMENDED_LABELS.productType);
  if (!Array.isArray(product.tags) || product.tags.length === 0) warnings.push(RECOMMENDED_LABELS.tags);
  if (!product.production?.printPdfFront?.trim()) warnings.push(RECOMMENDED_LABELS.printPdfFront);
  if (!product.production?.printPdfBack?.trim()) warnings.push(RECOMMENDED_LABELS.printPdfBack);

  return {
    ready: missing.length === 0,
    missing,
    warnings,
  };
}
