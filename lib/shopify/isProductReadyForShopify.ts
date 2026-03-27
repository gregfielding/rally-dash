import type { RpProduct } from "@/lib/types/firestore";
import { primaryVariantImageUrlForShopify } from "@/lib/shopify/variantShopifyMedia";

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

/** Heroes stored on variant docs for parent products; optional mockup URL matches post–mock-job state */
export type ShopifyReadinessMediaFallback = {
  heroFront?: string | null;
  heroBack?: string | null;
  mockupUrl?: string | null;
};

/** Subset of variant fields used for parent Color × Size Shopify readiness (pass loaded `variants/*` rows). */
export type ShopifyReadinessVariantInput = {
  sku?: string | null;
  status?: string | null;
  optionValues?: { color?: string | null; size?: string | null };
  media?: { heroFront?: string | null; heroBack?: string | null } | null;
  mockupUrl?: string | null;
  flatRenders?: RpProduct["flatRenders"] | null;
};

/**
 * Determines if a product has the minimum required data for Shopify sync.
 * Required: title, handle, blankId, price, weight, and at least one hero image.
 * For blankStyleCode 8394 (back-print panty), heroBack and/or heroFront suffices (back blended + optional blank front).
 * Recommended (warn only): second hero side, productType, tags, printPdfFront, printPdfBack.
 *
 * Parent products: pass `mediaFallback` from the hero/default variant so checks align with `onMockJobCreated` writes.
 * When `activeVariants` is passed for a parent product (product detail page), **strict** matrix rules apply: every
 * active variant must have SKU, Color, Size, and a primary image — aligned with the sync worker. When omitted
 * (e.g. product lists without variant subcollection loaded), parent products use the legacy parent-media hero rules.
 */
export function isProductReadyForShopify(
  product: RpProduct | null | undefined,
  options?: {
    mediaFallback?: ShopifyReadinessMediaFallback | null;
    activeVariants?: ShopifyReadinessVariantInput[] | null;
  }
): ShopifyReadinessResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!product) {
    return { ready: false, missing: ["Product"], warnings: [] };
  }

  const fb = options?.mediaFallback;
  const effHeroFront = (product.media?.heroFront?.trim() || fb?.heroFront?.trim() || "").trim();
  const effHeroBack = (product.media?.heroBack?.trim() || fb?.heroBack?.trim() || "").trim();
  const effMockup = (fb?.mockupUrl?.trim() || "").trim();

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
  const isParent = product.productKind === "parent";
  const activeVariants = options?.activeVariants;

  if (isParent && Array.isArray(activeVariants)) {
    const active = activeVariants.filter((v) => v.status !== "archived");
    if (active.length === 0) {
      missing.push("Active variants");
    } else {
      let needSku = false;
      let needOpts = false;
      let needImg = false;
      for (const v of active) {
        if (!String(v.sku ?? "").trim()) needSku = true;
        const c = String(v.optionValues?.color ?? "").trim();
        const sz = String(v.optionValues?.size ?? "").trim();
        if (!c || !sz) needOpts = true;
        if (!primaryVariantImageUrlForShopify(v, product.blankStyleCode)) needImg = true;
      }
      if (needSku) missing.push("SKU on every active variant");
      if (needOpts) missing.push("Color × Size on every active variant");
      if (needImg) missing.push("Variant image (each active variant needs hero, mockup, or flat render)");
    }
  } else if (is8394BackPrimary) {
    const hasHeroBack = !!effHeroBack || !!effMockup;
    const hasHeroFront = !!effHeroFront;
    if (!hasHeroBack && !hasHeroFront) {
      missing.push("Hero back or hero front (8394 is back-print; use back blended or blank front)");
    }
  } else if (!effHeroFront) {
    missing.push(REQUIRED_LABELS.heroFront);
  }

  // Recommended (warn, do not block)
  if (!effHeroBack && !effMockup) warnings.push(RECOMMENDED_LABELS.heroBack);
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
