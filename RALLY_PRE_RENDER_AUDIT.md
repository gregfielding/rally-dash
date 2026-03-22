# Rally — Pre-Render Architecture Audit & Checklist

**Purpose:** Lock the last dependencies so the **Blank Render System** phase (zones, blending/masking, alternate looks, visual outputs) can be built without rework.  
**Deliverable:** Structured audit of 5 areas with current status, gaps, recommendations, and what must be done before vs after render work.  
**Scope:** No implementation of the full render/look system; architecture and spec only.

---

## 1. Generated Product refinement

### 1.1 Current status

- **RALLY_GENERATED_PRODUCT_SPEC.md** already contains a **Spec refinement (pre-implementation)** section that locks:
  - **productIdentityKey** — canonical format `{leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantIdOrLegacy}`; rules for normalization; uniqueness and creation-time-only.
  - **Denormalized fields** — explicit split into **source lineage** (blankId, blankVariantId, designId, teamCode, productIdentityKey, blankVersionUsed, designVersionUsed) and **resolved product fields** (copy, merch, colorway, pricing/shipping, renderSetup, optional caches).
  - **Staleness / version** — blankVersionUsed, designVersionUsed; derived isBlankStale / isDesignStale; which edits mark stale, re-queue Shopify, require mockup regen (with summary table).

- **RpProduct** in `lib/types/firestore.ts` has: blankId, blankVariantId, designId, renderSetup, shopify, pricing, shipping, colorway, media, etc. It does **not** yet have: productIdentityKey, blankVersionUsed, designVersionUsed, or explicit designNameCache/styleCodeCache/styleNameCache.

### 1.2 Remaining ambiguity / gaps

| Gap | Detail |
|-----|--------|
| **productIdentityKey not set at create** | createProductFromDesignBlank (and any other create path) does not yet compute and persist productIdentityKey. |
| **Version fields missing** | blankVersionUsed, designVersionUsed are not on RpProduct type or written by create/refresh. |
| **Blank.version semantics** | RPBlank has optional `version?: number`; no documented rule for when it is incremented (templates, placements, etc.). |
| **Cache fields** | designNameCache, styleCodeCache, styleNameCache are recommended but not yet on product type or creation flow. |
| **baseProductKey rule** | Spec says e.g. `{teamCode}_{categoryOrStyle}` but the exact rule is not codified; risk of drift across create vs batch. |

### 1.3 Recommendation

- Treat the **existing spec refinement** as the single source of truth for identity key, denormalized list, and staleness/trigger rules.
- **Before Blank Render System:**  
  - Add to **RpProduct** (and create flow): `productIdentityKey`, `blankVersionUsed`, `designVersionUsed`.  
  - Implement **productIdentityKey** generation in createProductFromDesignBlank (and any other product create entry point) using the canonical format; ensure leagueCode/teamCode are resolved from design/team and normalized.  
  - Add **blank.version** bump rules in updateBlank (or document “use updatedAt until version exists”) and persist **blankVersionUsed** / **designVersionUsed** at product create (and on “Refresh from blank” / “Refresh design assets”).  
- **Can wait until later:** Explicit designNameCache/styleCodeCache/styleNameCache if the product library can tolerate FKs and client-side or server-side joins for list display; otherwise add at create.

### 1.4 What must be done before Blank Render System

1. **Types:** Add `productIdentityKey`, `blankVersionUsed`, `designVersionUsed` to RpProduct.  
2. **Create flow:** Compute and set productIdentityKey at creation; set blankVersionUsed from blank.version or blank.updatedAt, designVersionUsed from design.updatedAt.  
3. **Blank:** Document or implement when `blank.version` is incremented (templates, shopifyDefaults, defaultPricing, defaultShipping, placements, renderDefaults, variant images/overrides).  
4. **Staleness:** Implement derived isBlankStale / isDesignStale where product is displayed (detail page, library optional column).

### 1.5 What can wait

- Central “overrides” bucket on product (overrides today are spread across renderSetup and top-level).  
- Explicit designNameCache/styleCodeCache/styleNameCache if list queries are acceptable with FKs.  
- Full “Refresh from blank” / “Refresh design assets” UI (can be minimal: update version refs + optionally refresh copy/assets).

---

## 2. Master Blank + Variant architecture check

### 2.1 Current status

