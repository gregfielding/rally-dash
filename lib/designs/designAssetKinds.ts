/**
 * Side-aware design file kinds for `updateDesignFile` / Storage.
 * Maps to Firestore: `files.{front|back}.{lightPng|darkPng|...}` and mirrored `assets.*`.
 */

export const DESIGN_SIDE_RASTER_KINDS = [
  "frontLightPng",
  "frontDarkPng",
  "backLightPng",
  "backDarkPng",
] as const;

export const DESIGN_SIDE_VECTOR_KINDS = [
  "frontLightSvg",
  "frontDarkSvg",
  "backLightSvg",
  "backDarkSvg",
] as const;

export const DESIGN_SIDE_PDF_KINDS = [
  "frontLightPdf",
  "frontDarkPdf",
  "backLightPdf",
  "backDarkPdf",
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
  | "svg"
  | "lightSvg"
  | "darkSvg"
  | "pdf"
  | "lightPdf"
  | "darkPdf";

export type DesignFileKind = DesignSideAwareFileKind | DesignLegacyFileKind;

type Side = "front" | "back";
type Slot = "lightPng" | "darkPng" | "lightSvg" | "darkSvg" | "lightPdf" | "darkPdf";

const KIND_TO_NESTED: Record<DesignSideAwareFileKind, { side: Side; slot: Slot }> = {
  frontLightPng: { side: "front", slot: "lightPng" },
  frontDarkPng: { side: "front", slot: "darkPng" },
  backLightPng: { side: "back", slot: "lightPng" },
  backDarkPng: { side: "back", slot: "darkPng" },
  frontLightSvg: { side: "front", slot: "lightSvg" },
  frontDarkSvg: { side: "front", slot: "darkSvg" },
  backLightSvg: { side: "back", slot: "lightSvg" },
  backDarkSvg: { side: "back", slot: "darkSvg" },
  frontLightPdf: { side: "front", slot: "lightPdf" },
  frontDarkPdf: { side: "front", slot: "darkPdf" },
  backLightPdf: { side: "back", slot: "lightPdf" },
  backDarkPdf: { side: "back", slot: "darkPdf" },
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
  if (t !== "light" && t !== "dark") {
    throw new Error(`Invalid garment tone: ${garmentTone}`);
  }
  const e = ext.toLowerCase();
  if (e !== "png" && e !== "svg" && e !== "pdf") {
    throw new Error(`Invalid extension: ${ext}`);
  }
  const toneCap = t === "light" ? "Light" : "Dark";
  const extCap = e === "png" ? "Png" : e === "svg" ? "Svg" : "Pdf";
  return `${s === "front" ? "front" : "back"}${toneCap}${extCap}` as DesignSideAwareFileKind;
}

/** Firebase Storage path under `designs/{designId}/…` (no leading slash). */
export function designUploadStorageFolder(kind: DesignFileKind): string {
  const m: Record<DesignFileKind, string> = {
    frontLightPng: "png/front/light",
    frontDarkPng: "png/front/dark",
    backLightPng: "png/back/light",
    backDarkPng: "png/back/dark",
    frontLightSvg: "svg/front/light",
    frontDarkSvg: "svg/front/dark",
    backLightSvg: "svg/back/light",
    backDarkSvg: "svg/back/dark",
    frontLightPdf: "pdf/front/light",
    frontDarkPdf: "pdf/front/dark",
    backLightPdf: "pdf/back/light",
    backDarkPdf: "pdf/back/dark",
    png: "png/legacy",
    lightPng: "png/light",
    darkPng: "png/dark",
    svg: "svg/legacy",
    lightSvg: "svg/light",
    darkSvg: "svg/dark",
    pdf: "pdf/legacy",
    lightPdf: "pdf/light",
    darkPdf: "pdf/dark",
  };
  return m[kind];
}

export function designUploadStoragePath(designId: string, kind: DesignFileKind, fileName: string): string {
  return `designs/${designId}/${designUploadStorageFolder(kind)}/${fileName}`;
}
