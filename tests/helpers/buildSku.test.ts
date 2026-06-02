/**
 * Tests for the SKU builder + parser, including the Phase A0 blank-code
 * change. The same tests run against the JS mirror in `functions/lib/buildSku.js`
 * to catch any drift between web and Cloud Functions implementations.
 *
 * Why this helper specifically gets tests first:
 * - SKUs are immutable once written; a drift between the two implementations
 *   would silently corrupt thousands of products.
 * - The Phase A0 change added a required parameter — any caller that forgot
 *   to update would silently produce malformed SKUs in production.
 * - The duplicate-SKU precheck rejects collisions LOUDLY (HttpsError), so a
 *   regression here would block product creation entirely.
 */
import { describe, it, expect } from "vitest";
import * as web from "@/lib/products/buildSku";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fn = require("../../functions/lib/buildSku") as typeof web;

/** Run the same suite against both implementations to enforce parity. */
const implementations: Array<[string, typeof web]> = [
  ["web (lib/products/buildSku.ts)", web],
  ["functions (functions/lib/buildSku.js)", fn],
];

for (const [name, impl] of implementations) {
  describe(`buildSku — ${name}`, () => {
    const base = {
      leagueCode: "MLB",
      teamCode: "SFGIANTS",
      designCode: "PILLOWS",
      colorCode: "HGR",
      size: "XS",
    };

    it("builds the canonical 7-part pattern with blankCode", () => {
      const sku = impl.buildSku({ ...base, blankCode: "8394" });
      expect(sku).toBe("RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS");
    });

    it("makes same design + team + color + size unique across the 4 LA Apparel blanks", () => {
      const skus = ["8394", "8390", "TR3008", "HF07"].map((blankCode) =>
        impl.buildSku({ ...base, blankCode })
      );
      expect(new Set(skus).size).toBe(skus.length);
    });

    it("trims team segment to 6 chars (SFGIANTS → SFGIAN)", () => {
      const sku = impl.buildSku({ ...base, blankCode: "8394" });
      // SFGIANTS is 8 chars; normalizeSkuSegment caps team at 6.
      expect(sku).toContain("-SFGIAN-");
      expect(sku).not.toContain("-SFGIANTS-");
    });

    it("trims blank segment to 6 chars (handles long codes if catalog adds them)", () => {
      const sku = impl.buildSku({ ...base, blankCode: "VERYLONGSTYLECODE" });
      // 6-char cap (per normalizeSkuSegment maxLen).
      expect(sku.split("-")[4].length).toBeLessThanOrEqual(6);
    });

    it("normalizes blank styleCodes that contain hyphens (defensive)", () => {
      // styleCodes shouldn't have hyphens, but if a future blank does
      // (e.g. some Bella Canvas codes), normalizeSkuSegment strips non-alphanumerics.
      const sku = impl.buildSku({ ...base, blankCode: "BC-3001" });
      expect(sku).toBe("RP-MLB-SFGIAN-PILLOWS-BC3001-HGR-XS");
    });

    it("uppercases lowercase inputs", () => {
      const sku = impl.buildSku({
        leagueCode: "mlb",
        teamCode: "sfgiants",
        designCode: "pillows",
        blankCode: "8394",
        colorCode: "hgr",
        size: "xs",
      });
      expect(sku).toBe("RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS");
    });

    it("pads colorCode to 3 chars when given a 2-char code", () => {
      const sku = impl.buildSku({ ...base, blankCode: "8394", colorCode: "RD" });
      // colorCode is padded to 3 chars with "X".
      expect(sku).toContain("-RDX-");
    });

    it("returns 'X' fallback when a segment is empty (no Firestore-undefined leaks)", () => {
      const sku = impl.buildSku({
        leagueCode: "",
        teamCode: "",
        designCode: "",
        blankCode: "",
        colorCode: "",
        size: "",
      });
      // Every segment falls back to "X" / "XXX" — never undefined / empty.
      expect(sku).toBe("RP-X-X-X-X-XXX-X");
    });
  });

  describe(`parseSku — ${name}`, () => {
    it("round-trips a new 7-part SKU", () => {
      const sku = "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS";
      expect(impl.parseSku(sku)).toEqual({
        raw: sku,
        leagueCode: "MLB",
        teamCode: "SFGIAN",
        designCode: "PILLOWS",
        blankCode: "8394",
        colorCode: "HGR",
        size: "XS",
      });
    });

    it("accepts legacy 6-part SKU with blankCode=null (backward compat)", () => {
      const sku = "RP-MLB-SFGIAN-PILLOWS-HGR-XS";
      const parsed = impl.parseSku(sku);
      expect(parsed).not.toBeNull();
      expect(parsed!.blankCode).toBeNull();
      expect(parsed!.colorCode).toBe("HGR");
      expect(parsed!.size).toBe("XS");
    });

    it("normalizes case on parse (lowercase input)", () => {
      const sku = "rp-mlb-sfgian-pillows-8394-hgr-xs";
      const parsed = impl.parseSku(sku);
      expect(parsed!.leagueCode).toBe("MLB");
      expect(parsed!.blankCode).toBe("8394");
    });

    it("returns null for non-RP prefix", () => {
      expect(impl.parseSku("XY-MLB-SFGIAN-PILLOWS-8394-HGR-XS")).toBeNull();
    });

    it("returns null for too few parts", () => {
      expect(impl.parseSku("RP-MLB-SF")).toBeNull();
    });

    it("returns null for too many parts (8+)", () => {
      expect(impl.parseSku("RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS-EXTRA")).toBeNull();
    });

    it("returns null for garbage input", () => {
      expect(impl.parseSku("not a sku")).toBeNull();
      expect(impl.parseSku("")).toBeNull();
      expect(impl.parseSku(null as unknown as string)).toBeNull();
    });
  });

  describe(`assertDistinctSkuCandidates — ${name}`, () => {
    it("accepts a unique list", () => {
      expect(() =>
        impl.assertDistinctSkuCandidates([
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS",
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-S",
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-M",
        ])
      ).not.toThrow();
    });

    it("throws on exact duplicate", () => {
      expect(() =>
        impl.assertDistinctSkuCandidates([
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS",
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS",
        ])
      ).toThrow(/Duplicate SKU/);
    });

    it("throws on case-only collision", () => {
      expect(() =>
        impl.assertDistinctSkuCandidates([
          "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS",
          "rp-mlb-sfgian-pillows-8394-hgr-xs",
        ])
      ).toThrow(/Duplicate SKU/);
    });

    it("ignores empty strings (treats as no-op)", () => {
      expect(() =>
        impl.assertDistinctSkuCandidates(["", "RP-MLB-SFGIAN-PILLOWS-8394-HGR-XS", ""])
      ).not.toThrow();
    });
  });

  describe(`buildDesignCodeForSku — ${name}`, () => {
    it("prefers themeCode when ≥2 chars", () => {
      expect(
        impl.buildDesignCodeForSku({
          themeCode: "PILLOWS",
          designFamily: "ignored",
          designSeries: null,
          designType: "ignored",
          designId: "ignored",
        })
      ).toBe("PILLOWS");
    });

    it("falls back to family+series when themeCode too short", () => {
      expect(
        impl.buildDesignCodeForSku({
          themeCode: "",
          designFamily: "CITY",
          designSeries: "69",
          designType: null,
          designId: "abc123",
        })
      ).toBe("CITY69");
    });

    it("falls back to designType when family+series unusable", () => {
      expect(
        impl.buildDesignCodeForSku({
          themeCode: null,
          designFamily: null,
          designSeries: null,
          designType: "CUSTOMONEOFF",
          designId: "abc12345",
        })
      ).toBe("CUSTOMONEO"); // capped at 10
    });

    it("final fallback: designId", () => {
      expect(
        impl.buildDesignCodeForSku({
          themeCode: null,
          designFamily: null,
          designSeries: null,
          designType: null,
          designId: "abcd1234ZZ",
        })
      ).toBe("ABCD1234"); // capped at 8
    });
  });

  describe(`resolveColorCodeForSku — ${name}`, () => {
    it("maps known color names to standard 3-letter codes", () => {
      expect(impl.resolveColorCodeForSku("Heather Grey")).toBe("HGR");
      expect(impl.resolveColorCodeForSku("Black")).toBe("BLK");
      expect(impl.resolveColorCodeForSku("Pink")).toBe("PNK");
      expect(impl.resolveColorCodeForSku("Royal Blue")).toBe("RYL");
    });

    it("returns XXX for empty input (loud signal)", () => {
      expect(impl.resolveColorCodeForSku("")).toBe("XXX");
      expect(impl.resolveColorCodeForSku(null)).toBe("XXX");
      expect(impl.resolveColorCodeForSku(undefined)).toBe("XXX");
    });

    it("truncates unknown long color names to 3 chars (no fail)", () => {
      const code = impl.resolveColorCodeForSku("VeryUnusualColor");
      expect(code.length).toBe(3);
    });

    it("pads unknown short color names to 3 chars with X", () => {
      const code = impl.resolveColorCodeForSku("aa");
      expect(code.length).toBe(3);
      expect(code).toBe("AAX");
    });
  });
}

/**
 * Cross-implementation parity: every example we use elsewhere should produce
 * the SAME SKU on both the web and functions builders. If a mirror diverges
 * (someone updates one file but not the other), this fails loud.
 */
describe("web ↔ functions parity", () => {
  const fixtures = [
    { leagueCode: "MLB", teamCode: "SFGIANTS", designCode: "PILLOWS", blankCode: "8394", colorCode: "HGR", size: "XS" },
    { leagueCode: "NFL", teamCode: "CHIEFS", designCode: "CITY69", blankCode: "HF07", colorCode: "RYL", size: "L" },
    { leagueCode: "NBA", teamCode: "LAKERS", designCode: "RIVALRY", blankCode: "TR3008", colorCode: "PPL", size: "M" },
  ];

  for (const f of fixtures) {
    it(`builds identical SKU for ${f.leagueCode}/${f.teamCode}/${f.designCode}/${f.blankCode}`, () => {
      expect(web.buildSku(f)).toBe(fn.buildSku(f));
    });
  }
});
