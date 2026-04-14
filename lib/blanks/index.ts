export {
  MASTER_BLANK_SCHEMA_VERSION,
  isMasterBlank,
  isLegacyBlank,
  getEffectiveCategory,
  getBlankVariants,
  getVariantById,
  countActiveVariants,
  firstActiveVariant,
  getMasterBlankPreviewUrl,
  variantHasFrontBack,
  newVariantId,
  synthesizeLegacyVariant,
} from "./blankModel";
export {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} from "./variantRenderSources";
export {
  getVariantRenderReady8394,
  isVariantRenderReady8394,
  type VariantRenderReady8394Result,
  type VariantRenderReady8394ChecklistItem,
} from "./variant8394MasterReadiness";
export { deriveColorFamily, getEffectiveColorFamily } from "./colorFamily";
export { garmentCategoryDefaultPrintSides, inferDefaultPrintSides } from "./defaultPrintSides";
export { getDefaultPrintSidesForStyleCode } from "@/lib/rp/blanks/styleRegistry";
export {
  DEFAULT_SIMPLE_RENDER_CONTROLS_8394,
  derivePlacementEngineFields8394,
  inferSimpleControls8394FromLegacy,
  mapInkStrengthToFactors,
  mapRealismToBlend,
  normalizeSimpleControls8394,
  sizePresetToDefaultScale,
} from "./simpleRenderControls8394";
export { get8394EngineQaMetrics } from "./8394EngineQaMetrics";
export {
  resolveBlankTemplates,
  stripUnresolvedTemplateArtifacts,
  type BlankTemplateContext,
  type ResolvedBlankTemplates,
} from "./templateTokens";
export {
  TEAM_COLOR_FAMILY_OPTIONS,
  getEffectiveEligibility,
  getEffectiveEligibilityForVariant,
  computeEligibleTeams,
  teamMatchesColorFamilies,
  type EffectiveBlankEligibility,
  type EligibleTeamsResult,
  type TeamColorFamilyOption,
} from "./eligibility";
export { GARMENT_SIZE_CODES_ORDER, normalizeGarmentSizes, getProductVariantSizeList } from "./garmentSizes";
export { mapRpBlankFromFirestore } from "./blankFirestore";
export { normalizeRPBlankRenderProfile } from "./renderProfileNormalize";
export {
  buildRenderTargetSettingsMap,
  getDefaultRenderTargetSettings,
  getRenderTargetPreviewUrl,
  legacyZoneBlendToBlend01,
  mergeRenderTargetSettings,
  RENDER_TARGET_LABELS,
  RENDER_TARGETS,
  variantSliceToRenderTargetSettingsPatch,
} from "@/lib/render/renderTargetTuning";
export {
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
  type ResolveRenderTargetSettingsQa,
} from "@/lib/products/resolveProductRenderProfile";
