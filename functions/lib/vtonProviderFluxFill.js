"use strict";

/**
 * VTON provider: Flux Fill (`fal-ai/flux-pro/v1/fill`).
 *
 * This is Rally's incumbent realism path — extracted verbatim from
 * `blankPreviewRender.runRealismPass` so the behavior is byte-identical to
 * pre-refactor. DO NOT tune the prompt or composite math here without a
 * corresponding test or visual A/B; the v9 prompt + v10 hybrid composite
 * came out of ~10 rounds of empirical iteration documented in the original
 * file's block comments.
 *
 * Architecture: Flux Fill regenerates the mask region from prompt alone —
 * it ignores input pixels INSIDE the mask. That has two consequences:
 *   1. The prompt must carry the entire color directive (we inject ink
 *      colors from `designColors`) and the texture spec (we inject slider
 *      state via fabricPhrase / strengthPhrase).
 *   2. The output color drifts toward gray / muted browns no matter how
 *      hard we push the prompt. We work around this with the v10 hybrid
 *      composite: take Stage A's vivid pixels for the COLOR channel, take
 *      Flux Fill's regenerated pixels for the TEXTURE.
 */

const { runFalInference } = require("./falInference");
const { registerVtonProvider } = require("./vtonProviders");
const { hexToColorName } = require("./hexToColorName");

const ENDPOINT = "fal-ai/flux-pro/v1/fill";
const REALISM_MAX_POLL_ATTEMPTS = 90;
const REALISM_POLL_INTERVAL_MS = 1500;
const PRE_KONTEXT_BLUR_SIGMA = 0; // telemetry-only since v8

/**
 * v10 negative prompt — kept verbatim from runRealismPass. Tuned to push Flux
 * Fill off its "preserve input" bias toward sticker / decal output.
 */
const REALISM_NEGATIVE =
  "opaque ink coverage, solid uniform color fill, ink fully covering fabric texture, painted-on look, flat ink, ink sitting on top of fabric, no fabric texture showing through, vinyl sticker, decal, iron-on patch, heat transfer, plastisol ink, glossy ink, plastic sheen, shiny print, wet appearance, raised 3D print, embossed, peeling edges, lifted corners, hard die-cut edges, sharp rectangular boundary around print, change text, misspell text, add words, redraw artwork, change garment color, change garment shape, change background, blurry, low-quality, artifacts";

