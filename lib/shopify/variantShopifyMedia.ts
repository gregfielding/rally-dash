import type { RpProduct, RpVariantGeneratedRenderOutput } from "@/lib/types/firestore";

/** Trimmed URL or empty string. */
export function trimMediaUrl(u: unknown): string {
  return typeof u === "string" ? u.trim() : "";
}

/** Canonical official rows win over legacy `variant_render_source` in `generatedRenderOutputs`. */
export function isOfficialGeneratedRenderOutput(o: RpVariantGeneratedRenderOutput | null | undefined): boolean {
  if (!o) return false;
  const t = String(o.sourceType || "");
  return t === "official_deterministic_generation" || t === "official_generation";
}

function slotHasRecipeProvenance(slot: { recipeProvenance?: unknown } | null | undefined): boolean {
  return !!(slot && slot.recipeProvenance && typeof slot.recipeProvenance === "object");
}

/** Prefer on-model back, then flat back; official `recipeProvenance` slots win over bare URLs. */
export function preferOfficial8394BackFlatRenderUrl(
  fr: RpProduct["flatRenders"] | null | undefined
): string {
  const mb = fr?.model_blended?.back;
  const fb = fr?.flat_blended?.back;
  const mbU = trimMediaUrl(mb?.url);
  const fbU = trimMediaUrl(fb?.url);
  if (slotHasRecipeProvenance(mb) && mbU) return mbU;
  if (slotHasRecipeProvenance(fb) && fbU) return fbU;
  if (mbU) return mbU;
  if (fbU) return fbU;
  return "";
}

function preferOfficial8394FrontFlatRenderUrl(fr: RpProduct["flatRenders"] | null | undefined): string {
  const fc = fr?.flat_clean?.front;
  const mc = fr?.model_clean?.front;
  const fcU = trimMediaUrl(fc?.url);
  const mcU = trimMediaUrl(mc?.url);
  if (slotHasRecipeProvenance(fc) && fcU) return fcU;
  if (slotHasRecipeProvenance(mc) && mcU) return mcU;
  if (fcU) return fcU;
  if (mcU) return mcU;
  return "";
}

export type VariantMediaShape = {
  media?: { heroFront?: string | null; heroBack?: string | null } | null;
  mockupUrl?: string | null;
  flatRenders?: RpProduct["flatRenders"] | null;
  generatedRenderOutputs?: RpVariantGeneratedRenderOutput[] | null;
  inheritsMediaFromVariantId?: string | null;
  id?: string | null;
};

/** Blank ∩ design print sides (from `fulfillmentSummary.printSides` or `resolvePrintSidesForProductBuild`). */
export type ProductPrintSidesForCommerce = {
  effectiveFront?: boolean;
  effectiveBack?: boolean;
  primaryPlacementSide?: string | null;
  blankMode?: string | null;
  designMode?: string | null;
} | null;

const GENERATED_PRIMARY_TIERS_8394: ReadonlyArray<{ role: string; lookType: string }> = [
  { role: "model_back", lookType: "model_blended" },
  { role: "flat_back", lookType: "flat_blended" },
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

/**
 * Back-only commerce: prefer official flat back for storefront primary when both flat and model exist.
 * Otherwise a stale `generatedRenderOutputs` model_back row can win over the fresh deterministic flat_back.
 */
const GENERATED_PRIMARY_TIERS_8394_BACK_ONLY: ReadonlyArray<{ role: string; lookType: string }> = [
  { role: "flat_back", lookType: "flat_blended" },
  { role: "model_back", lookType: "model_blended" },
];

const GENERATED_PRIMARY_TIERS_8394_FRONT_ONLY: ReadonlyArray<{ role: string; lookType: string }> = [
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

function pickBestBySort(outputs: RpVariantGeneratedRenderOutput[]): RpVariantGeneratedRenderOutput | null {
  if (!outputs.length) return null;
  return [...outputs].sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999))[0] ?? null;
}

export function generatedTiersForPrintSides8394(
  printSides: ProductPrintSidesForCommerce | undefined
): ReadonlyArray<{ role: string; lookType: string }> {
  if (
    !printSides ||
    typeof printSides.effectiveFront !== "boolean" ||
    typeof printSides.effectiveBack !== "boolean"
  ) {
    return GENERATED_PRIMARY_TIERS_8394;
  }
  if (printSides.effectiveBack && !printSides.effectiveFront) return GENERATED_PRIMARY_TIERS_8394_BACK_ONLY;
  if (printSides.effectiveFront && !printSides.effectiveBack) return GENERATED_PRIMARY_TIERS_8394_FRONT_ONLY;
  return GENERATED_PRIMARY_TIERS_8394;
}

