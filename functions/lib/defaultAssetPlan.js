"use strict";

/**
 * Official catalog asset roles (rp_generation_jobs / rp_product_asset_batches).
 * Dynamic plan: `resolveBlankProductImagePlan(blank, blankVariantRow)` — single source of truth on the blank color row.
 * Static `DEFAULT_ASSET_PLAN` remains the legacy fallback when blank row is missing (scripts / guards).
 */

const {
  resolveBlankProductImagePlan,
  OFFICIAL_MODEL_ROLES,
  OFFICIAL_FLAT_ROLES,
  isOfficialModelRoleName,
  isOfficialFlatRoleName,
} = require("./blankProductImagePlan");

/** Required-for-batch-failure flats (legacy): both flat catalog roles. */
const OFFICIAL_REQUIRED_LAUNCH_ROLES = OFFICIAL_FLAT_ROLES;

/** Full plan order when no `productImageTargets`: model slots then flats — legacy docs. */
const LEGACY_DEFAULT_ASSET_PLAN = Object.freeze([...OFFICIAL_MODEL_ROLES, ...OFFICIAL_FLAT_ROLES]);

const DEFAULT_ASSET_PLAN = LEGACY_DEFAULT_ASSET_PLAN;

const ALL_OFFICIAL_CATALOG_ROLES = new Set(LEGACY_DEFAULT_ASSET_PLAN);

function isOfficialModelRole(role) {
  return isOfficialModelRoleName(role);
}

function isOfficialRequiredLaunchRole(role) {
  return OFFICIAL_REQUIRED_LAUNCH_ROLES.includes(role);
}

module.exports = {
  DEFAULT_ASSET_PLAN,
  LEGACY_DEFAULT_ASSET_PLAN,
  OFFICIAL_MODEL_ROLES,
  OFFICIAL_FLAT_ROLES,
  OFFICIAL_REQUIRED_LAUNCH_ROLES,
  ALL_OFFICIAL_CATALOG_ROLES,
  resolveBlankProductImagePlan,
  isOfficialModelRole,
  isOfficialRequiredLaunchRole,
};
