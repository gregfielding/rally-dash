/**
 * Phase A Day 4 — fal.ai cost meter.
 *
 * Two parts:
 *
 * 1. `aggregateFalCosts(rows, opts)`: pure function that takes raw job/mask
 *    rows and produces the shape the dashboard widget renders. Pure so it's
 *    trivially unit-tested without Firestore. The widget never does any math
 *    inline — every total/grouping/alert decision lives here.
 *
 * 2. `useFalCostMeter()`: React hook that subscribes to recent rp_blank_preview_jobs
 *    + rp_blank_masks (last 30 days), normalizes them into `FalCostRow[]`, and
 *    runs them through the aggregator on every change.
 *
 * Why two collections: Phase A stamped cost on BOTH the realism job
 * (rp_blank_preview_jobs.falCostUsd) and the SAM mask doc
 * (rp_blank_masks.falCostUsd). Each represents a real fal.ai call — both
 * count toward spend.
 *
 * Time windows are computed via plain Date arithmetic (no timezone library) —
 * "today" = local midnight to local midnight. Good enough for a one-operator
 * tool; if Rally ever has a finance team that needs exact UTC daily cuts,
 * swap to date-fns-tz here.
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

/** One row of fal.ai spend, normalized across the two source collections. */
export interface FalCostRow {
  /** Which collection this came from — useful for drill-down + future filters. */
  source: "preview_job" | "blank_mask";
  /** Doc id in the source collection (linkable). */
  docId: string;
  /** fal.ai endpoint slug, e.g. `fal-ai/flux-pro/v1/fill`. Null when the older doc didn't record it. */
  endpoint: string | null;
  /** Cost in USD. Null when the price table didn't know the endpoint (treated as "unknown" in aggregates). */
  costUsd: number | null;
  /** Latency in ms. Optional — only used for averages, not totals. */
  latencyMs: number | null;
  /** Wall-clock when this call ran (or its job doc was created). Used for day/week/month bucketing. */
  ranAt: Date;
  /** Blank this call was associated with (for per-blank spend grouping). Null when not derivable. */
  blankId: string | null;
}

export interface AggregatedFalCosts {
  /** Total spend across windows. `unknown` counts rows whose costUsd was null. */
  totals: {
    todayUsd: number;
    weekUsd: number;
    monthUsd: number;
    allUsd: number;
    /** Number of rows we saw but couldn't price (null costUsd). */
    unknownCount: number;
    /** Total number of rows in the input. */
    totalCount: number;
  };
  /** Top endpoints by spend (descending). */
  byEndpoint: Array<{ endpoint: string; count: number; costUsd: number }>;
  /** Top blanks by spend (descending). */
  byBlank: Array<{ blankId: string; count: number; costUsd: number }>;
  /** Per-day breakdown for the last `daysOfHistory` days (oldest → newest). */
  byDay: Array<{ date: string; costUsd: number; count: number }>;
  /** "ok" → today's spend below threshold. "approaching" → ≥ 80% of threshold. "exceeded" → ≥ threshold. */
  alertStatus: "ok" | "approaching" | "exceeded";
  /** Whatever threshold the caller passed in (echoed so the widget can show "$15 / $25"). */
  alertThresholdUsd: number;
}

export interface AggregateOpts {
  /** Daily spend threshold for alerting. Default: $25. */
  alertThresholdUsd?: number;
  /** How many days of history to bucket in `byDay`. Default: 14. */
  daysOfHistory?: number;
  /** Override "now" — used in tests to make assertions deterministic. */
  now?: Date;
}

/**
 * Pure aggregator. Given a flat list of fal.ai spend rows, returns the
 * dashboard-ready shape. No Firestore, no React — testable in isolation.
 *
 * Decisions baked in:
 *   - "Today/week/month" are local-time windows ending at `now`.
 *   - Rows with null `costUsd` are counted (so the operator sees there were N
 *     un-priced calls) but contribute $0 to totals — undercount, not overcount,
 *     since we don't actually know what they cost.
 *   - Rows older than `daysOfHistory` are excluded from byDay but still
 *     contribute to allUsd / byEndpoint / byBlank — totals are over the FULL
 *     input set, byDay is just for the trend chart.
 */
