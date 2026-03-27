"use strict";

/**
 * Deterministic flatlay scenes: wood surface + boutique styling.
 * Same composite path as backdrop_neutral; per-template backgrounds and gallerySort.
 */

const { savePngAndPublicUrl, compositeGarmentOnBackground } = require("./sceneRenderDeterministicShared");
const { pickNeutralHangerCommerceSource } = require("./sceneRenderNeutralHangerJob");
const { productMatchesSceneTemplate } = require("./sceneTemplateEligibility");

const FLATLAY_WOOD_SCENE_KEY = "flatlay_wood";
const FLATLAY_BOUTIQUE_SCENE_KEY = "flatlay_boutique";

/** @type {Record<string, { semanticAssetKind: string; sceneType: string; galleryRole: string; gallerySort: number; envBackground: string; envShadow: string; defaultPlacement: { x: number; y: number; scale: number } }>} */
const FLATLAY_SCENE_CONFIG = {
  [FLATLAY_WOOD_SCENE_KEY]: {
    semanticAssetKind: "scene_flatlay_wood",
    sceneType: "flatlay_floor",
    galleryRole: "alt_scene_secondary",
    gallerySort: 52,
    envBackground: "SCENE_FLATLAY_WOOD_BACKGROUND_URL",
    envShadow: "SCENE_FLATLAY_WOOD_SHADOW_URL",
    defaultPlacement: { x: 0.5, y: 0.56, scale: 0.46 },
  },
  [FLATLAY_BOUTIQUE_SCENE_KEY]: {
    semanticAssetKind: "scene_flatlay_boutique",
    sceneType: "flatlay_boutique",
    galleryRole: "alt_scene_secondary",
    gallerySort: 54,
    envBackground: "SCENE_FLATLAY_BOUTIQUE_BACKGROUND_URL",
    envShadow: "SCENE_FLATLAY_BOUTIQUE_SHADOW_URL",
    defaultPlacement: { x: 0.5, y: 0.55, scale: 0.44 },
  },
};

const FLATLAY_SCENE_KEYS = new Set(Object.keys(FLATLAY_SCENE_CONFIG));

/**
 * Shopify / storefront parity: gallery ordering matches `lib/shopify/galleryAssetOrdering.ts`
 * (approvalState → galleryRole → gallerySort). Sort values: hanger 40, backdrop 50, wood 52, boutique 54.
 *
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {import("@google-cloud/storage").Bucket} bucket
 * @param {typeof fetch} fetchFn
 * @param {import("firebase-admin")} admin
 */
async function processFlatlaySceneJob(db, bucket, fetchFn, admin, jobId, job) {
  const sceneKey = job.sceneKey;
  const cfg = FLATLAY_SCENE_CONFIG[sceneKey];
  if (!cfg) {
    throw new Error(`Unknown flatlay sceneKey: ${sceneKey}`);
  }

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

  const tSnap = await db.collection("rp_scene_templates").doc(sceneKey).get();
  const templateDoc = tSnap.exists ? tSnap.data() : {};

  if (!productMatchesSceneTemplate(product, templateDoc)) {
    throw new Error(
      `Product is not eligible for ${sceneKey} (see rp_scene_templates/${sceneKey} blankCategoriesAllowed).`
    );
  }

  const bgFromTemplate = templateDoc.backgroundAssetUrl != null ? String(templateDoc.backgroundAssetUrl).trim() : "";
  const bgFromEnv = process.env[cfg.envBackground] ? String(process.env[cfg.envBackground]).trim() : "";
  const backgroundImageUrl = bgFromTemplate || bgFromEnv;
  if (!backgroundImageUrl) {
    throw new Error(
      `No background URL: set rp_scene_templates/${sceneKey}.backgroundAssetUrl or ${cfg.envBackground}`
    );
  }

  const shFromTemplate = templateDoc.shadowAssetUrl != null ? String(templateDoc.shadowAssetUrl).trim() : "";
  const shFromEnv = process.env[cfg.envShadow] ? String(process.env[cfg.envShadow]).trim() : "";
  const shadowUrl = shFromTemplate || shFromEnv || null;

  const gp = templateDoc.garmentPlacement;
  const placement =
    gp && typeof gp === "object"
      ? {
          x: Number(gp.x) || cfg.defaultPlacement.x,
          y: Number(gp.y) || cfg.defaultPlacement.y,
          scale: Number(gp.scale) || cfg.defaultPlacement.scale,
        }
      : { ...cfg.defaultPlacement };

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

  const storagePath = `rp_products/${productId}/variants/${variantId}/scene_templates/${sceneKey}/final.png`;
  const url = await savePngAndPublicUrl(bucket, storagePath, outBuf);

  const templateVersion = templateDoc.templateVersion != null ? Number(templateDoc.templateVersion) : 1;
  const autoApprove = templateDoc.autoApproveDefault !== false;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const uid = job.updatedBy || job.createdBy || "system";

  const gallerySort =
    templateDoc.gallerySort != null && !Number.isNaN(Number(templateDoc.gallerySort))
      ? Number(templateDoc.gallerySort)
      : cfg.gallerySort;

  const sceneTypeOut = String(templateDoc.sceneType || cfg.sceneType).trim();

  const assetPayload = {
    productId,
    parentProductId: productId,
    variantDocId: variantId,
    blankVariantId: variant.blankVariantId || null,
    sceneTemplateId: sceneKey,
    sceneTemplateSlug: sceneKey,
    assetType: "lifestyleImage",
    type: "lifestyleImage",
    semanticAssetKind: cfg.semanticAssetKind,
    galleryRole: cfg.galleryRole,
    gallerySort,
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
    sceneTemplateId: sceneKey,
    sceneTemplateSlug: sceneKey,
    sceneType: sceneTypeOut,
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
    sceneTemplateRenders: { ...prev, [sceneKey]: variantSceneEntry },
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
  FLATLAY_WOOD_SCENE_KEY,
  FLATLAY_BOUTIQUE_SCENE_KEY,
  FLATLAY_SCENE_KEYS,
  processFlatlaySceneJob,
};