async function runVtonPass(ctx) {
  const {
    sharp,
    falApiKey,
    fetchFn,
    blankId,
    view,
    draftBuffer,
    letterMaskBuffer,
    designColors,
    fabricFeel,
    printStrength,
  } = ctx;

  if (!letterMaskBuffer) {
    throw new Error(
      "flux_fill provider requires letterMaskBuffer from Stage A but it was not provided"
    );
  }

  const ff = Number.isFinite(Number(fabricFeel))
    ? Math.max(0, Math.min(1, Number(fabricFeel)))
    : 0.5;
  const ps = Number.isFinite(Number(printStrength))
    ? Math.max(0, Math.min(1, Number(printStrength)))
    : 0.7;

  const draftDataUrl = `data:image/png;base64,${draftBuffer.toString("base64")}`;
  const maskDataUrl = `data:image/png;base64,${letterMaskBuffer.toString("base64")}`;

  /**
   * v9 slider→prompt mapping. Fabric feel controls weave-through visibility;
   * print strength controls ink vividness. No "vintage/worn/washed" language
   * at any band — the target is fresh screen-print, not a thrift-store look.
   */
  const fabricPhrase =
    ff >= 0.7
      ? "the cotton weave texture is clearly visible through the ink coverage, with pronounced fiber-level mottling and small micro-gaps where individual weave threads break up the ink"
      : ff >= 0.4
        ? "the cotton weave texture is visible through the ink coverage with light fiber-level mottling, and softly imperfect edges where the ink meets the fabric fibers"
        : "subtle cotton fiber texture is visible at the print edges and surface, with mostly clean ink coverage and slightly soft (NOT hard die-cut) boundaries";
  const strengthPhrase =
    ps >= 0.7
      ? "vivid, bold, fully-saturated ink coverage like a freshly-printed garment — colors are at full intensity, matte but NEVER glossy or plastic"
      : ps >= 0.4
        ? "vivid screen-print saturation at natural intensity — fresh, clearly legible, fully-pigmented ink (NOT faded, NOT washed-out, NOT vintage)"
        : "slightly faded screen-print saturation, like a print washed a few times — still legible and clearly coloured, but a touch less vivid than fresh";

  /** v8.1: explicit ink color injection. Flux Fill regenerates the masked region from prompt alone. */
  const colorList = Array.isArray(designColors)
    ? designColors
        .map((c) => {
          const hex = c && typeof c.hex === "string" ? c.hex : null;
          const name = hexToColorName(hex);
          if (!hex || !name) return null;
          return `${name} (${hex})`;
        })
        .filter(Boolean)
    : [];
  const hasWhite = colorList.some((c) => c.startsWith("white"));
  const whiteEmphasis = hasWhite
    ? " The white ink MUST stay pure bright white — never gray, never beige, never muted."
    : "";
  const colorClause =
    colorList.length > 0
      ? `The print MUST be rendered in these EXACT screen-printing ink colors: ${colorList.join(" and ")}. The ink colors stay vivid and at full saturation.${whiteEmphasis} `
      : "";
  console.log(
    `[flux_fill] v8.1 prompt colors: ${colorList.join(", ") || "(none detected, prompt will not specify)"}`
  );

  const dynamicPrompt =
    `A photorealistic studio product photo of a black cotton fleece crewneck sweatshirt with a water-based SCREEN-PRINTED design on the chest. ${colorClause}The ink has been pressed INTO the cotton fabric using a silkscreen process — it is NEVER a sticker, NEVER a decal, NEVER vinyl, NEVER iron-on, NEVER plastic, NEVER raised 3D. The ink finish is matte and fibrous, sitting WITH the cotton fibers, not on top. CRITICAL TEXTURE: ${fabricPhrase}. CRITICAL SATURATION: ${strengthPhrase}. Color saturation varies subtly across the print like real screen-printing on heavy cotton. The print drapes and follows every fold of the fabric naturally. Preserve the EXACT text spelling, layout, position, scale, colors, and overall geometry of the existing design — do not redraw or rearrange letters, do not add or remove words. The garment color, shape, lighting, and background must remain identical to the input photo.`;

  /**
   * v8.2 deterministic seed: same {blankId, view, ff, ps} → same Flux Fill seed
   * → same output. Without this, re-runs vary wildly (muted vs vivid, gray vs
   * white). Empirically confirmed: two consecutive clicks produced
   * meaningfully different results before seed locking.
   */
  const seedInput = `${blankId}|${view}|ff:${ff.toFixed(3)}|ps:${ps.toFixed(3)}`;
  let seedHash = 0;
  for (let i = 0; i < seedInput.length; i++) {
    seedHash = (seedHash << 5) - seedHash + seedInput.charCodeAt(i);
    seedHash |= 0;
  }
  const stableSeed = Math.abs(seedHash) % 1000000;

  const falPayload = {
    image_url: draftDataUrl,
    mask_url: maskDataUrl,
    prompt: dynamicPrompt,
    negative_prompt: REALISM_NEGATIVE,
    /** v9: 5.0 cfg — pushes Flux Fill to honor the color clause without oversaturating. */
    guidance_scale: 5.0,
    num_inference_steps: 28,
    seed: stableSeed,
  };
  console.log(
    `[flux_fill] endpoint=${ENDPOINT} cfg=${falPayload.guidance_scale} steps=${falPayload.num_inference_steps} seed=${stableSeed} draft_bytes=${draftBuffer.length}`
  );

  const inference = await runFalInference({
    endpoint: ENDPOINT,
    payload: falPayload,
    falApiKey,
    fetchFn,
    maxPollAttempts: REALISM_MAX_POLL_ATTEMPTS,
    pollIntervalMs: REALISM_POLL_INTERVAL_MS,
    withLogs: true,
  });
  console.log(
    `[flux_fill] runFalInference: cost=$${inference.costUsd ?? "?"} latency=${inference.latencyMs}ms request_id=${inference.requestId || "?"}`
  );

  const resultImages =
    inference.result.images ||
    (inference.result.output && inference.result.output.images) ||
    [];
  if (!Array.isArray(resultImages) || resultImages.length === 0) {
    throw new Error(
      `flux_fill: fal.ai returned no realism images. Response keys: ${JSON.stringify(Object.keys(inference.result))}`
    );
  }
  const resultUrl =
    typeof resultImages[0] === "string" ? resultImages[0] : resultImages[0].url;
  if (!resultUrl) throw new Error("flux_fill: fal.ai realism result missing image URL");

  const dlResp = await (fetchFn || fetch)(resultUrl);
  if (!dlResp.ok) {
    throw new Error(`flux_fill: failed to download realism image (HTTP ${dlResp.status})`);
  }
  const fluxFillBuffer = Buffer.from(await dlResp.arrayBuffer());

  /**
   * v10 HYBRID COMPOSITE — preserve Stage A vivid colors, take Flux Fill's
   * texture only. See blankPreviewRender.js line ~620 for the iteration story.
   *
   * Blend rule per pixel inside the mask:
   *   final = stageA·(1-α) + fluxFill·α
   *
   * α scales with fabric feel: more "worn" → more AI texture pulled through.
   * Outside the mask is byte-identical Stage A (garment untouched).
   */
  const stageADims = await sharp(draftBuffer).metadata();
  const fluxResized = await sharp(fluxFillBuffer)
    .resize(stageADims.width, stageADims.height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskResized = await sharp(letterMaskBuffer)
    .resize(stageADims.width, stageADims.height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stageARgb = await sharp(draftBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const fluxChannels = fluxResized.info.channels;
  const stageAChannels = stageARgb.info.channels;
  const numPixels = fluxResized.info.width * fluxResized.info.height;

  const blendAlpha = ff >= 0.7 ? 0.55 : ff >= 0.4 ? 0.35 : 0.2;
  const inv = 1 - blendAlpha;

  const hybridWithMaskAlpha = Buffer.alloc(numPixels * 4);
  for (let p = 0; p < numPixels; p++) {
    const sa = p * stageAChannels;
    const fx = p * fluxChannels;
    hybridWithMaskAlpha[p * 4] = Math.round(stageARgb.data[sa] * inv + fluxResized.data[fx] * blendAlpha);
    hybridWithMaskAlpha[p * 4 + 1] = Math.round(
      stageARgb.data[sa + 1] * inv + fluxResized.data[fx + 1] * blendAlpha
    );
    hybridWithMaskAlpha[p * 4 + 2] = Math.round(
      stageARgb.data[sa + 2] * inv + fluxResized.data[fx + 2] * blendAlpha
    );
    hybridWithMaskAlpha[p * 4 + 3] = maskResized.data[p];
  }

  const realismBuffer = await sharp(draftBuffer)
    .composite([
      {
        input: hybridWithMaskAlpha,
        raw: { width: fluxResized.info.width, height: fluxResized.info.height, channels: 4 },
        blend: "over",
      },
    ])
    .png()
    .toBuffer();

  console.log(
    `[flux_fill] v10 hybrid composite: stageA=${stageADims.width}x${stageADims.height} blendAlpha=${blendAlpha} (ff=${ff.toFixed(2)}) → final=${realismBuffer.length} bytes`
  );

  return {
    buffer: realismBuffer,
    falCostUsd: inference.costUsd,
    falLatencyMs: inference.latencyMs,
    falEndpoint: inference.endpoint,
    falRequestId: inference.requestId,
    params: {
      providerId: "flux_fill",
      strength: 0,
      num_inference_steps: falPayload.num_inference_steps,
      guidance_scale: falPayload.guidance_scale,
      seed: stableSeed,
      fabric_feel: ff,
      print_strength: ps,
      pre_blur_sigma: PRE_KONTEXT_BLUR_SIGMA,
      hybrid_blend_alpha: blendAlpha,
    },
  };
}

registerVtonProvider({
  id: "flux_fill",
  label: "Flux Fill (mask-based)",
  description:
    "Inpaints the design region with a slider-driven prompt + Stage A color overlay. Best for screen-print look on plain garments.",
  endpoint: ENDPOINT,
  capabilities: {
    requiresMask: true,
    requiresPrompt: true,
    requiresModelPhoto: false,
    producesHybridComposite: true,
    experimental: false,
  },
  runVtonPass,
});

module.exports = { runVtonPass, ENDPOINT };
