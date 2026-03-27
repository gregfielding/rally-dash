"use strict";

/**
 * Server mirror of lib/products/resolveProductRenderProfile.ts (keep in sync).
 * Hierarchy: blank placements → blank color variant renderProfileOverrides / renderOverrides → product → legacy renderSetup.
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

function variantSideSlice(variant, side) {
  const o = variant && variant.renderProfileOverrides;
  if (!o) return null;
  return side === "front" ? o.front : o.back;
}

function resolvePlacementKeyForSide(product, variant, side) {
  const vs = variantSideSlice(variant, side);
  const vk = vs && vs.placementKey;
  const pk =
    side === "front"
      ? product && product.renderSetup && product.renderSetup.front && product.renderSetup.front.placementKey
      : product && product.renderSetup && product.renderSetup.back && product.renderSetup.back.placementKey;
  return pk != null && pk !== "" ? pk : vk || null;
}

function normalizeSimple8394(s) {
  if (!s || typeof s !== "object") return null;
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 55)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 78)));
  const presets = new Set(["small", "medium", "large", "fill_safe"]);
  const sizePreset = presets.has(s.sizePreset) ? s.sizePreset : "medium";
  return { realism, inkStrength, sizePreset };
}

function mapRealism8394(realism) {
  const r = Math.max(0, Math.min(100, realism));
  let blendMode;
  if (r < 28) blendMode = "normal";
  else if (r < 52) blendMode = "soft-light";
  else if (r < 76) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = Math.max(0.62, Math.min(1, 1 - t * 0.26));
  return { blendMode, blendOpacity };
}

function derive8394Engine(simple) {
  const n = normalizeSimple8394(simple);
  if (!n) return null;
  const { blendMode, blendOpacity } = mapRealism8394(n.realism);
  return { renderZoneDefaults: { blendMode, blendOpacity } };
}

function mergeSimple8394FromVariant(placementRow, variant, side) {
  if (side !== "back" || !placementRow || !placementRow.simpleRenderControls8394) {
    return placementRow && placementRow.simpleRenderControls8394 ? placementRow.simpleRenderControls8394 : null;
  }
  const partial = variantSideSlice(variant, "back") && variantSideSlice(variant, "back").simpleRenderControls8394;
  if (!partial) return placementRow.simpleRenderControls8394;
  return { ...placementRow.simpleRenderControls8394, ...partial };
}

function resolveEffectivePlacement(product, blank, side, variant) {
  const placementKey = resolvePlacementKeyForSide(product, variant, side);
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX != null ? row.defaultX : 0.5;
  const baseY = row.defaultY != null ? row.defaultY : 0.5;
  const baseScale = row.defaultScale != null ? row.defaultScale : 0.6;
  const baseSafe = row.safeArea || { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const vs = variantSideSlice(variant, side);
  let defaultX = baseX;
  let defaultY = baseY;
  let defaultScale = baseScale;
  let safeArea = { ...baseSafe };
  let variantTouched = false;

  if (vs) {
    if (vs.defaultX != null) {
      defaultX = vs.defaultX;
      variantTouched = true;
    }
    if (vs.defaultY != null) {
      defaultY = vs.defaultY;
      variantTouched = true;
    }
    if (vs.defaultScale != null) {
      defaultScale = vs.defaultScale;
      variantTouched = true;
    }
    if (vs.safeArea && Object.keys(vs.safeArea).length > 0) {
      safeArea = mergeSafeArea(safeArea, vs.safeArea);
      variantTouched = true;
    }
  }

  const structured = readStructuredPlacementOverride(product, side);
  const legacy = readLegacyPlacementOverride(product, side);

  let source = "blank";

  if (structured) {
    if (structured.defaultX != null) defaultX = structured.defaultX;
    if (structured.defaultY != null) defaultY = structured.defaultY;
    if (structured.defaultScale != null) defaultScale = structured.defaultScale;
    safeArea = mergeSafeArea(safeArea, structured.safeArea);
    source = "product_override";
  } else if (legacy) {
    if (legacy.x != null) defaultX = legacy.x;
    if (legacy.y != null) defaultY = legacy.y;
    if (legacy.scale != null) defaultScale = legacy.scale;
    source = "legacy_render_setup";
  } else if (variantTouched) {
    source = "variant_override";
  }

  return {
    placementId: row.placementId,
    defaultX,
    defaultY,
    defaultScale,
    safeArea,
    artboardBase,
    source,
  };
}

function resolveEffectiveRenderSettings(product, blank, variant, placementRow, side) {
  const rd = blank.renderDefaults || {};
  const mergedSimple = mergeSimple8394FromVariant(placementRow, variant, side);
  const derived8394 = mergedSimple != null ? derive8394Engine(mergedSimple) : null;
  let zd = derived8394 && derived8394.renderZoneDefaults ? derived8394.renderZoneDefaults : null;
  if (!zd && placementRow && placementRow.renderZoneDefaults) {
    zd = placementRow.renderZoneDefaults;
  }

  const sideProf = variantSideSlice(variant, side);
  if (
    sideProf &&
    sideProf.renderZoneDefaults &&
    (sideProf.renderZoneDefaults.blendMode != null || sideProf.renderZoneDefaults.blendOpacity != null)
  ) {
    zd = {
      blendMode: sideProf.renderZoneDefaults.blendMode != null ? sideProf.renderZoneDefaults.blendMode : zd && zd.blendMode,
      blendOpacity:
        sideProf.renderZoneDefaults.blendOpacity != null ? sideProf.renderZoneDefaults.blendOpacity : zd && zd.blendOpacity,
    };
  }

  const sideRd = side === "front" ? rd.front : rd.back;
  const vo = variant && variant.renderOverrides;

  let modeRaw =
    (vo && vo.blendMode) ??
    (zd && zd.blendMode) ??
    (sideRd && sideRd.blendMode) ??
    rd.blendMode ??
    "multiply";
  let opRaw =
    (vo && vo.blendOpacity) ??
    (zd && zd.blendOpacity) ??
    (sideRd && sideRd.blendOpacity) ??
    rd.blendOpacity ??
    1;

  const simplePatch = sideProf && sideProf.simpleRenderControls8394;
  const variantBlendTouched =
    !!(simplePatch && typeof simplePatch === "object" && Object.keys(simplePatch).length > 0) ||
    !!(sideProf &&
      sideProf.renderZoneDefaults &&
      (sideProf.renderZoneDefaults.blendMode != null || sideProf.renderZoneDefaults.blendOpacity != null)) ||
    (vo && vo.blendMode != null) ||
    (vo && vo.blendOpacity != null);

  let source = "blank";

  const ro = product && product.renderOverrides && product.renderOverrides[side];
  if (ro && (ro.blendMode != null || ro.blendOpacity != null)) {
    if (ro.blendMode != null && String(ro.blendMode).trim()) modeRaw = ro.blendMode;
    if (ro.blendOpacity != null && Number.isFinite(ro.blendOpacity)) opRaw = ro.blendOpacity;
    source = "product_override";
  } else {
    const rsSide =
      side === "front"
        ? product && product.renderSetup && product.renderSetup.front
        : product && product.renderSetup && product.renderSetup.back;
    if (rsSide && (rsSide.blendMode != null || rsSide.blendOpacity != null)) {
      if (rsSide.blendMode != null && String(rsSide.blendMode).trim()) modeRaw = rsSide.blendMode;
      if (rsSide.blendOpacity != null && Number.isFinite(rsSide.blendOpacity)) opRaw = rsSide.blendOpacity;
      source = "legacy_render_setup";
    } else if (variantBlendTouched) {
      source = "variant_override";
    }
  }

  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opacity = typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;
  return { blendMode: mode, blendOpacity: opacity, source };
}

function getPlacementFingerprintSliceForProduct(blank, product, side, variant) {
  const pk = resolvePlacementKeyForSide(product, variant, side);
  const row = getPlacementRowForSide(blank, side, pk);
  if (!row) return null;
  const eff = resolveEffectivePlacement(product, blank, side, variant);
  if (!eff) return null;

  const mergedSimpleRaw = mergeSimple8394FromVariant(row, variant, side);
  const simple = mergedSimpleRaw != null ? normalizeSimple8394(mergedSimpleRaw) : null;

  const blendEff = resolveEffectiveRenderSettings(product, blank, variant, row, side);

  return {
    placementId: row.placementId,
    defaultX: eff.defaultX,
    defaultY: eff.defaultY,
    defaultScale: eff.defaultScale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: { blendMode: blendEff.blendMode, blendOpacity: blendEff.blendOpacity },
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
  };
}

function resolveMockPlacementForProduct(product, blank, view, placementId, variant) {
  const side = view === "back" ? "back" : "front";
  const pk = resolvePlacementKeyForSide(product, variant, side) || placementId;
  const row = getPlacementRowForSide(blank, side, pk);
  const eff = resolveEffectivePlacement(product, blank, side, variant);
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
  resolvePlacementKeyForSide,
  resolveEffectivePlacement,
  resolveEffectiveRenderSettings,
  getPlacementFingerprintSliceForProduct,
  resolveMockPlacementForProduct,
  readStructuredPlacementOverride,
  readLegacyPlacementOverride,
};