- **Schema:** RPBlank has `schemaVersion: 2` for master; `variants?: RPBlankVariant[]`; legacy top-level `colorName`, `colorHex`, `colorFamily`, `images` documented as “Legacy only”.  
- **Pricing/cost/weight:** On master blank only: defaultPricing, defaultShipping; legacy blankCost/costCurrency still present.  
- **Variant images:** Variant owns `images.front/back/detail`; master can still have root `images` for legacy.  
- **Product creation:** createProductFromDesignBlank requires blankVariantId when blank has variants; product stores blankId + blankVariantId.  
- **Blanks library:** Shows master blanks; variant count; no color column at master level; create flow does not ask for color.  
- **Blank detail:** Variants tab is the source of truth for colors; Eligibility tab states “Garment colors are defined only on Variants tab”.

### 2.2 What is already correct

| Area | Status |
|------|--------|
| Color only on variants | Canonical: master has no required color; variants[] own colorName, colorHex, colorFamily. Legacy root color retained for backward compatibility only. |
| Pricing/cost/weight on master | defaultPricing (retailPrice, cost), defaultShipping (defaultWeightGrams, requiresShipping) on RPBlank; no pricing on RPBlankVariant. |
| Variant images vs style-level | Variant images are canonical for product rendering; style-level (root) images only for legacy or optional reference. UI (Images tab) states variant images are primary for master. |
| blankVariantId required for v2 | Product create flow and Cloud Function require blankVariantId when blank has variants; product stores it. |
| Inactive variants | Variant has isActive; prefer deactivate over delete when products reference; UI warns on remove. |
| Blanks library / create | No color in create modal; master-only list; variant count and badges. |

### 2.3 What still needs cleanup

| Item | Detail |
|------|--------|
| **Legacy color on Overview** | Blank detail Overview still shows a legacy color block when `!isMasterBlank(blank) && blank.colorName` (swatch + color name). For master blanks, no color on Overview is correct; ensure no master ever shows a single “blank color” as if it were the only one. |
| **ColorFamilyField on Overview** | There is a ColorFamilyField / color block that uses blank.colorFamily and blank.colorName. For master blanks this should be hidden or replaced by “Set per variant in Variants tab.” |
| **Products library blank dropdown** | Create from Design + Blank shows “styleCode — styleName (colorName)” for legacy; for master no color in label — confirm no leftover “one color per row” display. |
| **Resolver/helpers** | getEffectiveColorFamily(blank.colorFamily, blank.colorName) and any path that reads root color for a master blank should be clearly “legacy only” or return a default; product creation must never use root color for v2. |

### 2.4 Canonical going forward

- **Master blank (schemaVersion === 2):** One doc per style. Color exists only on `variants[]`. Pricing, templates, placement, render defaults, eligibility live on master; variant can override eligibility and owns color + images + optional renderOverrides.  
- **Legacy blank:** Single color at root; no variants array (or empty). Treated as single synthetic variant for product creation and display.  
- **Product:** Always store blankId; for v2 blanks with variants always store blankVariantId; colorway on product comes from variant at create.  
- **UI:** No “blank color” as a first-class column or required field at master level; Variants tab is the only place to define/add colors for a master blank.

### 2.5 What must be done before Blank Render System

1. **UI cleanup:** Ensure Overview and any “color” block never imply a single master-blank color; hide or relabel for master blanks (“Set per variant in Variants tab”).  
2. **Code paths:** Audit any place that reads blank.colorName/colorHex/colorFamily for product creation or display when blank is master; ensure they use variant only.  
3. **Document:** In RALLY_MASTER_BLANK_SCHEMA.md or equivalent, state explicitly: “Canonical: color exists only on variants; master has no required color field for v2.”

### 2.6 What can wait

- Migrating legacy blank docs to master + variants (manual or script).  
- Removing root color/images from RPBlank type (keep for legacy read compatibility).

---

## 3. Eligibility rules readiness

### 3.1 Current status

- **Schema:** RPBlank has `eligibility?: RPBlankEligibility` (allowedLeagues, allowAllTeamsInAllowedLeagues, matchTeamColorFamilies, allowedTeamColorFamilies, supportedDesignZones, supportedProductFamilies, includedTeamIds, excludedTeamIds). RPBlankVariant has `eligibilityOverride` (enabled, same subset except zones/families).  
- **Resolver:** `lib/blanks/eligibility.ts` — getEffectiveEligibility(blank, variant), computeEligibleTeams(teams, rules), teamMatchesColorFamilies(team, allowed).  
- **UI:** Eligibility tab (master) with scope, color-family matching, zones/families, include/exclude team pickers, preview count and list. Variant editor has override section and preview.  
- **DesignTeam:** Optional `colorFamilies?: string[]` for matching; not yet backfilled.

### 3.2 Is the proposed schema sufficient for the next phase?

