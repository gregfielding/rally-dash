"use strict";

const { launchProductsFromDesign } = require("./launchProductsFromDesign");
const { isPipelineReadyStyleCode } = require("./pipelineReadiness");
const { resolveSpawnBlankIds } = require("./resolveSpawnBlanks");

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
    // **Pipeline-ready gate** — driven by `functions/lib/pipelineReadiness.js`,
    // the same registry the bulk-upload preview engine + asset-batch starter use.
    // Until a blank's renderer is wired, this filter keeps it out of auto-launch
    // so we never spawn products that would stall at `generating_assets` forever.
    //
    // The picker on the bulk-upload review screen also reads this registry and
    // disables non-pipeline-ready blanks, so `targetBlankIds` should never
    // include them — but we double-gate here so a bypassed UI cannot spawn
    // dead stubs.
    const blanksSnap = await db
      .collection("rp_blanks")
      .where("status", "==", "active")
      .get();
    let masterBlanks = blanksSnap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(
        (b) =>
          Number(b.data.schemaVersion) === MASTER_BLANK_SCHEMA_VERSION &&
          isPipelineReadyStyleCode(b.data.styleCode)
      );

    const targetBlankIds = Array.isArray(after.targetBlankIds)
      ? after.targetBlankIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    /**
     * Phase K8 / L13: load the team's product catalog matrix. It gates BOTH:
     *  - which BLANKS spawn (K8, via resolveSpawnBlankIds — only consulted when
     *    there's no per-design targetBlankIds override), AND
     *  - which COLORS each spawned product gets (L13 — approvedVariantIds per
     *    blank; applied regardless of how the blank was selected).
     * Loaded unconditionally now (was gated on an empty targetBlankIds) because
     * the color gate is needed even when the picker set targetBlankIds — and the
     * L12 picker always sets it. Best-effort: a read failure logs + falls through
     * to all-blanks / all-colors defaults (a bad team doc must not halt
     * auto-launch across the catalog).
     */
    let productCatalogMatrix = null;
    try {
      const teamSnap = await db.collection("design_teams").doc(teamId).get();
      if (teamSnap.exists && teamSnap.data() && teamSnap.data().productCatalogMatrix) {
        productCatalogMatrix = teamSnap.data().productCatalogMatrix;
      }
    } catch (matrixErr) {
      console.warn(
        "[ON_DESIGN_CREATED:MATRIX_READ_ERROR]",
        JSON.stringify({
          designId,
          teamId,
          message: matrixErr && matrixErr.message ? matrixErr.message : String(matrixErr),
        })
      );
    }

    {
      // Pure precedence resolution (targetBlankIds > productCatalogMatrix >
      // all-pipeline-ready). Unit-tested in resolveSpawnBlanks.test.ts.
      const beforeCount = masterBlanks.length;
      const { blankIds: allowedIds, reason: filterReason } = resolveSpawnBlankIds(
        masterBlanks.map((b) => b.id),
        { targetBlankIds, productCatalogMatrix }
      );
      const allow = new Set(allowedIds);
      masterBlanks = masterBlanks.filter((b) => allow.has(b.id));
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:FILTER]",
          designId,
          teamId,
          filterReason,
          requested: targetBlankIds.length > 0 ? targetBlankIds : undefined,
          eligibleAfterPipelineGate: beforeCount,
          spawning: masterBlanks.map((b) => b.id),
        })
      );
    }

    if (masterBlanks.length === 0) {
      // Distinguish the empty-result causes: explicit picker, team-matrix
      // restriction, or simply no pipeline-ready blanks at all. The matrix
      // case is the new Phase K8 path — surfaced explicitly so an operator
      // seeing "no products spawned" can tell it's the team catalog, not a
      // missing renderer.
      const noopReason =
        targetBlankIds.length > 0
          ? "no_pipeline_ready_blanks_in_targetBlankIds"
          : "no_pipeline_ready_or_team_approved_blanks";
      console.log(
        JSON.stringify({
          tag: "[ON_DESIGN_CREATED:NOOP]",
          reason: noopReason,
          designId,
          teamId,
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

      /**
       * Phase L13: honor the team's per-blank approved COLORS. The matrix entry's
       * `approvedVariantIds` is the operator's curated color set for this blank
       * (e.g. neutrals only, team-color garment excluded). Restrict the product's
       * variants to it. No matrix entry for this blank, or an empty list → all
       * active colors (back-compat; e.g. a blank added via the picker override
       * that isn't in the team catalog).
       */
      const matrixEntry =
        productCatalogMatrix && productCatalogMatrix[blankId] ? productCatalogMatrix[blankId] : null;
      const approvedColorIds =
        matrixEntry && Array.isArray(matrixEntry.approvedVariantIds)
          ? matrixEntry.approvedVariantIds.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
      let scopedVariants = activeVariants;
      if (approvedColorIds.length > 0) {
        const approvedSet = new Set(approvedColorIds);
        scopedVariants = activeVariants.filter((id) => approvedSet.has(String(id || "").trim()));
        console.log(
          JSON.stringify({
            tag: "[ON_DESIGN_CREATED:COLOR_FILTER]",
            designId,
            blankId,
            activeColors: activeVariants.length,
            approvedColors: scopedVariants.length,
          })
        );
      }

      if (scopedVariants.length === 0) {
        console.log(
          JSON.stringify({
            tag: "[ON_DESIGN_CREATED:BLANK_SKIP]",
            reason: approvedColorIds.length > 0 ? "no_team_approved_colors_active" : "no_active_variants",
            designId,
            blankId,
          })
        );
        continue;
      }
      const uniqueIds = [...new Set(scopedVariants.map((x) => String(x || "").trim()).filter(Boolean))];

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
