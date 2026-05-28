"use strict";

/**
 * Server-authoritative bulk design import preview: parse, group, infer, match, overwrite hints.
 * Mirrors lib/bulkDesignUpload/* + lib/batchImport/parseDesignFilename.ts behavior.
 */

const SUPPORTED_EXT = new Set(["png", "svg", "pdf"]);
const KNOWN_SIDES = new Set(["FRONT", "BACK"]);
const KNOWN_TONES = new Set(["LIGHT", "DARK", "WHITE"]);
const MIN_CANONICAL = 3;
const MIN_LEGACY = 5;

const IGNORE_EXT = new Set(["ai", "psd", "sketch", "xd", "tmp", "ds_store"]);

function getExt(name) {
  const i = name.lastIndexOf(".");
  if (i === -1) return "";
  return name.slice(i + 1).toLowerCase();
}

function baseNameNoExt(filename) {
  const i = filename.lastIndexOf(".");
  if (i === -1) return filename;
  return filename.slice(0, i);
}

/**
 * Normalize a slug token for comparison: lowercase, hyphens → underscores.
 * Mirrors normalizeSlugForCompare in lib/batchImport/parseDesignFilename.ts so
 * `sf-giants` (Firestore slug) compares equal to `sf_giants` (filename token).
 */
function normalizeSlugForCompare(s) {
  return String(s).toLowerCase().replace(/-/g, "_");
}

function splitMiddleForTeamAndFamily(middle, options) {
  if (middle.length === 0) return { designFamily: "", team: "" };
  const isCity69 =
    middle.length >= 2 &&
    middle[middle.length - 2].toLowerCase() === "city" &&
    /^\d+$/.test(middle[middle.length - 1]);
  if (isCity69) {
    const identity = middle.slice(0, -2);
    const theme = middle.slice(-2).join("_");
    return {
      designFamily: theme,
      team: identity.length ? identity[identity.length - 1] : "",
    };
  }
  const isTrailing69Series = middle.length >= 2 && middle[middle.length - 1] === "69";
  if (isTrailing69Series) {
    const identity = middle.slice(0, -1);
    return {
      designFamily: "city_69",
      team: identity.join("_"),
    };
  }

  /**
   * Registry-aware multi-token matching (mirror of
   * lib/batchImport/parseDesignFilename.ts). When `knownTeamSlugs` is passed,
   * try multi-token windows against the registry to handle slugs like
   * `sf_giants` that span two tokens. Falls back to legacy single-token tail
   * matching when no registry is available or no window matches.
   *
   * Without this, `mlb_pillows_sf_giants_dark` parsed team=`giants` which then
   * fuzzy-matched the wrong team in matchDesignTeam (alphabetical iteration
   * picked `new_york_giants` over `sf_giants`).
   */
  if (options && options.knownTeamSlugs && options.knownTeamSlugs.size > 0) {
    const normalizedRegistry = new Set();
    for (const slug of options.knownTeamSlugs) {
      normalizedRegistry.add(normalizeSlugForCompare(slug));
    }

    /** Tail-first: try the longest trailing window first. */
    for (let n = middle.length; n >= 2; n--) {
      const candidate = middle.slice(-n).join("_").toLowerCase();
      if (normalizedRegistry.has(candidate)) {
        return {
          designFamily: middle.slice(0, -n).join("_"),
          team: candidate,
        };
      }
    }

    /** Head-first: try the longest leading window. */
    for (let n = middle.length; n >= 2; n--) {
      const candidate = middle.slice(0, n).join("_").toLowerCase();
      if (normalizedRegistry.has(candidate)) {
        return {
          designFamily: middle.slice(n).join("_"),
          team: candidate,
        };
      }
    }

    /** Single-token head match (e.g., `mlb_dodgers_pillows_dark`). */
    const headSingle = middle[0].toLowerCase();
    if (normalizedRegistry.has(headSingle)) {
      return {
        designFamily: middle.slice(1).join("_"),
        team: headSingle,
      };
    }
  }

  const team = middle[middle.length - 1];
  const designFamily = middle.slice(0, -1).join("_");
  return { designFamily, team };
}

