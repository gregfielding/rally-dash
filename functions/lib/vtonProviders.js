"use strict";

/**
 * Phase B — VTON (Virtual Try-On) provider registry.
 *
 * Background: Rally's Stage B realism pass was a single hardcoded call to
 * Flux Fill (`fal-ai/flux-pro/v1/fill`). The strategic review identified
 * multiple competing approaches in 2026 — Kolors VTO v1.5, FLUX 2 VTO,
 * Kontext, plus mask-based inpainting variants — each with different
 * quality / cost / latency tradeoffs. The right tool depends on the input
 * and the desired aesthetic, and operators won't know which one wins for
 * Rally's specific use case (team-themed apparel, screen-print look,
 * matte cotton fabric) without side-by-side comparison.
 *
 * This module defines the provider interface + a registry. Each provider:
 *
 *   - Has a stable `id` referenced from `RPBlankPreviewJob.providerId`
 *     (legacy jobs without the field default to `flux_fill` for back-compat).
 *   - Owns its FULL pipeline from Stage A buffers → final realism buffer.
 *     This is intentional — Flux Fill needs prompt tuning + a mask + a v10
 *     hybrid post-composite; Kolors VTO needs none of that. Forcing the
 *     providers through a "common payload" abstraction would either bloat
 *     the contract or leak Flux-Fill assumptions everywhere.
 *   - Returns `{ buffer, falCostUsd, falLatencyMs, falEndpoint, falRequestId, params }`
 *     so the trigger can stamp telemetry uniformly across providers.
 *
 * Adding a new provider:
 *   1. Implement `runVtonPass(ctx)` returning the standard shape.
 *   2. Register it via `registerVtonProvider({...})`.
 *   3. Add its endpoint to FAL_ENDPOINT_PRICING (functions/lib/falInference.js)
 *      so the cost meter picks up its spend.
 *   4. (Phase B4) Add it to the A/B comparison UI list.
 *
 * The provider implementations themselves live in companion files
 * (`vtonProviderFluxFill.js`, `vtonProviderKolorsVto.js`) so this registry
 * stays a thin lookup table. Don't put inference logic in this file.
 */

const VTON_PROVIDER_DEFINITIONS = new Map();

/**
 * @typedef {Object} VtonProviderCapabilities
 * @property {boolean} requiresMask        Provider needs a letterMaskBuffer from Stage A
 *                                          (Flux Fill yes; Kolors VTO no — it derives garment
 *                                          boundary itself from the input image).
 * @property {boolean} requiresPrompt      Provider's quality depends on a text prompt
 *                                          (Flux Fill yes; Kolors VTO no).
 * @property {boolean} requiresModelPhoto  Provider needs a separate human/model photo URL,
 *                                          not just a draft buffer (Kolors VTO yes; Flux Fill
 *                                          composites onto model upstream so no).
 * @property {boolean} producesHybridComposite Provider's raw output needs Stage A color preservation
 *                                          via the v10 hybrid composite (Flux Fill yes — it drifts
 *                                          on color; Kolors VTO no — its color fidelity is good).
 * @property {boolean} experimental        Provider hasn't been validated for production use yet;
 *                                          UI shows a warning chip.
 */

/**
 * @typedef {Object} VtonProviderDefinition
 * @property {string} id                          Stable identifier ("flux_fill", "kolors_vto").
 * @property {string} label                       Human-readable name for the UI.
 * @property {string} description                 One-liner for the A/B picker.
 * @property {string} endpoint                    fal.ai endpoint slug (also in FAL_ENDPOINT_PRICING).
 * @property {VtonProviderCapabilities} capabilities
 * @property {(ctx: VtonProviderContext) => Promise<VtonProviderResult>} runVtonPass
 */

/**
 * @typedef {Object} VtonProviderContext  — uniform input bag for every provider's runVtonPass.
 *
 * Providers pick what they need from this bag. Don't add provider-specific fields here;
 * if a provider needs something exotic, derive it inside its own runVtonPass from the
 * stable fields below.
 *
 * @property {import('sharp')} sharp              Sharp factory (required by every Stage B path).
 * @property {Function} fetchFn                   global fetch override (testability).
 * @property {string} falApiKey
 * @property {string} blankId
 * @property {"front"|"back"} view
 * @property {Buffer} draftBuffer                 Stage A composite (design on garment / on model).
 * @property {{width:number,height:number}} draftMeta
 * @property {Buffer|null} letterMaskBuffer       Letter-shaped mask from Stage A. May be null for
 *                                                providers that derive their own boundary.
 * @property {string|null} modelImageUrl          Public URL of the variant's model photo
 *                                                (variant.images.modelFront/Back). Null when
 *                                                Stage A's draftBuffer already includes the model
 *                                                composite (the typical Rally case).
 * @property {Array<{hex:string,name?:string}>|null} designColors
 *                                                Ink colors from the design doc (for Flux Fill
 *                                                color injection).
 * @property {number} fabricFeel                  0..1 slider — texture/weave-through emphasis.
 * @property {number} printStrength               0..1 slider — ink vividness.
 */

