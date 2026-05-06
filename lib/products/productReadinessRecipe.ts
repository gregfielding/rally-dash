import type { DesignDoc, RPBlank } from "@/lib/types/firestore";
import {
  resolvePrintSidesForProduct,
  type PrintSidesResolution,
} from "@/lib/products/resolvePrintSidesForProduct";

/**
 * Single readiness recipe for a product: **one** `PrintSidesResolution` (blank ∩ design ∩ `supportedRenderViews`)
 * plus explicit policy for supplemental assets.
 *
 * All storefront / catalog / fulfillment / hero / print-file checks should use `recipe.printSides` from this
 * builder when `blank` + `design` are available — **not** a second inference path.
 */

export type FlatFrontCleanPolicy = "required" | "optional" | "suppressed";

export type ProductReadinessRecipe = {
  printSides: PrintSidesResolution;
  /**
   * **Back-only blank (`effectiveBack && !effectiveFront`):** `flat_front_clean` is **optional**.
   * It is never required for storefront readiness, catalog completeness, or fulfillment.
   * The pipeline may still generate it when the batch includes the role and the blank has a front garment URL —
   * purely supplemental PDP imagery.
   *
   * **Both sides:** front clean is **required** for full 8394 catalog completeness (legacy matrix).
   *
   * **Front-only:** front clean is **required** for the active side.
   *
   * **Suppressed** is reserved for future use (e.g. enqueue policy that skips the role entirely).
   */
  flatFrontCleanPolicy: FlatFrontCleanPolicy;
};

export function resolveFlatFrontCleanPolicy(printSides: PrintSidesResolution): FlatFrontCleanPolicy {
  const { effectiveFront, effectiveBack } = printSides;
  if (effectiveBack && !effectiveFront) return "optional";
  if (effectiveFront && !effectiveBack) return "required";
  if (effectiveFront && effectiveBack) return "required";
  return "optional";
}

/**
 * Canonical readiness recipe: same `resolvePrintSidesForProduct` as Cloud Functions `resolvePrintSidesForProductBuild`.
 */
export function buildProductReadinessRecipe(
  blank: RPBlank | null | undefined,
  design: DesignDoc | null | undefined
): ProductReadinessRecipe {
  const printSides = resolvePrintSidesForProduct(blank, design);
  return {
    printSides,
    flatFrontCleanPolicy: resolveFlatFrontCleanPolicy(printSides),
  };
}