function designFileKindFromToneExt(tone, ext) {
  const t = String(tone).trim().toLowerCase();
  const e = String(ext).trim().toLowerCase();
  if (e === "png") {
    if (t === "light") return "lightPng";
    if (t === "dark") return "darkPng";
    return "whitePng";
  }
  if (e === "svg") {
    if (t === "light") return "lightSvg";
    if (t === "dark") return "darkSvg";
    return "whiteSvg";
  }
  if (t === "light") return "lightPdf";
  if (t === "dark") return "darkPdf";
  return "whitePdf";
}

function designFileKindFromSideToneExt(side, tone, ext) {
  const s = String(side).trim().toLowerCase();
  const t = String(tone).trim().toLowerCase();
  const e = String(ext).trim().toLowerCase();
  const toneCap = t === "light" ? "Light" : t === "dark" ? "Dark" : "White";
  const extCap = e === "png" ? "Png" : e === "svg" ? "Svg" : "Pdf";
  const prefix = s === "front" ? "front" : "back";
  return `${prefix}${toneCap}${extCap}`;
}

function importKindForParsed(parsed) {
  if (parsed.filenameLegacySide) {
    return designFileKindFromSideToneExt(parsed.filenameLegacySide, parsed.garmentTone, parsed.extension);
  }
  return designFileKindFromToneExt(parsed.garmentTone, parsed.extension);
}

function parseDesignFilename(filePathOrName, options) {
  const filename = filePathOrName.split(/[/\\]/).pop() || filePathOrName;
  const ext = getExt(filename);
  if (!ext) return { parsed: null, status: "invalid_format", message: "No extension" };
  if (!SUPPORTED_EXT.has(ext)) {
    return { parsed: null, status: "unsupported_extension", message: `Extension .${ext} not supported` };
  }
  const base = baseNameNoExt(filename);
  const tokens = base.split("_").filter(Boolean);
  if (tokens.length < MIN_CANONICAL) {
    return {
      parsed: null,
      status: "missing_token",
      message: `Need at least ${MIN_CANONICAL} underscore-separated parts`,
    };
  }
  const garmentToneRaw = tokens[tokens.length - 1];
  if (!KNOWN_TONES.has(garmentToneRaw.toUpperCase())) {
    return {
      parsed: null,
      status: "unknown_garment_tone",
      message: `Last segment must be LIGHT, DARK, or WHITE`,
    };
  }
  const secondLast = tokens.length >= 2 ? tokens[tokens.length - 2] : "";
  const looksLegacy = KNOWN_SIDES.has(secondLast.toUpperCase());
  let filenameLegacySide = null;
  let league;
  let middle;
  let designKey;
  if (looksLegacy) {
    if (tokens.length < MIN_LEGACY) {
      return {
        parsed: null,
        status: "missing_token",
        message: "Legacy filenames need at least 5 parts",
      };
    }
    filenameLegacySide = secondLast.toLowerCase() === "front" ? "front" : "back";
    league = tokens[0];
    middle = tokens.slice(1, -2);
    if (middle.length < 1) {
      return { parsed: null, status: "missing_token", message: "Missing identity before side" };
    }
    designKey = [league, ...middle].join("_");
  } else {
    league = tokens[0];
    middle = tokens.slice(1, -1);
    if (middle.length < 1) {
      return { parsed: null, status: "missing_token", message: "Missing identity before tone" };
    }
    designKey = [league, ...middle].join("_");
  }
  const { designFamily, team } = splitMiddleForTeamAndFamily(middle, options);
  return {
    parsed: {
      league,
      designKey,
      baseKey: designKey,
      designFamily,
      team,
      side: filenameLegacySide,
      filenameLegacySide,
      garmentTone: garmentToneRaw,
      variant: garmentToneRaw,
      extension: ext,
      filename,
    },
    status: "valid",
  };
}

