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
   * RenderCore R5: resolve placement + blend from the CANONICAL render profile
   * (`resolveEffectiveRenderTargetSettings` → reads `renderProfile.renderTargetsByColor`
   * / placement baseline / variant slices) — the SAME source the deterministic engine
   * (`render8394` via `resolveSavedBlankRenderProfile`) and the blank editor use.
   *
   * Previously this read the legacy `blankVariant.renderTargets` + `generationDefaults`,
   * so the Flux VTON realism layer positioned/sized the design differently than every
   * other surface. Now the AI realism input is placed per the same per-(color,view)
   * settings, so on-body realism honors the blank profile. fabricFeel/printStrength still
   * feed the Flux prompt + pre-blur. No safeArea/width passthrough — the engine sizes via
   * artboardBase (0.5 × scale), and composeStageA's no-width fallback matches it.
   */
  let resolved = null;
  try {
    // eslint-disable-next-line global-require
    const { resolveEffectiveRenderTargetSettings } = require("./resolveProductRenderProfile");
    resolved = resolveEffectiveRenderTargetSettings(null, blank, blankVariant || undefined, renderTarget);
  } catch (e) {
    console.warn(
      `[enqueueProductModelRealism] resolveEffectiveRenderTargetSettings failed (${e && e.message}); using centered defaults`
    );
    resolved = null;
  }
  const p = (resolved && resolved.settings && resolved.settings.placement) || {};
  const blend = (resolved && resolved.settings && resolved.settings.blend) || {};

  return {
    x: Number.isFinite(Number(p.x)) ? Number(p.x) : defaults.x,
    y: Number.isFinite(Number(p.y)) ? Number(p.y) : defaults.y,
    scale: Number.isFinite(Number(p.scale)) ? Number(p.scale) : defaults.scale,
    /** Slider knobs that drive Flux Fill prompt + pre-blur (0–1). */
    fabricFeel: Number.isFinite(Number(blend.fabricFeel)) ? Number(blend.fabricFeel) : 0.5,
    printStrength: Number.isFinite(Number(blend.printStrength)) ? Number(blend.printStrength) : 0.85,
    /** Garment-silhouette clip: auto-load the per-target mask doc if it exists (preserves prior default). */
    maskConfig: { mode: "blank_mask_doc" },
  };
}

/**
 * Phase I7: resolve the identity attached to a product via its team.
 *
 * Chain:
 *   product.teamId → design_teams/{teamId}.generationDefaults.defaultIdentityId
 *
 * The trigger (onBlankPreviewJobCreated) reads this `identityId` off the job
 * doc, pulls the identity's referenceImages, and routes through the
 * identity's preferredProviderId (e.g. flux_2_multireference for Amber). When
 * the team has no identity attached the resolver returns null and the
 * trigger falls back to DEFAULT_VTON_PROVIDER_ID — back-compat with every
 * existing job flow.
 *
 * Best-effort: any Firestore read failure logs a warning and returns null.
 * We never fail the realism enqueue because identity resolution couldn't
 * read a team doc — the catalog would grind to a halt if a single bad
 * design_teams doc broke product launches.
 *
 * @returns {Promise<string|null>}
 */
async function resolveIdentityIdForProduct(db, product, { explicitOverride } = {}) {
  if (typeof explicitOverride === "string" && explicitOverride.length > 0) {
    return explicitOverride;
  }
  const teamId = product && typeof product.teamId === "string" ? product.teamId.trim() : null;
  if (!teamId) return null;
  try {
    const snap = await db.collection("design_teams").doc(teamId).get();
    if (!snap.exists) {
      console.warn(`[resolveIdentityIdForProduct] design_teams/${teamId} not found`);
      return null;
    }
    const team = snap.data() || {};
    const id =
      team.generationDefaults &&
      typeof team.generationDefaults.defaultIdentityId === "string" &&
      team.generationDefaults.defaultIdentityId.trim().length > 0
        ? team.generationDefaults.defaultIdentityId.trim()
        : null;
    return id;
  } catch (e) {
    console.warn(
      `[resolveIdentityIdForProduct] team lookup failed for ${teamId}: ${e && e.message}`
    );
    return null;
  }
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
      /** Phase I7: optional identityId override — bypass the team→identity
       *  resolution chain. Used when the operator wants to test a different
       *  identity than the team's configured default. */
      identityId: identityIdIn,
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
     * Phase I7: resolve identity through the product's team. When set, the
     * trigger uses identity.referenceImages + identity.preferredProviderId
     * to route the realism call (typically Flux 2 multi-reference for the
     * Amber brand face). When null, falls back to the default VTON provider.
     */
    const identityId = await resolveIdentityIdForProduct(db, product, {
      explicitOverride: identityIdIn,
    });

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
      /** Phase I7: identity from product.teamId → design_teams default. Null when unattached. */
      identityId,
      createdAt: now,
      createdByUid: context.auth.uid,
      updatedAt: now,
    });

    return { jobId: jobRef.id, status: "queued", officialRole, identityId };
  };
}

