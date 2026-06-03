"use strict";

/**
 * Real-render preview on the blank Render profile tab.
 *
 * Runs the same deterministic Sharp pipeline `onMockJobCreated` Stage A uses, but at the
 * BLANK level — no product, no rp_mock_jobs doc, no AI realism pass. Lets an operator
 * tune placement + blend + opacity + mask, click "Render preview," and see a real PNG
 * before fanning out to N products.
 *
 * Spec: RALLY_BLANK_PREVIEW_RENDER.md
 */

const { resolveDesignAssetUrls } = require("./designFileMergeCore");
const { runFalInference } = require("./falInference");
const { hexToColorName } = require("./hexToColorName");
const { warpDesignToQuad, isValidNormalizedQuad } = require("./perspectiveWarp");
const {
  getVtonProvider,
  DEFAULT_VTON_PROVIDER_ID,
} = require("./vtonProviders");
const { createBatchAtomically } = require("./batchHelpers");

/**
 * Stage B uses fal.ai's Kontext model (`fal-ai/flux-pro/kontext`) for image editing.
 * Kontext is designed for "edit this image to..." tasks and implicitly understands
 * the garment's fabric structure from the input image — no separate depth/control
 * map needed. The previous endpoint (`fal-ai/flux/dev/inpainting`) is deprecated;
 * `fal-ai/flux/dev/image-to-image` works but produces sticker-like prints.
 *
 * Kontext payload is just `prompt` + `image_url` — no strength knob, so prompt
 * carries the full burden of controlling how much the image changes. The prompt is
 * tuned to: (a) integrate the print into the fabric, (b) preserve design geometry.
 */
/**
 * Tuned for screen-print realism rather than sticker / iron-on look. Key levers:
 *  - "ink absorbed INTO cotton fibers" (vs sitting on top)
 *  - "fabric weave faintly visible through the ink" (texture penetration)
 *  - "soft edges where ink meets fabric" (no sharp die-cut sticker boundary)
 *  - "matte finish, no sheen" (no plastic / vinyl appearance)
 *  - "no sticker-like edge lift" (explicit negative for the failure mode)
 * Preservation of design content (text spelling, colors, position) emphasized
 * to counter Kontext's tendency to slightly re-interpret artwork.
 */
/**
 * Pass 2 of screen-print prompt tuning. Previous prompt produced a sticker-like
 * uniform-fill print with sharp edges; Kontext was preserving the input too literally.
 * New approach:
 *  - Lead with the desired output ("water-based screen print absorbed into cotton")
 *  - Demand visible weave / fiber texture THROUGH the ink (the key differentiator)
 *  - Demand saturation/coverage variation across the print (no perfectly-flat color)
 *  - Demand soft, imperfect edges (where ink soaks into fabric vs sits on top)
 *  - Reinforce in the negative: explicit "sticker", "vinyl", "uniform color", "hard edges"
 * Tuned for high guidance (5.5) so Kontext follows these directives even when its
 * "preserve input" bias pulls toward the sticker look.
 */
/**
 * Re-tuned for screen-print realism (v4, 2026-05-25): v3 outputs were softer but
 * still showed opaque uniform ink coverage — letters looked painted-on rather than
 * absorbed into the fabric. The fix: lead with CRITICAL emphasis on "ink absorbed
 * INTO the weave, not COATING it," anchor with a concrete vintage reference
 * ("thrifted band tee washed dozens of times"), and put "opaque ink coverage" /
 * "solid uniform color fill" at the very top of the negative so Kontext sees them
 * as the primary failure modes. Guidance bumped 7.5 → 8.5 to push the model
 * further past its "preserve input" bias.
 */
const REALISM_PROMPT =
  "A photorealistic studio product photo of a black cotton fleece crewneck sweatshirt with a worn-in vintage water-based SCREEN PRINT on the chest. CRITICAL: the ink must look ABSORBED INTO the cotton weave, not COATING it — the texture of the cotton fibers must be visibly showing THROUGH the print color, breaking up the ink coverage with fine fiber-level mottling and tiny micro-gaps where the weave threads peek through. The print has the appearance of a thrifted band tee that has been washed dozens of times: edges are slightly soft and irregular, color saturation varies subtly across the print, the ink looks matte and fibrous (NEVER glossy, NEVER plastic, NEVER perfectly uniform). The print drapes and follows every fold of the fabric naturally. Preserve the EXACT text spelling, layout, position, scale, colors, and overall geometry of the existing design — do not redraw or rearrange letters, do not add or remove words. The garment color, shape, lighting, and background must remain identical to the input photo.";
const REALISM_NEGATIVE =
  "opaque ink coverage, solid uniform color fill, ink fully covering fabric texture, painted-on look, flat ink, ink sitting on top of fabric, no fabric texture showing through, vinyl sticker, decal, iron-on patch, heat transfer, plastisol ink, glossy ink, plastic sheen, shiny print, wet appearance, raised 3D print, embossed, peeling edges, lifted corners, hard die-cut edges, sharp rectangular boundary around print, change text, misspell text, add words, redraw artwork, change garment color, change garment shape, change background, blurry, low-quality, artifacts";
/**
 * v8 ESCALATION (2026-05-25): switched from img2img → Flux Fill (inpainting).
 * img2img at strength 0.43 STILL produced sticker output even though the
 * garment shape warped — the model preferentially preserved the high-contrast
 * print region as the lowest-loss reconstruction. No whole-image transform
 * approach works for this because the print IS what we want transformed.
 *
 * Flux Fill is proper inpainting: with a letter-shaped mask, the model is
 * FORCED to regenerate only the ink pixels using the surrounding cotton
 * fabric as the prior. It cannot preserve the input ink — those pixels are
 * masked out. The only reference it has for what to paint is "cotton fleece
 * texture" from the surrounding fabric + the prompt. So the result must be
 * cotton-textured ink, not a flat overlay.
 *
 * Garment / fabric / background outside the mask are byte-identical — no
 * shrinking, no warping, no color shift. Text geometry is enforced by the
 * mask shape itself, not by hoping the prompt overrides the model's prior.
 */
const FAL_REALISM_ENDPOINT = "fal-ai/flux-pro/v1/fill";
/** 90 attempts × 1500ms = 135s polling budget. Stage B usually completes within 30-60s. */
const REALISM_MAX_POLL_ATTEMPTS = 90;
const REALISM_POLL_INTERVAL_MS = 1500;

function getFalApiKey(functions) {
  try {
    const cfg = functions.config && functions.config();
    const keyFromConfig = cfg && cfg.fal && cfg.fal.key;
    return process.env.FAL_API_KEY || keyFromConfig;
  } catch (e) {
    return process.env.FAL_API_KEY;
  }
}

const VARIANT_FLAT_FRONT_KEYS = ["flatFront", "front"];
const VARIANT_FLAT_BACK_KEYS = ["flatBack", "back"];

/**
 * Sharp's composite() uses `"over"` for the standard normal/source-over operation; it
 * rejects `"normal"` with `Expected valid blend name for blend but received normal`.
 * The editor (and CSS mix-blend-mode) speaks "normal," so normalize at the boundary.
 */
const CSS_TO_SHARP_BLEND = {
  normal: "over",
  source: "over",
  "source-over": "over",
};

function normalizeBlendModeForSharp(mode) {
  if (typeof mode !== "string" || mode.length === 0) return "soft-light";
  return CSS_TO_SHARP_BLEND[mode] || mode;
}

function pickRefImage(blank, variant, view) {
  const variantImages = (variant && variant.images) || null;
  const keys = view === "front" ? VARIANT_FLAT_FRONT_KEYS : VARIANT_FLAT_BACK_KEYS;
  if (variantImages) {
    for (const k of keys) {
      const ref = variantImages[k];
      if (ref && ref.downloadUrl) return String(ref.downloadUrl);
    }
  }
  const top = blank && blank.images && blank.images[view];
  if (top && top.downloadUrl) return String(top.downloadUrl);
  return null;
}

/**
 * Per-render-target image picker. Replaces `pickRefImage` for non-flat targets.
 *
 * - flat_<view>: use `pickRefImage` (variant flat photo, then blank-level fallback)
 * - model_<view>: read `variant.images.modelFront` / `modelBack` directly. No
 *   fallback — each variant's model photo is unique (different pose / lighting),
 *   so an "any model photo will do" fallback would yield a wrong composite.
 */
function pickRefImageForTarget(blank, variant, view, renderTarget) {
  const target = renderTarget || `flat_${view}`;
  if (target === "model_front" || target === "model_back") {
    if (!variant || !variant.images) return null;
    const ref = target === "model_front" ? variant.images.modelFront : variant.images.modelBack;
    return ref && ref.downloadUrl ? String(ref.downloadUrl) : null;
  }
  return pickRefImage(blank, variant, view);
}

/**
 * Doc id for the rp_blank_masks lookup that the composite will multiply with the
 * design alpha. Mirrors `functions/lib/blankMaskGeneration.js maskKeyFor`.
 *
 * - Flat masks (one per blank+view, shared across colors):  {blankId}_{view}
 * - Model-pose masks (one per blank+variant+pose):           {blankId}_{variantId}_model_<view>
 */
function maskDocIdForTarget(blankId, view, renderTarget, variantId) {
  const target = renderTarget || `flat_${view}`;
  if ((target === "model_front" || target === "model_back") && variantId) {
    return `${blankId}_${variantId}_${target}`;
  }
  return `${blankId}_${view}`;
}

/**
 * Pick the design PNG honoring the operator's Artwork variant choice (light / dark / white)
 * from the Render profile tab. Falls back through reasonable alternatives if the requested
 * variant isn't uploaded. Production (`onMockJobCreated`) currently always picks light-first;
 * the preview supports the explicit override so the editor can validate dark/white designs.
 */
