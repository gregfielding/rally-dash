"use strict";

const { LEGACY_DEFAULT_ASSET_PLAN, OFFICIAL_MODEL_ROLES, ALL_OFFICIAL_CATALOG_ROLES } = require("./defaultAssetPlan");
const {
  resolveBlankProductImagePlan,
  isOfficialModelRoleName,
  isOfficialFlatRoleName,
} = require("./blankProductImagePlan");
const {
  launchBatchLog,
  markOfficialAssetRoleTerminal,
  markOfficialAssetRoleRunning,
  markOfficialAssetRoleSkippedNoIdentity,
  applyPrimaryVariantMediaInheritance,
} = require("./productAssetBatchHelpers");
const { preferOfficial8394BackFlatRenderUrl } = require("./variantShopifyMedia");
const { logOfficialAssetEnqueue, logOfficialAssetJobResult } = require("./officialAssetPipelineLog");
const { pipelineFailurePatch, PIPELINE_STAGE } = require("./pipelineReporting");
const { composeOfficial8394FlatRole } = require("./officialProductFlatCompose");
const { composeOfficial8394ModelRole } = require("./officialProductModelCompose");
const { getVariantModelBackUrl, getVariantModelFrontUrl } = require("./variantRenderSources");

function blankVariantRowFromMaster(blank, blankVariantId) {
  const list = blank && blank.variants;
  if (!Array.isArray(list) || !blankVariantId) return null;
  return list.find((v) => v.variantId === blankVariantId) || null;
}

/** Matches per-color `rolesToEnqueueThisColor`: flats + deterministic models when identity is absent. */
function enabledRolesActuallyEnqueuedForColor(blank, blankVariantId, enabledOfficial, canEnqueueModelRoles) {
  if (canEnqueueModelRoles === true) return enabledOfficial;
  const flatsOnly = enabledOfficial.filter((role) => isOfficialFlatRoleName(role));
  const deterministicModels = enabledOfficial.filter(
    (role) => isOfficialModelRoleName(role) && roleUsesDeterministic8394ModelCompose(blank, blankVariantId, role)
  );
  return [...flatsOnly, ...deterministicModels];
}

/** Saved blank master has on-model URLs for this color — deterministic compose (no identity / scene preset). */
function roleUsesDeterministic8394ModelCompose(blank, blankVariantId, role) {
  const vr = blankVariantRowFromMaster(blank, blankVariantId);
  if (!vr) return false;
  if (role === "model_back_designed") return !!getVariantModelBackUrl(blank, vr);
  if (role === "model_front_clean") return !!getVariantModelFrontUrl(blank, vr);
  return false;
}

/** Short prompt hints appended per official catalog role (on-model fal job). */
const OFFICIAL_ROLE_PROMPT_HINT = {
  model_back_designed: "full body back view, studio lighting, wearing the garment, ecommerce catalog",
  model_front_clean: "full body front view, studio lighting, wearing the garment, ecommerce catalog",
  flat_front_clean: "flat lay front garment presentation, clean studio, product-focused",
  flat_back_designed: "flat lay back garment presentation, clean studio, product-focused, print visible",
};

/**
 * Default on-model preset for 8394 official catalog jobs (seed: `seed-scene-presets.js`).
 * Used when product.officialScenePresetId and OFFICIAL_PRODUCT_SCENE_PRESET_ID are unset.
 */
const DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG = "underwear-studio-on-model";