**Yes.** For the Blank Render System (zones, blending, looks, outputs), eligibility is not a direct dependency. Rendering is “given a product (team + design + blank + variant), produce an image.” Eligibility only gates **which** team×design×blank×variant combinations are generated; it does not affect how a single product is rendered.  
So the current schema is sufficient for:  
- Pre-render: no change needed.  
- Bulk generation (later): use getEffectiveEligibility(blank, variant) + computeEligibleTeams to decide which products to create; no new eligibility fields required for render phase.

### 3.3 Missing fields or logic that would cause rework later

| Risk | Mitigation |
|------|------------|
| **Team colorFamilies empty** | If teams have no colorFamilies, “match team color families” yields no matches. Document that backfill is required for color-based eligibility; until then, use leagues + include/exclude. No schema change. |
| **supportedDesignZones / supportedProductFamilies** | Currently stored but not used by any resolver or batch logic. If future generation filters by “only front_center” or “only panty family”, the fields are there. No rework. |
| **Variant override = full replace** | When variant.eligibilityOverride.enabled is true, variant rules fully replace master for that variant (master zones/families still merged). This is already defined; no ambiguity. |

### 3.4 Before bulk generation vs what can wait

- **Before bulk generation:**  
  - Resolve team list from eligibility (already implemented: computeEligibleTeams).  
  - Ensure product create accepts designId + blankId + blankVariantId + team (or teamCode); team comes from “eligible team” list.  
  - Optionally backfill design_teams.colorFamilies for color-family matching.  
- **Can wait:**  
  - Automatic “generate all eligible” job.  
  - Eligibility-based filtering in product library (“show only products for teams in league X”).  
  - supportedDesignZones / supportedProductFamilies in generation logic (add when needed).

### 3.5 What must be done before Blank Render System

- **Nothing.** Eligibility is not in the critical path for rendering. Optionally document in a single place: “Eligibility determines which team×design×blank×variant combinations exist; render system assumes product already exists.”

### 3.6 What can wait

- Backfill of team colorFamilies.  
- Use of supportedDesignZones / supportedProductFamilies in generation.  
- Batch generation implementation.

---

## 4. Canonical team metadata source

### 4.1 Current status

- **Two team-like sources:**  
  - **design_teams** (DesignTeam): id, name, league, leagueId, city, state, teamName, stadiumName, teamSaying, fanPhrase, primaryColorHex, colorFamilies (optional), tags. Used by Design Library, create design, batch import (teamCode → teamId resolution).  
  - **teams** (and possibly leagues): Used by Catalog, Leagues, Teams hub; different shape (e.g. slug, keywords, colors.primary/secondary).  
- **Product/blank/design:** Design has teamId → design_teams. Product has teamCode (denormalized); no direct teamId. Template resolution and taxonomy pull from design + design_teams (or caches on design).  
- **RALLY_CORE_OBJECT_MODEL_AUDIT.md** already recommends choosing one canonical source (Option A: design_teams canonical; B: teams canonical; C: both with clear roles).

### 4.2 Recommendation: lock the rule

**Canonical team source for Blank / Product / Design / template resolution:**  
**design_teams** (`DesignTeam`), document id = team id (e.g. `sf_giants`).

**Rationale:**  
- Design and product creation already flow through design_teams (design.teamId, teamCode resolution, template tokens).  
- DesignTeam has the richer metadata (teamName, city, state, stadiumName, teamSaying, fanPhrase, primaryColorHex, colorFamilies) needed for templates and eligibility.  
- One source avoids double-maintenance and conflicting team lists for generation and render.

### 4.3 Minimum fields the canonical team must own

| Field | Purpose |
|-------|---------|
| **id** | Stable doc id (slug-like, e.g. sf_giants). |
| **name** | Full display name (e.g. San Francisco Giants). |
| **league** / **leagueId** | League label and stable key (e.g. MLB). |
| **city** | Home city (templates, filters). |
| **state** | State/region code (optional but useful). |
| **teamName** | Nickname without city (e.g. Giants). |
| **teamCode** | Normalized code for productIdentityKey and taxonomy (e.g. GIANTS). If not separate, derive from id or name and document. |
| **stadiumName** | Venue (templates). |
| **teamSaying** / **fanPhrase** | Culture copy (templates). |
| **primaryColorHex** | Primary brand color. |
| **colorFamilies** | Normalized list for eligibility (e.g. ["orange","black"]). Optional until backfilled. |
| **tags** | Search/filter. |

