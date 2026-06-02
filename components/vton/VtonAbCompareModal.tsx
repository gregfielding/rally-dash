"use client";

/**
 * Phase B A/B comparison modal — fans out a Stage B realism job to N VTON
 * providers from the same Stage A input, renders each result side-by-side
 * with cost + latency annotations.
 *
 * Operator flow:
 *   1. Click "🆚 Compare providers" on the Render profile tab.
 *   2. Modal opens with provider checkboxes (Flux Fill + Kolors VTO pre-checked).
 *   3. Click "Run A/B test" — fires the enqueueVtonAbTest callable.
 *   4. N tiles appear, each subscribing to its job doc. Tiles progress
 *      queued → stageA → stageB → image, in any order (slow providers don't
 *      block fast ones).
 *   5. Each tile shows cost / latency / endpoint so the operator can pick
 *      not just "best looking" but "best looking per dollar."
 *
 * Cost ceiling: limit fan-out to ≤4 providers per click. At Flux Fill's $0.05
 * + Kolors VTO's $0.07, a 4-way comparison is ~$0.30; clicking 10 times
 * during tuning is $3. Cheap relative to engineering value, but worth a
 * visible cost preview before run.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc as firestoreDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as firebaseDb, functions as firebaseFunctions } from "@/lib/firebase/config";
import type {
  RPBlankPreviewJob,
  RPBlankPreviewJobPlacementInput,
  RPVtonProviderId,
} from "@/lib/types/firestore";

/**
 * Static provider catalog — mirrors the server registry. Keep this in sync
 * with `functions/lib/vtonProviders.js`. The server is the source of truth
 * (validates ids server-side); this is just for the UI labels + capabilities.
 */
const PROVIDER_CATALOG: Array<{
  id: RPVtonProviderId;
  label: string;
  description: string;
  estCostUsd: number;
  experimental: boolean;
}> = [
  {
    id: "flux_fill",
    label: "Flux Fill (mask-based)",
    description:
      "Inpaints the design region with slider-driven prompt + Stage A color overlay. Rally's incumbent path.",
    estCostUsd: 0.05,
    experimental: false,
  },
  {
    id: "kolors_vto",
    label: "Kolors VTO v1.5",
    description:
      "Fashion-tuned garment-on-body warping. No mask, no prompt — Kolors derives both. Needs a variant model photo.",
    estCostUsd: 0.07,
    experimental: true,
  },
];

interface VtonAbCompareModalProps {
  open: boolean;
  onClose: () => void;
  /** Same shape as previewBlankRender input (minus providerId / withRealism). */
  inputs: {
    blankId: string;
    variantId: string | null;
    designId: string;
    view: "front" | "back";
    renderTarget: "flat_front" | "flat_back" | "model_front" | "model_back";
    artworkMode?: "light" | "dark" | "white";
    placement: RPBlankPreviewJobPlacementInput;
    designUrlOverride?: string | null;
  };
}

