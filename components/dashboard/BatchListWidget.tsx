"use client";

/**
 * Phase E — recent-batches widget for the dashboard.
 *
 * Subscribes to rp_batches (last 14 days) and renders a compact list of
 * batch fan-outs: kind, total/completed/failed counters, progress bar,
 * cost so far, status badge. Operator can see at a glance whether a
 * batch they kicked off is still running, partially failed, or done.
 *
 * Single-job operations (single previewBlankRender, single Kontext scene)
 * don't create batch docs — they only show up in the cost meter widget.
 * The batch widget is for FAN-OUTS specifically: 4-shot PDPs, A/B tests,
 * multi-variant product realism.
 */

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db as firebaseDb } from "@/lib/firebase/config";
import type { RPBatch, RPBatchKind, RPBatchStatus } from "@/lib/types/firestore";

const KIND_LABELS: Record<RPBatchKind, string> = {
  vton_ab: "VTON A/B test",
  scene_set: "Scene set",
  product_realism: "Product realism",
  shopify_collections: "Shopify collections sync",
};

export default function BatchListWidget() {
  const [batches, setBatches] = useState<Array<RPBatch & { id: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseDb) return;
    const fourteenDaysAgo = Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(firebaseDb, "rp_batches"),
      where("createdAt", ">=", fourteenDaysAgo)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RPBatch) }));
        rows.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
        setBatches(rows);
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  if (error) {
    return (
      <section className="bg-white rounded-lg shadow border border-red-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-red-200">
          <h3 className="text-lg font-semibold text-red-700">Recent batches — error</h3>
        </div>
        <div className="p-4 text-sm text-red-700">{error}</div>
      </section>
    );
  }
  if (batches === null) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">Loading…</div>
      </section>
    );
  }
  if (batches.length === 0) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">
          No batch fan-outs in the last 14 days. Batches appear here after running an A/B
          comparison, 4-shot PDP scene set, or multi-variant product realism.
        </div>
      </section>
    );
  }

  /** Top 8 — operator wants to see recent activity, not full history. */
  const display = batches.slice(0, 8);
  const running = batches.filter((b) => b.status === "running" || b.status === "queued").length;

  return (
    <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        <span className="text-xs text-gray-500">
          {running > 0 ? `${running} running · ` : ""}
          {batches.length} in last 14 days
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {display.map((b) => (
          <BatchRow key={b.id} batch={b} />
        ))}
      </ul>
    </section>
  );
}

function BatchRow({ batch }: { batch: RPBatch & { id: string } }) {
  const label = KIND_LABELS[batch.kind] || batch.kind;
  const total = batch.total || 0;
  const terminal = (batch.completed || 0) + (batch.failed || 0);
  const pct = total > 0 ? Math.round((terminal / total) * 100) : 0;
  const sub = batch.metadata?.label || "";
  const cost = batch.falCostUsdTotal;
  return (
    <li className="px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900">{label}</span>
          <StatusBadge status={batch.status} />
        </div>
        {sub ? <p className="text-xs text-gray-500 mt-0.5 truncate">{sub}</p> : null}
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${
                batch.status === "failed" || batch.status === "partial"
                  ? "bg-red-500"
                  : batch.status === "completed"
                  ? "bg-emerald-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {batch.completed}/{total} done
            {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
          </span>
        </div>
      </div>
      <div className="text-right text-xs text-gray-500 whitespace-nowrap">
        {cost != null && cost > 0 ? <div>${cost.toFixed(2)}</div> : null}
        <div className="text-gray-400">{formatRelativeTime(batch.createdAt)}</div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: RPBatchStatus }) {
  const map: Record<RPBatchStatus, { label: string; cls: string }> = {
    queued: { label: "queued", cls: "bg-gray-100 text-gray-600" },
    running: { label: "running", cls: "bg-blue-100 text-blue-700" },
    completed: { label: "done", cls: "bg-emerald-100 text-emerald-700" },
    partial: { label: "partial", cls: "bg-amber-100 text-amber-700" },
    failed: { label: "failed", cls: "bg-red-100 text-red-700" },
  };
  const v = map[status] || { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`text-xs px-2 py-0.5 rounded ${v.cls}`}>{v.label}</span>;
}

function tsMs(t: unknown): number {
  if (!t) return 0;
  const x = t as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof x.toMillis === "function") return x.toMillis();
  if (typeof x.seconds === "number") return x.seconds * 1000;
  if (typeof x._seconds === "number") return x._seconds * 1000;
  return 0;
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
