/**
 * Mirror of `functions/lib/default8394AssetPlan.js` — single source of truth for role keys in app code.
 * Server remains authoritative for orchestration.
 */
export const DEFAULT_8394_ASSET_PLAN = [
  "model_back_designed",
  "flat_front_clean",
  "flat_back_designed",
  "model_front_clean",
] as const;

export type Rp8394InitialAssetRole = (typeof DEFAULT_8394_ASSET_PLAN)[number];

export type RpAssetRoleState = "idle" | "queued" | "running" | "done" | "failed";
