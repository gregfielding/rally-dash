"use client";

import { useMemo } from "react";
import {
  parseRenderTargetTuningFromSelectionLog,
  type RenderTargetTuningLogEntry,
} from "@/lib/products/renderTargetTuningQa";

function TuningCard({
  title,
  entry,
}: {
  title: string;
  entry: RenderTargetTuningLogEntry | undefined;
}) {
  if (!entry) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 text-xs text-gray-500">
        <div className="font-semibold text-gray-700 mb-1">{title}</div>
        <p>Not in this run (target was not generated or log line missing).</p>
      </div>
    );
  }
  const pl = entry.placement;
  const eb = entry.engineBlend;
  return (
    <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-gray-800">
      <div className="font-semibold text-indigo-900 mb-2">{title}</div>
      <dl className="grid grid-cols-1 gap-1 font-mono text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 shrink-0">x / y / scale</dt>
          <dd className="text-right break-all">
            {pl != null ? `${fmt3(pl.x)} · ${fmt3(pl.y)} · ${fmt3(pl.scale)}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 shrink-0">engine blend</dt>
          <dd className="text-right">
            {eb ? `${eb.blendMode} @ ${fmt3(eb.blendOpacity)}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 shrink-0">blank target tuning</dt>
          <dd>{entry.blankTuningExisted ? "yes" : "no"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 shrink-0">variant target override</dt>
          <dd>{entry.variantTargetOverrideExisted ? "yes" : "no"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 shrink-0">product placement override</dt>
          <dd>{entry.productPlacementApplied ? "yes" : "no"}</dd>
        </div>
      </dl>
    </div>
  );
}

function fmt3(n: number) {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(3) : String(n ?? "—");
}

export function RenderTargetTuningQaSummary({ lines }: { lines: string[] | null | undefined }) {
  const parsed = useMemo(() => parseRenderTargetTuningFromSelectionLog(lines), [lines]);
  const hasAny = parsed.flat_back || parsed.model_back;
  if (!hasAny) return null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-300 bg-indigo-50/50 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-900 mb-2">
        Last generation — target tuning used
      </h3>
      <p className="text-[11px] text-indigo-900/80 mb-3">
        From <code className="bg-white/80 px-1 rounded">render_target_tuning_resolved</code> lines in the flat render log.
        Regenerate to refresh.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TuningCard title="flat_back" entry={parsed.flat_back} />
        <TuningCard title="model_back" entry={parsed.model_back} />
      </div>
    </div>
  );
}
