/**
 * Tests for `aggregateFalCosts` — the pure aggregator that powers the
 * dashboard cost-meter widget. The widget itself is just markup; the math /
 * bucketing / alert thresholds all live here.
 *
 * Reasoning behind the test fixtures:
 *   - Use a fixed `now` (2026-06-01T12:00) so day boundaries are deterministic
 *     across CI machines / local clocks.
 *   - Cover the four window boundaries: today / week / month / older.
 *   - Cover the unknown-cost path (null costUsd from price-table miss) —
 *     these get counted in `unknownCount` but contribute $0 to totals.
 *   - Cover the alert state transitions at 80% and 100% of threshold so a
 *     future threshold change doesn't break the widget's color logic.
 */
import { describe, it, expect } from "vitest";
import { aggregateFalCosts, FalCostRow } from "@/lib/dashboard/falCostMeter";

const NOW = new Date(2026, 5, 1, 12, 0); // June 1, 2026 — midday local

/** Helper to build a row at an offset from NOW. */
function row(opts: {
  costUsd: number | null;
  daysAgo: number;
  endpoint?: string | null;
  blankId?: string | null;
  source?: FalCostRow["source"];
  docId?: string;
}): FalCostRow {
  return {
    source: opts.source ?? "preview_job",
    docId: opts.docId ?? `doc_${opts.daysAgo}_${Math.random().toString(36).slice(2, 6)}`,
    endpoint: opts.endpoint === undefined ? "fal-ai/flux-pro/v1/fill" : opts.endpoint,
    costUsd: opts.costUsd,
    latencyMs: null,
    ranAt: new Date(NOW.getTime() - opts.daysAgo * 24 * 60 * 60 * 1000),
    blankId: opts.blankId === undefined ? "8394" : opts.blankId,
  };
}

describe("aggregateFalCosts — time windows", () => {
  it("today bucket includes today's spend only", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.05, daysAgo: 0 }), // today
        row({ costUsd: 0.05, daysAgo: 0 }), // today
        row({ costUsd: 0.05, daysAgo: 1 }), // yesterday — excluded from today
        row({ costUsd: 0.05, daysAgo: 10 }), // 10 days ago
      ],
      { now: NOW }
    );
    expect(data.totals.todayUsd).toBe(0.1);
  });

  it("week bucket includes last 7 days (incl. today)", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 1, daysAgo: 0 }),
        row({ costUsd: 1, daysAgo: 3 }),
        row({ costUsd: 1, daysAgo: 6 }), // boundary — still in week
        row({ costUsd: 1, daysAgo: 7 }), // boundary — OUT of week
        row({ costUsd: 1, daysAgo: 30 }),
      ],
      { now: NOW }
    );
    expect(data.totals.weekUsd).toBe(3); // days 0, 3, 6
  });

  it("month bucket includes last 30 days", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 1, daysAgo: 0 }),
        row({ costUsd: 1, daysAgo: 15 }),
        row({ costUsd: 1, daysAgo: 29 }), // boundary — still in month
        row({ costUsd: 1, daysAgo: 35 }), // out of month
      ],
      { now: NOW }
    );
    expect(data.totals.monthUsd).toBe(3);
  });

  it("allUsd counts everything (no window)", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.5, daysAgo: 0 }),
        row({ costUsd: 0.5, daysAgo: 50 }),
        row({ costUsd: 0.5, daysAgo: 365 }),
      ],
      { now: NOW }
    );
    expect(data.totals.allUsd).toBe(1.5);
  });

  it("rows arriving precisely AT today's midnight are included in today (no off-by-one)", () => {
    const todayMidnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    const data = aggregateFalCosts(
      [
        {
          source: "preview_job",
          docId: "edge-1",
          endpoint: "fal-ai/evf-sam",
          costUsd: 0.005,
          latencyMs: null,
          ranAt: todayMidnight, // exactly at boundary
          blankId: "8394",
        },
      ],
      { now: NOW }
    );
    expect(data.totals.todayUsd).toBe(0.01); // 0.005 rounded
  });
});