function resolveOfficialScenePresetId(product) {
  const fromProduct = product && product.officialScenePresetId && String(product.officialScenePresetId).trim();
  if (fromProduct) return fromProduct;
  try {
    const e = process.env.OFFICIAL_PRODUCT_SCENE_PRESET_ID;
    if (e && String(e).trim()) return String(e).trim();
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Full resolution for enqueue: product → env → Firestore preset with slug {@link DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG}.
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} product
 * @returns {Promise<string|null>}
 */
async function resolveOfficialScenePresetIdForEnqueue(db, product) {
  const direct = resolveOfficialScenePresetId(product);
  if (direct) return direct;
  try {
    const q = await db
      .collection("rp_scene_presets")
      .where("slug", "==", DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG)
      .limit(1)
      .get();
    if (!q.empty) return q.docs[0].id;
  } catch (e) {
    console.warn("[resolveOfficialScenePresetIdForEnqueue] slug lookup failed:", e && e.message ? e.message : e);
  }
  return null;
}

/**
 * Map official batch role → variant `generatedRenderOutputs` + `flatRenders` / `media`.
 */
function buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath, provenance) {
  const url = String(imageUrl || "").trim();
  if (!url) return null;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const createdAt = admin.firestore.Timestamp.now();

  const v = variantDoc || {};
  const prevGen = Array.isArray(v.generatedRenderOutputs) ? v.generatedRenderOutputs : [];
  const genMap = {
    model_back_designed: { role: "model_back", lookType: "model_blended", sort: 10, view: "back" },
    flat_front_clean: { role: "flat_front", lookType: "flat_clean", sort: 20, view: "front" },
    flat_back_designed: { role: "flat_back", lookType: "flat_blended", sort: 30, view: "back" },
    model_front_clean: { role: "model_front", lookType: "model_clean", sort: 40, view: "front" },
  };
  const g = genMap[role];
  const recipeProvenance =
    provenance && typeof provenance === "object"
      ? {
          resolvedFromBlankId: String(provenance.resolvedFromBlankId || "").trim(),
          resolvedFromBlankVariantId: String(provenance.resolvedFromBlankVariantId || "").trim(),
          resolvedRenderTarget: String(provenance.resolvedRenderTarget || "").trim(),
          resolvedPlacementId: String(provenance.resolvedPlacementId || "").trim(),
          resolvedTone: provenance.resolvedTone != null ? String(provenance.resolvedTone) : null,
          resolvedDesignUrl: provenance.resolvedDesignUrl != null ? String(provenance.resolvedDesignUrl) : null,
          sourcePathUsed: provenance.sourcePathUsed != null ? String(provenance.sourcePathUsed) : null,
          resolvedGarmentImageUrl:
            provenance.resolvedGarmentImageUrl != null ? String(provenance.resolvedGarmentImageUrl) : null,
          compositionSource: provenance.compositionSource != null ? String(provenance.compositionSource) : null,
          garmentOnlyCleanFront:
            typeof provenance.garmentOnlyCleanFront === "boolean" ? provenance.garmentOnlyCleanFront : null,
          garmentOnly: typeof provenance.garmentOnly === "boolean" ? provenance.garmentOnly : null,
          renderPath: provenance.renderPath != null ? String(provenance.renderPath) : null,
          blankRenderProfileVersion:
            typeof provenance.blankRenderProfileVersion === "number" ? provenance.blankRenderProfileVersion : null,
          blankDocUpdatedAt: provenance.blankDocUpdatedAt || null,
          tuningLayer: provenance.tuningLayer != null ? String(provenance.tuningLayer) : null,
          recipeProvenanceSchemaVersion: 1,
          composeBytesProof:
            provenance.composeBytesProof && typeof provenance.composeBytesProof === "object"
              ? {
                  designFetchUrl:
                    provenance.composeBytesProof.designFetchUrl != null
                      ? String(provenance.composeBytesProof.designFetchUrl)
                      : null,
                  designSha256Hex:
                    provenance.composeBytesProof.designSha256Hex != null
                      ? String(provenance.composeBytesProof.designSha256Hex)
                      : null,
                  designPixelWidth:
                    typeof provenance.composeBytesProof.designPixelWidth === "number"
                      ? provenance.composeBytesProof.designPixelWidth
                      : null,
                  designPixelHeight:
                    typeof provenance.composeBytesProof.designPixelHeight === "number"
                      ? provenance.composeBytesProof.designPixelHeight
                      : null,
                  outputSha256Hex:
                    provenance.composeBytesProof.outputSha256Hex != null
                      ? String(provenance.composeBytesProof.outputSha256Hex)
                      : null,
                  outputPixelWidth:
                    typeof provenance.composeBytesProof.outputPixelWidth === "number"
                      ? provenance.composeBytesProof.outputPixelWidth
                      : null,
                  outputPixelHeight:
                    typeof provenance.composeBytesProof.outputPixelHeight === "number"
                      ? provenance.composeBytesProof.outputPixelHeight
                      : null,
                  finalOfficialOutputUrl:
                    provenance.composeBytesProof.finalOfficialOutputUrl != null
                      ? String(provenance.composeBytesProof.finalOfficialOutputUrl)
                      : null,
                  debugArtifactUrls: provenance.composeBytesProof.debugArtifactUrls || null,
                }
              : null,
        }
      : null;

  const sourceTypeResolved =
    recipeProvenance && String(provenance.compositionSource || "").trim() === "blank_native"
      ? "official_deterministic_generation"
      : "official_generation";

  const genEntry = g
    ? {
        role: g.role,
        sourceType: sourceTypeResolved,
        sourceImageRole: role,
        url,
        storagePath: storagePath != null ? storagePath : null,
        sort: g.sort,
        createdAt,
        lookType: g.lookType,
        view: g.view,
        ...(recipeProvenance ? { recipeProvenance } : {}),
      }
    : null;

  /** Replace any prior row for this commerce `role` (flat_back, …) — legacy used `sourceImageRole` so it did not dedupe. */
  const nextGen = genEntry
    ? [...prevGen.filter((x) => x && String(x.role || "") !== g.role), genEntry].sort(
        (a, b) => (a.sort || 0) - (b.sort || 0)
      )
    : prevGen;

  const flatRenders = { ...(v.flatRenders || {}) };
  const slot = {
    url,
    storagePath: storagePath != null ? storagePath : null,
    generatedAt: now,
    lookType: g?.lookType || null,
    view: g?.view || null,
    ...(recipeProvenance ? { recipeProvenance } : {}),
  };

  if (role === "model_back_designed") {
    flatRenders.model_blended = { ...(flatRenders.model_blended || {}), back: { ...slot, lookType: "model_blended", view: "back" } };
  } else if (role === "model_front_clean") {
    flatRenders.model_clean = { ...(flatRenders.model_clean || {}), front: { ...slot, lookType: "model_clean", view: "front" } };
  } else if (role === "flat_front_clean") {
    flatRenders.flat_clean = { ...(flatRenders.flat_clean || {}), front: { ...slot, lookType: "flat_clean", view: "front" } };
  } else if (role === "flat_back_designed") {
    flatRenders.flat_blended = { ...(flatRenders.flat_blended || {}), back: { ...slot, lookType: "flat_blended", view: "back" } };
  }

  const media = { ...(v.media || {}) };
  if (role === "model_back_designed" || role === "flat_back_designed") {
    media.heroBack = url;
  }
  if (role === "model_front_clean" || role === "flat_front_clean") {
    media.heroFront = url;
  }

  /** `flat_front_clean` is garment-only; do not let it overwrite `mockupUrl` (back-designed hero for 8394). */
  const mockupPatch =
    role === "flat_front_clean"
      ? {}
      : {
          mockupUrl: url,
        };

  return {
    flatRenders,
    media,
    generatedRenderOutputs: nextGen,
    ...mockupPatch,
  };
}

