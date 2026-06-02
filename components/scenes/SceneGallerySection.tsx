"use client";

/**
 * Phase C — scene gallery section for product PDP page.
 *
 * Operator UX:
 *   - Per variant: shows existing variant.sceneRenders[*] as a grid of tiles.
 *   - "Generate 4-shot PDP" button: fans out the curated default 4 templates
 *     via enqueueSceneJobBatch. While jobs run, tiles appear with progress.
 *   - "+ Add scene…" button: opens a picker modal to add custom templates
 *     beyond the default 4.
 *   - Per-tile delete button: clears variant.sceneRenders[templateId] (does
 *     not delete Storage object — cheap to leave, in case of restore).
 *
 * Subscribes to rp_scene_jobs for the active variant to show
 * in-progress / failed jobs alongside completed sceneRenders. Once a job
 * completes the trigger writes to sceneRenders, so the gallery shows the
 * final state without needing a re-fetch.
 *
 * Mirrors the static catalog from sceneTemplates.js — keep in sync.
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as firebaseDb, functions as firebaseFunctions } from "@/lib/firebase/config";
import type {
  RPSceneJob,
  RPSceneSourceSlot,
  RPSceneTemplateId,
  RPVariantSceneRender,
} from "@/lib/types/firestore";

/**
 * Static catalog mirror. Source of truth is server-side; this drives the
 * picker UI. Adding/removing entries here doesn't enable/disable templates —
 * that's controlled by the server registry. Out-of-sync entries cause an
 * invalid-argument error at job-creation time, which the UI surfaces.
 */
const SCENE_CATALOG: Array<{
  id: RPSceneTemplateId;
  label: string;
  category: string;
  description: string;
  experimental: boolean;
  includedIn4ShotDefault: boolean;
}> = [
  {
    id: "gameday_stadium",
    label: "Gameday stadium",
    category: "Gameday",
    description: "Model in stadium concourse, golden hour lighting.",
    experimental: false,
    includedIn4ShotDefault: true,
  },
  {
    id: "lifestyle_coffee",
    label: "Coffee shop lifestyle",
    category: "Lifestyle",
    description: "Cozy cafe interior, soft natural window light.",
    experimental: false,
    includedIn4ShotDefault: true,
  },
  {
    id: "outdoor_park",
    label: "Outdoor park",
    category: "Lifestyle",
    description: "Sunny park, soft tree blur, casual standing pose.",
    experimental: false,
    includedIn4ShotDefault: false,
  },
  {
    id: "studio_clean",
    label: "Clean studio",
    category: "Studio",
    description: "Pure white seamless, even soft light, e-com default.",
    experimental: false,
    includedIn4ShotDefault: true,
  },
  {
    id: "editorial_moody",
    label: "Editorial moody",
    category: "Editorial",
    description: "Dark moody background, dramatic side-light.",
    experimental: true,
    includedIn4ShotDefault: true,
  },
  {
    id: "flatlay_table",
    label: "Flatlay on table",
    category: "Studio",
    description: "Top-down lay with minimal lifestyle props.",
    experimental: true,
    includedIn4ShotDefault: false,
  },
  {
    id: "hanging_rack",
    label: "Hanging on rack",
    category: "Studio",
    description: "Wood rack, neutral wall, boutique retail vibe.",
    experimental: true,
    includedIn4ShotDefault: false,
  },
  {
    id: "detail_print_crop",
    label: "Print detail crop",
    category: "Editorial",
    description: "Tight macro crop on the screen-print texture.",
    experimental: true,
    includedIn4ShotDefault: false,
  },
];

const COST_PER_SCENE_USD = 0.04; // Flux Kontext pricing

interface SceneGallerySectionProps {
  productId: string;
  variantId: string;
  variantLabel: string;
  /** Available source slots from this variant's flatRenders — used to validate the picker. */
  availableSourceSlots: RPSceneSourceSlot[];
  /** Current variant.sceneRenders[*] map. */
  sceneRenders: Record<string, RPVariantSceneRender>;
}

