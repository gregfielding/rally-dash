"use strict";

/**
 * Server mirror of lib/products/resolveProductRenderProfile.ts (keep in sync).
 * Blank placements = canonical; product placementOverrides / legacy renderSetup = optional overrides.
 */

const { DEFAULT_GARMENT_SAFE_AREA } = require("./designArtboardSpec");

function placementRowsForSide(blank, side) {
  const list = blank.placements || [];
  const prefix = side === "front" ? "front_" : "back_";
  return list.filter((p) => String(p.placementId).startsWith(prefix));
}

function getPlacementRowForSide(blank, side, placementId) {
  const rows = placementRowsForSide(blank, side);
  if (rows.length === 0) return null;
  if (placementId && rows.some((r) => r.placementId === placementId)) {
    return rows.find((r) => r.placementId === placementId) || null;
  }
  const centerId = side === "front" ? "front_center" : "back_center";
  return rows.find((r) => r.placementId === centerId) || rows[0];
}

function readLegacyPlacementOverride(product, side) {
  if (!product || !product.renderSetup) return null;
  const po =
    side === "front"
      ? product.renderSetup.front && product.renderSetup.front.placementOverride
      : product.renderSetup.back && product.renderSetup.back.placementOverride;
  if (!po || typeof po !== "object") return null;
  const out = {};
  if (typeof po.x === "number") out.x = po.x;
  if (typeof po.y === "number") out.y = po.y;
  if (typeof po.scale === "number") out.scale = po.scale;
  return Object.keys(out).length ? out : null;
}

function readStructuredPlacementOverride(product, side) {
  const po = product && product.placementOverrides && product.placementOverrides[side];
  if (!po || typeof po !== "object") return null;
  const has =
    po.defaultX != null ||
    po.defaultY != null ||
    po.defaultScale != null ||
    (po.safeArea &&
      (po.safeArea.x != null || po.safeArea.y != null || po.safeArea.w != null || po.safeArea.h != null));
  return has ? po : null;
}

function mergeSafeArea(base, over) {
  if (!over) return base;
  return {
    x: over.x != null ? over.x : base.x,
    y: over.y != null ? over.y : base.y,
    w: over.w != null ? over.w : base.w,
    h: over.h != null ? over.h : base.h,
  };
}

function normalizeSimple8394(s) {
  if (!s || typeof s !== "object") return null;
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 55)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 78)));
  const presets = new Set(["small", "medium", "large", "fill_safe"]);
  const sizePreset = presets.has(s.sizePreset) ? s.sizePreset : "medium";
  return { realism, inkStrength, sizePreset };
}

function derive8394Engine(simple) {
  const n = normalizeSimple8394(simple);
  if (!n) return null;
  const r = Math.max(0, Math.min(100, n.realism));
  let blendMode;
  if (r < 28) blendMode = "normal";
  else if (r < 52) blendMode = "soft-light";
  else if (r < 76) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = Math.max(0.62, Math.min(1, 1 - t * 0.26));
  return { renderZoneDefaults: { blendMode, blendOpacity } };
}

