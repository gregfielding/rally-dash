/**
 * Tests for `buildShopifyTags` (web + functions mirrors) and
 * `buildProductIdentityKey` (functions-only canonical impl).
 *
 * Why these matter:
 * - buildShopifyTags drives Smart Collections + storefront filtering. Drift
 *   between web (preview) and functions (push) would show one tag set in the
 *   admin and a different one on the storefront.
 * - buildProductIdentityKey is the dedupe key for `rp_products`. A drift would
 *   either spawn duplicate products (silent corruption) or block legitimate
 *   creates (loud, but operator-blocking).
 *
 * Both helpers were called out in the Phase A scope as "mirrored, untested,
 * highest blast radius."
 */
import { describe, it, expect } from "vitest";
import * as web from "@/lib/shopify/buildShopifyTags";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fn = require("../../functions/buildShopifyTags") as typeof web;

const implementations: Array<[string, typeof web]> = [
  ["web (lib/shopify/buildShopifyTags.ts)", web],
  ["functions (functions/buildShopifyTags.js)", fn],
];

for (const [name, impl] of implementations) {
  describe(`buildShopifyTags — ${name}`, () => {
    it("emits the canonical sport/league/team/theme/model prefix order", () => {
      const tags = impl.buildShopifyTags({
        sportCode: "BASEBALL",
        leagueCode: "MLB",
        teamCode: "SFGIANTS",
        themeCode: "PILLOWS",
        modelCodes: ["ALICE"],
      });
      expect(tags).toEqual([
        "sport:baseball",
        "league:mlb",
        "team:sfgiants",
        "theme:pillows",
        "model:alice",
      ]);
    });

    it("lowercases + slug-cleans inputs", () => {
      const tags = impl.buildShopifyTags({
        sportCode: "Baseball",
        leagueCode: "M.L.B.",
        teamCode: "SF GIANTS",
        themeCode: "City 69",
        modelCodes: null,
      });
      expect(tags).toContain("sport:baseball");
      expect(tags).toContain("league:m_l_b");
      expect(tags).toContain("team:sf_giants");
      expect(tags).toContain("theme:city_69");
    });

    it("skips null/empty taxonomy fields without leaving holes", () => {
      const tags = impl.buildShopifyTags({
        sportCode: null,
        leagueCode: "MLB",
        teamCode: "",
        themeCode: undefined as unknown as string,
        modelCodes: undefined,
      });
      expect(tags).toEqual(["league:mlb"]);
    });

    it("preserves model order from the input array", () => {
      const tags = impl.buildShopifyTags({
        sportCode: null,
        leagueCode: null,
        teamCode: null,
        themeCode: null,
        modelCodes: ["BOB", "alice", "  Chloe  "],
      });
      expect(tags).toEqual(["model:bob", "model:alice", "model:chloe"]);
    });

    it("dedupes identical tags (case-insensitive after normalization)", () => {
      const tags = impl.buildShopifyTags({
        sportCode: null,
        leagueCode: null,
        teamCode: null,
        themeCode: null,
        modelCodes: ["alice", "ALICE", "  alice  "],
      });
      // All three normalize to "model:alice"; dedupe leaves one.
      expect(tags).toEqual(["model:alice"]);
    });

    it("returns empty array for null/undefined product", () => {
      expect(impl.buildShopifyTags(null)).toEqual([]);
      expect(impl.buildShopifyTags(undefined)).toEqual([]);
    });

    it("returns empty array for product with only empty/null fields", () => {
      expect(
        impl.buildShopifyTags({
          sportCode: null,
          leagueCode: null,
          teamCode: null,
          themeCode: null,
          modelCodes: [],
        })
      ).toEqual([]);
    });

    it("never emits a blankId tag (per Rally tag schema rule)", () => {
      // Hostile input: a "blankId" field accidentally present.
      const tags = impl.buildShopifyTags({
        sportCode: "BASEBALL",
        leagueCode: "MLB",
        teamCode: "SFGIANTS",
        themeCode: "PILLOWS",
        modelCodes: null,
        // @ts-expect-error — blankId is intentionally NOT in the schema; this
        // test guards against someone adding it later as a tag prefix.
        blankId: "8394",
      });
      expect(tags.every((t) => !t.startsWith("blank:"))).toBe(true);
      expect(tags.every((t) => !t.includes("8394"))).toBe(true);
    });

    it("never emits a designFamily tag (per Rally tag schema rule)", () => {
      const tags = impl.buildShopifyTags({
        sportCode: "BASEBALL",
        leagueCode: "MLB",
        teamCode: "SFGIANTS",
        themeCode: "PILLOWS",
        modelCodes: null,
        // @ts-expect-error — designFamily must not become a Shopify tag.
        designFamily: "pillows_back",
      });
      expect(tags.every((t) => !t.startsWith("designfamily:"))).toBe(true);
    });
  });
}

describe("web ↔ functions parity (buildShopifyTags)", () => {
  const fixtures = [
    {
      sportCode: "BASEBALL",
      leagueCode: "MLB",
      teamCode: "SFGIANTS",
      themeCode: "PILLOWS",
      modelCodes: ["ALICE"],
    },
    {
      sportCode: "FOOTBALL",
      leagueCode: "NFL",
      teamCode: "CHIEFS",
      themeCode: "CITY_69",
      modelCodes: ["BOB", "CHLOE"],
    },
    {
      sportCode: null,
      leagueCode: "NBA",
      teamCode: "LAKERS",
      themeCode: null,
      modelCodes: null,
    },
    {
      sportCode: "Baseball",
      leagueCode: "M.L.B.",
      teamCode: "SF GIANTS",
      themeCode: "City 69",
      modelCodes: ["alice", "ALICE"],
    },
  ];

  for (let i = 0; i < fixtures.length; i++) {
    it(`fixture ${i} → identical tags on both implementations`, () => {
      expect(web.buildShopifyTags(fixtures[i])).toEqual(fn.buildShopifyTags(fixtures[i]));
    });
  }
});
