# RALLY_TAXONOMY_SEEDER_SPEC.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define the Firestore taxonomy seeding system for Rally so the app starts with a structured, queryable taxonomy for sports, leagues, teams/entities, themes, and design families.

---

# 1. Goal

Rally should not rely on ad-hoc strings for taxonomy.

Instead, Rally should have seeded taxonomy collections so that:

- products and designs can reference structured taxonomy records
- backend filters are consistent
- imports can resolve codes to records
- Shopify collection mapping can be standardized
- future batch generation and analytics are easier

This seeder should initialize the foundational catalog taxonomy for:

- sports
- leagues
- teams / entities
- themes
- design families

---

# 2. Philosophy

The taxonomy should support **both licensed/team-based products and generic/topical products**.

Examples Rally must support cleanly:

- MLB / Giants
- NFL / Cowboys
- NCAA / USC
- F1 / Ferrari
- NASCAR / generic racing themes
- Generic baseball
- Funny sports panties
- Tailgate / Game Day / topical concepts

This means taxonomy should be **structured**, not only tags.

---

# 3. Recommended Firestore Collections

Create these collections:

```text
rp_taxonomy_sports
rp_taxonomy_leagues
rp_taxonomy_entities
rp_taxonomy_themes
rp_taxonomy_design_families
```

Optional later:
```text
rp_taxonomy_collections
rp_taxonomy_tags
```

---

# 4. Collection Definitions

## 4.1 rp_taxonomy_sports

Represents top-level sport categories.

Suggested fields:

