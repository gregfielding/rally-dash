/**
 * Tests for Phase D Shopify smart-collection helpers.
 *
 * Focus: pure derivation functions (no Shopify API hits). End-to-end sync
 * is verified manually with a real Shopify call in Phase D5.
 *
 * Key invariants this guards:
 *   - LEAF_PREFIX matches Rally's actual tag schema (sport/league/team/theme).
 *     A regression here makes auto-collection-creation silently fail because
 *     no product tags would match the expected prefixes.
 *   - buildLeafSpecFromTaxonomyEntry produces lowercase handles + slugified
 *     codes — Shopify rejects uppercase / special chars in handles, and
 *     the rule must match the lowercase tag emitted by buildShopifyTags.
 *   - leafSpecsFromTags handles the actual buildShopifyTags output without
 *     silent skips (regression from when prefixes were misaligned).
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const shopifyCollections = require("../../functions/lib/shopifySmartCollections") as {
  LEAF_PREFIX: Record<string, { handlePrefix: string; titlePrefix: string }>;
  TAXONOMY_COLLECTION_TO_FAMILY: Record<
    string,
    { family: string; codeField: string; entityTypes?: Set<string> }
  >;
  leafSpecsFromTags: (tags: string[]) => Array<{
    family: string;
    fullTag: string;
    handle: string;
    title: string;
  }>;
  buildLeafSpecFromTaxonomyEntry: (
    family: string,
    code: string,
    name: string
  ) => { family: string; fullTag: string; handle: string; title: string } | null;
};

describe("LEAF_PREFIX — matches Rally's actual tag schema", () => {
  it("includes sport, league, team, theme (the four Rally emits)", () => {
    expect(shopifyCollections.LEAF_PREFIX.sport).toBeDefined();
    expect(shopifyCollections.LEAF_PREFIX.league).toBeDefined();
    expect(shopifyCollections.LEAF_PREFIX.team).toBeDefined();
    expect(shopifyCollections.LEAF_PREFIX.theme).toBeDefined();
  });

  it("does NOT include city or product_type (legacy dead entries)", () => {
    // These prefixes were in the original map but Rally never emits them, so
    // collections for them would always be empty.
    expect(shopifyCollections.LEAF_PREFIX.city).toBeUndefined();
    expect(shopifyCollections.LEAF_PREFIX.product_type).toBeUndefined();
  });

  it("every entry has both handlePrefix and titlePrefix", () => {
    for (const [family, def] of Object.entries(shopifyCollections.LEAF_PREFIX)) {
      expect(def.handlePrefix, `${family} has handlePrefix`).toBeTruthy();
      expect(def.titlePrefix, `${family} has titlePrefix`).toBeTruthy();
    }
  });
});

describe("buildLeafSpecFromTaxonomyEntry", () => {
  it("builds the expected spec for a team taxonomy entry", () => {
    const spec = shopifyCollections.buildLeafSpecFromTaxonomyEntry(
      "team",
      "SFGIANTS",
      "SF Giants"
    );
    expect(spec).toEqual({
      family: "team",
      fullTag: "team:sfgiants",
      handle: "team-sfgiants",
      title: "Team: SF Giants",
    });
  });

  it("lowercases the code into the tag rule (matches buildShopifyTags output)", () => {
    const spec = shopifyCollections.buildLeafSpecFromTaxonomyEntry("league", "MLB", "MLB");
    expect(spec?.fullTag).toBe("league:mlb");
  });

  it("slugifies multi-word codes — underscores in tag, hyphens in handle", () => {
    const spec = shopifyCollections.buildLeafSpecFromTaxonomyEntry(
      "team",
      "SF_GIANTS",
      "SF Giants"
    );
    expect(spec?.fullTag).toBe("team:sf_giants"); // underscore preserved in tag
    expect(spec?.handle).toBe("team-sf-giants"); // hyphen in URL handle
  });

  it("strips non-alphanumeric chars from the code (Shopify handle compat)", () => {
    const spec = shopifyCollections.buildLeafSpecFromTaxonomyEntry(
      "team",
      "S.F. GIANTS!",
      "SF Giants"
    );
    expect(spec?.fullTag).toMatch(/^team:[a-z0-9_]+$/);
    expect(spec?.handle).toMatch(/^team-[a-z0-9-]+$/);
  });

  it("uses the human name in the title body, not the code", () => {
    const spec = shopifyCollections.buildLeafSpecFromTaxonomyEntry(
      "team",
      "SFGIANTS",
      "San Francisco Giants"
    );
    expect(spec?.title).toBe("Team: San Francisco Giants");
  });

  it("falls back to code-derived title when name is missing", () => {
    /**
     * The fallback applies `\b\w` titleCase, which only affects the FIRST
     * letter of each space-separated word. For an all-caps single-word code
     * like SFGIANTS the result is SFGIANTS unchanged. Multi-word codes get
     * the per-word first-letter behavior. Documented here so a future
     * refactor (e.g. force lowercase-then-titleCase) can flip the assertion
     * intentionally.
     */
    const single = shopifyCollections.buildLeafSpecFromTaxonomyEntry("team", "SFGIANTS", "");
    expect(single?.title).toBe("Team: SFGIANTS");
    const multi = shopifyCollections.buildLeafSpecFromTaxonomyEntry("team", "san_francisco_giants", "");
    expect(multi?.title).toBe("Team: San Francisco Giants");
  });

  it("returns null for unknown family", () => {
    expect(
      shopifyCollections.buildLeafSpecFromTaxonomyEntry("nonsense", "ABC", "Abc")
    ).toBeNull();
  });

  it("returns null for empty code", () => {
    expect(shopifyCollections.buildLeafSpecFromTaxonomyEntry("team", "", "Anything")).toBeNull();
    expect(shopifyCollections.buildLeafSpecFromTaxonomyEntry("team", "   ", "Anything")).toBeNull();
  });

  it("returns null when code is all punctuation (after stripping, slugPart is empty)", () => {
    expect(shopifyCollections.buildLeafSpecFromTaxonomyEntry("team", "!!!", "Anything")).toBeNull();
  });
});

