"use strict";

/**
 * Phase 2: deterministic neutral_hanger scene from variant-native commerce sources.
 * Composites into SCENE_HANGER_CREWNECK_BACKGROUND_URL (or template.backgroundAssetUrl).
 */

const NEUTRAL_HANGER_SCENE_KEY = "neutral_hanger";

/**
 * Explicit priority: 8394 back-primary uses back chain first; else front chain.
 * @param {object} variant - variant doc
 * @param {object} product - parent product doc
 * @returns {{ url: string, sourceAssetRef: string, sourceView: "front" | "back" } | null}
 */
function pickNeutralHangerCommerceSource(variant, product) {
  const fr = variant.flatRenders || {};
  const blended = fr.flat_blended || {};
  const clean = fr.flat_clean || {};
  const m = variant.media || {};
  const is8394 = String(product.blankStyleCode || "").trim() === "8394";

  if (is8394) {
    if (blended.back && blended.back.url) {
      return { url: String(blended.back.url), sourceAssetRef: "flat_blended.back", sourceView: "back" };
    }
    if (m.heroBack && String(m.heroBack).trim()) {
      return { url: String(m.heroBack).trim(), sourceAssetRef: "media.heroBack", sourceView: "back" };
    }
    if (blended.front && blended.front.url) {
      return { url: String(blended.front.url), sourceAssetRef: "flat_blended.front", sourceView: "front" };
    }
    if (m.heroFront && String(m.heroFront).trim()) {
      return { url: String(m.heroFront).trim(), sourceAssetRef: "media.heroFront", sourceView: "front" };
    }
    if (clean.front && clean.front.url) {
      return { url: String(clean.front.url), sourceAssetRef: "flat_clean.front", sourceView: "front" };
    }
  } else {
    if (blended.front && blended.front.url) {
      return { url: String(blended.front.url), sourceAssetRef: "flat_blended.front", sourceView: "front" };
    }
    if (m.heroFront && String(m.heroFront).trim()) {
      return { url: String(m.heroFront).trim(), sourceAssetRef: "media.heroFront", sourceView: "front" };
    }
    if (clean.front && clean.front.url) {
      return { url: String(clean.front.url), sourceAssetRef: "flat_clean.front", sourceView: "front" };
    }
    if (blended.back && blended.back.url) {
      return { url: String(blended.back.url), sourceAssetRef: "flat_blended.back", sourceView: "back" };
    }
    if (m.heroBack && String(m.heroBack).trim()) {
      return { url: String(m.heroBack).trim(), sourceAssetRef: "media.heroBack", sourceView: "back" };
    }
  }
  return null;
}

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
 * @param {typeof fetch} fetchImpl
 * @param {{ backgroundImageUrl: string; shadowUrl?: string | null; placement: { x: number; y: number; scale: number } }} templateResolved
 * @param {Buffer} garmentBuf
 */
async function compositeHangerScene(fetchImpl, templateResolved, garmentBuf) {
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

/**
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {import("@google-cloud/storage").Bucket} bucket
 * @param {typeof fetch} fetchFn
 * @param {import("firebase-admin")} admin
 */
async function processNeutralHangerSceneJob(db, bucket, fetchFn, admin, jobId, job) {
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

  const tSnap = await db.collection("rp_scene_templates").doc(NEUTRAL_HANGER_SCENE_KEY).get();
  const templateDoc = tSnap.exists ? tSnap.data() : {};

  const backgroundImageUrl = String(
    templateDoc.backgroundAssetUrl || process.env.SCENE_HANGER_CREWNECK_BACKGROUND_URL || ""
  ).trim();
  if (!backgroundImageUrl) {
    throw new Error(
      "No background URL: set rp_scene_templates/neutral_hanger.backgroundAssetUrl or SCENE_HANGER_CREWNECK_BACKGROUND_URL"
    );
  }

  const shadowUrl = String(templateDoc.shadowAssetUrl || process.env.SCENE_HANGER_CREWNECK_SHADOW_URL || "")
    .trim() || null;

  const gp = templateDoc.garmentPlacement;
  const placement =
    gp && typeof gp === "object"
      ? {
          x: Number(gp.x) || 0.5,
          y: Number(gp.y) || 0.46,
          scale: Number(gp.scale) || 0.52,
        }
    : { x: 0.5, y: 0.46, scale: 0.52 };

  const source = pickNeutralHangerCommerceSource(variant, product);
  if (!source) {
    throw new Error(
      "No variant-native commerce source (flat_blended / flat_clean / hero). Generate flats or mockups first."
    );
  }

  const flatResp = await globalFetch(source.url);
  if (!flatResp.ok) throw new Error(`Failed to fetch source image: ${flatResp.status}`);
  const flatBuf = Buffer.from(await flatResp.arrayBuffer());

  const outBuf = await compositeHangerScene(globalFetch, { backgroundImageUrl, shadowUrl, placement }, flatBuf);

  const sharp = require("sharp");
  const meta = await sharp(outBuf).metadata();

  const storagePath = `rp_products/${productId}/variants/${variantId}/scene_templates/${NEUTRAL_HANGER_SCENE_KEY}/final.png`;
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
    sceneTemplateId: NEUTRAL_HANGER_SCENE_KEY,
    sceneTemplateSlug: NEUTRAL_HANGER_SCENE_KEY,
    assetType: "lifestyleImage",
    type: "lifestyleImage",
    semanticAssetKind: "scene_hanger",
    galleryRole: "alt_scene_primary",
    gallerySort: 40,
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
    sceneTemplateId: NEUTRAL_HANGER_SCENE_KEY,
    sceneTemplateSlug: NEUTRAL_HANGER_SCENE_KEY,
    sceneType: "hanger",
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
    sceneTemplateRenders: { ...prev, [NEUTRAL_HANGER_SCENE_KEY]: variantSceneEntry },
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
  NEUTRAL_HANGER_SCENE_KEY,
  pickNeutralHangerCommerceSource,
  processNeutralHangerSceneJob,
};
