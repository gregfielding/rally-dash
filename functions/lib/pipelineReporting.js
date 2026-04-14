"use strict";

/**
 * Canonical stage strings for `rp_products.lastPipelineStage` (failures & diagnostics).
 * Align with operator mental model: materializing → assets → metadata → fulfillment → Shopify.
 */
const PIPELINE_STAGE = {
  MATERIALIZING: "materializing",
  GENERATING_ASSETS: "generating_assets",
  ASSEMBLING_METADATA: "assembling_metadata",
  FULFILLMENT: "fulfillment",
  SHOPIFY_SYNC: "shopify_sync",
};

/**
 * @param {import("firebase-admin").firestore.Firestore} admin
 * @param {string} message
 * @param {string} stage — one of PIPELINE_STAGE.*
 */
function pipelineFailurePatch(admin, message, stage) {
  const msg = message && String(message).trim() ? String(message).trim() : "Pipeline error";
  return {
    lastPipelineError: msg,
    lastPipelineStage: stage,
    lastPipelineAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Clear error fields after a successful transition (keeps `lastPipelineAt` for audit).
 * @param {import("firebase-admin").firestore.Firestore} admin
 */
function pipelineClearErrorPatch(admin) {
  return {
    lastPipelineError: admin.firestore.FieldValue.delete(),
    lastPipelineStage: admin.firestore.FieldValue.delete(),
    lastPipelineAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = {
  PIPELINE_STAGE,
  pipelineFailurePatch,
  pipelineClearErrorPatch,
};