describe("aggregateFalCosts — alert threshold", () => {
  it("alertStatus is 'ok' below 80% of threshold", () => {
    const data = aggregateFalCosts(
      [row({ costUsd: 10, daysAgo: 0 })],
      { now: NOW, alertThresholdUsd: 25 }
    );
    // $10 < $20 (80% of $25)
    expect(data.alertStatus).toBe("ok");
  });

  it("alertStatus is 'approaching' between 80% and 100%", () => {
    const data = aggregateFalCosts(
      [row({ costUsd: 20, daysAgo: 0 })],
      { now: NOW, alertThresholdUsd: 25 }
    );
    // $20 = 80% of $25
    expect(data.alertStatus).toBe("approaching");
  });

  it("alertStatus is 'exceeded' at or above 100% of threshold", () => {
    const exactly = aggregateFalCosts(
      [row({ costUsd: 25, daysAgo: 0 })],
      { now: NOW, alertThresholdUsd: 25 }
    );
    expect(exactly.alertStatus).toBe("exceeded");

    const over = aggregateFalCosts(
      [row({ costUsd: 100, daysAgo: 0 })],
      { now: NOW, alertThresholdUsd: 25 }
    );
    expect(over.alertStatus).toBe("exceeded");
  });

  it("respects custom alert threshold", () => {
    const data = aggregateFalCosts(
      [row({ costUsd: 5, daysAgo: 0 })],
      { now: NOW, alertThresholdUsd: 5 }
    );
    expect(data.alertStatus).toBe("exceeded");
    expect(data.alertThresholdUsd).toBe(5);
  });
});

describe("aggregateFalCosts — unknown costs", () => {
  it("rows with null costUsd are counted but contribute $0", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.05, daysAgo: 0 }),
        row({ costUsd: null, daysAgo: 0 }), // unknown
        row({ costUsd: null, daysAgo: 5 }),
      ],
      { now: NOW }
    );
    expect(data.totals.todayUsd).toBe(0.05);
    expect(data.totals.unknownCount).toBe(2);
    expect(data.totals.totalCount).toBe(3);
  });

  it("null-cost rows still bucket by endpoint (count++, cost+=0)", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: null, endpoint: "fal-ai/some-new-endpoint", daysAgo: 0 }),
        row({ costUsd: null, endpoint: "fal-ai/some-new-endpoint", daysAgo: 0 }),
      ],
      { now: NOW }
    );
    const ep = data.byEndpoint.find((e) => e.endpoint === "fal-ai/some-new-endpoint");
    expect(ep).toBeDefined();
    expect(ep?.count).toBe(2);
    expect(ep?.costUsd).toBe(0);
  });

  it("rows with no endpoint bucket under 'unknown' key", () => {
    const data = aggregateFalCosts(
      [row({ costUsd: 0.01, endpoint: null, daysAgo: 0 })],
      { now: NOW }
    );
    const ep = data.byEndpoint.find((e) => e.endpoint === "unknown");
    expect(ep).toBeDefined();
    expect(ep?.costUsd).toBe(0.01);
  });
});

describe("aggregateFalCosts — grouping", () => {
  it("byEndpoint is sorted descending by spend", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.005, endpoint: "fal-ai/evf-sam", daysAgo: 0 }),
        row({ costUsd: 0.05, endpoint: "fal-ai/flux-pro/v1/fill", daysAgo: 0 }),
        row({ costUsd: 0.07, endpoint: "fal-ai/kling/v1-5/kolors-virtual-try-on", daysAgo: 0 }),
      ],
      { now: NOW }
    );
    expect(data.byEndpoint[0].endpoint).toBe("fal-ai/kling/v1-5/kolors-virtual-try-on");
    expect(data.byEndpoint[1].endpoint).toBe("fal-ai/flux-pro/v1/fill");
    expect(data.byEndpoint[2].endpoint).toBe("fal-ai/evf-sam");
  });

  it("byBlank is sorted descending by spend", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.05, blankId: "8390", daysAgo: 0 }),
        row({ costUsd: 0.05, blankId: "8394", daysAgo: 0 }),
        row({ costUsd: 0.05, blankId: "8394", daysAgo: 1 }),
      ],
      { now: NOW }
    );
    expect(data.byBlank[0].blankId).toBe("8394");
    expect(data.byBlank[0].count).toBe(2);
    expect(data.byBlank[1].blankId).toBe("8390");
  });

  it("byBlank skips rows with null blankId", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.05, blankId: null, daysAgo: 0 }),
        row({ costUsd: 0.05, blankId: "8394", daysAgo: 0 }),
      ],
      { now: NOW }
    );
    expect(data.byBlank.length).toBe(1);
    expect(data.byBlank[0].blankId).toBe("8394");
  });
});

