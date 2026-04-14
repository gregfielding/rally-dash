"use client";

import { useMemo } from "react";
import type { RPPlacement, RpRenderTarget, RpRenderTargetSettings } from "@/lib/types/firestore";
import { get8394EngineQaMetrics } from "@/lib/blanks";
import { DESIGN_ARTBOARD_HEIGHT_PX, DESIGN_ARTBOARD_WIDTH_PX } from "@/lib/render/designArtboardSpec";
import { RENDER_TARGET_LABELS } from "@/lib/render/renderTargetTuning";
import {
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
} from "@/lib/products/resolveProductRenderProfile";

const SCALE_PCT_MIN = 0;
const SCALE_PCT_MAX = 150;
const SCALE_ENGINE_MIN = 0.08;
const SCALE_ENGINE_MAX = 1.35;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function scalePercentFromEngine(s: number): number {
  const x = clamp(s, SCALE_ENGINE_MIN, SCALE_ENGINE_MAX);
  return Math.round(((x - SCALE_ENGINE_MIN) / (SCALE_ENGINE_MAX - SCALE_ENGINE_MIN)) * SCALE_PCT_MAX);
}

function scaleEngineFromPercent(pct: number): number {
  const t = clamp(pct, SCALE_PCT_MIN, SCALE_PCT_MAX) / SCALE_PCT_MAX;
  return SCALE_ENGINE_MIN + t * (SCALE_ENGINE_MAX - SCALE_ENGINE_MIN);
}

type ProfileRowLike = RPPlacement & {
  defaultX: number;
  defaultY: number;
  defaultScale: number;
};

export type TargetTuning8394PanelProps = {
  tuning: RpRenderTargetSettings;
  patchTargetTuning: (patch: Partial<RpRenderTargetSettings>) => void;
  selected: ProfileRowLike | undefined;
  selectedRenderTarget: RpRenderTarget;
  resolvedTargetForEngine: ReturnType<typeof resolveEffectiveRenderTargetSettings>;
  engineBlendResolved: ReturnType<typeof resolveEngineBlendForRenderTarget>;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  artBase: number;
  showSafeArea: boolean;
  setShowSafeArea: (v: boolean) => void;
  showClipHint: boolean;
  setShowClipHint: (v: boolean) => void;
  is8394SimpleBackUi: boolean;
  /** Placement row updates — same contract as the main editor `updateSelected`. */
  updateSelected: (patch: {
    defaultX?: number;
    defaultY?: number;
    defaultScale?: number;
    artboardBase?: number;
    safeArea?: Partial<{ x: number; y: number; w: number; h: number }>;
    renderZoneDefaults?: RPPlacement["renderZoneDefaults"] | null;
    label?: string;
    view?: "front" | "back";
    allowedDesignAssetMode?: RPPlacement["allowedDesignAssetMode"];
    maskConfig?: Partial<NonNullable<RPPlacement["maskConfig"]>>;
    artboardNotes?: string;
    notes?: string;
  }) => void;
  /** Browser preview pipeline readout (matches dashboard canvas, not 1:1 Sharp). */
  previewQa8394?: {
    previewResolvedBlendMode: string;
    previewBaseLayerOpacity: number;
    previewAdjustedForGarmentArt: boolean;
    finalOverlayOpacity: number;
    contrastPercent: number;
    saturatePercent: number;
    inkMultiplier: number;
    engineResolvedBlendMode: string;
    engineResolvedBlendOpacity: number;
    warpEnabled: boolean;
    warpStrength: number;
    verticalStretch: number;
    horizontalWarp: number;
    maskEnabled: boolean;
    edgeFade: number;
    feather: number;
  } | null;
};

/**
 * Simplified 8394 target tuning: four groups by default, everything else under Advanced.
 */