/**
 * Phase 3e: fan-out batch wrapper. Loads the product's variants once and
 * inspects each variant's blank-variant row to decide which (color, side)
 * combinations actually have a model photo, then queues one preview job per
 * eligible combination.
 *
 * Skip reasons (returned alongside successful jobs, never throws):
 *   - "no_blank_variant_id"     product variant doc has no blankVariantId
 *   - "blank_variant_not_found" the blank's variants[] no longer has this id
 *   - "no_model_photo"          variant has no modelFront / modelBack for that side
 *   - "duplicate_color"         already enqueued for that color (dedupes by blankVariantId+side)
 *
 * Input:  { productId, sides?: ["front"|"back"], withRealism?, artworkMode? }
 * Output: { jobs: [{ productVariantId, blankVariantId, view, jobId, officialRole }],
 *           skipped: [{ productVariantId, view, reason }] }
 *
 * Default `sides` = ["front", "back"]. Pass `["back"]` for back-print-only
 * blanks to avoid queueing front renders.
 */
function buildEnqueueProductModelRealismBatch({ db, admin, functions }) {
  return async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
    }
    const {
      productId,
      sides: sidesIn,
      withRealism: withRealismIn,
      artworkMode: artworkModeIn,
      /** Phase I7: optional identityId override across the entire fan-out. */
      identityId: identityIdIn,
    } = data || {};
    if (!productId || typeof productId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "productId is required");
    }
    const sides = Array.isArray(sidesIn) && sidesIn.length > 0
      ? sidesIn.filter((s) => s === "front" || s === "back")
      : ["front", "back"];
    if (sides.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "sides must include 'front' and/or 'back'");
    }
    const withRealism = withRealismIn === false ? false : true;
    const artworkMode =
      artworkModeIn === "dark" || artworkModeIn === "white" ? artworkModeIn : "light";

    /** Load product, blank, design once. */
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
    const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (!blankSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
    }
    const blank = blankSnap.data() || {};
    const blankVariants = Array.isArray(blank.variants) ? blank.variants : [];
    const blankVariantById = new Map();
    for (const v of blankVariants) {
      if (v && v.variantId) blankVariantById.set(v.variantId, v);
    }

    /** Load product variants and filter for primary-per-color (avoid 5 size duplicates per color). */
    const productVariantsSnap = await productRef.collection("variants").get();
    const variants = productVariantsSnap.docs;
    /**
     * Pick one product-variant per blankVariantId — render-once-per-color, the
     * size variants inherit media. Matches the same primary-per-color choice
     * startInitialProductAssetBatch makes (M when present, else first sort).
     */
    const byColor = new Map();
    for (const d of variants) {
      const v = d.data() || {};
      const bk = v.blankVariantId && String(v.blankVariantId).trim();
      if (!bk) continue;
      const sz = v.optionValues && v.optionValues.size ? String(v.optionValues.size) : "";
      const existing = byColor.get(bk);
      if (!existing) {
        byColor.set(bk, { doc: d, size: sz });
      } else if (sz === "M" && existing.size !== "M") {
        byColor.set(bk, { doc: d, size: sz });
      }
    }

    /**
     * Phase G (Phase E follow-up): two-pass plan. Pass 1 builds the list of
     * "to-be-created" jobs + the skipped list WITHOUT writing anything. Pass 2
     * commits all valid jobs in a single atomic createBatchAtomically call so
     * a partial fan-out is impossible — either every job lands or none do.
     *
     * The previous implementation did a sequential ref.add() loop inside the
     * for/for loop and caught per-job errors into `skipped`. That worked but
     * leaked partial state on a callable timeout mid-loop. The new shape
     * preserves the same return contract (jobs[], skipped[]) so the UI
     * doesn't need changes.
     */
    const skipped = [];
    const plannedJobs = [];

    /**
     * Phase I7: resolve identity ONCE up front and stamp it on every child
     * job. Every job in this fan-out targets the same product, so they all
     * inherit the same team → identity. The trigger reads job.identityId and
     * routes through the identity's preferredProviderId (Flux 2 multi-ref
     * when Amber's mode=reference_images). Null = no identity attached,
     * trigger falls back to the default VTON provider.
     */
    const identityId = await resolveIdentityIdForProduct(db, product, {
      explicitOverride: identityIdIn,
    });

    for (const [blankVariantId, entry] of byColor.entries()) {
      const blankVariant = blankVariantById.get(blankVariantId);
      if (!blankVariant) {
        for (const view of sides) {
          skipped.push({
            productVariantId: entry.doc.id,
            blankVariantId,
            view,
            reason: "blank_variant_not_found",
          });
        }
        continue;
      }
      const im = blankVariant.images || {};
      for (const view of sides) {
        const photo = view === "front" ? im.modelFront : im.modelBack;
        if (!photo || !photo.downloadUrl) {
          skipped.push({
            productVariantId: entry.doc.id,
            blankVariantId,
            view,
            reason: "no_model_photo",
          });
          continue;
        }
        const renderTarget = VIEW_TO_RENDER_TARGET[view];
        const officialRole = VIEW_TO_OFFICIAL_ROLE[view];
        const placement = resolvePlacementForVariant(blank, blankVariant, renderTarget);
        plannedJobs.push({
          productVariantId: entry.doc.id,
          blankVariantId,
          view,
          officialRole,
          /** Pre-built job-doc payload — committed atomically below. */
          data: {
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
            targetProductId: productId,
            targetVariantId: entry.doc.id,
            officialRole,
            /** Phase I7: identity stamped on every child so the trigger
             *  routes consistently across the fan-out. */
            identityId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdByUid: context.auth.uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }
    }

    /** Nothing to enqueue (every color × side was skipped). Return cleanly. */
    if (plannedJobs.length === 0) {
      return { jobs: [], skipped, batchId: null, identityId };
    }

    /**
     * Atomic commit: parent rp_batches doc + every child rp_blank_preview_jobs
     * doc in one Firestore batched write. The Firestore batch limit is 500
     * writes; we check 499 (one slot for the parent). A product with more
     * than ~250 color × side combinations would hit it — Rally's catalog
     * has nothing close. The check inside createBatchAtomically throws
     * loudly if we ever do.
     */
    // eslint-disable-next-line global-require
    const { createBatchAtomically } = require("./batchHelpers");
    const { batchId, jobRefs } = await createBatchAtomically({
      db,
      admin,
      kind: "product_realism",
      createdByUid: context.auth.uid,
      metadata: {
        productId,
        variantId: null, // batch spans multiple variants
        /** Phase I7: surfaced on the batch metadata so the dashboard drawer
         *  can show "this batch ran as Amber" without descending into child jobs. */
        identityId: identityId || null,
        label: `Product realism (${plannedJobs.length} renders across ${byColor.size} colors${identityId ? ` · identity ${identityId}` : ""})`,
      },
      jobs: plannedJobs.map((p) => ({
        collectionPath: "rp_blank_preview_jobs",
        data: p.data,
      })),
    });

    const jobs = plannedJobs.map((p, i) => ({
      productVariantId: p.productVariantId,
      blankVariantId: p.blankVariantId,
      view: p.view,
      jobId: jobRefs[i].id,
      officialRole: p.officialRole,
    }));

    return { jobs, skipped, batchId, identityId };
  };
}

module.exports = {
  resolveIdentityIdForProduct,
  buildEnqueueProductModelRealism,
  buildEnqueueProductModelRealismBatch,
  VIEW_TO_OFFICIAL_ROLE,
  VIEW_TO_RENDER_TARGET,
};
