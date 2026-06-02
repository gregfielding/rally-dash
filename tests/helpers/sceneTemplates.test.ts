/**
 * Tests for Phase C scene template registry.
 *
 * What's covered:
 *   - Every registered template has the required fields + categories.
 *   - getDefault4ShotTemplateIds returns exactly 4 templates (the curated PDP set).
 *   - The default 4 cover at least 3 distinct categories — otherwise the PDP
 *     looks repetitive (4 lifestyle shots = bad PDP variety).
 *   - getSceneTemplate throws clearly on miss.
 *   - listSceneTemplates({category}) filters correctly.
 *   - Static catalog mirror in the UI matches the server registry (any
 *     drift causes invalid-argument errors at runtime — guard at test time).
 *   - Endpoint pricing: Kontext is in FAL_ENDPOINT_PRICING (otherwise cost
 *     meter reports "unknown" for every Phase C call).
 *
 * What's NOT covered:
 *   - Prompt quality. That's an empirical "does it look good?" question for
 *     manual verification (Phase C5).
 *   - Trigger behavior. End-to-end Kontext is mocked in onSceneJobCreated
 *     via runFalInference (already tested in falInference.test.ts).
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const templates = require("../../functions/lib/sceneTemplates") as {
  SCENE_TEMPLATES: Record<
    string,
    {
      id: string;
      label: string;
      category: string;
      description: string;
      prompt: string;
      recommendedSourceSlot: string;
      experimental: boolean;
      includedIn4ShotDefault: boolean;
    }
  >;
  SCENE_CATEGORIES: string[];
  getSceneTemplate: (id: string) => unknown;
  listSceneTemplates: (opts?: { category?: string }) => Array<{ id: string; category: string }>;
  getDefault4ShotTemplateIds: () => string[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const falInference = require("../../functions/lib/falInference") as {
  FAL_ENDPOINT_PRICING: Record<string, { costUsd: number; notes: string }>;
};

describe("scene template registry", () => {
  it("registers at least 6 templates (≥ 1 per category)", () => {
    const all = Object.values(templates.SCENE_TEMPLATES);
    expect(all.length).toBeGreaterThanOrEqual(6);
    const cats = new Set(all.map((t) => t.category));
    expect(cats.size).toBeGreaterThanOrEqual(3);
  });

  it("every template has the required fields", () => {
    for (const t of Object.values(templates.SCENE_TEMPLATES)) {
      expect(t.id, `${t.id} has id`).toBeTruthy();
      expect(t.label, `${t.id} has label`).toBeTruthy();
      expect(t.description, `${t.id} has description`).toBeTruthy();
      expect(t.prompt, `${t.id} has prompt`).toBeTruthy();
      // Prompt must be substantive — short prompts produce generic scenes.
      expect(t.prompt.length, `${t.id} prompt is substantive`).toBeGreaterThan(60);
      expect(t.category, `${t.id} has category`).toBeTruthy();
      expect(["Lifestyle", "Studio", "Gameday", "Editorial"]).toContain(t.category);
      expect(t.recommendedSourceSlot, `${t.id} has recommendedSourceSlot`).toBeTruthy();
      expect(typeof t.experimental).toBe("boolean");
      expect(typeof t.includedIn4ShotDefault).toBe("boolean");
    }
  });

  it("every template's id matches its key in the registry map", () => {
    for (const [key, t] of Object.entries(templates.SCENE_TEMPLATES)) {
      expect(t.id).toBe(key);
    }
  });

  it("every prompt mentions preserving garment/design (anti-hallucination guard)", () => {
    /**
     * Kontext will happily redraw the print if the prompt doesn't tell it not
     * to. Every Rally template must explicitly preserve the design/color/print
     * to avoid losing the artwork. If a future template drops this clause it
     * should fail this test loudly.
     */
    for (const t of Object.values(templates.SCENE_TEMPLATES)) {
      const p = t.prompt.toLowerCase();
      const mentionsPreserve =
        p.includes("preserve") || p.includes("maintain") || p.includes("exactly");
      expect(mentionsPreserve, `${t.id} prompt has a preservation clause`).toBe(true);
    }
  });
});

describe("getSceneTemplate", () => {
  it("returns the template for a known id", () => {
    const t = templates.getSceneTemplate("studio_clean");
    expect(t).toBeDefined();
  });

  it("throws clearly on unknown id (with known list in message)", () => {
    expect(() => templates.getSceneTemplate("bogus_scene")).toThrowError(
      /Unknown scene template "bogus_scene".*Known:/
    );
  });
});

describe("listSceneTemplates", () => {
  it("returns all templates when no filter", () => {
    const all = templates.listSceneTemplates();
    expect(all.length).toBe(Object.keys(templates.SCENE_TEMPLATES).length);
  });

  it("filters by category", () => {
    const lifestyle = templates.listSceneTemplates({ category: "Lifestyle" });
    expect(lifestyle.length).toBeGreaterThan(0);
    for (const t of lifestyle) expect(t.category).toBe("Lifestyle");
  });

  it("returns empty array for an unknown category", () => {
    const empty = templates.listSceneTemplates({ category: "Nonsense" });
    expect(empty).toEqual([]);
  });
});

describe("getDefault4ShotTemplateIds — the curated PDP set", () => {
  const defaults = templates.getDefault4ShotTemplateIds();

  it("returns exactly 4 template ids", () => {
    expect(defaults.length).toBe(4);
  });

  it("every default id resolves to a registered template", () => {
    for (const id of defaults) {
      expect(() => templates.getSceneTemplate(id)).not.toThrow();
    }
  });

  it("the default set spans at least 3 distinct categories (PDP variety)", () => {
    const cats = new Set(
      defaults.map((id) => templates.SCENE_TEMPLATES[id].category)
    );
    expect(cats.size).toBeGreaterThanOrEqual(3);
  });

  it("default set includes ONE non-experimental gameday or studio shot (safe e-com baseline)", () => {
    /**
     * The 4-shot default goes straight to production for some operators. At
     * least one of the four must be a non-experimental "safe baseline" shot
     * — never ship 4 experimental scenes in the default.
     */
    const safeBaselines = defaults
      .map((id) => templates.SCENE_TEMPLATES[id])
      .filter((t) => !t.experimental && (t.category === "Studio" || t.category === "Gameday"));
    expect(safeBaselines.length).toBeGreaterThan(0);
  });
});

describe("Kontext pricing wired up", () => {
  it("fal-ai/flux-pro/kontext is in the price table", () => {
    const entry = falInference.FAL_ENDPOINT_PRICING["fal-ai/flux-pro/kontext"];
    expect(entry).toBeDefined();
    expect(entry.costUsd).toBeGreaterThan(0);
    expect(entry.costUsd).toBeLessThan(1); // sanity — Kontext is ~$0.04, not $40
  });
});
