/**
 * UX-facing "Render Style" presets → stored placement fields (8394: simpleRenderControls8394; other: renderZoneDefaults).
 * Values are tuned to approximate the product brief; exact blend pairs follow derivePlacementEngineFields8394 for 8394.
 */

export type RenderStylePresetId = "clean" | "soft_print" | "vintage_fade" | "bold_print";

export const RENDER_STYLE_PRESET_ORDER: RenderStylePresetId[] = [
  "clean",
  "soft_print",
  "vintage_fade",
  "bold_print",
];

export const RENDER_STYLE_PRESET_LABELS: Record<RenderStylePresetId, string> = {
  clean: "Clean",
  soft_print: "Soft Print",
  vintage_fade: "Vintage Fade",
  bold_print: "Bold Print",
};

/** Target feel → 8394 simple controls (realism / ink). */
export const RENDER_STYLE_TO_SIMPLE_8394: Record<
  RenderStylePresetId,
  { realism: number; inkStrength: number }
> = {
  clean: { realism: 16, inkStrength: 99 },
  soft_print: { realism: 40, inkStrength: 94 },
  vintage_fade: { realism: 60, inkStrength: 77 },
  bold_print: { realism: 22, inkStrength: 100 },
};

/** Non-8394: direct zone blend (matches dashboard brief). */
export const RENDER_STYLE_TO_ZONE_BLEND: Record<
  RenderStylePresetId,
  { blendMode: string; blendOpacity: number }
> = {
  clean: { blendMode: "normal", blendOpacity: 1 },
  soft_print: { blendMode: "multiply", blendOpacity: 0.85 },
  vintage_fade: { blendMode: "multiply", blendOpacity: 0.7 },
  bold_print: { blendMode: "overlay", blendOpacity: 0.95 },
};

const EPS_OP = 0.06;
const EPS_REALISM = 5;
const EPS_INK = 7;

export function matchRenderStylePreset8394(realism: number, inkStrength: number): RenderStylePresetId | "custom" {
  for (const id of RENDER_STYLE_PRESET_ORDER) {
    const t = RENDER_STYLE_TO_SIMPLE_8394[id];
    if (Math.abs(realism - t.realism) <= EPS_REALISM && Math.abs(inkStrength - t.inkStrength) <= EPS_INK) {
      return id;
    }
  }
  return "custom";
}

export function matchRenderStylePresetZone(
  blendMode: string | null | undefined,
  blendOpacity: number | null | undefined
): RenderStylePresetId | "custom" {
  const mode = String(blendMode || "").toLowerCase();
  const op = typeof blendOpacity === "number" && Number.isFinite(blendOpacity) ? blendOpacity : 1;
  for (const id of RENDER_STYLE_PRESET_ORDER) {
    const t = RENDER_STYLE_TO_ZONE_BLEND[id];
    if (mode === t.blendMode.toLowerCase() && Math.abs(op - t.blendOpacity) <= EPS_OP) return id;
  }
  return "custom";
}