export function primaryUrlFromGeneratedOutputs8394(
  outputs: RpVariantGeneratedRenderOutput[] | null | undefined,
  tierList?: ReadonlyArray<{ role: string; lookType: string }>
): string {
  const r = pickGenerated8394Resolution(outputs, tierList);
  return r?.url ?? "";
}

function pickGenerated8394Resolution(
  outputs: RpVariantGeneratedRenderOutput[] | null | undefined,
  tierList?: ReadonlyArray<{ role: string; lookType: string }>
): {
  url: string;
  role: string | null;
  lookType: string | null;
  source: "generatedOutputs_strict" | "generatedOutputs_loose";
} | null {
  const tiers = tierList?.length ? tierList : GENERATED_PRIMARY_TIERS_8394;
  if (!outputs?.length) return null;
  const withUrl = outputs.filter((o) => trimMediaUrl(o.url));
  if (!withUrl.length) return null;

  const pickTier = (officialOnly: boolean) => {
    for (const { role, lookType } of tiers) {
      const strict = withUrl.filter(
        (o) =>
          o.role === role &&
          String(o.lookType || "") === lookType &&
          (!officialOnly || isOfficialGeneratedRenderOutput(o))
      );
      const best = pickBestBySort(strict);
      if (best) {
        return {
          url: trimMediaUrl(best.url),
          role: best.role ?? null,
          lookType: best.lookType != null ? String(best.lookType) : null,
          source: "generatedOutputs_strict" as const,
        };
      }
    }
    for (const { role } of tiers) {
      const loose = withUrl.filter((o) => o.role === role && (!officialOnly || isOfficialGeneratedRenderOutput(o)));
      const best = pickBestBySort(loose);
      if (best) {
        return {
          url: trimMediaUrl(best.url),
          role: best.role ?? null,
          lookType: best.lookType != null ? String(best.lookType) : null,
          source: "generatedOutputs_loose" as const,
        };
      }
    }
    return null;
  };

  return pickTier(true) || pickTier(false);
}

export type Primary8394ResolutionSource =
  | "generatedOutputs_strict"
  | "generatedOutputs_loose"
  | "flatRenders_official_back_preferred"
  | "flatRenders_official_front_preferred"
  | "heroBack"
  | "mockupUrl"
  | "heroFront"
  | "flatRenders_model_blended_back"
  | "flatRenders_flat_blended_back"
  | "flatRenders_flat_clean_front"
  | "flatRenders_model_clean_front"
  | "none";

export type PrimaryVariantImage8394Resolution = {
  url: string;
  role: string | null;
  lookType: string | null;
  source: Primary8394ResolutionSource;
  /** Last path segment of URL (quick QA). */
  filename: string | null;
};

export function filenameFromCommerceUrl(url: string): string | null {
  const u = trimMediaUrl(url);
  if (!u) return null;
  try {
    const path = u.split("?")[0] ?? u;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return null;
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return null;
  }
}

function primary8394UrlFallbackChain(
  variant: VariantMediaShape | null | undefined,
  printSides: ProductPrintSidesForCommerce | undefined
): string {
  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;
  const backOnly = printSides?.effectiveBack === true && printSides?.effectiveFront === false;
  const frontOnly = printSides?.effectiveFront === true && printSides?.effectiveBack === false;
  const backFr = preferOfficial8394BackFlatRenderUrl(fr);
  const frontFr = preferOfficial8394FrontFlatRenderUrl(fr);

  if (backOnly) {
    return (
      backFr ||
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(fr?.model_blended?.back?.url) ||
      trimMediaUrl(fr?.flat_blended?.back?.url) ||
      trimMediaUrl(variant?.mockupUrl) ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr?.flat_clean?.front?.url) ||
      trimMediaUrl(fr?.model_clean?.front?.url) ||
      ""
    );
  }
  if (frontOnly) {
    return (
      frontFr ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr?.flat_clean?.front?.url) ||
      trimMediaUrl(fr?.model_clean?.front?.url) ||
      trimMediaUrl(variant?.mockupUrl) ||
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(fr?.flat_blended?.back?.url) ||
      trimMediaUrl(fr?.model_blended?.back?.url) ||
      ""
    );
  }
  return (
    backFr ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr?.model_blended?.back?.url) ||
    trimMediaUrl(fr?.flat_blended?.back?.url) ||
    trimMediaUrl(variant?.mockupUrl) ||
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(fr?.flat_clean?.front?.url) ||
    trimMediaUrl(fr?.model_clean?.front?.url) ||
    ""
  );
}