export default function VtonAbCompareModal({ open, onClose, inputs }: VtonAbCompareModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<RPVtonProviderId>>(
    new Set(["flux_fill", "kolors_vto"])
  );
  const [running, setRunning] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleProvider = (id: RPVtonProviderId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalEstCost = useMemo(() => {
    return PROVIDER_CATALOG.filter((p) => selectedIds.has(p.id)).reduce(
      (s, p) => s + p.estCostUsd,
      0
    );
  }, [selectedIds]);

  const handleRun = async () => {
    if (!firebaseFunctions) {
      setErrorMsg("Firebase functions not initialized");
      return;
    }
    if (selectedIds.size < 2) {
      setErrorMsg("Pick at least two providers for A/B comparison");
      return;
    }
    setRunning(true);
    setErrorMsg(null);
    setGroupId(null);
    try {
      const fn = httpsCallable<
        {
          blankId: string;
          variantId: string | null;
          designId: string;
          view: "front" | "back";
          renderTarget: string;
          artworkMode?: string;
          placement: RPBlankPreviewJobPlacementInput;
          designUrlOverride?: string | null;
          providerIds: RPVtonProviderId[];
        },
        { abTestGroupId: string; jobIds: Record<string, string>; providerCount: number }
      >(firebaseFunctions, "enqueueVtonAbTest");
      const result = await fn({
        ...inputs,
        providerIds: [...selectedIds],
      });
      setGroupId(result.data.abTestGroupId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setRunning(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">A/B compare VTON providers</h3>
            <p className="text-sm text-gray-500">
              Fan out the same Stage A input to multiple providers, see realism results side-by-side.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {!groupId ? (
            <ProviderPicker
              catalog={PROVIDER_CATALOG}
              selectedIds={selectedIds}
              onToggle={toggleProvider}
              totalEstCost={totalEstCost}
              onRun={handleRun}
              running={running}
              errorMsg={errorMsg}
            />
          ) : (
            <ComparisonGrid groupId={groupId} expectedCount={selectedIds.size} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderPicker(props: {
  catalog: typeof PROVIDER_CATALOG;
  selectedIds: Set<RPVtonProviderId>;
  onToggle: (id: RPVtonProviderId) => void;
  totalEstCost: number;
  onRun: () => void;
  running: boolean;
  errorMsg: string | null;
}) {
  return (
    <>
      <div className="space-y-2">
        {props.catalog.map((p) => {
          const checked = props.selectedIds.has(p.id);
          return (
            <label
              key={p.id}
              className={`flex items-start gap-3 p-3 rounded border cursor-pointer ${
                checked ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => props.onToggle(p.id)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{p.label}</span>
                  {p.experimental ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                      experimental
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{p.description}</p>
                <p className="text-xs text-gray-500 mt-1">≈${p.estCostUsd.toFixed(2)} per call</p>
              </div>
            </label>
          );
        })}
      </div>

      {props.errorMsg ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {props.errorMsg}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t pt-4">
        <div className="text-sm text-gray-600">
          {props.selectedIds.size} provider{props.selectedIds.size === 1 ? "" : "s"} selected
          {" · "}
          <span className="font-medium">≈${props.totalEstCost.toFixed(2)} total</span>
        </div>
        <button
          onClick={props.onRun}
          disabled={props.running || props.selectedIds.size < 2}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium"
        >
          {props.running ? "Enqueueing…" : "Run A/B test"}
        </button>
      </div>
    </>
  );
}

/**
 * Live grid of results. Subscribes to all jobs in the abTestGroupId via a
 * single onSnapshot query. Each job tile renders progress + final image when
 * the job completes.
 */
function ComparisonGrid({ groupId, expectedCount }: { groupId: string; expectedCount: number }) {
  const [jobs, setJobs] = useState<Array<RPBlankPreviewJob & { id: string }>>([]);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseDb) return;
    const q = query(
      collection(firebaseDb, "rp_blank_preview_jobs"),
      where("abTestGroupId", "==", groupId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RPBlankPreviewJob) }));
        // Stable order: alphabetical by providerId so re-renders don't reshuffle tiles.
        rows.sort((a, b) => String(a.providerId).localeCompare(String(b.providerId)));
        setJobs(rows);
      },
      (err) => setQueryError(err.message)
    );
    return () => unsub();
  }, [groupId]);

  const allComplete = jobs.length === expectedCount && jobs.every((j) => j.status !== "queued" && j.status !== "processing");

  return (
    <>
      <div className="text-sm text-gray-600">
        Group <span className="font-mono">{groupId}</span> ·{" "}
        {allComplete
          ? `All ${jobs.length} providers complete.`
          : `Waiting on ${expectedCount - jobs.filter((j) => j.status === "completed" || j.status === "failed").length} of ${expectedCount}…`}
      </div>
      {queryError ? (
        <p className="text-sm text-red-700">{queryError}</p>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs.map((job) => (
          <ResultTile key={job.id} job={job} />
        ))}
        {/* Show placeholders for jobs that haven't appeared in the snapshot yet (rare race). */}
        {jobs.length < expectedCount &&
          Array.from({ length: expectedCount - jobs.length }).map((_, i) => (
            <div
              key={`placeholder-${i}`}
              className="border border-dashed border-gray-300 rounded p-4 text-center text-sm text-gray-400 min-h-[280px] flex items-center justify-center"
            >
              Waiting for job to appear…
            </div>
          ))}
      </div>
    </>
  );
}

function ResultTile({ job }: { job: RPBlankPreviewJob & { id: string } }) {
  const provider = PROVIDER_CATALOG.find((p) => p.id === job.providerId);
  const label = provider?.label || job.providerId || "(unknown)";
  const stageBUrl = job.stageB?.previewUrl;
  const cost = job.falCostUsd;
  const latency = job.falLatencyMs;

  const statusBadge =
    job.status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : job.status === "failed"
      ? "bg-red-100 text-red-700"
      : job.status === "processing"
      ? "bg-blue-100 text-blue-700"
      : "bg-gray-100 text-gray-600";

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900">{label}</span>
          {provider?.experimental ? (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              experimental
            </span>
          ) : null}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusBadge}`}>{job.status}</span>
      </div>
      <div className="aspect-square bg-gray-100 flex items-center justify-center">
        {stageBUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stageBUrl} alt={label} className="max-w-full max-h-full object-contain" />
        ) : job.status === "failed" ? (
          <div className="p-4 text-sm text-red-700 text-center">
            <div className="font-medium">Failed</div>
            <div className="text-xs mt-1">{job.error || "Unknown error"}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            {job.status === "processing" ? "Rendering…" : "Queued…"}
          </div>
        )}
      </div>
      <div className="px-3 py-2 text-xs text-gray-600 flex items-center justify-between">
        <span>
          {cost != null ? `$${cost.toFixed(3)}` : "—"}
          {latency != null ? ` · ${(latency / 1000).toFixed(1)}s` : ""}
        </span>
        <span className="font-mono text-[10px] text-gray-400" title={job.id}>
          {job.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