function inferIdentityFromDesignKey(designKey) {
  const tokens = designKey.split("_").filter(Boolean);
  if (tokens.length < 2) {
    return {
      leagueToken: tokens[0] || "unknown",
      leagueCode: (tokens[0] || "UNK").toUpperCase(),
      teamSlugCandidate: "",
      themeSlugCandidate: null,
      designSeriesCandidate: null,
      designType: "custom_one_off",
      themeDisplayName: "",
    };
  }
  const leagueToken = tokens[0];
  const leagueCode = leagueToken.toUpperCase();
  const n = tokens.length;
  if (n >= 4 && tokens[n - 2].toLowerCase() === "city" && /^\d+$/.test(tokens[n - 1])) {
    const series = tokens[n - 1];
    const teamSlugCandidate = tokens.slice(1, n - 2).join("_");
    return {
      leagueToken,
      leagueCode,
      teamSlugCandidate,
      themeSlugCandidate: `city_${series}`,
      designSeriesCandidate: series,
      designType: "city_69",
      themeDisplayName: `City ${series}`,
    };
  }
  if (n >= 3 && tokens[n - 1] === "69") {
    const teamSlugCandidate = tokens.slice(1, n - 1).join("_");
    if (teamSlugCandidate) {
      return {
        leagueToken,
        leagueCode,
        teamSlugCandidate,
        themeSlugCandidate: "city_69",
        designSeriesCandidate: "69",
        designType: "city_69",
        themeDisplayName: "City 69",
      };
    }
  }
  const teamSlugCandidate = tokens.slice(1, -1).join("_");
  const themeToken = tokens[n - 1];
  return {
    leagueToken,
    leagueCode,
    teamSlugCandidate: teamSlugCandidate || themeToken,
    themeSlugCandidate: tokens.length > 2 ? themeToken : null,
    designSeriesCandidate: /^\d+$/.test(themeToken) ? themeToken : null,
    designType: "custom_one_off",
    themeDisplayName: themeToken
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" "),
  };
}

function identityKeyToSlug(identityKey) {
  return identityKey
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_/g, "-");
}

function normKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TEAM_SLUG_ALIASES = {
  newyork_yankees: "ny_yankees",
  new_york_yankees: "ny_yankees",
  newyork_mets: "ny_mets",
  new_york_mets: "ny_mets",
  sanfrancisco_giants: "sf_giants",
  san_francisco_giants: "sf_giants",
  losangeles_dodgers: "los_angeles_dodgers",
  los_angeles_dodgers: "los_angeles_dodgers",
  losangeles_angels: "los_angeles_angels",
  los_angeles_angels: "los_angeles_angels",
};

function leagueMatchesTeam(t, leagueHint) {
  if (leagueHint == null || String(leagueHint).trim() === "") return true;
  const h = String(leagueHint)
    .trim()
    .toUpperCase();
  const lc = String(t.leagueCode || t.leagueId || t.league || "")
    .trim()
    .toUpperCase();
  return !lc || lc === h;
}

function resolveTeamSlugForMatch(parsedTeam, inferred) {
  if (inferred.designType === "city_69") {
    return inferred.teamSlugCandidate;
  }
  const pt = String(parsedTeam ?? "").trim();
  const inf = String(inferred.teamSlugCandidate ?? "").trim();
  if (/^\d+$/.test(pt) && inf.length > 0) {
    return inf;
  }
  return pt || inf;
}

/**
 * Build a set of candidate team slugs to try (in priority order) so that
 * matchDesignTeam can recover when the parser's `parsedTeam` doesn't match a
 * registered team but `inferred.teamSlugCandidate` does. Each candidate is
 * tried independently against the full match chain.
 */
