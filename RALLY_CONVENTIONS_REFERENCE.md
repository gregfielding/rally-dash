# Rally — Canonical Conventions Reference

Single reference for filename conventions, productIdentityKey format, taxonomy code conventions, and Shopify tag prefixes. Use this for implementation and QA.

---

## 1. Design filename convention

**Format:**  
`LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT.ext`

**Rules:**
- All segments uppercase; underscore-separated.
- `LEAGUE`: one token (e.g. MLB, NFL, NCAA, F1).
- `DESIGNNAME`: design family; can contain underscores (e.g. WILL_DROP_FOR, HOME_RUN).
- `TEAM`: one token (e.g. GIANTS, FORTY_NINERS, COLORADO, FERRARI).
- `SIDE`: FRONT or BACK.
- `VARIANT`: e.g. LIGHT, DARK, HEATHER.
- Extension: `.png`, `.svg`, or `.pdf`.

**Examples:**
- `MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png`
- `NFL_HOME_RUN_FORTY_NINERS_FRONT_DARK.svg`
- `NCAA_GAMEDAY_COLORADO_FRONT_LIGHT.pdf`

**Parsed base key (grouping):**  
`LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT` (no extension).  
Same key used for grouping files and for import/design traceability.

**Spec:** `RALLY_BATCH_DESIGN_IMPORT_AND_NAMING_SPEC.md`  
**Code:** `lib/batchImport/parseDesignFilename.ts`

---

## 2. productIdentityKey format

**Purpose:** Uniquely identify a product for batch dedupe. One product per (league, design family, team, blank, variant); side (front/back) is not part of the key.

**Format:**  
`leagueCode_designFamily_teamCode_blankId_variant`

**Rules:**
- Segments normalized (uppercase, underscores for spaces); no empty segments.
- `blankId`: physical blank identifier (e.g. style/color blank id).
- `variant`: color/variant name token (e.g. LIGHT, HEATHER_GREY).

**Example:**  
`MLB_WILL_DROP_FOR_GIANTS_HEATHER_GREY_BIKINI_LIGHT`

**Code:** `lib/batchImport/productGeneration.ts` — `productIdentityKey(leagueCode, designFamily, teamCode, blankId, variant)`  
**Schema:** `RpProduct.productIdentityKey` (Firestore)

---

## 3. Taxonomy code conventions

**Style:** UPPER_SNAKE_CASE. Stored and displayed as codes; names/labels come from taxonomy docs.

**sportCode**  
Examples: `BASEBALL`, `FOOTBALL`, `BASKETBALL`, `SOCCER`, `RACING`, `COLLEGE_SPORTS`, `OLYMPIC_SPORTS`, `GOLF`, `GENERIC_SPORTS`, `LIFESTYLE`.

**leagueCode**  
Examples: `MLB`, `NFL`, `NBA`, `NHL`, `MLS`, `PREMIER_LEAGUE`, `NCAA`, `F1`, `NASCAR`, `OLYMPICS`.

**teamCode (entity)**  
Examples: `GIANTS`, `FORTY_NINERS`, `LAKERS`, `COLORADO`, `FERRARI`, `ARSENAL`, `INTER_MIAMI`.  
Entity type (pro_team, college, club, constructor, etc.) lives on the entity record only, not on the product.

**themeCode**  
Examples: `FUNNY_BASEBALL`, `GAME_DAY`, `COUNTRY_CLUB`, `TAILGATE`, `OLYMPIC_SWIMMING`.

**designFamily**  
Examples: `WILL_DROP_FOR`, `HOME_RUN`. Internal; not sent to Shopify as a tag.

**Hierarchy:**  
teamCode requires leagueCode; leagueCode requires sportCode. sportCode may be null only for purely thematic/lifestyle products (e.g. theme-only).

**Spec:** `RALLY_TAXONOMY_SPEC.md`, `RALLY_TAXONOMY_SEEDER_SPEC.md`  
**Collections:** `rp_taxonomy_sports`, `rp_taxonomy_leagues`, `rp_taxonomy_entities`, `rp_taxonomy_themes`, `rp_taxonomy_design_families`

---

## 4. Shopify tag prefixes

**Source:** Rally product fields only. Deterministic; no blankId or designFamily as tags.

| Product field   | Tag prefix | Example tag        |
|-----------------|------------|---------------------|
| sportCode       | `sport:`   | `sport:baseball`    |
| leagueCode      | `league:`  | `league:mlb`        |
| teamCode        | `team:`    | `team:giants`      |
| themeCode       | `theme:`   | `theme:game_day`   |
| modelCodes[]    | `model:`   | `model:amber`      |

**Value format:** Lowercase; non-alphanumeric → underscore; trimmed; max 255 chars (e.g. `FORTY_NINERS` → `forty_niners`, `PREMIER_LEAGUE` → `premier_league`).

**Order:** sport → league → team → theme → model(s). Deduped.

**Config:** `lib/shopify/shopifyTagSchema.ts`  
**Helper:** `lib/shopify/buildShopifyTags.ts`, `functions/buildShopifyTags.js`

---

*Use this file as the single canonical reference for these conventions.*