export function aggregateFalCosts(
  rows: FalCostRow[],
  opts: AggregateOpts = {}
): AggregatedFalCosts {
  const alertThresholdUsd = opts.alertThresholdUsd ?? 25;
  const daysOfHistory = opts.daysOfHistory ?? 14;
  const now = opts.now ?? new Date();

  /** Build the time-bucket boundaries. */
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000); // last 7 days incl. today
  const monthStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000); // last 30 days incl. today
  const historyStart = new Date(todayStart.getTime() - (daysOfHistory - 1) * 24 * 60 * 60 * 1000);

  let todayUsd = 0;
  let weekUsd = 0;
  let monthUsd = 0;
  let allUsd = 0;
  let unknownCount = 0;
  const endpointMap = new Map<string, { count: number; costUsd: number }>();
  const blankMap = new Map<string, { count: number; costUsd: number }>();
  const dayMap = new Map<string, { costUsd: number; count: number }>();

  for (const r of rows) {
    const cost = r.costUsd ?? 0;
    const isUnknown = r.costUsd == null;
    if (isUnknown) unknownCount += 1;

    allUsd += cost;
    if (r.ranAt >= monthStart) monthUsd += cost;
    if (r.ranAt >= weekStart) weekUsd += cost;
    if (r.ranAt >= todayStart) todayUsd += cost;

    const ep = r.endpoint ?? "unknown";
    const epEntry = endpointMap.get(ep) ?? { count: 0, costUsd: 0 };
    epEntry.count += 1;
    epEntry.costUsd += cost;
    endpointMap.set(ep, epEntry);

    if (r.blankId) {
      const bEntry = blankMap.get(r.blankId) ?? { count: 0, costUsd: 0 };
      bEntry.count += 1;
      bEntry.costUsd += cost;
      blankMap.set(r.blankId, bEntry);
    }

    if (r.ranAt >= historyStart) {
      const dayKey = isoDate(r.ranAt);
      const dEntry = dayMap.get(dayKey) ?? { costUsd: 0, count: 0 };
      dEntry.costUsd += cost;
      dEntry.count += 1;
      dayMap.set(dayKey, dEntry);
    }
  }

  /** Build the byDay array with zeros for empty days so the sparkline doesn't skip gaps. */
  const byDay: AggregatedFalCosts["byDay"] = [];
  for (let i = daysOfHistory - 1; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    const dayKey = isoDate(d);
    const entry = dayMap.get(dayKey) ?? { costUsd: 0, count: 0 };
    byDay.push({ date: dayKey, ...entry });
  }

  const byEndpoint = [...endpointMap.entries()]
    .map(([endpoint, { count, costUsd }]) => ({ endpoint, count, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const byBlank = [...blankMap.entries()]
    .map(([blankId, { count, costUsd }]) => ({ blankId, count, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  let alertStatus: AggregatedFalCosts["alertStatus"] = "ok";
  if (todayUsd >= alertThresholdUsd) alertStatus = "exceeded";
  else if (todayUsd >= alertThresholdUsd * 0.8) alertStatus = "approaching";

  return {
    totals: {
      todayUsd: round2(todayUsd),
      weekUsd: round2(weekUsd),
      monthUsd: round2(monthUsd),
      allUsd: round2(allUsd),
      unknownCount,
      totalCount: rows.length,
    },
    byEndpoint: byEndpoint.map((e) => ({ ...e, costUsd: round2(e.costUsd) })),
    byBlank: byBlank.map((b) => ({ ...b, costUsd: round2(b.costUsd) })),
    byDay: byDay.map((d) => ({ ...d, costUsd: round2(d.costUsd) })),
    alertStatus,
    alertThresholdUsd,
  };
}

/** Local-date ISO key (YYYY-MM-DD) without timezone shifts. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Round to 2 decimal places. Pure cents-precision for display. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * React hook: subscribe to recent rp_blank_preview_jobs + rp_blank_masks,
 * normalize into FalCostRow[], aggregate, return.
 *
 * Performance: each collection is filtered server-side to the last 30 days
 * (the longest window the aggregator cares about), so the document set is
 * bounded by Rally's daily throughput, not by historic accumulation. No
 * composite index needed — the filter is a single field (createdAt for jobs,
 * updatedAt for masks).
 */
export function useFalCostMeter(opts: AggregateOpts = {}): {
  data: AggregatedFalCosts | null;
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<FalCostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setError("Firestore not initialized");
      return;
    }
    const thirtyDaysAgo = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);

    /**
     * Use a shared accumulator + per-source replace so each snapshot just
     * refreshes its own slice. Without this, the two subscriptions would
     * fight each other (each one calling setRows replaces the other's data).
     */
    const sourceRows: Record<"preview_job" | "blank_mask", FalCostRow[]> = {
      preview_job: [],
      blank_mask: [],
    };
    const flush = () => setRows([...sourceRows.preview_job, ...sourceRows.blank_mask]);

    const jobsUnsub = onSnapshot(
      query(collection(db, "rp_blank_preview_jobs"), where("createdAt", ">=", thirtyDaysAgo)),
      (snap) => {
        sourceRows.preview_job = snap.docs.map(jobDocToFalCostRow).filter(Boolean) as FalCostRow[];
        flush();
      },
      (err) => setError(`rp_blank_preview_jobs: ${err.message}`)
    );

    const masksUnsub = onSnapshot(
      query(collection(db, "rp_blank_masks"), where("updatedAt", ">=", thirtyDaysAgo)),
      (snap) => {
        sourceRows.blank_mask = snap.docs.map(maskDocToFalCostRow).filter(Boolean) as FalCostRow[];
        flush();
      },
      (err) => setError(`rp_blank_masks: ${err.message}`)
    );

    return () => {
      jobsUnsub();
      masksUnsub();
    };
  }, []);

  const data = rows === null ? null : aggregateFalCosts(rows, opts);
  return { data, loading: rows === null, error };
}

/** Pick the most reliable timestamp from a Firestore doc snapshot. */
function timestampToDate(t: unknown): Date | null {
  if (!t) return null;
  if (t instanceof Date) return t;
  const x = t as { toMillis?: () => number; seconds?: number };
  if (typeof x.toMillis === "function") return new Date(x.toMillis());
  if (typeof x.seconds === "number") return new Date(x.seconds * 1000);
  return null;
}

interface FirestoreDocSnap {
  id: string;
  data: () => Record<string, unknown>;
}

function jobDocToFalCostRow(snap: FirestoreDocSnap): FalCostRow | null {
  const d = snap.data();
  const ranAt = timestampToDate(d.createdAt);
  if (!ranAt) return null;
  return {
    source: "preview_job",
    docId: snap.id,
    endpoint: typeof d.falEndpoint === "string" ? d.falEndpoint : null,
    costUsd: typeof d.falCostUsd === "number" ? d.falCostUsd : null,
    latencyMs: typeof d.falLatencyMs === "number" ? d.falLatencyMs : null,
    ranAt,
    blankId: typeof d.blankId === "string" ? d.blankId : null,
  };
}

function maskDocToFalCostRow(snap: FirestoreDocSnap): FalCostRow | null {
  const d = snap.data();
  /** Use lockedAt > updatedAt > createdAt fallback. lockedAt is when the operator committed the mask. */
  const ranAt =
    timestampToDate(d.lockedAt) ||
    timestampToDate(d.updatedAt) ||
    timestampToDate(d.createdAt);
  if (!ranAt) return null;
  return {
    source: "blank_mask",
    docId: snap.id,
    endpoint: typeof d.falEndpoint === "string" ? d.falEndpoint : null,
    costUsd: typeof d.falCostUsd === "number" ? d.falCostUsd : null,
    latencyMs: typeof d.falLatencyMs === "number" ? d.falLatencyMs : null,
    ranAt,
    blankId: typeof d.blankId === "string" ? d.blankId : null,
  };
}
