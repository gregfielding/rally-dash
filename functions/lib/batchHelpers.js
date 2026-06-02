"use strict";

/**
 * Phase E — batch fan-out resilience helpers.
 *
 * Provides:
 *   - createBatchAtomically: writes a parent rp_batches doc + N child job docs
 *     in a single Firestore batch commit so partial fan-outs become impossible.
 *     Either every doc lands or none do.
 *   - incrementBatchCounters: called from progress triggers when a child job
 *     transitions. Uses FieldValue.increment so concurrent writes don't lose
 *     state (`processing → completed` from 8 workers in parallel all increment
 *     the same counter safely).
 *   - recomputeBatchStatus: rolls up the per-counter state into the batch's
 *     `status` enum ("running" → "completed"/"partial" once all terminal).
 *
 * Why this isn't Inngest: Rally's lifetime job volume (~12K) and one-operator
 * constraints don't justify the SaaS overhead. Firestore batched writes give
 * us atomic fan-out; FieldValue.increment gives us safe parallel counter
 * updates; per-endpoint semaphores give us concurrency limits. The migration
 * path to Inngest later is a swap of these internals, not a rewrite.
 */

/**
 * @typedef {Object} CreateBatchOptions
 * @property {FirebaseFirestore.Firestore} db
 * @property {typeof import("firebase-admin")} admin
 * @property {string} kind              One of RPBatchKind values.
 * @property {string} createdByUid      Owner of the batch (admin uid from context.auth).
 * @property {Object} [metadata]        Free-form metadata stamped on the batch doc.
 * @property {Array<{collectionPath: string, data: Object}>} jobs
 *                                       Each entry creates one child job doc. The
 *                                       trigger on `collectionPath` reads `batchId`
 *                                       from this data and routes progress updates.
 */

/**
 * Atomically create a batch parent + N child job docs.
 *
 * Returns `{batchId, jobRefs}` where jobRefs is an array of DocumentReference
 * objects (the same order as jobs[]) so the caller can read back the ids.
 *
 * The Firestore batch limit is 500 writes per commit. We assert jobs.length <= 499
 * (one slot reserved for the parent batch doc). For larger fan-outs split into
 * multiple batches — but Rally's batch callables already cap at 6 (scene) / 5
 * (VTON) / N variants (product realism, bounded by physical variants ≤ ~12),
 * so we shouldn't hit this limit organically.
 */
async function createBatchAtomically({
  db,
  admin,
  kind,
  createdByUid,
  metadata = {},
  jobs,
}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("createBatchAtomically: jobs[] must contain at least one entry");
  }
  if (jobs.length > 499) {
    throw new Error(
      `createBatchAtomically: ${jobs.length} jobs exceeds Firestore batch limit (max 499 children per parent). Split into multiple batches.`
    );
  }

  const batchRef = db.collection("rp_batches").doc();
  const writer = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  /** Parent batch doc — counters start at total/queued; everything else at 0. */
  writer.set(batchRef, {
    id: batchRef.id,
    kind,
    status: "queued",
    total: jobs.length,
    queued: jobs.length,
    processing: 0,
    completed: 0,
    failed: 0,
    metadata,
    falCostUsdTotal: 0,
    error: null,
    createdAt: now,
    createdByUid,
    updatedAt: now,
  });

  const jobRefs = [];
  for (const job of jobs) {
    const ref = db.collection(job.collectionPath).doc();
    /**
     * Inject `batchId` so the per-collection progress trigger can find the
     * parent batch doc by FieldPath.documentId() / direct ref lookup.
     */
    writer.set(ref, { ...job.data, batchId: batchRef.id });
    jobRefs.push(ref);
  }

  await writer.commit();
  return { batchId: batchRef.id, jobRefs };
}

/**
 * Apply a (from → to) status transition to the batch counters. Called from
 * the per-job progress trigger when status flips.
 *
 * Runs inside a Firestore transaction:
 *   - Read current counters
 *   - Compute the deltas DIRECTLY from fromStatus/toStatus (not from
 *     FieldValue.increment sentinels which can't be introspected reliably
 *     across firebase-admin versions)
 *   - Write the new absolute counter values + recomputed top-level status
 *
 * The transaction protects against two workers racing to update the same
 * batch — Firestore retries the transaction on conflict. For Rally's
 * batch sizes (≤ 6-12 jobs per fan-out) contention is negligible.
 *
 * @param {Object} params
 * @param {FirebaseFirestore.DocumentReference} params.batchRef
 * @param {string|null} params.fromStatus  Previous job status (null on create).
 * @param {string} params.toStatus         New job status.
 * @param {typeof import("firebase-admin")} params.admin
 * @param {number|null} [params.falCostUsd]  Cost to add to running total (only on completed).
 */
