import type { DesignDoc, RPBlank, RPBlankDefaultPrintSides } from "@/lib/types/firestore";
import { inferDefaultPrintSides } from "@/lib/blanks/defaultPrintSides";
import { getDesignPrintSidesMode, type DesignPrintSidesMode } from "@/lib/designs/designHelpers";

/** Artwork inventory mode (from `supportedSides` + asset derivation). */
export type DesignArtworkSidesMode = "front_only" | "back_only" | "both";

export function designPrintModeToArtworkMode(m: DesignPrintSidesMode): DesignArtworkSidesMode {
  if (m === "front") return "front_only";
  if (m === "back") return "back_only";
  return "both";
}

/** Artwork availability for a design (not garment placement). */
export function getDesignArtworkSidesMode(design: DesignDoc | null | undefined): DesignArtworkSidesMode {
  return designPrintModeToArtworkMode(getDesignPrintSidesMode(design));
}

function modeToSides(m: RPBlankDefaultPrintSides | DesignArtworkSidesMode): Set<"front" | "back"> {
  if (m === "front_only") return new Set(["front"]);
  if (m === "back_only") return new Set(["back"]);
  return new Set(["front", "back"]);
}

export type PrintSidesResolution = {
  blankMode: RPBlankDefaultPrintSides;
  designMode: DesignArtworkSidesMode;
  /** Empty intersection: cannot place this design on this blank without changing blank or design. */
  conflict: "none" | "hard";
  canGenerate: boolean;
  /** Which sides get design compositing after intersection. */
  effectiveFront: boolean;
  effectiveBack: boolean;
  /** Default UI / mock view when multiple sides remain. */
  primaryPlacementSide: "front" | "back";
  blockMessage?: string;
};

/**
 * Garment default (`blank.defaultPrintSides`) ∩ artwork availability (`design` supportedSides / assets).
 */
export function resolvePrintSidesForProduct(
  blank: RPBlank | null | undefined,
  design: DesignDoc | null | undefined
): PrintSidesResolution {
  const blankMode = inferDefaultPrintSides(blank);
  const designMode = getDesignArtworkSidesMode(design);
  const bs = modeToSides(blankMode);
  const ds = modeToSides(designMode);
  const intersection = new Set<"front" | "back">();
  for (const s of ds) {
    if (bs.has(s)) intersection.add(s);
  }

  const conflict = intersection.size === 0 ? "hard" : "none";
  const canGenerate = intersection.size > 0;

  let blockMessage: string | undefined;
  if (conflict === "hard") {
    blockMessage = `This blank defaults to ${describeBlankMode(
      blankMode
    )} print, but the design only has ${describeDesignMode(
      designMode
    )} artwork. Adjust the blank’s default print sides, add artwork, or pick another design.`;
  }

  let effectiveFront = intersection.has("front");
  let effectiveBack = intersection.has("back");

  const viewConstrained = applyBlankSupportedRenderViews(blank, {
    effectiveFront,
    effectiveBack,
    conflict,
    canGenerate,
    blockMessage,
  });
  effectiveFront = viewConstrained.effectiveFront;
  effectiveBack = viewConstrained.effectiveBack;

  let primaryPlacementSide: "front" | "back" = "front";
  if (effectiveBack && !effectiveFront) primaryPlacementSide = "back";
  else if (effectiveFront && !effectiveBack) primaryPlacementSide = "front";
  else if (effectiveFront && effectiveBack) {
    const gv = blank?.generationDefaults?.primaryView;
    if (gv === "back") primaryPlacementSide = "back";
    else primaryPlacementSide = "front";
  }

  return {
    blankMode,
    designMode,
    conflict: viewConstrained.conflict,
    canGenerate: viewConstrained.canGenerate,
    effectiveFront,
    effectiveBack,
    primaryPlacementSide,
    blockMessage: viewConstrained.blockMessage ?? blockMessage,
  };
}

/**
 * Intersect commerce print sides with `rp_blanks.supportedRenderViews` when set (blank render profile / editor).
 */
export function applyBlankSupportedRenderViews(
  blank: RPBlank | null | undefined,
  partial: {
    effectiveFront: boolean;
    effectiveBack: boolean;
    conflict: "none" | "hard";
    canGenerate: boolean;
    blockMessage?: string;
  }
): {
  effectiveFront: boolean;
  effectiveBack: boolean;
  conflict: "none" | "hard";
  canGenerate: boolean;
  blockMessage?: string;
} {
  const raw = blank?.supportedRenderViews;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ...partial };
  }
  const allowed = new Set(raw.filter((x): x is "front" | "back" => x === "front" || x === "back"));
  if (allowed.size === 0) {
    return { ...partial };
  }

  const effectiveFront = partial.effectiveFront && allowed.has("front");
  const effectiveBack = partial.effectiveBack && allowed.has("back");

  if (effectiveFront || effectiveBack) {
    return {
      effectiveFront,
      effectiveBack,
      conflict: partial.conflict,
      canGenerate: partial.canGenerate,
      blockMessage: partial.blockMessage,
    };
  }

  return {
    effectiveFront: false,
    effectiveBack: false,
    conflict: "hard",
    canGenerate: false,
    blockMessage:
      partial.blockMessage ||
      "This blank’s supportedRenderViews do not include any side that matches the current design × default print intersection.",
  };
}

function describeBlankMode(m: RPBlankDefaultPrintSides): string {
  if (m === "front_only") return "front-only";
  if (m === "back_only") return "back-only";
  return "front and back";
}

function describeDesignMode(m: DesignArtworkSidesMode): string {
  if (m === "front_only") return "front-only";
  if (m === "back_only") return "back-only";
  return "front and back";
}
