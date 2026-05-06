import type { ResolvedSavedBlankRenderProfile } from "@/lib/products/resolveSavedBlankRenderProfile";

/**
 * **Rendering boundary:** pixel work must consume **only** `ResolvedSavedBlankRenderProfile` + fetched buffers.
 * Do not re-derive placement, sides, or blend from ad-hoc product fields inside the compositor.
 *
 * **Server implementation:** `functions/lib/officialProductFlatCompose.js` loads the profile via
 * `resolveSavedBlankRenderProfile`, then calls `render8394DesignOnGarmentSharp` with
 * `savedProfile.tuning`, `savedProfile.engineBlend`, and `savedProfile.placement`.
 *
 * @internal Browser bundles must not call Sharp; use Cloud Functions.
 */
export type RenderFromResolvedProfileArgs = {
  profile: ResolvedSavedBlankRenderProfile;
  /** Fetched garment raster (from `profile.garmentImageUrl`). */
  blankBuffer: Uint8Array;
  /** Fetched design PNG (tone-resolved). */
  designBuffer: Uint8Array;
};

export const RENDER_FROM_RESOLVED_PROFILE_IMPLEMENTATION_NOTE =
  "functions/lib/officialProductFlatCompose.js → render8394DesignOnGarmentSharp (8394)";
