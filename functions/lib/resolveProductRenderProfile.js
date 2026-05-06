"use strict";

/**
 * Server mirror of lib/products/resolveProductRenderProfile.ts (keep in sync).
 * Hierarchy: blank placements → blank color variant renderProfileOverrides / renderOverrides → product → legacy renderSetup.
 */

const { DEFAULT_GARMENT_SAFE_AREA } = require("./designArtboardSpec");
const {
  buildRenderTargetSettingsMap,
  mergeRenderTargetSettings,
  blendSettingsToEngineBlend,
  variantSliceToRenderTargetSettingsPatch,
  variantRenderTargetSliceIsMeaningful,
  getDefaultRenderTargetSettings,
} = require("./renderTargetTuning");

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

function renderTargetToSide(target) {
  return target === "flat_front" || target === "model_front" ? "front" : "back";
}

function variantRenderTargetSlice(variant, target) {
  const o = variant && variant.renderTargetOverrides;
  if (!o || !target) return null;
  return o[target] || null;
}

function variantSliceForRenderTarget(variant, target) {
  const side = renderTargetToSide(target);
  const rt = variantRenderTargetSlice(variant, target);
  const leg = variantSideSlice(variant, side);
  if (target !== "flat_back" && target !== "flat_front") {
    return rt || null;
  }
  if (!leg && !rt) return null;
  if (!leg) return rt;
  if (!rt) return leg;
  const safeArea =
    rt.safeArea && Object.keys(rt.safeArea).length > 0
      ? mergeSafeArea(
          {
            x: leg.safeArea && leg.safeArea.x != null ? leg.safeArea.x : 0,
            y: leg.safeArea && leg.safeArea.y != null ? leg.safeArea.y : 0,
            w: leg.safeArea && leg.safeArea.w != null ? leg.safeArea.w : 1,
            h: leg.safeArea && leg.safeArea.h != null ? leg.safeArea.h : 1,
          },
          rt.safeArea
        )
      : leg.safeArea;
  const a = (leg.simpleRenderControls8394 && typeof leg.simpleRenderControls8394 === "object" && leg.simpleRenderControls8394) || {};
  const b = (rt.simpleRenderControls8394 && typeof rt.simpleRenderControls8394 === "object" && rt.simpleRenderControls8394) || {};
  const simpleKeys = { ...a, ...b };
  const simpleRenderControls8394 = Object.keys(simpleKeys).length ? simpleKeys : null;
  const ra = leg.renderZoneDefaults || {};
  const rb = rt.renderZoneDefaults || {};
  let renderZoneDefaults = null;
  if (Object.keys(rb).length > 0) {
    renderZoneDefaults = {
      blendMode: rb.blendMode != null ? rb.blendMode : ra.blendMode,
      blendOpacity: rb.blendOpacity != null ? rb.blendOpacity : ra.blendOpacity,
    };
  } else if (Object.keys(ra).length > 0) {
    renderZoneDefaults = ra;
  }
  return {
    placementKey:
      rt.placementKey != null && String(rt.placementKey).trim() ? rt.placementKey : leg.placementKey,
    defaultX: rt.defaultX != null ? rt.defaultX : leg.defaultX,
    defaultY: rt.defaultY != null ? rt.defaultY : leg.defaultY,
    defaultScale: rt.defaultScale != null ? rt.defaultScale : leg.defaultScale,
    safeArea,
    simpleRenderControls8394,
    renderZoneDefaults,
  };
}

function resolvePlacementKeyForRenderTarget(product, variant, target) {
  const side = renderTargetToSide(target);
  const pkProduct =
    side === "front"
      ? product && product.renderSetup && product.renderSetup.front && product.renderSetup.front.placementKey
      : product && product.renderSetup && product.renderSetup.back && product.renderSetup.back.placementKey;
  if (pkProduct != null && String(pkProduct).trim()) return pkProduct;
  const slice = variantSliceForRenderTarget(variant, target);
  return slice && slice.placementKey ? slice.placementKey : null;
}

function mergeSimple8394ForTarget(placementRow, variant, target) {
  if (!placementRow || !placementRow.simpleRenderControls8394) return null;
  const slice = variantSliceForRenderTarget(variant, target);
  const partial = slice && slice.simpleRenderControls8394;
  if (!partial) return placementRow.simpleRenderControls8394;
  return { ...placementRow.simpleRenderControls8394, ...partial };
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
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 52)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 95)));
  const presets = new Set(["small", "medium", "large", "fill_safe"]);
  const sizePreset = presets.has(s.sizePreset) ? s.sizePreset : "medium";
  return { realism, inkStrength, sizePreset };
}

