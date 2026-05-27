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

    // Load active master blanks (schemaVersion=2 + status=active).
    //
    // **8394-only gate (2026-05-27):** `startInitialProductAssetBatch` currently returns
    // `skipped: not_8394` for any blank whose styleCode is not "8394" (panty). The other
    // master blanks (8390 thong, TR3008 tank, HF07 crewneck) have catalog entries but no
    // asset-generation pipeline — auto-launching them would create products stuck at
    // `launchStatus: generating_assets` forever with no batch behind them. Until those
    // pipelines exist, restrict auto-launch to the 8394 panty so we don't spawn dead stubs.
    //
    // Side benefit: this also avoids the cross-blank SKU collision where the panty failed
    // to create because tank/thong's SKUs (RP-…-COLOR-SIZE, no blank code) consumed the
    // same slots first.
    const blanksSnap = await db
      .collection("rp_blanks")
      .where("status", "==", "active")
      .get();
    const masterBlanks = blanksSnap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(
        (b) =>
          Number(b.data.schemaVersion) === MASTER_BLANK_SCHEMA_VERSION &&
          String(b.data.styleCode || "").trim() === "8394"
      );

    if (masterBlanks.length === 0) {
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:NOOP]",
          reason: "no_active_8394_master_blanks",
          designId,
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
