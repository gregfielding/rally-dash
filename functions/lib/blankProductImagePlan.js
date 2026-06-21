"use strict";

/**
 * Blank-driven 8394 product image shot plan (Cloud Functions). Keep in sync with `lib/products/blankProductImagePlan.ts`.
 */

const {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} = require("./variantRenderSources");
const { designPrintSidesForStyleCode } = require("./pipelineReadiness");

const BLANK_PRODUCT_IMAGE_GENERATION_KEYS = Object.freeze([
  "model_blended_back",
  "flat_blended_front",
  "flat_clean_front",
  "flat_blended_back",
  "model_clean_front",
]);

const DEFAULT_GALLERY_ORDER = Object.freeze({
  model_blended_back: 10,
  flat_blended_front: 15,
  flat_clean_front: 20,
  flat_blended_back: 30,
  model_clean_front: 40,
});

function trimU(u) {
  return u != null && typeof u === "string" ? u.trim() : "";
}

function resolveSourcePhotoUrlForGenerationKey(blank, variant, key, override) {
  const o = trimU(override);
  if (o) return o;
  switch (key) {
    case "flat_blended_back":
      return trimU(getVariantFlatBackUrl(blank, variant)) || null;
    case "flat_blended_front":
    case "flat_clean_front":
      return trimU(getVariantFlatFrontUrl(blank, variant)) || null;
    case "model_blended_back":
      return trimU(getVariantModelBackUrl(blank, variant)) || null;
    case "model_clean_front":
      return trimU(getVariantModelFrontUrl(blank, variant)) || null;
    default:
      return null;
  }
}

function inferEnabledGenerationKeys8394(blank, variant) {
  /**
   * Print-side-aware role inference. The blank's `designPrintSides` (from the
   * pipeline-readiness registry) decides which flat side carries the DESIGN vs a
   * clean garment shot:
   *   - back-print (panty/thong): flat back is designed, flat front is clean → unchanged legacy behavior.
   *   - front-print (tank/crewneck): flat front is DESIGNED (flat_blended_front).
   * Model keys stay image-driven (non-8394 model roles are skipped downstream by
   * the official model compositor; the VTON product-realism path renders those).
   */
  const printSides = designPrintSidesForStyleCode(blank && blank.styleCode);
  const printsFront = printSides.includes("front");
  const printsBack = printSides.includes("back");

  const out = [];
  if (trimU(getVariantModelBackUrl(blank, variant))) out.push("model_blended_back");
  if (trimU(getVariantFlatFrontUrl(blank, variant))) {
    out.push(printsFront ? "flat_blended_front" : "flat_clean_front");
  }
  if (printsBack && trimU(getVariantFlatBackUrl(blank, variant))) out.push("flat_blended_back");
  if (trimU(getVariantModelFrontUrl(blank, variant))) out.push("model_clean_front");
  return out;
}

function resolve8394ProductImagePlan(blank, variant) {
  const raw = (variant && variant.productImageTargets) || {};
  const inferred = new Set(inferEnabledGenerationKeys8394(blank, variant));
  const out = {};

  for (const key of BLANK_PRODUCT_IMAGE_GENERATION_KEYS) {
    const row = raw[key];
    const explicit = row && typeof row === "object" ? row : {};
    const hasExplicit = Object.prototype.hasOwnProperty.call(raw, key);
    const resolvedUrl = resolveSourcePhotoUrlForGenerationKey(blank, variant, key, explicit.sourcePhotoUrl);

    let enabled;
    if (hasExplicit) {
      enabled = explicit.enabled !== false && !!resolvedUrl;
    } else {
      enabled = inferred.has(key);
    }

    const go = explicit.galleryOrder;
    const effectiveGalleryOrder =
      go != null && Number.isFinite(Number(go)) ? Number(go) : DEFAULT_GALLERY_ORDER[key];

    const isDesignedComposite =
      key === "flat_blended_back" || key === "model_blended_back" || key === "flat_blended_front";
    const expectsArtwork = isDesignedComposite ? explicit.expectsArtwork !== false : false;

    out[key] = {
      ...explicit,
      key,
      enabled,
      resolvedSourcePhotoUrl: resolvedUrl,
      effectiveGalleryOrder,
      expectsArtwork,
    };
  }

  return out;
}

