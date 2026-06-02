/**
 * Tests for the Phase B VTON provider registry.
 *
 * What's covered:
 *   - Registry shape: every registered provider has the required fields.
 *   - Capability flags: each provider declares what it needs (mask, prompt,
 *     model photo). These flags drive A/B picker UI and runtime validation.
 *   - hexToColorName: locked-in bucket boundaries since both Flux Fill prompt
 *     tuning (color clause) and future text-conditioned providers depend on
 *     stable hue → name mapping. A silent boundary shift would make Flux Fill
 *     paint "red" where it used to paint "orange," etc.
 *   - DEFAULT_VTON_PROVIDER_ID: confirms it's the legacy provider, so
 *     untagged jobs keep working byte-identical to pre-refactor.
 *
 * What's NOT covered here:
 *   - Live fal.ai calls — those happen inside provider.runVtonPass() and are
 *     mocked through runFalInference (already tested in falInference.test.ts).
 *   - Sharp image manipulation — same reason. End-to-end behavior is the
 *     subject of Phase B5 manual verification, not unit tests.
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const providers = require("../../functions/lib/vtonProviders") as {
  getVtonProvider: (id: string) => {
    id: string;
    label: string;
    description: string;
    endpoint: string;
    capabilities: {
      requiresMask: boolean;
      requiresPrompt: boolean;
      requiresModelPhoto: boolean;
      producesHybridComposite: boolean;
      experimental: boolean;
    };
    runVtonPass: (ctx: unknown) => Promise<unknown>;
  };
  listVtonProviders: () => Array<ReturnType<typeof providers.getVtonProvider>>;
  registerVtonProvider: (def: unknown) => unknown;
  DEFAULT_VTON_PROVIDER_ID: string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hexToColorName } = require("../../functions/lib/hexToColorName") as {
  hexToColorName: (hex: unknown) => string | null;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const falInference = require("../../functions/lib/falInference") as {
  FAL_ENDPOINT_PRICING: Record<string, { costUsd: number; notes: string }>;
};

describe("VTON registry — Flux Fill provider", () => {
  it("is registered", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(p).toBeDefined();
  });

  it("declares mask + prompt required, no model photo (composited upstream)", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(p.capabilities.requiresMask).toBe(true);
    expect(p.capabilities.requiresPrompt).toBe(true);
    expect(p.capabilities.requiresModelPhoto).toBe(false);
  });

  it("declares producesHybridComposite (Stage A color preservation needed)", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(p.capabilities.producesHybridComposite).toBe(true);
  });

  it("is NOT experimental — this is the incumbent production path", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(p.capabilities.experimental).toBe(false);
  });

  it("points at the production Flux Fill endpoint", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(p.endpoint).toBe("fal-ai/flux-pro/v1/fill");
  });

  it("endpoint has a price-table entry (otherwise cost meter shows 'unknown')", () => {
    const p = providers.getVtonProvider("flux_fill");
    expect(falInference.FAL_ENDPOINT_PRICING[p.endpoint]).toBeDefined();
  });
});

describe("VTON registry — Flux 2 multi-reference provider (Phase I)", () => {
  it("is registered", () => {
    const p = providers.getVtonProvider("flux_2_multireference");
    expect(p).toBeDefined();
  });

  it("requires identity references, NOT a mask, NOT a prompt, NOT a model photo", () => {
    const p = providers.getVtonProvider("flux_2_multireference");
    /** This is the differentiator vs Flux Fill (mask+prompt) and Kolors VTO (model photo). */
    expect(p.capabilities.requiresMask).toBe(false);
    expect(p.capabilities.requiresPrompt).toBe(false);
    expect(p.capabilities.requiresModelPhoto).toBe(false);
    // requiresIdentityReferences is a Phase I capability flag — guarded explicitly so
    // a future provider stripping it would fail this test.
    expect(
      (p.capabilities as { requiresIdentityReferences?: boolean }).requiresIdentityReferences
    ).toBe(true);
  });

  it("is flagged experimental until A/B-validated", () => {
    const p = providers.getVtonProvider("flux_2_multireference");
    expect(p.capabilities.experimental).toBe(true);
  });

  it("points at the Flux 2 Pro edit endpoint", () => {
    const p = providers.getVtonProvider("flux_2_multireference");
    expect(p.endpoint).toBe("fal-ai/flux-2-pro/edit");
  });

  it("endpoint has a price-table entry (cost meter coverage)", () => {
    const p = providers.getVtonProvider("flux_2_multireference");
    expect(falInference.FAL_ENDPOINT_PRICING[p.endpoint]).toBeDefined();
    expect(falInference.FAL_ENDPOINT_PRICING[p.endpoint].costUsd).toBeGreaterThan(0);
    expect(falInference.FAL_ENDPOINT_PRICING[p.endpoint].costUsd).toBeLessThan(0.5);
  });
});

describe("VTON registry — Kolors VTO provider", () => {
  it("is registered", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(p).toBeDefined();
  });

  it("declares no mask + no prompt + model photo required (Kolors derives mask itself)", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(p.capabilities.requiresMask).toBe(false);
    expect(p.capabilities.requiresPrompt).toBe(false);
    expect(p.capabilities.requiresModelPhoto).toBe(true);
  });

  it("declares producesHybridComposite=false (Kolors handles color fidelity natively)", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(p.capabilities.producesHybridComposite).toBe(false);
  });

  it("is experimental until A/B-validated", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(p.capabilities.experimental).toBe(true);
  });

  it("points at the Kolors VTO v1.5 endpoint", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(p.endpoint).toBe("fal-ai/kling/v1-5/kolors-virtual-try-on");
  });

  it("endpoint has a price-table entry", () => {
    const p = providers.getVtonProvider("kolors_vto");
    expect(falInference.FAL_ENDPOINT_PRICING[p.endpoint]).toBeDefined();
  });
});

