/**
 * Master-blank (per-color) readiness for 8394 render pipeline — QA / visibility only.
 * Uses variant source slots + blank placement rows (no product doc required).
 */

import type { RPBlank, RPBlankVariant } from "@/lib/types/firestore";
import {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
} from "@/lib/blanks/variantRenderSources";
import {
  getPlacementRowForSide,
  resolvePlacementKeyForRenderTarget,
} from "@/lib/products/resolveProductRenderProfile";

export type VariantRenderReady8394ChecklistItem = {
  id: "flat_front" | "flat_back" | "model_back" | "flat_placement" | "model_placement";
  label: string;
  ok: boolean;
};

export type VariantRenderReady8394Result = {
  ready: boolean;
  /** Short label for badges (first issue or Ready). */
  label: string;
  /** Human-readable issues in stable order. */
  issues: string[];
  /** Per-row QA checklist (same rules as `issues`, exposed for UI). */
  checklist: VariantRenderReady8394ChecklistItem[];
};

const ISSUE_ORDER = [
  "Missing flat front",
  "Missing flat back",
  "Missing model back",
  "Missing flat placement",
  "Missing model placement",
] as const;

/**
 * True when this color line has flat + model sources and back placements resolve on the master blank.
 */
export function isVariantRenderReady8394(blank: RPBlank, variant: RPBlankVariant): boolean {
  return getVariantRenderReady8394(blank, variant).ready;
}

export function getVariantRenderReady8394(blank: RPBlank, variant: RPBlankVariant): VariantRenderReady8394Result {
  const issues: string[] = [];

  const hasFlatFront = !!getVariantFlatFrontUrl(blank, variant)?.trim();
  const hasFlatBack = !!getVariantFlatBackUrl(blank, variant)?.trim();
  const hasModelBack = !!getVariantModelBackUrl(blank, variant)?.trim();

  if (!hasFlatFront) issues.push("Missing flat front");
  if (!hasFlatBack) issues.push("Missing flat back");
  if (!hasModelBack) issues.push("Missing model back");

  const pkFlat = resolvePlacementKeyForRenderTarget(null, variant, "flat_back");
  const rowFlat = getPlacementRowForSide(blank, "back", pkFlat);
  const hasFlatPlacement = !!rowFlat;
  if (!hasFlatPlacement) issues.push("Missing flat placement");

  let hasModelPlacement = true;
  if (hasModelBack) {
    const pkModel = resolvePlacementKeyForRenderTarget(null, variant, "model_back");
    const rowModel = getPlacementRowForSide(blank, "back", pkModel);
    hasModelPlacement = !!rowModel;
    if (!hasModelPlacement) issues.push("Missing model placement");
  }

  const checklist: VariantRenderReady8394ChecklistItem[] = [
    { id: "flat_front", label: "Flat Front", ok: hasFlatFront },
    { id: "flat_back", label: "Flat Back", ok: hasFlatBack },
    { id: "model_back", label: "Model Back", ok: hasModelBack },
    { id: "flat_placement", label: "Flat Back Placement", ok: hasFlatPlacement },
    { id: "model_placement", label: "Model Back Placement", ok: hasModelPlacement },
  ];

  const ordered = ISSUE_ORDER.filter((m) => issues.includes(m));
  const ready = ordered.length === 0;
  return {
    ready,
    issues: ordered,
    label: ready ? "Ready" : ordered[0] ?? "Not ready",
    checklist,
  };
}