describe("leafSpecsFromTags — matches what buildShopifyTags actually emits", () => {
  it("creates a leaf spec for each known-family tag on the product", () => {
    /** Mirrors the canonical buildShopifyTags output for a typical Rally product. */
    const tags = [
      "sport:baseball",
      "league:mlb",
      "team:sfgiants",
      "theme:pillows",
      "model:alice", // model: deliberately ignored (no collection family for models)
    ];
    const specs = shopifyCollections.leafSpecsFromTags(tags);
    const families = specs.map((s) => s.family).sort();
    expect(families).toEqual(["league", "sport", "team", "theme"]);
  });

  it("skips tags without a known family prefix", () => {
    const specs = shopifyCollections.leafSpecsFromTags([
      "team:sfgiants",
      "model:alice", // not a leaf family
      "color:red", // unknown prefix
      "noprefix",
    ]);
    expect(specs.length).toBe(1);
    expect(specs[0].family).toBe("team");
  });

  it("dedupes identical tags (operator double-tagging is benign)", () => {
    const specs = shopifyCollections.leafSpecsFromTags([
      "team:sfgiants",
      "team:sfgiants",
      "team:sfgiants",
    ]);
    expect(specs.length).toBe(1);
  });

  it("produces handles that match what buildLeafSpecFromTaxonomyEntry would build", () => {
    /** The reactive (product-tag-driven) and proactive (taxonomy-driven) paths
     *  must produce IDENTICAL handles so they create/find the same collection. */
    const fromTag = shopifyCollections.leafSpecsFromTags(["team:sf_giants"]);
    const fromTaxonomy = shopifyCollections.buildLeafSpecFromTaxonomyEntry(
      "team",
      "SF_GIANTS",
      "SF Giants"
    );
    expect(fromTag[0].handle).toBe(fromTaxonomy?.handle);
    expect(fromTag[0].fullTag).toBe(fromTaxonomy?.fullTag);
  });
});

describe("TAXONOMY_COLLECTION_TO_FAMILY — drives taxonomy-driven sync", () => {
  it("maps each rp_taxonomy_* collection to a LEAF_PREFIX family", () => {
    for (const [collection, cfg] of Object.entries(
      shopifyCollections.TAXONOMY_COLLECTION_TO_FAMILY
    )) {
      expect(collection.startsWith("rp_taxonomy_"), `${collection} is a taxonomy collection`).toBe(true);
      expect(shopifyCollections.LEAF_PREFIX[cfg.family], `family ${cfg.family} exists in LEAF_PREFIX`).toBeDefined();
    }
  });

  it("rp_taxonomy_entities restricts to team-like entityTypes", () => {
    const cfg = shopifyCollections.TAXONOMY_COLLECTION_TO_FAMILY.rp_taxonomy_entities;
    expect(cfg.entityTypes).toBeDefined();
    // Sanity: pro_team must be allowed; brand must not.
    expect(cfg.entityTypes?.has("pro_team")).toBe(true);
    expect(cfg.entityTypes?.has("brand")).toBeFalsy();
    expect(cfg.entityTypes?.has("generic_entity")).toBeFalsy();
  });
});