/**
 * True if variant already has any raster we could show (skip inheriting).
 */
export function variantHasRenderableRaster8394(v: VariantMediaShape | null | undefined): boolean {
  if (!v || typeof v !== "object") return false;
  const m = v.media ?? {};
  const fr = v.flatRenders;
  return !!(
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(v.mockupUrl) ||
    trimMediaUrl(fr?.model_blended?.back?.url) ||
    trimMediaUrl(fr?.flat_blended?.back?.url) ||
    trimMediaUrl(fr?.flat_clean?.front?.url) ||
    trimMediaUrl(fr?.model_clean?.front?.url)
  );
}

function dedupeGeneratedOutputsByRolePreferOfficial(
  primary: RpVariantGeneratedRenderOutput[] | null | undefined,
  secondary: RpVariantGeneratedRenderOutput[] | null | undefined
): RpVariantGeneratedRenderOutput[] | null {
  const map = new Map<string, RpVariantGeneratedRenderOutput>();
  const key = (o: RpVariantGeneratedRenderOutput) => `${String(o.role || "")}:${String(o.lookType || "")}`;
  const list = [...(secondary || []), ...(primary || [])];
  for (const o of list) {
    if (!o?.role) continue;
    const k = key(o);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, o);
      continue;
    }
    const curOff = isOfficialGeneratedRenderOutput(cur);
    const oOff = isOfficialGeneratedRenderOutput(o);
    if (oOff && !curOff) map.set(k, o);
    else if (oOff === curOff && (o.sort ?? 0) >= (cur.sort ?? 0)) map.set(k, o);
  }
  return [...map.values()].sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

/**
 * Merge primary’s media onto sibling when sibling has no rasters yet (inheritance before fanout completes).
 */
export function mergeInheritedMediaForReadiness8394(
  v: VariantMediaShape & { id?: string | null },
  byId: Map<string, VariantMediaShape & { id?: string | null }>
): VariantMediaShape & { id?: string | null } {
  if (variantHasRenderableRaster8394(v)) return v;
  const inh = v.inheritsMediaFromVariantId && String(v.inheritsMediaFromVariantId).trim();
  if (!inh) return v;
  const src = byId.get(inh);
  if (!src) return v;
  const mergedGen = dedupeGeneratedOutputsByRolePreferOfficial(
    v.generatedRenderOutputs ?? null,
    src.generatedRenderOutputs ?? null
  );
  const genOut =
    mergedGen && mergedGen.length
      ? mergedGen
      : v.generatedRenderOutputs?.length
        ? v.generatedRenderOutputs
        : src.generatedRenderOutputs || null;
  return {
    ...v,
    mockupUrl: v.mockupUrl || src.mockupUrl || null,
    media: {
      ...(v.media || {}),
      heroFront: v.media?.heroFront || src.media?.heroFront || null,
      heroBack: v.media?.heroBack || src.media?.heroBack || null,
    },
    flatRenders: v.flatRenders || src.flatRenders || null,
    generatedRenderOutputs: genOut,
  };
}

/**
 * Same resolution order as `primaryVariantImageUrlForShopify` for 8394, with metadata for QA UIs.
 */
/**
 * Ops/debug: why `resolvePrimaryVariantImage8394ForShopify` picked a URL and whether it matches canonical slots.
 * Does not change selection logic — mirrors the same resolver.
 */
export function explainStorefrontPrimarySelection8394(
  variant: VariantMediaShape | null | undefined,
  printSides?: ProductPrintSidesForCommerce
): {
  chosen: PrimaryVariantImage8394Resolution;
  equals: {
    flatRendersFlatBlendedBack: boolean;
    generatedRenderFlatBack: boolean;
    mediaHeroBack: boolean;
    mockupUrl: boolean;
  };
} {
  const chosen = resolvePrimaryVariantImage8394ForShopify(variant, printSides);
  const u = trimMediaUrl(chosen.url);
  const fr = variant?.flatRenders;
  const genFb = (variant?.generatedRenderOutputs ?? []).find(
    (o) => o && String(o.role || "") === "flat_back" && String(o.lookType || "") === "flat_blended"
  );
  return {
    chosen,
    equals: {
      flatRendersFlatBlendedBack: u === trimMediaUrl(fr?.flat_blended?.back?.url),
      generatedRenderFlatBack: u === trimMediaUrl(genFb?.url),
      mediaHeroBack: u === trimMediaUrl(variant?.media?.heroBack),
      mockupUrl: u === trimMediaUrl(variant?.mockupUrl),
    },
  };
}