/**
 * @param {object} ctx
 * @param {import("./createGenerationJobCore").createCreateGenerationJob} ctx.createGenerationJob
 */
function officialEnqueuePayload(tag, obj) {
  try {
    console.log(`[${tag}]`, JSON.stringify(obj));
  } catch (_) {
    console.log(`[${tag}]`, String(obj));
  }
}

/**
 * When the storefront hero color gains official images, roll up `rp_products.displayMedia`
 * (8394 prefers back for heroUrl). Rolls up when the patched row is hero/default **or** when it is
 * `isPrimaryForColor` for the same `blankVariantId` as hero (official pipeline writes to primary size;
 * hero row can be a different size for the same color).
 */
async function syncParentDisplayMediaIfHeroVariant({
  db,
  admin,
  sanitizeForFirestore,
  productId,
  variantId,
  patch,
  updatedBy,
}) {
  if (!patch || typeof patch !== "object") return;
  const media = patch.media;
  if (!media || typeof media !== "object") return;
  const productRef = db.collection("rp_products").doc(productId);
  const pSnap = await productRef.get();
  if (!pSnap.exists) return;
  const p = pSnap.data() || {};
  const hid = p.heroVariantId || p.defaultVariantId;
  if (!hid) return;

  let shouldRollUp = String(hid) === String(variantId);
  if (!shouldRollUp) {
    const [heroVs, thisVs] = await Promise.all([
      productRef.collection("variants").doc(String(hid)).get(),
      productRef.collection("variants").doc(String(variantId)).get(),
    ]);
    const heroBv = heroVs.exists ? (heroVs.data() || {}).blankVariantId : null;
    const thisData = thisVs.exists ? thisVs.data() || {} : {};
    const thisBv = thisData.blankVariantId;
    if (
      thisData.isPrimaryForColor === true &&
      heroBv &&
      thisBv &&
      String(heroBv) === String(thisBv)
    ) {
      shouldRollUp = true;
    }
  }
  if (!shouldRollUp) return;

  const variantRef = productRef.collection("variants").doc(String(variantId));
  const vSnap = await variantRef.get();
  const vData = vSnap.exists ? vSnap.data() || {} : {};
  const mergedM = { ...(vData.media || {}), ...media };
  const mergedMockup = patch.mockupUrl !== undefined ? patch.mockupUrl : vData.mockupUrl;

  const style = String(p.blankStyleCode || "").trim();
  const backFirst = style === "8394";
  const fs = p.fulfillmentSummary && p.fulfillmentSummary.printSides;
  const backOnly =
    fs &&
    typeof fs.effectiveBack === "boolean" &&
    typeof fs.effectiveFront === "boolean" &&
    fs.effectiveBack === true &&
    fs.effectiveFront === false;

  let heroUrl;
  let thumbUrl;
  if (backFirst && backOnly) {
    const fr = vData.flatRenders || {};
    const canonicalBack = preferOfficial8394BackFlatRenderUrl(fr);
    const hb = mergedM.heroBack && String(mergedM.heroBack).trim();
    const mock = mergedMockup && String(mergedMockup).trim();
    heroUrl = (canonicalBack && String(canonicalBack).trim()) || hb || mock || "";
    if (!heroUrl) {
      const prevHero = p.displayMedia && p.displayMedia.heroUrl ? String(p.displayMedia.heroUrl).trim() : "";
      heroUrl = prevHero;
    }
    if (!heroUrl) return;
    thumbUrl =
      (mergedM.heroFront && String(mergedM.heroFront).trim()) ||
      (canonicalBack && String(canonicalBack).trim()) ||
      (mergedM.heroBack && String(mergedM.heroBack).trim()) ||
      (mergedMockup && String(mergedMockup).trim()) ||
      heroUrl;
  } else if (backFirst) {
    heroUrl = mergedM.heroBack || mergedM.heroFront || mergedMockup;
    thumbUrl = mergedM.heroFront || mergedM.heroBack || mergedMockup || heroUrl;
  } else {
    heroUrl = mergedM.heroFront || mergedM.heroBack || mergedMockup;
    thumbUrl = mergedM.heroBack || mergedM.heroFront || heroUrl;
  }

  const heroStr = heroUrl && String(heroUrl).trim() ? String(heroUrl).trim() : "";
  if (!heroStr) return;
  const thumbStr = thumbUrl && String(thumbUrl).trim() ? String(thumbUrl).trim() : heroStr;
  await productRef.set(
    sanitizeForFirestore({
      displayMedia: { heroUrl: heroStr, thumbUrl: thumbStr },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: updatedBy || "system",
    }),
    { merge: true }
  );
}

