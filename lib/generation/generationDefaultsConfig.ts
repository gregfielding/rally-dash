/**
 * Central defaults for product-page generation (Phase 1).
 * Prefer rp_blanks / design_teams / designs fields when present; these are fallbacks only.
 */

/** @deprecated Prefer rp_scene_presets in Firestore; kept for offline / bootstrap. */
export const FALLBACK_SCENE_PRESET_IDS = {
  /** Ecommerce / product-only (matches common seed id). */
  productOnly: "vVygHYFuqMoNhD4yYQWN",
  /** Studio / on-model. */
  onModel: "6PSbRuuBHXltiTQ4Ms21",
  /** Lifestyle on-model (alternate). */
  lifestyleOnModel: "uX9mvPDuuFrSPCmhpWFA",
} as const;

/** Deterministic scene composite key passed to generateProductSceneRender (server). */
export const DEFAULT_SCENE_RENDER_KEY = "hanger" as const;

/**
 * Keys implemented by `generateProductSceneRender` today. Other keys may appear on blanks as
 * `defaultSceneRenderKey` for forward compatibility; generation fails until a template is registered.
 * Keep aligned with `resolveSceneCompositeTemplate` in `functions/lib/productSceneRenderMvp.js`.
 */
export const IMPLEMENTED_SCENE_RENDER_KEYS = new Set<string>([DEFAULT_SCENE_RENDER_KEY]);

/**
 * Style codes where the primary merchandising view is typically the back (e.g. back print).
 * Prefer `rp_blanks.generationDefaults.primaryView` when set.
 */
export const STYLE_CODES_PRIMARY_BACK = new Set<string>(["8394"]);
