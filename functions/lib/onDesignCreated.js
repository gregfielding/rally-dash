"use strict";

const { launchProductsFromDesign } = require("./launchProductsFromDesign");

/**
 * Phase 2: auto-launch products on design create / asset-attach.
 *
 * Trigger: `designs/{designId}` onWrite (covers create + later asset-attach update).
 *
 * For every active master blank (schemaVersion === 2 + status === "active"), spawn a
 * product for the design's team using every active blank variant. This collapses the
 * "upload design → open modal → click Generate" flow into a single upload action.
 *
 * Idempotency:
 *   - Each product is keyed by `productIdentityKey`, so re-firing is safe (the inner
 *     core throws `already-exists` and the variant loop logs+skips).
 *   - We also stamp `designs/{id}.autoLaunchProductsAt` on success and short-circuit
 *     subsequent writes by checking that field.
 *
 * Why onWrite (not onCreate):
 *   The bulk-upload + single-design flows create the doc first with `files.lightPng=null`,
 *   then patch the PNG URL after upload. onCreate-only would always see no PNG and skip.
 *   onWrite fires once on create and again on each subsequent update; we no-op until the
 *   PNG appears, then launch once and stamp the marker so further writes don't re-launch.
 *
 * No-op conditions:
 *   - design has no teamId
 *   - design has no usable PNG yet
 *   - design status is `archived`
 *   - `autoLaunchProductsAt` already stamped
 *   - the change is a delete (after.exists === false)
 */
