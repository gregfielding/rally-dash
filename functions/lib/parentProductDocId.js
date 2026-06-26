"use strict";

const crypto = require("crypto");

/**
 * Deterministic Firestore doc id for a parent `rp_products` doc, derived from its
 * `parentProductIdentityKey` (league_team_design_blank — see buildParentProductIdentityKey).
 *
 * Why: parent dedupe in `runCreateProductFromDesignBlankCore` is a read-then-write —
 * a query on `parentProductIdentityKey` followed by a `.add()` with a random id. Two
 * auto-launches racing on the same (league, team, design, blank) — e.g. two
 * `onDesignCreated` trigger deliveries, which are at-least-once — both read "no parent"
 * and both `.add()` a fresh parent. Routing new parents through this deterministic id
 * lets the create be an atomic `.create()`: concurrent runs compute the SAME id, so the
 * loser collides with `ALREADY_EXISTS` and reuses the winner instead of duplicating.
 *
 * The id is a stable hash (no randomness/time), so it is identical across processes and
 * re-derivable. We hash rather than use the raw key as the id to bound length and
 * guarantee a valid id regardless of key content. Legacy parents created via `.add()`
 * keep their random ids and are still found by the `parentProductIdentityKey` query —
 * this id only governs parents created from here forward.
 *
 * @param {string} parentProductIdentityKey
 * @returns {string} Firestore-safe doc id (e.g. "p_<sha256hex>").
 */
function parentProductDocId(parentProductIdentityKey) {
  const key = String(parentProductIdentityKey == null ? "" : parentProductIdentityKey).trim();
  if (!key) {
    throw new Error("parentProductDocId: parentProductIdentityKey is required (got empty)");
  }
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return `p_${hash}`;
}

/**
 * Deterministic Firestore doc id for a `rp_products/{parent}/variants/{variant}` doc,
 * derived from its `variantIdentityKey` (league_team_design_blank_color_size).
 *
 * Why: same race as the parent, one level down. Variant creation in
 * `runCreateProductFromDesignBlankCore` looped `sizesToCreate` and wrote each with a
 * random-id `.doc()`, deduping only against the legacy top-level collection — never
 * against the parent's own `variants` subcollection. Two at-least-once auto-launch
 * deliveries (or a retried run after the parent already exists) both compute
 * `sizesToCreate = all` before either writes, then both write a fresh per-(color,size)
 * doc → duplicate variants (observed: crewneck Off White ×2 per size). Routing variant
 * creates through this deterministic id makes the write an atomic `.create()`: racing
 * runs collide on `ALREADY_EXISTS` and skip instead of duplicating, and existing
 * renders are never clobbered.
 *
 * @param {string} variantIdentityKey
 * @returns {string} Firestore-safe doc id (e.g. "v_<sha256hex>").
 */
function variantProductDocId(variantIdentityKey) {
  const key = String(variantIdentityKey == null ? "" : variantIdentityKey).trim();
  if (!key) {
    throw new Error("variantProductDocId: variantIdentityKey is required (got empty)");
  }
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return `v_${hash}`;
}

module.exports = { parentProductDocId, variantProductDocId };
