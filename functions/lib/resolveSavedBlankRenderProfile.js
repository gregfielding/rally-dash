"use strict";

/**
 * Server mirror of `lib/products/resolveSavedBlankRenderProfile.ts`.
 * Single object for: official flat compose, logs, and readiness alignment.
 */

const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
const {
  resolveEffectivePlacementForRenderTarget,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
} = require("./resolveProductRenderProfile");
const {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} = require("./variantRenderSources");
const {
  pickDesignPngUrlForBlankPreview,
  describeDesignSidePngSourcePath,
} = require("./designPickForBlankPreview");

function renderTargetToSide(target) {
  return target === "flat_front" || target === "model_front" ? "front" : "back";
}

function findBlankVariantById(blank, blankVariantId) {
  const list = blank && blank.variants;
  if (!Array.isArray(list) || !blankVariantId) return null;
  return list.find((v) => v.variantId === blankVariantId) || null;
}

function renderProfileFlags(blank, variantId, target) {
  const persisted = blank.renderProfile && blank.renderProfile.renderTargets;
  const byColor =
    blank.renderProfile &&
    blank.renderProfile.renderTargetsByColor &&
    blank.renderProfile.renderTargetsByColor[variantId];
  return {
    usesBlankRenderTargets: !!(persisted && persisted[target] && typeof persisted[target] === "object"),
    usesRenderTargetsByColor: !!(byColor && byColor[target] && typeof byColor[target] === "object"),
  };
}

function garmentImageUrlFromSavedBlank(blank, variant, renderTarget) {
  switch (renderTarget) {
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

/**
 * @param {{ blank: object, blankVariantId: string, design: object | null, product: object | null, renderTarget: string }} input
 */
function resolveSavedBlankRenderProfile(input) {
  const { blank, blankVariantId, design, product, renderTarget } = input;
  const variant = findBlankVariantById(blank, blankVariantId);
  if (!variant) return null;

  const printSides = resolvePrintSidesForProductBuild(blank, design || {});
  const side = renderTargetToSide(renderTarget);
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

  /** Same chain as blank editor / `pickDesignPngUrlForVariant` — blank library row only (not product variant overrides). */
  let resolvedDesignUrl = null;
  let resolvedTone = null;
  let sourcePathUsed = null;
  if (design) {
    const tonePick = pickDesignPngUrlForBlankPreview(design, variant, side);
    resolvedDesignUrl = tonePick.url;
    resolvedTone = tonePick.ref;
    sourcePathUsed =
      resolvedDesignUrl && tonePick.ref
        ? describeDesignSidePngSourcePath(design, side, tonePick.ref, resolvedDesignUrl)
        : null;
  }

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
      preferredArtworkTone: variant.preferredArtworkTone || null,
      colorFamily: variant.colorFamily || null,
    },
    resolvedDesignUrl,
    resolvedTone,
    sourcePathUsed,
    designUrl: resolvedDesignUrl,
    sideAllowedForDesign,
  };
}

module.exports = {
  resolveSavedBlankRenderProfile,
  findBlankVariantById,
  garmentImageUrlFromSavedBlank,
  renderTargetToSide,
};
