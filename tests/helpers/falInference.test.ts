/**
 * Tests for the runFalInference wrapper. Mocks fetch to verify the submit →
 * poll → extract flow without hitting fal.ai. Covers the four real shapes
 * fal.ai endpoints return:
 *   1. Result inline in submit response (e.g. fast Flux Fill completion)
 *   2. Result inline in status response (most common queue mode)
 *   3. Result in a separate response_url fetch (status=COMPLETED, no inline)
 *   4. FAILED status → thrown error
 *
 * Also verifies cost lookup, latency measurement, and the price-table miss
 * path (returns null without throwing).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const falInference = require("../../functions/lib/falInference") as {
  runFalInference: (args: {
    endpoint: string;
    payload: Record<string, unknown>;
    falApiKey: string;
    fetchFn: typeof fetch;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  }) => Promise<{
    result: unknown;
    costUsd: number | null;
    latencyMs: number;
    endpoint: string;
    requestId: string | null;
  }>;
  lookupFalCostUsd: (endpoint: string) => number | null;
  FAL_ENDPOINT_PRICING: Record<string, { costUsd: number; notes: string }>;
};

/**
 * Tiny mock-fetch factory: takes a sequence of responses to return in order.
 * Each response is either a plain object (becomes JSON 200) or a custom
 * `{ status, body, json }` shape.
 */
function makeFetch(
  responses: Array<unknown | { status: number; body?: unknown; json?: unknown }>
) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    // Only treat the response as the HTTP-error shape when `status` is a NUMBER
    // (and a `body`/`json` companion is present). fal.ai job payloads also have
    // a string `status` field (IN_PROGRESS / COMPLETED / FAILED), so we can't
    // just check `"status" in r`.
    if (
      r &&
      typeof r === "object" &&
      "status" in (r as object) &&
      typeof (r as { status: unknown }).status === "number"
    ) {
      const obj = r as { status: number; json?: unknown; body?: unknown };
      return {
        ok: obj.status >= 200 && obj.status < 300,
        status: obj.status,
        json: async () => obj.json ?? obj.body ?? {},
        text: async () => JSON.stringify(obj.body ?? obj.json ?? {}),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => r,
      text: async () => JSON.stringify(r),
    } as unknown as Response;
  });
}