function buildTeamSlugCandidates(parsedTeam, inferred) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = String(v ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  };
  push(resolveTeamSlugForMatch(parsedTeam, inferred));
  push(inferred.teamSlugCandidate);
  push(parsedTeam);
  return out;
}

function matchDesignTeam(teamSlugCandidate, teams, options) {
  const warnings = [];
  const cand = String(teamSlugCandidate).trim();
  if (!cand) return { team: null, warnings: ["Missing team slug in identity"] };
  const candNorm = normKey(cand);
  const leagueHint = options && options.leagueHint;

  const aliasTarget = TEAM_SLUG_ALIASES[cand.toLowerCase()];
  if (aliasTarget) {
    for (const t of teams) {
      if (t.id === aliasTarget) {
        warnings.push(`Team matched via filename alias → ${aliasTarget}`);
        return { team: t, warnings };
      }
    }
  }

  for (const t of teams) {
    if (t.id === cand || t.id.toLowerCase() === cand.toLowerCase()) return { team: t, warnings };
  }
  for (const t of teams) {
    if (t.slug && normKey(t.slug) === candNorm) return { team: t, warnings };
    if (t.teamCode && normKey(t.teamCode) === candNorm) return { team: t, warnings };
    if (t.name && normKey(t.name) === candNorm) return { team: t, warnings };
  }

  /**
   * Loose-overlap fallback is dangerous when the candidate is a single short
   * nickname like "giants" (matches both `sf_giants` AND `new_york_giants`).
   * Require leagueHint to disambiguate and require a unique match — otherwise
   * fail closed.
   */
  {
    const overlap = teams.filter(
      (t) =>
        leagueMatchesTeam(t, leagueHint) &&
        (normKey(t.id).includes(candNorm) || candNorm.includes(normKey(t.id)))
    );
    if (overlap.length === 1) {
      warnings.push(`Team matched loosely by id overlap: ${overlap[0].id}`);
      return { team: overlap[0], warnings };
    }
    if (overlap.length > 1) {
      warnings.push(
        `Ambiguous loose match for "${teamSlugCandidate}" within league ${leagueHint || "(any)"}: ${overlap
          .map((t) => t.id)
          .join(", ")}`
      );
    }
  }

  const candParts = cand.split("_").filter(Boolean);
  {
    const byName = teams.filter((t) => {
      if (!leagueMatchesTeam(t, leagueHint)) return false;
      const nameNorm = normKey(t.name || "");
      return candParts.every((p) => p.length > 2 && nameNorm.includes(normKey(p)));
    });
    if (byName.length === 1) {
      warnings.push(`Team matched by name tokens: ${byName[0].name}`);
      return { team: byName[0], warnings };
    }
    if (byName.length > 1) {
      warnings.push(
        `Ambiguous name-token match for "${teamSlugCandidate}" within league ${leagueHint || "(any)"}: ${byName
          .map((t) => t.id)
          .join(", ")}`
      );
    }
  }

  const lastTok = candParts.length ? candParts[candParts.length - 1] : "";
  if (lastTok.length > 2) {
    const nick = normKey(lastTok);
    const byNick = teams.filter(
      (t) =>
        leagueMatchesTeam(t, leagueHint) &&
        t.teamName &&
        normKey(t.teamName) === nick
    );
    if (byNick.length === 1) {
      warnings.push(`Team matched by nickname + league: ${byNick[0].teamName}`);
      return { team: byNick[0], warnings };
    }
    if (byNick.length > 1) {
      warnings.push(
        `Ambiguous nickname+league match for "${teamSlugCandidate}" in ${leagueHint || "(any)"}: ${byNick
          .map((t) => t.id)
          .join(", ")}`
      );
    }
  }
  warnings.push(`No design_teams match for slug "${teamSlugCandidate}"`);
  return { team: null, warnings };
}

