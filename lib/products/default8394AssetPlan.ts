/**
 * @deprecated Legacy alias — prefer `DEFAULT_ASSET_PLAN` from `./defaultAssetPlan`.
 * Mirrors historical 8394 mock/flat ordering; orchestration now uses official generation roles.
 */
export const DEFAULT_8394_ASSET_PLAN = [
  "model_back_designed",
  "flat_front_clean",
  "flat_back_designed",
  "model_front_clean",
] as const;

export type Rp8394InitialAssetRole = (typeof DEFAULT_8394_ASSET_PLAN)[number];

export type RpAssetRoleState = "idle" | "queued" | "running" | "done" | "failed";
