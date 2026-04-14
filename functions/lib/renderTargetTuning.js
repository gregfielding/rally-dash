"use strict";

/**
 * Server mirror of lib/render/renderTargetTuning.ts — keep in sync for Cloud Functions compositor.
 */

const RENDER_TARGETS = ["flat_front", "flat_back", "model_front", "model_back"];

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function defaultWarp() {
  return { enabled: false, warpStrength: 0.35, verticalStretch: 0, horizontalWarp: 0 };
}

function defaultMask() {
  return { enabled: false, feather: 0.08, edgeFade: 0.12 };
}

function legacyZoneBlendToBlend01(z) {
  if (!z || (z.blendMode == null && z.blendOpacity == null)) return {};
  const op = typeof z.blendOpacity === "number" && Number.isFinite(z.blendOpacity) ? z.blendOpacity : 0.85;
  const mode = String(z.blendMode || "multiply").toLowerCase();
  let fabricFeelPct = 75;
  if (mode === "normal") fabricFeelPct = 12;
  else if (mode === "soft-light") fabricFeelPct = 38;
  else if (mode === "overlay") fabricFeelPct = 58;
  const printStrengthPct = clamp(Math.round(((op - 0.35) / 0.65) * 100), 0, 100);
  return { fabricFeel: fabricFeelPct / 100, printStrength: printStrengthPct / 100 };
}

function rowToBlend01(row, styleCode) {
  const sc = String(styleCode || "").trim();
  if (sc === "8394" && row.view === "back" && row.simpleRenderControls8394) {
    const r = row.simpleRenderControls8394.realism != null ? row.simpleRenderControls8394.realism : 52;
    const i = row.simpleRenderControls8394.inkStrength != null ? row.simpleRenderControls8394.inkStrength : 95;
    return { fabricFeel: clamp(r, 0, 100) / 100, printStrength: clamp(i, 0, 100) / 100 };
  }
  const z = row.renderZoneDefaults;
  const op = z && typeof z.blendOpacity === "number" && Number.isFinite(z.blendOpacity) ? z.blendOpacity : 0.85;
  const mode = String((z && z.blendMode) || "multiply").toLowerCase();
  let fabricFeelPct = 75;
  if (mode === "normal") fabricFeelPct = 12;
  else if (mode === "soft-light") fabricFeelPct = 38;
  else if (mode === "overlay") fabricFeelPct = 58;
  const printStrengthPct = clamp(Math.round(((op - 0.35) / 0.65) * 100), 0, 100);
  return { fabricFeel: fabricFeelPct / 100, printStrength: printStrengthPct / 100 };
}

function getDefaultRenderTargetSettings(target, row, styleCode) {
  return {
    placement: { scale: row.defaultScale, x: row.defaultX, y: row.defaultY },
    blend: rowToBlend01(row, styleCode),
    warp: defaultWarp(),
    mask: defaultMask(),
  };
}

function pickRowForRenderTarget(rows, target) {
  if (!rows || rows.length === 0) return null;
  const wantBack = target === "flat_back" || target === "model_back";
  const hit = rows.find((x) => x.view === (wantBack ? "back" : "front"));
  return hit || rows[0];
}

function cloneRenderTargetSettings(s) {
  return {
    placement: { ...s.placement },
    blend: { ...s.blend },
    warp: s.warp ? { ...s.warp } : defaultWarp(),
    mask: s.mask ? { ...s.mask } : defaultMask(),
  };
}

function mergeRenderTargetSettings(base, patch) {
  if (!patch) return cloneRenderTargetSettings(base);
  return {
    placement: { ...base.placement, ...(patch.placement || {}) },
    blend: { ...base.blend, ...(patch.blend || {}) },
    warp: { ...defaultWarp(), ...base.warp, ...patch.warp },
    mask: { ...defaultMask(), ...base.mask, ...patch.mask },
  };
}

