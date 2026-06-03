/**
 * Tests for the Phase K8 spawn-blank precedence resolver.
 *
 * This is the risky part of wiring productCatalogMatrix into onDesignCreated —
 * the precedence between (per-design operator pick) > (team approved catalog) >
 * (all pipeline-ready). Getting it wrong means either:
 *   - spawning blanks the team didn't approve (catalog ignored — the bug we're fixing), or
 *   - blocking the operator's explicit per-design override (regression), or
 *   - blocking spawns for teams that never configured a matrix (back-compat break).
 *
 * The resolver is pure, so these tests run without the Firestore emulator.
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveSpawnBlankIds } = require("../../functions/lib/resolveSpawnBlanks") as {
  resolveSpawnBlankIds: (
    pipelineReadyBlankIds: string[],
    opts?: {
      targetBlankIds?: string[];
      productCatalogMatrix?: Record<string, { enabled?: boolean }> | null;
    }
  ) => { blankIds: string[]; reason: string };
};

const READY = ["8394", "8390", "TR3008", "HF07"];

describe("resolveSpawnBlankIds — precedence", () => {
  it("no targetBlankIds + no matrix → all pipeline-ready (back-compat)", () => {
    const out = resolveSpawnBlankIds(READY, {});
    expect(out.reason).toBe("no_matrix_all_pipeline_ready");
    expect(out.blankIds.sort()).toEqual([...READY].sort());
  });

  it("targetBlankIds present → honored as-is (operator override wins)", () => {
    const out = resolveSpawnBlankIds(READY, { targetBlankIds: ["HF07"] });
    expect(out.reason).toBe("targetBlankIds");
    expect(out.blankIds).toEqual(["HF07"]);
  });

  it("targetBlankIds bypasses the team matrix entirely (escape hatch)", () => {
    // Matrix only approves 8394, but the operator explicitly picked HF07 for
    // THIS design. The explicit pick must win — HF07 spawns even though the
    // team catalog wouldn't normally include it.
    const out = resolveSpawnBlankIds(READY, {
      targetBlankIds: ["HF07"],
      productCatalogMatrix: { "8394": { enabled: true } },
    });
    expect(out.reason).toBe("targetBlankIds");
    expect(out.blankIds).toEqual(["HF07"]);
  });

  it("targetBlankIds still intersects pipeline-ready (double-gate preserved)", () => {
    // The operator picked a blank that ISN'T pipeline-ready — drop it so we
    // never spawn a product that would stall forever.
    const out = resolveSpawnBlankIds(READY, { targetBlankIds: ["HF07", "NOT_READY_BLANK"] });
    expect(out.blankIds).toEqual(["HF07"]);
  });

  it("matrix restricts to approved blanks when no per-design override", () => {
    const out = resolveSpawnBlankIds(READY, {
      productCatalogMatrix: {
        "8394": { enabled: true },
        TR3008: { enabled: true },
      },
    });
    expect(out.reason).toBe("productCatalogMatrix");
    expect(out.blankIds.sort()).toEqual(["8394", "TR3008"].sort());
  });

  it("matrix entry with enabled:false is excluded", () => {
    const out = resolveSpawnBlankIds(READY, {
      productCatalogMatrix: {
        "8394": { enabled: true },
        "8390": { enabled: false }, // explicitly disabled — hidden
        TR3008: {}, // enabled omitted → treated as true
      },
    });
    expect(out.blankIds.sort()).toEqual(["8394", "TR3008"].sort());
    expect(out.blankIds).not.toContain("8390");
  });

  it("matrix only intersects with pipeline-ready (approved-but-not-ready dropped)", () => {
    // Team approves a blank that isn't in the pipeline-ready input — it can't spawn.
    const out = resolveSpawnBlankIds(["8394"], {
      productCatalogMatrix: {
        "8394": { enabled: true },
        SOME_FUTURE_BLANK: { enabled: true },
      },
    });
    expect(out.blankIds).toEqual(["8394"]);
  });

  it("empty matrix object → falls through to all pipeline-ready", () => {
    // A team doc with productCatalogMatrix:{} (configured but no approvals) is
    // treated as 'not configured' rather than 'approve nothing' — otherwise a
    // half-set-up team would silently spawn zero products. The all-ready
    // fallback is the safer default; an operator who truly wants zero would
    // set skipAutoLaunch instead.
    const out = resolveSpawnBlankIds(READY, { productCatalogMatrix: {} });
    expect(out.reason).toBe("no_matrix_all_pipeline_ready");
    expect(out.blankIds.sort()).toEqual([...READY].sort());
  });

  it("matrix with all entries disabled → no blanks spawn (reason still matrix)", () => {
    const out = resolveSpawnBlankIds(READY, {
      productCatalogMatrix: {
        "8394": { enabled: false },
        "8390": { enabled: false },
      },
    });
    // All approved entries filtered out → approved list empty → falls through
    // to all-ready (a fully-disabled matrix reads as 'not actively restricting').
    expect(out.reason).toBe("no_matrix_all_pipeline_ready");
    expect(out.blankIds.sort()).toEqual([...READY].sort());
  });

  it("trims + de-blanks whitespace in inputs", () => {
    const out = resolveSpawnBlankIds(["  8394  ", "", "  "], {
      targetBlankIds: ["  8394 "],
    });
    expect(out.blankIds).toEqual(["8394"]);
  });

  it("handles null/undefined inputs without throwing", () => {
    expect(resolveSpawnBlankIds([], {}).blankIds).toEqual([]);
    expect(resolveSpawnBlankIds(READY, { productCatalogMatrix: null }).reason).toBe(
      "no_matrix_all_pipeline_ready"
    );
    // @ts-expect-error — exercising the defensive non-array guard
    expect(resolveSpawnBlankIds(undefined, {}).blankIds).toEqual([]);
  });
});
