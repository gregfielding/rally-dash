"use strict";

/** @param {unknown} u */
function trimMediaUrl(u) {
  return typeof u === "string" ? u.trim() : "";
}

/** Full tier order when both garment sides may carry designed output. */
const GENERATED_PRIMARY_TIERS_8394 = [
  { role: "model_back", lookType: "model_blended" },
  { role: "flat_back", lookType: "flat_blended" },
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

/** Back-only print intersection: do not promote front outputs as primary. */
const GENERATED_PRIMARY_TIERS_8394_BACK_ONLY = [
  { role: "model_back", lookType: "model_blended" },
  { role: "flat_back", lookType: "flat_blended" },
];

const GENERATED_PRIMARY_TIERS_8394_FRONT_ONLY = [
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

function pickBestBySort(outputs) {
  if (!outputs.length) return null;
  const copy = outputs.slice().sort((a, b) => (a.sort != null ? a.sort : 9999) - (b.sort != null ? b.sort : 9999));
  return copy[0] || null;
}

function isOfficialGeneratedRenderOutput(o) {
  if (!o) return false;
  const t = String(o.sourceType || "");
  return t === "official_deterministic_generation" || t === "official_generation";
}

function slotHasRecipeProvenance(slot) {
  return !!(slot && slot.recipeProvenance && typeof slot.recipeProvenance === "object");
}

function preferOfficial8394BackFlatRenderUrl(fr) {
  const mb = fr && fr.model_blended && fr.model_blended.back;
  const fb = fr && fr.flat_blended && fr.flat_blended.back;
  const mbU = trimMediaUrl(mb && mb.url);
  const fbU = trimMediaUrl(fb && fb.url);
  if (slotHasRecipeProvenance(mb) && mbU) return mbU;
  if (slotHasRecipeProvenance(fb) && fbU) return fbU;
  if (mbU) return mbU;
  if (fbU) return fbU;
  return "";
}

function preferOfficial8394FrontFlatRenderUrl(fr) {
  const fc = fr && fr.flat_clean && fr.flat_clean.front;
  const mc = fr && fr.model_clean && fr.model_clean.front;
  const fcU = trimMediaUrl(fc && fc.url);
  const mcU = trimMediaUrl(mc && mc.url);
  if (slotHasRecipeProvenance(fc) && fcU) return fcU;
  if (slotHasRecipeProvenance(mc) && mcU) return mcU;
  if (fcU) return fcU;
  if (mcU) return mcU;
  return "";
}

/**
 * @param {object[]|null|undefined} outputs
 * @param {typeof GENERATED_PRIMARY_TIERS_8394} [tierList]
 */
function primaryUrlFromGeneratedOutputs8394(outputs, tierList) {
  const tiers = tierList && tierList.length ? tierList : GENERATED_PRIMARY_TIERS_8394;
  if (!outputs || !Array.isArray(outputs) || !outputs.length) return "";
  const withUrl = outputs.filter((o) => o && trimMediaUrl(o.url));
  if (!withUrl.length) return "";

  function pickTier(officialOnly) {
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const strict = withUrl.filter(
        (o) =>
          o.role === tier.role &&
          String(o.lookType || "") === tier.lookType &&
          (!officialOnly || isOfficialGeneratedRenderOutput(o))
      );
      const best = pickBestBySort(strict);
      if (best) return trimMediaUrl(best.url);
    }
    for (let j = 0; j < tiers.length; j++) {
      const role = tiers[j].role;
      const loose = withUrl.filter((o) => o.role === role && (!officialOnly || isOfficialGeneratedRenderOutput(o)));
      const best2 = pickBestBySort(loose);
      if (best2) return trimMediaUrl(best2.url);
    }
    return "";
  }

  return pickTier(true) || pickTier(false);
}

/**
 * True if variant already has any raster we could show (skip inheriting).
 * @param {object|null|undefined} v
 */
function variantHasRenderableRaster8394(v) {
  if (!v || typeof v !== "object") return false;
  const m = v.media || {};
  const fr = v.flatRenders || {};
  return !!(
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(v.mockupUrl) ||
    trimMediaUrl(fr.model_blended && fr.model_blended.back && fr.model_blended.back.url) ||
    trimMediaUrl(fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
    trimMediaUrl(fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
    trimMediaUrl(fr.model_clean && fr.model_clean.front && fr.model_clean.front.url)
  );
}

/**
 * Merge primary’s media onto sibling when sibling has no rasters yet (inheritance before fanout completes).
 * @param {object} v
 * @param {Map<string, object>} byId
 */
function dedupeGeneratedOutputsByRolePreferOfficial(primary, secondary) {
  const map = new Map();
  const key = (o) => `${String(o.role || "")}:${String(o.lookType || "")}`;
  const list = [...(secondary || []), ...(primary || [])];
  for (const o of list) {
    if (!o || !o.role) continue;
    const k = key(o);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, o);
      continue;
    }
    const curOff = isOfficialGeneratedRenderOutput(cur);
    const oOff = isOfficialGeneratedRenderOutput(o);
    if (oOff && !curOff) map.set(k, o);
    else if (oOff === curOff && (o.sort != null ? o.sort : 0) >= (cur.sort != null ? cur.sort : 0)) map.set(k, o);
  }
  return [...map.values()].sort((a, b) => (a.sort != null ? a.sort : 0) - (b.sort != null ? b.sort : 0));
}

function mergeInheritedMediaForReadiness8394(v, byId) {
  if (variantHasRenderableRaster8394(v)) return v;
  const inh = v.inheritsMediaFromVariantId && String(v.inheritsMediaFromVariantId).trim();
  if (!inh) return v;
  const src = byId.get(inh);
  if (!src) return v;
  const mergedGen = dedupeGeneratedOutputsByRolePreferOfficial(v.generatedRenderOutputs, src.generatedRenderOutputs);
  const genOut =
    mergedGen && mergedGen.length
      ? mergedGen
      : v.generatedRenderOutputs && v.generatedRenderOutputs.length
        ? v.generatedRenderOutputs
        : src.generatedRenderOutputs || null;
  return {
    ...v,
    mockupUrl: v.mockupUrl || src.mockupUrl || null,
    media: {
      ...(v.media || {}),
      heroFront: (v.media && v.media.heroFront) || (src.media && src.media.heroFront) || null,
      heroBack: (v.media && v.media.heroBack) || (src.media && src.media.heroBack) || null,
    },
    flatRenders: v.flatRenders || src.flatRenders || null,
    generatedRenderOutputs: genOut,
  };
}

/**
 * Pick tiers from blank ∩ design print sides (effectiveFront / effectiveBack).
 * @param {{ effectiveFront?: boolean; effectiveBack?: boolean }|null|undefined} printSides
 */
function generatedTiersForPrintSides8394(printSides) {
  if (!printSides || typeof printSides.effectiveFront !== "boolean" || typeof printSides.effectiveBack !== "boolean") {
    return GENERATED_PRIMARY_TIERS_8394;
  }
  if (printSides.effectiveBack && !printSides.effectiveFront) return GENERATED_PRIMARY_TIERS_8394_BACK_ONLY;
  if (printSides.effectiveFront && !printSides.effectiveBack) return GENERATED_PRIMARY_TIERS_8394_FRONT_ONLY;
  return GENERATED_PRIMARY_TIERS_8394;
}

/**
 * 8394: prefer **back** commerce assets before front (storefront primary should match back-print blanks).
 * When printSides is back-only, do not prefer heroFront / flat_clean before back flats.
 */
function primary8394UrlFallbackChain(variant, printSides) {
  const m = (variant && variant.media) || {};
  const fr = variant && variant.flatRenders;
  const backOnly =
    printSides && printSides.effectiveBack === true && printSides.effectiveFront === false;
  const frontOnly =
    printSides && printSides.effectiveFront === true && printSides.effectiveBack === false;
  const backFr = preferOfficial8394BackFlatRenderUrl(fr);
  const frontFr = preferOfficial8394FrontFlatRenderUrl(fr);

  if (backOnly) {
    return (
      backFr ||
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(fr && fr.model_blended && fr.model_blended.back && fr.model_blended.back.url) ||
      trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
      trimMediaUrl(variant && variant.mockupUrl) ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
      trimMediaUrl(fr && fr.model_clean && fr.model_clean.front && fr.model_clean.front.url) ||
      ""
    );
  }
  if (frontOnly) {
    return (
      frontFr ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
      trimMediaUrl(fr && fr.model_clean && fr.model_clean.front && fr.model_clean.front.url) ||
      trimMediaUrl(variant && variant.mockupUrl) ||
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
      trimMediaUrl(fr && fr.model_blended && fr.model_blended.back && fr.model_blended.back.url) ||
      ""
    );
  }
  return (
    backFr ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr && fr.model_blended && fr.model_blended.back && fr.model_blended.back.url) ||
    trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
    trimMediaUrl(variant && variant.mockupUrl) ||
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
    trimMediaUrl(fr && fr.model_clean && fr.model_clean.front && fr.model_clean.front.url) ||
    ""
  );
}

