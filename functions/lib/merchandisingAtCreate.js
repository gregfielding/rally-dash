"use strict";

const { stripUnresolvedTemplateArtifacts } = require("./resolveBlankTemplates");

/**
 * Storefront merchandising at product creation (design + blank + team + variant).
 * Internal design names stay on `designs` (e.g. "San Francisco Giants City 69");
 * rp_products get cleaner storefront titles: {teamNameFull} {designShortName} {colorName} {productType}.
 */

/** Long labels for internal / template use (design doc naming) */
const DESIGN_TYPE_LABELS = {
  city_69: "City 69",
  slogan: "Slogan",
  stadium: "Stadium",
  rivalry: "Rivalry",
  number: "Number",
  wordplay: "Wordplay",
  badge_crest: "Badge / Crest",
  custom_one_off: "Custom / One-off",
  wordmark: "Wordmark (legacy)",
  script: "Script (legacy)",
  other: "Other (legacy)",
  badge: "Badge (legacy)",
};

/**
 * Short storefront token for titles, SEO, collections (e.g. city_69 → "69").
 * @param {string | null | undefined} designType
 * @returns {string}
 */
function designTypeToStorefrontShort(designType) {
  if (designType == null || designType === "") return "";
  const key = String(designType).trim();
  const SHORT = {
    city_69: "69",
    slogan: "Slogan",
    stadium: "Stadium",
    rivalry: "Rivalry",
    number: "Number",
    wordplay: "Wordplay",
    badge_crest: "Badge",
    custom_one_off: "Custom",
    wordmark: "Wordmark",
    script: "Script",
    other: "Other",
    badge: "Badge",
  };
  if (SHORT[key]) return SHORT[key];
  return DESIGN_TYPE_LABELS[key] || "";
}

function designTypeToLabel(designType) {
  if (designType == null || designType === "") return "";
  const key = String(designType).trim();
  return DESIGN_TYPE_LABELS[key] || "";
}

