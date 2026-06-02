/**
 * Tests for `buildProductIdentityKey` — the dedupe key for `rp_products`.
 *
 * Why this matters most:
 * - This key is what `runCreateProductFromDesignBlankCore` checks via
 *   `rp_products.where("productIdentityKey", "==", key)` to decide whether
 *   a product already exists. A drift / collision here either:
 *     (a) spawns silent duplicates (different keys for same logical product)
 *     (b) blocks legit creates (same key for different logical products)
 * - The key embeds blankVariantIdOrLegacy + garmentSizeCode → every variant
 *   row gets its own key, so the same-product-different-color case works.
 *
 * The function is defined directly in `functions/index.js` (not in a
 * standalone module), so we re-implement it inline in tests for now. When
 * Phase A's `runFalInference` extraction happens, we'll factor this out to
 * a proper module and remove the inline copy.
 *
 * Mirror status: there is currently no client-side `buildProductIdentityKey`.
 * The bulk-upload preview engine doesn't compute identity keys (it computes
 * `groupKey` / `importKey` which serve a different purpose). When/if a web
 * mirror is added, parity tests get added here.
 */
import { describe, it, expect } from "vitest";

/**
 * Inline copy of the function from functions/index.js:5122. Keep in sync
 * with the source until the function is extracted to a proper module.
 *
 * SOURCE: functions/index.js — buildProductIdentityKey
 */
function buildProductIdentityKey(params: {
  leagueCode?: string | null;
  teamCode?: string | null;
  designId?: string | null;
  blankId?: string | null;
  blankVariantIdOrLegacy?: string | null;
  garmentSizeCode?: string | null;
}): string {
  const norm = (s: string | null | undefined): string => {
    if (s == null || typeof s !== "string") return "";
    return (
      String(s)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_")
        .replace(/[^A-Z0-9_-]/g, "")
        .slice(0, 128) || ""
    );
  };
  const league = norm(params.leagueCode) || "LEAGUE";
  const team = norm(params.teamCode) || "TEAM";
  const design = norm(params.designId) || "";
  const blank = norm(params.blankId) || "";
  const variant = norm(params.blankVariantIdOrLegacy) || "legacy";
  const parts = [league, team, design, blank, variant].filter(Boolean);
  const sizeSeg = norm(params.garmentSizeCode || "");
  if (sizeSeg) parts.push(sizeSeg);
  return parts.join("_");
}

