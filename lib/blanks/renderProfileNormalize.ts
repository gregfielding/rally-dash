/**
 * Read-path normalization for `RPBlank.renderProfile` (per-render-target tuning).
 * Canonical zone geometry stays on `RPBlank.placements[]`.
 */

import type {
  RPBlankRenderProfile,
  RpBlendSettings,
  RpMaskSettings,
  RpPlacementSettings,
  RpRenderTarget,
  RpRenderTargetSettings,
  RpWarpSettings,
} from "@/lib/types/firestore";

const RENDER_TARGETS: readonly RpRenderTarget[] = [
  "flat_front",
  "flat_back",
  "model_front",
  "model_back",
];

const BLEND_MODES = new Set<RpBlendSettings["mode"]>(["clean", "soft", "vintage", "bold"]);

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  return undefined;
}

function normalizePlacement(o: unknown): RpPlacementSettings | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const scale = num(r.scale);
  const x = num(r.x);
  const y = num(r.y);
  if (scale === null || x === null || y === null) return null;
  const safeArea = bool(r.safeArea);
  return safeArea === undefined ? { scale, x, y } : { scale, x, y, safeArea };
}

function normalizeBlend(o: unknown): RpBlendSettings | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const fabricFeel = num(r.fabricFeel);
  const printStrength = num(r.printStrength);
  if (fabricFeel === null || printStrength === null) return null;
  const modeRaw = r.mode;
  const mode =
    typeof modeRaw === "string" && BLEND_MODES.has(modeRaw as RpBlendSettings["mode"])
      ? (modeRaw as RpBlendSettings["mode"])
      : undefined;
  return mode !== undefined ? { fabricFeel, printStrength, mode } : { fabricFeel, printStrength };
}

function normalizeWarp(o: unknown): RpWarpSettings | undefined {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  if (r.enabled !== true && r.enabled !== false) return undefined;
  const enabled = r.enabled;
  const warpStrength = num(r.warpStrength);
  const verticalStretch = num(r.verticalStretch);
  const horizontalWarp = num(r.horizontalWarp);
  const out: RpWarpSettings = { enabled };
  if (warpStrength !== null) out.warpStrength = warpStrength;
  if (verticalStretch !== null) out.verticalStretch = verticalStretch;
  if (horizontalWarp !== null) out.horizontalWarp = horizontalWarp;
  return out;
}

function normalizeMask(o: unknown): RpMaskSettings | undefined {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  if (r.enabled !== true && r.enabled !== false) return undefined;
  const enabled = r.enabled;
  const feather = num(r.feather);
  const edgeFade = num(r.edgeFade);
  const out: RpMaskSettings = { enabled };
  if (feather !== null) out.feather = feather;
  if (edgeFade !== null) out.edgeFade = edgeFade;
  return out;
}

function normalizeTargetSettings(o: unknown): RpRenderTargetSettings | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const placement = normalizePlacement(r.placement);
  const blend = normalizeBlend(r.blend);
  if (!placement || !blend) return null;
  const warp = normalizeWarp(r.warp);
  const mask = normalizeMask(r.mask);
  const out: RpRenderTargetSettings = { placement, blend };
  if (warp) out.warp = warp;
  if (mask) out.mask = mask;
  return out;
}

/**
 * Returns `null` when absent, invalid, or empty after normalization.
 */
export function normalizeRPBlankRenderProfile(input: unknown): RPBlankRenderProfile | null {
  if (input == null) return null;
  if (typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  const rtRaw = root.renderTargets;
  if (rtRaw == null || typeof rtRaw !== "object") return null;

  const renderTargets: Partial<Record<RpRenderTarget, RpRenderTargetSettings>> = {};
  for (const key of RENDER_TARGETS) {
    const slice = normalizeTargetSettings((rtRaw as Record<string, unknown>)[key]);
    if (slice) renderTargets[key] = slice;
  }
  if (Object.keys(renderTargets).length === 0) return null;
  return { renderTargets };
}