/**
 * @param {{ media?: object; mockupUrl?: string | null; flatRenders?: object | null; generatedRenderOutputs?: object[] | null } | null | undefined} variant
 * @param {string | null | undefined} blankStyleCode
 * @param {{ effectiveFront?: boolean; effectiveBack?: boolean } | null | undefined} [printSides] from `resolvePrintSidesForProductBuild`
 * @returns {string}
 */
function primaryVariantImageUrlForShopify(variant, blankStyleCode, printSides) {
  const m = (variant && variant.media) || {};
  const fr = variant && variant.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    const tiers = generatedTiersForPrintSides8394(printSides);
    const fromGen = primaryUrlFromGeneratedOutputs8394(variant && variant.generatedRenderOutputs, tiers);
    if (fromGen) return fromGen;
    return primary8394UrlFallbackChain(variant, printSides);
  }
  return (
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(variant && variant.mockupUrl) ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
    trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
    ""
  );
}

/**
 * Role → garment side + readiness semantics for logs / QA (8394).
 * @param {{ effectiveFront?: boolean; effectiveBack?: boolean; primaryPlacementSide?: string } | null | undefined} printSides
 */
function describe8394ReadinessRoles(printSides) {
  const backOnly = printSides && printSides.effectiveBack === true && printSides.effectiveFront === false;
  const frontOnly = printSides && printSides.effectiveFront === true && printSides.effectiveBack === false;
  const bothOrUnknown = !backOnly && !frontOnly;

  return {
    printSides: printSides || null,
    roles: {
      flat_front_clean: {
        mapsToSide: "front",
        required_for_readiness: frontOnly || bothOrUnknown,
        allowed_for_display_fallback: true,
        ignored_for_readiness: !!backOnly,
      },
      flat_back_designed: {
        mapsToSide: "back",
        required_for_readiness: backOnly || bothOrUnknown,
        allowed_for_display_fallback: true,
        ignored_for_readiness: !!frontOnly,
      },
      heroFront: {
        mapsToSide: "front",
        required_for_readiness: frontOnly || bothOrUnknown,
        allowed_for_display_fallback: true,
        ignored_for_readiness: !!backOnly,
      },
      heroBack: {
        mapsToSide: "back",
        required_for_readiness: backOnly || bothOrUnknown,
        allowed_for_display_fallback: true,
        ignored_for_readiness: !!frontOnly,
      },
      mockupUrl: {
        mapsToSide: "unspecified",
        required_for_readiness: false,
        allowed_for_display_fallback: true,
        ignored_for_readiness: false,
      },
    },
  };
}

module.exports = {
  trimMediaUrl,
  primaryVariantImageUrlForShopify,
  primaryUrlFromGeneratedOutputs8394,
  generatedTiersForPrintSides8394,
  mergeInheritedMediaForReadiness8394,
  variantHasRenderableRaster8394,
  describe8394ReadinessRoles,
  preferOfficial8394BackFlatRenderUrl,
  preferOfficial8394FrontFlatRenderUrl,
  isOfficialGeneratedRenderOutput,
  GENERATED_PRIMARY_TIERS_8394_BACK_ONLY,
  GENERATED_PRIMARY_TIERS_8394_FRONT_ONLY,
};
