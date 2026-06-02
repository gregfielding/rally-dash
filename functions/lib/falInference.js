"use strict";

/**
 * Single seam for every fal.ai callsite. Encapsulates:
 *   - Submit POST to queue.fal.run/{endpoint}
 *   - Polling status_url until completion (or timeout)
 *   - Extracting the inline result (some endpoints return result in the status
 *     payload; others require a separate fetch of the response_url)
 *   - Stamping cost (looked up from endpoint price table) + latency
 *
 * Why this matters (Phase A):
 *   - Cost meter: every job doc gets `falCostUsd / falEndpoint / falLatencyMs`,
 *     visible in the dashboard widget for per-day / per-blank / per-team spend.
 *   - Provider swap (Phase B): VTON A/B between Flux Fill, Kolors VTO, FLUX VTO
 *     becomes "register three endpoints in the price table + thread provider
 *     selection into the callsite." No new HTTP code to write.
 *   - Future Inngest migration (Phase E): one place to wrap calls in
 *     `step.run()` for retry/observability.
 *
 * Pricing data sources (verified 2026-06-01):
 *   - fal.ai endpoint pages: https://fal.ai/models/<slug>
 *   - Cross-checked against deep-research workflow report (wf_61156498-ca5)
 *   - Update freely as fal.ai changes prices; out-of-date numbers cost
 *     money but don't break renders.
 */

/**
 * @typedef {Object} FalPriceEntry
 * @property {number} costUsd       Cost per successful call in USD.
 * @property {string} notes         Free-text note for operators (audit trail).
 */

/** @type {Record<string, FalPriceEntry>} */
const FAL_ENDPOINT_PRICING = {
  /** Flux Fill — Rally's current Stage B realism pass. Per-call inpaint. */
  "fal-ai/flux-pro/v1/fill": {
    costUsd: 0.05,
    notes: "Flux Pro Fill inpainting (current realism)",
  },
  /** EVF-SAM — Rally's current mask generator. Cheap segmentation. */
  "fal-ai/evf-sam": {
    costUsd: 0.005,
    notes: "EVF-SAM text-prompted segmentation",
  },
  /** Phase B target: Kolors Virtual Try-On v1.5. Fashion-tuned. */
  "fal-ai/kling/v1-5/kolors-virtual-try-on": {
    costUsd: 0.07,
    notes: "Kolors VTO v1.5 — fashion-tuned VTON",
  },
  /** Phase B target: FLUX 2 Virtual Try-On (BFL, May 2026). */
  "fal-ai/flux-2-lora-gallery/virtual-tryon": {
    costUsd: 0.07,
    notes: "FLUX 2 Virtual Try-On (estimate; verify after first call)",
  },
  /** Phase C target: FLUX.1 Kontext for product photography + scene sets. */
  "fal-ai/flux-pro/kontext": {
    costUsd: 0.04,
    notes: "FLUX.1 Kontext [pro] — iterative image editing",
  },
  /**
   * Phase I target: Flux 2 Pro edit (multi-reference). Vendor positions this
   * as the identity-preservation replacement for per-character LoRA training
   * — accepts up to 9-10 reference images per generation natively. Rally
   * uses it as the primary path for "Amber wearing X" via her referenceImages
   * stack. Pricing estimate is mid-range between Flux Pro and Kontext;
   * verify against an actual successful call and update.
   */
  "fal-ai/flux-2-pro/edit": {
    costUsd: 0.06,
    notes: "Flux 2 Pro edit — multi-reference identity + edit (Phase I primary)",
  },
  /** Legacy Flux endpoints kept for historical job-doc readers. */
  "fal-ai/flux-lora": {
    costUsd: 0.035,
    notes: "Flux LoRA generation (legacy product asset path)",
  },
};

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_MAX_POLL_ATTEMPTS = 30;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Look up endpoint pricing. Returns null + warns when the endpoint is unknown
 * so the call still succeeds — Rally doesn't want a missing-price-table entry
 * to block a render. Cost meter just shows "—" for those rows until the table
 * gets updated.
 */
function lookupFalCostUsd(endpoint) {
  const entry = FAL_ENDPOINT_PRICING[endpoint];
  if (!entry) {
    console.warn(
      `[falInference] No price table entry for endpoint "${endpoint}" — cost will be null. Add it to FAL_ENDPOINT_PRICING in functions/lib/falInference.js.`
    );
    return null;
  }
  return entry.costUsd;
}

