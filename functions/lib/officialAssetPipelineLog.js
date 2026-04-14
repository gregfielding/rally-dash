"use strict";

function safeJson(payload) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function logOfficialAssetBatchStart(payload) {
  console.log(`[OFFICIAL_ASSET_BATCH:START]\n${safeJson(payload)}`);
}

function logOfficialAssetEnqueue(payload) {
  console.log(`[OFFICIAL_ASSET_ENQUEUE]\n${safeJson(payload)}`);
}

function logOfficialAssetJobResult(payload) {
  console.log(`[OFFICIAL_ASSET_JOB_RESULT]\n${safeJson(payload)}`);
}

function logOfficialAssetBatchRollup(payload) {
  console.log(`[OFFICIAL_ASSET_BATCH:ROLLUP]\n${safeJson(payload)}`);
}

module.exports = {
  logOfficialAssetBatchStart,
  logOfficialAssetEnqueue,
  logOfficialAssetJobResult,
  logOfficialAssetBatchRollup,
};
