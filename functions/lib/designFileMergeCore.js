"use strict";

/**
 * Shared design file merge + asset resolution for bulk import commit (mirrors functions/index.js).
 */

const DESIGN_SIDE_KIND_TO_NESTED = {
  frontLightPng: ["front", "lightPng"],
  frontDarkPng: ["front", "darkPng"],
  frontWhitePng: ["front", "whitePng"],
  backLightPng: ["back", "lightPng"],
  backDarkPng: ["back", "darkPng"],
  backWhitePng: ["back", "whitePng"],
  frontLightSvg: ["front", "lightSvg"],
  frontDarkSvg: ["front", "darkSvg"],
  frontWhiteSvg: ["front", "whiteSvg"],
  backLightSvg: ["back", "lightSvg"],
  backDarkSvg: ["back", "darkSvg"],
  backWhiteSvg: ["back", "whiteSvg"],
  frontLightPdf: ["front", "lightPdf"],
  frontDarkPdf: ["front", "darkPdf"],
  frontWhitePdf: ["front", "whitePdf"],
  backLightPdf: ["back", "lightPdf"],
  backDarkPdf: ["back", "darkPdf"],
  backWhitePdf: ["back", "whitePdf"],
};

const DESIGN_FILE_KINDS = new Set([
  "png",
  "pdf",
  "svg",
  "lightPng",
  "darkPng",
  "whitePng",
  "lightSvg",
  "darkSvg",
  "whiteSvg",
  "lightPdf",
  "darkPdf",
  "whitePdf",
  ...Object.keys(DESIGN_SIDE_KIND_TO_NESTED),
]);

function sideHasNestedPng(files, side) {
  const s = files && files[side];
  if (!s) return false;
  return (
    !!(s.lightPng && s.lightPng.downloadUrl) ||
    !!(s.darkPng && s.darkPng.downloadUrl) ||
    !!(s.whitePng && s.whitePng.downloadUrl)
  );
}

function resolveDefaultSide(files, supportedSides) {
  const ss = (supportedSides || []).map(s => String(s).trim().toLowerCase());
  if (ss.length === 1 && ss[0] === "front") return "front";
  if (ss.length === 1 && ss[0] === "back") return "back";
  if (sideHasNestedPng(files, "back") && !sideHasNestedPng(files, "front")) return "back";
  if (sideHasNestedPng(files, "front") && !sideHasNestedPng(files, "back")) return "front";
  return "back";
}

function buildSideAssetsFromFiles(sideFiles) {
  if (!sideFiles) return null;
  const sf = sideFiles;
  const o = {
    lightPng: sf.lightPng && sf.lightPng.downloadUrl ? sf.lightPng.downloadUrl : null,
    darkPng: sf.darkPng && sf.darkPng.downloadUrl ? sf.darkPng.downloadUrl : null,
    whitePng: sf.whitePng && sf.whitePng.downloadUrl ? sf.whitePng.downloadUrl : null,
    lightSvg: sf.lightSvg && sf.lightSvg.downloadUrl ? sf.lightSvg.downloadUrl : null,
    darkSvg: sf.darkSvg && sf.darkSvg.downloadUrl ? sf.darkSvg.downloadUrl : null,
    whiteSvg: sf.whiteSvg && sf.whiteSvg.downloadUrl ? sf.whiteSvg.downloadUrl : null,
    lightPdf: sf.lightPdf && sf.lightPdf.downloadUrl ? sf.lightPdf.downloadUrl : null,
    darkPdf: sf.darkPdf && sf.darkPdf.downloadUrl ? sf.darkPdf.downloadUrl : null,
    whitePdf: sf.whitePdf && sf.whitePdf.downloadUrl ? sf.whitePdf.downloadUrl : null,
  };
  return Object.values(o).some(Boolean) ? o : null;
}

function resolveDesignAssetUrls(data) {
  const a = data.assets || {};
  const f = data.files || {};
  const side = resolveDefaultSide(f, data.supportedSides);
  const nsA = a[side] || {};
  const nsF = f[side] || {};
  const mergeSlot = slot => nsA[slot] || (nsF[slot] && nsF[slot].downloadUrl) || null;
  const leg = {
    lightPng: a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null,
    lightSvg:
      a.lightSvg || (f.lightSvg && f.lightSvg.downloadUrl) || (f.svg && f.svg.downloadUrl) || null,
    darkSvg: a.darkSvg || (f.darkSvg && f.darkSvg.downloadUrl) || null,
    whiteSvg: a.whiteSvg || (f.whiteSvg && f.whiteSvg.downloadUrl) || null,
    lightPdf: a.lightPdf || (f.lightPdf && f.lightPdf.downloadUrl) || (f.pdf && f.pdf.downloadUrl) || null,
    darkPdf: a.darkPdf || (f.darkPdf && f.darkPdf.downloadUrl) || null,
    whitePdf: a.whitePdf || (f.whitePdf && f.whitePdf.downloadUrl) || null,
  };
  const lightPng = mergeSlot("lightPng") || leg.lightPng;
  const darkPng = mergeSlot("darkPng") || leg.darkPng;
  const whitePng = mergeSlot("whitePng") || leg.whitePng;
  const lightSvg = mergeSlot("lightSvg") || leg.lightSvg;
  const darkSvg = mergeSlot("darkSvg") || leg.darkSvg;
  const whiteSvg = mergeSlot("whiteSvg") || leg.whiteSvg;
  const lightPdf = mergeSlot("lightPdf") || leg.lightPdf;
  const darkPdf = mergeSlot("darkPdf") || leg.darkPdf;
  const whitePdf = mergeSlot("whitePdf") || leg.whitePdf;
  return {
    lightPng,
    darkPng,
    whitePng,
    lightSvg,
    darkSvg,
    whiteSvg,
    svg:
      a.svg ||
      (f.svg && f.svg.downloadUrl) ||
      lightSvg ||
      darkSvg ||
      whiteSvg ||
      null,
    lightPdf,
    darkPdf,
    whitePdf,
    pdf: a.pdf || (f.pdf && f.pdf.downloadUrl) || lightPdf || darkPdf || whitePdf || null,
  };
}

