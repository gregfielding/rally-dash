/**
 * Parse `renderSelectionLog` lines from `generateProductFlatRenders` / flat MVP for admin QA.
 */

export type RenderTargetTuningLogEntry = {
  tag?: string;
  renderTarget: string;
  placement: { x: number; y: number; scale: number };
  blend: { fabricFeel: number; printStrength: number; mode?: string | null };
  warp?: {
    enabled?: boolean;
    warpStrength?: number;
    verticalStretch?: number;
    horizontalWarp?: number;
  } | null;
  mask?: {
    enabled?: boolean;
    feather?: number;
    edgeFade?: number;
  } | null;
  blankTuningExisted?: boolean;
  variantTargetOverrideExisted?: boolean;
  productPlacementApplied?: boolean;
  engineBlend?: { blendMode: string; blendOpacity: number; source?: string };
};

export function parseRenderTargetTuningFromSelectionLog(
  lines: string[] | null | undefined
): Partial<Record<"flat_back" | "model_back", RenderTargetTuningLogEntry>> {
  const out: Partial<Record<"flat_back" | "model_back", RenderTargetTuningLogEntry>> = {};
  for (const line of lines || []) {
    const t = String(line).trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as RenderTargetTuningLogEntry & { tag?: string };
      if (o.tag !== "render_target_tuning_resolved") continue;
      if (o.renderTarget === "flat_back" || o.renderTarget === "model_back") {
        out[o.renderTarget] = o;
      }
    } catch {
      /* ignore non-JSON lines */
    }
  }
  return out;
}
