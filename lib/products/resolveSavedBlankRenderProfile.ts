/**
 * Single resolved “recipe” for product pipelines: blank library row + saved `renderProfile` + color variant.
 *
 * **Source of truth (loaded):**
 * - Document: `rp_blanks/{blankId}`
 * - Color row: `blank.variants[]` where `variantId === blankVariantId`
 * - Per-target tuning: `blank.renderProfile.renderTargets[renderTarget]`
 * - Per-color matrix: `blank.renderProfile.renderTargetsByColor[blankVariantId][renderTarget]` (wins over base `renderTargets`)
 * - Zone geometry: `blank.placements[]` (merged by `resolveProductRenderProfile`)
 *
 * **Commerce sides** (which sides may receive design): `resolvePrintSidesForProduct(blank, design)` — includes
 * `supportedRenderViews` on the blank.
 *
 * Product overrides (`placementOverrides`, `renderSetup`) are applied only where `resolveProductRenderProfile` allows
 * — they do not replace the blank recipe unless explicitly set on the product.
 */

import type { DesignDoc, RPBlank, RPBlankVariant, RpProduct, RpRenderTargetKey } from "@/lib/types/firestore";
import {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} from "@/lib/blanks/variantRenderSources";
import { describeDesignSidePngSourcePath, pickDesignPngUrlForVariant } from "@/lib/designs/designHelpers";
import type { GarmentSide } from "@/lib/designs/designHelpers";
import { resolvePrintSidesForProduct, type PrintSidesResolution } from "@/lib/products/resolvePrintSidesForProduct";
import {
  resolveEffectivePlacementForRenderTarget,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
  renderTargetToSide,
} from "@/lib/products/resolveProductRenderProfile";

export type SavedBlankRenderProfileSource = {
  /** Firestore path to the blank document used. */
  blankDocPath: string;
  /** Which variant row on that blank (`variants[].variantId`). */
  blankVariantId: string;
  /** Base per-target map on the blank (`renderProfile.renderTargets`). */
  usesBlankRenderTargets: boolean;
  /** Per-color matrix (`renderProfile.renderTargetsByColor[variantId][target]`). */
  usesRenderTargetsByColor: boolean;
  renderTarget: RpRenderTargetKey;
};

export type ResolvedSavedBlankRenderProfile = {
  source: SavedBlankRenderProfileSource;
  /** Same shape as `fulfillmentSummary.printSides` / Shopify readiness (blank ∩ design ∩ supportedRenderViews). */
  printSides: PrintSidesResolution;
  blankId: string;
  renderTarget: RpRenderTargetKey;
  /** Garment image from the **saved** master blank variant (canonical). */
  garmentImageUrl: string | null;
  placement: ReturnType<typeof resolveEffectivePlacementForRenderTarget>;
  tuning: ReturnType<typeof resolveEffectiveRenderTargetSettings>;
  engineBlend: ReturnType<typeof resolveEngineBlendForRenderTarget>;
  toneRule: {
    preferredArtworkTone: string | null;
    colorFamily: string | null;
  };
  /**
   * Same tone pick as blank render profile editor: `pickDesignPngUrlForVariant(design, blankVariantRow, side)`.
   * Official compose must use these fields only — no second-pass tone resolution.
   */
  resolvedDesignUrl: string | null;
  resolvedTone: string | null;
  sourcePathUsed: string | null;
  /** Alias for pipelines that historically read `designUrl`; equals `resolvedDesignUrl`. */
  designUrl: string | null;
  /** False when this target’s side is not in `printSides` (do not composite / not required for readiness). */
  sideAllowedForDesign: boolean;
};

export function findBlankVariantById(
  blank: RPBlank | null | undefined,
  blankVariantId: string | null | undefined
): RPBlankVariant | null {
  if (!blank?.variants || !blankVariantId) return null;
  return blank.variants.find((v) => v.variantId === blankVariantId) ?? null;
}

export function garmentImageUrlFromSavedBlank(
  blank: RPBlank,
  variant: RPBlankVariant,
  target: RpRenderTargetKey
): string | null {
  switch (target) {
    case "flat_front":
      return getVariantFlatFrontUrl(blank, variant);
    case "flat_back":
      return getVariantFlatBackUrl(blank, variant);
    case "model_front":
      return getVariantModelFrontUrl(blank, variant);
    case "model_back":
      return getVariantModelBackUrl(blank, variant);
    default:
      return null;
  }
}

function renderProfileFlags(blank: RPBlank, variantId: string, target: RpRenderTargetKey) {
  const persisted = blank.renderProfile?.renderTargets;
  const byColor = blank.renderProfile?.renderTargetsByColor?.[variantId];
  return {
    usesBlankRenderTargets: Boolean(persisted?.[target] && typeof persisted[target] === "object"),
    usesRenderTargetsByColor: Boolean(byColor?.[target] && typeof byColor[target] === "object"),
  };
}

/**
 * Resolve the canonical saved-blank recipe for one render target + color line.
 * Callers should pass the same `product` document used for merges (parent + variant overrides).
 */
export function resolveSavedBlankRenderProfile(input: {
  blank: RPBlank;
  blankVariantId: string;
  design: DesignDoc | null | undefined;
  product: RpProduct | null | undefined;
  renderTarget: RpRenderTargetKey;
}): ResolvedSavedBlankRenderProfile | null {
  const { blank, blankVariantId, design, product, renderTarget } = input;
  const variant = findBlankVariantById(blank, blankVariantId);
  if (!variant) return null;

  const printSides = resolvePrintSidesForProduct(blank, design ?? null);
  const side = renderTargetToSide(renderTarget) as GarmentSide;
  const sideAllowedForDesign =
    side === "front" ? printSides.effectiveFront : side === "back" ? printSides.effectiveBack : false;

  const rp = renderProfileFlags(blank, blankVariantId, renderTarget);
  const garmentImageUrl = garmentImageUrlFromSavedBlank(blank, variant, renderTarget);

  const placement = resolveEffectivePlacementForRenderTarget(product, blank, variant, renderTarget);
  const tuning = resolveEffectiveRenderTargetSettings(product, blank, variant, renderTarget);
  const engineBlend = resolveEngineBlendForRenderTarget(
    product,
    blank,
    variant,
    renderTarget,
    tuning.settings.blend
  );

  const blankDocPath = `rp_blanks/${String(blank.blankId || "").trim() || "<blankId>"}`;

  const tonePick = design ? pickDesignPngUrlForVariant(design, variant, side) : { url: null as string | null, ref: null };
  const resolvedDesignUrl = tonePick.url;
  const resolvedTone = tonePick.ref;
  const sourcePathUsed =
    resolvedDesignUrl && tonePick.ref
      ? describeDesignSidePngSourcePath(design!, side, tonePick.ref, resolvedDesignUrl)
      : null;

  return {
    source: {
      blankDocPath,
      blankVariantId,
      usesBlankRenderTargets: rp.usesBlankRenderTargets,
      usesRenderTargetsByColor: rp.usesRenderTargetsByColor,
      renderTarget,
    },
    printSides,
    blankId: String(blank.blankId || "").trim(),
    renderTarget,
    garmentImageUrl,
    placement,
    tuning,
    engineBlend,
    toneRule: {
      preferredArtworkTone: variant.preferredArtworkTone ?? null,
      colorFamily: (variant.colorFamily as string) ?? null,
    },
    resolvedDesignUrl,
    resolvedTone,
    sourcePathUsed,
    designUrl: resolvedDesignUrl,
    sideAllowedForDesign,
  };
}
