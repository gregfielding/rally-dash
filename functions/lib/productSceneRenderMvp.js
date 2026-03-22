"use strict";

/**
 * MVP: deterministic scene composite — flat_blended PNG into a fixed hanger (crewneck) template.
 * Non-AI. Configure template assets with env vars on the Cloud Function runtime:
 *   SCENE_HANGER_CREWNECK_BACKGROUND_URL  (required, HTTPS)
 *   SCENE_HANGER_CREWNECK_SHADOW_URL      (optional, full-scene PNG with alpha)
 *   SCENE_HANGER_CREWNECK_MASK_URL        (reserved; not applied in MVP)
 *
 * Writes product.sceneRenders.hanger on rp_products/{productId}.
 */

const functions = require("firebase-functions");

async function savePngAndReadableUrl(bucket, storagePath, buf) {
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType: "image/png",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  } catch (aclErr) {
    console.warn(
      "[generateProductSceneRender] makePublic failed; using signed URL:",
      aclErr && aclErr.message
    );
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 366 * 24 * 60 * 60 * 1000,
    });
    return signedUrl;
  }
}

function resolveHangerCrewneckTemplate() {
  const backgroundImageUrl = (process.env.SCENE_HANGER_CREWNECK_BACKGROUND_URL || "").trim();
  const shadowUrl = (process.env.SCENE_HANGER_CREWNECK_SHADOW_URL || "").trim() || null;
  if (!backgroundImageUrl) return null;
  return {
    sceneId: "hanger_crewneck",
    category: "hanger",
    garmentType: "crewneck",
    backgroundImageUrl,
    shadowUrl,
    placement: { x: 0.5, y: 0.46, scale: 0.52 },
    compatibleBlankStyles: ["*"],
  };
}

function pickFlatBlendedSource(flatRenders) {
  if (!flatRenders || typeof flatRenders !== "object") return null;
  const blended = flatRenders.flat_blended || {};
  const front = blended.front;
  const back = blended.back;
  if (front && front.url) return { url: String(front.url), view: "front" };
  if (back && back.url) return { url: String(back.url), view: "back" };
  return null;
}

function blankStyleAllowed(template, styleCode) {
  const list = template.compatibleBlankStyles || [];
  if (!list.length) return true;
  if (list.includes("*")) return true;
  return list.includes(String(styleCode || "").trim());
}

/**
 * @param {{ admin: import("firebase-admin"); db: FirebaseFirestore.Firestore; storage: import("@google-cloud/storage").Bucket; fetch: typeof fetch }} deps
 */
function createRegisterGenerateProductSceneRender({ admin, db, storage, fetch: fetchFn }) {
  return functions
    .runWith({ memory: "1GB", timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
      }

      const productId = data && data.productId;
      if (!productId || typeof productId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "productId is required");
      }

      const sceneKey = (data && data.sceneKey) || "hanger";
      if (sceneKey !== "hanger") {
        throw new functions.https.HttpsError("invalid-argument", "Only sceneKey 'hanger' is supported in MVP");
      }

      const template = resolveHangerCrewneckTemplate();
      if (!template) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Scene template not configured: set SCENE_HANGER_CREWNECK_BACKGROUND_URL on the function environment"
        );
      }

      const productRef = db.collection("rp_products").doc(productId);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Product not found");
      }
      const product = productSnap.data();

      const flatSource = pickFlatBlendedSource(product.flatRenders);
      if (!flatSource) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Product has no flat_blended render (front or back). Generate flat renders first."
        );
      }

      const blankId = product.blankId;
      if (blankId) {
        const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
        if (blankSnap.exists) {
          const blank = blankSnap.data();
          const sc = String(blank.styleCode || "").trim();
          if (!blankStyleAllowed(template, sc)) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              `Blank style ${sc || "unknown"} is not compatible with this scene template`
            );
          }
        }
      }

      const sharp = require("sharp");

      const bgResp = await fetchFn(template.backgroundImageUrl);
      if (!bgResp.ok) {
        throw new functions.https.HttpsError("internal", `Failed to fetch scene background: ${bgResp.status}`);
      }
      const bgBuf = Buffer.from(await bgResp.arrayBuffer());

      const flatResp = await fetchFn(flatSource.url);
      if (!flatResp.ok) {
        throw new functions.https.HttpsError("internal", `Failed to fetch flat render: ${flatResp.status}`);
      }
      const flatBuf = Buffer.from(await flatResp.arrayBuffer());

      const bgMeta = await sharp(bgBuf).metadata();
      const W = bgMeta.width;
      const H = bgMeta.height;
      if (!W || !H) {
        throw new functions.https.HttpsError("internal", "Invalid scene background dimensions");
      }

      const { x, y, scale } = template.placement;
      const targetW = Math.max(32, Math.round(W * scale));

      const garmentPng = await sharp(flatBuf)
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

      if (template.shadowUrl) {
        const shResp = await fetchFn(template.shadowUrl);
        if (shResp.ok) {
          const shBuf = Buffer.from(await shResp.arrayBuffer());
          composites.push({ input: shBuf, left: 0, top: 0, blend: "over" });
        }
      }

      const outBuf = await sharp(bgBuf).composite(composites).png().toBuffer();

      const bucket = storage.bucket();
      const ts = Date.now();
      const storagePath = `rp_products/${productId}/scene_renders/${ts}_hanger.png`;
      const url = await savePngAndReadableUrl(bucket, storagePath, outBuf);
      const now = admin.firestore.FieldValue.serverTimestamp();

      const prevScenes = product.sceneRenders && typeof product.sceneRenders === "object" ? product.sceneRenders : {};
      const slot = {
        url,
        storagePath,
        generatedAt: now,
        sceneId: template.sceneId,
        sourceFlatView: flatSource.view,
        sourceFlatUrl: flatSource.url,
      };

      await productRef.update({
        sceneRenders: { ...prevScenes, hanger: slot },
        updatedAt: now,
        updatedBy: context.auth.uid,
      });

      return {
        ok: true,
        productId,
        sceneKey: "hanger",
        url,
        sourceFlatView: flatSource.view,
      };
    });
}

module.exports = { createRegisterGenerateProductSceneRender };
