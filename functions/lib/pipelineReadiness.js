"use strict";

/**
 * Single source of truth for which blank style codes can be auto-launched
 * through the design → asset → product pipeline today, plus per-blank feature
 * flags the renderer needs to know about.
 *
 * Why a registry instead of inline `styleCode === "8394"` checks:
 *   - The same gate has to be applied in 3+ places (bulk-upload preview,
 *     onDesignCreated trigger, startInitialProductAssetBatch). One source =
 *     one place to update when a new blank is activated.
 *   - Future blanks will have different render requirements (flat vs warped,
 *     front-only vs front+back, mask required vs not). Per-blank flags keep
 *     that variance explicit.
 *   - The bulk-upload UI's "Apply to blanks" picker needs to show which blanks
 *     are pipeline-ready and disable the rest — that decision must match the
 *     trigger's decision, or operators get stale-stub products.
 *
 * Adding a new blank: drop in an entry, flip `pipelineReady: true` once the
 * gaps below are closed, redeploy. The bulk-upload picker auto-lights up.
 *
 * Mirror: client `lib/blanks/pipelineReadiness.ts` is NOT created yet because
 * the only client consumer (bulk-upload preview UI) reads availableBlanks from
 * the server preview engine, which uses this registry. If a client-only path
 * starts needing the same flags, mirror it then.
 */

/**
 * @typedef {Object} BlankPipelineConfig
 * @property {string} styleCode               — matches blank.styleCode
 * @property {string} displayName             — human label for logs / UI fallback
 * @property {boolean} pipelineReady          — true → operators can select this blank in the bulk-upload picker AND onDesignCreated will spawn products for it. False = "soon" in the UI.
 * @property {boolean} requiresWarp           — true for curved garments (panty 8394, thong 8390) where the design must wrap around the body. False for flat garments (tank, crewneck) where the design is applied to a flat printable area.
 * @property {boolean} requiresMask           — true → renderer needs a mask in rp_blank_masks to clip the design to the printable area. Almost always true.
 * @property {("front"|"back")[]} supportedSides — which placement sides the renderer composes for this blank today.
 * @property {string=} blockingGaps           — human-readable list of what's missing before pipelineReady can flip true. Surfaced in the readiness audit script.
 */

/** @type {Record<string, BlankPipelineConfig>} */
const PIPELINE_CONFIG_BY_STYLE_CODE = {
  "8394": {
    styleCode: "8394",
    displayName: "Bikini Panty (LA Apparel)",
    pipelineReady: true,
    requiresWarp: true,
    requiresMask: true,
    supportedSides: ["front", "back"],
    /** Side(s) the DESIGN is printed on (drives the official "designed" flat role).
        Panty prints on the back; the front is a clean garment shot. */
    designPrintSides: ["back"],
  },
  "8390": {
    styleCode: "8390",
    displayName: "Thong Panty (LA Apparel)",
    pipelineReady: true,
    requiresWarp: true,
    requiresMask: true,
    supportedSides: ["front", "back"],
    designPrintSides: ["back"],
    /**
     * Activated 2026-05-27. The `applyDesignWarp8394` helper is named after
     * 8394 but the math (affine + scale) is generic and config-driven — it
     * early-exits when `warp.enabled` is false. Operator should:
     *   - Generate a mask per variant via the Blanks editor for clean edges
     *   - Tune per-variant warp values (warpStrength / verticalStretch /
     *     horizontalWarp) in the Blank Render Profile editor; the thong's
     *     curved geometry typically wants different values than the panty
     *   - Configure scene presets for model composites (flat works without)
     */
  },
  TR3008: {
    styleCode: "TR3008",
    displayName: "Tri-blend Racerback Tank (LA Apparel)",
    pipelineReady: true,
    requiresWarp: false,
    requiresMask: true,
    supportedSides: ["front", "back"],
    /** Apparel prints on the chest (front); design composites onto the front. */
    designPrintSides: ["front"],
    /**
     * Activated 2026-05-27. Generic sharp pipeline runs (placement, blend);
     * warp + mask early-exit when their per-render `enabled` flags are false.
     * Operators still need to:
     *   - Generate a mask via the Blanks editor for cleaner edges (optional)
     *   - Set per-variant render parameters (placement, scale, blend) for
     *     each color via the Blank Render Profile editor
     *   - Configure scene presets if model/scene composites are wanted
     *     (flat composites work without presets).
     * If mockups look wrong, run scripts/blank-pipeline-readiness-audit.js
     * for a per-blank checklist.
     */
  },
  HF07: {
    styleCode: "HF07",
    displayName: "Heavy Fleece Crewneck (LA Apparel)",
    pipelineReady: true,
    requiresWarp: false,
    requiresMask: true,
    supportedSides: ["front", "back"],
    /** Crewneck prints on the chest (front); design composites onto the front. */
    designPrintSides: ["front"],
    /**
     * Activated 2026-05-27. Same approach as TR3008 — flat garment, warp
     * step early-exits via per-render config, generic sharp pipeline runs.
     * Operator should generate per-variant masks and tune per-color render
     * params via the editor.
     */
  },
};

