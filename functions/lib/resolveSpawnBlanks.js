"use strict";

/**
 * Phase K8 — pure resolver for "which blanks should auto-launch spawn products
 * for, given this design + team?"
 *
 * Extracted from onDesignCreated.js so the precedence rules (the risky part of
 * the hot-path change) are unit-testable without the Firestore emulator. The
 * trigger loads the pipeline-ready master blanks + the team's
 * productCatalogMatrix, then calls this to decide the final allow-set.
 *
 * Precedence (highest first):
 *   1. targetBlankIds — explicit per-design operator pick from the bulk-upload
 *      review screen. Honored as-is (intersected with the pipeline-ready set the
 *      caller already applied). The team matrix is NOT layered on top — an
 *      explicit pick is the operator's escape hatch to spawn outside the
 *      team's usual catalog.
 *   2. productCatalogMatrix — the team's approved-blank catalog. Applied only
 *      when there's no per-design override. Restricts to blanks present in the
 *      matrix with enabled !== false.
 *   3. Fallback — all pipeline-ready blanks (the caller's input set), used when
 *      the team has no matrix configured. Back-compat: never block a spawn just
 *      because a team isn't set up.
 *
 * @param {string[]} pipelineReadyBlankIds  Master blank ids already filtered to
 *                                          schemaVersion=2 + active + pipeline-ready.
 * @param {Object} opts
 * @param {string[]} [opts.targetBlankIds]  Per-design operator selection.
 * @param {Record<string, {enabled?: boolean}>|null} [opts.productCatalogMatrix]
 *                                          Team catalog. Keys are blank ids.
 * @returns {{ blankIds: string[], reason: "targetBlankIds"|"productCatalogMatrix"|"no_matrix_all_pipeline_ready" }}
 */
function resolveSpawnBlankIds(pipelineReadyBlankIds, opts = {}) {
  const ready = Array.isArray(pipelineReadyBlankIds)
    ? pipelineReadyBlankIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const readySet = new Set(ready);

  const targetBlankIds = Array.isArray(opts.targetBlankIds)
    ? opts.targetBlankIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  // (1) Per-design operator override wins.
  if (targetBlankIds.length > 0) {
    return {
      blankIds: targetBlankIds.filter((id) => readySet.has(id)),
      reason: "targetBlankIds",
    };
  }

  // (2) Team approved-blank catalog.
  const matrix =
    opts.productCatalogMatrix && typeof opts.productCatalogMatrix === "object"
      ? opts.productCatalogMatrix
      : null;
  if (matrix) {
    const approved = Object.keys(matrix).filter((blankId) => {
      const entry = matrix[blankId];
      // `enabled` defaults to true when omitted; only an explicit false hides it.
      return entry && entry.enabled !== false;
    });
    if (approved.length > 0) {
      const approvedSet = new Set(approved);
      return {
        blankIds: ready.filter((id) => approvedSet.has(id)),
        reason: "productCatalogMatrix",
      };
    }
  }

  // (3) No matrix → all pipeline-ready (back-compat).
  return { blankIds: ready, reason: "no_matrix_all_pipeline_ready" };
}

module.exports = { resolveSpawnBlankIds };
