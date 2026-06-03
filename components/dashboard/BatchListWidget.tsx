"use client";

/**
 * Phase E — recent-batches widget for the dashboard.
 * Phase K1 (2026-06-02) — now ALSO shows auto-launched product-asset batches.
 *
 * Two sources, one list:
 *   - rp_batches            → explicit operator fan-outs (VTON A/B, 4-shot
 *     scene sets, multi-variant product realism). Created by Phase B/C/E
 *     callables. Shape: RPBatch.
 *   - rp_product_asset_batches → the auto-launch generation that fires when a
 *     design is committed with products (startInitialProductAssetBatch).
 *     This is the work Greg's bulk-commit kicks off — previously INVISIBLE
 *     here because the widget only queried rp_batches. Different doc shape
 *     (colors→roles map, not flat counters), normalized below.
 *
 * Both normalize into `DisplayBatch` so the row + drawer render one mental
 * model. The drawer branches on `source` to render asset-batch role detail
 * (which lives embedded in the doc, not in a child collection).
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
import BatchDetailDrawer from "@/components/dashboard/BatchDetailDrawer";

const KIND_LABELS: Record<RPBatchKind, string> = {
  vton_ab: "VTON A/B test",
  scene_set: "Scene set",
  product_realism: "Product realism",
  shopify_collections: "Shopify collections sync",
};

/**
 * One asset-batch color block: a map of officialRole → { status }. The batch
 * doc holds `colors: { [blankVariantKey]: { colorName, roles: {...} } }`.
 */
interface AssetBatchColorBlock {
  colorName?: string | null;
  roles?: Record<string, { status?: string; reason?: string }>;
}

interface RpProductAssetBatch {
  productId?: string;
  blankId?: string;
  designId?: string;
  teamId?: string;
  status?: string; // "running" | "complete" | "failed" | "partial"
  colors?: Record<string, AssetBatchColorBlock>;
  assetsProgress?: { completed?: number; total?: number };
  createdAt?: unknown;
}

/**
 * Normalized display shape both sources map into. `source` discriminates so
 * the drawer knows whether to query a child collection (rp_batch) or render
 * the embedded colors→roles map (asset_batch).
 */
export interface DisplayBatch {
  id: string;
  source: "rp_batch" | "asset_batch";
  kindLabel: string;
  status: RPBatchStatus;
  total: number;
  completed: number;
  failed: number;
  subLabel: string;
  costUsd: number | null;
  createdAt: unknown;
  /** rp_batch only: the original kind, for the drawer's child-collection routing. */
  rpBatchKind?: RPBatchKind;
  /** asset_batch only: product context + raw colors map for the drawer. */
  productId?: string | null;
  assetColors?: Record<string, AssetBatchColorBlock> | null;
}

/** Map an asset-batch's status string into the shared RPBatchStatus enum. */
function normalizeAssetStatus(status: string | undefined): RPBatchStatus {
  switch (status) {
    case "complete":
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "partial":
      return "partial";
    case "running":
      return "running";
    default:
      return "queued";
  }
}

/** Count failed roles across all colors (asset batches don't store a flat `failed`). */
function countAssetRoles(colors: Record<string, AssetBatchColorBlock> | undefined): {
  failed: number;
  completed: number;
  total: number;
} {
  let failed = 0;
  let completed = 0;
  let total = 0;
  for (const block of Object.values(colors || {})) {
    for (const role of Object.values(block.roles || {})) {
      total += 1;
      const st = String(role.status || "queued");
      if (st === "failed") failed += 1;
      else if (st === "succeeded" || st === "completed" || st === "done") completed += 1;
    }
  }
  return { failed, completed, total };
}

function rpBatchToDisplay(b: RPBatch & { id: string }): DisplayBatch {
  return {
    id: b.id,
    source: "rp_batch",
    kindLabel: KIND_LABELS[b.kind] || b.kind,
    status: b.status,
    total: b.total || 0,
    completed: b.completed || 0,
    failed: b.failed || 0,
    subLabel: b.metadata?.label || "",
    costUsd: b.falCostUsdTotal ?? null,
    createdAt: b.createdAt,
    rpBatchKind: b.kind,
  };
}