export function TargetTuning8394Panel(props: TargetTuning8394PanelProps) {
  const {
    tuning,
    patchTargetTuning,
    selected,
    selectedRenderTarget,
    resolvedTargetForEngine,
    engineBlendResolved,
    sx,
    sy,
    sw,
    sh,
    artBase,
    showSafeArea,
    setShowSafeArea,
    showClipHint,
    setShowClipHint,
    is8394SimpleBackUi,
    updateSelected,
    previewQa8394,
  } = props;

  const engineQa8394 = useMemo(
    () =>
      is8394SimpleBackUi
        ? get8394EngineQaMetrics(tuning.blend.fabricFeel, tuning.blend.printStrength)
        : null,
    [is8394SimpleBackUi, tuning.blend.fabricFeel, tuning.blend.printStrength]
  );

  return (
    <>
      <div className="space-y-5 pt-2 border-t border-violet-200/80">
        <p className="text-[11px] text-neutral-500 leading-snug -mt-1 mb-1">
          These controls directly tune the selected render target. Presets below are optional shortcuts only.
        </p>
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Position</h3>
          <p className="text-[11px] text-neutral-500 mb-2">
            Drag the preview to fine-tune. Sliders apply to <strong>{RENDER_TARGET_LABELS[selectedRenderTarget]}</strong>{" "}
            only.
          </p>
          <div>
            <div className="flex justify-between text-xs text-neutral-600 mb-1">
              <span className="font-medium text-neutral-800">Scale</span>
              <span>{scalePercentFromEngine(tuning.placement.scale)}%</span>
            </div>
            <input
              type="range"
              min={SCALE_PCT_MIN}
              max={SCALE_PCT_MAX}
              step={1}
              value={scalePercentFromEngine(tuning.placement.scale)}
              onChange={(e) =>
                patchTargetTuning({
                  placement: {
                    ...tuning.placement,
                    scale: scaleEngineFromPercent(Number(e.target.value)),
                  },
                })
              }
              className="w-full accent-violet-600"
            />
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-neutral-600 mb-1">
              <span className="font-medium text-neutral-800">Horizontal</span>
              <span>{Math.round(tuning.placement.x * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(tuning.placement.x * 100)}
              onChange={(e) =>
                patchTargetTuning({
                  placement: {
                    ...tuning.placement,
                    x: Number(e.target.value) / 100,
                  },
                })
              }
              className="w-full accent-violet-600"
            />
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-neutral-600 mb-1">
              <span className="font-medium text-neutral-800">Vertical</span>
              <span>{Math.round(tuning.placement.y * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(tuning.placement.y * 100)}
              onChange={(e) =>
                patchTargetTuning({
                  placement: {
                    ...tuning.placement,
                    y: Number(e.target.value) / 100,
                  },
                })
              }
              className="w-full accent-violet-600"
            />
          </div>
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Realism</h3>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="flex justify-between text-xs text-neutral-600 mb-1">
                <span className="font-medium text-neutral-800">Fabric feel</span>
                <span>{Math.round(tuning.blend.fabricFeel * 100)}%</span>
              </div>
              <p className="text-[10px] text-neutral-400 mb-1.5 leading-snug">
                How much ink settles into the fabric
              </p>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(tuning.blend.fabricFeel * 100)}
                onChange={(e) =>
                  patchTargetTuning({
                    blend: { ...tuning.blend, fabricFeel: Number(e.target.value) / 100 },
                  })
                }
                className="w-full accent-violet-600"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-neutral-600 mb-1">
                <span className="font-medium text-neutral-800">Print strength</span>
                <span>{Math.round(tuning.blend.printStrength * 100)}%</span>
              </div>
              <p className="text-[10px] text-neutral-400 mb-1.5 leading-snug">
                Controls print boldness and readability
              </p>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(tuning.blend.printStrength * 100)}
                onChange={(e) =>
                  patchTargetTuning({
                    blend: { ...tuning.blend, printStrength: Number(e.target.value) / 100 },
                  })
                }
                className="w-full accent-violet-600"
              />
            </div>
          </div>
        </div>

        {engineQa8394 ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-900 mb-1.5">
              8394 engine QA (resolved)
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-neutral-900">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Realism (0–100)</dt>
                <dd>{engineQa8394.realism0to100}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Ink strength (0–100)</dt>
                <dd>{engineQa8394.inkStrength0to100}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Effective blend opacity</dt>
                <dd>{engineQa8394.effectiveBlendOpacity.toFixed(3)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Effective ink multiplier</dt>
                <dd>{engineQa8394.effectiveInkMultiplier.toFixed(3)}</dd>
              </div>
            </dl>
            <p className="text-[9px] text-neutral-500 mt-1.5 font-sans leading-snug">
              Layer blend mode <span className="font-mono">{engineQa8394.blendMode}</span> (compositor / Sharp curve — not
              the browser preview curve).
            </p>
          </div>
        ) : null}

        {previewQa8394 ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-950 mb-1.5">
              8394 preview QA (browser canvas)
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-neutral-900">
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt className="text-neutral-600 font-sans">Resolved preview mix-blend mode</dt>
                <dd>{previewQa8394.previewResolvedBlendMode}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Base layer opacity</dt>
                <dd>{previewQa8394.previewBaseLayerOpacity.toFixed(3)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Final overlay opacity</dt>
                <dd>{previewQa8394.finalOverlayOpacity.toFixed(3)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Contrast %</dt>
                <dd>{previewQa8394.contrastPercent}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Saturate %</dt>
                <dd>{previewQa8394.saturatePercent}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Ink multiplier</dt>
                <dd>{previewQa8394.inkMultiplier.toFixed(3)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Engine blend mode</dt>
                <dd>{previewQa8394.engineResolvedBlendMode}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Engine blend opacity</dt>
                <dd>{previewQa8394.engineResolvedBlendOpacity.toFixed(3)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Garment×art preview adjust</dt>
                <dd>{previewQa8394.previewAdjustedForGarmentArt ? "yes" : "no"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Warp on</dt>
                <dd>{previewQa8394.warpEnabled ? "yes" : "no"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Warp strength</dt>
                <dd>{previewQa8394.warpStrength}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Vertical stretch</dt>
                <dd>{previewQa8394.verticalStretch}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Horizontal warp</dt>
                <dd>{previewQa8394.horizontalWarp}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Mask on</dt>
                <dd>{previewQa8394.maskEnabled ? "yes" : "no"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Edge fade</dt>
                <dd>{previewQa8394.edgeFade}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600 font-sans">Feather</dt>
                <dd>{previewQa8394.feather}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Shape to body</h3>
          <label className="flex items-center gap-2 text-sm text-neutral-800 mb-2">
            <input
              type="checkbox"
              checked={tuning.warp?.enabled === true}
              onChange={(e) =>
                patchTargetTuning({
                  warp: { ...(tuning.warp ?? { enabled: false }), enabled: e.target.checked },
                })
              }
            />
            Enabled
          </label>
          <label className="flex flex-col gap-0.5 text-xs max-w-xs">
            <span className="text-neutral-600">Warp strength</span>
            <input
              type="number"
              step={0.01}
              value={tuning.warp?.warpStrength ?? 0}
              onChange={(e) =>
                patchTargetTuning({
                  warp: {
                    ...(tuning.warp ?? { enabled: false }),
                    warpStrength: Number(e.target.value),
                  },
                })
              }
              className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
            />
          </label>
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600 mb-2">Edge blending</h3>
          <label className="flex items-center gap-2 text-sm text-neutral-800 mb-2">
            <input
              type="checkbox"
              checked={tuning.mask?.enabled === true}
              onChange={(e) =>
                patchTargetTuning({
                  mask: { ...(tuning.mask ?? { enabled: false }), enabled: e.target.checked },
                })
              }
            />
            Enabled
          </label>
          <label className="flex flex-col gap-0.5 text-xs max-w-xs">
            <span className="text-neutral-600">Edge fade</span>
            <input
              type="number"
              step={0.01}
              value={tuning.mask?.edgeFade ?? 0}
              onChange={(e) =>
                patchTargetTuning({
                  mask: {
                    ...(tuning.mask ?? { enabled: false }),
                    edgeFade: Number(e.target.value),
                  },
                })
              }
              className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
            />
          </label>
        </div>

        <div className="pt-3 border-t border-violet-200/80 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Preview</p>
          <label className="flex items-center gap-2 text-sm text-neutral-800">
            <input type="checkbox" checked={showSafeArea} onChange={(e) => setShowSafeArea(e.target.checked)} />
            Show safe print area overlay
          </label>
          {!is8394SimpleBackUi ? (
            <label className="flex items-center gap-2 text-sm text-neutral-800">
              <input type="checkbox" checked={showClipHint} onChange={(e) => setShowClipHint(e.target.checked)} />
              Clip boundary hint
            </label>
          ) : null}
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-violet-300/80 bg-white/70 p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-violet-900 py-1 select-none">
          Advanced
        </summary>
        <div className="mt-3 space-y-5 text-neutral-800">
          {selected ? (
            <div className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 px-3 py-2.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-emerald-900 mb-1">
                Resolved target tuning (read-only QA)
              </h3>
              <p className="text-[10px] text-emerald-900/85 mb-2 leading-snug">
                Effective values for <strong>{RENDER_TARGET_LABELS[selectedRenderTarget]}</strong> with the preview
                variant (no product overrides). Matches the compositor merge order for this blank.
              </p>
              <dl className="grid grid-cols-1 gap-1 font-mono text-[10px] text-gray-900">
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">placement.x</dt>
                  <dd>{resolvedTargetForEngine.settings.placement.x.toFixed(3)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">placement.y</dt>
                  <dd>{resolvedTargetForEngine.settings.placement.y.toFixed(3)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">placement.scale</dt>
                  <dd>{resolvedTargetForEngine.settings.placement.scale.toFixed(3)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">blend.fabricFeel</dt>
                  <dd>{resolvedTargetForEngine.settings.blend.fabricFeel.toFixed(3)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">blend.printStrength</dt>
                  <dd>{resolvedTargetForEngine.settings.blend.printStrength.toFixed(3)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">blend.mode</dt>
                  <dd className="text-right break-all">
                    {resolvedTargetForEngine.settings.blend.mode != null &&
                    String(resolvedTargetForEngine.settings.blend.mode).trim() !== ""
                      ? String(resolvedTargetForEngine.settings.blend.mode)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">engineBlend.blendMode</dt>
                  <dd>{engineBlendResolved.blendMode}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600 shrink-0">engineBlend.blendOpacity</dt>
                  <dd>{engineBlendResolved.blendOpacity.toFixed(3)}</dd>
                </div>
              </dl>
              <p className="text-[9px] text-emerald-900/70 mt-2 pt-2 border-t border-emerald-200/80 font-sans">
                Flags: blank target row{" "}
                {resolvedTargetForEngine.qa.blankTuningExisted ? "present" : "absent"} · variant target override{" "}
                {resolvedTargetForEngine.qa.variantTargetOverrideExisted ? "yes" : "no"} · product placement{" "}
                {resolvedTargetForEngine.qa.productPlacementApplied ? "applied" : "no"}
              </p>
            </div>
          ) : null}

          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 mb-2">Engine mode (optional)</h4>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Blend mode override</label>
            <select
              value={tuning.blend.mode ?? ""}
              onChange={(e) =>
                patchTargetTuning({
                  blend: {
                    ...tuning.blend,
                    mode:
                      e.target.value === ""
                        ? undefined
                        : (e.target.value as NonNullable<typeof tuning.blend.mode>),
                  },
                })
              }
              className="w-full border border-neutral-300 rounded-lg px-2 py-2 text-sm bg-white text-neutral-900"
            >
              <option value="">Engine curve (default)</option>
              <option value="clean">Clean</option>
              <option value="soft">Soft</option>
              <option value="vintage">Vintage</option>
              <option value="bold">Bold</option>
            </select>
          </div>

          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 mb-2">Shape to body — fine</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-0.5">
                <span className="text-neutral-600">Vertical stretch</span>
                <input
                  type="number"
                  step={0.01}
                  value={tuning.warp?.verticalStretch ?? 0}
                  onChange={(e) =>
                    patchTargetTuning({
                      warp: {
                        ...(tuning.warp ?? { enabled: false }),
                        verticalStretch: Number(e.target.value),
                      },
                    })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-neutral-600">Horizontal warp</span>
                <input
                  type="number"
                  step={0.01}
                  value={tuning.warp?.horizontalWarp ?? 0}
                  onChange={(e) =>
                    patchTargetTuning({
                      warp: {
                        ...(tuning.warp ?? { enabled: false }),
                        horizontalWarp: Number(e.target.value),
                      },
                    })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
                />
              </label>
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Preview does not warp the overlay yet; values persist.</p>
          </div>

          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 mb-2">Edge blending — feather</h4>
            <label className="flex flex-col gap-0.5 text-xs max-w-xs">
              <span className="text-neutral-600">Feather</span>
              <input
                type="number"
                step={0.01}
                value={tuning.mask?.feather ?? 0}
                onChange={(e) =>
                  patchTargetTuning({
                    mask: {
                      ...(tuning.mask ?? { enabled: false }),
                      feather: Number(e.target.value),
                    },
                  })
                }
                className="border border-neutral-300 rounded px-2 py-1 bg-white text-neutral-900"
              />
            </label>
            <p className="text-[10px] text-neutral-500 mt-1">Mask is not drawn on this canvas yet.</p>
          </div>

          <div className="border-t border-violet-200 pt-4">
            <p className="text-[11px] text-neutral-600 mb-3 leading-relaxed">
              <strong>Placement</strong> and <strong>Realism</strong> are edited in Target tuning above;{" "}
              <strong>Save</strong> copies{" "}
              <code className="text-[10px] bg-white/80 px-1 rounded">flat_back</code> /{" "}
              <code className="text-[10px] bg-white/80 px-1 rounded">flat_front</code> into the zone row for engines
              that read <code className="text-[10px] bg-white/80 px-1 rounded">placements[]</code>.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe X</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sx}
                  onChange={(e) => updateSelected({ safeArea: { x: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe Y</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sy}
                  onChange={(e) => updateSelected({ safeArea: { y: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe W</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sw}
                  onChange={(e) => updateSelected({ safeArea: { w: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Safe H</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={sh}
                  onChange={(e) => updateSelected({ safeArea: { h: Number(e.target.value) } })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 mt-3 max-w-xs">
              <span className="text-xs text-neutral-600">Artboard base (zone)</span>
              <input
                type="number"
                step={0.05}
                min={0.1}
                max={1}
                value={artBase}
                onChange={(e) => updateSelected({ artboardBase: Number(e.target.value) })}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
              />
            </label>
            <p className="text-[10px] text-neutral-500 mt-1">
              Artboard: {DESIGN_ARTBOARD_WIDTH_PX}×{DESIGN_ARTBOARD_HEIGHT_PX}px (8∶5). Safe overlay uses Safe W.
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Zone label</span>
                <input
                  value={selected?.label ?? ""}
                  onChange={(e) => updateSelected({ label: e.target.value })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Canonical view</span>
                <select
                  value={selected?.view ?? "front"}
                  onChange={(e) => updateSelected({ view: e.target.value as "front" | "back" })}
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                >
                  <option value="front">Front</option>
                  <option value="back">Back</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">Design asset mode</span>
                <select
                  value={selected?.allowedDesignAssetMode ?? "light_dark"}
                  onChange={(e) =>
                    updateSelected({
                      allowedDesignAssetMode: e.target.value as RPPlacement["allowedDesignAssetMode"],
                    })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                >
                  <option value="light_dark">Light + dark PNG</option>
                  <option value="light_only">Light PNG only</option>
                  <option value="dark_only">Dark PNG only</option>
                </select>
              </label>
              {!is8394SimpleBackUi && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-600">Mask / clip strategy</span>
                  <select
                    value={selected?.maskConfig?.mode ?? "none"}
                    onChange={(e) => updateSelected({ maskConfig: { mode: e.target.value } })}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
                  >
                    <option value="none">None (MVP)</option>
                    <option value="blank_mask_doc">Use rp_blank_masks doc (future)</option>
                    <option value="safe_area_clip">Clip to safe area (future)</option>
                  </select>
                </label>
              )}
            </div>
            <label className="flex flex-col gap-1 mt-3">
              <span className="text-xs text-neutral-600">Artboard / export notes</span>
              <textarea
                value={selected?.artboardNotes ?? ""}
                onChange={(e) => updateSelected({ artboardNotes: e.target.value })}
                rows={2}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-1 mt-2">
              <span className="text-xs text-neutral-600">Zone notes</span>
              <textarea
                value={selected?.notes ?? ""}
                onChange={(e) => updateSelected({ notes: e.target.value })}
                rows={2}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white text-neutral-900"
              />
            </label>
          </div>
        </div>
      </details>
    </>
  );
}