function pickDesignPngUrl(design, artworkMode) {
  if (!design) return null;
  const u = resolveDesignAssetUrls(design);
  if (artworkMode === "dark") return u.darkPng || u.lightPng || u.whitePng || null;
  if (artworkMode === "white") return u.whitePng || u.lightPng || u.darkPng || null;
  return u.lightPng || u.darkPng || u.whitePng || null;
}

/**
 * Duplicates of helpers in index.js (applyOpacityToRgbaBuffer, premultiplyRgbaBuffer,
 * cropDesignToArtworkBounds). When the same Stage A logic is needed by yet another
 * surface, extract these to a shared module.
 */
function applyOpacityToRgbaBuffer(buffer, opacity) {
  const b = Buffer.from(buffer);
  for (let i = 3; i < b.length; i += 4) {
    b[i] = Math.round(b[i] * opacity);
  }
  return b;
}

function premultiplyRgbaBuffer(buffer) {
  const b = Buffer.from(buffer);
  for (let i = 0; i < b.length; i += 4) {
    const a = b[i + 3] / 255;
    b[i] = Math.round(b[i] * a);
    b[i + 1] = Math.round(b[i + 1] * a);
    b[i + 2] = Math.round(b[i + 2] * a);
  }
  return b;
}

const ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

async function cropDesignToArtworkBounds(sharp, designBuffer) {
  const meta = await sharp(designBuffer).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return { buffer: designBuffer, width: w || 1, height: h || 1 };

  const raw = await sharp(designBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ depth: 8, resolveWithObject: false });

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = raw[i + 3];
      if (a > ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boundsW = maxX >= minX ? maxX - minX + 1 : w;
  const boundsH = maxY >= minY ? maxY - minY + 1 : h;
  if (boundsW < 1 || boundsH < 1) return { buffer: designBuffer, width: w, height: h };

  const cropped = await sharp(designBuffer)
    .extract({ left: minX, top: minY, width: boundsW, height: boundsH })
    .png()
    .toBuffer();
  return { buffer: cropped, width: boundsW, height: boundsH };
}

async function assertAdmin(db, functions, uid) {
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  const snap = await db.collection("admins").doc(uid).get();
  if (!snap.exists) throw new functions.https.HttpsError("permission-denied", "Admins only");
}

/**
 * Run the Stage B AI realism pass on a Stage A composite buffer. Mirrors
 * `onMockJobCreated` Stage B (functions/index.js ~lines 8032-8200) — inpaint if a mask
 * exists for this blank+view, img2img otherwise. Returns the realism PNG buffer + the
 * model endpoint actually used (for telemetry).
 *
 * Costs $ per call (fal.ai) and takes ~20-60s. Only run when explicitly requested.
 */
/**
 * `hexToColorName` is now in functions/lib/hexToColorName.js so VTON providers
 * can import it without a circular dependency on this module. Re-exported below
 * for backward compat with any external caller that imports it from here.
 */

/**
 * Build a letter-shaped grayscale mask for Stage B inpainting from a design RGBA buffer.
 *
 * White pixels (255) in the output indicate "regenerate" (where the design ink is);
 * black pixels (0) indicate "preserve" (everything else). A soft 2px feather is applied
 * at the edges so Flux Fill has room to integrate the ink with surrounding fabric.
 *
 * Inputs:
 *   sharp                — the sharp module instance.
 *   resizedDesignRaw     — RGBA pixel buffer of the design at placement size (oversampled space).
 *   actualW, actualH     — design buffer dimensions (oversampled space).
 *   designLeft, designTop — placement top-left of the design on the canvas (oversampled space).
 *   nativeBlankW, nativeBlankH — final NATIVE output dimensions (mask is returned at this size).
 *   OVERSAMPLE           — oversample factor used for the design / canvas (1 if no oversampling).
 *
 * Returns: PNG Buffer of the grayscale mask at native blank dimensions.
 */
async function buildLetterMaskFromDesignRgba({
  sharp,
  resizedDesignRaw,
  actualW,
  actualH,
  designLeft,
  designTop,
  nativeBlankW,
  nativeBlankH,
  OVERSAMPLE,
}) {
  const oversample = Number.isFinite(Number(OVERSAMPLE)) && Number(OVERSAMPLE) > 0 ? Number(OVERSAMPLE) : 1;
  const alphaCanvasBuffer = Buffer.alloc(actualW * actualH * 4);
  for (let p = 0; p < actualW * actualH; p++) {
    const a = resizedDesignRaw[p * 4 + 3];
    const v = a > 32 ? 255 : 0;
    alphaCanvasBuffer[p * 4] = v;
    alphaCanvasBuffer[p * 4 + 1] = v;
    alphaCanvasBuffer[p * 4 + 2] = v;
    alphaCanvasBuffer[p * 4 + 3] = 255;
  }
  const designMaskRegion = await sharp(alphaCanvasBuffer, {
    raw: { width: actualW, height: actualH, channels: 4 },
  })
    /** sigma scaled with oversample so the feather measures ~2px in native space regardless of
     *  whether the caller oversamples (preview path = 2x → sigma 4) or runs at native (production
     *  path = 1x → sigma 2). Soft enough for the inpaint model to integrate ink edges with
     *  surrounding fabric, not so soft that the letters lose definition. */
    .blur(2 * oversample)
    .png()
    .toBuffer();
  const letterMaskOversampled = await sharp({
    create: {
      width: nativeBlankW * oversample,
      height: nativeBlankH * oversample,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: designMaskRegion, left: designLeft, top: designTop, blend: "over" }])
    .png()
    .toBuffer();
  // Single high-quality downsample to native dimensions (no-op when oversample === 1).
  const letterMaskBuffer = await sharp(letterMaskOversampled)
    .resize(nativeBlankW, nativeBlankH, { kernel: "lanczos3" })
    .grayscale()
    .png()
    .toBuffer();
  return letterMaskBuffer;
}

