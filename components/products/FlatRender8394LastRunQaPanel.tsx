"use client";

import { useMemo } from "react";
import {
  buildOrdered8394OutputRows,
  type FlatRender8394UrlPayload,
} from "@/lib/products/flatRenderGenerationQa8394";
import { parseRenderTargetTuningFromSelectionLog } from "@/lib/products/renderTargetTuningQa";
import {
  resolveHeroBackSource8394,
  resolveHeroFrontSource8394,
  resolvePrimaryVariantImage8394ForShopify,
} from "@/lib/shopify/variantShopifyMedia";

type VariantQaShape = Parameters<typeof resolvePrimaryVariantImage8394ForShopify>[0];

/** Preview row from the product page (Images tab); extends media shape with stable ids for QA. */
export type FlatRender8394QaVariantPreview = VariantQaShape & {
  id?: string;
  blankVariantId?: string | null;
  colorName?: string | null;
  optionValues?: { color?: string | null; size?: string | null } | null;
};

export type FlatRender8394VariantQaSnapshot = {
  variantId: string | null;
  blankVariantId: string | null;
  colorName: string | null;
};

function fmt3(n: number | null | undefined) {
  if (n == null || typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

function fmtSnapshotLine(s: FlatRender8394VariantQaSnapshot | null | undefined) {
  if (!s) return "variant id — · blankVariantId — · color —";
  const id = s.variantId?.trim() || "—";
  const bid = s.blankVariantId?.trim() || "—";
  const color = s.colorName?.trim() || "—";
  return `variant id ${id} · blankVariantId ${bid} · color ${color}`;
}

function snapshotFromVariantPreview(
  v: FlatRender8394QaVariantPreview | null | undefined
): FlatRender8394VariantQaSnapshot | null {
  if (!v) return null;
  const variantId = v.id?.trim() || null;
  const blankVariantId =
    v.blankVariantId != null && String(v.blankVariantId).trim() !== ""
      ? String(v.blankVariantId).trim()
      : null;
  const colorRaw = v.colorName ?? v.optionValues?.color ?? null;
  const colorName = colorRaw != null && String(colorRaw).trim() !== "" ? String(colorRaw).trim() : null;
  if (!variantId && !blankVariantId && !colorName) return null;
  return { variantId, blankVariantId, colorName };
}

/** True when hero/featured preview doc is not the same variant row as the last generate call. */
function previewDiffersFromLastRun(
  run: FlatRender8394VariantQaSnapshot | null | undefined,
  preview: FlatRender8394VariantQaSnapshot | null
): boolean {
  if (!run || !preview) return false;
  const rid = run.variantId?.trim() || null;
  const pid = preview.variantId?.trim() || null;
  if (rid && pid) return rid !== pid;
  const rb = run.blankVariantId?.trim() || null;
  const pb = preview.blankVariantId?.trim() || null;
  if (rb && pb) return rb !== pb;
  return false;
}

export type LastFlatRender8394Payload = {
  urls: FlatRender8394UrlPayload | null;
  renderTypes: string[] | null;
  /** Captured when Generate was invoked (before the async request). */
  runVariantSnapshot?: FlatRender8394VariantQaSnapshot | null;
};

export function FlatRender8394LastRunQaPanel({
  lines,
  lastPayload,
  variant,
}: {
  lines: string[] | null | undefined;
  lastPayload: LastFlatRender8394Payload | null;
  variant: FlatRender8394QaVariantPreview | null | undefined;
}) {
  const rows = useMemo(
    () => buildOrdered8394OutputRows(lines, lastPayload?.urls ?? null, lastPayload?.renderTypes ?? null),
    [lines, lastPayload]
  );

  const tuning = useMemo(() => parseRenderTargetTuningFromSelectionLog(lines), [lines]);
  const modelBack = tuning.model_back;

  const heroBack = useMemo(() => resolveHeroBackSource8394(variant), [variant]);
  const heroFront = useMemo(() => resolveHeroFrontSource8394(variant), [variant]);
  const featured = useMemo(
    () => resolvePrimaryVariantImage8394ForShopify(variant),
    [variant]
  );

  const hasRunData = Boolean(lastPayload || (lines && lines.length > 0));

  const previewSnapshot = useMemo(() => snapshotFromVariantPreview(variant), [variant]);
  const runSnapshot = lastPayload?.runVariantSnapshot ?? null;
  const showVariantMismatchWarning = previewDiffersFromLastRun(runSnapshot, previewSnapshot);

  return (
    <div className="mb-4 space-y-3 text-xs text-indigo-950">
      {!hasRunData ? (
        <p className="text-xs text-indigo-800/70 rounded-lg border border-dashed border-indigo-200 bg-white/60 px-3 py-2">
          Generate previews once to see the ordered output set and model_back tuning from the last run. Hero / featured
          below reflect the current variant document.
        </p>
      ) : null}

      <div className="rounded-lg border border-indigo-200/90 bg-indigo-50/40 p-3 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-indigo-900 mb-2">Variant context (QA)</h3>
        <dl className="space-y-2 font-mono text-[10px] text-gray-900">
          <div>
            <dt className="text-gray-500 font-sans font-semibold">Last generation run</dt>
            <dd className="mt-0.5 break-words">{fmtSnapshotLine(runSnapshot)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 font-sans font-semibold">Images tab preview (current)</dt>
            <dd className="mt-0.5 break-words">{fmtSnapshotLine(previewSnapshot)}</dd>
          </div>
        </dl>
        {showVariantMismatchWarning ? (
          <p
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-950"
            role="status"
          >
            This QA panel is showing hero/featured state for a different preview variant than the last generation run.
          </p>
        ) : null}
      </div>

      {hasRunData ? (
        <div className="rounded-lg border border-indigo-300 bg-white/90 p-3 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-indigo-900 mb-2">
            Last run — generated set (8394 order)
          </h3>
          <ol className="list-decimal list-inside space-y-1.5 text-[11px]">
            {rows.map((r) => (
              <li key={r.id} className="marker:font-semibold">
                <span className="font-semibold">{r.title}</span>
                {r.produced ? (
                  <span className="text-emerald-800"> — produced</span>
                ) : (
                  <span className="text-amber-900">
                    {" "}
                    — missing
                    {!r.requestedInRun ? " (not in this run’s renderTypes)" : ""}
                  </span>
                )}
                {r.skipDetail ? (
                  <span className="block pl-5 text-amber-800/90 mt-0.5">Reason: {r.skipDetail}</span>
                ) : null}
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block pl-5 font-mono text-[10px] text-indigo-600 underline truncate max-w-full mt-0.5"
                  >
                    {r.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="rounded-lg border border-indigo-300 bg-white/90 p-3 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-indigo-900 mb-2">
          Hero &amp; Shopify featured (current variant doc)
        </h3>
        <p className="text-[10px] text-indigo-900/75 mb-2">
          Labels match how fields are written after generation and how{" "}
          <code className="bg-indigo-50 px-1 rounded">resolvePrimaryVariantImage8394ForShopify</code> chooses the
          featured candidate.
        </p>
        <dl className="grid grid-cols-1 gap-2 font-mono text-[10px]">
          <div>
            <dt className="text-gray-500 font-sans font-semibold">heroBack</dt>
            <dd className="text-gray-900 mt-0.5">{heroBack.label}</dd>
            {heroBack.url ? (
              <dd className="truncate text-indigo-600">
                <a href={heroBack.url} target="_blank" rel="noreferrer" className="underline">
                  {heroBack.url}
                </a>
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-gray-500 font-sans font-semibold">heroFront</dt>
            <dd className="text-gray-900 mt-0.5">{heroFront.label}</dd>
            {heroFront.url ? (
              <dd className="truncate text-indigo-600">
                <a href={heroFront.url} target="_blank" rel="noreferrer" className="underline">
                  {heroFront.url}
                </a>
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-gray-500 font-sans font-semibold">Shopify featured candidate (8394)</dt>
            <dd className="text-gray-900 mt-0.5 font-sans">
              <span className="font-mono">{featured.source}</span>
              {featured.role ? (
                <>
                  {" "}
                  · role <span className="font-mono">{featured.role}</span>
                </>
              ) : null}
              {featured.lookType ? (
                <>
                  {" "}
                  · lookType <span className="font-mono">{featured.lookType}</span>
                </>
              ) : null}
            </dd>
            {featured.url ? (
              <dd className="truncate text-indigo-600 mt-0.5">
                <a href={featured.url} target="_blank" rel="noreferrer" className="underline font-mono">
                  {featured.url}
                </a>
              </dd>
            ) : (
              <dd className="text-amber-800 mt-0.5 font-sans">No URL resolved</dd>
            )}
          </div>
        </dl>
      </div>

      {hasRunData ? (
        <div className="rounded-lg border border-emerald-300/90 bg-emerald-50/50 p-3 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-emerald-900 mb-2">
          model_back — resolved tuning (last log)
        </h3>
        {!modelBack ? (
          <p className="text-[11px] text-emerald-900/80">
            No <code className="bg-white/80 px-1 rounded">render_target_tuning_resolved</code> line for{" "}
            <strong>model_back</strong> in this run (target may have been skipped).
          </p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-gray-900">
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-gray-600">placement x / y / scale</dt>
              <dd>
                {fmt3(modelBack.placement?.x)} · {fmt3(modelBack.placement?.y)} · {fmt3(modelBack.placement?.scale)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-gray-600">engine blendMode / blendOpacity</dt>
              <dd>
                {modelBack.engineBlend?.blendMode ?? "—"} @ {fmt3(modelBack.engineBlend?.blendOpacity)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600">warp enabled</dt>
              <dd>{modelBack.warp?.enabled === true ? "yes" : "no"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600">warp strength / vStretch / hWarp</dt>
              <dd>
                {fmt3(modelBack.warp?.warpStrength)} · {fmt3(modelBack.warp?.verticalStretch)} ·{" "}
                {fmt3(modelBack.warp?.horizontalWarp)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600">mask enabled</dt>
              <dd>{modelBack.mask?.enabled === true ? "yes" : "no"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600">mask feather / edgeFade</dt>
              <dd>
                {fmt3(modelBack.mask?.feather)} · {fmt3(modelBack.mask?.edgeFade)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:col-span-2 text-[9px] text-emerald-900/70 font-sans pt-1 border-t border-emerald-200/80">
              <span>blank tuning row</span>
              <span>{modelBack.blankTuningExisted ? "present" : "absent"}</span>
            </div>
            <div className="flex justify-between gap-2 sm:col-span-2 text-[9px] text-emerald-900/70 font-sans">
              <span>variant target override / product placement</span>
              <span>
                {modelBack.variantTargetOverrideExisted ? "yes" : "no"} /{" "}
                {modelBack.productPlacementApplied ? "yes" : "no"}
              </span>
            </div>
          </dl>
        )}
        </div>
      ) : null}
    </div>
  );
}