export function resolvePrimaryVariantImage8394ForShopify(
  variant: VariantMediaShape | null | undefined,
  printSides?: ProductPrintSidesForCommerce
): PrimaryVariantImage8394Resolution {
  const tiers = generatedTiersForPrintSides8394(printSides);
  const gen = pickGenerated8394Resolution(variant?.generatedRenderOutputs ?? null, tiers);
  if (gen) {
    return {
      url: gen.url,
      role: gen.role,
      lookType: gen.lookType,
      source: gen.source,
      filename: filenameFromCommerceUrl(gen.url),
    };
  }

  const tryUrl = (
    url: string,
    source: Primary8394ResolutionSource,
    role: string | null,
    lookType: string | null
  ): PrimaryVariantImage8394Resolution | null => {
    const u = trimMediaUrl(url);
    if (!u) return null;
    return { url: u, role, lookType, source, filename: filenameFromCommerceUrl(u) };
  }

  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;
  const backOnly = printSides?.effectiveBack === true && printSides?.effectiveFront === false;
  const frontOnly = printSides?.effectiveFront === true && printSides?.effectiveBack === false;
  const backFrPreferred = preferOfficial8394BackFlatRenderUrl(fr);
  const frontFrPreferred = preferOfficial8394FrontFlatRenderUrl(fr);

  if (backOnly) {
    return (
      tryUrl(backFrPreferred, "flatRenders_official_back_preferred", null, null) ||
      tryUrl(m.heroBack ?? "", "heroBack", null, null) ||
      tryUrl(fr?.model_blended?.back?.url ?? "", "flatRenders_model_blended_back", "model_back", "model_blended") ||
      tryUrl(fr?.flat_blended?.back?.url ?? "", "flatRenders_flat_blended_back", "flat_back", "flat_blended") ||
      tryUrl(variant?.mockupUrl ?? "", "mockupUrl", null, null) ||
      tryUrl(m.heroFront ?? "", "heroFront", null, null) ||
      tryUrl(fr?.flat_clean?.front?.url ?? "", "flatRenders_flat_clean_front", "flat_front", "flat_clean") ||
      tryUrl(fr?.model_clean?.front?.url ?? "", "flatRenders_model_clean_front", "model_front", "model_clean") || {
        url: "",
        role: null,
        lookType: null,
        source: "none",
        filename: null,
      }
    );
  }
  if (frontOnly) {
    return (
      tryUrl(frontFrPreferred, "flatRenders_official_front_preferred", null, null) ||
      tryUrl(m.heroFront ?? "", "heroFront", null, null) ||
      tryUrl(fr?.flat_clean?.front?.url ?? "", "flatRenders_flat_clean_front", "flat_front", "flat_clean") ||
      tryUrl(fr?.model_clean?.front?.url ?? "", "flatRenders_model_clean_front", "model_front", "model_clean") ||
      tryUrl(variant?.mockupUrl ?? "", "mockupUrl", null, null) ||
      tryUrl(m.heroBack ?? "", "heroBack", null, null) ||
      tryUrl(fr?.flat_blended?.back?.url ?? "", "flatRenders_flat_blended_back", "flat_back", "flat_blended") ||
      tryUrl(fr?.model_blended?.back?.url ?? "", "flatRenders_model_blended_back", "model_back", "model_blended") || {
        url: "",
        role: null,
        lookType: null,
        source: "none",
        filename: null,
      }
    );
  }

  return (
    tryUrl(backFrPreferred, "flatRenders_official_back_preferred", null, null) ||
    tryUrl(m.heroBack ?? "", "heroBack", null, null) ||
    tryUrl(fr?.model_blended?.back?.url ?? "", "flatRenders_model_blended_back", "model_back", "model_blended") ||
    tryUrl(fr?.flat_blended?.back?.url ?? "", "flatRenders_flat_blended_back", "flat_back", "flat_blended") ||
    tryUrl(variant?.mockupUrl ?? "", "mockupUrl", null, null) ||
    tryUrl(m.heroFront ?? "", "heroFront", null, null) ||
    tryUrl(fr?.flat_clean?.front?.url ?? "", "flatRenders_flat_clean_front", "flat_front", "flat_clean") ||
    tryUrl(fr?.model_clean?.front?.url ?? "", "flatRenders_model_clean_front", "model_front", "model_clean") || {
      url: "",
      role: null,
      lookType: null,
      source: "none",
      filename: null,
    }
  );
}

