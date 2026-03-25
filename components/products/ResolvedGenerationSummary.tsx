"use client";

import type { RpScenePreset } from "@/lib/types/firestore";
import type { ResolvedProductGeneration } from "@/lib/generation/resolveProductGeneration";
import {
  presetLabel,
  sceneTypeFromPreset,
  formatSceneTypeLabel,
} from "@/lib/generation/resolveProductGeneration";

function sourceBadge(source: string): string {
  switch (source) {
    case "blank":
      return "Blank";
    case "team":
      return "Team";
    case "design":
      return "Design";
    case "config":
      return "Config";
    case "inferred":
      return "Inferred";
    case "product":
      return "Product override";
    default:
      return source;
  }
}

function sceneTypeRowDetail(params: {
  presetId: string | null;
  presets: RpScenePreset[];
  /** Same provenance as the resolved preset id row */
  sourceLabel: string;
  /** When true, default generate uses this preset */
  isDefaultForGenerate: boolean;
}): { value: string; source: string; detail: string } {
  const { presetId, presets, sourceLabel, isDefaultForGenerate } = params;
  if (!presetId) {
    return {
      value: "—",
      source: sourceLabel,
      detail: "No preset id resolved",
    };
  }
  const preset = presets.find((x) => x.id === presetId);
  if (!preset) {
    return {
      value: "—",
      source: sourceLabel,
      detail: `Preset id ${presetId} not in loaded list — refresh or check rp_scene_presets`,
    };
  }
  const st = sceneTypeFromPreset(presets, presetId);
  const value = formatSceneTypeLabel(st);
  const base = `rp_scene_presets · sceneType${st == null ? " (missing on doc)" : ""}`;
  const tail = isDefaultForGenerate ? " · Default generate uses this preset." : "";
  return {
    value: st == null ? "—" : value,
    source: sourceLabel,
    detail: `${base}${tail}`,
  };
}

export default function ResolvedGenerationSummary({
  resolved,
  presets,
  loading,
  defaultGenerateMode,
}: {
  resolved: ResolvedProductGeneration | null;
  presets: RpScenePreset[];
  loading?: boolean;
  /** Which preset drives “Generate using defaults” (product vs model tabs). */
  defaultGenerateMode: "product" | "model";
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-slate-50/80 p-4 text-sm text-gray-600">Resolving generation defaults…</div>
    );
  }
  if (!resolved) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
        Load blank + design to show resolved generation rules.
      </div>
    );
  }

  const poScene = sceneTypeRowDetail({
    presetId: resolved.productOnlyPresetId.value,
    presets,
    sourceLabel: sourceBadge(resolved.productOnlyPresetId.source),
    isDefaultForGenerate: defaultGenerateMode === "product",
  });
  const omScene = sceneTypeRowDetail({
    presetId: resolved.onModelPresetId.value,
    presets,
    sourceLabel: sourceBadge(resolved.onModelPresetId.source),
    isDefaultForGenerate: defaultGenerateMode === "model",
  });

  const rows: { label: string; value: string; source: string; detail?: string }[] = [
    {
      label: "Primary view (mockup / composite)",
      value: resolved.primaryView.value === "back" ? "Back" : "Front",
      source: sourceBadge(resolved.primaryView.source),
      detail: resolved.primaryView.detail,
    },
    {
      label: "Product-only preset",
      value: presetLabel(presets, resolved.productOnlyPresetId.value),
      source: sourceBadge(resolved.productOnlyPresetId.source),
      detail: resolved.productOnlyPresetId.detail,
    },
    {
      label: "On-model preset",
      value: presetLabel(presets, resolved.onModelPresetId.value),
      source: sourceBadge(resolved.onModelPresetId.source),
      detail: resolved.onModelPresetId.detail,
    },
    {
      label: "Default model identity",
      value: resolved.defaultIdentityId.value || "— (set in Advanced or team.generationDefaults)",
      source: sourceBadge(resolved.defaultIdentityId.source),
      detail: resolved.defaultIdentityId.detail,
    },
    {
      label: "Scene type (product-only preset)",
      value: poScene.value,
      source: poScene.source,
      detail: poScene.detail,
    },
    {
      label: "Scene type (on-model preset)",
      value: omScene.value,
      source: omScene.source,
      detail: omScene.detail,
    },
    {
      label: "Deterministic scene render key",
      value: resolved.sceneRenderKey.value,
      source: sourceBadge(resolved.sceneRenderKey.source),
      detail: resolved.sceneRenderKey.detail,
    },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Resolved generation defaults</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Order: Blank → Team → Design → central config. Use <strong>Generate using defaults</strong> below; open{" "}
          <strong>Advanced overrides</strong> only when you need a one-off run.
        </p>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="border-b border-gray-100 pb-2 sm:border-0 sm:pb-0">
            <dt className="text-xs font-medium text-gray-500">{r.label}</dt>
            <dd className="text-gray-900 mt-0.5">{r.value}</dd>
            <dd className="text-[10px] text-gray-500 mt-0.5">
              <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                {r.source}
              </span>
              {r.detail ? <span className="ml-1.5">{r.detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