```ts
{
  id: string,
  code: string,
  name: string,
  slug: string,
  active: boolean,
  sortOrder?: number | null,
  description?: string | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Examples:
- BASEBALL
- FOOTBALL
- BASKETBALL
- HOCKEY
- SOCCER
- RACING
- GOLF
- TENNIS
- COLLEGE_SPORTS
- GENERIC_SPORTS
- LIFESTYLE

---

## 4.2 rp_taxonomy_leagues

Represents official leagues or competition groups.

Suggested fields:

```ts
{
  id: string,
  code: string,
  name: string,
  slug: string,
  sportCode?: string | null,
  active: boolean,
  sortOrder?: number | null,
  description?: string | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Examples:
- MLB
- NFL
- NBA
- NHL
- MLS
- PREMIER_LEAGUE
- NCAA
- NASCAR
- INDYCAR
- F1

Generic sports designs may use `leagueCode = null`.

---

## 4.3 rp_taxonomy_entities

Represents teams, colleges, clubs, or motorsport entities.

Suggested fields:

```ts
{
  id: string,
  code: string,
  name: string,
  slug: string,
  sportCode?: string | null,
  leagueCode?: string | null,
  entityType: "team" | "college" | "club" | "motorsport_team" | "generic_entity",
  active: boolean,
  aliases?: string[],
  sortOrder?: number | null,
  metadata?: {
    city?: string | null,
    state?: string | null,
    country?: string | null
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Examples:
- GIANTS
- DODGERS
- YANKEES
- COWBOYS
- 49ERS
- USC
- ALABAMA
- COLORADO
- FERRARI
- MCLAREN
- RED_BULL

This collection should **not** be limited to teams only.

---

## 4.4 rp_taxonomy_themes

Represents generic, humorous, lifestyle, topical, or non-team concepts.

Suggested fields:

```ts
{
  id: string,
  code: string,
  name: string,
  slug: string,
  sportCode?: string | null,
  leagueCode?: string | null,
  active: boolean,
  themeType?: "generic_sport" | "humor" | "lifestyle" | "topical" | "campaign",
  sortOrder?: number | null,
  description?: string | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Examples:
- GENERIC_BASEBALL
- GENERIC_SOFTBALL
- FUNNY_BASEBALL
- GOLF_GIRL
- TAILGATE
- GAME_DAY
- CHECKERED_FLAG
- SPORTS_MOM
- BEER_LEAGUE
- TRASH_TALK
- COUNTRY_CLUB
- BACHELORETTE

---

## 4.5 rp_taxonomy_design_families

Represents internal creative families used for imports, backend grouping, and batch product generation.

Suggested fields:

```ts
{
  id: string,
  code: string,
  name: string,
  slug: string,
  active: boolean,
  description?: string | null,
  sortOrder?: number | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Examples:
- WILL_DROP_FOR
- HOME_RUN
- TEE_TIME
- FULL_THROTTLE
- GAME_DAY_GIRL
- PITCH_SLAP
- CHECKERED_FLAG_SERIES

These are primarily backend-facing concepts and do not need to appear in storefront navigation.

---

# 5. Seeder Behavior

The seeder should be **idempotent**.

Meaning:
- running it multiple times should not create duplicates
- records should be created or updated by `code`
- missing records should be inserted
- changed display fields should be updated safely

Recommended logic per collection:

```text
for each seed row:
  lookup by code
  if exists:
    update stable fields
  else:
    create document
```

Use deterministic document ids if helpful, for example:
- `SPORT_BASEBALL`
- `LEAGUE_MLB`
- `ENTITY_GIANTS`
- `THEME_TAILGATE`
- `FAMILY_WILL_DROP_FOR`

or allow generated ids with `code` uniqueness. Deterministic ids are preferred.

---

# 6. Initial Seed Data

## 6.1 Sports

Seed these records:

```text
BASEBALL
FOOTBALL
BASKETBALL
HOCKEY
SOCCER
RACING
GOLF
TENNIS
COLLEGE_SPORTS
GENERIC_SPORTS
LIFESTYLE
```

---

## 6.2 Leagues

Seed these records:

```text
MLB
NFL
NBA
NHL
MLS
PREMIER_LEAGUE
NCAA
NASCAR
INDYCAR
F1
```

Map each to a parent `sportCode` where applicable.

Examples:
- MLB → BASEBALL
- NFL → FOOTBALL
- NCAA → COLLEGE_SPORTS
- F1 → RACING

---

## 6.3 Entities (starter set)

Seed a meaningful starter set, not every team in every league yet unless easy to maintain.

### MLB examples
```text
GIANTS
DODGERS
YANKEES
RED_SOX
CUBS
PADRES
METS
```

### NFL examples
```text
COWBOYS
FORTY_NINERS
PACKERS
RAIDERS
CHIEFS
EAGLES
```

### Colleges examples
```text
USC
ALABAMA
COLORADO
TEXAS
MICHIGAN
LSU
OHIO_STATE
NOTRE_DAME
```

### Racing examples
```text
FERRARI
MCLAREN
RED_BULL
MERCEDES
```

### Soccer examples
```text
ARSENAL
MANCHESTER_CITY
LIVERPOOL
LAFC
INTER_MIAMI
```

Use aliases to support import parsing:
Examples:
- FORTY_NINERS aliases: ["49ERS", "NINERS"]
- RED_SOX aliases: ["REDSOX"]

---

## 6.4 Themes

Seed these records:

```text
GENERIC_BASEBALL
GENERIC_SOFTBALL
FUNNY_BASEBALL
FUNNY_FOOTBALL
GOLF_GIRL
TAILGATE
GAME_DAY
CHECKERED_FLAG
SPORTS_MOM
BEER_LEAGUE
TRASH_TALK
COUNTRY_CLUB
BACHELORETTE
RACE_DAY
OPENING_DAY
PLAYOFFS
```

---

## 6.5 Design Families

Seed these records:

```text
WILL_DROP_FOR
HOME_RUN
TEE_TIME
FULL_THROTTLE
GAME_DAY_GIRL
PITCH_SLAP
CHECKERED_FLAG_SERIES
```

---

# 7. Relationship to Rally Product / Design Schema

After seeding, Rally `DesignDoc` and `RpProduct` should be able to reference these taxonomy codes cleanly.

Recommended fields already discussed:

```ts
sportCode?: string | null
leagueCode?: string | null
teamCode?: string | null
themeCode?: string | null
designFamily?: string | null
```

These fields should resolve against seeded collections.

Examples:

## Team product
```ts
{
  sportCode: "BASEBALL",
  leagueCode: "MLB",
  teamCode: "GIANTS",
  themeCode: null,
  designFamily: "WILL_DROP_FOR"
}
```

## Generic theme product
```ts
{
  sportCode: "BASEBALL",
  leagueCode: null,
  teamCode: null,
  themeCode: "FUNNY_BASEBALL",
  designFamily: "PITCH_SLAP"
}
```

---

# 8. Batch Import / Parser Alignment

The design filename parser should use the seeded taxonomy when possible.

Examples:
- `GIANTS` → resolve against `rp_taxonomy_entities`
- `WILL_DROP_FOR` → resolve against `rp_taxonomy_design_families`
- `MLB` → resolve against `rp_taxonomy_leagues`

If an import token does not resolve:
- show warning / unresolved state
- do not silently map to the wrong record

This keeps imports deterministic and safe.

---

# 9. Rally UI Usage

These seeded collections should power backend dropdowns and filters.

## Filters
- Sport
- League
- Team / Entity
- Theme
- Design Family

## Product / Design forms
- choose sport
- choose league
- choose team or theme
- choose design family

## Batch tools
- generate products by family
- filter imported designs by league/team/theme
- filter products by sport/league/team/theme

---

# 10. Shopify Relationship

Not every taxonomy field needs to become a visible Shopify collection automatically.

Recommended:
- use taxonomy to drive Rally organization first
- map selected fields to Shopify collections and tags later

Likely Shopify-facing:
- sport
- league
- team
- theme

Mostly Rally/internal:
- designFamily

This matches your intent that something like `WILL_DROP_FOR` is mainly a backend grouping, not necessarily a storefront collection.

---

# 11. Seeder Implementation Recommendations

Create a script, for example:

```text
functions/scripts/seed-taxonomy.ts
```

or similar in the app/backend structure.

Recommended implementation style:
- one seed object per collection
- deterministic ids
- `upsertByCode`
- log summary:
  - created count
  - updated count
  - skipped count

Example output:

```text
Sports: created 11, updated 0
Leagues: created 10, updated 0
Entities: created 30, updated 2
Themes: created 16, updated 0
Design Families: created 7, updated 0
```

Optional:
- `--dry-run`
- `--only=sports`
- `--only=entities`

---

# 11.1 Run and verify (local)

**Project ID:** The seeder and verify script resolve project ID from (in order): `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT_ID`, or `.firebaserc` (default project). Ensure Firebase credentials are available (e.g. `firebase login` and `firebase use <projectId>`, or `GOOGLE_APPLICATION_CREDENTIALS` for a service account).

1. **Dry-run (no writes):**
   ```bash
   cd functions && npm run seed:taxonomy -- --dry-run
   ```
   Confirm created/updated/skipped counts look correct.

2. **Real run:**
   ```bash
   cd functions && npm run seed:taxonomy
   ```
   Note the summary counts per collection.

3. **Verify seeded data:**
   ```bash
   cd functions && npm run verify:taxonomy
   ```
   This checks: counts per collection, NCAA D1 colleges (361, sample codes), Olympic themes (including OLYMPIC_CURLING), leagues/themes/entities filter behavior (same as `useTaxonomy` hooks), and duplicate codes.

4. **Verify hooks in the app:** In the Rally app, open any screen that uses `useTaxonomySports`, `useTaxonomyLeagues(sportCode)`, `useTaxonomyEntities({ leagueCode, sportCode })`, `useTaxonomyThemes(sportCode)`, or `useTaxonomyDesignFamilies`. Confirm data loads and filters work (e.g. leagues filtered by sport, entities by league).

**Smallest next integration slice:** Add taxonomy to **product/design form dropdowns** (sport, league, team, theme, design family) so new/edited products and designs persist taxonomy codes. Then: batch import taxonomy resolution (resolve tokens to codes on import). Firestore rules for taxonomy collections can follow (read-only for authenticated users if needed).

---

# 12. MVP Scope

For MVP, seed:

- all core sports
- all core leagues
- a starter entity set (not necessarily every team in existence)
- core themes
- current design families

This is enough to:
- unblock imports
- unblock filters
- stabilize product generation
- support current Rally workflows

Later you can expand entities/teams easily.

---

# 13. Final Directive for Cursor

Please implement a Rally taxonomy seeding system with:

- Firestore taxonomy collections
- deterministic or code-based upsert behavior
- starter seed data for sports, leagues, entities, themes, and design families
- safe repeated execution
- alignment with existing Rally import/product schema

This seeder should become the foundation for:
- Rally filters
- import token resolution
- product/design classification
- future Shopify mapping

The goal is to make Rally’s taxonomy explicit and structured from the beginning rather than allowing inconsistent free-form strings.

---

# End of Spec