export default function SceneGallerySection({
  productId,
  variantId,
  variantLabel,
  availableSourceSlots,
  sceneRenders,
}: SceneGallerySectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Array<RPSceneJob & { id: string }>>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [sourceSlot, setSourceSlot] = useState<RPSceneSourceSlot>(
    availableSourceSlots.includes("model_front_designed")
      ? "model_front_designed"
      : availableSourceSlots[0] || "model_front_designed"
  );

  /**
   * Subscribe to rp_scene_jobs for this variant. Shows running/failed jobs in
   * the gallery alongside completed sceneRenders. Once a job completes the
   * trigger writes to sceneRenders so we can drop the job tile.
   */
  useEffect(() => {
    if (!firebaseDb) return;
    const q = query(
      collection(firebaseDb, "rp_scene_jobs"),
      where("productId", "==", productId),
      where("variantId", "==", variantId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as RPSceneJob) }))
          // Only show in-flight or failed — completed jobs are reflected in sceneRenders.
          .filter((j) => j.status === "queued" || j.status === "processing" || j.status === "failed");
        setActiveJobs(rows);
      },
      (err) => setPendingError(`scene jobs: ${err.message}`)
    );
    return () => unsub();
  }, [productId, variantId]);

  const defaultTemplateIds = useMemo(
    () => SCENE_CATALOG.filter((t) => t.includedIn4ShotDefault).map((t) => t.id),
    []
  );

  /** Tiles to render: existing sceneRenders + in-flight jobs (no overlap by templateId). */
  const tiles = useMemo(() => {
    const renderedIds = new Set(Object.keys(sceneRenders));
    const inFlightTiles = activeJobs
      .filter((j) => !renderedIds.has(j.sceneTemplateId))
      .map((j) => ({
        kind: "job" as const,
        key: j.id,
        templateId: j.sceneTemplateId,
        job: j,
      }));
    const completedTiles = Object.values(sceneRenders).map((r) => ({
      kind: "render" as const,
      key: r.jobId || r.sceneTemplateId,
      templateId: r.sceneTemplateId,
      render: r,
    }));
    // Stable order: by template id alphabetically.
    return [...completedTiles, ...inFlightTiles].sort((a, b) =>
      String(a.templateId).localeCompare(String(b.templateId))
    );
  }, [sceneRenders, activeJobs]);

  const handleGenerate4Shot = async () => {
    if (!firebaseFunctions) {
      setPendingError("Firebase functions not initialized");
      return;
    }
    setPendingError(null);
    try {
      const fn = httpsCallable<
        {
          productId: string;
          variantId: string;
          sourceSlot: RPSceneSourceSlot;
          sceneTemplateIds?: RPSceneTemplateId[];
        },
        { sceneSetId: string; jobIds: Record<string, string>; templateCount: number }
      >(firebaseFunctions, "enqueueSceneJobBatch");
      await fn({
        productId,
        variantId,
        sourceSlot,
        // Omit sceneTemplateIds → server uses default 4-shot set.
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPendingError(msg);
    }
  };

  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Scene gallery — {variantLabel}</h3>
          <p className="text-xs text-gray-500">
            AI-generated lifestyle / studio variations via Flux Kontext (${COST_PER_SCENE_USD.toFixed(2)} per scene).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {availableSourceSlots.length > 1 ? (
            <select
              value={sourceSlot}
              onChange={(e) => setSourceSlot(e.target.value as RPSceneSourceSlot)}
              className="text-xs border border-gray-300 rounded px-2 py-1"
              title="Which existing render Kontext should transform"
            >
              {availableSourceSlots.map((slot) => (
                <option key={slot} value={slot}>
                  source: {slot}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={handleGenerate4Shot}
            disabled={availableSourceSlots.length === 0}
            className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
            title={
              availableSourceSlots.length === 0
                ? "Generate a flat or model render first — Kontext needs a source image to transform"
                : `Fan out ${defaultTemplateIds.length} default scenes (~$${(defaultTemplateIds.length * COST_PER_SCENE_USD).toFixed(2)})`
            }
          >
            🎬 Generate {defaultTemplateIds.length}-shot PDP
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-gray-300 hover:bg-gray-50"
          >
            + Add scene…
          </button>
        </div>
      </div>

      {pendingError ? (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
          {pendingError}
        </div>
      ) : null}

      <div className="p-4">
        {tiles.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            No scenes yet. Click <strong>Generate 4-shot PDP</strong> to fan out lifestyle / studio /
            gameday / editorial shots, or <strong>+ Add scene…</strong> to pick custom templates.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {tiles.map((tile) => (
              <SceneTile key={tile.key} tile={tile} />
            ))}
          </div>
        )}
      </div>

      {pickerOpen ? (
        <ScenePickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          productId={productId}
          variantId={variantId}
          sourceSlot={sourceSlot}
          alreadyHaveTemplateIds={new Set(Object.keys(sceneRenders) as RPSceneTemplateId[])}
        />
      ) : null}
    </section>
  );
}

type Tile =
  | { kind: "job"; key: string; templateId: RPSceneTemplateId; job: RPSceneJob & { id: string } }
  | { kind: "render"; key: string; templateId: RPSceneTemplateId; render: RPVariantSceneRender };

function SceneTile({ tile }: { tile: Tile }) {
  const meta = SCENE_CATALOG.find((c) => c.id === tile.templateId);
  const label = meta?.label || tile.templateId;
  const category = meta?.category;
  if (tile.kind === "job") {
    const status = tile.job.status;
    return (
      <div className="border border-gray-200 rounded overflow-hidden">
        <div className="aspect-square bg-gray-100 flex items-center justify-center">
          {status === "failed" ? (
            <div className="p-3 text-xs text-red-700 text-center">
              <div className="font-medium">Failed</div>
              <div className="mt-1">{tile.job.error || "Unknown error"}</div>
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              {status === "processing" ? "Rendering…" : "Queued…"}
            </div>
          )}
        </div>
        <div className="px-2 py-1.5 text-xs text-gray-700 truncate">{label}</div>
      </div>
    );
  }
  const r = tile.render;
  return (
    <div className="border border-gray-200 rounded overflow-hidden group relative">
      <div className="aspect-square bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.url} alt={label} className="w-full h-full object-cover" />
      </div>
      <div className="px-2 py-1.5 text-xs text-gray-700">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-medium">{label}</span>
          {category ? (
            <span className="text-[10px] text-gray-400 whitespace-nowrap">{category}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Picker modal for custom template selection — operator picks any subset of
 * the catalog (1-6 templates) and clicks Run. Same enqueueSceneJobBatch path
 * as the 4-shot button, just with explicit template ids.
 */
function ScenePickerModal({
  open,
  onClose,
  productId,
  variantId,
  sourceSlot,
  alreadyHaveTemplateIds,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  variantId: string;
  sourceSlot: RPSceneSourceSlot;
  alreadyHaveTemplateIds: Set<RPSceneTemplateId>;
}) {
  const [selected, setSelected] = useState<Set<RPSceneTemplateId>>(new Set());
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const totalCost = selected.size * COST_PER_SCENE_USD;

  const handleRun = async () => {
    if (!firebaseFunctions) {
      setErrorMsg("Firebase functions not initialized");
      return;
    }
    if (selected.size === 0) {
      setErrorMsg("Pick at least one template");
      return;
    }
    setRunning(true);
    setErrorMsg(null);
    try {
      const fn = httpsCallable<
        {
          productId: string;
          variantId: string;
          sourceSlot: RPSceneSourceSlot;
          sceneTemplateIds: RPSceneTemplateId[];
        },
        { sceneSetId: string; jobIds: Record<string, string>; templateCount: number }
      >(firebaseFunctions, "enqueueSceneJobBatch");
      await fn({ productId, variantId, sourceSlot, sceneTemplateIds: [...selected] });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Pick scene templates</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="p-6 space-y-3">
          {SCENE_CATALOG.map((t) => {
            const alreadyHave = alreadyHaveTemplateIds.has(t.id);
            const checked = selected.has(t.id);
            return (
              <label
                key={t.id}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer ${
                  checked ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    });
                  }}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{t.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{t.category}</span>
                    {t.experimental ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        experimental
                      </span>
                    ) : null}
                    {alreadyHave ? (
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                        will overwrite existing
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{t.description}</p>
                </div>
              </label>
            );
          })}
          {errorMsg ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {errorMsg}
            </p>
          ) : null}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {selected.size} selected · <span className="font-medium">${totalCost.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRun}
              disabled={running || selected.size === 0 || selected.size > 6}
              className="px-4 py-1.5 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
            >
              {running ? "Enqueueing…" : `Run ${selected.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