function buildAssetsFromFiles(files) {
  const f = files || {};
  const lightSvg = (f.lightSvg && f.lightSvg.downloadUrl) || (f.svg && f.svg.downloadUrl) || null;
  const darkSvg = (f.darkSvg && f.darkSvg.downloadUrl) || null;
  const whiteSvg = (f.whiteSvg && f.whiteSvg.downloadUrl) || null;
  const lightPdf = (f.lightPdf && f.lightPdf.downloadUrl) || (f.pdf && f.pdf.downloadUrl) || null;
  const darkPdf = (f.darkPdf && f.darkPdf.downloadUrl) || null;
  const whitePdf = (f.whitePdf && f.whitePdf.downloadUrl) || null;
  const front = buildSideAssetsFromFiles(f.front);
  const back = buildSideAssetsFromFiles(f.back);
  return {
    lightPng: (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: (f.whitePng && f.whitePng.downloadUrl) || null,
    lightSvg,
    darkSvg,
    whiteSvg,
    svg: (f.svg && f.svg.downloadUrl) || lightSvg || darkSvg || whiteSvg || null,
    lightPdf,
    darkPdf,
    whitePdf,
    pdf: (f.pdf && f.pdf.downloadUrl) || lightPdf || darkPdf || whitePdf || null,
    front: front || null,
    back: back || null,
  };
}

function anySideHasPngSlot(files, assets, slot) {
  for (const s of ["front", "back"]) {
    const u = (assets[s] && assets[s][slot]) || (files[s] && files[s][slot] && files[s][slot].downloadUrl);
    if (u) return true;
  }
  return false;
}

function mergeDesignFiles(currentFiles, kind, fileEntry) {
  const nested = DESIGN_SIDE_KIND_TO_NESTED[kind];
  const base = { ...(currentFiles || {}) };
  if (nested) {
    const [sec, slot] = nested;
    return {
      ...base,
      [sec]: {
        ...(base[sec] || {}),
        [slot]: fileEntry,
      },
    };
  }
  return { ...base, [kind]: fileEntry };
}

function isRasterPngKind(kind) {
  return (
    kind === "png" ||
    kind === "lightPng" ||
    kind === "darkPng" ||
    kind === "whitePng" ||
    /LightPng$/.test(kind) ||
    /DarkPng$/.test(kind) ||
    /WhitePng$/.test(kind)
  );
}

function isSvgFamilyKind(kind) {
  return kind === "svg" || kind === "lightSvg" || kind === "darkSvg" || /Svg$/.test(kind);
}

function computeDesignPngFlags(files, assets) {
  const u = resolveDesignAssetUrls({ files: files || {}, assets: assets || {} });
  const f = files || {};
  const a = assets || {};
  const hasLightPng =
    !!u.lightPng || anySideHasPngSlot(f, a, "lightPng") || !!(f.png && f.png.downloadUrl);
  const hasDarkPng = !!u.darkPng || anySideHasPngSlot(f, a, "darkPng");
  const hasLegacyPng = !!(f.png && f.png.downloadUrl) && !(f.lightPng && f.lightPng.downloadUrl);
  const hasWhitePng =
    !!u.whitePng || anySideHasPngSlot(f, a, "whitePng");
  const hasPng = hasLightPng || hasDarkPng || hasWhitePng;
  return { hasLightPng, hasDarkPng, hasWhitePng, hasLegacyPng, hasPng };
}

function computeDesignIsComplete(data) {
  const u = resolveDesignAssetUrls(data);
  const nameOk = !!(data.name && String(data.name).trim());
  return (
    nameOk &&
    !!data.teamId &&
    !!data.designType &&
    !!u.lightPng &&
    !!u.darkPng &&
    data.status !== "archived"
  );
}

module.exports = {
  DESIGN_SIDE_KIND_TO_NESTED,
  DESIGN_FILE_KINDS,
  mergeDesignFiles,
  buildAssetsFromFiles,
  resolveDesignAssetUrls,
  computeDesignPngFlags,
  computeDesignIsComplete,
  isRasterPngKind,
  isSvgFamilyKind,
};