/**
 * Try each candidate slug through `matchDesignTeam`; return the first hit.
 * Used to recover when the parsed team token is ambiguous (e.g., `giants`)
 * but the inferred candidate from designKey is specific (e.g., `pillows_sf`).
 */
function matchDesignTeamMulti(candidates, teams, options) {
  const aggregatedWarnings = [];
  for (const cand of candidates) {
    const { team, warnings } = matchDesignTeam(cand, teams, options);
    if (team) {
      return { team, warnings: [...aggregatedWarnings, ...warnings] };
    }
    aggregatedWarnings.push(...warnings);
  }
  return { team: null, warnings: aggregatedWarnings };
}

const KIND_TO_COVERAGE = {
  lightPng: "hasLightPng",
  darkPng: "hasDarkPng",
  whitePng: "hasWhitePng",
  lightSvg: "hasLightSvg",
  darkSvg: "hasDarkSvg",
  whiteSvg: "hasWhiteSvg",
  lightPdf: "hasLightPdf",
  darkPdf: "hasDarkPdf",
  whitePdf: "hasWhitePdf",
  frontLightPng: "hasLightPng",
  frontDarkPng: "hasDarkPng",
  frontWhitePng: "hasWhitePng",
  backLightPng: "hasLightPng",
  backDarkPng: "hasDarkPng",
  backWhitePng: "hasWhitePng",
  frontLightSvg: "hasLightSvg",
  frontDarkSvg: "hasDarkSvg",
  frontWhiteSvg: "hasWhiteSvg",
  backLightSvg: "hasLightSvg",
  backDarkSvg: "hasDarkSvg",
  backWhiteSvg: "hasWhiteSvg",
  frontLightPdf: "hasLightPdf",
  frontDarkPdf: "hasDarkPdf",
  frontWhitePdf: "hasWhitePdf",
  backLightPdf: "hasLightPdf",
  backDarkPdf: "hasDarkPdf",
  backWhitePdf: "hasWhitePdf",
};

function emptyCoverage() {
  return {
    hasLightPng: false,
    hasDarkPng: false,
    hasWhitePng: false,
    hasLightSvg: false,
    hasDarkSvg: false,
    hasWhiteSvg: false,
    hasLightPdf: false,
    hasDarkPdf: false,
    hasWhitePdf: false,
  };
}

function coverageFromKind(kind) {
  return KIND_TO_COVERAGE[kind] || null;
}

function hasAnyPng(c) {
  return c.hasLightPng || c.hasDarkPng || c.hasWhitePng;
}

