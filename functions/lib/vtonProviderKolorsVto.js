"use strict";

/**
 * VTON provider: Kolors Virtual Try-On v1.5 (`fal-ai/kling/v1-5/kolors-virtual-try-on`).
 *
 * Architectural fit (why we added this in Phase B):
 *   - Kolors is fashion-tuned by Kling — built specifically for "swap garment
 *     on a model" instead of general-purpose inpainting. Quality on apparel is
 *     reportedly higher than Flux Fill for the same task at similar cost.
 *   - No mask required — Kolors derives the garment boundary from the input
 *     image itself. That's a big win for Rally: AI mask generation is the
 *     #2 cost line after realism, and Kolors removes that step entirely for
 *     the realism pass.
 *   - No prompt required — Kolors learns garment-on-body warping from training
 *     data, not text guidance. We don't have to maintain the v9 prompt
 *     tuning for this provider.
 *
 * Input contract:
 *   - human_image_url: the model photo (variant.images.modelFront/Back). Can be
 *     a public URL or data URL.
 *   - garment_image_url: a flat or semi-flat image of the garment that should
 *     be transferred to the human. For Rally that's the Stage A flat
 *     composite (the design rendered onto a flat product photo).
 *
 * What we pass:
 *   - human_image_url: `modelImageUrl` from ctx (variant model photo).
 *   - garment_image_url: data URL of the Stage A draftBuffer.
 *
 * Output:
 *   - Kolors returns a single image (the human wearing the new garment), same
 *     pose / background / lighting as the human input. No hybrid composite
 *     needed — Kolors handles color fidelity natively (color drift is
 *     reportedly minor compared to Flux Fill).
 *
 * Status: EXPERIMENTAL until A/B-validated on Rally's actual designs. Flag
 * set in capabilities.experimental so the UI shows a warning chip.
 */

const { runFalInference } = require("./falInference");
const { registerVtonProvider } = require("./vtonProviders");

const ENDPOINT = "fal-ai/kling/v1-5/kolors-virtual-try-on";
/** 80 attempts × 1500ms = 120s polling budget. Kolors usually completes in 20-40s. */
const MAX_POLL_ATTEMPTS = 80;
const POLL_INTERVAL_MS = 1500;

async function runVtonPass(ctx) {
  const { falApiKey, fetchFn, draftBuffer, modelImageUrl } = ctx;

  if (!modelImageUrl) {
    throw new Error(
      "kolors_vto provider requires modelImageUrl from variant.images.modelFront/Back. " +
        "This provider can only run on render targets that have a variant model photo."
    );
  }
  if (!draftBuffer) {
    throw new Error(
      "kolors_vto provider requires draftBuffer (the Stage A flat composite) as the garment image."
    );
  }

  const garmentDataUrl = `data:image/png;base64,${draftBuffer.toString("base64")}`;

  /**
   * Kolors VTO payload. Exact field names per fal.ai's endpoint spec —
   * snake_case, no extra knobs (no strength, no guidance, no seed). The
   * model is opinionated; tuning happens upstream by picking better garment
   * images, not via parameters here.
   */
  const falPayload = {
    human_image_url: modelImageUrl,
    garment_image_url: garmentDataUrl,
  };
  console.log(
    `[kolors_vto] endpoint=${ENDPOINT} human_url=${modelImageUrl.slice(0, 60)}... garment_bytes=${draftBuffer.length}`
  );

  const inference = await runFalInference({
    endpoint: ENDPOINT,
    payload: falPayload,
    falApiKey,
    fetchFn,
    maxPollAttempts: MAX_POLL_ATTEMPTS,
    pollIntervalMs: POLL_INTERVAL_MS,
    withLogs: true,
  });
  console.log(
    `[kolors_vto] runFalInference: cost=$${inference.costUsd ?? "?"} latency=${inference.latencyMs}ms request_id=${inference.requestId || "?"}`
  );

  /**
   * Kolors result shape (from fal.ai docs): `{ image: { url, width, height } }` —
   * a SINGLE image, not an array. Cover both inline and image-under-images[]
   * shapes since fal endpoints have occasionally been inconsistent here.
   */
  const result = inference.result;
  const singleImageUrl =
    (result.image && (result.image.url || result.image)) ||
    (Array.isArray(result.images) && result.images[0] && (result.images[0].url || result.images[0])) ||
    null;
  if (!singleImageUrl || typeof singleImageUrl !== "string") {
    throw new Error(
      `kolors_vto: no result image in response. Keys: ${JSON.stringify(Object.keys(result))}`
    );
  }

  const dlResp = await (fetchFn || fetch)(singleImageUrl);
  if (!dlResp.ok) {
    throw new Error(`kolors_vto: failed to download VTON image (HTTP ${dlResp.status})`);
  }
  const vtonBuffer = Buffer.from(await dlResp.arrayBuffer());

  /**
   * Kolors output is the FINAL realism PNG — no hybrid composite step.
   * The size may differ from draftBuffer (Kolors typically returns 768×1024
   * or similar). The trigger downstream resizes / re-encodes via Sharp before
   * saving, so passing through the raw bytes here is fine.
   */
  return {
    buffer: vtonBuffer,
    falCostUsd: inference.costUsd,
    falLatencyMs: inference.latencyMs,
    falEndpoint: inference.endpoint,
    falRequestId: inference.requestId,
    params: {
      providerId: "kolors_vto",
      modelImageUrl,
      garmentDraftBytes: draftBuffer.length,
    },
  };
}

registerVtonProvider({
  id: "kolors_vto",
  label: "Kolors VTO v1.5",
  description:
    "Fashion-tuned garment-on-body warping. No mask, no prompt — Kolors derives both from the input images. Best for showing how a flat garment looks worn on a model.",
  endpoint: ENDPOINT,
  capabilities: {
    requiresMask: false,
    requiresPrompt: false,
    requiresModelPhoto: true,
    producesHybridComposite: false,
    /** Until A/B-validated for Rally's screen-print look. UI shows warning. */
    experimental: true,
  },
  runVtonPass,
});

module.exports = { runVtonPass, ENDPOINT };
