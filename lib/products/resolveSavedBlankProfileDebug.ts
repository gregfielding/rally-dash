import type {
  DesignDoc,
  RPBlank,
  RpOfficialAssetRecipeProvenance,
  RpProduct,
  RpRenderTargetKey,
} from "@/lib/types/firestore";
import { renderTargetToSide } from "@/lib/products/resolveProductRenderProfile";
import { resolveSavedBlankRenderProfile, findBlankVariantById } from "@/lib/products/resolveSavedBlankRenderProfile";

/** Flattened row for ops/dev panel — matches server `RESOLVED_SAVED_BLANK_RENDER_PROFILE` + tone pick. */
export type ResolvedSavedBlankProfileDebugRow = {
  /** Same as `rp_blanks` document id — aligns with `recipeProvenance.resolvedFromBlankId`. */
  resolvedBlankId: string;
  blankDocPath: string;
  blankVariantId: string;
  renderTarget: RpRenderTargetKey;
  garmentImageUrl: string | null;
  placementId: string | null;
  tuningLayer: string | null;
  effectiveFront: boolean;
  effectiveBack: boolean;
  primaryPlacementSide: "front" | "back";
  /** Same as `garmentImageUrl`; aligns with `recipeProvenance.resolvedGarmentImageUrl`. */
  resolvedGarmentImageUrl: string | null;
  resolvedDesignUrl: string | null;
  resolvedTone: string | null;
  /** Firestore path label from `describeDesignSidePngSourcePath` — same as server `pickDesignPngUrlForBlankPreview` chain. */
  sourcePathUsed: string | null;
  /** Resolver id for debug parity with `recipeProvenance.renderPath` on deterministic assets. */
  renderPath: string;
  compositionSource: "blank_native" | "ai_identity";
  sideAllowedForDesign: boolean;
};

/**
 * Build a debug snapshot for the product UI. Uses the same resolver as official flat compose (sans Sharp).
 */
/**
 * Official `flat_front_clean` never composites artwork; `model_front_clean` is garment-only when `sideAllowedForDesign` is false.
 * Use when comparing to persisted `recipeProvenance` from deterministic compose.
 */
export function applyOfficialComposeGuardsToDebugRow(
  row: ResolvedSavedBlankProfileDebugRow | null,
  renderTarget: RpRenderTargetKey
): ResolvedSavedBlankProfileDebugRow | null {
  if (!row) return null;
  if (renderTarget === "flat_front") {
    return {
      ...row,
      resolvedDesignUrl: null,
      resolvedTone: null,
      sourcePathUsed: null,
      renderPath: "garment_only_clean_front",
    };
  }
  if (renderTarget === "model_front" && !row.sideAllowedForDesign) {
    return {
      ...row,
      resolvedDesignUrl: null,
      resolvedTone: null,
      sourcePathUsed: null,
      renderPath: "garment_only_model_front_clean",
    };
  }
  return row;
}