async function incrementBatchCounters({ batchRef, fromStatus, toStatus, admin, falCostUsd }) {
  const decKey = bucketKeyForStatus(fromStatus);
  const incKey = bucketKeyForStatus(toStatus);
  /** No-op if the transition doesn't move any counter (e.g. unknown→unknown). */
  if (!decKey && !incKey) return;

  await batchRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(batchRef);
    if (!snap.exists) return; // Batch was deleted; trigger is a no-op.
    const current = snap.data() || {};
    const counts = {
      queued: Number.isFinite(current.queued) ? current.queued : 0,
      processing: Number.isFinite(current.processing) ? current.processing : 0,
      completed: Number.isFinite(current.completed) ? current.completed : 0,
      failed: Number.isFinite(current.failed) ? current.failed : 0,
    };
    if (decKey && decKey !== incKey) counts[decKey] = clamp(counts[decKey] - 1);
    if (incKey && incKey !== decKey) counts[incKey] = clamp(counts[incKey] + 1);

    const total = Number.isFinite(current.total) ? current.total : 0;
    const terminal = counts.completed + counts.failed;
    let status = current.status;
    if (counts.processing === 0 && terminal === 0) status = "queued";
    else if (terminal < total) status = "running";
    else if (counts.failed === 0) status = "completed";
    else status = "partial";

    const updates = {
      ...counts,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    /** Stamp running cost total on successful completion. */
    if (
      toStatus === "completed" &&
      Number.isFinite(Number(falCostUsd)) &&
      Number(falCostUsd) > 0
    ) {
      const prevCost = Number.isFinite(current.falCostUsdTotal) ? current.falCostUsdTotal : 0;
      updates.falCostUsdTotal = Math.round((prevCost + Number(falCostUsd)) * 10000) / 10000;
    }
    tx.update(batchRef, updates);
  });
}

/**
 * Map a job status to the corresponding batch counter field. Returns null
 * for unknown statuses so the transaction is a no-op rather than polluting
 * a random field.
 */
function bucketKeyForStatus(status) {
  switch (status) {
    case "queued":
      return "queued";
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

function clamp(n) {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @typedef {Object} ConcurrencyLimiter
 * @property {(fn: () => Promise<T>) => Promise<T>} run
 *           Run `fn` with the limiter holding a slot; queues if at capacity.
 * @property {() => {active: number, queued: number, capacity: number}} stats
 */

/**
 * Simple in-memory semaphore for concurrency control on a single function
 * instance. fal.ai (and Shopify) impose per-endpoint rate limits; firing 50
 * parallel calls from a batch fan-out triggers 429s and partial failures.
 * Per-endpoint defaults below are conservative — increase only after
 * measuring real throughput on a deployed instance.
 *
 * Caveat: this is PER FUNCTION INSTANCE, not global. Firebase Functions
 * scales horizontally — if 5 instances are warm, you'll see up to 5×capacity
 * concurrent calls. For Rally's scale (one operator clicking buttons
 * sequentially) this is fine in practice. A truly global limit would
 * require Cloud Tasks + queue depth, which is the Inngest migration path.
 */
function createConcurrencyLimiter(capacity) {
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new Error(`createConcurrencyLimiter: capacity must be >= 1, got ${capacity}`);
  }
  let active = 0;
  const queue = [];

  async function run(fn) {
    if (active >= capacity) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  }

  return {
    run,
    stats: () => ({ active, queued: queue.length, capacity }),
  };
}

/**
 * Per-endpoint limiters for runFalInference. Tuned to fal.ai's default
 * rate limits (rule of thumb: 8 concurrent for cheap models, 4 for premium).
 * Add new endpoints as providers are registered; unknown endpoints fall
 * through to `default` (no concurrency cap — same behavior as pre-E4).
 */
const FAL_ENDPOINT_LIMITERS = {
  "fal-ai/evf-sam": createConcurrencyLimiter(8),
  "fal-ai/flux-pro/v1/fill": createConcurrencyLimiter(4),
  "fal-ai/flux-pro/kontext": createConcurrencyLimiter(4),
  "fal-ai/kling/v1-5/kolors-virtual-try-on": createConcurrencyLimiter(4),
  "fal-ai/flux-2-lora-gallery/virtual-tryon": createConcurrencyLimiter(4),
  "fal-ai/flux-lora": createConcurrencyLimiter(4),
};

/**
 * Wrap a thunk in the appropriate per-endpoint limiter. Returns the thunk
 * unchanged if no limiter exists for the endpoint (so unknown endpoints
 * don't fail; they just run unlimited until added to the table).
 */
async function withEndpointLimit(endpoint, fn) {
  const limiter = FAL_ENDPOINT_LIMITERS[endpoint];
  if (!limiter) return fn();
  return limiter.run(fn);
}

function getEndpointLimiterStats() {
  return Object.fromEntries(
    Object.entries(FAL_ENDPOINT_LIMITERS).map(([endpoint, l]) => [endpoint, l.stats()])
  );
}

module.exports = {
  createBatchAtomically,
  incrementBatchCounters,
  createConcurrencyLimiter,
  withEndpointLimit,
  getEndpointLimiterStats,
  FAL_ENDPOINT_LIMITERS,
};