async function runRealismPass({ sharp, db, fetchFn, falApiKey, blankId, view, draftBuffer, draftMeta, letterMaskBuffer, designColors, fabricFeel, printStrength }) {
  /**
   * Slider-driven realism (v6, 2026-05-25): v5 had two structural bugs that
   * Greg's "still very much a peeled sticker" feedback exposed:
   *
   *   (a) At low fabric feel my prompt literally read "ink sits closer to the
   *       surface, retaining defined edges, mostly opaque coverage" — that's
   *       a description of a sticker. Kontext faithfully delivered it. There
   *       should be NO slider position that asks for a sticker; every band
   *       must describe screen-printing on cotton, just with different
   *       degrees of weave-through visibility.
   *
   *   (b) At low fabric feel the pre-Kontext blur dropped to sigma 0.4-0.5,
   *       which on a ~1500px image is essentially imperceptible. Kontext saw
   *       pixel-perfect letter edges and preserved them. The blur formula now
   *       has a floor of 1.0 (visible softening) at ff=0, up to 2.5 at ff=1.
   *
   * If v6 still produces sticker output even with high fabric feel + low print
   * strength, Kontext is fundamentally not transforming enough. Escalation
   * path is img2img with strength 0.5+ (forces redraw) or true inpainting on
   * the printable-zone mask. See block-comment at top of file for context.
   */
  const ff = Number.isFinite(Number(fabricFeel)) ? Math.max(0, Math.min(1, Number(fabricFeel))) : 0.5;
  const ps = Number.isFinite(Number(printStrength)) ? Math.max(0, Math.min(1, Number(printStrength))) : 0.7;

  /**
   * v8: no pre-blur of the canvas. Flux Fill inpaints the mask region from scratch
   * using surrounding context — pre-blurring the input doesn't help and actually
   * hurts the surrounding fabric reference (model sees blurry fabric, paints blurry
   * fabric edges adjacent to the inpaint region). PRE_KONTEXT_BLUR_SIGMA kept as a
   * telemetry-only field equal to 0 so the badge/schema stays consistent.
   */
  const PRE_KONTEXT_BLUR_SIGMA = 0;
  const draftBase64 = draftBuffer.toString("base64");
  const draftDataUrl = `data:image/png;base64,${draftBase64}`;
  /** Letter-shaped mask from composeStageA: white = regenerate, black = preserve. */
  const maskBase64 = letterMaskBuffer ? letterMaskBuffer.toString("base64") : null;
  const maskDataUrl = maskBase64 ? `data:image/png;base64,${maskBase64}` : null;
  if (!maskDataUrl) {
    throw new Error("v8 Flux Fill requires letterMaskBuffer from composeStageA but it was not provided");
  }
  console.log(
    `[realism] v8 Flux Fill: fabricFeel=${ff.toFixed(2)} printStrength=${ps.toFixed(2)} mask_bytes=${letterMaskBuffer.length}`
  );

  /**
   * v9 (2026-05-25): rewrote the slider→prompt mapping to fix two failure modes:
   *
   *   (a) Earlier bands described "vintage band tee washed dozens of times" at
   *       high fabric feel — that's a distressed-vintage look, NOT a fresh
   *       screen-print look. The model dutifully produced faded ghost prints
   *       with washed-out colors. Greg's actual target is a vivid, fresh
   *       screen-print with subtle fabric texture interaction — not a thrift
   *       store relic.
   *
   *   (b) Print strength at 45% was triggering "vintage softness, washed
   *       several times, slightly faded" which destroyed color saturation.
   *       ps now controls vividness ONLY (faded → bold), not aging.
   *
   * New semantics:
   *   - Fabric feel = how much cotton texture shows THROUGH the ink (subtle →
   *     pronounced). At every band, the print is fresh and vivid; only the
   *     texture interaction varies. No "worn / washed / thrifted" language.
   *   - Print strength = ink vividness (faded → extra bold). At ps≥0.5 the
   *     print is fresh and saturated. Below that it's gradually faded.
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

  /**
   * v8.1: explicit ink color injection. Flux Fill regenerates the masked region
   * from prompt alone (it doesn't condition on the input pixels inside the mask),
   * so without color info the result comes out monochrome / gray. We derive
   * coarse color names from the design's `colors[].hex` and inject them into
   * the prompt as a "rendered in X and Y ink" clause.
   */
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
  /**
   * v9: stronger color directive. Earlier phrasing ("rendered in orange and
   * white screen-printing ink") was a single weak mention — Flux Fill happily
   * drifted toward gray for white and brown for orange. The "MUST" + "stay
   * exactly" framing plus an explicit anti-gray clause for white is meant to
   * dominate the model's tendency to mute saturated colors during inpainting.
   */
  const hasWhite = colorList.some((c) => c.startsWith("white"));
  const whiteEmphasis = hasWhite
    ? " The white ink MUST stay pure bright white — never gray, never beige, never muted."
    : "";
  const colorClause = colorList.length > 0
    ? `The print MUST be rendered in these EXACT screen-printing ink colors: ${colorList.join(" and ")}. The ink colors stay vivid and at full saturation.${whiteEmphasis} `
    : "";
  console.log(`[realism] v8.1 prompt colors: ${colorList.join(", ") || "(none detected, prompt will not specify)"}`);

  const dynamicPrompt =
    `A photorealistic studio product photo of a black cotton fleece crewneck sweatshirt with a water-based SCREEN-PRINTED design on the chest. ${colorClause}The ink has been pressed INTO the cotton fabric using a silkscreen process — it is NEVER a sticker, NEVER a decal, NEVER vinyl, NEVER iron-on, NEVER plastic, NEVER raised 3D. The ink finish is matte and fibrous, sitting WITH the cotton fibers, not on top. CRITICAL TEXTURE: ${fabricPhrase}. CRITICAL SATURATION: ${strengthPhrase}. Color saturation varies subtly across the print like real screen-printing on heavy cotton. The print drapes and follows every fold of the fabric naturally. Preserve the EXACT text spelling, layout, position, scale, colors, and overall geometry of the existing design — do not redraw or rearrange letters, do not add or remove words. The garment color, shape, lighting, and background must remain identical to the input photo.`;

  /**
   * Switched from `fal-ai/flux/dev/image-to-image` (strength-controlled img2img) to
   * `fal-ai/flux-pro/kontext` (image-editing model). Kontext's prompt carries the
   * editing intent — there's no strength knob — so we lean on a directive prompt that
   * says "integrate the print into the fabric, do not redraw the artwork." The model
   * implicitly understands the garment's fabric structure from the input image, so
   * no separate depth/control map is required for this first iteration.
   */
  const falEndpoint = FAL_REALISM_ENDPOINT;
  const useMask = true;
  /**
   * v8.2: deterministic seed so re-running with the same inputs produces the same
   * output. Without a seed, Flux Fill gets a fresh random seed each call and
   * outputs vary wildly between runs (muted vs vivid, gray vs white, etc.) — saw
   * this empirically: same {blankId, designId, ff, ps} produced very different
   * results across two consecutive clicks. The seed is a simple deterministic
   * hash of the inputs so any tuning iteration is repeatable.
   */
  const seedInput = `${blankId}|${view}|ff:${ff.toFixed(3)}|ps:${ps.toFixed(3)}`;
  let seedHash = 0;
  for (let i = 0; i < seedInput.length; i++) {
    seedHash = ((seedHash << 5) - seedHash) + seedInput.charCodeAt(i);
    seedHash |= 0; // force i32
  }
  const stableSeed = Math.abs(seedHash) % 1000000;

  const falPayload = {
    image_url: draftDataUrl,
    mask_url: maskDataUrl,
    /** v5 dynamic prompt drives what the mask region is repainted as. With Flux Fill
     *  the prompt no longer needs to fight geometry preservation (the mask handles
     *  that) — it only needs to describe the desired ink texture. */
    prompt: dynamicPrompt,
    /** Anti-sticker negative — Flux Fill honors this. */
    negative_prompt: REALISM_NEGATIVE,
    /** v9: 5.0 — bumped from 3.5 because the color directive ("vivid orange,
     *  bright white, NEVER gray") wasn't being followed strongly enough at 3.5.
     *  Flux Fill drifted toward muted brown / gray for the print. 5.0 pushes
     *  it to honor the color clause without oversaturating the result. */
    guidance_scale: 5.0,
    /** 28 steps — Flux Fill default. Inpainting converges faster than text2img. */
    num_inference_steps: 28,
    seed: stableSeed,
  };
  console.log(
    `[realism] v8.2 Flux Fill: endpoint=${falEndpoint} cfg=${falPayload.guidance_scale} steps=${falPayload.num_inference_steps} seed=${stableSeed} draft_bytes=${draftBuffer.length}`
  );

  /**
   * Phase A: every fal.ai call goes through `runFalInference` so cost + latency
   * land on the job doc. The wrapper encapsulates the submit/poll/response_url
   * pattern that used to live inline here (and in runSam, and in any future
   * VTON / Kontext endpoint we add).
   */
  const inference = await runFalInference({
    endpoint: falEndpoint,
    payload: falPayload,
    falApiKey,
    fetchFn,
    maxPollAttempts: REALISM_MAX_POLL_ATTEMPTS,
    pollIntervalMs: REALISM_POLL_INTERVAL_MS,
    withLogs: true,
  });
  console.log(
    `[realism] runFalInference: cost=$${inference.costUsd ?? "?"} latency=${inference.latencyMs}ms request_id=${inference.requestId || "?"}`
  );
  const resultJson = inference.result;
  const resultImages = resultJson.images || (resultJson.output && resultJson.output.images) || [];
  if (!Array.isArray(resultImages) || resultImages.length === 0) {
    throw new Error(
      `fal.ai returned no realism images. Response keys: ${JSON.stringify(Object.keys(resultJson))}`
    );
  }
  const resultUrl = typeof resultImages[0] === "string" ? resultImages[0] : resultImages[0].url;
  if (!resultUrl) throw new Error("fal.ai realism result missing image URL");

  const dlResp = await fetchFn(resultUrl);
  if (!dlResp.ok) throw new Error(`Failed to download realism image (HTTP ${dlResp.status})`);
  const fluxFillBuffer = Buffer.from(await dlResp.arrayBuffer());

  /**
   * v10 HYBRID COMPOSITE (2026-05-25) — preserve Stage A colors, take Flux
   * Fill's texture only.
   *
   * The story so far:
   *   - v8.1 post-composite fixed outside-mask preservation (garment intact).
   *   - v9 prompts + cfg 5.0 + explicit color injection failed to stop Flux
   *     Fill from drifting toward muted brown / gray inside the mask. The model
   *     has a fundamental color-fidelity problem for this use case that no
   *     amount of prompt engineering overcomes.
   *
   * v10 splits the inside-mask region into a weighted blend:
   *
   *   outside-mask:  Stage A pixel       (byte-identical, garment unchanged)
   *   inside-mask:   Stage A · (1-α) + FluxFill · α   per-channel
   *                  where α scales with `Fabric feel` (more Worn → more AI
   *                  texture pulled through; Clean → mostly Stage A's vivid
   *                  ink with just edge softening from the mask feather).
   *
   * Net effect: vivid orange + white from Stage A always wins on color; Flux
   * Fill contributes ink-mottling + fabric-texture variation that breaks up
   * Stage A's perfectly flat ink without changing the color identity.
   *
   * α range tied to fabric feel band:
   *   Clean   (ff≈0.20) → α = 0.20  (mostly Stage A; subtle texture)
   *   Textured(ff≈0.55) → α = 0.35  (balanced)
   *   Worn    (ff≈0.85) → α = 0.55  (heavier AI contribution, more visible
   *                                   weave-through but Stage A still anchors)
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

  /** Map fabricFeel band to Flux Fill blend weight α inside the mask. */
  const blendAlpha = ff >= 0.7 ? 0.55 : ff >= 0.4 ? 0.35 : 0.20;
  const inv = 1 - blendAlpha;

  const hybridWithMaskAlpha = Buffer.alloc(numPixels * 4);
  for (let p = 0; p < numPixels; p++) {
    const sa = p * stageAChannels;
    const fx = p * fluxChannels;
    hybridWithMaskAlpha[p * 4]     = Math.round(stageARgb.data[sa]     * inv + fluxResized.data[fx]     * blendAlpha);
    hybridWithMaskAlpha[p * 4 + 1] = Math.round(stageARgb.data[sa + 1] * inv + fluxResized.data[fx + 1] * blendAlpha);
    hybridWithMaskAlpha[p * 4 + 2] = Math.round(stageARgb.data[sa + 2] * inv + fluxResized.data[fx + 2] * blendAlpha);
    hybridWithMaskAlpha[p * 4 + 3] = maskResized.data[p];
  }

  const realismBuffer = await sharp(draftBuffer)
    .composite([
      {
        input: hybridWithMaskAlpha,
        raw: {
          width: fluxResized.info.width,
          height: fluxResized.info.height,
          channels: 4,
        },
        blend: "over",
      },
    ])
    .png()
    .toBuffer();

  console.log(
    `[realism] v10 hybrid composite: stageA=${stageADims.width}x${stageADims.height} flux=${fluxResized.info.width}x${fluxResized.info.height} blendAlpha=${blendAlpha} (ff=${ff.toFixed(2)}) → final=${realismBuffer.length} bytes`
  );

  return {
    buffer: realismBuffer,
    falEndpoint,
    /** v8: TRUE inpainting via Flux Fill — letter-shaped mask enforces geometry,
     *  surrounding cotton fabric becomes the prior for what to paint in the mask. */
    useMask,
    /**
     * Phase A telemetry from runFalInference. Caller (composeStageB → trigger)
     * forwards these onto the rp_blank_preview_jobs doc so the dashboard
     * cost-meter widget can sum them across day / blank / team.
     */
    inference: {
      costUsd: inference.costUsd,
      latencyMs: inference.latencyMs,
      endpoint: inference.endpoint,
      requestId: inference.requestId,
    },
    params: {
      /** Flux Fill has no strength knob — the mask is the boundary. Kept at 0 for
       *  badge / schema backward compat. */
      strength: 0,
      num_inference_steps: falPayload.num_inference_steps,
      guidance_scale: falPayload.guidance_scale,
      /** v5 telemetry: surface the slider values that drove the prompt + blur so the
       *  editor badge can show "ff 0.07 · ps 0.88 → blur 0.51" — instantly answers
       *  "did the AI actually see my slider settings?" */
      fabric_feel: ff,
      print_strength: ps,
      pre_blur_sigma: PRE_KONTEXT_BLUR_SIGMA,
    },
  };
}

