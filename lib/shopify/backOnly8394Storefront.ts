import type { RpOfficialAssetRecipeProvenance, RpProductFlatRendersMvp } from "@/lib/types/firestore";
import type { ProductPrintSidesForCommerce, VariantMediaShape } from "@/lib/shopify/variantShopifyMedia";

function trimU(u: string | null | undefined): string {
  return u != null && typeof u === "string" ? u.trim() : "";
}

function provGarmentOnly(p: RpOfficialAssetRecipeProvenance | null | undefined): boolean {
  if (!p) return false;
  if (p.garmentOnly === true) return true;
  if (p.garmentOnlyCleanFront === true) return true;
  return false;
}

/**
 * Back-only 8394: a **front** raster URL may appear in the gallery only if it is garment-only
 * (official `flat_front_clean` / legacy clean, or model front clean — never front-with-art).
 */
export function isBackOnly8394FrontImageUrlAllowed(
  row: VariantMediaShape | null | undefined,
  url: string
): boolean {
  const u = trimU(url);
  if (!u || !row) return true;

  const fcUrl = trimU(row.flatRenders?.flat_clean?.front?.url);
  const fcPv = row.flatRenders?.flat_clean?.front?.recipeProvenance;
  if (fcUrl === u) {
    if (!fcPv) return true;
    if (trimU(fcPv.resolvedDesignUrl)) return false;
    return provGarmentOnly(fcPv);
  }

  const gen = row.generatedRenderOutputs?.find(
    (o) => String(o.role || "") === "flat_front" && String(o.lookType || "") === "flat_clean" && trimU(o.url) === u
  );
  if (gen) {
    const p = gen.recipeProvenance;
    if (!p) return true;
    if (trimU(p.resolvedDesignUrl)) return false;
    return provGarmentOnly(p);
  }

  const mcUrl = trimU(row.flatRenders?.model_clean?.front?.url);
  if (mcUrl === u) return true;

  const hf = trimU(row.media?.heroFront);
  if (hf === u) {
    if (mcUrl === u) return true;
    return false;
  }

  return true;
}

/** True when `printSides` is back-only commerce. */
export function isBackOnlyPrintSides8394(printSides: ProductPrintSidesForCommerce | null | undefined): boolean {
  if (!printSides) return false;
  return printSides.effectiveBack === true && printSides.effectiveFront === false;
}

/**
 * Filter ordered URL list for simulated storefront: drop front URLs that are not garment-only for back-only 8394.
 */
export function filterBackOnly8394StorefrontGalleryUrls(
  row: VariantMediaShape | null | undefined,
  printSides: ProductPrintSidesForCommerce | null | undefined,
  urls: string[]
): string[] {
  if (!isBackOnlyPrintSides8394(printSides)) return urls;
  return urls.filter((x) => isBackOnly8394FrontImageUrlAllowed(row, x));
}

export type VariantRowLike8394 = VariantMediaShape & {
  flatRenders?: RpProductFlatRendersMvp | null;
};
