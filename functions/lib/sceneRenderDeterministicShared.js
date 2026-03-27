"use strict";

/**
 * Shared helpers for deterministic scene templates (Sharp composite + GCS).
 */

/**
 * @param {import("@google-cloud/storage").Bucket} bucket
 * @param {string} storagePath
 * @param {Buffer} buf
 * @returns {Promise<string>} public or signed URL
 */
async function savePngAndPublicUrl(bucket, storagePath, buf) {
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType: "image/png",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  } catch (aclErr) {
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 366 * 24 * 60 * 60 * 1000,
    });
    return signedUrl;
  }
}

/**
 * Composite garment PNG onto a fetched background; optional full-bleed shadow overlay.
 *
 * @param {typeof fetch} fetchImpl
 * @param {{ backgroundImageUrl: string; shadowUrl?: string | null; placement: { x: number; y: number; scale: number } }} templateResolved
 * @param {Buffer} garmentBuf
 */
async function compositeGarmentOnBackground(fetchImpl, templateResolved, garmentBuf) {
  const sharp = require("sharp");
  const bgResp = await fetchImpl(templateResolved.backgroundImageUrl);
  if (!bgResp.ok) {
    throw new Error(`Failed to fetch scene background: ${bgResp.status}`);
  }
  const bgBuf = Buffer.from(await bgResp.arrayBuffer());
  const bgMeta = await sharp(bgBuf).metadata();
  const W = bgMeta.width;
  const H = bgMeta.height;
  if (!W || !H) throw new Error("Invalid scene background dimensions");

  const { x, y, scale } = templateResolved.placement;
  const targetW = Math.max(32, Math.round(W * scale));

  const garmentPng = await sharp(garmentBuf)
    .resize({ width: targetW, height: targetW, fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const gm = await sharp(garmentPng).metadata();
  const gw = gm.width || targetW;
  const gh = gm.height || targetW;
  let left = Math.round(x * W - gw / 2);
  let top = Math.round(y * H - gh / 2);
  left = Math.max(0, Math.min(left, W - gw));
  top = Math.max(0, Math.min(top, H - gh));

  const composites = [{ input: garmentPng, left, top, blend: "over" }];

  if (templateResolved.shadowUrl) {
    const shResp = await fetchImpl(templateResolved.shadowUrl);
    if (shResp.ok) {
      const shBuf = Buffer.from(await shResp.arrayBuffer());
      composites.push({ input: shBuf, left: 0, top: 0, blend: "over" });
    }
  }

  return sharp(bgBuf).composite(composites).png().toBuffer();
}

module.exports = {
  savePngAndPublicUrl,
  compositeGarmentOnBackground,
};
