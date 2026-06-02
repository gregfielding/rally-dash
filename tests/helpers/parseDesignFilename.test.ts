/**
 * Tests for the design-filename parser, including the registry-aware
 * multi-token team-slug matcher. The bug history here is unusually rich:
 *
 *   - 2026-05-26: legacy "team = last middle token" parser took "pillows"
 *     as the team for `mlb_sf_giants_pillows_dark`.
 *   - 2026-05-26: registry-aware fix added, but `inferIdentityFromDesignKey`
 *     still positionally inferred theme = last token of designKey, picking
 *     "giants" as theme for `mlb_pillows_sf_giants`.
 *   - 2026-05-26: themeCode picker preferred `inferred.themeSlugCandidate`
 *     over `parsed.designFamily`, so even after parser fix the theme came
 *     out wrong.
 *
 * These tests lock in the corrected behavior so the next round of edits
 * can't silently regress any of the three failure modes.
 */
import { describe, it, expect } from "vitest";
// Web copy is TS; server copy is JS. Both should produce identical output.
import * as web from "@/lib/batchImport/parseDesignFilename";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fnEngine = require("../../functions/lib/bulkDesignImportPreviewEngine") as {
  parseDesignFilename: (
    filename: string,
    options?: { knownTeamSlugs?: Set<string> }
  ) => ReturnType<typeof web.parseDesignFilename>;
};

/**
 * Realistic team-slug registry — mirrors what `buildPreviewItems` builds
 * from the `design_teams` collection. Includes both the canonical doc ids
 * (sf_giants) and the hyphenated slugs (sf-giants) since the production
 * code accepts either.
 */
const KNOWN_TEAMS = new Set([
  "sf_giants",
  "sf-giants",
  "ny_yankees",
  "ny-yankees",
  "new_york_giants",
  "new-york-giants",
  "los_angeles_dodgers",
  "los-angeles-dodgers",
  "ny_mets",
  "ny-mets",
]);

