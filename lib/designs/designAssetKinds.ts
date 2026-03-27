/**
 * Side-aware design file kinds for `updateDesignFile` / Storage.
 * Maps to Firestore: `files.{front|back}.{lightPng|darkPng|whitePng|...}` and mirrored `assets.*`.
 */

export const DESIGN_SIDE_RASTER_KINDS = [
  "frontLightPng",
  "frontDarkPng",
  "frontWhitePng",
  "backLightPng",
  "backDarkPng",
  "backWhitePng",
] as const;

export const DESIGN_SIDE_VECTOR_KINDS = [
  "frontLightSvg",
  "frontDarkSvg",
  "frontWhiteSvg",
  "backLightSvg",
  "backDarkSvg",
  "backWhiteSvg",
] as const;

export const DESIGN_SIDE_PDF_KINDS = [
  "frontLightPdf",
  "frontDarkPdf",
  "frontWhitePdf",
  "backLightPdf",
  "backDarkPdf",
  "backWhitePdf",
] as const;

export const DESIGN_SIDE_AWARE_KINDS = [
  ...DESIGN_SIDE_RASTER_KINDS,
  ...DESIGN_SIDE_VECTOR_KINDS,
  ...DESIGN_SIDE_PDF_KINDS,
] as const;

export type DesignSideAwareFileKind = (typeof DESIGN_SIDE_AWARE_KINDS)[number];

export type DesignLegacyFileKind =
  | "png"
  | "lightPng"
  | "darkPng"
  | "whitePng"
  | "svg"
  | "lightSvg"
  | "darkSvg"
  | "whiteSvg"
  | "pdf"
  | "lightPdf"
  | "darkPdf"
  | "whitePdf";

export type DesignFileKind = DesignSideAwareFileKind | DesignLegacyFileKind;

type Side = "front" | "back";
type Slot =
  | "lightPng"
  | "darkPng"
  | "whitePng"
  | "lightSvg"
  | "darkSvg"
  | "whiteSvg"
  | "lightPdf"
  | "darkPdf"
  | "whitePdf";

const KIND_TO_NESTED: Record<DesignSideAwareFileKind, { side: Side; slot: Slot }> = {
  frontLightPng: { side: "front", slot: "lightPng" },
  frontDarkPng: { side: "front", slot: "darkPng" },
  frontWhitePng: { side: "front", slot: "whitePng" },
  backLightPng: { side: "back", slot: "lightPng" },
  backDarkPng: { side: "back", slot: "darkPng" },
  backWhitePng: { side: "back", slot: "whitePng" },
  frontLightSvg: { side: "front", slot: "lightSvg" },
  frontDarkSvg: { side: "front", slot: "darkSvg" },
  frontWhiteSvg: { side: "front", slot: "whiteSvg" },
  backLightSvg: { side: "back", slot: "lightSvg" },
  backDarkSvg: { side: "back", slot: "darkSvg" },
  backWhiteSvg: { side: "back", slot: "whiteSvg" },
  frontLightPdf: { side: "front", slot: "lightPdf" },
  frontDarkPdf: { side: "front", slot: "darkPdf" },
  frontWhitePdf: { side: "front", slot: "whitePdf" },
  backLightPdf: { side: "back", slot: "lightPdf" },
  backDarkPdf: { side: "back", slot: "darkPdf" },
  backWhitePdf: { side: "back", slot: "whitePdf" },
};

export function isSideAwareDesignFileKind(k: string): k is DesignSideAwareFileKind {
  return (DESIGN_SIDE_AWARE_KINDS as readonly string[]).includes(k);
}

export function nestedFilesPathForKind(kind: DesignSideAwareFileKind): string {
  const { side, slot } = KIND_TO_NESTED[kind];
  return `${side}.${slot}`;
}

export function fileKindDocCategory(kind: DesignFileKind): "png" | "svg" | "pdf" {
  if (kind === "png" || kind.endsWith("Png")) return "png";
  if (kind === "svg" || kind.endsWith("Svg")) return "svg";
  return "pdf";
}

