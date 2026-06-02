/**
 * Tests for Phase E batch helpers — concurrency limiter + endpoint table.
 *
 * What's covered here:
 *   - createConcurrencyLimiter: bounded parallelism, queueing past capacity,
 *     queue drains in FIFO order, capacity validation.
 *   - withEndpointLimit + FAL_ENDPOINT_LIMITERS: every fal.ai endpoint Rally
 *     uses has a configured limiter. Unknown endpoints pass through unbounded.
 *
 * What's NOT covered here:
 *   - createBatchAtomically: requires firebase-admin's Firestore batch writer.
 *     Mocked end-to-end via Firestore emulator is the right test layer; we
 *     verify behavior manually in Phase E6 verification instead.
 *   - incrementBatchCounters: requires Firestore transactions. Same as above.
 */
import { describe, it, expect, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const batchHelpers = require("../../functions/lib/batchHelpers") as {
  createConcurrencyLimiter: (capacity: number) => {
    run: <T>(fn: () => Promise<T>) => Promise<T>;
    stats: () => { active: number; queued: number; capacity: number };
  };
  withEndpointLimit: <T>(endpoint: string, fn: () => Promise<T>) => Promise<T>;
  FAL_ENDPOINT_LIMITERS: Record<string, unknown>;
};

describe("createConcurrencyLimiter", () => {
  it("rejects non-positive capacity", () => {
    expect(() => batchHelpers.createConcurrencyLimiter(0)).toThrowError(/capacity must be >= 1/);
    expect(() => batchHelpers.createConcurrencyLimiter(-1)).toThrowError(/capacity must be >= 1/);
    expect(() => batchHelpers.createConcurrencyLimiter(Number.NaN)).toThrowError(/capacity must be >= 1/);
  });

  it("runs fn immediately when below capacity", async () => {
    const limiter = batchHelpers.createConcurrencyLimiter(3);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
    /** Slot released after completion — back to zero active. */
    expect(limiter.stats().active).toBe(0);
  });

  it("never exceeds capacity (concurrent dispatch)", async () => {
    const capacity = 4;
    const limiter = batchHelpers.createConcurrencyLimiter(capacity);
    let peakActive = 0;
    const tasks = Array.from({ length: 20 }, (_, i) =>
      limiter.run(async () => {
        peakActive = Math.max(peakActive, limiter.stats().active);
        await new Promise((r) => setTimeout(r, 5));
        return i;
      })
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peakActive).toBeLessThanOrEqual(capacity);
  });

  it("queues tasks past capacity (FIFO order)", async () => {
    const limiter = batchHelpers.createConcurrencyLimiter(1);
    const order: number[] = [];
    /**
     * Dispatch 4 tasks at once. With capacity=1 they run serially in submit
     * order; FIFO queue means [0, 1, 2, 3].
     */
    const tasks = [0, 1, 2, 3].map((i) =>
      limiter.run(async () => {
        order.push(i);
        await new Promise((r) => setTimeout(r, 5));
      })
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("releases a slot even if fn throws", async () => {
    const limiter = batchHelpers.createConcurrencyLimiter(1);
    await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow(/boom/);
    /** Limiter must still be usable — a thrown error in fn shouldn't deadlock subsequent calls. */
    const result = await limiter.run(async () => "recovered");
    expect(result).toBe("recovered");
    expect(limiter.stats().active).toBe(0);
  });

  it("stats reports active + queued + capacity", async () => {
    const limiter = batchHelpers.createConcurrencyLimiter(2);
    /** Hold one slot; start a second; start a third that queues. */
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = limiter.run(
      () => new Promise<void>((resolve) => { releaseFirst = resolve; })
    );
    const second = limiter.run(
      () => new Promise<void>((resolve) => { releaseSecond = resolve; })
    );
    /** Yield once so both have acquired slots. */
    await new Promise((r) => setTimeout(r, 1));
    const queuedTask = limiter.run(async () => "q");
    await new Promise((r) => setTimeout(r, 1));
    const stats = limiter.stats();
    expect(stats.capacity).toBe(2);
    expect(stats.active).toBe(2);
    expect(stats.queued).toBe(1);
    releaseFirst();
    releaseSecond();
    await Promise.all([first, second, queuedTask]);
  });
});

describe("FAL_ENDPOINT_LIMITERS — every Rally endpoint has a limiter", () => {
  it("covers all production fal.ai endpoints", () => {
    /** Match Phase A's FAL_ENDPOINT_PRICING table — every priced endpoint should be limited too. */
    const required = [
      "fal-ai/evf-sam",
      "fal-ai/flux-pro/v1/fill",
      "fal-ai/flux-pro/kontext",
      "fal-ai/kling/v1-5/kolors-virtual-try-on",
    ];
    for (const endpoint of required) {
      expect(
        batchHelpers.FAL_ENDPOINT_LIMITERS[endpoint],
        `${endpoint} has a limiter`
      ).toBeDefined();
    }
  });
});

describe("withEndpointLimit", () => {
  it("runs the thunk through the matching limiter", async () => {
    const result = await batchHelpers.withEndpointLimit("fal-ai/evf-sam", async () => "ok");
    expect(result).toBe("ok");
  });

  it("passes through unbounded for unknown endpoints (back-compat)", async () => {
    /**
     * Unknown endpoints don't have a limiter — withEndpointLimit must NOT
     * throw, just run the thunk directly. Otherwise adding a new fal.ai
     * model would break runFalInference until the table is updated.
     */
    const result = await batchHelpers.withEndpointLimit(
      "fal-ai/unregistered-future-endpoint",
      async () => "still ran"
    );
    expect(result).toBe("still ran");
  });

  it("propagates errors from the thunk", async () => {
    await expect(
      batchHelpers.withEndpointLimit("fal-ai/evf-sam", async () => {
        throw new Error("upstream failure");
      })
    ).rejects.toThrow(/upstream failure/);
  });
});
