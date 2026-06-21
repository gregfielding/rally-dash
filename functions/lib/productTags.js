"use strict";

/**
 * Product tag generation (same contract as lib/productTags/generateProductTags.ts).
 * Tags are deterministic from Team + Design + Blank only. City from Team only; no manual entry.
 * displayTags = proper case for UI/Shopify; normalizedTags = for filtering/search only.
 */

const DESIGN_TYPE_LABELS = {
  city_69: "City 69",
  slogan: "Slogan",
  stadium: "Stadium",
  rivalry: "Rivalry",
  number: "Number",
  wordplay: "Wordplay",
  badge_crest: "Badge / Crest",
  pillows: "Pillows",
  custom_one_off: "Custom / One-off",
  wordmark: "Wordmark (legacy)",
  script: "Script (legacy)",
  badge: "Badge (legacy)",
  other: "Other (legacy)",
};

const GARMENT_CATEGORY_LABELS = {
  panty: "Panty",
  thong: "Thong",
  tank: "Tank",
  crewneck: "Crewneck",
};

function toProperCase(value) {
  const s = String(value || "").trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeTagForFilter(displayTag) {
  return String(displayTag)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

function designTypeToDisplayLabel(designType) {
  if (!designType || !DESIGN_TYPE_LABELS[designType]) return null;
  return DESIGN_TYPE_LABELS[designType];
}

function garmentCategoryToDisplayLabel(category) {
  if (!category) return null;
  if (GARMENT_CATEGORY_LABELS[category]) return GARMENT_CATEGORY_LABELS[category];
  return toProperCase(String(category));
}

/**
 * @param {object} sources
 * @param {object} [sources.team] - { city?, teamName?, league? }
 * @param {object} [sources.design] - { designType?, designSeries? }
 * @param {object} [sources.blank] - { garmentCategory, colorName }
 * @returns {{ displayTags: string[], normalizedTags: string[] }}
 */
function generateProductTags(sources) {
  const displayTags = [];
  const normalizedTags = [];

  function add(display) {
    if (!display || typeof display !== "string") return;
    const trimmed = display.trim();
    if (!trimmed) return;
    const proper = toProperCase(trimmed);
    if (!proper) return;
    displayTags.push(proper);
    normalizedTags.push(normalizeTagForFilter(proper));
  }

  const team = sources.team || null;
  const design = sources.design || null;
  const blank = sources.blank || null;

  if (team) {
    if (team.city && typeof team.city === "string") add(team.city);
    if (team.teamName && typeof team.teamName === "string") add(team.teamName);
    if (team.league && typeof team.league === "string") add(team.league);
  }

  if (design && design.designType) {
    const label = designTypeToDisplayLabel(design.designType);
    if (label) add(label);
  }

  if (blank) {
    const garmentLabel = garmentCategoryToDisplayLabel(blank.garmentCategory);
    if (garmentLabel) add(garmentLabel);
    if (blank.colorName && typeof blank.colorName === "string") add(blank.colorName);
  }

  const seenDisplay = new Set();
  const seenNorm = new Set();
  const outDisplay = [];
  const outNormalized = [];
  for (let i = 0; i < displayTags.length; i++) {
    const d = displayTags[i];
    const n = normalizedTags[i];
    const normKey = n.toLowerCase();
    if (seenDisplay.has(d) || seenNorm.has(normKey)) continue;
    seenDisplay.add(d);
    seenNorm.add(normKey);
    outDisplay.push(d);
    outNormalized.push(n);
  }

  const seriesRaw =
    design && design.designSeries != null ? String(design.designSeries).trim().toLowerCase() : "";
  if (seriesRaw) {
    const seriesTag = `series:${seriesRaw}`;
    if (!seenDisplay.has(seriesTag) && !seenNorm.has(seriesTag)) {
      outDisplay.push(seriesTag);
      outNormalized.push(seriesTag);
    }
  }

  return { displayTags: outDisplay, normalizedTags: outNormalized };
}

module.exports = { generateProductTags };
