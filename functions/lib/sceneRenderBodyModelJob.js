"use strict";

/**
 * Deterministic `body_model`: fixed camera body base + garment mask + flat_clean.back composite.
 * No faces, no AI — Sharp only. Mask luminance multiplies garment alpha pixel-wise (full-frame alignment).
 */

const { savePngAndPublicUrl } = require("./sceneRenderDeterministicShared");
const { productMatchesSceneTemplate } = require("./sceneTemplateEligibility");

const BODY_MODEL_SCENE_KEY = "body_model";

/**
 * @param {object} variant
 * @returns {{ url: string, sourceAssetRef: string } | null}
 */
function pickFlatCleanBackOnly(variant) {
  const fr = variant.flatRenders || {};
  const clean = fr.flat_clean || {};
  if (clean.back && clean.back.url) {
    return { url: String(clean.back.url), sourceAssetRef: "flat_clean.back" };
  }
  return null;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {{
 *   baseImageUrl: string;
 *   maskImageUrl: string;
 *   shadowUrl?: string | null;
 *   lightingUrl?: string | null;
 *   placement: { x: number; y: number; scale: number };
 * }} resolved
 * @param {Buffer} garmentBuf
 */
async function compositeBodyModelScene(fetchImpl, resolved, garmentBuf) {
  const sharp = require("sharp");
  const baseResp = await fetchImpl(resolved.baseImageUrl);
  if (!baseResp.ok) throw new Error(`Failed to fetch body base: ${baseResp.status}`);
  const maskResp = await fetchImpl(resolved.maskImageUrl);
  if (!maskResp.ok) throw new Error(`Failed to fetch garment mask: ${maskResp.status}`);

  const baseBuf = Buffer.from(await baseResp.arrayBuffer());
  const maskBuf = Buffer.from(await maskResp.arrayBuffer());

  const bgMeta = await sharp(baseBuf).metadata();
  const W = bgMeta.width;
  const H = bgMeta.height;
  if (!W || !H) throw new Error("Invalid body base dimensions");

  const { x, y, scale } = resolved.placement;
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

  const garmentFullRaw = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: garmentPng, left, top, blend: "over" }])
    .ensureAlpha()
    .raw()
    .toBuffer({ width: W, height: H });

  const maskGrey = await sharp(maskBuf).resize(W, H).greyscale().raw().toBuffer({ width: W, height: H });

  const masked = Buffer.from(garmentFullRaw);
  for (let i = 0; i < W * H; i++) {
    const m = maskGrey[i] ?? 0;
    masked[i * 4 + 3] = Math.round((masked[i * 4 + 3] * m) / 255);
  }

  const garmentMasked = await sharp(masked, {
    raw: { width: W, height: H, channels: 4 },
  })
    .png()
    .toBuffer();

  const composites = [{ input: garmentMasked, left: 0, top: 0, blend: "over" }];

  if (resolved.shadowUrl) {
    const shResp = await fetchImpl(resolved.shadowUrl);
    if (shResp.ok) {
      const shBuf = Buffer.from(await shResp.arrayBuffer());
      const shSized = await sharp(shBuf).resize(W, H).ensureAlpha().png().toBuffer();
      composites.push({ input: shSized, left: 0, top: 0, blend: "over" });
    }
  }
  if (resolved.lightingUrl) {
    const liResp = await fetchImpl(resolved.lightingUrl);
    if (liResp.ok) {
      const liBuf = Buffer.from(await liResp.arrayBuffer());
      const liSized = await sharp(liBuf).resize(W, H).ensureAlpha().png().toBuffer();
      composites.push({ input: liSized, left: 0, top: 0, blend: "over" });
    }
  }

  return sharp(baseBuf).composite(composites).png().toBuffer();
}

/**
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {import("@google-cloud/storage").Bucket} bucket
 * @param {typeof fetch} fetchFn
 * @param {import("firebase-admin")} admin
 */
