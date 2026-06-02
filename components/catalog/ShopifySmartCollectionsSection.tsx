"use client";

/**
 * Phase D — Catalog page section showing Shopify smart-collection sync
 * status for every active taxonomy entry, with a one-click "Sync all"
 * button.
 *
 * Operator UX:
 *   - On mount: calls getShopifySmartCollectionsStatus → renders a grouped
 *     status grid (Sport / League / Team / Theme).
 *   - Each row shows: code, name, expected Shopify handle, status badge.
 *   - "Sync all to Shopify" button: calls
 *     syncShopifySmartCollectionsFromTaxonomy on the active set. Status
 *     refreshes on completion.
 *   - "Dry run" option: returns the plan without hitting Shopify — useful
 *     when the operator wants to preview what gets created.
 *
 * Source of truth: Firestore taxonomy collections. The status reads
 * `shopifySmartCollection.syncStatus` from each doc, not Shopify directly,
 * so it's cheap and fast. The sync callable IS the bridge to Shopify; this
 * UI just displays state set by that callable.
 */

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions as firebaseFunctions } from "@/lib/firebase/config";

interface StatusRow {
  collection: string;
  family: "sport" | "league" | "team" | "theme";
  docId: string;
  code: string;
  name: string | null;
  expectedHandle: string;
  expectedTitle: string;
  tagRule: string;
  status: "not_synced" | "created" | "already_exists" | "error" | "unknown" | "dry_run";
  shopifyId: string | null;
  syncedAt: unknown;
  error: string | null;
}

interface SyncSummaryRow {
  family: string;
  docId: string;
  code: string;
  handle?: string;
  title?: string;
  status: string;
  shopifyId?: string | null;
  error?: string;
  tagRule?: string;
}

export default function ShopifySmartCollectionsSection() {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummaryRow[] | null>(null);

  const refresh = async () => {
    if (!firebaseFunctions) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<{ collections?: string[] }, { rows: StatusRow[] }>(
        firebaseFunctions,
        "getShopifySmartCollectionsStatus"
      );
      const res = await fn({});
      setRows(res.data.rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return null;
    const groups: Record<string, StatusRow[]> = { sport: [], league: [], team: [], theme: [] };
    for (const r of rows) {
      if (!groups[r.family]) groups[r.family] = [];
      groups[r.family].push(r);
    }
    /** Sort each group by code so the operator sees a stable order across refreshes. */
    Object.values(groups).forEach((g) => g.sort((a, b) => String(a.code).localeCompare(String(b.code))));
    return groups;
  }, [rows]);

  const counts = useMemo(() => {
    if (!rows) return null;
    const c = { total: rows.length, synced: 0, missing: 0, error: 0 };
    for (const r of rows) {
      if (r.status === "created" || r.status === "already_exists") c.synced++;
      else if (r.status === "error") c.error++;
      else c.missing++;
    }
    return c;
  }, [rows]);

  const handleSync = async (dryRun: boolean) => {
    if (!firebaseFunctions) return;
    setSyncing(true);
    setError(null);
    setSyncSummary(null);
    try {
      const fn = httpsCallable<
        { collections?: string[]; dryRun?: boolean },
        { summary: SyncSummaryRow[] }
      >(firebaseFunctions, "syncShopifySmartCollectionsFromTaxonomy");
      const res = await fn({ dryRun });
      setSyncSummary(res.data.summary);
      /** Refresh status from Firestore — the sync callable wrote new state per doc. */
      if (!dryRun) await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Shopify Smart Collections</h2>
          <p className="text-sm text-gray-600 mt-1">
            Auto-create a Shopify smart collection per active taxonomy entry. Each collection
            filters products by tag (e.g. <code className="text-xs">team:sfgiants</code>).
            Re-runs are idempotent — Shopify duplicates are skipped.
          </p>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => handleSync(true)}
            disabled={loading || syncing}
            className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            title="Show what would be created without calling Shopify"
          >
            Dry run
          </button>
          <button
            type="button"
            onClick={() => handleSync(false)}
            disabled={loading || syncing}
            className="px-3 py-1.5 rounded text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
          >
            {syncing ? "Syncing…" : "Sync all to Shopify"}
          </button>
        </div>
      </div>

      {counts ? (
        <div className="flex flex-wrap gap-2 mb-4">
          <CountChip label="Total" value={counts.total} className="bg-gray-100 text-gray-700" />
          <CountChip label="Synced" value={counts.synced} className="bg-emerald-100 text-emerald-700" />
          <CountChip label="Missing" value={counts.missing} className="bg-amber-100 text-amber-700" />
          {counts.error > 0 ? (
            <CountChip label="Errored" value={counts.error} className="bg-red-100 text-red-700" />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-4">
          {error}
        </div>
      ) : null}

      {syncSummary ? <SyncSummaryPanel summary={syncSummary} /> : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading status…</p>
      ) : rows && rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No active taxonomy entries found. Seed{" "}
          <code className="text-xs">rp_taxonomy_*</code> collections first.
        </p>
      ) : grouped ? (
        <div className="space-y-6">
          {(["sport", "league", "team", "theme"] as const).map((family) => {
            const list = grouped[family];
            if (!list || list.length === 0) return null;
            return <FamilyTable key={family} family={family} rows={list} />;
          })}
        </div>
      ) : null}
    </section>
  );
}

function CountChip({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${className}`}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

function FamilyTable({ family, rows }: { family: string; rows: StatusRow[] }) {
  const title = family.charAt(0).toUpperCase() + family.slice(1);
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">
        {title} ({rows.length})
      </h3>
      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Code</th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Shopify handle</th>
              <th className="text-left px-3 py-2 font-medium">Tag rule</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.docId} className="border-t border-gray-100">
                <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.name || "—"}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{r.expectedHandle}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{r.tagRule}</td>
                <td className="px-3 py-1.5">
                  <StatusBadge status={r.status} error={r.error} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: StatusRow["status"]; error: string | null }) {
  switch (status) {
    case "created":
    case "already_exists":
      return (
        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
          synced
        </span>
      );
    case "not_synced":
    case "unknown":
      return (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
          not synced
        </span>
      );
    case "error":
      return (
        <span
          className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded cursor-help"
          title={error || "Unknown error"}
        >
          error
        </span>
      );
    case "dry_run":
      return (
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">dry run</span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}

function SyncSummaryPanel({ summary }: { summary: SyncSummaryRow[] }) {
  const created = summary.filter((r) => r.status === "created").length;
  const skipped = summary.filter((r) => r.status === "already_exists").length;
  const errored = summary.filter((r) => r.status === "error").length;
  const dryRun = summary.filter((r) => r.status === "dry_run").length;
  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
      <div className="font-medium text-blue-900">Sync summary</div>
      <div className="mt-1 text-xs text-blue-800">
        {dryRun > 0
          ? `${dryRun} would be created (dry run)`
          : `${created} created · ${skipped} already existed · ${errored} errored`}
      </div>
      {errored > 0 ? (
        <details className="mt-2">
          <summary className="text-xs text-blue-900 cursor-pointer">
            Show {errored} error{errored === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 text-xs text-red-800 font-mono space-y-0.5 max-h-40 overflow-y-auto">
            {summary
              .filter((r) => r.status === "error")
              .map((r) => (
                <li key={r.docId}>
                  {r.family}/{r.code}: {r.error}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
