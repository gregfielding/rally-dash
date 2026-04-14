/**
 * Mirror of `functions/lib/defaultAssetPlan.js` — primary launch roles (`rp_generation_jobs` official images).
 */
export const DEFAULT_ASSET_PLAN = [
  "model_back_designed",
  "model_front_clean",
  "flat_front_clean",
  "flat_back_designed",
] as const;

export type RpOfficialAssetRole = (typeof DEFAULT_ASSET_PLAN)[number];
