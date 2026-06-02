"use strict";

/**
 * VTON provider: Flux 2 Pro edit with multi-reference identity preservation
 * (`fal-ai/flux-2-pro/edit`).
 *
 * Strategic context (Phase I, 2026-06-01 — post deep-research recalibration):
 * Black Forest Labs' Flux 2 ships native multi-reference conditioning (up to
 * 9-10 reference images per generation) marketed as "best character / product
 * / style consistency available today." Vendor positions it as a REPLACEMENT
 * for training per-character LoRAs, not a complement — at inference time, a
 * 4-image reference set drives identity consistency without ever running a
 * training step.
 *
 * For Rally: an identity ("Amber") supplies her reference photos
 * (face_front, face_3q, body_full, body_3q) and this provider threads them
 * into the Flux 2 edit call alongside the Stage A draft. Result: a single
 * inference call that produces "Amber wearing this design in this pose"
 * with both identity AND garment fidelity in one pass — collapsing the
 * Phase B Kolors VTO / Flux Fill garment-swap step into the identity step.
 *
 * When NOT to use this provider:
 *   - Identity has fewer than 2 reference images (Flux 2 falls back to
 *     prompt-only conditioning and drift increases dramatically).
 *   - The render target needs Rally's tuned v10 hybrid color composite
 *     (Flux Fill provider is still the better choice for screen-print
 *     color fidelity on plain garments).
 *
 * Caveat for operators: Flux 2 multi-reference consistency at thousands-of-
 * generations scale is VENDOR-CLAIMED, not independently benchmarked. Treat
 * the first 50-100 outputs as a calibration sample before fanning out to the
 * full catalog. The A/B harness (Phase B4) lets you compare this against
 * flux_fill + kolors_vto on the same Stage A input.
 */

const { runFalInference } = require("./falInference");
const { registerVtonProvider } = require("./vtonProviders");

const ENDPOINT = "fal-ai/flux-2-pro/edit";
/** 60 attempts × 1500ms = 90s polling budget. Flux 2 edits typically complete in 15-30s. */
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1500;

/** Flux 2's documented input cap. We send up to this many references; the
 *  inference layer is expected to use whatever subset gives best identity. */
const MAX_REFERENCE_IMAGES = 9;