export function buildResolvedSavedBlankProfileDebugRow(input: {
  blank: RPBlank;
  blankVariantId: string;
  design: DesignDoc | null | undefined;
  product: RpProduct | null | undefined;
  renderTarget: RpRenderTargetKey;
}): ResolvedSavedBlankProfileDebugRow | null {
  const { blank, blankVariantId, design, product, renderTarget } = input;
  if (!design) return null;

  const profile = resolveSavedBlankRenderProfile({
    blank,
    blankVariantId,
    design,
    product,
    renderTarget,
  });
  if (!profile) return null;

  const qa = profile.tuning?.qa;

  /** Mirrors `functions/lib/officialProductFlatCompose.js` / `officialProductModelCompose.js` `recipeProvenance.renderPath`. */
  let expectedRecipeRenderPath = "resolveSavedBlankRenderProfile";
  if (renderTarget === "flat_front") {
    expectedRecipeRenderPath = "garment_only_clean_front";
  } else if (renderTarget === "flat_back") {
    expectedRecipeRenderPath = "design_composite_8394";
  } else if (renderTarget === "model_back") {
    expectedRecipeRenderPath = "design_composite_8394_model";
  } else if (renderTarget === "model_front") {
    expectedRecipeRenderPath = profile.sideAllowedForDesign
      ? "design_composite_8394_model"
      : "garment_only_model_front_clean";
  }

  return {
    resolvedBlankId: profile.blankId,
    blankDocPath: `rp_blanks/${String(blank.blankId || "").trim()}`,
    blankVariantId,
    renderTarget,
    garmentImageUrl: profile.garmentImageUrl,
    resolvedGarmentImageUrl: profile.garmentImageUrl,
    placementId: profile.placement?.placementId ?? null,
    tuningLayer: qa?.primaryTuningLayer ?? null,
    effectiveFront: profile.printSides.effectiveFront,
    effectiveBack: profile.printSides.effectiveBack,
    primaryPlacementSide: profile.printSides.primaryPlacementSide,
    resolvedDesignUrl: profile.resolvedDesignUrl,
    resolvedTone: profile.resolvedTone,
    sourcePathUsed: profile.sourcePathUsed,
    renderPath: expectedRecipeRenderPath,
    compositionSource: "blank_native",
    sideAllowedForDesign: profile.sideAllowedForDesign,
  };
}

function normStr(x: string | null | undefined): string {
  return (x != null ? String(x) : "").trim();
}

function normUrl(x: string | null | undefined): string {
  return normStr(x);
}

export type RecipeProvenanceFieldCompare = {
  ok: boolean;
  expected: string | null;
  actual: string | null;
};

/**
 * Compare persisted official provenance to the client-resolved saved blank profile row (same inputs as compose).
 */
export function compareResolvedProfileToRecipeProvenance(
  resolved: ResolvedSavedBlankProfileDebugRow | null,
  provenance: RpOfficialAssetRecipeProvenance | null | undefined
): { match: boolean; fields: Record<string, RecipeProvenanceFieldCompare> } {
  const fields: Record<string, RecipeProvenanceFieldCompare> = {};
  if (!resolved || !provenance) {
    return { match: false, fields };
  }

  const garmentOnly = provenance.garmentOnlyCleanFront === true;

  const checks: Array<[string, string | null, string | null]> = [
    ["resolvedFromBlankId", resolved.resolvedBlankId, provenance.resolvedFromBlankId],
    ["resolvedFromBlankVariantId", resolved.blankVariantId, provenance.resolvedFromBlankVariantId],
    ["resolvedRenderTarget", resolved.renderTarget, provenance.resolvedRenderTarget],
    ["resolvedPlacementId", resolved.placementId, provenance.resolvedPlacementId],
    ["resolvedTone", garmentOnly ? null : normStr(resolved.resolvedTone), garmentOnly ? null : normStr(provenance.resolvedTone)],
    [
      "resolvedDesignUrl",
      garmentOnly ? null : normUrl(resolved.resolvedDesignUrl),
      garmentOnly ? null : normUrl(provenance.resolvedDesignUrl),
    ],
    ["sourcePathUsed", garmentOnly ? null : normStr(resolved.sourcePathUsed), garmentOnly ? null : normStr(provenance.sourcePathUsed)],
    [
      "resolvedGarmentImageUrl",
      normUrl(resolved.resolvedGarmentImageUrl),
      normUrl(provenance.resolvedGarmentImageUrl),
    ],
    ["compositionSource", normStr(resolved.compositionSource), normStr(provenance.compositionSource)],
    ["renderPath", normStr(resolved.renderPath), normStr(provenance.renderPath)],
    ["tuningLayer", garmentOnly ? null : normStr(resolved.tuningLayer), garmentOnly ? null : normStr(provenance.tuningLayer)],
  ];

  let match = true;
  for (const [key, exp, act] of checks) {
    let ok = normStr(exp) === normStr(act);
    if (key === "resolvedDesignUrl" && garmentOnly) {
      ok = !normUrl(provenance.resolvedDesignUrl);
    }
    if (!ok) match = false;
    fields[key] = { ok, expected: exp, actual: act };
  }

  return { match, fields };
}