function buildRenderTargetSettingsMap(persisted, rows, styleCode) {
  const out = {};
  for (const t of RENDER_TARGETS) {
    const row = pickRowForRenderTarget(rows, t);
    if (!row) continue;
    const base = getDefaultRenderTargetSettings(t, row, styleCode);
    const saved = persisted && persisted[t];
    out[t] = saved ? mergeRenderTargetSettings(base, saved) : cloneRenderTargetSettings(base);
  }
  return out;
}

function blend01ToPreviewCss(blend) {
  const pf = clamp(blend.fabricFeel, 0, 1);
  const ps = clamp(blend.printStrength, 0, 1);
  const blendOpacity = clamp(0.35 + ps * 0.65, 0.3, 1);
  let blendMode = "multiply";
  if (pf < 0.28) blendMode = "normal";
  else if (pf < 0.5) blendMode = "soft-light";
  else if (pf < 0.72) blendMode = "overlay";
  else blendMode = "multiply";
  const opacityAdjust = blendOpacity * (0.7 + (1 - pf) * 0.3);
  return { blendMode, blendOpacity: clamp(opacityAdjust, 0.28, 1) };
}

function blendSettingsToEngineBlend(blend) {
  const base = blend01ToPreviewCss(blend);
  if (!blend.mode) return base;
  const map = { clean: "normal", soft: "soft-light", vintage: "multiply", bold: "normal" };
  const m = map[blend.mode];
  return m ? { ...base, blendMode: m } : base;
}

function variantSliceToRenderTargetSettingsPatch(slice, row, styleCode) {
  if (!slice) return {};
  const patch = {};
  if (slice.defaultX != null || slice.defaultY != null || slice.defaultScale != null) {
    patch.placement = {
      scale: slice.defaultScale != null ? slice.defaultScale : row.defaultScale,
      x: slice.defaultX != null ? slice.defaultX : row.defaultX,
      y: slice.defaultY != null ? slice.defaultY : row.defaultY,
    };
  }
  const sc = String(styleCode || "").trim();
  const blend = {};
  if (sc === "8394" && row.view === "back" && slice.simpleRenderControls8394) {
    const r = slice.simpleRenderControls8394.realism != null ? slice.simpleRenderControls8394.realism : 52;
    const i = slice.simpleRenderControls8394.inkStrength != null ? slice.simpleRenderControls8394.inkStrength : 95;
    blend.fabricFeel = clamp(r, 0, 100) / 100;
    blend.printStrength = clamp(i, 0, 100) / 100;
  }
  if (
    slice.renderZoneDefaults &&
    (slice.renderZoneDefaults.blendMode != null || slice.renderZoneDefaults.blendOpacity != null)
  ) {
    Object.assign(blend, legacyZoneBlendToBlend01(slice.renderZoneDefaults));
  }
  if (Object.keys(blend).length) patch.blend = blend;
  return patch;
}

function variantRenderTargetSliceIsMeaningful(slice) {
  if (!slice || typeof slice !== "object") return false;
  return (
    slice.defaultX != null ||
    slice.defaultY != null ||
    slice.defaultScale != null ||
    (slice.safeArea && Object.keys(slice.safeArea).length > 0) ||
    (slice.simpleRenderControls8394 && Object.keys(slice.simpleRenderControls8394).length > 0) ||
    (slice.renderZoneDefaults &&
      (slice.renderZoneDefaults.blendMode != null || slice.renderZoneDefaults.blendOpacity != null)) ||
    (slice.placementKey != null && String(slice.placementKey).trim() !== "")
  );
}

module.exports = {
  RENDER_TARGETS,
  buildRenderTargetSettingsMap,
  mergeRenderTargetSettings,
  blendSettingsToEngineBlend,
  variantSliceToRenderTargetSettingsPatch,
  variantRenderTargetSliceIsMeaningful,
  getDefaultRenderTargetSettings,
};
