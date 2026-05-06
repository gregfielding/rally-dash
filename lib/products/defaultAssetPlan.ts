/**
 * Mirror of `functions/lib/defaultAssetPlan.js` — legacy union of official roles when no blank row plan is available.
 * **Authoritative per-color targets:** `resolveBlankProductImagePlan` in `./blankProductImagePlan` (blank color row).
 *
 * **8394:** Default required-for-launch (when not overridden on the matrix) are the two flat slots; model roles are optional without identity.
 */
export const DEFAULT_ASSET_PLAN = [
  "model_back_designed",
  "model_front_clean",
  "flat_front_clean",
  "flat_back_designed",
] as const;

export type RpOfficialAssetRole = (typeof DEFAULT_ASSET_PLAN)[number];