/** Matches `lib/blanks/preview8394` `mapRealismToBlendPreview` (parity with blank editor + Sharp). */
function mapRealism8394(realism) {
  const r = Math.max(0, Math.min(100, realism));
  let blendMode;
  if (r < 22) blendMode = "normal";
  else if (r < 46) blendMode = "soft-light";
  else if (r < 70) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = Math.min(0.97, Math.max(0.4, 0.44 + (1 - t) * 0.52));
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

function resolveEffectivePlacementForRenderTarget(product, blank, variant, target) {
  const side = renderTargetToSide(target);
  const placementKey = resolvePlacementKeyForRenderTarget(product, variant, target);
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX != null ? row.defaultX : 0.5;
  const baseY = row.defaultY != null ? row.defaultY : 0.5;
  const baseScale = row.defaultScale != null ? row.defaultScale : 0.6;
  const baseSafe = row.safeArea || { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const vs = variantSliceForRenderTarget(variant, target);
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

function resolveEffectiveRenderSettingsForRenderTarget(product, blank, variant, placementRow, target) {
  const side = renderTargetToSide(target);
  const rd = blank.renderDefaults || {};
  const mergedSimple = mergeSimple8394ForTarget(placementRow, variant, target);
  const derived8394 = mergedSimple != null ? derive8394Engine(mergedSimple) : null;
  let zd = derived8394 && derived8394.renderZoneDefaults ? derived8394.renderZoneDefaults : null;
  if (!zd && placementRow && placementRow.renderZoneDefaults) {
    zd = placementRow.renderZoneDefaults;
  }

  const sideProf = variantSliceForRenderTarget(variant, target);
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

function productPlacementToRenderTargetSettingsPatch(product, side) {
  const st = readStructuredPlacementOverride(product, side);
  const leg = readLegacyPlacementOverride(product, side);
  const p = {};
  if (st && st.defaultX != null) p.x = st.defaultX;
  if (st && st.defaultY != null) p.y = st.defaultY;
  if (st && st.defaultScale != null) p.scale = st.defaultScale;
  if (leg && leg.x != null) p.x = leg.x;
  if (leg && leg.y != null) p.y = leg.y;
  if (leg && leg.scale != null) p.scale = leg.scale;
  if (Object.keys(p).length === 0) return {};
  return { placement: p };
}

function resolveEffectiveRenderTargetSettings(product, blank, variant, target) {
  const styleCode = String((blank && blank.styleCode) || "");
  const rows = blank && Array.isArray(blank.placements) ? blank.placements : [];
  const persisted = blank && blank.renderProfile && blank.renderProfile.renderTargets;
  const blankHad = !!(persisted && persisted[target] && typeof persisted[target] === "object");
  const vid = variant && variant.variantId;
  const byColor =
    vid && blank && blank.renderProfile && blank.renderProfile.renderTargetsByColor
      ? blank.renderProfile.renderTargetsByColor[vid]
      : null;
  const colorMatrixCell = byColor && byColor[target];
  const colorMatrixCellExisted = !!(colorMatrixCell && typeof colorMatrixCell === "object");

  const baseMap = buildRenderTargetSettingsMap(persisted, rows, styleCode);
  let settings = baseMap[target];
  const side = renderTargetToSide(target);
  const pk = resolvePlacementKeyForRenderTarget(product, variant, target);
  const row = getPlacementRowForSide(blank, side, pk);
  const fallbackRow =
    row ||
    {
      defaultScale: 0.6,
      defaultX: 0.5,
      defaultY: 0.5,
      view: side,
      renderZoneDefaults: null,
      simpleRenderControls8394: null,
    };

  if (!settings) {
    settings = mergeRenderTargetSettings(
      getDefaultRenderTargetSettings(target, fallbackRow, styleCode),
      persisted && persisted[target]
    );
  }

  const vSlice = variantSliceForRenderTarget(variant, target);
  settings = mergeRenderTargetSettings(
    settings,
    variantSliceToRenderTargetSettingsPatch(vSlice, fallbackRow, styleCode)
  );

  let primaryTuningLayer = blankHad ? "blank_renderTargets" : "placement_defaults";
  if (colorMatrixCellExisted) {
    settings = mergeRenderTargetSettings(settings, colorMatrixCell);
    primaryTuningLayer = "color_matrix";
  }

  const prodPatch = productPlacementToRenderTargetSettingsPatch(product, side);
  const productPlacementApplied = !!(prodPatch.placement && Object.keys(prodPatch.placement).length > 0);
  settings = mergeRenderTargetSettings(settings, prodPatch);

  return {
    settings,
    qa: {
      target,
      blankTuningExisted: blankHad,
      variantTargetOverrideExisted: variantRenderTargetSliceIsMeaningful(vSlice),
      productPlacementApplied,
      primaryTuningLayer,
      colorMatrixCellExisted,
    },
  };
}

function resolveEngineBlendForRenderTarget(product, blank, variant, target, tuningBlend) {
  const side = renderTargetToSide(target);
  const styleCode = String((blank && blank.styleCode) || "").trim();
  let fromTuning;
  if (styleCode === "8394") {
    const tb = tuningBlend || {};
    const ff =
      typeof tb.fabricFeel === "number" && Number.isFinite(tb.fabricFeel) ? tb.fabricFeel : 0.52;
    const clamped = Math.max(0, Math.min(1, ff));
    const r = Math.round(clamped * 100);
    fromTuning = mapRealism8394(r);
  } else {
    fromTuning = blendSettingsToEngineBlend(tuningBlend);
  }
  let modeRaw = fromTuning.blendMode;
  let opRaw = fromTuning.blendOpacity;
  let source = "blank";

  const vo = variant && variant.renderOverrides;
  if (vo && vo.blendMode != null && String(vo.blendMode).trim()) modeRaw = vo.blendMode;
  if (vo && vo.blendOpacity != null && Number.isFinite(vo.blendOpacity)) opRaw = vo.blendOpacity;

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
    } else if (vo && (vo.blendMode != null || vo.blendOpacity != null)) {
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

function getPlacementFingerprintSliceForRenderTarget(blank, product, target, variant) {
  const side = renderTargetToSide(target);
  const pk = resolvePlacementKeyForRenderTarget(product, variant, target);
  const row = getPlacementRowForSide(blank, side, pk);
  if (!row) return null;
  const eff = resolveEffectivePlacementForRenderTarget(product, blank, variant, target);
  if (!eff) return null;

  const mergedSimpleRaw = mergeSimple8394ForTarget(row, variant, target);
  const simple = mergedSimpleRaw != null ? normalizeSimple8394(mergedSimpleRaw) : null;

  const tuning = resolveEffectiveRenderTargetSettings(product, blank, variant, target);
  const blendEff = resolveEngineBlendForRenderTarget(
    product,
    blank,
    variant,
    target,
    tuning.settings.blend
  );

  return {
    placementId: row.placementId,
    defaultX: tuning.settings.placement.x,
    defaultY: tuning.settings.placement.y,
    defaultScale: tuning.settings.placement.scale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: { blendMode: blendEff.blendMode, blendOpacity: blendEff.blendOpacity },
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
    targetTuningWarp: tuning.settings.warp != null ? tuning.settings.warp : null,
    targetTuningMask: tuning.settings.mask != null ? tuning.settings.mask : null,
  };
}

function resolveMockPlacementForProduct(product, blank, view, placementId, variant) {
  const side = view === "back" ? "back" : "front";
  const target = side === "back" ? "flat_back" : "flat_front";
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
    const tuning = resolveEffectiveRenderTargetSettings(product, blank, variant, target);
    const eb = resolveEngineBlendForRenderTarget(product, blank, variant, target, tuning.settings.blend);
    placement.x = tuning.settings.placement.x;
    placement.y = tuning.settings.placement.y;
    placement.scale = tuning.settings.placement.scale;
    placement.safeArea = eff.safeArea;
    placement.blendMode = eb.blendMode;
    placement.blendOpacity = eb.blendOpacity;
  }
  return placement;
}

module.exports = {
  getPlacementRowForSide,
  resolvePlacementKeyForSide,
  resolvePlacementKeyForRenderTarget,
  resolveEffectivePlacement,
  resolveEffectivePlacementForRenderTarget,
  resolveEffectiveRenderSettings,
  resolveEffectiveRenderSettingsForRenderTarget,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
  getPlacementFingerprintSliceForProduct,
  getPlacementFingerprintSliceForRenderTarget,
  mergeSimple8394ForTarget,
  renderTargetToSide,
  resolveMockPlacementForProduct,
  readStructuredPlacementOverride,
  readLegacyPlacementOverride,
};
