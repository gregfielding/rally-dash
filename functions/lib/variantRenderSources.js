"use strict";

function pickUrl(ref) {
  if (!ref || !ref.downloadUrl) return null;
  const u = String(ref.downloadUrl).trim();
  return u || null;
}

function getVariantFlatBackUrl(blank, variant) {
  const im = variant && variant.images;
  return (
    pickUrl(im && im.flatBack) ||
    pickUrl(im && im.back) ||
    pickUrl(blank && blank.images && blank.images.back) ||
    null
  );
}

function getVariantFlatFrontUrl(blank, variant) {
  const im = variant && variant.images;
  return (
    pickUrl(im && im.flatFront) ||
    pickUrl(im && im.front) ||
    pickUrl(blank && blank.images && blank.images.front) ||
    null
  );
}

function getVariantModelBackUrl(blank, variant) {
  const im = variant && variant.images;
  return pickUrl(im && im.modelBack) || null;
}

function getVariantModelFrontUrl(blank, variant) {
  const im = variant && variant.images;
  return pickUrl(im && im.modelFront) || null;
}

module.exports = {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
};