function buildOnDesignCreated(deps) {
  const {
    db,
    admin,
    functions,
    runCreateProductFromDesignBlankCore,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
  } = deps;

  return async function onDesignCreated(change, context) {
    const designId = context.params.designId;
    const after = change.after && change.after.exists ? change.after.data() : null;
    if (!after) {
      // Deleted — nothing to do.
      return null;
    }

    // Idempotency: skip if we've already launched once for this design.
    if (after.autoLaunchProductsAt) {
      return null;
    }

    /**
     * Opt-out: bulk-upload "Commit to library" path stamps `skipAutoLaunch:true`
     * so the design lives in the library without spawning products. Operators
     * can still launch later by calling `launchProductsFromDesign` manually
     * (the stored `targetBlankIds` remain valid).
     */
    if (after.skipAutoLaunch === true) {
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:SKIP]",
          reason: "skipAutoLaunch_set_true",
          designId,
        })
      );
      try {
        await change.after.ref.update({
          autoLaunchProductsStatus: "skipped_library_only",
          autoLaunchProductsAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (markerErr) {
        console.error(
          "[ON_DESIGN_CREATED:SKIP_MARKER_ERROR]",
          JSON.stringify({
            designId,
            message: markerErr && markerErr.message ? markerErr.message : String(markerErr),
          })
        );
      }
      return null;
    }

    const teamId = (after.teamId || "").trim();
    if (!teamId) {
      // Common during initial create when team binding isn't resolved yet — quiet log.
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:SKIP]",
          reason: "no_teamId",
          designId,
        })
      );
      return null;
    }

    if (after.status === "archived") {
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:SKIP]",
          reason: "archived",
          designId,
        })
      );
      return null;
    }

    if (!designPngUrlForProcessing(after)) {
      // Wait for the PNG-attach update; onWrite will fire again.
      return null;
    }

    // Load active master blanks (schemaVersion=2 + status=active), then filter by
    // (a) operator's per-design picker selection (`design.targetBlankIds`), if present, and
    // (b) the pipeline-ready safety gate (currently styleCode==="8394" only — see below).
    //
    // **Pipeline-ready gate:** `startInitialProductAssetBatch` returns
    // `skipped: not_8394` for any blank whose styleCode is not "8394" (panty). The other
    // master blanks (8390 thong, TR3008 tank, HF07 crewneck) have catalog entries but no
    // asset-generation pipeline — auto-launching them would create products stuck at
    // `launchStatus: generating_assets` forever. When new pipelines land, broaden this set.
    //
    // The picker on the bulk-upload review screen already disables non-pipeline-ready
    // blanks, so `targetBlankIds` should never include them — but we double-gate here so
    // a bypassed UI cannot spawn dead stubs.
    const PIPELINE_READY_STYLE_CODES = new Set(["8394"]);

    const blanksSnap = await db
      .collection("rp_blanks")
      .where("status", "==", "active")
      .get();
    let masterBlanks = blanksSnap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(
        (b) =>
          Number(b.data.schemaVersion) === MASTER_BLANK_SCHEMA_VERSION &&
          PIPELINE_READY_STYLE_CODES.has(String(b.data.styleCode || "").trim())
      );

    const targetBlankIds = Array.isArray(after.targetBlankIds)
      ? after.targetBlankIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (targetBlankIds.length > 0) {
      const allow = new Set(targetBlankIds);
      const before = masterBlanks.length;
      masterBlanks = masterBlanks.filter((b) => allow.has(b.id));
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:FILTER]",
          designId,
          filterReason: "targetBlankIds",
          requested: targetBlankIds,
          eligibleAfterPipelineGate: before,
          spawning: masterBlanks.map((b) => b.id),
        })
      );
    }

    if (masterBlanks.length === 0) {
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:NOOP]",
          reason: targetBlankIds.length > 0
            ? "no_pipeline_ready_blanks_in_targetBlankIds"
            : "no_pipeline_ready_master_blanks",
          designId,
          targetBlankIds,
        })
      );
      return null;
    }

    // Stamp the marker BEFORE running the launches. If something below races (a second
    // onWrite from the same update), the second invocation sees the marker and skips.
    // We use a sentinel server timestamp + a "running" flag so observers can tell apart
    // "in progress" from "completed".
    const startedAt = admin.firestore.FieldValue.serverTimestamp();
    try {
      await change.after.ref.update({
        autoLaunchProductsAt: startedAt,
        autoLaunchProductsStatus: "running",
      });
    } catch (markerErr) {
      console.error(
        "[ON_DESIGN_CREATED:MARKER_ERROR]",
        JSON.stringify({ designId, message: markerErr && markerErr.message ? markerErr.message : String(markerErr) })
      );
      // Continue anyway — worst case we launch twice and identity-key dedupe absorbs it.
    }

    console.log(
      JSON.stringify({
        tag: "[ON_DESIGN_CREATED:BEGIN]",
        designId,
        teamId,
        leagueCode: after.leagueCode || after.leagueId || null,
        blankCount: masterBlanks.length,
        blankIds: masterBlanks.map((b) => b.id),
        timestamp: new Date().toISOString(),
      })
    );

    const results = [];
    for (const { id: blankId, data: blankData } of masterBlanks) {
      const activeVariants = Array.isArray(blankData.variants)
        ? blankData.variants.filter((v) => v && v.isActive !== false).map((v) => v.variantId).filter(Boolean)
        : [];
      if (activeVariants.length === 0) {
        console.log(
          JSON.stringify({
            tag: "[ON_DESIGN_CREATED:BLANK_SKIP]",
            reason: "no_active_variants",
            designId,
            blankId,
          })
        );
        continue;
      }
      const uniqueIds = [...new Set(activeVariants.map((x) => String(x || "").trim()).filter(Boolean))];

      try {
        const out = await launchProductsFromDesign({
          db,
          admin,
          functions,
          runCreateProductFromDesignBlankCore,
          designPngUrlForProcessing,
          buildInitialRenderSetupForProduct,
          resolveBlankVariantForProduct,
          buildProductIdentityKey,
          buildParentProductIdentityKey,
          MASTER_BLANK_SCHEMA_VERSION,
          sanitizeForFirestore,
          deriveAvailableSizesFromBlank,
          deriveSizesForProductMatrix,
          merchandisingAtCreate,
          resolveBlankTemplates,
          designId,
          blankId,
          uniqueIds,
          blankData,
          // Trigger runs without a user context — attribute writes to the synthetic system uid.
          uid: after.createdByUid || "system:onDesignCreated",
          forceAssetBatch: false,
          autoSyncShopify: false,
          queue8394Secondary: false,
        });

        results.push({
          blankId,
          ok: true,
          productId: out && out.productId ? out.productId : null,
          slug: out && out.slug ? out.slug : null,
          createdColorCount: out && out.createdColorCount != null ? out.createdColorCount : null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          "[ON_DESIGN_CREATED:BLANK_ERROR]",
          JSON.stringify({ designId, blankId, message: msg })
        );
        results.push({ blankId, ok: false, error: msg });
      }
    }

    try {
      await change.after.ref.update({
        autoLaunchProductsStatus: "completed",
        autoLaunchProductsResults: sanitizeForFirestore(results),
      });
    } catch (markerErr) {
      console.error(
        "[ON_DESIGN_CREATED:MARKER_DONE_ERROR]",
        JSON.stringify({ designId, message: markerErr && markerErr.message ? markerErr.message : String(markerErr) })
      );
    }

    console.log(
      JSON.stringify({
        tag: "[ON_DESIGN_CREATED:DONE]",
        designId,
        teamId,
        results,
      })
    );

    return null;
  };
}

module.exports = { buildOnDesignCreated };