/**
 * @typedef {Object} VtonProviderResult
 * @property {Buffer} buffer                      Final realism PNG, identical-sized to draftBuffer.
 * @property {number|null} falCostUsd             From the price table lookup.
 * @property {number} falLatencyMs                Wall-clock from submit to result extraction.
 * @property {string} falEndpoint                 Echoed endpoint slug for the job doc.
 * @property {string|null} falRequestId           fal.ai request_id (support / dedupe).
 * @property {Object} params                      Provider-specific badge data (cfg, steps, seed,
 *                                                slider state, blend alpha, etc.). Free-form;
 *                                                shown in the editor pill for debugging.
 */

/**
 * Register a provider. Idempotent — registering the same id twice replaces the
 * previous entry. Returns the registry for chaining if you ever need it.
 */
function registerVtonProvider(def) {
  if (!def || typeof def.id !== "string" || def.id.length === 0) {
    throw new Error("registerVtonProvider: id is required");
  }
  if (typeof def.runVtonPass !== "function") {
    throw new Error(`registerVtonProvider(${def.id}): runVtonPass must be a function`);
  }
  if (typeof def.endpoint !== "string" || def.endpoint.length === 0) {
    throw new Error(`registerVtonProvider(${def.id}): endpoint is required`);
  }
  const capabilities = {
    requiresMask: false,
    requiresPrompt: false,
    requiresModelPhoto: false,
    producesHybridComposite: false,
    experimental: false,
    ...(def.capabilities || {}),
  };
  VTON_PROVIDER_DEFINITIONS.set(def.id, {
    id: def.id,
    label: def.label || def.id,
    description: def.description || "",
    endpoint: def.endpoint,
    capabilities,
    runVtonPass: def.runVtonPass,
  });
  return VTON_PROVIDER_DEFINITIONS;
}

/**
 * Look up a provider by id. Throws on miss — callers should validate the id
 * upstream and never reach this with a bad value. (Legacy jobs without a
 * providerId field should be normalized to `DEFAULT_VTON_PROVIDER_ID` BEFORE
 * this lookup, in the trigger.)
 */
function getVtonProvider(id) {
  const def = VTON_PROVIDER_DEFINITIONS.get(id);
  if (!def) {
    const known = [...VTON_PROVIDER_DEFINITIONS.keys()].join(", ") || "(none registered)";
    throw new Error(`Unknown VTON provider "${id}". Known: ${known}`);
  }
  return def;
}

/** List all registered providers (for the A/B picker dropdown). */
function listVtonProviders() {
  return [...VTON_PROVIDER_DEFINITIONS.values()];
}

/**
 * The default provider id for jobs that don't specify one. Pinned to flux_fill
 * because every existing rp_blank_preview_jobs doc was created before the
 * registry existed and expects Flux Fill's exact behavior (including the v10
 * hybrid composite). Don't change this without backfilling the field.
 */
const DEFAULT_VTON_PROVIDER_ID = "flux_fill";

/**
 * Phase M (2026-06-02): target-aware default provider.
 *
 * Flat targets keep flux_fill — its v10 hybrid color composite is tuned for
 * flat screen-print on a plain garment. MODEL targets default to Kolors VTO:
 * it's a true garment-on-body model (warps the print to the angled torso),
 * and in Greg's A/B it held color better AND ran ~3x faster than Flux Fill on
 * the angled tank shot. This makes every product's model render auto-use the
 * right tool with zero per-render clicks; still overridable via an explicit
 * job.providerId (A/B harness) or an identity's preferredProviderId.
 */
const MODEL_TARGET_DEFAULT_PROVIDER_ID = "kolors_vto";

function defaultProviderForRenderTarget(renderTarget) {
  if (renderTarget === "model_front" || renderTarget === "model_back") {
    return MODEL_TARGET_DEFAULT_PROVIDER_ID;
  }
  return DEFAULT_VTON_PROVIDER_ID;
}

/**
 * Export the registry surface BEFORE eager-loading providers, otherwise the
 * provider files (which do `require("./vtonProviders")` to get
 * `registerVtonProvider`) hit a circular-dependency partial-export and see
 * an empty object. CommonJS resolves circular requires by returning whatever
 * is on `module.exports` at the moment of the second require — assigning
 * before the provider requires fixes the race.
 */
module.exports = {
  registerVtonProvider,
  getVtonProvider,
  listVtonProviders,
  DEFAULT_VTON_PROVIDER_ID,
  MODEL_TARGET_DEFAULT_PROVIDER_ID,
  defaultProviderForRenderTarget,
};

/**
 * Eagerly load the bundled providers so callers don't have to remember to
 * import them. Side-effect-only requires; each file calls
 * `registerVtonProvider({...})` at module load.
 */
require("./vtonProviderFluxFill");
// Phase B3: Kolors VTO provider. Comment out to disable in production until
// it's been A/B-validated for Rally's specific use case.
require("./vtonProviderKolorsVto");
// Phase I: Flux 2 multi-reference (identity-preserving via reference photos).
// Vendor-positioned as the LoRA-replacement for character consistency.
require("./vtonProviderFlux2MultiReference");
