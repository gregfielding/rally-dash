"use strict";

/**
 * Phase 3: callable that enqueues a model-realism render for a specific product
 * variant. Sits on top of the Phase 2 `rp_blank_preview_jobs` system — the
 * preview pipeline does the actual Flux Fill work and writes the result back
 * to the variant's `flatRenders` slot via the product binding fields on the
 * job doc.
 *
 * One call = one (productId, blankVariantId, view) render. Callers fan out
 * across colors / sides themselves, so each render is independently
 * retriable / cancellable / chargeable.
 *
 * Input:
 *   { productId, blankVariantId, view: "front" | "back", withRealism?: true }
 *
 * Output:
 *   { jobId, status: "queued" }
 *
 * The Phase 2 trigger picks up the job, runs Stage A → Stage B, then writes
 * the realism URL to the variant's `flatRenders[officialRole]` slot.
 */

const VIEW_TO_OFFICIAL_ROLE = Object.freeze({
  front: "model_front_designed",
  back: "model_back_designed",
});

const VIEW_TO_RENDER_TARGET = Object.freeze({
  front: "model_front",
  back: "model_back",
});

/**
 * Resolve the placement params the preview job needs (x, y, scale + slider
 * values). Reads the variant's effective render target settings from the
 * blank, applying the same fallback chain the editor uses.
 *
 * Kept minimal: any field the caller doesn't have falls through to a safe
 * default in `validatePreviewInput` server-side.
 */
function resolvePlacementForVariant(blank, blankVariant, renderTarget) {
  /** Default to a centered placement at 50% scale; the operator can overlay tuning later. */
  const defaults = { x: 0.5, y: 0.5, scale: 0.5 };

  /**
   * Look up the per-variant render-target settings. Blank schema v2 stores
   * these on `variant.renderTargets[renderTarget]`; fall back to the blank's
   * top-level defaults when missing.
   */
  const variantRenderTargets = (blankVariant && blankVariant.renderTargets) || {};
  const targetSettings = variantRenderTargets[renderTarget] || {};
  const blankDefaults = (blank && blank.generationDefaults && blank.generationDefaults.placement) || {};

  const placement = {
    x:
      Number.isFinite(Number(targetSettings.x)) ? Number(targetSettings.x)
      : Number.isFinite(Number(blankDefaults.x)) ? Number(blankDefaults.x)
      : defaults.x,
    y:
      Number.isFinite(Number(targetSettings.y)) ? Number(targetSettings.y)
      : Number.isFinite(Number(blankDefaults.y)) ? Number(blankDefaults.y)
      : defaults.y,
    scale:
      Number.isFinite(Number(targetSettings.scale)) ? Number(targetSettings.scale)
      : Number.isFinite(Number(blankDefaults.scale)) ? Number(blankDefaults.scale)
      : defaults.scale,
    /** Slider knobs that drive Flux Fill prompt + pre-blur. */
    fabricFeel:
      Number.isFinite(Number(targetSettings.fabricFeel)) ? Number(targetSettings.fabricFeel) : 0.5,
    printStrength:
      Number.isFinite(Number(targetSettings.printStrength)) ? Number(targetSettings.printStrength) : 0.85,
    /** Mask strategy. "blank_mask_doc" auto-loads the per-target mask if it exists; "none" skips. */
    maskConfig: { mode: targetSettings.maskMode || "blank_mask_doc" },
  };

  /** Optional safeArea passthrough (Option A safeArea-based sizing). */
  const sa = targetSettings.safeArea || blankDefaults.safeArea || null;
  if (sa && Number.isFinite(Number(sa.w))) placement.width = Number(sa.w);
  if (sa && Number.isFinite(Number(sa.h))) placement.height = Number(sa.h);

  return placement;
}