function enabledGenerationKeysInPlanOrder(plan) {
  return BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => plan[k].enabled).sort(
    (a, b) => plan[a].effectiveGalleryOrder - plan[b].effectiveGalleryOrder
  );
}

function expectsArtworkForPlanKey(plan, key) {
  return !!plan[key]?.expectsArtwork;
}

/** MVP generation key → rp_generation_jobs `initialAssetRole` / batch role id */
const GENERATION_KEY_TO_OFFICIAL_ROLE = Object.freeze({
  model_blended_back: "model_back_designed",
  model_clean_front: "model_front_clean",
  flat_blended_front: "flat_front_designed",
  flat_clean_front: "flat_front_clean",
  flat_blended_back: "flat_back_designed",
});

const OFFICIAL_MODEL_ROLES = Object.freeze(["model_back_designed", "model_front_clean"]);
const OFFICIAL_FLAT_ROLES = Object.freeze(["flat_front_clean", "flat_front_designed", "flat_back_designed"]);

function officialRoleForGenerationKey(key) {
  return GENERATION_KEY_TO_OFFICIAL_ROLE[key] || null;
}

function isOfficialModelRoleName(role) {
  return OFFICIAL_MODEL_ROLES.includes(role);
}

function isOfficialFlatRoleName(role) {
  return OFFICIAL_FLAT_ROLES.includes(role);
}

/**
 * Single blank color row: enabled targets, gallery order, required launch/Shopify (official role ids).
 * Mirrors `lib/products/blankProductImagePlan.ts` `resolveBlankProductImagePlan`.
 */
function resolveBlankProductImagePlan(blank, variant) {
  const plan = resolve8394ProductImagePlan(blank, variant);
  const enabledKeys = enabledGenerationKeysInPlanOrder(plan);
  const enabledOfficialRolesOrdered = enabledKeys.map(officialRoleForGenerationKey).filter(Boolean);

  const raw = (variant && variant.productImageTargets) || {};
  const hasExplicitLaunch = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.some((k) => raw[k]?.requiredForLaunch === true);
  const hasExplicitShopify = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.some((k) => raw[k]?.requiredForShopify === true);

  let requiredLaunchOfficialRoles;
  if (hasExplicitLaunch) {
    requiredLaunchOfficialRoles = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => raw[k]?.requiredForLaunch === true)
      .map(officialRoleForGenerationKey)
      .filter(Boolean);
  } else {
    requiredLaunchOfficialRoles = enabledKeys
      .filter((k) => k === "flat_clean_front" || k === "flat_blended_back" || k === "flat_blended_front")
      .map(officialRoleForGenerationKey)
      .filter(Boolean);
  }

  let requiredShopifyOfficialRoles = null;
  if (hasExplicitShopify) {
    requiredShopifyOfficialRoles = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => raw[k]?.requiredForShopify === true)
      .map(officialRoleForGenerationKey)
      .filter(Boolean);
  }

  return {
    generationPlan: plan,
    enabledGenerationKeysOrdered: enabledKeys,
    enabledOfficialRolesOrdered,
    requiredLaunchOfficialRoles,
    requiredShopifyOfficialRoles,
    galleryOrderOfficialRoles: enabledOfficialRolesOrdered,
  };
}

module.exports = {
  BLANK_PRODUCT_IMAGE_GENERATION_KEYS,
  DEFAULT_GALLERY_ORDER,
  resolve8394ProductImagePlan,
  resolveBlankProductImagePlan,
  enabledGenerationKeysInPlanOrder,
  expectsArtworkForPlanKey,
  resolveSourcePhotoUrlForGenerationKey,
  inferEnabledGenerationKeys8394,
  officialRoleForGenerationKey,
  GENERATION_KEY_TO_OFFICIAL_ROLE,
  OFFICIAL_MODEL_ROLES,
  OFFICIAL_FLAT_ROLES,
  isOfficialModelRoleName,
  isOfficialFlatRoleName,
};