/**
 * Fan out canonical media to same-color sibling sizes + parent display cache when this row is hero/default.
 */
async function afterOfficialVariantMediaPatch(ctx) {
  const { db, admin, sanitizeForFirestore, productId, primaryVariantId, patch, userId } = ctx;
  if (!patch) return;
  try {
    await applyPrimaryVariantMediaInheritance({ db, admin, parentId: productId, primaryVariantId });
  } catch (e) {
    console.warn("[afterOfficialVariantMediaPatch] inheritance:", e && e.message ? e.message : e);
  }
  try {
    await syncParentDisplayMediaIfHeroVariant({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      variantId: primaryVariantId,
      patch,
      updatedBy: userId || "system",
    });
  } catch (e) {
    console.warn("[afterOfficialVariantMediaPatch] displayMedia:", e && e.message ? e.message : e);
  }
}

async function writeParentOfficialEnqueueRootCause({ db, admin, sanitizeForFirestore, productId, userId, message }) {
  const msg = message && String(message).trim() ? String(message).trim() : "Official asset enqueue failed";
  await db
    .collection("rp_products")
    .doc(productId)
    .set(
      sanitizeForFirestore({
        ...pipelineFailurePatch(admin, msg, PIPELINE_STAGE.GENERATING_ASSETS),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId || "system",
      }),
      { merge: true }
    );
}