function humanizeSlug(slug) {
  return String(slug)
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function findExistingDesign(designs, groupKey, slug, leagueCode, teamId, themeCode, designSeries) {
  const byImport = designs.find((d) => d.importKey === groupKey);
  if (byImport) return { design: byImport, reason: "importKey" };
  const bySlug = designs.find((d) => d.slug && d.slug.toLowerCase() === slug.toLowerCase());
  if (bySlug) return { design: bySlug, reason: "slug" };
  if (!teamId) return { design: null, reason: null };
  const composite = designs.find(
    (d) =>
      d.leagueCode === leagueCode &&
      d.teamId === teamId &&
      (d.themeCode === themeCode || (!themeCode && !d.themeCode)) &&
      (d.designSeries === designSeries || (!designSeries && !d.designSeries))
  );
  if (composite) return { design: composite, reason: "league_team_theme_series" };
  return { design: null, reason: null };
}

/** Resolve merged flat URLs (same logic as index resolveDesignAssetUrls for overwrite checks). */
function resolveFlatAssetUrls(design) {
  const a = design.assets || {};
  const f = design.files || {};
  return {
    lightPng: a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null,
    lightSvg: a.lightSvg || (f.lightSvg && f.lightSvg.downloadUrl) || (f.svg && f.svg.downloadUrl) || null,
    darkSvg: a.darkSvg || (f.darkSvg && f.darkSvg.downloadUrl) || null,
    whiteSvg: a.whiteSvg || (f.whiteSvg && f.whiteSvg.downloadUrl) || null,
    lightPdf: a.lightPdf || (f.lightPdf && f.lightPdf.downloadUrl) || (f.pdf && f.pdf.downloadUrl) || null,
    darkPdf: a.darkPdf || (f.darkPdf && f.darkPdf.downloadUrl) || null,
    whitePdf: a.whitePdf || (f.whitePdf && f.whitePdf.downloadUrl) || null,
  };
}

const COV_TO_URLKEY = {
  hasLightPng: "lightPng",
  hasDarkPng: "darkPng",
  hasWhitePng: "whitePng",
  hasLightSvg: "lightSvg",
  hasDarkSvg: "darkSvg",
  hasWhiteSvg: "whiteSvg",
  hasLightPdf: "lightPdf",
  hasDarkPdf: "darkPdf",
  hasWhitePdf: "whitePdf",
};

function computeOverwriteWarnings(existing, coverage) {
  if (!existing) return {};
  const urls = resolveFlatAssetUrls(existing);
  const out = {};
  for (const key of Object.keys(coverage)) {
    if (!coverage[key]) continue;
    const uk = COV_TO_URLKEY[key];
    if (uk && urls[uk]) out[key] = true;
  }
  return out;
}

function filterServerDescriptor(desc) {
  const name = desc.originalFilename || "";
  const base = name.split(/[/\\]/).pop() || name;
  if (base.startsWith(".") && base !== ".") {
    return { ok: false, ignored: { name: base, reason: "hidden_file" } };
  }
  if ((desc.size || 0) === 0) {
    return { ok: false, ignored: { name: base, reason: "zero_bytes" } };
  }
  const ext = getExt(base);
  if (!ext) return { ok: false, ignored: { name: base, reason: "no_extension" } };
  if (IGNORE_EXT.has(ext)) {
    return { ok: false, ignored: { name: base, reason: "unsupported_extension", detail: `.${ext}` } };
  }
  if (!SUPPORTED_EXT.has(ext)) {
    return { ok: false, ignored: { name: base, reason: "unsupported_extension", detail: `.${ext}` } };
  }
  return { ok: true };
}

/**
 * Style codes whose downstream render/composite pipeline is wired today.
 * Used to flag `pipelineReady` on availableBlanks so the bulk-upload UI can
 * disable the others. Update this as new pipelines land.
 */
const PIPELINE_READY_STYLE_CODES = new Set(["8394"]);

/**
 * @param {Array<{originalFilename: string, storagePath: string, ext: string, size: number, contentType?: string}>} descriptors
 * @param {object[]} designRows - plain objects from Firestore designs
 * @param {object[]} teamRows - plain objects from design_teams
 * @param {Array<{id: string, styleCode?: string, name?: string, category?: string, schemaVersion?: number, status?: string}>} masterBlanks - all active schemaVersion=2 blanks from rp_blanks
 * @param {{ requirePng?: boolean }} options
 */
function buildPreviewItems(descriptors, designRows, teamRows, masterBlanks, options) {
  const requirePng = options.requirePng !== false;

  /**
   * Build the shared availableBlanks payload once — same list for every design
   * row in this preview job. `pipelineReady` lets the UI gate selection so
   * operators only check blanks whose downstream renderer actually works.
   */
  const availableBlanks = (Array.isArray(masterBlanks) ? masterBlanks : []).map((b) => {
    const styleCode = String((b && b.styleCode) || "").trim();
    return {
      blankId: b.id,
      styleCode,
      name: b.name || b.productName || null,
      category: b.category || null,
      pipelineReady: PIPELINE_READY_STYLE_CODES.has(styleCode),
    };
  });
  const parseFailures = [];
  const accepted = [];
  const ignored = [];

  /**
   * Build a registry of known team slugs (slug + shortSlug + id) so the parser
   * can resolve multi-token team names like `sf_giants`. Hyphens normalized
   * to underscores by `normalizeSlugForCompare` inside splitMiddleForTeamAndFamily.
   */
  const knownTeamSlugs = new Set();
  for (const t of teamRows) {
    if (t.slug) knownTeamSlugs.add(t.slug);
    if (t.shortSlug) knownTeamSlugs.add(t.shortSlug);
    if (t.id) knownTeamSlugs.add(t.id);
  }
  const parseOptions = { knownTeamSlugs };

  for (const d of descriptors) {
    const f = filterServerDescriptor(d);
    if (!f.ok) {
      ignored.push(f.ignored);
      continue;
    }
    const ext = getExt(d.originalFilename);
    const pr = parseDesignFilename(d.originalFilename, parseOptions);
    if (pr.status !== "valid" || !pr.parsed) {
      parseFailures.push({
        name: d.originalFilename,
        message: pr.message || pr.status,
      });
      continue;
    }
    if (pr.parsed.extension !== ext) {
      parseFailures.push({ name: d.originalFilename, message: "Extension mismatch" });
      continue;
    }
    accepted.push({ descriptor: d, parsed: pr.parsed, result: pr });
  }

  const grouped = new Map();
  for (const row of accepted) {
    const key = row.parsed.designKey;
    const kind = importKindForParsed(row.parsed);
    const entry = {
      descriptor: row.descriptor,
      ext: row.parsed.extension,
      kind,
      filenameLegacySide: row.parsed.filenameLegacySide,
    };
    if (!grouped.has(key)) {
      grouped.set(key, {
        designKey: key,
        parsed: row.parsed,
        files: [entry],
        legacyFilenameSides: row.parsed.filenameLegacySide ? [row.parsed.filenameLegacySide] : [],
      });
    } else {
      const g = grouped.get(key);
      g.files.push(entry);
      if (
        row.parsed.filenameLegacySide &&
        !g.legacyFilenameSides.includes(row.parsed.filenameLegacySide)
      ) {
        g.legacyFilenameSides.push(row.parsed.filenameLegacySide);
      }
    }
  }

  const items = [];
  for (const [, row] of grouped) {
    const groupKey = row.designKey;
    const inferred = inferIdentityFromDesignKey(groupKey);
    const parsed = row.parsed;
    const teamSlugCandidates = buildTeamSlugCandidates(parsed.team, inferred);
    const { team, warnings: teamWarnings } = matchDesignTeamMulti(teamSlugCandidates, teamRows, {
      leagueHint: inferred.leagueCode,
    });

    const teamDisplay = team ? team.name : null;
    const teamId = team ? team.id : null;
    const teamCode = team ? team.teamCode : null;
    const leagueCode = team ? team.leagueCode || team.leagueId : inferred.leagueCode;

    /**
     * Theme picker (2026-05-27): for non-city_69 themes prefer `parsed.designFamily`
     * (registry-aware parser output — correct) over `inferred.themeSlugCandidate`
     * (positional inference from designKey that assumes LEAGUE_TEAM_THEME order
     * and gets confused by LEAGUE_THEME_TEAM filenames like
     * `mlb_pillows_sf_giants` → picks "giants" instead of "pillows").
     */
    const themeCode =
      inferred.designType === "city_69"
        ? (inferred.themeSlugCandidate
            ? inferred.themeSlugCandidate.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
            : null)
        : (parsed.designFamily
            ? parsed.designFamily.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
            : (inferred.themeSlugCandidate
                ? inferred.themeSlugCandidate.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
                : null));
    const themeName =
      inferred.designType === "city_69"
        ? inferred.themeDisplayName
        : humanizeSlug(parsed.designFamily || inferred.themeSlugCandidate || "");

    const designSeries =
      inferred.designSeriesCandidate || (parsed.designFamily === "city_69" ? "69" : null);

    let designName;
    const familyHuman = humanizeSlug(parsed.designFamily || "");
    if (inferred.designType === "city_69") {
      const teamLabel = teamDisplay || humanizeSlug(parsed.team || inferred.teamSlugCandidate);
      designName = `${teamLabel} ${inferred.themeDisplayName}`.trim();
    } else if (teamDisplay && familyHuman && familyHuman.toLowerCase() === String(teamDisplay).toLowerCase()) {
      designName = inferred.themeDisplayName
        ? `${teamDisplay} ${inferred.themeDisplayName}`.trim()
        : teamDisplay;
    } else {
      designName = teamDisplay
        ? `${teamDisplay} ${familyHuman}`.trim()
        : humanizeSlug(`${parsed.designFamily}_${parsed.team}`.replace(/^_+|_+$/g, ""));
    }

    const slug = identityKeyToSlug(groupKey);
    const coverage = emptyCoverage();
    const kindCounts = new Map();
    let duplicateKindConflicts = false;
    const filesOut = [];

    for (const f of row.files) {
      const k = f.kind;
      kindCounts.set(k, (kindCounts.get(k) || 0) + 1);
      if (kindCounts.get(k) > 1) duplicateKindConflicts = true;
      const cov = coverageFromKind(k);
      if (cov) coverage[cov] = true;
      filesOut.push({
        kind: k,
        originalFilename: f.descriptor.originalFilename,
        storagePath: f.descriptor.storagePath,
        ext: f.ext,
        size: f.descriptor.size,
        filenameLegacySide: f.filenameLegacySide,
      });
    }

    const warnings = [...teamWarnings];
    if (row.files.some((x) => x.filenameLegacySide)) {
      warnings.push("Legacy _front_/_back_ segment in filename (ignored for placement)");
    }

    const errors = [];
    if (duplicateKindConflicts) {
      errors.push("Duplicate file for same tone/format in group");
    }
    if (requirePng && !hasAnyPng(coverage)) {
      errors.push("No PNG artwork — design is not render-ready (SVG/PDF only)");
    }

    const { design: existing, reason: matchReason } = findExistingDesign(
      designRows,
      groupKey,
      slug,
      leagueCode || null,
      teamId,
      themeCode,
      designSeries
    );

    let defaultAction = "create";
    if (errors.length > 0) {
      defaultAction = "blocked";
    } else if (existing) {
      defaultAction = "update";
    }

    const overwriteWarnings = computeOverwriteWarnings(existing, coverage);

    const itemId = groupKey.replace(/[/\\]/g, "_").slice(0, 1400);

    /**
     * Default the operator's blank selection to all pipeline-ready blanks. They
     * can uncheck on the review screen; the disabled non-pipeline-ready ones
     * cannot be selected today.
     */
    const defaultTargetBlankIds = availableBlanks
      .filter((b) => b.pipelineReady)
      .map((b) => b.blankId);

    items.push({
      itemId,
      groupKey,
      slug,
      designName,
      leagueCode: leagueCode || inferred.leagueCode,
      teamId,
      teamName: teamDisplay,
      teamCode,
      themeCode,
      themeName: themeName || null,
      designSeries,
      designType: inferred.designType,
      files: filesOut,
      assetCoverage: coverage,
      warnings,
      errors,
      defaultAction,
      confirmedAction: defaultAction,
      existingDesignId: existing ? existing.id : null,
      existingMatchReason: matchReason,
      overwriteWarnings,
      overwriteAllowed: false,
      duplicateKindConflicts,
      availableBlanks,
      defaultTargetBlankIds,
    });
  }

  return { items, parseFailures, ignored };
}

module.exports = {
  filterServerDescriptor,
  parseDesignFilename,
  buildPreviewItems,
  hasAnyPng,
  coverageFromKind,
  importKindForParsed,
  identityKeyToSlug,
};
