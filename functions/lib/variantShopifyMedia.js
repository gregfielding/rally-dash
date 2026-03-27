"use strict";

/** @param {unknown} u */
function trimMediaUrl(u) {
  return typeof u === "string" ? u.trim() : "";
}

/**
 * @param {{ media?: object; mockupUrl?: string | null; flatRenders?: object | null } | null | undefined} variant
 * @param {string | null | undefined} blankStyleCode
 * @returns {string}
 */
function primaryVariantImageUrlForShopify(variant, blankStyleCode) {
  const m = (variant && variant.media) || {};
  const fr = variant && variant.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    return (
      trimMediaUrl(m.heroBack) ||
      trimMediaUrl(variant && variant.mockupUrl) ||
      trimMediaUrl(m.heroFront) ||
      trimMediaUrl(fr && fr.flat_blended && fr.flat_blended.back && fr.flat_blended.back.url) ||
      trimMediaUrl(fr && fr.flat_clean && fr.flat_clean.front && fr.flat_clean.front.url) ||
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

module.exports = { trimMediaUrl, primaryVariantImageUrlForShopify };