/**
 * Validate + normalize a job's input fields the same way for sync callable and async
 * trigger entry points. Throws an `HttpsError` for the sync callable; the trigger
 * catches and writes the error message into the job doc.
 */
const VALID_PREVIEW_RENDER_TARGETS = new Set([
  "flat_front",
  "flat_back",
  "model_front",
  "model_back",
]);

function validatePreviewInput(functions, data) {
  const {
    blankId,
    variantId,
    designId,
    view,
    placement: pl,
    artworkMode: artworkModeIn,
    withRealism: withRealismIn,
    designUrlOverride: designUrlOverrideIn,
    renderTarget: renderTargetIn,
    /** Phase B: optional provider override for single-job callers. */
    providerId: providerIdIn,
    /** Phase I: optional identity attachment. When set, the trigger pulls
     *  referenceImages from the identity doc and threads them into the
     *  VTON provider (Flux 2 multi-ref) along with the identity's
     *  preferredProviderId override. */
    identityId: identityIdIn,
  } = data || {};
  const artworkMode = artworkModeIn === "dark" || artworkModeIn === "white" ? artworkModeIn : "light";
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (view !== "front" && view !== "back") {
    throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
  }
  if (!pl || typeof pl !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "placement is required");
  }
  /**
   * `renderTarget` is optional for backward compat — when omitted, default to
   * the legacy flat path so existing editor callers (which only knew about
   * flat composites) keep working. Model targets need an explicit opt-in.
   */
  const renderTarget = renderTargetIn || `flat_${view}`;
  if (!VALID_PREVIEW_RENDER_TARGETS.has(renderTarget)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `renderTarget must be one of ${[...VALID_PREVIEW_RENDER_TARGETS].join(", ")}`
    );
  }
  if ((renderTarget === "model_front" || renderTarget === "model_back") && !variantId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `variantId is required for renderTarget="${renderTarget}" — each color has its own model photo`
    );
  }
  /**
   * Phase B providerId validation. We validate against the registered list at
   * the trigger boundary too, but doing it here returns a friendly callable
   * error code (invalid-argument) instead of a server-error 500.
   */
  let providerId = null;
  if (providerIdIn != null) {
    if (typeof providerIdIn !== "string" || providerIdIn.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "providerId must be a non-empty string when provided"
      );
    }
    try {
      // Touch the registry — throws if id is unknown.
      // eslint-disable-next-line global-require
      const { getVtonProvider } = require("./vtonProviders");
      getVtonProvider(providerIdIn);
    } catch (e) {
      throw new functions.https.HttpsError("invalid-argument", e.message);
    }
    providerId = providerIdIn;
  }
  /**
   * Phase I identity validation. We don't verify the identity exists here
   * (saves a Firestore read on every callable) — the trigger will surface a
   * clean log when an attached identity is missing. Format validation only.
   */
  let identityId = null;
  if (identityIdIn != null) {
    if (typeof identityIdIn !== "string" || identityIdIn.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "identityId must be a non-empty string when provided"
      );
    }
    identityId = identityIdIn;
  }
  return {
    blankId,
    variantId: variantId || null,
    designId,
    view,
    artworkMode,
    placement: pl,
    withRealism: withRealismIn === true,
    designUrlOverride:
      typeof designUrlOverrideIn === "string" && designUrlOverrideIn.length > 0 ? designUrlOverrideIn : null,
    renderTarget,
    providerId,
    identityId,
  };
}

/**
 * Stage A composite — same algorithm `onMockJobCreated` Stage A uses, in lib form so
 * both the sync callable (`previewBlankRender` with withRealism=false) and the async
 * trigger (`onBlankPreviewJobCreated`) call the same code path.
 *
 * Returns the persisted `stageA` summary plus the in-memory buffer/meta needed to chain
 * into Stage B without re-loading from Storage.
 */