async function runVtonPass(ctx) {
  const {
    falApiKey,
    fetchFn,
    draftBuffer,
    /**
     * Phase I: identity.referenceImages[] threaded by composeStageB when the
     * target identity has mode="reference_images" or "hybrid". URLs are
     * publicly fetchable (Storage download tokens) so fal.ai can pull them.
     */
    referenceImageUrls,
    /** Prompt threaded from the trigger — usually the design + scene + Amber's
     *  persona text. Optional; Flux 2 can edit from references alone. */
    editPrompt,
  } = ctx;

  if (!draftBuffer) {
    throw new Error(
      "flux_2_multireference: draftBuffer is required (the Stage A composite serves as the edit target)"
    );
  }
  const refs = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((u) => typeof u === "string" && u.length > 0)
    : [];
  if (refs.length === 0) {
    throw new Error(
      "flux_2_multireference: at least 1 referenceImageUrl is required — without references, " +
        "Flux 2 falls back to prompt-only conditioning and identity drift increases dramatically. " +
        "Upload reference photos via /lora/identities/{id}/references before using this provider."
    );
  }
  const sentRefs = refs.slice(0, MAX_REFERENCE_IMAGES);
  if (refs.length > MAX_REFERENCE_IMAGES) {
    console.warn(
      `[flux_2_multireference] ${refs.length} references provided, ${MAX_REFERENCE_IMAGES} max — sending first ${MAX_REFERENCE_IMAGES}.`
    );
  }

  const draftDataUrl = `data:image/png;base64,${draftBuffer.toString("base64")}`;

  /**
   * Flux 2 edit payload. The exact field name for reference URLs is taken
   * from fal.ai's Flux 2 developer guide ("image_urls" array). The `prompt`
   * carries the edit instruction. We pass an empty negative_prompt — Flux 2
   * documentation doesn't surface a separate field, the prompt itself is
   * directive.
   */
  const falPayload = {
    /** The Stage A draft is the image being edited. */
    image_url: draftDataUrl,
    /** Identity references — drive character consistency. */
    image_urls: sentRefs,
    /** Edit prompt. Description of "what should the final image show" — Flux
     *  2 multi-reference excels when the prompt names the role of each
     *  reference, e.g. "the person from reference image 1 wearing the
     *  garment from reference image 2." For Rally's use case the references
     *  are all identity shots, so the prompt focuses on garment + scene. */
    prompt:
      typeof editPrompt === "string" && editPrompt.length > 0
        ? editPrompt
        : "Preserve the identity (face, hair, body proportions, skin tone) from the reference images. Keep the garment, screen-print design, and background of the edit-target image. Photorealistic studio lighting, no stylization.",
  };
  console.log(
    `[flux_2_multireference] endpoint=${ENDPOINT} refs=${sentRefs.length}/${refs.length} draft_bytes=${draftBuffer.length}`
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
    `[flux_2_multireference] cost=$${inference.costUsd ?? "?"} latency=${inference.latencyMs}ms request_id=${inference.requestId || "?"}`
  );

  /**
   * Flux 2 edit result shape: { images: [{ url, width, height }] } per fal.ai
   * docs. Cover both inline and singular shapes defensively.
   */
  const result = inference.result;
  const resultImages =
    result.images ||
    (result.output && result.output.images) ||
    (result.image ? [result.image] : []);
  if (!Array.isArray(resultImages) || resultImages.length === 0) {
    throw new Error(
      `flux_2_multireference: no result images. Response keys: ${JSON.stringify(Object.keys(result))}`
    );
  }
  const resultUrl =
    typeof resultImages[0] === "string" ? resultImages[0] : resultImages[0].url;
  if (!resultUrl) throw new Error("flux_2_multireference: result image missing URL");

  const dlResp = await (fetchFn || fetch)(resultUrl);
  if (!dlResp.ok) {
    throw new Error(`flux_2_multireference: download failed (HTTP ${dlResp.status})`);
  }
  const finalBuffer = Buffer.from(await dlResp.arrayBuffer());

  /**
   * Unlike Flux Fill's v10 hybrid composite, Flux 2 outputs are used DIRECTLY
   * as the final realism PNG. Flux 2's color fidelity is reportedly stronger
   * than Flux Fill's, so the Stage-A-color-preservation post-composite would
   * actually hurt here (it would mute the model's faithful rendering). If
   * empirical results show color drift, add a per-provider opt-in to enable
   * the hybrid composite for this provider too.
   */
  return {
    buffer: finalBuffer,
    falCostUsd: inference.costUsd,
    falLatencyMs: inference.latencyMs,
    falEndpoint: inference.endpoint,
    falRequestId: inference.requestId,
    params: {
      providerId: "flux_2_multireference",
      referenceImageCount: sentRefs.length,
      maxReferences: MAX_REFERENCE_IMAGES,
    },
  };
}

registerVtonProvider({
  id: "flux_2_multireference",
  label: "Flux 2 multi-reference",
  description:
    "Identity-preserving image edit via 4-9 reference photos of the model. No training step — references thread through Flux 2's native multi-reference conditioning. Marketed by Black Forest Labs as the LoRA-replacement for character consistency.",
  endpoint: ENDPOINT,
  capabilities: {
    requiresMask: false,
    requiresPrompt: false,
    requiresModelPhoto: false,
    /** This is the differentiator: requires identity references (NOT a model photo). */
    requiresIdentityReferences: true,
    producesHybridComposite: false,
    /** Flagged experimental until A/B-validated for Rally's screen-print look. */
    experimental: true,
  },
  runVtonPass,
});

module.exports = { runVtonPass, ENDPOINT, MAX_REFERENCE_IMAGES };