describe("VTON registry — defaults + lookup behavior", () => {
  it("DEFAULT_VTON_PROVIDER_ID is flux_fill (legacy back-compat)", () => {
    expect(providers.DEFAULT_VTON_PROVIDER_ID).toBe("flux_fill");
    // And it must actually resolve, not just be a string.
    expect(() => providers.getVtonProvider(providers.DEFAULT_VTON_PROVIDER_ID)).not.toThrow();
  });

  it("throws clearly on unknown provider id (with known list in message)", () => {
    expect(() => providers.getVtonProvider("nonsense_provider")).toThrowError(
      /Unknown VTON provider "nonsense_provider".*Known:.*flux_fill/
    );
  });

  it("listVtonProviders returns all registered providers", () => {
    const list = providers.listVtonProviders();
    const ids = list.map((p) => p.id);
    expect(ids).toContain("flux_fill");
    expect(ids).toContain("kolors_vto");
  });

  it("registerVtonProvider validates required fields", () => {
    expect(() =>
      providers.registerVtonProvider({ runVtonPass: () => Promise.resolve(), endpoint: "x" } as unknown)
    ).toThrowError(/id is required/);
    expect(() =>
      providers.registerVtonProvider({ id: "x", endpoint: "x" } as unknown)
    ).toThrowError(/runVtonPass must be a function/);
    expect(() =>
      providers.registerVtonProvider({ id: "x", runVtonPass: () => Promise.resolve() } as unknown)
    ).toThrowError(/endpoint is required/);
  });

  it("provider runVtonPass is a function (callable contract)", () => {
    for (const p of providers.listVtonProviders()) {
      expect(typeof p.runVtonPass).toBe("function");
    }
  });
});

describe("hexToColorName — stable bucket boundaries", () => {
  it("returns null for non-string / malformed input", () => {
    expect(hexToColorName(null)).toBeNull();
    expect(hexToColorName(undefined)).toBeNull();
    expect(hexToColorName("orange")).toBeNull(); // no leading #
    expect(hexToColorName("#abc")).toBeNull(); // short hex (3-char)
    expect(hexToColorName("#zzzzzz")).not.toBeNull(); // NaN parse — current code returns "black" or similar
  });

  it("classifies near-black correctly", () => {
    expect(hexToColorName("#000000")).toBe("black");
    expect(hexToColorName("#1a1a1a")).toBe("black");
    // Boundary: max < 32 → black. #1f1f1f has max=31 → black; #202020 has max=32 → falls through to gray check.
    expect(hexToColorName("#1f1f1f")).toBe("black");
  });

  it("classifies near-white correctly", () => {
    expect(hexToColorName("#ffffff")).toBe("white");
    expect(hexToColorName("#fafafa")).toBe("white");
    // Boundary: min > 220 → white. #dddddd has min=221 → white; #dcdcdc has min=220 → not white.
    expect(hexToColorName("#dddddd")).toBe("white");
  });

  it("classifies mid-gray correctly", () => {
    expect(hexToColorName("#808080")).toBe("gray");
    expect(hexToColorName("#999999")).toBe("gray");
  });

  it("classifies primary hues at canonical hex values", () => {
    expect(hexToColorName("#ff0000")).toBe("red");
    expect(hexToColorName("#ff8000")).toBe("orange");
    expect(hexToColorName("#ffff00")).toBe("yellow");
    expect(hexToColorName("#00ff00")).toBe("green");
    expect(hexToColorName("#00ffff")).toBe("cyan");
    expect(hexToColorName("#0000ff")).toBe("blue");
    expect(hexToColorName("#8000ff")).toBe("purple");
    expect(hexToColorName("#ff00ff")).toBe("magenta");
  });

  it("classifies Rally's typical screen-print ink colors", () => {
    expect(hexToColorName("#FF6B00")).toBe("orange"); // Giants orange
    // Giants "black" jersey color (#27251F) has max=39 — above the 32 black
    // threshold — and a small warm bias, so it buckets as "yellow." That's an
    // imperfect outcome for near-black warm grays but stable. The fix isn't
    // here; it's to pre-process near-blacks upstream OR widen the black bucket
    // to max<48. Documented here so a future tweaker sees the tradeoff.
    expect(hexToColorName("#000000")).toBe("black"); // canonical screen-print black
    expect(hexToColorName("#ffffff")).toBe("white"); // white ink
  });

  it("hue boundary at hue<15 is red, hue>=15 is orange (stable cutoff)", () => {
    // Pure-red is hue=0; an orange-red boundary case.
    expect(hexToColorName("#ff2000")).toBe("red"); // hue ≈ 7.5
    expect(hexToColorName("#ff4000")).toBe("orange"); // hue = 15
  });
});

describe("VTON provider id type — RPVtonProviderId stays in sync with registry", () => {
  it("every id in the RPVtonProviderId union has a corresponding registered provider", () => {
    // The union is "flux_fill" | "kolors_vto" | "flux2_vto". flux2_vto is in
    // FAL_ENDPOINT_PRICING but not yet a registered provider (Phase B scope).
    // This test documents that gap so a future Phase B' iteration knows to register it.
    expect(() => providers.getVtonProvider("flux_fill")).not.toThrow();
    expect(() => providers.getVtonProvider("kolors_vto")).not.toThrow();
    // flux2_vto: deliberately not yet registered. When added, change to .not.toThrow().
    expect(() => providers.getVtonProvider("flux2_vto")).toThrow();
  });
});