function resolveEffectivePlacement(product, blank, side) {
  const placementKey =
    side === "front"
      ? product && product.renderSetup && product.renderSetup.front && product.renderSetup.front.placementKey
      : product && product.renderSetup && product.renderSetup.back && product.renderSetup.back.placementKey;
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX != null ? row.defaultX : 0.5;
  const baseY = row.defaultY != null ? row.defaultY : 0.5;
  const baseScale = row.defaultScale != null ? row.defaultScale : 0.6;
  const baseSafe = row.safeArea || { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const structured = readStructuredPlacementOverride(product, side);
  const legacy = readLegacyPlacementOverride(product, side);

  let defaultX = baseX;
  let defaultY = baseY;
  let defaultScale = baseScale;
  let safeArea = { ...baseSafe };

  if (structured) {
    if (structured.defaultX != null) defaultX = structured.defaultX;
    if (structured.defaultY != null) defaultY = structured.defaultY;
    if (structured.defaultScale != null) defaultScale = structured.defaultScale;
    safeArea = mergeSafeArea(baseSafe, structured.safeArea);
  } else if (legacy) {
    if (legacy.x != null) defaultX = legacy.x;
    if (legacy.y != null) defaultY = legacy.y;
    if (legacy.scale != null) defaultScale = legacy.scale;
  }

  return {
    placementId: row.placementId,
    defaultX,
    defaultY,
    defaultScale,
    safeArea,
    artboardBase,
    row,
  };
}

function resolveEffectiveRenderSettings(product, blank, variant, placementRow, side) {
  const rd = blank.renderDefaults || {};
  const vo = (variant && variant.renderOverrides) || {};
  let zd = placementRow && placementRow.renderZoneDefaults ? placementRow.renderZoneDefaults : {};
  if (placementRow && placementRow.simpleRenderControls8394) {
    const d = derive8394Engine(placementRow.simpleRenderControls8394);
    if (d) zd = d.renderZoneDefaults;
  }
  const sideRd = side === "front" ? rd.front : rd.back;

  let modeRaw =
    vo.blendMode || zd.blendMode || (sideRd && sideRd.blendMode) || rd.blendMode || "multiply";
  let opRaw =
    vo.blendOpacity != null
      ? vo.blendOpacity
      : zd.blendOpacity != null
        ? zd.blendOpacity
        : sideRd && sideRd.blendOpacity != null
          ? sideRd.blendOpacity
          : rd.blendOpacity != null
            ? rd.blendOpacity
            : 1;

  const ro = product && product.renderOverrides && product.renderOverrides[side];
  if (ro && (ro.blendMode != null || ro.blendOpacity != null)) {
    if (ro.blendMode != null && String(ro.blendMode).trim()) modeRaw = ro.blendMode;
    if (ro.blendOpacity != null && Number.isFinite(ro.blendOpacity)) opRaw = ro.blendOpacity;
  } else {
    const rsSide =
      side === "front"
        ? product && product.renderSetup && product.renderSetup.front
        : product && product.renderSetup && product.renderSetup.back;
    if (rsSide && (rsSide.blendMode != null || rsSide.blendOpacity != null)) {
      if (rsSide.blendMode != null && String(rsSide.blendMode).trim()) modeRaw = rsSide.blendMode;
      if (rsSide.blendOpacity != null && Number.isFinite(rsSide.blendOpacity)) opRaw = rsSide.blendOpacity;
    }
  }

  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opacity = typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;
  return { blendMode: mode, blendOpacity: opacity };
}

function getPlacementFingerprintSliceForProduct(blank, product, side) {
  const placementKey =
    side === "front"
      ? product && product.renderSetup && product.renderSetup.front && product.renderSetup.front.placementKey
      : product && product.renderSetup && product.renderSetup.back && product.renderSetup.back.placementKey;
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;
  const eff = resolveEffectivePlacement(product, blank, side);
  if (!eff) return null;
  const simple = row.simpleRenderControls8394 != null ? normalizeSimple8394(row.simpleRenderControls8394) : null;
  return {
    placementId: row.placementId,
    defaultX: eff.defaultX,
    defaultY: eff.defaultY,
    defaultScale: eff.defaultScale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: row.renderZoneDefaults || null,
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
  };
}

/**
 * Merge product placementOverrides / legacy into createMockJob-style placement object (after blank row).
 */
function resolveMockPlacementForProduct(product, blank, view, placementId) {
  const side = view === "back" ? "back" : "front";
  const row = getPlacementRowForSide(blank, side, placementId);
  const eff = resolveEffectivePlacement(product, blank, side);
  const printArea = row && row.printArea ? row.printArea : {};
  let placement = {
    x: printArea.x != null ? printArea.x : row && row.defaultX != null ? row.defaultX : 0.5,
    y: printArea.y != null ? printArea.y : row && row.defaultY != null ? row.defaultY : 0.5,
    width: printArea.width,
    height: printArea.height,
    scale: row && row.defaultScale != null ? row.defaultScale : 0.6,
    safeArea: row && row.safeArea ? row.safeArea : null,
    rotationDeg: 0,
    blendMode: row && row.blendMode ? row.blendMode : "multiply",
    blendOpacity: row && row.blendOpacity != null ? row.blendOpacity : 0.87,
  };
  if (eff) {
    placement.x = eff.defaultX;
    placement.y = eff.defaultY;
    placement.scale = eff.defaultScale;
    placement.safeArea = eff.safeArea;
  }
  return placement;
}

module.exports = {
  getPlacementRowForSide,
  resolveEffectivePlacement,
  resolveEffectiveRenderSettings,
  getPlacementFingerprintSliceForProduct,
  resolveMockPlacementForProduct,
  readStructuredPlacementOverride,
  readLegacyPlacementOverride,
};
