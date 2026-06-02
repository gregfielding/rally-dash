"use strict";

/**
 * Phase E progress triggers. One factory function used by both the scene-job
 * and preview-job onWrite triggers in functions/index.js. Each trigger:
 *
 *   1. Reads `batchId` from the new (or current) job doc.
 *   2. If `batchId` is absent, no-op (legacy jobs without batches).
 *   3. If the job's `status` changed, call `incrementBatchCounters` to update
 *      the parent rp_batches counters + recompute the rollup status.
 *
 * Why a single factory: scene_set + vton_ab batches use IDENTICAL update
 * semantics — only the source collection differs. Keeping the logic in one
 * file means a future status-rollup tweak applies to both kinds without
 * silent drift.
 *
 * Why onWrite (not onUpdate): the create-time write should also tick the
 * "queued" counter on the parent. But since createBatchAtomically already
 * sets `queued: jobs.length`, treating the create as a no-op (from=undefined,
 * to=queued) AVOIDS double-counting. The wrapper handles that case via
 * `fromStatus === toStatus → skip`.
 */

const { incrementBatchCounters } = require("./batchHelpers");

/**
 * @param {Object} deps
 * @param {FirebaseFirestore.Firestore} deps.db
 * @param {typeof import("firebase-admin")} deps.admin
 * @param {string} deps.label  Log prefix (e.g. "scene_job", "preview_job").
 * @returns {(change: import('firebase-functions').Change<import('firebase-functions').firestore.QueryDocumentSnapshot>, ctx: any) => Promise<void>}
 */
function buildOnJobBatchProgress({ db, admin, label }) {
  return async (change, ctx) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    /** Doc deleted — we don't decrement counters on delete (deletes are rare + manual). */
    if (!after) return;

    const batchId = after.batchId || (before && before.batchId);
    if (!batchId || typeof batchId !== "string") return;

    const fromStatus = before ? before.status : null;
    const toStatus = after.status || null;
    /** Skip pure non-status writes (e.g. stageA progress fields without a status change). */
    if (fromStatus === toStatus) return;

    /**
     * On the CREATE write (before doesn't exist), the queued counter was
     * already initialized to total in createBatchAtomically. Don't double-
     * count by re-incrementing. Skip.
     */
    if (!before) return;

    const batchRef = db.collection("rp_batches").doc(batchId);
    const jobId = ctx && ctx.params ? ctx.params.jobId || change.after.id : change.after.id;
    try {
      await incrementBatchCounters({
        batchRef,
        fromStatus,
        toStatus,
        admin,
        falCostUsd:
          toStatus === "completed" && Number.isFinite(Number(after.falCostUsd))
            ? Number(after.falCostUsd)
            : null,
      });
      console.log(
        `[batch:${label}] job ${jobId} ${fromStatus} → ${toStatus} (batch=${batchId})`
      );
    } catch (err) {
      console.warn(
        `[batch:${label}] Failed to update batch ${batchId} for job ${jobId}:`,
        err && err.message ? err.message : err
      );
    }
  };
}

module.exports = { buildOnJobBatchProgress };