async function composeStageA({ db, storage, sharp, functions, input }) {
  const { blankId, variantId, designId, view, artworkMode, placement: pl } = input;
  /**
   * Default to flat for inputs that don't carry renderTarget (older callers
   * pre-Phase-2). validatePreviewInput sets this for new callers.
   */
  const renderTarget = input.renderTarget || `flat_${view}`;
  const isModelTarget = renderTarget === "model_front" || renderTarget === "model_back";

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  const blank = blankSnap.data();

  const variants = Array.isArray(blank.variants) ? blank.variants : [];
  /**
   * For model targets, the variant is required and must match exactly — each
   * variant's model photo has a unique silhouette so we can't fall back to
   * "any variant with a model photo." Flat targets keep the legacy fallback.
   */
  const variant = isModelTarget
    ? variants.find((v) => v && v.variantId === variantId) || null
    : (variantId && variants.find((v) => v && v.variantId === variantId)) ||
      variants.find((v) => v && pickRefImage(blank, v, view)) ||
      null;

  const refImageUrl = pickRefImageForTarget(blank, variant, view, renderTarget);
  if (!refImageUrl) {
    const detail = isModelTarget
      ? `Variant ${variantId} has no ${renderTarget === "model_front" ? "modelFront" : "modelBack"} photo — upload one on the blank's Identity tab first`
      : `No ${view} image for this blank — upload a variant photo or a master image first`;
    throw new functions.https.HttpsError("failed-precondition", detail);
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
  const design = designSnap.data();
  /**
   * Trust the caller's resolved URL when provided — the editor uses `pickDesignPreviewPng`
   * (lib/designs/designHelpers.ts via resolveDesignSideAssets) which handles side-specific
   * `assets[side]` / `files[side]` paths. The server's `pickDesignPngUrl` uses a slightly
   * different resolver (`resolveDesignAssetUrls` in designFileMergeCore) and can pick a
   * different variant for designs with side-specific assets. Passing the editor's URL
   * here guarantees CSS preview and Stage A composite the same image bytes.
   */
  const designPngUrl =
    (input.designUrlOverride && typeof input.designUrlOverride === "string"
      ? input.designUrlOverride
      : null) || pickDesignPngUrl(design, artworkMode);
  if (!designPngUrl) {
    throw new functions.https.HttpsError("failed-precondition", "Design has no usable PNG (lightPng / darkPng / files.*.png)");
  }
  console.log(
    `[composeStageA] designUrl=${designPngUrl} source=${input.designUrlOverride ? "client-override" : "server-resolved"} artworkMode=${artworkMode}`
  );

  const blankResp = await fetch(refImageUrl);
  if (!blankResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch garment image (HTTP ${blankResp.status})`);
  const nativeBlankBuffer = Buffer.from(await blankResp.arrayBuffer());

  /**
   * Oversample the entire composite: render at 2× the blank's native resolution, then
   * downsample once to native at the very end. The design layer is sized in the 2× space
   * (e.g. 864×540 instead of 432×270 for HF07's chest panel at scale=0.4), so Sharp's
   * intermediate resize keeps far more detail. The final single-pass downsample uses
   * lanczos3 and produces a sharp result. Net effect: the design's text edges look
   * crisp in the displayed PNG, matching what the CSS canvas previews.
   *
   * Trade-off: 4× the pixels through Sharp, 4× the upload bytes for the preview PNG.
   * Stage A goes from ~3s → ~6s and from ~250KB → ~1MB for a typical HF07 render.
   * Worth it for preview accuracy.
   */
  const OVERSAMPLE = 2;
  const nativeBlankMeta = await sharp(nativeBlankBuffer).metadata();
  const nativeBlankW = nativeBlankMeta.width || 1500;
  const nativeBlankH = nativeBlankMeta.height || 1500;
  const blankBuffer = await sharp(nativeBlankBuffer)
    .resize(nativeBlankW * OVERSAMPLE, nativeBlankH * OVERSAMPLE, { kernel: "lanczos3" })
    .toBuffer();

  const designResp = await fetch(designPngUrl);
  if (!designResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch design PNG (HTTP ${designResp.status})`);
  let designBuffer = Buffer.from(await designResp.arrayBuffer());

  /**
   * Use the design PNG's NATURAL dimensions (no artwork-bounds crop). The CSS canvas in
   * the editor renders the full uncropped artboard with `object-contain`; cropping in
   * Stage A produced a different visual layout for any design with transparent padding,
   * which broke "what you see is what production produces." Now both surfaces composite
   * the same buffer: full design PNG → fit-inside the art box → place at center.
   *
   * Trade-off: padded artboards render with their padding visible (just like the CSS
   * canvas shows them). Designers should tightly crop their artboards — or use the
   * artboard as the canonical placement reference, which is what the CSS canvas
   * has always implied via the fixed `DESIGN_ARTBOARD_WIDTH_PX / HEIGHT_PX` constants.
   */
  const designMeta = await sharp(designBuffer).metadata();
  const designWidth = designMeta.width || 1;
  const designHeight = designMeta.height || 1;

  const blankMeta = await sharp(blankBuffer).metadata();
  const blankWidth = blankMeta.width;
  const blankHeight = blankMeta.height;
  if (!blankWidth || !blankHeight) {
    throw new functions.https.HttpsError("internal", "Garment image has no readable dimensions");
  }

  const x = Number.isFinite(Number(pl.x)) ? Number(pl.x) : 0.5;
  const y = Number.isFinite(Number(pl.y)) ? Number(pl.y) : 0.5;
  const effectiveScale = Number.isFinite(Number(pl.scale)) ? Number(pl.scale) : 0.6;
  const centerXpx = Math.round(x * blankWidth);
  const centerYpx = Math.round(y * blankHeight);
  let artBoxPxW;
  let artBoxPxH;
  if (Number.isFinite(Number(pl.width)) && Number.isFinite(Number(pl.height)) && Number(pl.width) > 0 && Number(pl.height) > 0) {
    artBoxPxW = Math.round(blankWidth * Number(pl.width) * effectiveScale);
    artBoxPxH = Math.round(blankHeight * Number(pl.height) * effectiveScale);
  } else {
    artBoxPxW = Math.round(blankWidth * 0.5 * effectiveScale);
    artBoxPxH = Math.round(blankHeight * 0.5 * effectiveScale);
  }
  let left = Math.round(centerXpx - artBoxPxW / 2);
  let top = Math.round(centerYpx - artBoxPxH / 2);

  const designAspect = designWidth / designHeight;
  const boxAspect = artBoxPxW / artBoxPxH;
  let resizedWidth;
  let resizedHeight;
  if (designAspect >= boxAspect) {
    resizedWidth = artBoxPxW;
    resizedHeight = Math.round(artBoxPxW / designAspect);
  } else {
    resizedHeight = artBoxPxH;
    resizedWidth = Math.round(artBoxPxH * designAspect);
  }

  /**
   * Print-realism treatment defaults to NO-OP. Blanks that want fabric softness can opt
   * in via `placement.printBlurSigma` / `printSaturation`. Resize kernel is `lanczos2`
   * (sharper than lanczos3 default) — text designs survive the downsample better with
   * less halo softening, which was the visible "blurriness" in earlier Stage A previews.
   */
  const printBlurSigma = Number.isFinite(Number(pl.printBlurSigma)) ? Number(pl.printBlurSigma) : 0;
  const printSaturation = Number.isFinite(Number(pl.printSaturation)) ? Number(pl.printSaturation) : 1.0;
  let resizePipeline = sharp(designBuffer).resize(resizedWidth, resizedHeight, { fit: "inside", kernel: "lanczos2" });
  if (printBlurSigma > 0) resizePipeline = resizePipeline.blur(printBlurSigma);
  if (printSaturation !== 1.0) resizePipeline = resizePipeline.modulate({ saturation: printSaturation });
  const resizedResult = await resizePipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ depth: 8, resolveWithObject: true });
  const resizedDesignRaw = resizedResult.data;
  const actualW = resizedResult.info.width;
  const actualH = resizedResult.info.height;

  /**
   * v8.3 (2026-05-25): force clean blend for Stage A regardless of what the
   * editor's "Print style / blend" sliders compute.
   *
   * Why: those sliders predate AI realism. They used to push Stage A toward
   * an "absorbed-look" via multiply / soft-light blends with low opacity —
   * which on a black garment made the design nearly invisible (e.g., at
   * `fabricFeel=80%` the editor sent `multiply · op 0.49`, rendering an
   * essentially black ghost of the design). Two problems followed:
   *
   *   1. The "Real render — Stage A" preview operators use for placement
   *      validation was unreadable.
   *   2. Flux Fill (Stage B) consumed that near-invisible Stage A as
   *      `image_url`. With no visible color anchor in the input, it fell
   *      back to its own prior and produced grayscale output even though
   *      the prompt explicitly named the orange + white ink colors.
   *
   * v8.3 decouples: Stage A is always a clean, fully-saturated composite of
   * the design on the garment. The fabricFeel / printStrength sliders still
   * reach Stage B's prompt + (future) blur — they're for the AI now, not the
   * deterministic preview. The editor's blendMode/blendOpacity send is
   * intentionally ignored here.
   */
  const blendModeRequested = "normal";
  const blendMode = normalizeBlendModeForSharp(blendModeRequested);
  const effectiveOpacity = 1.0;
  console.log(
    `[composeStageA] v8.3 clean blend: forced normal/1.0 (editor sent ${pl.blendMode || "default"}/${pl.blendOpacity != null ? pl.blendOpacity : "default"}, sliders now drive Stage B prompt only)`
  );

  /**
   * Compute the design's actual top-left on the garment BEFORE applying the mask, so
   * we extract the matching mask region from the same coordinate space. The original
   * `left/top` are the art-box top-left; the design (fit: inside) is centered within
   * that art box, so its true position is offset by half the size difference.
   * Clamp inside the blank so extract() never goes out of bounds.
   */
  const designLeft = Math.max(0, Math.min(Math.round(left + (artBoxPxW - actualW) / 2), blankWidth - actualW));
  const designTop = Math.max(0, Math.min(Math.round(top + (artBoxPxH - actualH) / 2), blankHeight - actualH));

  let maskApplied = false;
  let maskMean = null;
  const maskMode = pl.maskConfig && typeof pl.maskConfig.mode === "string" ? pl.maskConfig.mode : null;
  try {
    /**
     * Per-target mask doc lookup. For model targets, the doc lives at
     * `{blankId}_{variantId}_model_<view>` (per-pose mask written by Phase 1).
     * Flat targets keep the legacy `{blankId}_<view>` doc id.
     */
    const maskDocId = maskDocIdForTarget(blankId, view, renderTarget, variantId);
    const maskDoc = maskMode === "none" ? null : await db.collection("rp_blank_masks").doc(maskDocId).get();
    const maskData = maskDoc && maskDoc.exists ? maskDoc.data() : null;
    if (maskData && maskData.mask && maskData.mask.downloadUrl) {
      const maskResp = await fetch(maskData.mask.downloadUrl);
      if (maskResp.ok) {
        /**
         * Resize the mask to BLANK dimensions (it was authored in garment coordinate
         * space), then extract the sub-region that overlaps the design's placement.
         * Previously we stretched the whole mask into the design's bounding box with
         * `fit: "fill"` — which compressed the sweatshirt silhouette into a thin band
         * and clipped most of the design away. The extract path is geometrically
         * correct: only the bit of the mask actually under the design gets multiplied.
         */
        /**
         * Read the mask as SINGLE-channel grayscale raw bytes. Critically, NO ensureAlpha —
         * that turned the raw stride into 2 bytes/pixel (Y+A) while my loop walks 4 bytes/pixel
         * to match the design RGBA. Result: mask values were read at every-other-pixel offsets
         * AND the buffer ran out halfway through, zeroing the bottom half of the design (where
         * "69" lives). Now: mask buffer is `numPixels` bytes, design is `numPixels * 4` bytes,
         * and we walk both with explicit pixel index `p`.
         */
        const maskResult = await sharp(await maskResp.arrayBuffer())
          .resize(blankWidth, blankHeight, { fit: "fill" })
          .extract({ left: designLeft, top: designTop, width: actualW, height: actualH })
          .grayscale()
          .raw()
          .toBuffer({ depth: 8, resolveWithObject: true });
        const maskBuffer = maskResult.data;
        const numPixels = maskBuffer.length;
        let sum = 0;
        for (let p = 0; p < numPixels; p++) sum += maskBuffer[p];
        maskMean = numPixels > 0 ? sum / numPixels : 0;
        /**
         * Empty-mask sanity check. The extracted region is the part of the mask under
         * the design's footprint, NOT the whole mask. Three cases:
         *   - Mean very low (~0): the design sits outside the print zone — skip; the
         *     multiply would zero out the entire design.
         *   - Mean very high (~255): the design sits fully inside the print zone — the
         *     multiply is a no-op (white = identity for multiply), but apply anyway so
         *     the badge reads "Mask applied" consistently.
         *   - Mean in between: design straddles the print-zone boundary — apply normally.
         *
         * The old upper bound of 230 incorrectly rejected the no-op case (mean=255 for a
         * design fully inside a sweatshirt-body silhouette) and made it look like the mask
         * was broken. There's no real inversion case to detect at extract time — the
         * SAM upload step already normalizes to strict black/white.
         */
        const looksUsable = maskMean >= 5;
        if (looksUsable) {
          /** Walk both buffers by pixel index: mask is 1 byte/px, design is 4 bytes/px. */
          for (let p = 0; p < numPixels; p++) {
            const m = maskBuffer[p];
            const i = p * 4;
            resizedDesignRaw[i] = Math.round((resizedDesignRaw[i] * m) / 255);
            resizedDesignRaw[i + 1] = Math.round((resizedDesignRaw[i + 1] * m) / 255);
            resizedDesignRaw[i + 2] = Math.round((resizedDesignRaw[i + 2] * m) / 255);
            resizedDesignRaw[i + 3] = Math.round((resizedDesignRaw[i + 3] * m) / 255);
          }
          maskApplied = true;
        } else {
          console.log(`[composeStageA] Skipping mask (mean=${Math.round(maskMean)} < 5; design likely outside print zone)`);
        }
      }
    }
  } catch (maskErr) {
    console.warn("[composeStageA] mask apply failed:", maskErr && maskErr.message);
  }

  /**
   * Phase L (2026-06-02): deterministic chest-print perspective warp for model
   * targets. When the variant has a `modelPrintQuad` for this side, warp the
   * (mask-multiplied) design through a homography onto the 4-corner chest quad
   * so it follows the body's angle + fabric plane — instead of pasting a flat
   * rectangle that Flux Fill then faithfully keeps flat. The warp is done in
   * the oversampled canvas space; the result is a FULL-CANVAS RGBA buffer, so
   * we reset the placement vars to (0,0, full size) and the existing letter-
   * mask + composite code below works unchanged (it's parameterized on these).
   *
   * Absent quad → composeDesign* stay the flat values (legacy behavior, byte-
   * identical to pre-Phase-L). Any warp failure logs + falls back to flat.
   */
  let composeDesignRaw = resizedDesignRaw;
  let composeW = actualW;
  let composeH = actualH;
  let composeLeft = designLeft;
  let composeTop = designTop;
  let quadWarpApplied = false;

  const printQuad =
    isModelTarget && variant && variant.modelPrintQuad
      ? view === "back"
        ? variant.modelPrintQuad.back
        : variant.modelPrintQuad.front
      : null;
  if (printQuad && isValidNormalizedQuad(printQuad)) {
    try {
      // The masked design at placement size → PNG → warp onto the quad in
      // oversampled canvas space → full-canvas RGBA.
      const designPlacedPng = await sharp(resizedDesignRaw, {
        raw: { width: actualW, height: actualH, channels: 4 },
      })
        .png()
        .toBuffer();
      const warpedCanvasPng = await warpDesignToQuad({
        sharp,
        designBuffer: designPlacedPng,
        quad: printQuad,
        outputWidth: blankWidth,
        outputHeight: blankHeight,
      });
      const warpedRaw = await sharp(warpedCanvasPng)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      composeDesignRaw = warpedRaw.data;
      composeW = warpedRaw.info.width;
      composeH = warpedRaw.info.height;
      composeLeft = 0;
      composeTop = 0;
      quadWarpApplied = true;
      console.log(
        `[composeStageA] Phase L quad warp applied (${renderTarget}, variant ${variantId}) → ${composeW}x${composeH} canvas`
      );
    } catch (warpErr) {
      console.warn(
        "[composeStageA] quad warp failed, falling back to flat paste:",
        warpErr && warpErr.message ? warpErr.message : warpErr
      );
    }
  }

  /**
   * v8 LETTER MASK FOR INPAINTING (2026-05-25): build a binary mask that's white
   * exactly where the design's ink is and black everywhere else. Stage B (Flux Fill)
   * uses this mask to regenerate ONLY the ink pixels — leaving the entire garment,
   * fabric, and background byte-identical. With img2img / Kontext, the whole image
   * was transformed and the model preferentially preserved the high-contrast print
   * region we wanted transformed. With a letter mask, the model is forced to paint
   * those exact pixels from scratch using the surrounding cotton fabric as context,
   * so it must produce cotton-textured ink instead of preserving the sticker.
   *
   * Mask is built BEFORE we mutate the design with opacity/premultiply so the
   * alpha values still reflect the design's natural shape. For the Phase L quad
   * path the design is already on the full canvas (composeLeft/Top = 0), so the
   * letter mask traces the WARPED ink — keeping Flux Fill aligned to the angled
   * print, not the flat rectangle.
   */
  const letterMaskBuffer = await buildLetterMaskFromDesignRgba({
    sharp,
    resizedDesignRaw: composeDesignRaw,
    actualW: composeW,
    actualH: composeH,
    designLeft: composeLeft,
    designTop: composeTop,
    nativeBlankW,
    nativeBlankH,
    OVERSAMPLE,
  });

  const designWithOpacity = applyOpacityToRgbaBuffer(composeDesignRaw, effectiveOpacity);
  const designPremultiplied = premultiplyRgbaBuffer(designWithOpacity);
  const designForComposite = await sharp(designPremultiplied, {
    raw: { width: composeW, height: composeH, channels: 4, premultiplied: true },
  })
    .png()
    .toBuffer();

  /** Composite at composeLeft/composeTop the mask used — keeps mask + design aligned. */
  const oversampledComposite = await sharp(blankBuffer)
    .composite([{ input: designForComposite, left: composeLeft, top: composeTop, blend: blendMode, premultiplied: true }])
    .png()
    .toBuffer();

  /**
   * Single high-quality downsample from the 2× working space back to native blank
   * dimensions. The design layer had 4× more pixels through the compose pipeline, so
   * after this one-pass downsample to native, text edges stay crisp. Final PNG is the
   * same size as before the oversampling change — no bandwidth penalty downstream.
   */
  const previewBuffer = await sharp(oversampledComposite)
    .resize(nativeBlankW, nativeBlankH, { kernel: "lanczos3" })
    .png()
    .toBuffer();

  const timestamp = Date.now();
  const variantSuffix = variant && variant.variantId ? `_${variant.variantId}` : "";
  /**
   * Storage layout: include renderTarget so model previews don't overwrite
   * flat previews of the same (blank, view, variant) and vice versa. The
   * legacy `flat_<view>` path stays `…/{view}/…` for backward compat — only
   * model targets get the extra segment.
   */
  const targetSegment = isModelTarget ? `/${renderTarget}` : "";
  const storagePath = `rp/blank_previews/${blankId}/${view}${targetSegment}/_preview${variantSuffix}_${timestamp}.png`;
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const downloadToken = `${timestamp}_${Math.floor(Math.random() * 1e6).toString(16)}`;
  await file.save(previewBuffer, {
    contentType: "image/png",
    metadata: {
      contentType: "image/png",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
    resumable: false,
  });
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  const stageAMeta = await sharp(previewBuffer).metadata();

  return {
    stageA: {
      previewUrl: downloadUrl,
      storagePath,
      width: stageAMeta.width || blankWidth,
      height: stageAMeta.height || blankHeight,
      bytes: previewBuffer.length,
      maskApplied,
      maskMean: maskMean != null ? Math.round(maskMean) : null,
      maskMode,
      /** Phase L: true when the design was perspective-warped onto the model
       *  print quad (deterministic angled placement) vs the legacy flat paste. */
      quadWarpApplied,
      placementUsed: { x, y, scale: effectiveScale, blendMode: blendModeRequested, blendOpacity: effectiveOpacity },
    },
    /** Chained handoff for Stage B — kept in memory so we don't re-fetch. */
    draftBuffer: previewBuffer,
    draftMeta: stageAMeta,
    /** v8: letter-shaped mask built from the design's alpha. Stage B uses this to
     *  inpaint ONLY the ink pixels. White=regenerate, black=preserve. */
    letterMaskBuffer,
    /** v8.1: ink colors threaded into the Flux Fill prompt so the regenerated
     *  pixels aren't gray. Flux Fill doesn't condition on the input pixels
     *  inside the mask — it regenerates from prompt alone. Without color info
     *  the masked region comes out monochrome. */
    designColors: Array.isArray(design.colors) ? design.colors : [],
    variantSuffix,
    timestamp,
    variant,
    /** Forward to composeStageB so its storage path stays aligned with Stage A. */
    renderTarget,
  };
}