/**
 * Submit a job to fal.ai's queue, poll until completion, return the raw result.
 *
 * Different endpoints return results in different shapes (some inline in the
 * submit response, some require fetching response_url, some have `images[]`
 * embedded in the status payload). This wrapper returns the full result JSON
 * and lets the caller extract what they need — no shape coupling at this layer.
 *
 * @param {Object} params
 * @param {string} params.endpoint            fal.ai model slug (e.g. "fal-ai/evf-sam")
 * @param {Object} params.payload             Request body sent to the submit endpoint
 * @param {string} params.falApiKey           From `process.env.FAL_API_KEY` or config
 * @param {typeof fetch} [params.fetchFn]     Override fetch (testing). Default: global fetch.
 * @param {number} [params.maxPollAttempts]   Default 30
 * @param {number} [params.pollIntervalMs]    Default 2000
 * @param {boolean} [params.withLogs]         Append `?logs=1` to status polls (useful for debug)
 * @param {AbortSignal} [params.signal]       Caller-driven cancellation
 *
 * @returns {Promise<{
 *   result: any,
 *   costUsd: number | null,
 *   latencyMs: number,
 *   endpoint: string,
 *   requestId: string | null,
 * }>}
 */
async function runFalInference(params) {
  const {
    endpoint,
    payload,
    falApiKey,
    fetchFn,
    maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    withLogs = false,
    signal,
  } = params;
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error("runFalInference: endpoint is required");
  }
  if (!falApiKey) {
    throw new Error("runFalInference: falApiKey is required (set FAL_API_KEY)");
  }
  /**
   * Phase E: per-endpoint concurrency limiting. Wraps the actual HTTP work
   * in a semaphore so a 50-template fan-out from a single function instance
   * doesn't fire 50 parallel fal.ai calls. Per-endpoint caps live in
   * batchHelpers.js (FAL_ENDPOINT_LIMITERS). Unknown endpoints pass through
   * unbounded — same behavior as pre-E4.
   *
   * Lazy-require to avoid circular dep risk between falInference and
   * batchHelpers (batchHelpers doesn't import falInference today, but the
   * lazy require keeps it safe for future additions).
   */
  // eslint-disable-next-line global-require
  const { withEndpointLimit } = require("./batchHelpers");
  return withEndpointLimit(endpoint, () =>
    runFalInferenceUnlimited({
      endpoint,
      payload,
      falApiKey,
      fetchFn,
      maxPollAttempts,
      pollIntervalMs,
      withLogs,
      signal,
    })
  );
}

