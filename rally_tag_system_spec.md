# 🔧 TASK: Replace Product Tag System with Dual-Layer Taxonomy Tags

## Objective
Replace the current ad-hoc product tag system with a consistent, scalable dual-layer tagging system that supports:

1. Shopify smart collections (structured tags)
2. SEO + human readability (display tags)
3. Future bulk product generation

This must be implemented cleanly and fully, with no legacy tag carryover.

---

## FINAL TAG OUTPUT (REQUIRED)

For a product like:
Los Angeles Dodgers 69 Bikini Panty

### Human-readable tags
- Los Angeles
- Los Angeles Dodgers
- MLB
- Baseball
- 69
- Bikini Panty

### Structured tags
- city:los_angeles
- team:los_angeles_dodgers
- league:mlb
- sport:baseball
- theme:69
- product_type:bikini_panty

---

## REMOVE / DO NOT GENERATE

The following must be fully removed from generation logic:

- los-angeles-dodgers (slug style duplicates)
- dodgers (partial team names)
- panty (too generic)
- Any duplicate or inconsistent tag formats

Do NOT merge with old tags. This is a full replacement system.

---

## DATA MODEL CHANGES (REQUIRED)

Extend the taxonomy object on the product:

taxonomy = {
  cityName: string        # "Los Angeles"
  citySlug: string        # "los_angeles"

  teamName: string        # "Los Angeles Dodgers"
  teamSlug: string        # "los_angeles_dodgers"

  leagueName: string      # "MLB"
  leagueCode: string      # "MLB"

  sportName: string       # "Baseball"
  sportCode: string       # "BASEBALL"

  themeName: string       # "69"
  themeCode: string       # "CITY_69"

  productTypeName: string # "Bikini Panty"
  productTypeSlug: string # "bikini_panty"
}

### Canonical team slug (required)

- **Format:** `slugify(full_official_team_name)` with underscores — e.g. `los_angeles_dodgers`, `san_francisco_giants`.
- **Not allowed:** short metro codes (`sf_giants`, `la_dodgers`), nickname-only (`dodgers`), or partial slugs.
- **`design_teams` document id** equals this slug (one team, one id).
- **`taxonomy.teamId`** and **`taxonomy.teamSlug`** equal this slug; they are **not** `rp_taxonomy_entities.code` (e.g. `GIANTS` / `DODGERS` remain entity codes for pickers only).
- **Structured tag:** `team:{canonical}` (e.g. `team:los_angeles_dodgers`). **Shopify collection handle:** `team-{hyphenated}` (e.g. `team-los-angeles-dodgers`).

---

## TAG BUILDER (SOURCE OF TRUTH)

Create a single canonical function:

function buildProductTags(product) {
  const t = product.taxonomy;

  return [
    t.cityName,
    t.teamName,
    t.leagueName,
    t.sportName,
    t.themeName,
    t.productTypeName,

    `city:${t.citySlug}`,
    `team:${t.teamSlug}`,
    `league:${t.leagueCode.toLowerCase()}`,
    `sport:${t.sportCode.toLowerCase()}`,
    `theme:${normalizeTheme(t.themeName, t.themeCode)}`,
    `product_type:${t.productTypeSlug}`
  ].filter(Boolean);
}

---

## HELPER FUNCTION

function normalizeTheme(themeName, themeCode) {
  if (themeName) return themeName.toLowerCase().replace(/\s+/g, "_");
  if (themeCode) return themeCode.toLowerCase().replace("city_", "");
  return null;
}

---

## WRITE PATH (CRITICAL)

Whenever a product is:
- created
- updated
- taxonomy is saved

You MUST overwrite tags:

product.tags = buildProductTags(product);
product.tagsNormalized = product.tags.map(t => t.toLowerCase());

Do NOT append. Do NOT merge with old tags.

---

## MIGRATION (REQUIRED)

Run a one-time migration for ALL rp_products:

1. Read each product
2. Ensure taxonomy fields exist (derive if needed)
3. Rebuild tags using buildProductTags
4. Overwrite:
   - tags
   - tagsNormalized

---

## TAXONOMY MAPPING RULES

City extraction:
"Los Angeles Dodgers" → cityName: "Los Angeles", citySlug: "los_angeles"

Team:
teamName: "Los Angeles Dodgers"
teamSlug: "los_angeles_dodgers"

Product type (8394):
productTypeName: "Bikini Panty"
productTypeSlug: "bikini_panty"

Theme:
themeName: "69" → theme:69

---

## SHOPIFY USAGE

Smart collections MUST use structured tags:

- team:los_angeles_dodgers
- city:los_angeles
- sport:baseball
- product_type:bikini_panty
- theme:69

---

## RULES

- Tags must be deterministic (same input = same output)
- No duplicates
- No mixed formats
- No partial names (e.g. "dodgers")
- No legacy tags
- Always include BOTH human-readable and structured tags

---

## SUCCESS CRITERIA

Each product must:

- Have exactly 6 human-readable tags
- Have exactly 6 structured tags
- Be immediately usable for Shopify smart collections
- Be consistent across all generated products

---

## FUTURE (DO NOT IMPLEMENT NOW)

Do NOT implement yet:
- Filters UI
- Collection builder UI
- SEO automation layer

This task is ONLY:
- Tag system
- Taxonomy alignment
- Migration

---

END OF SPEC
