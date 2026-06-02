"use client";

/**
 * Phase H — batch detail drawer.
 *
 * Slides in from the right when the operator clicks a batch row in the
 * dashboard list. Shows:
 *   - Batch header (kind, status, label, totals, cost, age)
 *   - Per-job table (status, fal endpoint, cost, latency, error if failed)
 *
 * Subscribes to the child collection by `batchId` so the table stays live
 * — failures and completions update in real-time without a manual refresh.
 *
 * Why a drawer, not a separate route: the operator's mental model is "look
 * at what just happened" — fast in/out beats deep navigation. A drawer
 * also keeps the dashboard scroll position intact.
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db as firebaseDb } from "@/lib/firebase/config";
import type { RPBatch, RPBatchKind, RPBatchStatus } from "@/lib/types/firestore";

/**
 * Mapping from batch.kind → the child collection where its jobs live.
 * Kept in this file so the drawer is self-contained.
 */
const KIND_TO_CHILD_COLLECTION: Record<RPBatchKind, string | null> = {
  vton_ab: "rp_blank_preview_jobs",
  product_realism: "rp_blank_preview_jobs",
  scene_set: "rp_scene_jobs",
  shopify_collections: null, // No child docs; would render the summary[] instead (out of scope).
};

interface ChildJob {
  id: string;
  status: string;
  error?: string | null;
  falEndpoint?: string | null;
  falCostUsd?: number | null;
  falLatencyMs?: number | null;
  /** Kind-specific labels — different shapes per child collection. */
  providerId?: string | null;
  sceneTemplateId?: string | null;
  view?: string | null;
  blankVariantId?: string | null;
  officialRole?: string | null;
  /** Stage B output URL (preview/scene job result) if available, for hover thumbnails. */
  previewUrl?: string | null;
}

interface BatchDetailDrawerProps {
  batch: (RPBatch & { id: string }) | null;
  onClose: () => void;
}

export default function BatchDetailDrawer({ batch, onClose }: BatchDetailDrawerProps) {
  const childCollection = batch ? KIND_TO_CHILD_COLLECTION[batch.kind] : null;
  const [children, setChildren] = useState<ChildJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batch || !firebaseDb || !childCollection) {
      setChildren(null);
      return;
    }
    const q = query(
      collection(firebaseDb, childCollection),
      where("batchId", "==", batch.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: ChildJob[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          /** Different child shapes — pull the common fields, leave the rest unread. */
          return {
            id: d.id,
            status: String(data.status || "unknown"),
            error: (data.error as string | null) ?? null,
            falEndpoint: (data.falEndpoint as string | null) ?? null,
            falCostUsd:
              typeof data.falCostUsd === "number" ? (data.falCostUsd as number) : null,
            falLatencyMs:
              typeof data.falLatencyMs === "number" ? (data.falLatencyMs as number) : null,
            providerId: (data.providerId as string | null) ?? null,
            sceneTemplateId: (data.sceneTemplateId as string | null) ?? null,
            view: (data.view as string | null) ?? null,
            blankVariantId: (data.blankVariantId as string | null) ?? null,
            officialRole: (data.officialRole as string | null) ?? null,
            previewUrl: pickPreviewUrl(data),
          };
        });
        rows.sort((a, b) => statusSortRank(a.status) - statusSortRank(b.status));
        setChildren(rows);
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, [batch, childCollection]);

  /** Lock body scroll while the drawer is open. */
  useEffect(() => {
    if (!batch) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [batch]);

  if (!batch) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="absolute right-0 top-0 bottom-0 w-full max-w-3xl bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">
                {kindLabel(batch.kind)}
              </h2>
              <StatusPill status={batch.status} />
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {batch.metadata?.label || `Batch ${batch.id.slice(0, 8)}`}
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

        <BatchSummary batch={batch} />

        <div className="px-6 py-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Jobs ({batch.total})
          </h3>
          {!childCollection ? (
            <p className="text-sm text-gray-500">
              This batch kind doesn&rsquo;t have child docs — see the summary above.
            </p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : children === null ? (
            <p className="text-sm text-gray-500">Loading jobs…</p>
          ) : children.length === 0 ? (
            <p className="text-sm text-gray-500">No matching jobs found.</p>
          ) : (
            <JobTable jobs={children} kind={batch.kind} />
          )}
        </div>
      </aside>
    </div>
  );
}