/** How `media.heroBack` was produced for 8394 QA (matches post-`generateProductFlatRenders` writes). */
export function resolveHeroBackSource8394(variant: VariantMediaShape | null | undefined): {
  label: string;
  url: string;
} {
  const url = trimMediaUrl(variant?.media?.heroBack);
  if (!url) return { label: "none", url: "" };
  const fr = variant?.flatRenders;
  if (url === trimMediaUrl(fr?.model_blended?.back?.url)) {
    return { label: "flatRenders.model_blended.back (pipeline hero — on-model back composite)", url };
  }
  if (url === trimMediaUrl(fr?.flat_blended?.back?.url)) {
    return { label: "flatRenders.flat_blended.back (fallback when no model back)", url };
  }
  if (url === trimMediaUrl(variant?.mockupUrl)) {
    return { label: "mockupUrl", url };
  }
  return { label: "media.heroBack (no matching flatRenders slot — legacy or manual)", url };
}

/** How `media.heroFront` was produced for 8394 QA (flat garment pass-through only). */
export function resolveHeroFrontSource8394(variant: VariantMediaShape | null | undefined): {
  label: string;
  url: string;
} {
  const url = trimMediaUrl(variant?.media?.heroFront);
  if (!url) return { label: "none", url: "" };
  const fr = variant?.flatRenders;
  if (url === trimMediaUrl(fr?.flat_clean?.front?.url)) {
    return { label: "flatRenders.flat_clean.front (8394 garment copy)", url };
  }
  return { label: "media.heroFront (no flat_clean.front match — legacy or manual)", url };
}

/**
 * Back-only 8394 regression: after official generation, `flat_front_clean` must be garment-only (no design URL)
 * and the storefront primary must not prefer the front-clean asset when a back-designed asset exists.
 */
export function checkBackOnly8394OfficialFlatInvariants(
  variant: VariantMediaShape | null | undefined,
  printSides: ProductPrintSidesForCommerce | undefined
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!printSides || printSides.effectiveBack !== true || printSides.effectiveFront !== false) {
    return { ok: true, issues: [] };
  }

  const flatFrontGen = variant?.generatedRenderOutputs?.find(
    (o) => o.role === "flat_front" && String(o.lookType || "") === "flat_clean"
  );
  if (flatFrontGen?.recipeProvenance) {
    const rp = flatFrontGen.recipeProvenance;
    const garment =
      rp.garmentOnly === true || rp.garmentOnlyCleanFront === true;
    if (!garment) {
      issues.push(
        "Expected recipeProvenance.garmentOnly / garmentOnlyCleanFront on official flat_front (flat_clean) for back-only."
      );
    }
    if (trimMediaUrl(rp.resolvedDesignUrl)) {
      issues.push("Expected flat_front_clean recipeProvenance.resolvedDesignUrl to be empty (garment-only).");
    }
  }

  const flatBackGen = variant?.generatedRenderOutputs?.find(
    (o) => o.role === "flat_back" && String(o.lookType || "") === "flat_blended"
  );
  if (flatBackGen?.recipeProvenance && !trimMediaUrl(flatBackGen.recipeProvenance.resolvedDesignUrl)) {
    issues.push("Expected flat_back recipeProvenance.resolvedDesignUrl for designed back composite.");
  }

  const primary = resolvePrimaryVariantImage8394ForShopify(variant, printSides);
  const backUrl =
    trimMediaUrl(flatBackGen?.url) ||
    trimMediaUrl(variant?.flatRenders?.flat_blended?.back?.url) ||
    trimMediaUrl(variant?.media?.heroBack);
  const frontCleanUrl = trimMediaUrl(flatFrontGen?.url);

  if (backUrl && frontCleanUrl && primary.url === frontCleanUrl && primary.url !== backUrl) {
    issues.push(
      "Storefront primary must not prefer flat_front_clean when flat_back_designed exists (back-only blank)."
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Primary image URL for this sellable variant’s Shopify featured media.
 * Pass `printSides` from `fulfillmentSummary.printSides` so back-only blanks prefer back outputs.
 */
export function primaryVariantImageUrlForShopify(
  variant: VariantMediaShape | null | undefined,
  blankStyleCode: string | null | undefined,
  printSides?: ProductPrintSidesForCommerce
): string {
  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    return resolvePrimaryVariantImage8394ForShopify(variant, printSides).url;
  }
  return (
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(variant?.mockupUrl) ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr?.flat_clean?.front?.url) ||
    trimMediaUrl(fr?.flat_blended?.back?.url) ||
    ""
  );
}