function buildEnqueueProductModelRealism({ db, admin, functions }) {
  return async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
    }

    const {
      productId,
      blankVariantId,
      view: viewIn,
      withRealism: withRealismIn,
      artworkMode: artworkModeIn,
    } = data || {};
    if (!productId || typeof productId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "productId is required");
    }
    if (!blankVariantId || typeof blankVariantId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankVariantId is required");
    }
    const view = viewIn === "front" || viewIn === "back" ? viewIn : null;
    if (!view) {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
    }
    /** Default to true for product-asset use case — that's the whole point. */
    const withRealism = withRealismIn === false ? false : true;
    const artworkMode =
      artworkModeIn === "dark" || artworkModeIn === "white" ? artworkModeIn : "light";

    const renderTarget = VIEW_TO_RENDER_TARGET[view];
    const officialRole = VIEW_TO_OFFICIAL_ROLE[view];

    /** Load product → designId, blankId, then load both. Refuse to enqueue when any is missing. */
    const productRef = db.collection("rp_products").doc(productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Product ${productId} not found`);
    }
    const product = productSnap.data() || {};
    const designId =
      (product.designId && String(product.designId).trim()) ||
      (product.designIdBack && String(product.designIdBack).trim()) ||
      (product.designIdFront && String(product.designIdFront).trim()) ||
      null;
    const blankId = product.blankId && String(product.blankId).trim();
    if (!designId || !blankId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Product ${productId} missing designId or blankId`
      );
    }

    const [designSnap, blankSnap] = await Promise.all([
      db.collection("designs").doc(designId).get(),
      db.collection("rp_blanks").doc(blankId).get(),
    ]);
    if (!designSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
    }
    if (!blankSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
    }
    const blank = blankSnap.data() || {};

    /** Find the matching blank variant row for placement defaults. */
    const blankVariants = Array.isArray(blank.variants) ? blank.variants : [];
    const blankVariant = blankVariants.find((v) => v && v.variantId === blankVariantId);
    if (!blankVariant) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Blank ${blankId} has no variant ${blankVariantId}`
      );
    }
    /**
     * Verify the variant has a model photo for this view — otherwise the
     * Phase 2 composer will reject the job. Surface the error at enqueue
     * time so the caller doesn't pay for a failed render.
     */
    const variantImages = blankVariant.images || {};
    const modelPhoto = view === "front" ? variantImages.modelFront : variantImages.modelBack;
    if (!modelPhoto || !modelPhoto.downloadUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Variant ${blankVariantId} has no ${view === "front" ? "modelFront" : "modelBack"} photo — upload one on the blank Identity tab first`
      );
    }

    /**
     * Find the *product* variant id (rp_products/{productId}/variants/{x})
     * that corresponds to this blankVariantId. The trigger needs the
     * product-variant id, not the blank-variant id, to write the result.
     */
    const productVariantsSnap = await productRef
      .collection("variants")
      .where("blankVariantId", "==", blankVariantId)
      .limit(1)
      .get();
    const productVariantDoc = productVariantsSnap.docs[0];
    if (!productVariantDoc) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `No product variant found for blankVariantId=${blankVariantId} under product ${productId} — has the product been materialized?`
      );
    }
    const targetVariantId = productVariantDoc.id;

    /** Resolve placement params from the saved blank render profile. */
    const placement = resolvePlacementForVariant(blank, blankVariant, renderTarget);

    /**
     * Enqueue the preview job with the product binding. The Phase 2 trigger
     * will pick it up, render Stage A + B, and the Phase 3 binding-write
     * branch will land the URL in the variant's flatRenders[officialRole]
     * when complete.
     */
    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobRef = await db.collection("rp_blank_preview_jobs").add({
      blankId,
      variantId: blankVariantId,
      designId,
      view,
      renderTarget,
      artworkMode,
      placement,
      withRealism,
      status: "queued",
      error: null,
      stageA: null,
      stageB: null,
      /** Phase 3 product binding. */
      targetProductId: productId,
      targetVariantId,
      officialRole,
      createdAt: now,
      createdByUid: context.auth.uid,
      updatedAt: now,
    });

    return { jobId: jobRef.id, status: "queued", officialRole };
  };
}

module.exports = {
  buildEnqueueProductModelRealism,
  VIEW_TO_OFFICIAL_ROLE,
  VIEW_TO_RENDER_TARGET,
};