DesignTeam already has most of these; the only possible gap is an explicit **teamCode** if it is today derived from id/name. Recommendation: treat **DesignTeam.id** as the canonical team identifier; for productIdentityKey use a normalized **teamCode** that may be design_teams.id.toUpperCase() or a separate field if you need a different code (e.g. GIANTS vs sf_giants).

### 4.4 Legacy and migration

- **Legacy temporarily:**  
  - **teams** collection can remain for Catalog/Leagues/Teams pages if those UIs are not yet migrated.  
  - Any code that still reads “teams” for display only (e.g. Teams hub) can stay until a migration project.  
- **Migrate later:**  
  - Point Catalog and Leagues/Teams UI at design_teams (or a unified API that reads from design_teams).  
  - If teams collection holds data not in design_teams, either backfill design_teams or add a sync path; then deprecate teams for “team” concept.  
- **Going forward:**  
  - **Blank eligibility:** Resolve teams from design_teams only.  
  - **Product creation / template resolution:** Resolve team metadata from design → design_teams (or product.teamCode + lookup design_teams by id/code).  
  - **Design:** Keep design.teamId → design_teams.  
  - **productIdentityKey and taxonomy:** teamCode and leagueCode should be resolvable from design_teams (or design caches that were populated from design_teams).

### 4.5 What must be done before Blank Render System

1. **Document the rule:** In a single place (e.g. RALLY_CORE_OBJECT_MODEL_AUDIT.md or new RALLY_TEAM_SOURCE_OF_TRUTH.md): “Canonical team source for product/design/blank/template resolution is **design_teams** (DesignTeam). All team metadata for templates, eligibility, and productIdentityKey must be resolvable from design_teams.”  
2. **teamCode for identity key:** Decide and document: use DesignTeam.id as teamCode (normalized) or add DesignTeam.teamCode; ensure product create can resolve teamCode from design → design_teams for productIdentityKey.

### 4.6 What can wait

- Migrating Teams/Catalog pages to design_teams.  
- Backfilling design_teams.colorFamilies.  
- Removing or deprecating teams collection.

---

## 5. Render output conventions

### 5.1 Current status

- **Product:** Has renderSetup (front/back: blankImageUrl, designAssetUrl, placementKey, placementOverride, blendMode, blendOpacity, maskUrl), mockupUrl (single), media (heroFront, heroBack, gallery, modelAssets, lifestyleAssets).  
- **Specs:** RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER, RALLY_BATCH_IMPORT_PHASE4_BATCH_HERO_RENDER_SPEC, RALLY_PHASE1_RENDER_SETUP_UI reference renderSetup and mockup quality; no formal “look type” or multi-output convention yet.  
- **No** first-class “render output” record type (e.g. lookType, view, generatedAt, stale) beyond what is stored on product (mockupUrl, media).

### 5.2 Proposed conventions (for Blank Render System phase)

#### A. Initial supported look types

| Look type | Description | MVP |
|-----------|-------------|-----|
| **flat_clean** | Composite only, no blend effects (blank + design placed). | Yes |
| **flat_blended** | Composite with blend mode/opacity (current default). | Yes |
| **hanger** | Garment on hanger (requires hanger asset/rig). | Later |
| **wrinkled** | Fabric wrinkle overlay or similar. | Later |
| **folded** / **floor** | Folded or flat-lay on surface. | Later |
| **lifestyle_placeholder** | Placeholder for on-model or scene. | Optional later |

**Recommendation:** For MVP, support **flat_clean** and **flat_blended** only. Other look types are additive once the pipeline and output model exist.

#### B. Canonical outputs for MVP

- **Canonical for product display and Shopify:** One composite per view (front, back) using the **flat_blended** (or flat_clean) look — i.e. current mockup behavior.  
- **Hero / primary image:** One “primary” front and one “primary” back (or single hero) stored in product.media.heroFront / heroBack.  
- **Later:** Additional look types (hanger, wrinkled, etc.) as extra outputs; need not replace the flat composite as canonical for sync/display until product strategy says so.

#### C. Output ownership

| Owner | What it owns |
|-------|----------------|
| **Generated Product** | Canonical render **outputs** (URLs, lookType, view, generatedAt). Product is the place that “has” the final images for this SKU (team+design+blank+variant). |
| **Blank / Variant** | **Inputs** only: garment images, placement config, render defaults. Blank does not store per-product outputs. |
| **Design** | **Inputs** only: artwork assets (light/dark PNG, etc.). Design does not store per-product outputs. |

