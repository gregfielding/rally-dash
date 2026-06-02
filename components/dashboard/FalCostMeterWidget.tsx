"use client";

/**
 * Dashboard widget rendering Phase A cost-meter data.
 *
 * Visual hierarchy (most important first):
 *   1. Today's spend (huge), with alert color when ≥ threshold.
 *   2. Week / month / all-time totals (small).
 *   3. 14-day mini sparkline (visual trend at a glance).
 *   4. Top endpoints + top blanks (drill-down for "what's expensive?").
 *
 * The widget is intentionally read-only — operators tune fal.ai spend by
 * generating fewer previews / using cheaper endpoints, not by editing
 * numbers in the dashboard. Settings (threshold) live in user prefs or
 * env eventually; for now the threshold is the hook default ($25/day).
 */

import { useFalCostMeter, AggregatedFalCosts } from "@/lib/dashboard/falCostMeter";

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function FalCostMeterWidget() {
  const { data, loading, error } = useFalCostMeter();

  if (loading) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">fal.ai spend</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">Loading cost data…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white rounded-lg shadow border border-red-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-red-200">
          <h3 className="text-lg font-semibold text-red-700">fal.ai spend — error</h3>
        </div>
        <div className="p-4 text-sm text-red-700">{error}</div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">fal.ai spend</h3>
        <span className="text-xs text-gray-500">
          Threshold {fmtUsd(data.alertThresholdUsd)}/day
        </span>
      </div>
      <div className="p-4 space-y-6">
        <TotalsRow data={data} />
        <Sparkline data={data} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EndpointTable data={data} />
          <BlankTable data={data} />
        </div>
        {data.totals.unknownCount > 0 ? (
          <p className="text-xs text-amber-700">
            {data.totals.unknownCount} call{data.totals.unknownCount === 1 ? "" : "s"} with unknown
            cost — endpoint missing from price table.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function TotalsRow({ data }: { data: AggregatedFalCosts }) {
  const alertClass =
    data.alertStatus === "exceeded"
      ? "text-red-700"
      : data.alertStatus === "approaching"
      ? "text-amber-700"
      : "text-gray-900";
  const alertLabel =
    data.alertStatus === "exceeded"
      ? "over threshold"
      : data.alertStatus === "approaching"
      ? "approaching threshold"
      : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Today</div>
        <div className={`text-3xl font-bold ${alertClass}`}>
          {fmtUsd(data.totals.todayUsd)}
        </div>
        {alertLabel ? (
          <div className={`text-xs mt-1 ${alertClass}`}>{alertLabel}</div>
        ) : null}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Last 7 days</div>
        <div className="text-2xl font-semibold text-gray-900">
          {fmtUsd(data.totals.weekUsd)}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Last 30 days</div>
        <div className="text-2xl font-semibold text-gray-900">
          {fmtUsd(data.totals.monthUsd)}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">All time*</div>
        <div className="text-2xl font-semibold text-gray-900">
          {fmtUsd(data.totals.allUsd)}
        </div>
        <div className="text-xs text-gray-400">{data.totals.totalCount} calls</div>
      </div>
    </div>
  );
}

/**
 * Inline SVG sparkline of the last `byDay.length` days. Avoids pulling in
 * recharts/d3 — the visual carries no axes, just the trend shape. Hover over
 * any day shows its dollar amount via the title attribute.
 */
function Sparkline({ data }: { data: AggregatedFalCosts }) {
  const max = Math.max(...data.byDay.map((d) => d.costUsd), 0.01);
  const w = 600;
  const h = 60;
  const stepX = w / Math.max(data.byDay.length - 1, 1);
  const points = data.byDay
    .map((d, i) => {
      const x = i * stepX;
      const y = h - (d.costUsd / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const todayKey = data.byDay[data.byDay.length - 1]?.date;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        {data.byDay.length}-day trend
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-16 text-blue-500"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points}
        />
        {data.byDay.map((d, i) => {
          const x = i * stepX;
          const y = h - (d.costUsd / max) * h;
          const isToday = d.date === todayKey;
          return (
            <circle
              key={d.date}
              cx={x}
              cy={y}
              r={isToday ? 3 : 1.5}
              fill={isToday ? "#dc2626" : "#3b82f6"}
            >
              <title>{`${d.date}: ${fmtUsd(d.costUsd)} (${d.count} calls)`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{data.byDay[0]?.date}</span>
        <span>{todayKey}</span>
      </div>
    </div>
  );
}

function EndpointTable({ data }: { data: AggregatedFalCosts }) {
  const top = data.byEndpoint.slice(0, 6);
  if (top.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">By endpoint</div>
        <p className="text-sm text-gray-500">No spend recorded.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">By endpoint</div>
      <ul className="divide-y divide-gray-100">
        {top.map((e) => (
          <li key={e.endpoint} className="py-1.5 flex items-center justify-between text-sm">
            <span className="font-mono text-xs text-gray-700 truncate" title={e.endpoint}>
              {e.endpoint}
            </span>
            <span className="text-gray-900 ml-2 whitespace-nowrap">
              {fmtUsd(e.costUsd)}{" "}
              <span className="text-gray-400 text-xs">· {e.count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlankTable({ data }: { data: AggregatedFalCosts }) {
  const top = data.byBlank.slice(0, 6);
  if (top.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">By blank</div>
        <p className="text-sm text-gray-500">No blank-tagged spend.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">By blank</div>
      <ul className="divide-y divide-gray-100">
        {top.map((b) => (
          <li key={b.blankId} className="py-1.5 flex items-center justify-between text-sm">
            <span className="text-gray-700">{b.blankId}</span>
            <span className="text-gray-900 ml-2 whitespace-nowrap">
              {fmtUsd(b.costUsd)}{" "}
              <span className="text-gray-400 text-xs">· {b.count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