describe("buildProductIdentityKey", () => {
  const baseParams = {
    leagueCode: "MLB",
    teamCode: "SFGIANTS",
    designId: "abc123",
    blankId: "BLANK8394",
    blankVariantIdOrLegacy: "color-uuid-blue",
    garmentSizeCode: "M",
  };

  describe("canonical 6-part key", () => {
    it("joins all six segments with underscores", () => {
      const k = buildProductIdentityKey(baseParams);
      expect(k).toBe("MLB_SFGIANTS_ABC123_BLANK8394_COLOR-UUID-BLUE_M");
    });

    it("preserves hyphens but strips other non-alphanumerics", () => {
      const k = buildProductIdentityKey({
        ...baseParams,
        teamCode: "S.F. Giants",
      });
      // norm order: trim → uppercase → spaces→underscore → strip non-[A-Z0-9_-].
      // "S.F. Giants" → "S.F. GIANTS" → "S.F._GIANTS" → "SF_GIANTS" (periods dropped).
      expect(k).toContain("_SF_GIANTS_");
    });

    it("uppercases inputs", () => {
      const k = buildProductIdentityKey({
        ...baseParams,
        leagueCode: "mlb",
        teamCode: "sfgiants",
        garmentSizeCode: "m",
      });
      expect(k).toBe("MLB_SFGIANTS_ABC123_BLANK8394_COLOR-UUID-BLUE_M");
    });
  });

  describe("fallback segments for missing inputs", () => {
    it("uses LEAGUE placeholder when leagueCode is missing", () => {
      const k = buildProductIdentityKey({ ...baseParams, leagueCode: null });
      expect(k).toContain("LEAGUE_SFGIANTS_");
    });

    it("uses TEAM placeholder when teamCode is missing", () => {
      const k = buildProductIdentityKey({ ...baseParams, teamCode: null });
      expect(k).toContain("MLB_TEAM_");
    });

    it("uses 'legacy' placeholder (lowercase) when blankVariantId is missing", () => {
      const k = buildProductIdentityKey({
        ...baseParams,
        blankVariantIdOrLegacy: null,
      });
      // Code uses `norm(x) || "legacy"` — the literal fallback string isn't
      // re-normalized to uppercase. Minor inconsistency vs other segments,
      // but case-insensitive dedupe still holds because the fallback string
      // is deterministic. Worth normalizing in a future cleanup.
      expect(k).toContain("_legacy_");
    });

    it("omits sizeCode segment entirely when missing", () => {
      const k = buildProductIdentityKey({ ...baseParams, garmentSizeCode: null });
      const segments = k.split("_");
      // Without size, key has 5 segments (league, team, design, blank, variant).
      // 6-segment when size present.
      expect(segments.length).toBeLessThan(6);
    });
  });

  describe("collision behavior (the bugs we want to PREVENT)", () => {
    it("DIFFERENT keys for same design on different blanks (Phase A0 SKU fix story)", () => {
      const panty = buildProductIdentityKey({ ...baseParams, blankId: "BLANK8394" });
      const thong = buildProductIdentityKey({ ...baseParams, blankId: "BLANK8390" });
      const tank = buildProductIdentityKey({ ...baseParams, blankId: "BLANKTR3008" });
      const crewneck = buildProductIdentityKey({ ...baseParams, blankId: "BLANKHF07" });
      const set = new Set([panty, thong, tank, crewneck]);
      expect(set.size).toBe(4); // no collisions
    });

    it("DIFFERENT keys for same design on different colors (variants)", () => {
      const blue = buildProductIdentityKey({
        ...baseParams,
        blankVariantIdOrLegacy: "color-uuid-blue",
      });
      const pink = buildProductIdentityKey({
        ...baseParams,
        blankVariantIdOrLegacy: "color-uuid-pink",
      });
      expect(blue).not.toBe(pink);
    });

    it("DIFFERENT keys for different sizes of same color", () => {
      const s = buildProductIdentityKey({ ...baseParams, garmentSizeCode: "S" });
      const m = buildProductIdentityKey({ ...baseParams, garmentSizeCode: "M" });
      const l = buildProductIdentityKey({ ...baseParams, garmentSizeCode: "L" });
      expect(new Set([s, m, l]).size).toBe(3);
    });

    it("SAME key for the same logical product (idempotent dedupe)", () => {
      const a = buildProductIdentityKey(baseParams);
      const b = buildProductIdentityKey(baseParams);
      expect(a).toBe(b);
    });

    it("SAME key regardless of input case (case-insensitive dedupe)", () => {
      const lower = buildProductIdentityKey({
        leagueCode: "mlb",
        teamCode: "sfgiants",
        designId: "abc123",
        blankId: "blank8394",
        blankVariantIdOrLegacy: "color-uuid-blue",
        garmentSizeCode: "m",
      });
      const upper = buildProductIdentityKey(baseParams);
      expect(lower).toBe(upper);
    });

    it("SAME key regardless of leading/trailing whitespace", () => {
      const padded = buildProductIdentityKey({
        leagueCode: "  MLB  ",
        teamCode: " SFGIANTS ",
        designId: " abc123 ",
        blankId: " BLANK8394 ",
        blankVariantIdOrLegacy: " color-uuid-blue ",
        garmentSizeCode: " M ",
      });
      expect(padded).toBe(buildProductIdentityKey(baseParams));
    });
  });

  describe("hostile inputs", () => {
    it("survives all-null inputs without throwing", () => {
      const k = buildProductIdentityKey({});
      // Falls back to LEAGUE_TEAM_legacy (3 segments).
      expect(typeof k).toBe("string");
      expect(k.length).toBeGreaterThan(0);
      expect(k).toContain("LEAGUE");
      expect(k).toContain("TEAM");
    });

    it("strips unicode / emoji / weird chars", () => {
      const k = buildProductIdentityKey({
        ...baseParams,
        teamCode: "🏀 Lakers!",
      });
      // Result must be only A-Z, 0-9, _, -.
      expect(k).toMatch(/^[A-Z0-9_-]+$/);
    });

    it("caps each segment at 128 chars (no unbounded growth)", () => {
      const k = buildProductIdentityKey({
        ...baseParams,
        designId: "a".repeat(500), // way too long
      });
      // The design segment alone shouldn't exceed 128 chars.
      const parts = k.split("_");
      const designSegment = parts[2];
      expect(designSegment.length).toBeLessThanOrEqual(128);
    });
  });
});
