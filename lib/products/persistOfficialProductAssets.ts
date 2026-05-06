import type { ResolvedSavedBlankRenderProfile } from "@/lib/products/resolveSavedBlankRenderProfile";

/**
 * **Persistence boundary:** official product media must be materializations of the saved blank recipe
 * (`resolveSavedBlankRenderProfile`) plus deterministic storage paths.
 *
 * **8394 official flats (Cloud Function):** `functions/lib/officialProductFlatCompose.js` →
 * `savePngAndReadableUrl` under `rp_products/{productId}/variants/{variantId}/official_flat/{batchId}_{role}_{ts}.png`.
 *
 * **Variant document fields** typically updated by the flat/MVP pipeline (same recipe inputs):
 * - `flatRenders.flat_clean.front`, `flatRenders.flat_blended.back`, model slots — each may include `recipeProvenance`
 * - `media.heroFront`, `media.heroBack`, `mockupUrl`
 * - `generatedRenderOutputs[]` — each official row includes `recipeProvenance`:
 *   `resolvedFromBlankId`, `resolvedFromBlankVariantId`, `resolvedRenderTarget`, `resolvedPlacementId`,
 *   `resolvedTone`, `resolvedDesignUrl`, `sourcePathUsed`, `blankRenderProfileVersion`, `blankDocUpdatedAt`, `tuningLayer`, `recipeProvenanceSchemaVersion`
 *
 * Pass the **same** `ResolvedSavedBlankRenderProfile.printSides` into readiness (`fulfillmentSummary`,
 * `shopifySync.readinessCheck`) so gates match generation.
 */
export function officialFlat8394StoragePath(productId: string, variantId: string, batchId: string, role: string, ts: number) {
  return `rp_products/${productId}/variants/${variantId}/official_flat/${batchId}_${role}_${ts}.png`;
}

export type PersistOfficialProductAssetsContext = {
  productId: string;
  variantId: string;
  profile: ResolvedSavedBlankRenderProfile;
};