/** Legacy slug theme (city-69); prefer designShortName for collections/tags when numeric short exists */
function designTypeToThemeSlug(designType) {
  if (designType == null || designType === "") return "";
  return String(designType)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCommerceTag(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

function normalizeLeagueToken(league) {
  if (!league || typeof league !== "string") return "";
  return normalizeCommerceTag(league.replace(/\./g, ""));
}

function toTitleCaseWords(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  return t
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * @param {object | null} team - design_teams doc
 * @param {object} design - designs doc
 */
function buildTeamDisplayName(team, design) {
  if (team && team.name && String(team.name).trim()) return String(team.name).trim();
  if (design.teamNameCache && String(design.teamNameCache).trim()) return String(design.teamNameCache).trim();
  return design.name && String(design.name).trim() ? String(design.name).trim() : "Team";
}

/**
 * Singular storefront garment word: "Panty", "Thong", …
 * @param {object} blank - rp_blanks
 */
function buildStorefrontProductTypeWord(blank) {
  const cat = String(blank.garmentCategory || blank.category || "panty").toLowerCase();
  if (cat === "panty") return "Panty";
  if (cat === "thong") return "Thong";
  if (cat === "tank") return "Tank";
  if (cat === "crewneck") return "Crewneck";
  const gs = blank.garmentStyle && String(blank.garmentStyle).trim();
  if (gs) {
    const lower = gs.toLowerCase();
    if (/\bpanty\b/.test(lower)) return "Panty";
    if (/\bthong\b/.test(lower)) return "Thong";
  }
  return "Apparel";
}

/** Tag slug: panty, thong, … */
function garmentCategoryToTagSlug(blank) {
  const w = buildStorefrontProductTypeWord(blank);
  return w.toLowerCase();
}

function isApparelBlank(blank) {
  const c = String(blank.garmentCategory || blank.category || "panty").toLowerCase();
  return ["panty", "thong", "tank", "crewneck"].includes(c);
}

/**
 * Storefront title: teamNameFull + designShortName + colorName + productType (single spaces)
 */
function buildStorefrontTitle({ teamNameFull, designShortName, colorName, productTypeWord }) {
  const parts = [
    String(teamNameFull || "").trim(),
    String(designShortName || "").trim(),
    toTitleCaseWords(String(colorName || "").trim()),
    String(productTypeWord || "").trim(),
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Parent product title (no color): teamNameFull + designShortName + productType
 */
function buildStorefrontTitleParent({ teamNameFull, designShortName, productTypeWord }) {
  const parts = [
    String(teamNameFull || "").trim(),
    String(designShortName || "").trim(),
    String(productTypeWord || "").trim(),
  ].filter(Boolean);
  return parts.join(" ");
}

function generateSlugFromTitle(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * SEO / body: low-rise panty … team + short design … color (capitalized)
 */
function buildStorefrontSeoDescription({ teamDisplay, designShortName, colorName }) {
  const team = String(teamDisplay || "").trim();
  const ds = String(designShortName || "").trim();
  const col = toTitleCaseWords(String(colorName || "").trim());
  return `Soft, breathable low-rise panty featuring the ${team} ${ds} design in ${col}. Made in Los Angeles with a premium cotton stretch fit.`;
}

function buildStorefrontSeoDescriptionParent({ teamDisplay, designShortName }) {
  const team = String(teamDisplay || "").trim();
  const ds = String(designShortName || "").trim();
  return `Soft, breathable low-rise panty featuring the ${team} ${ds} design. Made in Los Angeles with a premium cotton stretch fit.`;
}

/**
 * Token for blank description templates: short design label without repeating the team name
 * (design.name is often "Team Name City 69" — use "City 69" after stripping the team prefix, or designShortName).
 */
function buildDesignNameForTemplates(design, teamNameFull, designShortName) {
  const full = String(design.name || "").trim();
  const team = String(teamNameFull || "").trim();
  if (team && full.length > 0) {
    const lower = full.toLowerCase();
    const tp = team.toLowerCase();
    if (lower.startsWith(tp + " ")) {
      return full.slice(team.length).trim();
    }
  }
  const ds = String(designShortName || "").trim();
  if (ds) return ds;
  return full || "Design";
}

/**
 * Collapse immediately repeated word sequences ("San Francisco Giants San Francisco Giants" → once).
 */
function collapseDuplicateAdjacentPhrases(text) {
  let out = String(text || "");
  let prev;
  do {
    prev = out;
    out = out.replace(/\b(\S+(?:\s+\S+){0,5})\s+\1\b/gi, "$1");
  } while (out !== prev);
  return out.replace(/\s+/g, " ").trim();
}

function buildSeoTitle({ productTitle, brandSuffix }) {
  const b = (brandSuffix && String(brandSuffix).trim()) || "Rally Panties";
  return `${String(productTitle || "").trim()} | ${b}`;
}

function htmlToPlainText(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildShortDescriptionFromBody(plain, maxLen = 220) {
  const s = String(plain || "").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(" ");
  return sp > 40 ? `${cut.slice(0, sp)}…` : `${cut}…`;
}

function extractMaterialStyleTags(blank) {
  const hay = `${blank.styleName || ""} ${blank.garmentStyle || ""}`.toLowerCase();
  const out = [];
  if (/\blow[\s-]?rise\b/.test(hay)) out.push("low-rise");
  if (/\bcotton\b/.test(hay) && /\bstretch\b/.test(hay)) out.push("cotton-stretch");
  else if (/\bcotton\b/.test(hay)) out.push("cotton");
  else if (/\bstretch\b/.test(hay)) out.push("stretch");
  return out;
}

function garmentCategoryToCollectionKey(blank) {
  const gc = String(blank.garmentCategory || blank.category || "panty").toLowerCase();
  if (gc === "panty") return "panties";
  if (gc === "thong") return "thongs";
  if (gc === "tank") return "tanks";
  if (gc === "crewneck") return "crewnecks";
  return gc.replace(/[^a-z0-9-]/g, "") || "apparel";
}

/**
 * Collection keys: league, team nickname, garment family, design short (e.g. "69")
 */
function buildCollectionKeys({ leagueSlug, teamNicknameSlug, garmentCollectionKey, designShortKey }) {
  const keys = [];
  if (leagueSlug) keys.push(leagueSlug);
  if (teamNicknameSlug) keys.push(teamNicknameSlug);
  if (garmentCollectionKey) keys.push(garmentCollectionKey);
  if (designShortKey) keys.push(String(designShortKey).toLowerCase().replace(/\s+/g, "-"));
  return [...new Set(keys.filter(Boolean))];
}

function buildCommerceTags({ team, blank, colorName, designShortName, leagueToken, garmentTagSlug }) {
  const seen = new Set();
  const tags = [];

  function pushTag(raw) {
    const t = normalizeCommerceTag(raw);
    if (!t || seen.has(t)) return;
    seen.add(t);
    tags.push(t);
  }

  if (team && team.name) pushTag(team.name.replace(/\s+/g, " "));
  if (team && team.teamName) pushTag(team.teamName);
  if (leagueToken) pushTag(leagueToken);
  if (designShortName) pushTag(String(designShortName));
  if (garmentTagSlug) pushTag(garmentTagSlug);
  if (colorName) pushTag(colorName);

  for (const m of extractMaterialStyleTags(blank)) pushTag(m);

  return tags;
}

function normalizeLeagueCode(team, design) {
  const raw =
    (design.leagueCode && String(design.leagueCode).trim()) ||
    (team && team.leagueCode && String(team.leagueCode).trim()) ||
    (team && team.leagueId && String(team.leagueId).trim()) ||
    (team && team.league && String(team.league).trim()) ||
    "";
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

function inferSportCodeFromLeagueCode(leagueCode) {
  if (!leagueCode) return null;
  const u = String(leagueCode).toUpperCase();
  const map = {
    MLB: "BASEBALL",
    NFL: "FOOTBALL",
    NBA: "BASKETBALL",
    NHL: "HOCKEY",
    MLS: "SOCCER",
    PREMIER_LEAGUE: "SOCCER",
    NCAA: "COLLEGE_SPORTS",
    F1: "RACING",
    NASCAR: "RACING",
    INDYCAR: "RACING",
  };
  return map[u] || null;
}

function inferThemeCodeFromDesign(design) {
  if (design.themeCode && String(design.themeCode).trim()) return String(design.themeCode).trim().toUpperCase();
  const dt = design.designType && String(design.designType).trim();
  if (dt === "city_69") return "CITY_69";
  return null;
}

function inferDesignFamilyFromDesign(design) {
  if (design.designFamily && String(design.designFamily).trim()) return String(design.designFamily).trim().toUpperCase();
  const dt = design.designType && String(design.designType).trim();
  if (dt === "city_69") return "TEAM_NUMBER";
  return null;
}

/**
 * Auto-fill taxonomy for generated sports products when team + league metadata exists.
 * @returns {{ sportCode, leagueCode, teamCode, themeCode, designFamily, taxonomy }}
 */
function sportCodeToDisplayName(sportCode) {
  if (!sportCode) return null;
  const u = String(sportCode).toUpperCase();
  const map = {
    BASEBALL: "Baseball",
    FOOTBALL: "Football",
    BASKETBALL: "Basketball",
    HOCKEY: "Hockey",
    SOCCER: "Soccer",
    RACING: "Racing",
    COLLEGE_SPORTS: "College Sports",
    GOLF: "Golf",
    OLYMPIC_SPORTS: "Olympic Sports",
    GENERIC_SPORTS: "Generic Sports",
    LIFESTYLE: "Lifestyle",
  };
  return map[u] || null;
}

function leagueCodeToDisplayName(leagueCode) {
  if (!leagueCode) return null;
  const u = String(leagueCode).toUpperCase();
  const map = {
    MLB: "MLB",
    NFL: "NFL",
    NBA: "NBA",
    NHL: "NHL",
    MLS: "MLS",
    PREMIER_LEAGUE: "Premier League",
    NCAA: "NCAA",
    F1: "F1",
    NASCAR: "NASCAR",
    INDYCAR: "IndyCar",
  };
  return map[u] || String(leagueCode);
}

function inferTaxonomyForGeneratedSportsProduct(team, design, designShortNameForStorefront) {
  const leagueCode = normalizeLeagueCode(team, design);
  const designThemeLabel = designTypeToLabel(design.designType);

  const sportCode =
    (design.sportCode && String(design.sportCode).trim()) ||
    (leagueCode ? inferSportCodeFromLeagueCode(leagueCode) : null) ||
    null;

  const teamCode =
    (design.teamCode && String(design.teamCode).trim().toUpperCase()) ||
    (team && team.teamCode && String(team.teamCode).trim().toUpperCase()) ||
    null;

  const themeCode = inferThemeCodeFromDesign(design);
  const designFamily = inferDesignFamilyFromDesign(design);

  const teamDisplay = buildTeamDisplayName(team, design);
  const taxonomy = {
    sportName: sportCodeToDisplayName(sportCode),
    leagueName: leagueCodeToDisplayName(leagueCode),
    teamName: teamDisplay || null,
    themeName: designShortNameForStorefront || designThemeLabel || null,
  };

  /** Prefer inferred codes; fall back to explicit design fields when league/sport inference is partial. */
  const hasSportsContext =
    !!(leagueCode && sportCode && (team || teamCode)) ||
    !!(leagueCode && teamCode) ||
    !!(design.leagueCode && String(design.leagueCode).trim());

  return {
    sportCode: hasSportsContext ? sportCode || design.sportCode || null : design.sportCode ?? null,
    leagueCode: hasSportsContext ? leagueCode || design.leagueCode || null : design.leagueCode ?? null,
    teamCode: hasSportsContext ? teamCode || design.teamCode || null : design.teamCode ?? null,
    themeCode: themeCode ?? design.themeCode ?? null,
    designFamily: designFamily ?? design.designFamily ?? null,
    taxonomy: {
      sportName: taxonomy.sportName ?? null,
      leagueName: taxonomy.leagueName ?? null,
      teamName: taxonomy.teamName ?? null,
      themeName: taxonomy.themeName ?? null,
    },
  };
}

/**
 * @returns {object} fields to merge into rp_products
 */
function buildResolvedMerchandisingBundle({
  team,
  design,
  blank,
  colorNameForProduct,
  resolvedBlankDescription,
}) {
  const teamNameFull = buildTeamDisplayName(team, design);
  const designShortName = designTypeToStorefrontShort(design.designType);
  const productTypeWord = buildStorefrontProductTypeWord(blank);
  const colorTitle = toTitleCaseWords(String(colorNameForProduct || "").trim() || "Default");

  const apparel = isApparelBlank(blank);
  const displayTitle = apparel
    ? buildStorefrontTitle({
        teamNameFull,
        designShortName,
        colorName: colorTitle,
        productTypeWord,
      })
    : `${teamNameFull} ${productTypeWord}`.trim();

  const brandSuffix = (blank.shopifyDefaults && blank.shopifyDefaults.brand) || "Rally Panties";
  const seoTitle = buildSeoTitle({ productTitle: displayTitle, brandSuffix });

  const leagueRaw = team && (team.league || team.leagueId || team.leagueCode);
  const leagueToken = normalizeLeagueToken(leagueRaw || "");
  const teamNick = team && team.teamName ? normalizeCommerceTag(team.teamName) : "";
  const garmentKey = garmentCategoryToCollectionKey(blank);
  const garmentTagSlug = garmentCategoryToTagSlug(blank);

  const designShortKey = designShortName ? String(designShortName).toLowerCase() : "";

  const tags = buildCommerceTags({
    team,
    blank,
    colorName: colorTitle,
    designShortName,
    leagueToken,
    garmentTagSlug,
  });

  const collectionKeys = buildCollectionKeys({
    leagueSlug: leagueToken,
    teamNicknameSlug: teamNick,
    garmentCollectionKey: garmentKey,
    designShortKey,
  });

  const tax = inferTaxonomyForGeneratedSportsProduct(team, design, designShortName);

  const trimmedResolved =
    resolvedBlankDescription && String(resolvedBlankDescription).trim()
      ? String(resolvedBlankDescription).trim()
      : "";

  const defaultSeoPlain = buildStorefrontSeoDescription({
    teamDisplay: teamNameFull,
    designShortName,
    colorName: colorTitle,
  });

  let descriptionHtml;
  let descriptionText;

  if (trimmedResolved) {
    descriptionHtml = trimmedResolved;
    descriptionText = htmlToPlainText(trimmedResolved);
  } else {
    descriptionText = defaultSeoPlain;
    const safe = defaultSeoPlain.replace(/</g, "&lt;");
    descriptionHtml = `<p>${safe}</p>`;
  }

  const seoDescription = defaultSeoPlain.slice(0, 320);

  let finalHtmlV = descriptionHtml;
  let finalTextV = descriptionText;
  if (finalHtmlV) {
    finalHtmlV = stripUnresolvedTemplateArtifacts(String(finalHtmlV));
    finalTextV = htmlToPlainText(finalHtmlV);
  }
  const shortDescription = buildShortDescriptionFromBody(finalTextV);

  return {
    displayTitle,
    handleSlug: generateSlugFromTitle(displayTitle),
    seo: {
      title: seoTitle.slice(0, 70),
      description: seoDescription,
    },
    descriptionHtml: finalHtmlV,
    descriptionText: finalTextV,
    shortDescription,
    tags,
    tagsNormalized: tags,
    collectionKeys,
    teamNameFull,
    designShortName,
    productTypeWord,
    tax,
    designThemeLabel: designTypeToLabel(design.designType),
    designThemeSlug: designTypeToThemeSlug(design.designType),
  };
}

/**
 * Parent rp_products row: canonical merchandising without color in title/handle/tags.
 * @returns {object} fields to merge into parent product doc
 */
function buildResolvedMerchandisingBundleForParent({
  team,
  design,
  blank,
  resolvedBlankDescription,
}) {
  const teamNameFull = buildTeamDisplayName(team, design);
  const designShortName = designTypeToStorefrontShort(design.designType);
  const productTypeWord = buildStorefrontProductTypeWord(blank);

  const apparel = isApparelBlank(blank);
  const displayTitle = apparel
    ? buildStorefrontTitleParent({
        teamNameFull,
        designShortName,
        productTypeWord,
      })
    : `${teamNameFull} ${productTypeWord}`.trim();

  const brandSuffix = (blank.shopifyDefaults && blank.shopifyDefaults.brand) || "Rally Panties";
  const seoTitle = buildSeoTitle({ productTitle: displayTitle, brandSuffix });

  const leagueRaw = team && (team.league || team.leagueId || team.leagueCode);
  const leagueToken = normalizeLeagueToken(leagueRaw || "");
  const teamNick = team && team.teamName ? normalizeCommerceTag(team.teamName) : "";
  const garmentKey = garmentCategoryToCollectionKey(blank);
  const garmentTagSlug = garmentCategoryToTagSlug(blank);
  const designShortKey = designShortName ? String(designShortName).toLowerCase() : "";

  const tags = buildCommerceTags({
    team,
    blank,
    colorName: "",
    designShortName,
    leagueToken,
    garmentTagSlug,
  });

  const collectionKeys = buildCollectionKeys({
    leagueSlug: leagueToken,
    teamNicknameSlug: teamNick,
    garmentCollectionKey: garmentKey,
    designShortKey,
  });

  const tax = inferTaxonomyForGeneratedSportsProduct(team, design, designShortName);

  const trimmedResolved =
    resolvedBlankDescription && String(resolvedBlankDescription).trim()
      ? String(resolvedBlankDescription).trim()
      : "";

  const defaultSeoPlain = buildStorefrontSeoDescriptionParent({
    teamDisplay: teamNameFull,
    designShortName,
  });

  let descriptionHtml;
  let descriptionText;

  if (trimmedResolved) {
    descriptionHtml = trimmedResolved;
    descriptionText = htmlToPlainText(trimmedResolved);
  } else {
    descriptionText = defaultSeoPlain;
    const safe = defaultSeoPlain.replace(/</g, "&lt;");
    descriptionHtml = `<p>${safe}</p>`;
  }

  let finalHtml = descriptionHtml;
  let finalText = descriptionText;
  if (finalHtml) {
    finalHtml = stripUnresolvedTemplateArtifacts(String(finalHtml));
    finalText = htmlToPlainText(finalHtml);
  }
  finalText = collapseDuplicateAdjacentPhrases(finalText);
  const escBody = finalText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  finalHtml = `<p>${escBody}</p>`;
  const seoDescription = finalText.slice(0, 320);
  const shortDescription = buildShortDescriptionFromBody(finalText);
  const tagsDeduped = tags.map((t) => collapseDuplicateAdjacentPhrases(t));

  return {
    displayTitle,
    handleSlug: generateSlugFromTitle(displayTitle),
    seo: {
      title: seoTitle.slice(0, 70),
      description: seoDescription,
    },
    descriptionHtml: finalHtml,
    descriptionText: finalText,
    shortDescription,
    tags: tagsDeduped,
    tagsNormalized: tagsDeduped,
    collectionKeys,
    teamNameFull,
    designShortName,
    productTypeWord,
    tax,
    designThemeLabel: designTypeToLabel(design.designType),
    designThemeSlug: designTypeToThemeSlug(design.designType),
  };
}

module.exports = {
  designTypeToLabel,
  designTypeToStorefrontShort,
  designTypeToThemeSlug,
  buildTeamDisplayName,
  buildDesignNameForTemplates,
  collapseDuplicateAdjacentPhrases,
  buildStorefrontProductTypeWord,
  buildStorefrontTitle,
  generateSlugFromTitle,
  buildStorefrontSeoDescription,
  buildSeoTitle,
  buildCommerceTags,
  buildCollectionKeys,
  buildResolvedMerchandisingBundle,
  buildResolvedMerchandisingBundleForParent,
  buildStorefrontTitleParent,
  inferTaxonomyForGeneratedSportsProduct,
  htmlToPlainText,
  buildShortDescriptionFromBody,
  isApparelBlank,
  normalizeCommerceTag,
};