function assetBatchToDisplay(id: string, b: RpProductAssetBatch): DisplayBatch {
  const counts = countAssetRoles(b.colors);
  /** Prefer the doc's assetsProgress for completed/total (authoritative), fall
   *  back to the role-count derivation when it's absent. */
  const total = b.assetsProgress?.total ?? counts.total;
  const completed = b.assetsProgress?.completed ?? counts.completed;
  const colorCount = Object.keys(b.colors || {}).length;
  return {
    id,
    source: "asset_batch",
    kindLabel: "Product images (auto)",
    status: normalizeAssetStatus(b.status),
    total,
    completed,
    failed: counts.failed,
    subLabel: `${colorCount} color${colorCount === 1 ? "" : "s"}${b.blankId ? ` · ${b.blankId}` : ""}`,
    costUsd: null,
    createdAt: b.createdAt,
    productId: b.productId || null,
    assetColors: b.colors || null,
  };
}

export default function BatchListWidget() {
  const [rpBatches, setRpBatches] = useState<DisplayBatch[] | null>(null);
  const [assetBatches, setAssetBatches] = useState<DisplayBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerBatch, setDrawerBatch] = useState<DisplayBatch | null>(null);

  useEffect(() => {
    if (!firebaseDb) return;
    const fourteenDaysAgo = Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const unsubRp = onSnapshot(
      query(collection(firebaseDb, "rp_batches"), where("createdAt", ">=", fourteenDaysAgo)),
      (snap) => {
        setRpBatches(snap.docs.map((d) => rpBatchToDisplay({ ...(d.data() as RPBatch), id: d.id })));
      },
      (err) => setError(`rp_batches: ${err.message}`)
    );

    const unsubAssets = onSnapshot(
      query(
        collection(firebaseDb, "rp_product_asset_batches"),
        where("createdAt", ">=", fourteenDaysAgo)
      ),
      (snap) => {
        setAssetBatches(
          snap.docs.map((d) => assetBatchToDisplay(d.id, d.data() as RpProductAssetBatch))
        );
      },
      (err) => setError(`rp_product_asset_batches: ${err.message}`)
    );

    return () => {
      unsubRp();
      unsubAssets();
    };
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

  const loading = rpBatches === null && assetBatches === null;
  if (loading) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">Loading…</div>
      </section>
    );
  }

  const merged = [...(rpBatches || []), ...(assetBatches || [])].sort(
    (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)
  );

  if (merged.length === 0) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">
          No batch activity in the last 14 days. Batches appear here when you commit a
          bulk design upload (auto-launch generation) or run an A/B comparison, 4-shot PDP,
          or multi-variant realism fan-out.
        </div>
      </section>
    );
  }

  /** Top 10 — show a touch more now that auto-launch batches share the list. */
  const display = merged.slice(0, 10);
  const running = merged.filter((b) => b.status === "running" || b.status === "queued").length;

  return (
    <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Recent batches</h3>
        <span className="text-xs text-gray-500">
          {running > 0 ? `${running} running · ` : ""}
          {merged.length} in last 14 days
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {display.map((b) => (
          <BatchRow key={`${b.source}-${b.id}`} batch={b} onOpen={() => setDrawerBatch(b)} />
        ))}
      </ul>
      <BatchDetailDrawer batch={drawerBatch} onClose={() => setDrawerBatch(null)} />
    </section>
  );
}

function BatchRow({ batch, onOpen }: { batch: DisplayBatch; onOpen: () => void }) {
  const total = batch.total || 0;
  const terminal = batch.completed + batch.failed;
  const pct = total > 0 ? Math.round((terminal / total) * 100) : 0;
  const cost = batch.costUsd;
  return (
    <li
      className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900">{batch.kindLabel}</span>
          <StatusBadge status={batch.status} />
        </div>
        {batch.subLabel ? (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{batch.subLabel}</p>
        ) : null}
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
