"use strict";

/**
 * Deterministic `backdrop_neutral`: garment on plain studio backdrop (universal tops + intimates).
 * Reuses the same commerce source priority as neutral_hanger.
 */

const { savePngAndPublicUrl, compositeGarmentOnBackground } = require("./sceneRenderDeterministicShared");
const { pickNeutralHangerCommerceSource } = require("./sceneRenderNeutralHangerJob");
const { productMatchesSceneTemplate } = require("./sceneTemplateEligibility");

const BACKDROP_NEUTRAL_SCENE_KEY = "backdrop_neutral";

/**
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {import("@google-cloud/storage").Bucket} bucket
 * @param {typeof fetch} fetchFn
 * @param {import("firebase-admin")} admin
 */
async function processBackdropNeutralSceneJob(db, bucket, fetchFn, admin, jobId, job) {
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

  const tSnap = await db.collection("rp_scene_templates").doc(BACKDROP_NEUTRAL_SCENE_KEY).get();
  const templateDoc = tSnap.exists ? tSnap.data() : {};

  if (!productMatchesSceneTemplate(product, templateDoc)) {
    throw new Error(
      "Product is not eligible for backdrop_neutral (see rp_scene_templates/backdrop_neutral blankCategoriesAllowed)."
    );
  }

  const backgroundImageUrl = String(
    templateDoc.backgroundAssetUrl || process.env.SCENE_BACKDROP_NEUTRAL_BACKGROUND_URL || ""
  ).trim();
  if (!backgroundImageUrl) {
    throw new Error(
      "No background URL: set rp_scene_templates/backdrop_neutral.backgroundAssetUrl or SCENE_BACKDROP_NEUTRAL_BACKGROUND_URL"
    );
  }

  const shadowUrl = String(templateDoc.shadowAssetUrl || process.env.SCENE_BACKDROP_NEUTRAL_SHADOW_URL || "")
    .trim() || null;

  const gp = templateDoc.garmentPlacement;
  const placement =
    gp && typeof gp === "object"
      ? {
          x: Number(gp.x) || 0.5,
          y: Number(gp.y) || 0.52,
          scale: Number(gp.scale) || 0.58,
        }
      : { x: 0.5, y: 0.52, scale: 0.58 };

  const source = pickNeutralHangerCommerceSource(variant, product);
  if (!source) {
    throw new Error(
      "No variant-native commerce source (flat_blended / flat_clean / hero). Generate flats or mockups first."
    );
  }

  const flatResp = await globalFetch(source.url);
  if (!flatResp.ok) throw new Error(`Failed to fetch source image: ${flatResp.status}`);
  const flatBuf = Buffer.from(await flatResp.arrayBuffer());

  const outBuf = await compositeGarmentOnBackground(
    globalFetch,
    { backgroundImageUrl, shadowUrl, placement },
    flatBuf
  );

  const sharp = require("sharp");
  const meta = await sharp(outBuf).metadata();

  const storagePath = `rp_products/${productId}/variants/${variantId}/scene_templates/${BACKDROP_NEUTRAL_SCENE_KEY}/final.png`;
  const url = await savePngAndPublicUrl(bucket, storagePath, outBuf);

  const templateVersion = templateDoc.templateVersion != null ? Number(templateDoc.templateVersion) : 1;
  const autoApprove = templateDoc.autoApproveDefault !== false;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const uid = job.updatedBy || job.createdBy || "system";

  const assetPayload = {
    productId,
    parentProductId: productId,
    variantDocId: variantId,
    blankVariantId: variant.blankVariantId || null,
    sceneTemplateId: BACKDROP_NEUTRAL_SCENE_KEY,
    sceneTemplateSlug: BACKDROP_NEUTRAL_SCENE_KEY,
    assetType: "lifestyleImage",
    type: "lifestyleImage",
    semanticAssetKind: "scene_backdrop_neutral",
    galleryRole: "alt_scene_secondary",
    gallerySort: 50,
    sourceType: "deterministic_scene",
    status: autoApprove ? "approved" : "draft",
    approvalState: autoApprove ? "auto_approved" : "pending_review",
    publicUrl: url,
    downloadUrl: url,
    storagePath,
    width: meta.width,
    height: meta.height,
    view: source.sourceView,
    metadata: {
      sceneRenderJobId: jobId,
      sourceAssetRef: source.sourceAssetRef,
      sourceUrl: source.url,
      templateVersion,
      renderEngine: "scene_template_mvp_v1",
    },
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
    updatedBy: uid,
  };

  const assetRef = await db.collection("rp_product_assets").add(assetPayload);

  const variantSceneEntry = {
    sceneTemplateId: BACKDROP_NEUTRAL_SCENE_KEY,
    sceneTemplateSlug: BACKDROP_NEUTRAL_SCENE_KEY,
    sceneType: "backdrop",
    status: "generated",
    assetUrl: url,
    thumbUrl: url,
    outputWidth: meta.width,
    outputHeight: meta.height,
    outputFormat: "png",
    sourceView: source.sourceView,
    sourceAssetRef: source.sourceAssetRef,
    approvalState: autoApprove ? "auto_approved" : "pending_review",
    generationFingerprint: `${templateVersion}:${source.sourceAssetRef}`,
    renderEngine: "scene_template_mvp_v1",
    assetId: assetRef.id,
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
    updatedBy: uid,
  };

  const prev = variant.sceneTemplateRenders && typeof variant.sceneTemplateRenders === "object" ? variant.sceneTemplateRenders : {};

  await variantRef.update({
    sceneTemplateRenders: { ...prev, [BACKDROP_NEUTRAL_SCENE_KEY]: variantSceneEntry },
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
  BACKDROP_NEUTRAL_SCENE_KEY,
  processBackdropNeutralSceneJob,
};