/** Garment artwork tone for batch import: light | dark | white (maps to asset slots). */
export type GarmentToneToken = "light" | "dark" | "white";

/**
 * Side-agnostic uploads (canonical filenames): tone + extension → legacy flat `files` slots.
 * Same artwork can be applied to front or back per blank `defaultPrintSides` / product build.
 */
export function designFileKindFromToneExt(garmentTone: string, ext: string): DesignLegacyFileKind {
  const t = garmentTone.trim().toLowerCase();
  if (t !== "light" && t !== "dark" && t !== "white") {
    throw new Error(`Invalid garment tone: ${garmentTone}`);
  }
  const e = ext.toLowerCase();
  if (e !== "png" && e !== "svg" && e !== "pdf") {
    throw new Error(`Invalid extension: ${ext}`);
  }
  if (e === "png") {
    if (t === "light") return "lightPng";
    if (t === "dark") return "darkPng";
    return "whitePng";
  }
  if (e === "svg") {
    if (t === "light") return "lightSvg";
    if (t === "dark") return "darkSvg";
    return "whiteSvg";
  }
  if (t === "light") return "lightPdf";
  if (t === "dark") return "darkPdf";
  return "whitePdf";
}

/** Batch import: map side + garment tone + extension → `updateDesignFile` kind. */
export function designFileKindFromSideToneExt(
  side: string,
  garmentTone: string,
  ext: string
): DesignSideAwareFileKind {
  const s = side.trim().toLowerCase();
  const t = garmentTone.trim().toLowerCase();
  if (s !== "front" && s !== "back") {
    throw new Error(`Invalid side: ${side}`);
  }
  if (t !== "light" && t !== "dark" && t !== "white") {
    throw new Error(`Invalid garment tone: ${garmentTone}`);
  }
  const e = ext.toLowerCase();
  if (e !== "png" && e !== "svg" && e !== "pdf") {
    throw new Error(`Invalid extension: ${ext}`);
  }
  const toneCap = t === "light" ? "Light" : t === "dark" ? "Dark" : "White";
  const extCap = e === "png" ? "Png" : e === "svg" ? "Svg" : "Pdf";
  return `${s === "front" ? "front" : "back"}${toneCap}${extCap}` as DesignSideAwareFileKind;
}

/** Firebase Storage path under `designs/{designId}/…` (no leading slash). */
export function designUploadStorageFolder(kind: DesignFileKind): string {
  const m: Record<DesignFileKind, string> = {
    frontLightPng: "png/front/light",
    frontDarkPng: "png/front/dark",
    frontWhitePng: "png/front/white",
    backLightPng: "png/back/light",
    backDarkPng: "png/back/dark",
    backWhitePng: "png/back/white",
    frontLightSvg: "svg/front/light",
    frontDarkSvg: "svg/front/dark",
    frontWhiteSvg: "svg/front/white",
    backLightSvg: "svg/back/light",
    backDarkSvg: "svg/back/dark",
    backWhiteSvg: "svg/back/white",
    frontLightPdf: "pdf/front/light",
    frontDarkPdf: "pdf/front/dark",
    frontWhitePdf: "pdf/front/white",
    backLightPdf: "pdf/back/light",
    backDarkPdf: "pdf/back/dark",
    backWhitePdf: "pdf/back/white",
    png: "png/legacy",
    lightPng: "png/light",
    darkPng: "png/dark",
    whitePng: "png/white",
    svg: "svg/legacy",
    lightSvg: "svg/light",
    darkSvg: "svg/dark",
    whiteSvg: "svg/white",
    pdf: "pdf/legacy",
    lightPdf: "pdf/light",
    darkPdf: "pdf/dark",
    whitePdf: "pdf/white",
  };
  return m[kind];
}

export function designUploadStoragePath(designId: string, kind: DesignFileKind, fileName: string): string {
  return `designs/${designId}/${designUploadStorageFolder(kind)}/${fileName}`;
}