/**
 * Stage B (AI realism) — runs the configured VTON provider on Stage A output,
 * saves the result to Storage, returns the persisted `stageB` summary.
 *
 * Phase B: provider is dispatched through `vtonProviders` registry. `providerId`
 * defaults to `flux_fill` for back-compat with legacy jobs (which were created
 * before the registry existed). Kolors VTO and future providers slot in by
 * registering themselves and being chosen by the operator at job-creation time.
 */
async function composeStageB({
  db,
  storage,
  sharp,
  functions,
  blankId,
  view,
  draftBuffer,
  draftMeta,
  letterMaskBuffer,
  designColors,
  variantSuffix,
  timestamp,
  fabricFeel,
  printStrength,
  renderTarget,
  /** Phase B: id of the registered VTON provider to dispatch through. */
  providerId,
  /** Phase B: variant model photo URL — required by providers like Kolors VTO. */
  modelImageUrl,
  /** Phase I: identity reference photo URLs — required by flux_2_multireference. */
  referenceImageUrls,
  /** Phase I: identity doc id, surfaced for telemetry + future provider needs. */
  identityId,
}) {
  const falApiKey = getFalApiKey(functions);
  if (!falApiKey) {
    throw new Error("FAL_API_KEY is not configured — cannot run AI realism pass");
  }
  const resolvedProviderId =
    typeof providerId === "string" && providerId.length > 0 ? providerId : DEFAULT_VTON_PROVIDER_ID;
  const provider = getVtonProvider(resolvedProviderId);
  console.log(
    `[stageB] provider=${provider.id} endpoint=${provider.endpoint} renderTarget=${renderTarget || `flat_${view}`}`
  );

  const realism = await provider.runVtonPass({
    sharp,
    fetchFn: fetch,
    falApiKey,
    blankId,
    view,
    draftBuffer,
    draftMeta,
    /** Mask: Flux Fill needs it; Kolors VTO ignores it; future providers may use it. */
    letterMaskBuffer,
    /** Model photo URL: required by Kolors VTO; null for Flux Fill (which composites upstream). */
    modelImageUrl: modelImageUrl || null,
    /**
     * Phase I: identity reference photo URLs. Required by flux_2_multireference;
     * ignored by Flux Fill / Kolors VTO. Empty array when no identity attached.
     */
    referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls : [],
    identityId: identityId || null,
    designColors,
    fabricFeel: Number.isFinite(Number(fabricFeel)) ? Number(fabricFeel) : 0.5,
    printStrength: Number.isFinite(Number(printStrength)) ? Number(printStrength) : 0.7,
  });
  const realismMeta = await sharp(realism.buffer).metadata();
  const realismToken = `${timestamp}_realism_${Math.floor(Math.random() * 1e6).toString(16)}`;
  /** Same target-aware layout as Stage A so paired Stage A/B PNGs end up adjacent. */
  const isModelTarget = renderTarget === "model_front" || renderTarget === "model_back";
  const targetSegment = isModelTarget ? `/${renderTarget}` : "";
  const realismPath = `rp/blank_previews/${blankId}/${view}${targetSegment}/_preview${variantSuffix}_${timestamp}_realism.png`;
  const bucket = storage.bucket();
  const realismFile = bucket.file(realismPath);
  await realismFile.save(realism.buffer, {
    contentType: "image/png",
    metadata: {
      contentType: "image/png",
      metadata: { firebaseStorageDownloadTokens: realismToken },
    },
    resumable: false,
  });
  const realismUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(realismPath)}?alt=media&token=${realismToken}`;
  return {
    stageB: {
      previewUrl: realismUrl,
      storagePath: realismPath,
      bytes: realism.buffer.length,
      width: realismMeta.width || draftMeta.width,
      height: realismMeta.height || draftMeta.height,
      falEndpoint: realism.falEndpoint,
      /**
       * Phase B: which provider produced this realism PNG. Surfaced on the
       * stageB summary so the A/B comparison UI can label each result and
       * the job doc carries the provenance for later inspection.
       */
      providerId: provider.id,
      params: realism.params,
      /**
       * Phase A: telemetry surfaced from runFalInference. The job trigger
       * (onBlankPreviewJobCreated) stamps these onto the rp_blank_preview_jobs
       * doc as falCostUsd / falLatencyMs / falRequestId so the dashboard
       * cost-meter widget can aggregate them.
       */
      inference: {
        costUsd: realism.falCostUsd,
        latencyMs: realism.falLatencyMs,
        endpoint: realism.falEndpoint,
        requestId: realism.falRequestId,
      },
    },
  };
}

function buildPreviewBlankRender({ db, storage, functions, sharp, admin }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);
    const input = validatePreviewInput(functions, data);

    /**
     * Async path: when realism is requested, the sync HTTP gateway times out at ~60s
     * (flux inpaint + polling = 30–60s). Enqueue a job doc and return its ID; the
     * trigger `onBlankPreviewJobCreated` runs Stage A then Stage B and writes results
     * back to the doc. The client subscribes via `onSnapshot` and progresses the UI.
     */
    if (input.withRealism) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      const jobData = {
        blankId: input.blankId,
        variantId: input.variantId,
        designId: input.designId,
        view: input.view,
        /** Per-target render surface (flat_* or model_*); the trigger uses this to pick the
         *  garment photo + mask doc id when re-running Stage A. */
        renderTarget: input.renderTarget,
        artworkMode: input.artworkMode,
        placement: input.placement,
        /** Persist the editor's resolved design URL so the trigger composites the same image. */
        designUrlOverride: input.designUrlOverride,
        withRealism: true,
        /**
         * Phase B: persist the VTON provider choice on the job doc. Null →
         * trigger defaults to DEFAULT_VTON_PROVIDER_ID (flux_fill).
         */
        providerId: input.providerId,
        /**
         * Phase I: identity attachment. When set, the trigger pulls reference
         * photos from rp_identities/{identityId}.referenceImages and routes
         * the realism call through the identity's preferredProviderId
         * (typically flux_2_multireference).
         */
        identityId: input.identityId,
        status: "queued",
        error: null,
        stageA: null,
        stageB: null,
        createdAt: now,
        createdByUid: uid,
        updatedAt: now,
      };
      const jobRef = await db.collection("rp_blank_preview_jobs").add(jobData);
      return { jobId: jobRef.id, status: "queued" };
    }

    /** Sync path: Stage A only — fast enough to finish well within the gateway window. */
    const { stageA, variant } = await composeStageA({ db, storage, sharp, functions, input });
    return {
      previewUrl: stageA.previewUrl,
      storagePath: stageA.storagePath,
      width: stageA.width,
      height: stageA.height,
      bytes: stageA.bytes,
      stage: "A",
      stageA,
      stageB: null,
      maskApplied: stageA.maskApplied,
      maskMean: stageA.maskMean,
      maskMode: stageA.maskMode,
      /** Phase L: surface the chest-quad-warp flag on the sync path too. */
      quadWarpApplied: stageA.quadWarpApplied,
      artworkMode: input.artworkMode,
      placementUsed: stageA.placementUsed,
      variantId: variant ? variant.variantId : null,
    };
  };
}

/**
 * Firestore trigger that drains `rp_blank_preview_jobs/{jobId}`. Runs Stage A → writes
 * `stageA`, then (when `withRealism`) Stage B → writes `stageB`, then sets
 * status="completed". On any error, writes status="failed" + error message.
 *
 * The client subscribes to the doc via `onSnapshot` and renders progressive UI
 * (queued → stageA visible → stageB visible / failed). This bypasses the synchronous
 * Firebase callable HTTP gateway's ~60s ceiling.
 */
function buildOnBlankPreviewJobCreated({ db, storage, admin, functions, sharp }) {
  return async (snap, eventContext) => {
    const job = snap.data();
    const jobId = eventContext && eventContext.params ? eventContext.params.jobId : (snap.id || "?");
    if (!job || job.status !== "queued") {
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} not queued (status=${job && job.status}), skipping`);
      return;
    }

    const jobRef = db.collection("rp_blank_preview_jobs").doc(jobId);
    const tick = () => admin.firestore.FieldValue.serverTimestamp();

    try {
      await jobRef.update({ status: "processing", updatedAt: tick() });

      const input = {
        blankId: job.blankId,
        variantId: job.variantId || null,
        designId: job.designId,
        view: job.view,
        /**
         * Default to flat for legacy job docs created before Phase 2 (they have
         * no renderTarget field). New jobs always set this; the model_* path
         * requires it to be present.
         */
        renderTarget: job.renderTarget || `flat_${job.view}`,
        artworkMode: job.artworkMode || "light",
        placement: job.placement || {},
        withRealism: job.withRealism === true,
        designUrlOverride: typeof job.designUrlOverride === "string" ? job.designUrlOverride : null,
      };

      /**
       * Phase 3 product binding: when the job was queued by the production
       * pipeline (`enqueueProductModelRealism` callable), it carries
       * targetProductId + targetVariantId + officialRole. After Stage B
       * completes we write the realism URL onto the variant's flatRenders
       * slot — best-effort, never fails the job.
       */
      const targetProductId =
        typeof job.targetProductId === "string" && job.targetProductId.trim() ? job.targetProductId.trim() : null;
      const targetVariantId =
        typeof job.targetVariantId === "string" && job.targetVariantId.trim() ? job.targetVariantId.trim() : null;
      const officialRole =
        typeof job.officialRole === "string" && job.officialRole.trim() ? job.officialRole.trim() : null;

      const stageAResult = await composeStageA({ db, storage, sharp, functions, input });
      await jobRef.update({ stageA: stageAResult.stageA, updatedAt: tick() });
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} Stage A done`);

      if (input.withRealism) {
        /**
         * Phase I: resolve identity FIRST (if attached to this job). An identity
         * with mode="reference_images" or "hybrid" can override the job-level
         * providerId — its preferredProviderId wins because the identity owns
         * the reference photos that the chosen provider needs. We also pass
         * the reference URLs through to composeStageB so the provider can
         * thread them into the inference call.
         *
         * Resolution order for the providerId:
         *   1. Explicit job.providerId (A/B harness sets this) — highest priority
         *   2. identity.preferredProviderId (when identity has mode=reference_images/hybrid)
         *   3. DEFAULT_VTON_PROVIDER_ID (flux_fill) — fallback
         */
        let identityDoc = null;
        let identityReferenceUrls = [];
        const identityId = typeof job.identityId === "string" && job.identityId ? job.identityId : null;
        if (identityId) {
          try {
            const idSnap = await db.collection("rp_identities").doc(identityId).get();
            if (idSnap.exists) {
              identityDoc = idSnap.data();
              if (Array.isArray(identityDoc.referenceImages)) {
                identityReferenceUrls = identityDoc.referenceImages
                  .map((r) => (r && typeof r.url === "string" ? r.url : null))
                  .filter(Boolean);
              }
            } else {
              console.warn(`[trigger] identity ${identityId} on job ${jobId} not found, skipping identity resolution`);
            }
          } catch (idErr) {
            console.warn(`[trigger] identity lookup failed for ${identityId}: ${idErr && idErr.message}`);
          }
        }

        /**
         * Phase B: providerId picks which VTON pipeline runs. Legacy job docs
         * (pre-registry) had no field — default to `flux_fill` so they keep
         * working byte-identical to pre-refactor. The A/B harness sets this
         * explicitly when fanning out N jobs across providers.
         */
        let providerId;
        if (typeof job.providerId === "string" && job.providerId.length > 0) {
          /** Explicit job override (A/B harness, manual operator selection) — wins. */
          providerId = job.providerId;
        } else if (
          identityDoc &&
          (identityDoc.mode === "reference_images" || identityDoc.mode === "hybrid") &&
          typeof identityDoc.preferredProviderId === "string" &&
          identityDoc.preferredProviderId.length > 0 &&
          identityReferenceUrls.length > 0
        ) {
          /** Identity declares its preferred provider AND has reference photos. */
          providerId = identityDoc.preferredProviderId;
          console.log(
            `[trigger] identity ${identityId} (mode=${identityDoc.mode}) routes to provider ${providerId} with ${identityReferenceUrls.length} refs`
          );
        } else {
          providerId = DEFAULT_VTON_PROVIDER_ID;
        }
        /**
         * Phase B: Kolors VTO needs the variant's model photo URL as a
         * separate input (it doesn't read from draftBuffer). Resolve it here
         * from the same variant we used for Stage A so the URL stays in
         * lockstep with the model image driving the composite.
         */
        const modelImageUrl =
          stageAResult.variant && stageAResult.variant.images
            ? (input.renderTarget === "model_back"
                ? stageAResult.variant.images.modelBack
                : stageAResult.variant.images.modelFront) || null
            : null;
        const stageBResult = await composeStageB({
          db,
          storage,
          sharp,
          functions,
          blankId: input.blankId,
          view: input.view,
          draftBuffer: stageAResult.draftBuffer,
          draftMeta: stageAResult.draftMeta,
          letterMaskBuffer: stageAResult.letterMaskBuffer,
          designColors: stageAResult.designColors,
          variantSuffix: stageAResult.variantSuffix,
          timestamp: stageAResult.timestamp,
          fabricFeel: Number.isFinite(Number(input.placement && input.placement.fabricFeel))
            ? Number(input.placement.fabricFeel)
            : 0.5,
          printStrength: Number.isFinite(Number(input.placement && input.placement.printStrength))
            ? Number(input.placement.printStrength)
            : 0.7,
          renderTarget: input.renderTarget,
          providerId,
          modelImageUrl:
            modelImageUrl && typeof modelImageUrl.downloadUrl === "string"
              ? modelImageUrl.downloadUrl
              : null,
          /** Phase I: identity reference URLs threaded into the provider's ctx. */
          referenceImageUrls: identityReferenceUrls,
          identityId,
        });
        /**
         * Phase A cost meter: lift the falCostUsd/falLatencyMs/falEndpoint/
         * falRequestId fields onto the job doc top-level so the dashboard
         * widget can aggregate without descending into stageB.inference. The
         * `inference` block is also kept inside stageB for the per-render
         * audit trail (one job can re-run; the top-level fields reflect the
         * latest successful realism pass).
         */
        const inferenceTelemetry = stageBResult.stageB && stageBResult.stageB.inference
          ? stageBResult.stageB.inference
          : null;
        const jobUpdate = {
          stageB: stageBResult.stageB,
          updatedAt: tick(),
        };
        if (inferenceTelemetry) {
          jobUpdate.falCostUsd = inferenceTelemetry.costUsd;
          jobUpdate.falLatencyMs = inferenceTelemetry.latencyMs;
          jobUpdate.falEndpoint = inferenceTelemetry.endpoint;
          jobUpdate.falRequestId = inferenceTelemetry.requestId;
        }
        await jobRef.update(jobUpdate);
        console.log(
          `[onBlankPreviewJobCreated] Job ${jobId} Stage B done` +
            (inferenceTelemetry
              ? ` — cost=$${inferenceTelemetry.costUsd ?? "?"} latency=${inferenceTelemetry.latencyMs}ms`
              : "")
        );

        /**
         * Phase 3: best-effort write to product variant slot. Wrapped in its
         * own try/catch so a missing product / variant / write conflict
         * doesn't flip the job to failed — the preview file is still saved
         * and the operator can manually re-bind if needed.
         */
        if (targetProductId && targetVariantId && officialRole && stageBResult.stageB && stageBResult.stageB.previewUrl) {
          try {
            const variantRef = db
              .collection("rp_products")
              .doc(targetProductId)
              .collection("variants")
              .doc(targetVariantId);
            const variantSnap = await variantRef.get();
            if (!variantSnap.exists) {
              console.warn(
                `[onBlankPreviewJobCreated] Job ${jobId}: product variant ${targetProductId}/${targetVariantId} not found, skipping write`
              );
            } else {
              const existingFlatRenders = (variantSnap.data() || {}).flatRenders || {};
              const merged = {
                ...existingFlatRenders,
                [officialRole]: {
                  ...(existingFlatRenders[officialRole] || {}),
                  url: stageBResult.stageB.previewUrl,
                  storagePath: stageBResult.stageB.storagePath,
                  width: stageBResult.stageB.width,
                  height: stageBResult.stageB.height,
                  bytes: stageBResult.stageB.bytes,
                  source: "preview_render_realism",
                  jobId,
                  updatedAt: tick(),
                },
              };
              await variantRef.update({
                flatRenders: merged,
                updatedAt: tick(),
                updatedBy: "preview_render_trigger",
              });
              console.log(
                `[onBlankPreviewJobCreated] Job ${jobId}: wrote ${officialRole} to ${targetProductId}/${targetVariantId}`
              );
            }
          } catch (writeErr) {
            console.error(
              `[onBlankPreviewJobCreated] Job ${jobId}: product variant write failed:`,
              writeErr && writeErr.message ? writeErr.message : writeErr
            );
          }
        }
      }

      await jobRef.update({ status: "completed", updatedAt: tick() });
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} completed`);
    } catch (err) {
      console.error(`[onBlankPreviewJobCreated] Job ${jobId} failed:`, err && err.message);
      await jobRef
        .update({
          status: "failed",
          error: err && err.message ? String(err.message) : "Unknown error",
          updatedAt: tick(),
        })
        .catch((updateErr) => {
          console.error(`[onBlankPreviewJobCreated] Failed to record error on ${jobId}:`, updateErr && updateErr.message);
        });
    }
  };
}

