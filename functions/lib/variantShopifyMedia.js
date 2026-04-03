"use strict";

/** @param {unknown} u */
function trimMediaUrl(u) {
  return typeof u === "string" ? u.trim() : "";
}

const GENERATED_PRIMARY_TIERS_8394 = [
  { role: "model_back", lookType: "model_blended" },
  { role: "flat_back", lookType: "flat_blended" },
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

function pickBestBySort(outputs) {
  if (!outputs.length) return null;
  const copy = outputs.slice().sort((a, b) => (a.sort != null ? a.sort : 9999) - (b.sort != null ? b.sort : 9999));
  return copy[0] || null;
}

function primaryUrlFromGeneratedOutputs8394(outputs) {
  if (!outputs || !Array.isArray(outputs) || !outputs.length) return "";
  const withUrl = outputs.filter((o) => o && trimMediaUrl(o.url));
  if (!withUrl.length) return "";

  for (let i = 0; i < GENERATED_PRIMARY_TIERS_8394.length; i++) {
    const tier = GENERATED_PRIMARY_TIERS_8394[i];
    const strict = withUrl.filter(
      (o) => o.role === tier.role && String(o.lookType || "") === tier.lookType
    );
    const best = pickBestBySort(strict);
    if (best) return trimMediaUrl(best.url);
  }
  for (let j = 0; j < GENERATED_PRIMARY_TIERS_8394.length; j++) {
    const role = GENERATED_PRIMARY_TIERS_8394[j].role;
    const loose = withUrl.filter((o) => o.role === role);
    const best2 = pickBestBySort(loose);
    if (best2) return trimMediaUrl(best2.url);
  }
  return "";
}

/**
 * @param {{ media?: object; mockupUrl?: string | null; flatRenders?: object | null; generatedRenderOutputs?: object[] | null } | null | undefined} variant
 * @param {string | null | undefined} blankStyleCode
 * @returns {string}
 */
function primaryVariantImageUrlForShopify(variant, blankStyleCode) {
  const m = (variant && variant.media) || {};
  const fr = variant && variant.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    const fromGen = primaryUrlFromGeneratedOutputs8394(variant && variant.generatedRenderOutputs);
    if (fromGen) return fromGen;
    return (
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(variant && variant.mockupUrl) ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr && fr.model_blended && fr.model_blended.back && fr.model_blended.back.url) ||
      trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
      trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
      trimMediaUrl(fr && fr.model_clean && fr.model_clean.front && fr.model_clean.front.url) ||
      ""
    );
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

module.exports = {
  trimMediaUrl,
  primaryVariantImageUrlForShopify,
  primaryUrlFromGeneratedOutputs8394,
};