describe("runFalInference — wrapper behavior", () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  beforeEach(() => {
    fetchMock = vi.fn() as ReturnType<typeof makeFetch>;
  });

  it("returns result inline when submit response has images", async () => {
    fetchMock = makeFetch([
      {
        request_id: "req-abc",
        images: [{ url: "https://example.com/img.png" }],
      },
    ]);
    const out = await falInference.runFalInference({
      endpoint: "fal-ai/flux-pro/v1/fill",
      payload: { image_url: "x" },
      falApiKey: "test-key",
      fetchFn: fetchMock,
    });
    expect(out.requestId).toBe("req-abc");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no polling needed
    expect(out.endpoint).toBe("fal-ai/flux-pro/v1/fill");
    expect(out.costUsd).toBe(0.05); // from price table
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray((out.result as { images: unknown[] }).images)).toBe(true);
  });

  it("polls until status payload contains images", async () => {
    fetchMock = makeFetch([
      // 1. Submit returns request_id + status_url (no inline result)
      {
        request_id: "req-def",
        status_url: "https://queue.fal.run/fal-ai/evf-sam/requests/req-def/status",
        status: "IN_PROGRESS",
      },
      // 2. First poll: still in progress
      { status: "IN_PROGRESS" },
      // 3. Second poll: completed with inline images
      { status: "COMPLETED", images: [{ url: "https://example.com/mask.png" }] },
    ]);
    const out = await falInference.runFalInference({
      endpoint: "fal-ai/evf-sam",
      payload: { image_url: "x", prompt: "chest" },
      falApiKey: "test-key",
      fetchFn: fetchMock,
      pollIntervalMs: 1, // speed up test
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out.costUsd).toBe(0.005); // SAM price
    expect(Array.isArray((out.result as { images: unknown[] }).images)).toBe(true);
  });

  it("fetches response_url when status=COMPLETED has no inline images", async () => {
    fetchMock = makeFetch([
      // 1. Submit
      {
        request_id: "req-ghi",
        status_url: "https://queue.fal.run/x/requests/req-ghi/status",
        response_url: "https://queue.fal.run/x/requests/req-ghi",
      },
      // 2. Poll → COMPLETED with no images inline
      { status: "COMPLETED" },
      // 3. Fetch response_url for the actual result
      { images: [{ url: "https://example.com/result.png" }] },
    ]);
    const out = await falInference.runFalInference({
      endpoint: "fal-ai/flux-pro/v1/fill",
      payload: { image_url: "x" },
      falApiKey: "test-key",
      fetchFn: fetchMock,
      pollIntervalMs: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Array.isArray((out.result as { images: unknown[] }).images)).toBe(true);
  });

  it("throws on FAILED status", async () => {
    fetchMock = makeFetch([
      {
        request_id: "req-jkl",
        status_url: "https://queue.fal.run/x/requests/req-jkl/status",
      },
      { status: "FAILED", error: "model crashed" },
    ]);
    await expect(
      falInference.runFalInference({
        endpoint: "fal-ai/evf-sam",
        payload: {},
        falApiKey: "test-key",
        fetchFn: fetchMock,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow(/FAILED.*model crashed/);
  });

  it("throws on submit HTTP error", async () => {
    fetchMock = makeFetch([{ status: 401, body: { error: "unauthorized" } }]);
    await expect(
      falInference.runFalInference({
        endpoint: "fal-ai/evf-sam",
        payload: {},
        falApiKey: "bad-key",
        fetchFn: fetchMock,
      })
    ).rejects.toThrow(/submit failed.*401/);
  });

  it("times out after maxPollAttempts", async () => {
    fetchMock = makeFetch([
      {
        request_id: "req-mno",
        status_url: "https://queue.fal.run/x/requests/req-mno/status",
      },
      ...Array(10).fill({ status: "IN_PROGRESS" }),
    ]);
    await expect(
      falInference.runFalInference({
        endpoint: "fal-ai/evf-sam",
        payload: {},
        falApiKey: "test-key",
        fetchFn: fetchMock,
        pollIntervalMs: 1,
        maxPollAttempts: 3,
      })
    ).rejects.toThrow(/poll timeout/);
  });

  it("returns null cost for unknown endpoints (doesn't throw)", async () => {
    fetchMock = makeFetch([
      { images: [{ url: "x" }] }, // immediate completion
    ]);
    const out = await falInference.runFalInference({
      endpoint: "fal-ai/some-future-model-not-yet-priced",
      payload: {},
      falApiKey: "test-key",
      fetchFn: fetchMock,
    });
    expect(out.costUsd).toBeNull();
    expect(out.endpoint).toBe("fal-ai/some-future-model-not-yet-priced");
  });

  it("measures latency monotonically", async () => {
    fetchMock = makeFetch([
      {
        request_id: "req-pqr",
        status_url: "https://queue.fal.run/x/requests/req-pqr/status",
      },
      { status: "IN_PROGRESS" },
      { status: "COMPLETED", images: [{ url: "x" }] },
    ]);
    const out = await falInference.runFalInference({
      endpoint: "fal-ai/evf-sam",
      payload: {},
      falApiKey: "test-key",
      fetchFn: fetchMock,
      pollIntervalMs: 5,
    });
    // At least one poll interval should have elapsed (~5ms × 2 polls = 10ms).
    expect(out.latencyMs).toBeGreaterThanOrEqual(5);
  });
});

describe("FAL_ENDPOINT_PRICING table", () => {
  it("has entries for every endpoint Rally currently uses", () => {
    // The four endpoints that exist in code today (and a few Phase B/C targets).
    expect(falInference.lookupFalCostUsd("fal-ai/flux-pro/v1/fill")).toBe(0.05);
    expect(falInference.lookupFalCostUsd("fal-ai/evf-sam")).toBe(0.005);
    expect(falInference.lookupFalCostUsd("fal-ai/kling/v1-5/kolors-virtual-try-on")).toBe(0.07);
    expect(falInference.lookupFalCostUsd("fal-ai/flux-pro/kontext")).toBe(0.04);
  });

  it("returns null + warns for unknown endpoints", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(falInference.lookupFalCostUsd("fal-ai/definitely-not-real")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("every price entry has a non-empty notes field (audit trail)", () => {
    for (const [endpoint, entry] of Object.entries(falInference.FAL_ENDPOINT_PRICING)) {
      expect(entry.costUsd, `${endpoint} has a numeric cost`).toBeTypeOf("number");
      expect(entry.notes, `${endpoint} has notes`).toBeTruthy();
    }
  });
});
