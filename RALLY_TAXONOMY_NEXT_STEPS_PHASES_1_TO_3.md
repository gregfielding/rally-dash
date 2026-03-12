# RALLY_TAXONOMY_NEXT_STEPS_PHASES_1_TO_3.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define the next three taxonomy implementation steps after successful taxonomy seeding and verification.

---

# Overview

The Rally taxonomy seed and verification are now working.

Verified:
- sports seeded
- leagues seeded
- entities seeded
- themes seeded
- design families seeded
- NCAA D1 colleges complete
- Olympic themes complete
- duplicate-code checks passed
- read hooks/filter checks passed

The next work should happen in this order:

1. Taxonomy integration into Batch Import
2. Taxonomy dropdowns in Design/Product forms
3. Firestore rules for taxonomy collections

This document defines those three steps.

---

# Phase 1 — Taxonomy Integration into Batch Import

## Goal

Batch Import should resolve parsed filename tokens against the seeded taxonomy collections so imported designs get structured taxonomy fields instead of only raw strings.

This should improve:
- import correctness
- consistency across designs/products
- downstream product generation
- filtering/reporting later

## Taxonomy collections to use

Resolve against:
- `rp_taxonomy_sports`
- `rp_taxonomy_leagues`
- `rp_taxonomy_entities`
- `rp_taxonomy_themes`
- `rp_taxonomy_design_families`

## Required resolution behavior

For each parsed import row, Rally should attempt to resolve:

### league token
Against:
- `rp_taxonomy_leagues`

Populate on design:
- `leagueCode`

### team/entity token
Against:
- `rp_taxonomy_entities`

Populate on design:
- `teamCode`

### design family token
Against:
- `rp_taxonomy_design_families`

Populate on design:
- `designFamily`

### sport
Derive from:
- resolved league
- resolved entity
- resolved theme
in that order, depending on what is available

Populate on design:
- `sportCode`

### theme
For generic/topical imports where applicable, resolve against:
- `rp_taxonomy_themes`

Populate on design:
- `themeCode`

## Important safety rule

Unresolved mappings must remain explicit.

Do NOT:
- silently guess
- fallback to incorrect records
- auto-map unresolved tokens to arbitrary entries

Acceptable behaviors:
- warning state
- skipped row
- partial import with unresolved taxonomy clearly marked (only if safe and intentional)

## Batch Import UI expectations

Enhance the parsed/grouped preview with interpreted taxonomy results.

Useful columns or fields:
- Sport
- League
- Team / Entity
- Theme
- Design Family
- Resolution status

Example:

```text
Filename: MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT
League: MLB
Design Family: WILL_DROP_FOR
Team: GIANTS
Sport: BASEBALL
Status: Resolved
```

If unresolved:

```text
Filename: MLB_WILL_DROP_FOR_UNKNOWNTEAM_BACK_LIGHT
League: MLB
Design Family: WILL_DROP_FOR
Team: UNKNOWNTEAM
Sport: BASEBALL
Status: Unresolved team
```

## Data to save on imported designs

When a design is created/updated from Batch Import, save these fields where resolved:

```ts
sportCode?: string | null
leagueCode?: string | null
teamCode?: string | null
themeCode?: string | null
designFamily?: string | null
```

## Deliverables for Phase 1

- taxonomy resolution added to Batch Import parsing/import flow
- resolved taxonomy fields written onto imported design records
- unresolved mappings surfaced clearly
- no unsafe guessing

---

# Phase 2 — Taxonomy Dropdowns in Design/Product Forms

## Goal

Allow users to select and edit taxonomy explicitly in Rally forms using structured dropdowns rather than free-form strings.

This should apply to:
- Design forms/pages
- Product forms/pages

## Source of truth

Use seeded Firestore taxonomy collections via the existing taxonomy hooks.

Expected hooks:
- `useTaxonomySports()`
- `useTaxonomyLeagues(sportCode?)`
- `useTaxonomyEntities(filters?)`
- `useTaxonomyThemes(sportCode?)`
- `useTaxonomyDesignFamilies()`

## Design form requirements

Design forms should support selecting:

- Sport
- League
- Team / Entity
- Theme
- Design Family

### Behavior rules

- League dropdown should filter by selected Sport where applicable
- Team / Entity dropdown should filter by selected League and/or Sport
- Theme dropdown should optionally filter by selected Sport
- Design Family dropdown should always come from `rp_taxonomy_design_families`

### Generic design support

Designs should allow:
- no team/entity
- no league
- theme-driven taxonomy

Example:
- Generic Baseball
- Tailgate
- Funny Sports
- Country Club

## Product form requirements

Products should support the same taxonomy structure, either:
- inherited from linked design(s), or
- editable at the product level where needed

Recommended fields:
- `sportCode`
- `leagueCode`
- `teamCode`
- `themeCode`
- `designFamily`

## UI recommendation

Show taxonomy in a dedicated section:

```text
Taxonomy
- Sport
- League
- Team / Entity
- Theme
- Design Family
```

Keep it structured and visible.

## Deliverables for Phase 2

- Design forms use taxonomy dropdowns
- Product forms use taxonomy dropdowns or inherited taxonomy display/editing
- dropdowns resolve from seeded Firestore collections
- dependent filtering works (sport → league → entity/theme)

---

# Phase 3 — Firestore Rules for Taxonomy Collections

## Goal

Protect the new taxonomy collections with clear Firestore rules.

Taxonomy data should be:
- readable by the appropriate app users
- writable only by admin/ops users

## Collections to cover

Add rules for:
- `rp_taxonomy_sports`
- `rp_taxonomy_leagues`
- `rp_taxonomy_entities`
- `rp_taxonomy_themes`
- `rp_taxonomy_design_families`

## Recommended access pattern

### Read
Allow read for authenticated users who need taxonomy for:
- filters
- forms
- import resolution
- product/design UI

### Write
Restrict writes to admin/ops roles only.

Example policy direction:
- admin
- ops
- god / platform admin
depending on the existing Rally security model

## Important note

Taxonomy collections are foundational. Casual writes should not be allowed.

Seeder scripts and admin tools should be the primary write path.

## Deliverables for Phase 3

- Firestore rules added for all taxonomy collections
- read access works for expected app users
- write access restricted to admin/ops users
- no accidental public write exposure

---

# Recommended Order of Work

Please implement these phases in order:

## First
Phase 1 — Batch Import taxonomy resolution

## Second
Phase 2 — Taxonomy dropdowns in forms

## Third
Phase 3 — Firestore rules

This order matters because:
- Batch Import gets immediate benefit from taxonomy correctness
- Forms become safer once import behavior is aligned
- Rules should be finalized after the intended access paths are clear

---

# Final Directive for Cursor

Please implement the next taxonomy work in these three phases:

1. Batch Import taxonomy resolution
2. Taxonomy dropdowns in Design/Product forms
3. Firestore rules for taxonomy collections

Important constraints:
- use seeded taxonomy collections as the source of truth
- keep unresolved mappings explicit
- do not silently guess taxonomy matches
- prefer structured dropdowns over free-form strings
- restrict taxonomy writes to admin/ops roles

The goal is to make taxonomy a real operational backbone of Rally for import, product generation, filtering, and future Shopify mapping.

---

# End of Spec
