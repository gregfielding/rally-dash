"use strict";

/**
 * Server-side checks against `rp_scene_templates` eligibility lists.
 *
 * Policy (locked): eligibility is data-driven in Firestore — `blankCategoriesAllowed` and optional
 * `productTypesAllowed`. Example: `neutral_hanger` excludes panties via categories; `backdrop_neutral`
 * includes panties. See seed scripts under `functions/scripts/seed-*-scene-template.js`.
 * @param {string | undefined} s
 */
function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Map product + blank hints to tags in the same vocabulary as `blankCategoriesAllowed` seeds
 * (e.g. panties, tees, tanks, crewnecks, bralettes).
 * @param {Record<string, unknown>} product
 * @returns {Set<string>}
 */
function deriveBlankCategoryTags(product) {
  const tags = new Set();
  const cat = norm(product?.category);
  if (cat === "panties") tags.add("panties");
  if (cat === "tee") tags.add("tees");
  if (cat === "tank") tags.add("tanks");
  if (cat === "bralette") tags.add("bralettes");

  const bsc = String(product?.blankStyleCode || "").trim();
  if (bsc === "8394") tags.add("panties");

  const bsn = norm(product?.blankStyleName);
  if (bsn.includes("panty") || bsn.includes("bikini")) tags.add("panties");
  if (bsn.includes("crew")) tags.add("crewnecks");

  return tags;
}

/**
 * @param {Record<string, unknown>} product - parent `rp_products` doc
 * @param {Record<string, unknown>} templateDoc - `rp_scene_templates` doc
 * @returns {boolean}
 */
function productMatchesSceneTemplate(product, templateDoc) {
  if (!templateDoc || typeof templateDoc !== "object") return false;

  const cats = templateDoc.blankCategoriesAllowed;
  if (Array.isArray(cats) && cats.length > 0) {
    const allowed = new Set(cats.map((c) => norm(c)));
    const tags = deriveBlankCategoryTags(product);
    const hit = [...tags].some((t) => allowed.has(t));
    if (!hit) return false;
  }

  const types = templateDoc.productTypesAllowed;
  if (Array.isArray(types) && types.length > 0) {
    const pt = norm(product?.productType);
    if (pt) {
      const allowed = new Set(types.map((t) => norm(t)));
      if (!allowed.has(pt)) return false;
    }
  }

  return true;
}

module.exports = {
  productMatchesSceneTemplate,
  deriveBlankCategoryTags,
  norm,
};