describe("aggregateFalCosts — byDay sparkline", () => {
  it("emits one entry per day in window, sorted oldest → newest, with zeros for empty days", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 1, daysAgo: 0 }),
        row({ costUsd: 2, daysAgo: 3 }),
        // daysAgo 1, 2, 4, ... are empty
      ],
      { now: NOW, daysOfHistory: 5 }
    );
    expect(data.byDay).toHaveLength(5);
    // Oldest first, today last.
    expect(data.byDay[0].costUsd).toBe(0); // 4 days ago
    expect(data.byDay[1].costUsd).toBe(2); // 3 days ago
    expect(data.byDay[2].costUsd).toBe(0); // 2 days ago
    expect(data.byDay[3].costUsd).toBe(0); // 1 day ago
    expect(data.byDay[4].costUsd).toBe(1); // today
  });

  it("ISO date keys are local-time (YYYY-MM-DD)", () => {
    const data = aggregateFalCosts([row({ costUsd: 1, daysAgo: 0 })], {
      now: NOW,
      daysOfHistory: 1,
    });
    // NOW = 2026-06-01 local → byDay[0].date should be "2026-06-01"
    expect(data.byDay[0].date).toBe("2026-06-01");
  });

  it("default daysOfHistory is 14", () => {
    const data = aggregateFalCosts([], { now: NOW });
    expect(data.byDay).toHaveLength(14);
  });

  it("byDay does NOT include rows older than its window, but totals still do", () => {
    const data = aggregateFalCosts(
      [
        row({ costUsd: 100, daysAgo: 0 }),
        row({ costUsd: 100, daysAgo: 20 }), // outside daysOfHistory=5 but inside monthUsd
      ],
      { now: NOW, daysOfHistory: 5 }
    );
    const totalByDay = data.byDay.reduce((s, d) => s + d.costUsd, 0);
    expect(totalByDay).toBe(100); // only today's $100 in byDay
    expect(data.totals.monthUsd).toBe(200); // both still in monthUsd
    expect(data.totals.allUsd).toBe(200);
  });
});

describe("aggregateFalCosts — rounding (display precision)", () => {
  it("rounds all USD values to 2 decimal places", () => {
    // 0.005 × 3 = 0.015 → should round to 0.02
    const data = aggregateFalCosts(
      [
        row({ costUsd: 0.005, daysAgo: 0 }),
        row({ costUsd: 0.005, daysAgo: 0 }),
        row({ costUsd: 0.005, daysAgo: 0 }),
      ],
      { now: NOW }
    );
    expect(data.totals.todayUsd).toBe(0.02);
  });

  it("handles 0 spend cleanly (no NaN)", () => {
    const data = aggregateFalCosts([], { now: NOW });
    expect(data.totals.todayUsd).toBe(0);
    expect(data.totals.weekUsd).toBe(0);
    expect(data.totals.allUsd).toBe(0);
    expect(data.alertStatus).toBe("ok");
    expect(data.byEndpoint).toEqual([]);
    expect(data.byBlank).toEqual([]);
  });
});

describe("aggregateFalCosts — mixed sources", () => {
  it("counts mask spend and preview_job spend together", () => {
    const data = aggregateFalCosts(
      [
        row({ source: "preview_job", costUsd: 0.05, endpoint: "fal-ai/flux-pro/v1/fill", daysAgo: 0 }),
        row({ source: "blank_mask", costUsd: 0.005, endpoint: "fal-ai/evf-sam", daysAgo: 0 }),
      ],
      { now: NOW }
    );
    expect(data.totals.todayUsd).toBe(0.06);
    expect(data.byEndpoint.length).toBe(2);
    expect(data.byEndpoint[0].endpoint).toBe("fal-ai/flux-pro/v1/fill");
    expect(data.byEndpoint[1].endpoint).toBe("fal-ai/evf-sam");
  });
});