async function processBodyModelSceneJob(db, bucket, fetchFn, admin, jobId, job) {
  const globalFetch = fetchFn;
  const productId = job.productId;
  const variantId = job.productVariantId;
  if (!productId || !variantId) {
    throw new Error("productId and productVariantId are required");
  }

  const productRef = db.collection("rp_products").doc(productId);
  const variantRef = productRef.collection("variants").doc(variantId);

  const [productSnap, variantSnap] = await Promise.all([productRef.get(), variantRef.get()]);
  if (!productSnap.exists) throw new Error("Product not found");
  if (!variantSnap.exists) throw new Error("Variant not found");

  const product = productSnap.data();
  const variant = variantSnap.data();

  const tSnap = await db.collection("rp_scene_templates").doc(BODY_MODEL_SCENE_KEY).get();
  const templateDoc = tSnap.exists ? tSnap.data() : {};

  if (!productMatchesSceneTemplate(product, templateDoc)) {
    throw new Error(
      "Product is not eligible for body_model (see rp_scene_templates/body_model blankCategoriesAllowed)."
    );
  }

  const baseUrl = String(
    templateDoc.backgroundAssetUrl || process.env.BODY_MODEL_BASE_IMAGE_URL || ""
  ).trim();
  const maskUrl = String(templateDoc.maskAssetUrl || process.env.BODY_MODEL_MASK_URL || "").trim();
  if (!baseUrl) {
    throw new Error("No body base URL: set rp_scene_templates/body_model.backgroundAssetUrl or BODY_MODEL_BASE_IMAGE_URL");
  }
  if (!maskUrl) {
    throw new Error("No garment mask URL: set rp_scene_templates/body_model.maskAssetUrl or BODY_MODEL_MASK_URL");
  }

  const shadowUrl = String(templateDoc.shadowAssetUrl || process.env.BODY_MODEL_SHADOW_URL || "").trim() || null;
  const lightingUrl = String(templateDoc.lightingAssetUrl || process.env.BODY_MODEL_LIGHTING_URL || "").trim() || null;

  const gp = templateDoc.garmentPlacement;
  const placement =
    gp && typeof gp === "object"
      ? {
          x: Number(gp.x) || 0.5,
          y: Number(gp.y) || 0.48,
          scale: Number(gp.scale) || 0.42,
        }
      : { x: 0.5, y: 0.48, scale: 0.42 };

  const source = pickFlatCleanBackOnly(variant);
  if (!source) {
    throw new Error("No flat_clean.back URL — generate back clean flat first.");
  }

  const flatResp = await globalFetch(source.url);
  if (!flatResp.ok) throw new Error(`Failed to fetch flat_clean.back: ${flatResp.status}`);
  const flatBuf = Buffer.from(await flatResp.arrayBuffer());

  const outBuf = await compositeBodyModelScene(
    globalFetch,
    { baseImageUrl: baseUrl, maskImageUrl: maskUrl, shadowUrl, lightingUrl, placement },
    flatBuf
  );

  const sharp = require("sharp");
  const meta = await sharp(outBuf).metadata();

  const storagePath = `rp_products/${productId}/variants/${variantId}/scene_templates/${BODY_MODEL_SCENE_KEY}/final.png`;
  const url = await savePngAndPublicUrl(bucket, storagePath, outBuf);

  const templateVersion = templateDoc.templateVersion != null ? Number(templateDoc.templateVersion) : 1;
  const autoApprove = templateDoc.autoApproveDefault !== false;

  const gallerySort =
    templateDoc.gallerySort != null && !Number.isNaN(Number(templateDoc.gallerySort))
      ? Number(templateDoc.gallerySort)
      : 38;

  const galleryRoleRaw = templateDoc.sceneOutputGalleryRole;
  const galleryRole =
    galleryRoleRaw === "alt_scene_secondary" ? "alt_scene_secondary" : "alt_scene_primary";

  const now = admin.firestore.FieldValue.serverTimestamp();
  const uid = job.updatedBy || job.createdBy || "system";

  const assetPayload = {
    productId,
    parentProductId: productId,
    variantDocId: variantId,
    blankVariantId: variant.blankVariantId || null,
    sceneTemplateId: BODY_MODEL_SCENE_KEY,
    sceneTemplateSlug: BODY_MODEL_SCENE_KEY,
    assetType: "lifestyleImage",
    type: "lifestyleImage",
    semanticAssetKind: "scene_model_back",
    galleryRole,
    gallerySort,
    sourceType: "deterministic_scene",
    status: autoApprove ? "approved" : "draft",
    approvalState: autoApprove ? "auto_approved" : "pending_review",
    publicUrl: url,
    downloadUrl: url,
    storagePath,
    width: meta.width,
    height: meta.height,
    view: "back",
    metadata: {
      sceneRenderJobId: jobId,
      sourceAssetRef: source.sourceAssetRef,
      sourceUrl: source.url,
      templateVersion,
      renderEngine: "body_model_deterministic_v1",
    },
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
    updatedBy: uid,
  };

  const assetRef = await db.collection("rp_product_assets").add(assetPayload);

  const variantSceneEntry = {
    sceneTemplateId: BODY_MODEL_SCENE_KEY,
    sceneTemplateSlug: BODY_MODEL_SCENE_KEY,
    sceneType: "body_model",
    status: "generated",
    assetUrl: url,
    thumbUrl: url,
    outputWidth: meta.width,
    outputHeight: meta.height,
    outputFormat: "png",
    sourceView: "back",
    sourceAssetRef: source.sourceAssetRef,
    approvalState: autoApprove ? "auto_approved" : "pending_review",
    generationFingerprint: `${templateVersion}:${source.sourceAssetRef}`,
    renderEngine: "body_model_deterministic_v1",
    assetId: assetRef.id,
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
    updatedBy: uid,
  };

  const prev = variant.sceneTemplateRenders && typeof variant.sceneTemplateRenders === "object" ? variant.sceneTemplateRenders : {};

  await variantRef.update({
    sceneTemplateRenders: { ...prev, [BODY_MODEL_SCENE_KEY]: variantSceneEntry },
    updatedAt: now,
    updatedBy: uid,
  });

  return {
    url,
    storagePath,
    assetId: assetRef.id,
    source,
    width: meta.width,
    height: meta.height,
  };
}

module.exports = {
  BODY_MODEL_SCENE_KEY,
  pickFlatCleanBackOnly,
  processBodyModelSceneJob,
};
