"use strict";

/**
 * Primary launch asset roles — driven by `rp_generation_jobs` (official images), not 8394 mock/flat.
 */
const DEFAULT_ASSET_PLAN = Object.freeze([
  "model_back_designed",
  "model_front_clean",
  "flat_front_clean",
  "flat_back_designed",
]);

module.exports = {
  DEFAULT_ASSET_PLAN,
};
