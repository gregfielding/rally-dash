/**
 * Map design file kinds to human labels and asset coverage keys.
 */

import type { DesignFileKind } from "@/lib/designs/designAssetKinds";

export const COVERAGE_KEYS = [
  "hasLightPng",
  "hasDarkPng",
  "hasWhitePng",
  "hasLightSvg",
  "hasDarkSvg",
  "hasWhiteSvg",
  "hasLightPdf",
  "hasDarkPdf",
  "hasWhitePdf",
] as const;

export type AssetCoverageKey = (typeof COVERAGE_KEYS)[number];

const KIND_TO_COVERAGE: Partial<Record<DesignFileKind, AssetCoverageKey>> = {
  lightPng: "hasLightPng",
  darkPng: "hasDarkPng",
  whitePng: "hasWhitePng",
  lightSvg: "hasLightSvg",
  darkSvg: "hasDarkSvg",
  whiteSvg: "hasWhiteSvg",
  lightPdf: "hasLightPdf",
  darkPdf: "hasDarkPdf",
  whitePdf: "hasWhitePdf",
  frontLightPng: "hasLightPng",
  frontDarkPng: "hasDarkPng",
  frontWhitePng: "hasWhitePng",
  backLightPng: "hasLightPng",
  backDarkPng: "hasDarkPng",
  backWhitePng: "hasWhitePng",
  frontLightSvg: "hasLightSvg",
  frontDarkSvg: "hasDarkSvg",
  frontWhiteSvg: "hasWhiteSvg",
  backLightSvg: "hasLightSvg",
  backDarkSvg: "hasDarkSvg",
  backWhiteSvg: "hasWhiteSvg",
  frontLightPdf: "hasLightPdf",
  frontDarkPdf: "hasDarkPdf",
  frontWhitePdf: "hasWhitePdf",
  backLightPdf: "hasLightPdf",
  backDarkPdf: "hasDarkPdf",
  backWhitePdf: "hasWhitePdf",
};

export function emptyCoverage(): Record<AssetCoverageKey, boolean> {
  return {
    hasLightPng: false,
    hasDarkPng: false,
    hasWhitePng: false,
    hasLightSvg: false,
    hasDarkSvg: false,
    hasWhiteSvg: false,
    hasLightPdf: false,
    hasDarkPdf: false,
    hasWhitePdf: false,
  };
}

export function coverageFromKind(kind: DesignFileKind): AssetCoverageKey | null {
  return KIND_TO_COVERAGE[kind] ?? null;
}

export function hasAnyPng(c: Record<AssetCoverageKey, boolean>): boolean {
  return c.hasLightPng || c.hasDarkPng || c.hasWhitePng;
}