/**
 * Phase B A/B harness — fan out N rp_blank_preview_jobs from one set of
 * inputs, one per VTON provider. All jobs share an `abTestGroupId` so the
 * comparison UI can query them as a set.
 *
 * Each job runs Stage A independently (Stage A is cheap — deterministic Sharp
 * composite, no fal.ai). That's intentional: we accept the small cost of
 * re-running Stage A 2-3 times in exchange for keeping the trigger pipeline
 * uniform (one job = one Stage A + Stage B, no special "shared Stage A" path).
 *
 * The trigger already handles per-provider Stage B dispatch via the
 * providerId field on each job doc, so fan-out is just "create N docs."
 */
function buildEnqueueVtonAbTest({ db, functions, admin }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);

    /**
     * Re-use validatePreviewInput so the inputs match the single-job callable
     * exactly. The only delta is `providerIds: string[]` (which providers to
     * fan out across); the single-job `providerId` field on data is ignored
     * here — the array is authoritative for A/B mode.
     */
    const baseInput = validatePreviewInput(functions, { ...data, providerId: null, withRealism: true });
    if (!baseInput.withRealism) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A/B test requires withRealism=true (single-stage A/B is meaningless — all providers run Stage B)"
      );
    }

    const { providerIds: providerIdsIn } = data || {};
    if (!Array.isArray(providerIdsIn) || providerIdsIn.length < 2) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "providerIds must be an array of 2+ provider ids — A/B with one provider isn't an A/B test"
      );
    }
    if (providerIdsIn.length > 5) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "providerIds is capped at 5 — each provider costs $$ + ~30s; fan-out larger than this is rarely useful"
      );
    }
    // Validate every provider id BEFORE we create any docs — partial fan-out is worse than total failure.
    // eslint-disable-next-line global-require
    const { getVtonProvider } = require("./vtonProviders");
    const validated = providerIdsIn.map((id) => {
      if (typeof id !== "string" || id.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", `Invalid providerId: ${JSON.stringify(id)}`);
      }
      try {
        getVtonProvider(id);
      } catch (e) {
        throw new functions.https.HttpsError("invalid-argument", e.message);
      }
      return id;
    });
    const uniqueIds = [...new Set(validated)];
    if (uniqueIds.length !== validated.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "providerIds contains duplicates — each provider should appear once in an A/B set"
      );
    }

    /**
     * Phase E atomic fan-out. The parent rp_batches doc + every
     * rp_blank_preview_jobs doc land in a single Firestore commit so a
     * mid-fan-out timeout can't leave us with N-1 jobs and no batch row.
     *
     * abTestGroupId is preserved on every child for back-compat with the
     * existing comparison UI (which queries by abTestGroupId). The new
     * batchId is the rp_batches doc id — orthogonal to abTestGroupId but
     * authoritative for batch-level state.
     */
    const abTestGroupId = `ab_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobs = uniqueIds.map((providerId) => ({
      collectionPath: "rp_blank_preview_jobs",
      data: {
        blankId: baseInput.blankId,
        variantId: baseInput.variantId,
        designId: baseInput.designId,
        view: baseInput.view,
        renderTarget: baseInput.renderTarget,
        artworkMode: baseInput.artworkMode,
        placement: baseInput.placement,
        designUrlOverride: baseInput.designUrlOverride,
        withRealism: true,
        providerId,
        /**
         * Phase I: every job in an A/B fan-out shares the same identityId
         * so the comparison is "this identity rendered by 3 different
         * providers" rather than "3 different identities." If one of the
         * providers in the set doesn't use identity refs (e.g. flux_fill),
         * the trigger just ignores the field for that provider.
         */
        identityId: baseInput.identityId,
        abTestGroupId,
        status: "queued",
        error: null,
        stageA: null,
        stageB: null,
        createdAt: now,
        createdByUid: uid,
        updatedAt: now,
      },
    }));

    const { batchId, jobRefs } = await createBatchAtomically({
      db,
      admin,
      kind: "vton_ab",
      createdByUid: uid,
      metadata: {
        productId: null,
        variantId: baseInput.variantId,
        providerIds: uniqueIds,
        label: `VTON A/B (${uniqueIds.length} providers)`,
      },
      jobs,
    });

    const jobIds = Object.fromEntries(
      uniqueIds.map((id, i) => [id, jobRefs[i].id])
    );

    return {
      abTestGroupId,
      batchId,
      jobIds,
      providerCount: uniqueIds.length,
    };
  };
}

module.exports = {
  buildPreviewBlankRender,
  buildOnBlankPreviewJobCreated,
  buildEnqueueVtonAbTest,
  runRealismPass,
  hexToColorName,
  buildLetterMaskFromDesignRgba,
};