**Recommendation:** All render **outputs** (composite images, regardless of look type) belong to **Generated Product** (or to a dedicated **rp_product_assets** / render_outputs subcollection keyed by productId if you want to avoid bloating the product doc). If stored on product: e.g. `media.byLook[lookType][view] = { url, generatedAt, stale? }` or equivalent. If stored in a separate collection: productId + lookType + view as key; product doc holds references or “primary” URLs only.

#### D. File / output record shape

**Naming (storage paths):**  
- Pattern: `rp/products/{productId}/renders/{lookType}/{view}.{ext}` or `rp/products/{productId}/renders/{lookType}_{view}.{ext}`.  
- Example: `rp/products/abc123/renders/flat_blended/front.png`.

**Output record (minimal for MVP):**  
- **lookType:** string (e.g. `flat_clean`, `flat_blended`).  
- **view:** `front` | `back`.  
- **url:** string (downloadUrl or storage path).  
- **generatedAt:** Timestamp.  
- **sourceBlankVariantId:** string (optional but recommended for traceability).  
- **sourceDesignAssetRef:** string or null (e.g. designId + “lightPng”/“darkPng”).  
- **stale:** boolean or derived: true if blank or design version used for this output is older than current (can be derived from product.blankVersionUsed/designVersionUsed vs current blank/design).

**Where to store:**  
- Option A: On product, e.g. `media.renders[]` or `media.byLook[lookType][view]` with the above shape.  
- Option B: Subcollection `rp_products/{productId}/render_outputs/{outputId}` with fields lookType, view, url, generatedAt, sourceBlankVariantId, sourceDesignAssetRef, stale.  
- Recommendation: **Option A** for MVP (simple, one doc) with a single “primary” front/back in media.heroFront/heroBack; optional byLook for multiple look types later. Option B if product doc size or query patterns demand it.

#### E. Trigger rules (when to regenerate outputs)

| Trigger | Action |
|---------|--------|
| **Blank placement changes** (placements[] or default x/y/scale/safeArea) | Mark product stale for blank; suggest or require “Regenerate mockup” for flat_* outputs. |
| **Blank render defaults** (blendMode, blendOpacity) | Same as above. |
| **Design asset changes** (new/replaced light or dark PNG) | Mark product stale for design; suggest or require “Regenerate mockup”. |
| **Variant image changes** (variant.images.front/back for this product’s blankVariantId) | Mark product stale for blank; require “Regenerate mockup” (blank image is input). |
| **Product placement override change** (renderSetup.front/back.placementOverride or blend) | Regenerate affected view(s) for that product. |
| **Product “Regenerate mockup”** | Run render pipeline for selected look type(s) and view(s); update url and generatedAt; clear stale for that output. |

**Recommendation:** Staleness is derived from product.blankVersionUsed / designVersionUsed vs current versions; “Regenerate mockup” updates the output and optionally refreshes version refs so stale clears. No automatic regeneration without user or job action.

### 5.3 What must be done before Blank Render System

1. **Document** the above in a short **RALLY_RENDER_OUTPUT_SPEC.md** (or a section in an existing render doc): look types (MVP vs later), ownership (product owns outputs), file naming, minimal output shape, trigger rules.  
2. **Decide** where outputs live for MVP: on-product media.byLook or media.renders vs subcollection; then add to RpProduct type when implementing.  
3. **Staleness:** Tie “output stale” to existing product staleness (blank/design version); no separate output version needed for MVP.

### 5.4 What can wait

- Implementing hanger/wrinkled/folded look types.  
- Subcollection for render_outputs (unless product doc size is a concern from day one).  
- Automatic regeneration on upstream change (manual or job-triggered regen is enough for MVP).

---

## Summary: pre-render checklist

| # | Area | Must do before Blank Render System | Can wait |
|---|------|------------------------------------|----------|
| 1 | Generated Product | Add productIdentityKey, blankVersionUsed, designVersionUsed to type and create flow; document blank.version bump; implement staleness derivation. | Overrides bucket; full refresh UI; optional cache fields. |
| 2 | Master Blank + Variant | Hide/relabel legacy color on Overview for masters; audit code paths so master never uses root color for product; document “color only on variants”. | Legacy doc migration; remove root color from type. |
| 3 | Eligibility | Nothing (eligibility is not in render critical path). | Backfill colorFamilies; use supportedDesignZones in generation. |
| 4 | Canonical team | Document design_teams as canonical; lock teamCode source for productIdentityKey. | Migrate Teams/Catalog; deprecate teams collection. |
| 5 | Render outputs | Document look types (MVP: flat_clean, flat_blended), ownership (product), file/output shape, trigger rules. | Implement alternate looks; subcollection; auto-regen. |

---

*End of pre-render audit.*