/** Inner implementation — separated so the limiter wrapper is one tight indirection. */
async function runFalInferenceUnlimited(params) {
  const {
    endpoint,
    payload,
    falApiKey,
    fetchFn,
    maxPollAttempts,
    pollIntervalMs,
    withLogs,
    signal,
  } = params;
  const _fetch = fetchFn || fetch;
  const startedAtMs = Date.now();
  const url = `${FAL_QUEUE_BASE}/${endpoint}`;

  /** Submit. */
  const submitResp = await _fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${falApiKey}` },
    body: JSON.stringify(payload),
    signal,
  });
  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => "<no body>");
    throw new Error(`fal.ai submit failed (${submitResp.status}) for ${endpoint}: ${errText}`);
  }
  const submitJson = await submitResp.json();
  const requestId = submitJson.request_id || submitJson.id || null;

  /**
   * Some endpoints (e.g. Flux Fill) embed `images[]` in the submit response when
   * inference completes within the synchronous window. Only short-circuit when
   * the inline result is actually present — bare `{status:"COMPLETED"}` falls
   * through to the polling path so we can fetch response_url.
   */
  if (hasInlineResult(submitJson)) {
    const latencyMs = Date.now() - startedAtMs;
    return {
      result: submitJson,
      costUsd: lookupFalCostUsd(endpoint),
      latencyMs,
      endpoint,
      requestId,
    };
  }

  const statusUrl = submitJson.status_url || (requestId ? `${url}/requests/${requestId}/status` : null);
  const responseUrl = submitJson.response_url || (requestId ? `${url}/requests/${requestId}` : null);
  if (!statusUrl) {
    throw new Error(
      `fal.ai submit returned no status_url for ${endpoint} (request_id=${requestId || "missing"})`
    );
  }
  const statusUrlWithLogs = withLogs
    ? statusUrl.includes("?")
      ? `${statusUrl}&logs=1`
      : `${statusUrl}?logs=1`
    : statusUrl;

  /** Poll. */
  for (let i = 0; i < maxPollAttempts; i++) {
    if (signal && signal.aborted) {
      throw new Error(`fal.ai poll aborted by caller (${endpoint}, request_id=${requestId})`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const statusResp = await _fetch(statusUrlWithLogs, {
      headers: { Authorization: `Key ${falApiKey}` },
      signal,
    });
    if (!statusResp.ok) continue; // transient — keep polling
    const statusJson = await statusResp.json();
    if (statusJson.status === "FAILED") {
      throw new Error(`fal.ai job FAILED (${endpoint}): ${statusJson.error || "unknown error"}`);
    }
    /**
     * Order matters here:
     *   1. status=COMPLETED + no inline result → must fetch response_url
     *      (the status payload doesn't carry images for these endpoints).
     *   2. Otherwise, if the status payload itself has inline result fields
     *      (images / masks / image), return it directly without the extra round-trip.
     */
    if (statusJson.status === "COMPLETED" && !hasInlineResult(statusJson) && responseUrl) {
      const finalResp = await _fetch(responseUrl, {
        headers: { Authorization: `Key ${falApiKey}` },
        signal,
      });
      if (!finalResp.ok) {
        throw new Error(`fal.ai result fetch failed (${finalResp.status}) for ${endpoint}`);
      }
      const result = await finalResp.json();
      const latencyMs = Date.now() - startedAtMs;
      return {
        result,
        costUsd: lookupFalCostUsd(endpoint),
        latencyMs,
        endpoint,
        requestId,
      };
    }
    if (hasInlineResult(statusJson)) {
      const latencyMs = Date.now() - startedAtMs;
      return {
        result: statusJson,
        costUsd: lookupFalCostUsd(endpoint),
        latencyMs,
        endpoint,
        requestId,
      };
    }
  }

  throw new Error(
    `fal.ai poll timeout for ${endpoint} (request_id=${requestId}) after ${maxPollAttempts} attempts × ${pollIntervalMs}ms`
  );
}

/**
 * Heuristic: does this payload carry an actual inline result (not just a
 * status marker)? Distinct from `status === "COMPLETED"` — the bare status
 * marker without payload means "go fetch response_url," not "we're done."
 *
 * Different fal.ai endpoints embed results under different keys:
 *   - Flux Fill / SAM: `images: [{url, ...}]`
 *   - Some queue endpoints: `output.images: [...]`
 *   - Image-edit endpoints: `image: {url}` (singular)
 *   - SAM variants: `masks: [...]`
 *
 * Keep adding shapes here as new endpoints get integrated.
 */
function hasInlineResult(json) {
  if (!json || typeof json !== "object") return false;
  if (Array.isArray(json.images) && json.images.length > 0) return true;
  if (json.output && Array.isArray(json.output.images) && json.output.images.length > 0) return true;
  if (json.image && (json.image.url || typeof json.image === "string")) return true;
  if (Array.isArray(json.masks) && json.masks.length > 0) return true;
  return false;
}

/**
 * Convenience: stamp the cost/latency/endpoint/requestId fields onto a job doc.
 * Use this from callsites that hold a job doc reference — keeps the field
 * shape consistent across rp_blank_preview_jobs / rp_generation_jobs / future
 * job collections.
 *
 * @param {FirebaseFirestore.DocumentReference} jobRef
 * @param {{costUsd: number|null, latencyMs: number, endpoint: string, requestId: string|null}} inferenceResult
 * @param {typeof import("firebase-admin")} admin
 */
async function stampInferenceCostOnJob(jobRef, inferenceResult, admin) {
  try {
    await jobRef.update({
      falCostUsd: inferenceResult.costUsd,
      falEndpoint: inferenceResult.endpoint,
      falLatencyMs: inferenceResult.latencyMs,
      falRequestId: inferenceResult.requestId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (writeErr) {
    /** Best-effort stamping — never fail the job for telemetry. */
    console.warn(
      `[falInference] Failed to stamp cost on ${jobRef.path}: ${writeErr && writeErr.message ? writeErr.message : writeErr}`
    );
  }
}

module.exports = {
  runFalInference,
  stampInferenceCostOnJob,
  lookupFalCostUsd,
  FAL_ENDPOINT_PRICING,
  FAL_QUEUE_BASE,
};