function BatchSummary({ batch }: { batch: RPBatch & { id: string } }) {
  const total = batch.total || 0;
  const terminal = (batch.completed || 0) + (batch.failed || 0);
  const pct = total > 0 ? Math.round((terminal / total) * 100) : 0;
  const cost = batch.falCostUsdTotal;
  return (
    <div className="px-6 py-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <SummaryStat label="Total" value={String(total)} />
        <SummaryStat label="Completed" value={String(batch.completed || 0)} className="text-emerald-700" />
        <SummaryStat label="Failed" value={String(batch.failed || 0)} className={(batch.failed || 0) > 0 ? "text-red-700" : ""} />
        <SummaryStat label="Cost" value={cost != null && cost > 0 ? `$${cost.toFixed(2)}` : "—"} />
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div
          className={`h-full transition-all ${progressBarClass(batch.status)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500">
        Batch id <code className="font-mono">{batch.id}</code> · started{" "}
        {formatRelativeTime(batch.createdAt)}
      </p>
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-xl font-semibold ${className || "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function JobTable({ jobs, kind }: { jobs: ChildJob[]; kind: RPBatchKind }) {
  /** Per-kind label override for the per-job axis (provider / template / variant+view). */
  const labelHeader = useMemo(() => {
    switch (kind) {
      case "vton_ab":
        return "Provider";
      case "scene_set":
        return "Template";
      case "product_realism":
        return "Color · view";
      default:
        return "Job";
    }
  }, [kind]);

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="text-left px-3 py-2 font-medium">{labelHeader}</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-left px-3 py-2 font-medium">Endpoint</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="text-right px-3 py-2 font-medium">Latency</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 text-gray-800">
                {jobAxisLabel(j, kind)}
                {j.previewUrl ? (
                  <a
                    href={j.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-xs text-blue-600 hover:underline"
                  >
                    image ↗
                  </a>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <JobStatusBadge status={j.status} error={j.error} />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-gray-500 truncate max-w-[200px]">
                {j.falEndpoint || "—"}
              </td>
              <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                {j.falCostUsd != null ? `$${j.falCostUsd.toFixed(3)}` : "—"}
              </td>
              <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                {j.falLatencyMs != null ? `${(j.falLatencyMs / 1000).toFixed(1)}s` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: RPBatchStatus }) {
  const map: Record<RPBatchStatus, string> = {
    queued: "bg-gray-100 text-gray-700",
    running: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    partial: "bg-amber-100 text-amber-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${map[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function JobStatusBadge({ status, error }: { status: string; error: string | null | undefined }) {
  const cls =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "failed"
      ? "bg-red-100 text-red-700 cursor-help"
      : status === "processing"
      ? "bg-blue-100 text-blue-700"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${cls}`} title={status === "failed" && error ? error : undefined}>
      {status}
    </span>
  );
}

/* ---------- helpers ---------- */

function kindLabel(kind: RPBatchKind): string {
  const m: Record<RPBatchKind, string> = {
    vton_ab: "VTON A/B test",
    scene_set: "Scene set",
    product_realism: "Product realism",
    shopify_collections: "Shopify collections sync",
  };
  return m[kind] || kind;
}

function progressBarClass(status: RPBatchStatus): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "partial" || status === "failed") return "bg-red-500";
  return "bg-blue-500";
}

function statusSortRank(status: string): number {
  /** Failed first (operator wants to see errors), then processing, completed, queued. */
  switch (status) {
    case "failed":
      return 0;
    case "processing":
      return 1;
    case "queued":
      return 2;
    case "completed":
      return 3;
    default:
      return 4;
  }
}

function jobAxisLabel(j: ChildJob, kind: RPBatchKind): string {
  if (kind === "vton_ab") return j.providerId || j.id.slice(0, 8);
  if (kind === "scene_set") return j.sceneTemplateId || j.id.slice(0, 8);
  if (kind === "product_realism") {
    const c = j.blankVariantId ? `${j.blankVariantId.slice(0, 6)}…` : "—";
    return `${c} · ${j.view || "—"}`;
  }
  return j.id.slice(0, 8);
}

function pickPreviewUrl(data: Record<string, unknown>): string | null {
  /** Different child shapes embed their final image at different paths. */
  const stageB = data.stageB as { previewUrl?: string } | undefined;
  if (stageB && typeof stageB.previewUrl === "string") return stageB.previewUrl;
  const result = data.result as { url?: string } | undefined;
  if (result && typeof result.url === "string") return result.url;
  return null;
}

function formatRelativeTime(t: unknown): string {
  const ms = tsMs(t);
  if (!ms) return "";
  const deltaMs = Date.now() - ms;
  const min = Math.round(deltaMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function tsMs(t: unknown): number {
  if (!t) return 0;
  const x = t as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof x.toMillis === "function") return x.toMillis();
  if (typeof x.seconds === "number") return x.seconds * 1000;
  if (typeof x._seconds === "number") return x._seconds * 1000;
  return 0;
}