async function enqueueOfficialProductImages(ctx) {
  const {
    db,
    admin,
    sanitizeForFirestore,
    storage,
    createGenerationJob,
    productId,
    userId,
    batchId,
    primaries,
    product,
    designId,
    resolvedModelIdentityId,
    canEnqueueModelRoles,
  } = ctx;

  const identityForJob =
    canEnqueueModelRoles === true && resolvedModelIdentityId && String(resolvedModelIdentityId).trim()
      ? String(resolvedModelIdentityId).trim()
      : null;

  const blankId = product && product.blankId && String(product.blankId).trim() ? String(product.blankId).trim() : "";
  let blank = null;
  if (blankId) {
    const bSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (bSnap.exists) blank = bSnap.data() || {};
  }

  /** @type {Set<string>} */
  const unionRolesToEnqueue = new Set();
  for (const p of primaries) {
    const vr = blankVariantRowFromMaster(blank, p.blankVariantId);
    const resolved = vr && blank ? resolveBlankProductImagePlan(blank, vr) : null;
    const enabledOfficial =
      resolved && resolved.enabledOfficialRolesOrdered && resolved.enabledOfficialRolesOrdered.length
        ? resolved.enabledOfficialRolesOrdered
        : [...LEGACY_DEFAULT_ASSET_PLAN];
    const forThisColor = enabledRolesActuallyEnqueuedForColor(blank, p.blankVariantId, enabledOfficial, canEnqueueModelRoles);
    for (const r of forThisColor) unionRolesToEnqueue.add(r);
  }
  const rolesToEnqueueList = Array.from(unionRolesToEnqueue);

  let needsAiModelJob = false;
  for (const p of primaries) {
    const vr = blankVariantRowFromMaster(blank, p.blankVariantId);
    const resolved = vr && blank ? resolveBlankProductImagePlan(blank, vr) : null;
    const enabledOfficial =
      resolved && resolved.enabledOfficialRolesOrdered && resolved.enabledOfficialRolesOrdered.length
        ? resolved.enabledOfficialRolesOrdered
        : [...LEGACY_DEFAULT_ASSET_PLAN];
    const forThisColor = enabledRolesActuallyEnqueuedForColor(blank, p.blankVariantId, enabledOfficial, canEnqueueModelRoles);
    for (const r of forThisColor) {
      if (!isOfficialModelRoleName(r)) continue;
      if (roleUsesDeterministic8394ModelCompose(blank, p.blankVariantId, r)) continue;
      if (canEnqueueModelRoles === true) needsAiModelJob = true;
    }
  }

  /** Any enqueued flat role uses Storage-backed deterministic compose (not legacy “required launch” flat list). */
  let needsDeterministicStorage = rolesToEnqueueList.some((r) => isOfficialFlatRoleName(r));
  if (!needsDeterministicStorage && blank) {
    outer: for (const p of primaries) {
      const vr = blankVariantRowFromMaster(blank, p.blankVariantId);
      const resolved = vr && blank ? resolveBlankProductImagePlan(blank, vr) : null;
      const enabledOfficial =
        resolved && resolved.enabledOfficialRolesOrdered && resolved.enabledOfficialRolesOrdered.length
          ? resolved.enabledOfficialRolesOrdered
          : [...LEGACY_DEFAULT_ASSET_PLAN];
      const forThisColor = enabledRolesActuallyEnqueuedForColor(blank, p.blankVariantId, enabledOfficial, canEnqueueModelRoles);
      for (const r of forThisColor) {
        if (isOfficialModelRoleName(r) && roleUsesDeterministic8394ModelCompose(blank, p.blankVariantId, r)) {
          needsDeterministicStorage = true;
          break outer;
        }
      }
    }
  }

  /** Lazy — only when an AI on-model job runs (not for blank-native deterministic model compose). */
  let onModelPresetIdCached = null;
  let onModelPresetDataCached = null;
  async function ensureAiOnModelPresetLoaded() {
    if (onModelPresetIdCached) {
      return { presetId: onModelPresetIdCached, presetData: onModelPresetDataCached };
    }
    onModelPresetIdCached = await resolveOfficialScenePresetIdForEnqueue(db, product);
    if (!onModelPresetIdCached) {
      throw new Error(
        "Official on-model scene preset ID missing: set product.officialScenePresetId, OFFICIAL_PRODUCT_SCENE_PRESET_ID env, or seed rp_scene_presets with slug underwear-studio-on-model"
      );
    }
    const snap = await db.collection("rp_scene_presets").doc(onModelPresetIdCached).get();
    if (!snap.exists) {
      throw new Error(`Scene preset document not found in Firestore: rp_scene_presets/${onModelPresetIdCached}`);
    }
    onModelPresetDataCached = snap.data() || {};
    return { presetId: onModelPresetIdCached, presetData: onModelPresetDataCached };
  }

  officialEnqueuePayload("OFFICIAL_ENQUEUE:START", {
    productId,
    batchId,
    colorCount: Array.isArray(primaries) ? primaries.length : 0,
    rolesExpectedUnion: rolesToEnqueueList.length,
    rolesUnion: rolesToEnqueueList,
    canEnqueueModelRoles: canEnqueueModelRoles === true,
    flatPipeline: "deterministic_compose",
    modelPipeline: needsAiModelJob ? "rp_scene_presets_generation_jobs" : "deterministic_or_skipped",
    blankLoaded: !!blank,
  });

  if (needsAiModelJob && typeof createGenerationJob !== "function") {
    const err = new Error("createGenerationJob is required when official AI on-model jobs are enqueued");
    officialEnqueuePayload("OFFICIAL_ENQUEUE:ERROR", {
      productId,
      batchId,
      role: null,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }

  if (needsDeterministicStorage && (!storage || typeof storage.bucket !== "function")) {
    const err = new Error(
      "Firebase Storage is required for official deterministic composition (flat roles and/or blank-native model images)"
    );
    officialEnqueuePayload("OFFICIAL_ENQUEUE:ERROR", {
      productId,
      batchId,
      role: null,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }

  const ai = product.ai || {};
  const artifactsFull = {
    faceArtifactId: ai.faceArtifactId || null,
    bodyArtifactId: ai.bodyArtifactId || null,
    productArtifactId: ai.productArtifactId || null,
    faceScale: ai.faceScale,
    bodyScale: ai.bodyScale,
    productScale: ai.productScale,
  };

  const loraCount = [artifactsFull.faceArtifactId, artifactsFull.bodyArtifactId, artifactsFull.productArtifactId].filter(
    Boolean
  ).length;

  const productAiPresent = !!(product && product.ai && typeof product.ai === "object");

  officialEnqueuePayload("OFFICIAL_ENQUEUE:CONFIG", {
    productId,
    batchId,
    needsAiModelJob,
    resolvedModelIdentityId: resolvedModelIdentityId || null,
    canEnqueueModelRoles: canEnqueueModelRoles === true,
    rolesToEnqueueUnion: rolesToEnqueueList,
    loraCount,
    productAiPresent,
    blankId: product && product.blankId != null ? product.blankId : null,
    designId: designId != null ? designId : null,
  });

  for (const { blankVariantId, primaryVariantId } of primaries) {
    const vr0 = blankVariantRowFromMaster(blank, blankVariantId);
    const resolved0 = vr0 && blank ? resolveBlankProductImagePlan(blank, vr0) : null;
    const enabledOfficial0 =
      resolved0 && resolved0.enabledOfficialRolesOrdered && resolved0.enabledOfficialRolesOrdered.length
        ? resolved0.enabledOfficialRolesOrdered
        : [...LEGACY_DEFAULT_ASSET_PLAN];
    const rolesToEnqueueThisColor = enabledRolesActuallyEnqueuedForColor(
      blank,
      blankVariantId,
      enabledOfficial0,
      canEnqueueModelRoles
    );

    for (const role of rolesToEnqueueThisColor) {
      const isModelRole = isOfficialModelRoleName(role);

      if (isModelRole) {
        const useDeterministicModel = roleUsesDeterministic8394ModelCompose(blank, blankVariantId, role);

        if (useDeterministicModel) {
          let imageUrl;
          let storagePath;
          let modelProvenance;
          try {
            const out = await composeOfficial8394ModelRole({
              db,
              admin,
              storage,
              productId,
              primaryVariantId,
              blankVariantId,
              role,
              batchId,
              userId,
            });
            imageUrl = out.imageUrl;
            storagePath = out.storagePath;
            modelProvenance = out.provenance;
          } catch (e) {
            const err = e && typeof e === "object" && e.message ? e : new Error(String(e));
            officialEnqueuePayload("OFFICIAL_ENQUEUE:ERROR", {
              productId,
              batchId,
              role,
              error: err.message,
              stack: err.stack,
            });
            throw err;
          }

          const variantRef = db.collection("rp_products").doc(productId).collection("variants").doc(primaryVariantId);
          const vSnap = await variantRef.get();
          const variantDoc = vSnap.exists ? vSnap.data() || {} : {};
          const patch = buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath, modelProvenance);
          if (patch) {
            await variantRef.set(
              sanitizeForFirestore({
                ...patch,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: userId || "system",
              }),
              { merge: true }
            );
            await afterOfficialVariantMediaPatch({
              db,
              admin,
              sanitizeForFirestore,
              productId,
              primaryVariantId,
              patch,
              userId,
            });
          }

          logOfficialAssetJobResult({
            productId,
            batchId,
            generationJobId: "model_compose",
            role,
            status: "succeeded",
            outputCount: 1,
            error: null,
            recipeProvenance: modelProvenance || null,
          });

          await markOfficialAssetRoleTerminal({
            db,
            admin,
            sanitizeForFirestore,
            productId,
            batchId,
            colorKey: blankVariantId,
            role,
            ok: true,
            errorMessage: null,
            jobId: "model_compose",
          });
          continue;
        }

        if (!canEnqueueModelRoles) {
          officialEnqueuePayload("OFFICIAL_ENQUEUE:SKIP_MODEL_ROLE", {
            productId,
            batchId,
            blankVariantId,
            role,
            reason: "no_blank_native_model_sources_and_no_identity",
          });
          await markOfficialAssetRoleSkippedNoIdentity({
            db,
            admin,
            sanitizeForFirestore,
            productId,
            batchId,
            colorKey: blankVariantId,
            role,
            reason: "Optional model assets skipped — no model identity and no blank-native model sources for this role.",
          });
          continue;
        }

        const { presetId: presetIdForRole, presetData: onModelPresetData } = await ensureAiOnModelPresetLoaded();

        const presetModeResolved = (onModelPresetData && onModelPresetData.mode) || "onModel";
        const requiresIdentity =
          presetModeResolved === "onModel" && onModelPresetData && onModelPresetData.requireIdentity !== false;

        officialEnqueuePayload("OFFICIAL_ROLE_RESOLUTION", {
          productId,
          batchId,
          role,
          pipeline: "ai_on_model",
          presetId: presetIdForRole,
          presetMode: presetModeResolved,
          requiresIdentity,
          identityId: identityForJob,
        });

        const hint = OFFICIAL_ROLE_PROMPT_HINT[role] || "";

        officialEnqueuePayload("OFFICIAL_ENQUEUE:JOB_ATTEMPT", {
          productId,
          batchId,
          blankVariantId,
          primaryVariantId,
          role,
          presetId: presetIdForRole,
          generationType: "on_model",
          identityId: identityForJob,
          loraCount,
        });
        try {
          const { jobId } = await createGenerationJob(
            {
              productId,
              designId: designId || null,
              generationType: "on_model",
              identityId: identityForJob,
              presetId: presetIdForRole,
              artifacts: artifactsFull,
              promptOverrides: hint ? { prompt: hint } : undefined,
              imageCount: 1,
              imageSize: "square",
              initialAssetRole: role,
              productAssetBatchId: batchId,
              productAssetColorKey: blankVariantId,
              productVariantId: primaryVariantId,
            },
            userId
          );

          officialEnqueuePayload("OFFICIAL_ENQUEUE:JOB_CREATED", {
            productId,
            batchId,
            role,
            generationJobId: jobId,
          });

          logOfficialAssetEnqueue({
            productId,
            batchId,
            blankVariantId,
            role,
            generationJobId: jobId,
            presetId: presetIdForRole,
            identityId: identityForJob,
            loraCount,
          });
        } catch (e) {
          const err = e && typeof e === "object" && e.message ? e : new Error(String(e));
          officialEnqueuePayload("OFFICIAL_ENQUEUE:ERROR", {
            productId,
            batchId,
            role,
            error: err.message,
            stack: err.stack,
          });
          throw err;
        }
      } else {
        let imageUrl;
        let storagePath;
        let flatProvenance;
        try {
          const out = await composeOfficial8394FlatRole({
            db,
            admin,
            storage,
            productId,
            primaryVariantId,
            blankVariantId,
            role,
            batchId,
            userId,
          });
          imageUrl = out.imageUrl;
          storagePath = out.storagePath;
          flatProvenance = out.provenance;
        } catch (e) {
          const err = e && typeof e === "object" && e.message ? e : new Error(String(e));
          officialEnqueuePayload("OFFICIAL_ENQUEUE:ERROR", {
            productId,
            batchId,
            role,
            error: err.message,
            stack: err.stack,
          });
          throw err;
        }

        const variantRef = db.collection("rp_products").doc(productId).collection("variants").doc(primaryVariantId);
        const vSnap = await variantRef.get();
        const variantDoc = vSnap.exists ? vSnap.data() || {} : {};
        const patch = buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath, flatProvenance);
        if (patch) {
          await variantRef.set(
            sanitizeForFirestore({
              ...patch,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedBy: userId || "system",
            }),
            { merge: true }
          );
          await afterOfficialVariantMediaPatch({
            db,
            admin,
            sanitizeForFirestore,
            productId,
            primaryVariantId,
            patch,
            userId,
          });
        }

        logOfficialAssetJobResult({
          productId,
          batchId,
          generationJobId: "flat_compose",
          role,
          status: "succeeded",
          outputCount: 1,
          error: null,
          recipeProvenance: flatProvenance || null,
        });

        await markOfficialAssetRoleTerminal({
          db,
          admin,
          sanitizeForFirestore,
          productId,
          batchId,
          colorKey: blankVariantId,
          role,
          ok: true,
          errorMessage: null,
          jobId: "flat_compose",
        });
      }
    }
  }

  officialEnqueuePayload("OFFICIAL_ENQUEUE:PROOF_ROLES_ENQUEUED", {
    productId,
    batchId,
    rolesEnqueuedUnion: rolesToEnqueueList,
    canEnqueueModelRoles: canEnqueueModelRoles === true,
  });

  return { rolesEnqueued: rolesToEnqueueList };
}

/**
 * Firestore trigger: `rp_generation_jobs` terminal state for `initialAssetRole` jobs.
 */
/**
 * Phase K2: propagate the queued→running transition to the asset-batch role
 * so the dashboard drawer shows live motion during the fal.ai render. Mirrors
 * the terminal handler's batch/role lookup but for the running edge only.
 *
 * Only model roles go through rp_generation_jobs (flat roles complete via
 * deterministic compose at enqueue), so this only fires for model-role jobs —
 * which are exactly the slow ones (30–60s) where the frozen chip was worst.
 */
async function handleOfficialGenerationJobRunning({ db, admin, sanitizeForFirestore, before, after, jobId }) {
  if (!after.initialAssetRole || !after.productAssetBatchId || !after.productAssetColorKey) return;
  if (before.status === after.status) return;

  /** Accept the common "now working" status names defensively. */
  const RUNNING_STATES = new Set(["running", "processing", "in_progress", "started"]);
  if (!RUNNING_STATES.has(String(after.status))) return;

  const role = String(after.initialAssetRole).trim();
  if (!ALL_OFFICIAL_CATALOG_ROLES.has(role)) return;
  /** Flat roles never hit rp_generation_jobs; nothing to mark running. */
  if (isOfficialFlatRoleName(role)) return;

  await markOfficialAssetRoleRunning({
    db,
    admin,
    sanitizeForFirestore,
    batchId: String(after.productAssetBatchId).trim(),
    colorKey: String(after.productAssetColorKey).trim(),
    role,
    jobId,
  });
}

async function handleOfficialGenerationJobTerminal({ db, admin, sanitizeForFirestore, before, after, jobId }) {
  if (!after.initialAssetRole || !after.productAssetBatchId || !after.productAssetColorKey) return;
  if (before.status === after.status) return;

  const terminal = after.status === "succeeded" || after.status === "failed";
  if (!terminal) return;

  const productId = after.productId;
  const batchId = String(after.productAssetBatchId).trim();
  const colorKey = String(after.productAssetColorKey).trim();
  const role = String(after.initialAssetRole).trim();
  const variantId = after.productVariantId && String(after.productVariantId).trim() ? String(after.productVariantId).trim() : null;

  if (!productId || !batchId || !colorKey || !ALL_OFFICIAL_CATALOG_ROLES.has(role)) return;

  /** Flat catalog roles are completed via deterministic compose in enqueue — not `rp_generation_jobs`. */
  if (isOfficialFlatRoleName(role)) return;

  if (after.status === "failed") {
    const err =
      (after.lastError && after.lastError.message) || after.errorMessage || "official_generation_failed";
    logOfficialAssetJobResult({
      productId,
      batchId,
      generationJobId: jobId,
      role,
      status: "failed",
      outputCount: 0,
      error: String(err).slice(0, 500),
    });
    await markOfficialAssetRoleTerminal({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      batchId,
      colorKey,
      role,
      ok: false,
      errorMessage: String(err).slice(0, 500),
      jobId,
    });
    return;
  }

  const imgs = after.outputs && Array.isArray(after.outputs.images) ? after.outputs.images : [];
  const first = imgs[0] || null;
  const imageUrl = first && first.downloadUrl ? first.downloadUrl : first && first.url ? first.url : null;
  const storagePath = first && first.storagePath ? first.storagePath : null;

  if (!variantId || !imageUrl) {
    logOfficialAssetJobResult({
      productId,
      batchId,
      generationJobId: jobId,
      role,
      status: "failed",
      outputCount: imgs.length,
      error: "missing_variant_or_image_url",
    });
    await markOfficialAssetRoleTerminal({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      batchId,
      colorKey,
      role,
      ok: false,
      errorMessage: "missing_variant_or_image_url",
      jobId,
    });
    return;
  }

  const variantRef = db.collection("rp_products").doc(productId).collection("variants").doc(variantId);
  const vSnap = await variantRef.get();
  const variantDoc = vSnap.exists ? vSnap.data() || {} : {};
  const patch = buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath);
  if (patch) {
    await variantRef.set(
      sanitizeForFirestore({
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: after.createdBy || "system",
      }),
      { merge: true }
    );
    await afterOfficialVariantMediaPatch({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      primaryVariantId: variantId,
      patch,
      userId: after.createdBy || "system",
    });
  }

  logOfficialAssetJobResult({
    productId,
    batchId,
    generationJobId: jobId,
    role,
    status: "succeeded",
    outputCount: imgs.length,
    error: null,
  });

  await markOfficialAssetRoleTerminal({
    db,
    admin,
    sanitizeForFirestore,
    productId,
    batchId,
    colorKey,
    role,
    ok: true,
    errorMessage: null,
    jobId,
  });
}

module.exports = {
  enqueueOfficialProductImages,
  handleOfficialGenerationJobTerminal,
  handleOfficialGenerationJobRunning,
  resolveOfficialScenePresetId,
  resolveOfficialScenePresetIdForEnqueue,
  DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG,
  OFFICIAL_ROLE_PROMPT_HINT,
};
