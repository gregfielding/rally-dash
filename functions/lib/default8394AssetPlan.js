"use strict";

/**
 * Single source of truth for initial 8394 team-product asset roles.
 * Pipeline: mock → flat MVP produces flat + model template slots for the primary variant per color.
 */
const DEFAULT_8394_ASSET_PLAN = Object.freeze([
  "model_back_designed",
  "flat_front_clean",
  "flat_back_designed",
  "model_front_clean",
]);

module.exports = {
  DEFAULT_8394_ASSET_PLAN,
};