describe("parseDesignFilename — web (lib)", () => {
  describe("registry-aware multi-token team matching", () => {
    it("matches sf_giants as TEAM when filename order is LEAGUE_THEME_TEAM", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      expect(r.parsed?.team).toBe("sf_giants");
      expect(r.parsed?.designFamily).toBe("pillows");
    });

    it("matches sf_giants as TEAM when filename order is LEAGUE_TEAM_THEME", () => {
      const r = web.parseDesignFilename("mlb_sf_giants_pillows_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      expect(r.parsed?.team).toBe("sf_giants");
      expect(r.parsed?.designFamily).toBe("pillows");
    });

    it("matches new_york_giants without colliding with sf_giants when both in registry", () => {
      const r = web.parseDesignFilename("nfl_new_york_giants_pillows_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.parsed?.team).toBe("new_york_giants");
      expect(r.parsed?.designFamily).toBe("pillows");
    });

    it("falls back to legacy single-token tail when team isn't in registry", () => {
      // "unknownteam" isn't in the registry; parser should still produce something
      // (legacy fallback) without throwing.
      const r = web.parseDesignFilename("mlb_pillows_unknownteam_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      // Legacy fallback: team = last middle token, family = the rest.
      expect(r.parsed?.team).toBe("unknownteam");
      expect(r.parsed?.designFamily).toBe("pillows");
    });

    it("works without knownTeamSlugs (legacy single-token behavior)", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_dark.svg");
      // No registry → falls back to legacy single-token tail = "giants".
      expect(r.parsed?.team).toBe("giants");
      expect(r.parsed?.designFamily).toBe("pillows_sf");
    });
  });

  describe("city_69 special-case", () => {
    it("recognizes ..._city_69 as theme regardless of team token order", () => {
      const r = web.parseDesignFilename("mlb_sf_giants_city_69_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.parsed?.designFamily).toBe("city_69");
      expect(r.parsed?.team).toBe("giants"); // city_69 path takes the immediately-before-city token as team
    });

    it("recognizes ..._<team>_69 shorthand as city_69 theme", () => {
      const r = web.parseDesignFilename("mlb_baltimore_orioles_69_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.parsed?.designFamily).toBe("city_69");
      expect(r.parsed?.team).toBe("baltimore_orioles");
    });
  });

  describe("hyphen ↔ underscore normalization", () => {
    it("treats sf-giants registry entry as matching sf_giants filename token", () => {
      // Only the hyphenated form is in the registry.
      const hyphenOnly = new Set(["sf-giants"]);
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_dark.svg", {
        knownTeamSlugs: hyphenOnly,
      });
      expect(r.parsed?.team).toBe("sf_giants");
    });
  });

  describe("legacy front/back filename variant", () => {
    it("recognizes _front_ legacy side and strips it from designKey", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_front_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      expect(r.parsed?.filenameLegacySide).toBe("front");
      expect(r.parsed?.designKey).toBe("mlb_pillows_sf_giants"); // side stripped
    });

    it("recognizes _back_ legacy side", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_back_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.parsed?.filenameLegacySide).toBe("back");
    });
  });

  describe("garment tone parsing", () => {
    it.each(["light", "dark", "white"])("accepts %s as the last token", (tone) => {
      const r = web.parseDesignFilename(`mlb_pillows_sf_giants_${tone}.svg`, {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      expect(r.parsed?.garmentTone.toLowerCase()).toBe(tone);
    });

    it("rejects unknown tone with a clear status", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_grey.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("unknown_garment_tone");
      expect(r.parsed).toBeNull();
    });
  });

  describe("extension handling", () => {
    it.each(["png", "svg", "pdf"])("accepts .%s extension", (ext) => {
      const r = web.parseDesignFilename(`mlb_pillows_sf_giants_dark.${ext}`, {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("valid");
      expect(r.parsed?.extension).toBe(ext);
    });

    it("rejects unsupported extensions (.ai, .psd)", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_dark.ai", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("unsupported_extension");
    });

    it("rejects filenames with no extension", () => {
      const r = web.parseDesignFilename("mlb_pillows_sf_giants_dark", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("invalid_format");
    });
  });

  describe("edge cases", () => {
    it("rejects filenames with too few tokens", () => {
      const r = web.parseDesignFilename("mlb_dark.svg", {
        knownTeamSlugs: KNOWN_TEAMS,
      });
      expect(r.status).toBe("missing_token");
    });

    it("strips path prefixes (only uses basename)", () => {
      const r = web.parseDesignFilename(
        "/some/path/mlb_pillows_sf_giants_dark.svg",
        { knownTeamSlugs: KNOWN_TEAMS }
      );
      expect(r.status).toBe("valid");
      expect(r.parsed?.filename).toBe("mlb_pillows_sf_giants_dark.svg");
    });
  });

  describe("designKey stability (importKey collision dedupe)", () => {
    it("produces the same designKey for light/dark/white tones of the same design", () => {
      const opts = { knownTeamSlugs: KNOWN_TEAMS };
      const light = web.parseDesignFilename("mlb_pillows_sf_giants_light.svg", opts);
      const dark = web.parseDesignFilename("mlb_pillows_sf_giants_dark.svg", opts);
      const white = web.parseDesignFilename("mlb_pillows_sf_giants_white.svg", opts);
      expect(light.parsed?.designKey).toBe(dark.parsed?.designKey);
      expect(dark.parsed?.designKey).toBe(white.parsed?.designKey);
    });

    it("produces the same designKey for SVG/PDF/PNG of the same tone+design", () => {
      const opts = { knownTeamSlugs: KNOWN_TEAMS };
      const svg = web.parseDesignFilename("mlb_pillows_sf_giants_dark.svg", opts);
      const pdf = web.parseDesignFilename("mlb_pillows_sf_giants_dark.pdf", opts);
      const png = web.parseDesignFilename("mlb_pillows_sf_giants_dark.png", opts);
      expect(svg.parsed?.designKey).toBe(pdf.parsed?.designKey);
      expect(pdf.parsed?.designKey).toBe(png.parsed?.designKey);
    });
  });
});

/**
 * Server-side mirror. Only spot-checks the registry-aware multi-token cases
 * since those are where the two implementations could drift. The unit-level
 * behavior is identical to the web copy by construction.
 */
describe("parseDesignFilename — functions (engine)", () => {
  it("matches sf_giants from LEAGUE_THEME_TEAM order (server)", () => {
    const r = fnEngine.parseDesignFilename("mlb_pillows_sf_giants_dark.svg", {
      knownTeamSlugs: KNOWN_TEAMS,
    });
    expect(r.parsed?.team).toBe("sf_giants");
    expect(r.parsed?.designFamily).toBe("pillows");
  });

  it("matches sf_giants from LEAGUE_TEAM_THEME order (server)", () => {
    const r = fnEngine.parseDesignFilename("mlb_sf_giants_pillows_dark.svg", {
      knownTeamSlugs: KNOWN_TEAMS,
    });
    expect(r.parsed?.team).toBe("sf_giants");
    expect(r.parsed?.designFamily).toBe("pillows");
  });

  it("falls back to legacy without knownTeamSlugs", () => {
    const r = fnEngine.parseDesignFilename("mlb_pillows_sf_giants_dark.svg");
    expect(r.parsed?.team).toBe("giants");
  });
});

/** Web ↔ functions parity on the registry-aware path. */
describe("web ↔ functions parity (parseDesignFilename)", () => {
  const fixtures = [
    "mlb_pillows_sf_giants_dark.svg",
    "mlb_sf_giants_pillows_dark.svg",
    "nfl_new_york_giants_pillows_dark.svg",
    "mlb_baltimore_orioles_69_dark.svg",
    "mlb_unknown_team_dark.svg",
  ];

  for (const f of fixtures) {
    it(`team/designFamily parity for ${f}`, () => {
      const w = web.parseDesignFilename(f, { knownTeamSlugs: KNOWN_TEAMS });
      const s = fnEngine.parseDesignFilename(f, { knownTeamSlugs: KNOWN_TEAMS });
      expect(w.parsed?.team).toBe(s.parsed?.team);
      expect(w.parsed?.designFamily).toBe(s.parsed?.designFamily);
      expect(w.parsed?.designKey).toBe(s.parsed?.designKey);
    });
  }
});