/** Lowercased-styleCode lookup so callers don't have to remember the case (TR3008 vs tr3008). */
function pipelineConfigForStyleCode(styleCode) {
  const key = String(styleCode || "").trim();
  if (!key) return null;
  if (PIPELINE_CONFIG_BY_STYLE_CODE[key]) return PIPELINE_CONFIG_BY_STYLE_CODE[key];
  const upper = key.toUpperCase();
  if (PIPELINE_CONFIG_BY_STYLE_CODE[upper]) return PIPELINE_CONFIG_BY_STYLE_CODE[upper];
  return null;
}

/** True when `blank.styleCode` is in the ready set. The bulk-upload picker + trigger both use this. */
function isPipelineReadyStyleCode(styleCode) {
  const cfg = pipelineConfigForStyleCode(styleCode);
  return !!(cfg && cfg.pipelineReady === true);
}

/** Set of all ready style codes — for any code path that wants the raw list. */
function pipelineReadyStyleCodes() {
  return new Set(
    Object.values(PIPELINE_CONFIG_BY_STYLE_CODE)
      .filter((c) => c.pipelineReady === true)
      .map((c) => c.styleCode)
  );
}

/** All registered style codes (ready + not-ready) — for the bulk-upload picker so operators see "soon" badges. */
function allRegisteredStyleCodes() {
  return new Set(Object.keys(PIPELINE_CONFIG_BY_STYLE_CODE));
}

/** Whether the renderer should run the design-warp step for this blank. False for flat garments. */
function styleCodeRequiresWarp(styleCode) {
  const cfg = pipelineConfigForStyleCode(styleCode);
  return !!(cfg && cfg.requiresWarp === true);
}

/**
 * Side(s) the DESIGN is printed on for this blank — drives which official flat
 * role is "designed" vs a clean garment shot. Back-print blanks (panty/thong)
 * get flat_back_designed; front-print apparel (tank/crewneck) gets
 * flat_front_designed. Defaults to ["back"] for unknown codes (legacy 8394
 * behavior) so nothing regresses.
 */
function designPrintSidesForStyleCode(styleCode) {
  const cfg = pipelineConfigForStyleCode(styleCode);
  const sides = cfg && Array.isArray(cfg.designPrintSides) ? cfg.designPrintSides : null;
  return sides && sides.length ? sides : ["back"];
}

module.exports = {
  PIPELINE_CONFIG_BY_STYLE_CODE,
  pipelineConfigForStyleCode,
  isPipelineReadyStyleCode,
  pipelineReadyStyleCodes,
  allRegisteredStyleCodes,
  styleCodeRequiresWarp,
  designPrintSidesForStyleCode,
};
