# Rally Core Object Model Audit

**Purpose:** Lock the core object model before further UI or generation work. This document audits current schema, types, and page responsibilities against the target architecture and recommends alignment steps.

**Target architecture (summary):**

| Object | Owns |
|--------|------|
| **Blank** | Garment type, color/color family, placement config, render views, masking/blending/render style, Shopify defaults, title/description/tag templates, pricing/weight defaults |
| **Design** | Reusable artwork, team + league, design type, print colors, light/dark PNG assets, SVG/PDF, status/version/completeness |
| **Generated Product** | Specific team/design/blank combination, final title, SKU/item number, final price/weight, render outputs, readiness/completeness, Shopify sync state, overrides, linked design version + blank version |
| **Team** | Team metadata only: league, city/team name, colors, slug/code/grouping |

**Constraint:** Product Template / Blank Template is **not** a separate top-level object; it lives **inside Blank** as Shopify defaults + product templating config.

---

## A. Gap Analysis

### 1. Blank (RPBlank / rp_blanks)

| Target ownership | Current state | Gap |
|------------------|---------------|-----|
| Garment type | ✅ `garmentCategory`, `styleCode`, `supplier`, `styleName` | None |
| Color / color family | ⚠️ `colorName`, `colorHex` only | **No explicit `colorFamily`** (e.g. `"light"` / `"dark"`) for design asset selection; today this is often inferred from color name in code. |
| Placement config | ✅ `placements[]` with `placementId`, `defaultX`, `defaultY`, `defaultScale`, `safeArea` | Overlap with Design: **Design also has `placementDefaults`** used by mock/generation. Authority for “where art goes” is split. |
| Render views | ✅ `images.front`, `images.back` | None |
| Masking / blending / render style | ⚠️ Masking: **separate collection** `rp_blank_masks` (RPBlankMask) per blank+view. Blending: **on Product** (`renderSetup.front|back.blendMode`, `blendOpacity`), not on Blank. | **Masking** is not “owned” by Blank in the schema (subcollection). **Blending/render style** (e.g. soft-light, opacity) lives on Product; architecture implies Blank could own **default** blend/render style. |
| Shopify defaults | ❌ | **Missing.** No title template, description template, tag template, or Shopify-specific defaults on Blank. |
| Title/description/tag templates | ❌ | **Missing.** Product-level title/description are set on RpProduct; no templating from Blank. |
| Pricing / weight defaults | ❌ | **Missing.** RpProduct has optional `pricing`, `shipping.defaultWeightGrams`; Blank has no default price/weight. |

**Pages:** Blanks list (`/blanks`), Blank detail (`/blanks/[blankId]` with Overview, Images, Placements, Masks). No UI for Shopify defaults, templates, or pricing/weight defaults on Blank.

---

### 2. Design (DesignDoc / designs)

| Target ownership | Current state | Gap |
|------------------|---------------|-----|
| Reusable artwork | ✅ Name, slug, assets (lightPng, darkPng, svg, pdf), files metadata | None |
| Team + league | ✅ `teamId` (→ design_teams), `leagueId`, teamNameCache, teamCityCache, etc. | **Team source:** Design uses **design_teams** collection (DesignTeam), not the **teams** collection (Team). Two “team” systems exist. |
| Design theme | ✅ `designType` (concept: city_69, slogan, stadium, …; legacy wordmark/script/badge/other still readable) | None |
| Print colors | ✅ `colors[]` with role/hex, `colorCount` | None |
| Light/dark PNG assets | ✅ `assets.lightPng`, `assets.darkPng` (and files) | None |
| SVG/PDF assets | ✅ `assets.svg`, `assets.pdf` | None |
| Status / version / completeness | ✅ `status`, `isComplete`, completeness derived from name/team/type/light/dark assets | **Version:** No explicit `version` or `designVersionId`; products reference design by `designId` only (no pinned version). |

**Placement:** Design has `placementDefaults[]` (DesignPlacementDefault) used by mock and generation. Architecture assigns placement config to **Blank**; Design might only own “suggested” placement or it could be refactored so placement authority is Blank-only.

**Pages:** Design Library (`/designs`), Design detail (`/designs/[designId]`), Batch import (`/designs/batch`). Aligned with “design = reusable artwork inventory.”

---

### 3. Generated Product (RpProduct / rp_products)

| Target ownership | Current state | Gap |
|------------------|---------------|-----|
| Specific team/design/blank combination | ✅ `designId`, `designIdFront`/`designIdBack`, `blankId`; taxonomy (teamCode, leagueCode, etc.) | **Team** is implied via design + taxonomy, not a direct FK to a single “team” entity (design_teams vs teams). |
| Final title | ✅ `name`, `title` | None |
| SKU / item number | ⚠️ `baseProductKey`, `slug`; no explicit “SKU” or “item number” field | **SKU** often derived or stored elsewhere; not a single canonical field. |
| Final price/weight | ✅ Optional `pricing`, `shipping.defaultWeightGrams` | None |
| Render outputs/images | ✅ `renderSetup`, `mockupUrl`, `media` (heroFront, heroBack, gallery, etc.) | None |
| Readiness/completeness | ✅ `status` (draft/active/archived); readiness for Shopify often computed (e.g. isProductReadyForShopify) | No single “completeness” flag; readiness is derived. |
| Shopify sync state | ✅ `shopify.productId`, `shopify.status`, `shopify.lastSyncAt`, etc. | None |
| Overrides | ✅ `renderSetup.front|back.placementOverride`, blendMode, blendOpacity; product-level overrides for title/description | Overrides are spread across renderSetup and top-level fields; no single “overrides” bucket. |
| Linked design version + blank version | ❌ `designId`, `blankId` only | **No `designVersionId` or `blankVersionId`.** Products point to design and blank by current doc id only; no version pinning for reproducibility. |

**Pages:** Products list (`/products`), Product detail (`/products/[slug]` with Overview, Content, Assets, Shopify, History), Bulk (`/products/bulk`), Batch hero. Product creation uses design + blank; no explicit “version” in UI.

---

### 4. Team (target: single concept)

| Target ownership | Current state | Gap |
|------------------|---------------|-----|
| Team metadata only | Two systems | **Dual team model.** |
| League | (1) **Team** (teams collection): `leagueId`. (2) **DesignTeam** (design_teams): `league`, `leagueId`. | Leagues page and Teams page use **teams** + **leagues** collections. Design Library and create design use **design_teams** only. |
| City / team name | (1) **Team**: `city`, `name`. (2) **DesignTeam**: `city`, `state`, `teamName`, `name`. | DesignTeam is richer (state, teamName) and used for design flows; Team is used for Catalog/Leagues/Teams hub. |
| Colors | (1) **Team**: `colors.primary`, `colors.secondary`, etc. (2) **DesignTeam**: `primaryColorHex`. | Different shapes. |
| Slug/code/grouping | (1) **Team**: `slug`, `keywords`, `bannedTerms`. (2) **DesignTeam**: `id`, `tags`. | No single source of truth for “team” across Catalog, Design, and future Product team display. |

**Pages:** Catalog (`/catalog`) links to Leagues, **Teams** (teams collection), Design batch. Design Library uses **design_teams** only. So: **Teams page** = teams collection; **Design create/list** = design_teams collection.

---

### 5. Product Template / Blank Template (inside Blank)

| Target | Current state | Gap |
|--------|---------------|-----|
| Shopify defaults + product templating config live **inside Blank** | Not present | **No Shopify defaults or product templating config on Blank.** RpProduct has its own title, description, taxonomy, baseProductKey; no template tokens or defaults coming from Blank. **Product Template** as a first-class concept does not exist; **Blank Template** (e.g. “panty 8394” default title template) does not exist on Blank. |

---

## B. Recommendations (what to move or refactor)

### Blank

1. **Add `colorFamily`** (e.g. `"light"` | `"dark"`) to RPBlank (or derive from a small mapping of `colorName` → colorFamily) so the renderer can consistently choose Design’s light vs dark asset without ad hoc logic.
2. **Add optional Shopify/product templating config on Blank:** e.g. `shopifyDefaults?: { titleTemplate?, descriptionTemplate?, tagTemplates? }`, `productTemplating?: { defaultCategory?, defaultVendor? }`, and **pricing/weight defaults** (e.g. `defaultPrice`, `defaultWeightGrams`). Keep Product Template / Blank Template **inside Blank** as agreed.
3. **Clarify placement authority:** Prefer **Blank** as the single owner of placement config (defaults for where art sits). Consider moving Design’s `placementDefaults` to “suggested from design” or deprecating in favor of Blank placements + optional overrides on Product. If both stay, document clearly: Blank = canonical placement; Design = optional hints.
4. **Blending/render style:** Consider adding optional **default** blend mode/opacity on Blank (e.g. `renderStyle?: { defaultBlendMode?, defaultBlendOpacity? }`) so new products can inherit; Product keeps overrides. Optional and can follow after templates.

### Design

1. **Keep Design focused** on reusable artwork, team/league, design type, print colors, light/dark + SVG/PDF assets, status/completeness. No structural change required for core fields.
2. **Placement:** See Blank recommendation: either move placement authority to Blank and make Design’s `placementDefaults` advisory, or document the current split and keep as-is for a later pass.
3. **Version:** Introduce optional `version` or immutable “design version” references later if you need reproducibility (e.g. “product was built from design v2”). Not required for initial lock.

### Generated Product

1. **SKU / item number:** Define a single canonical field (e.g. `sku` or `itemNumber`) if you want it explicit; otherwise keep deriving from `baseProductKey` + slug and document that.
2. **Linked design version + blank version:** Add optional `designVersionId` and `blankVersionId` (or equivalent, e.g. `designSnapshotAt`, `blankSnapshotAt`) when you need version pinning. For the initial lock, documenting that “product links to design and blank by id only” may be enough.
3. **Overrides:** Optional: group product-level overrides into a single `overrides` (or keep as today) and document where overrides live (renderSetup vs top-level).

### Team

1. **Unify Team concept:** Choose one source of truth:
   - **Option A:** Treat **design_teams** as canonical; migrate Teams page and Catalog to use design_teams (and leagues from there or a leagues collection). Deprecate or alias **teams** collection.
   - **Option B:** Treat **teams** as canonical; add missing fields (e.g. state, teamName) and make Design reference **teams** instead of design_teams. Migrate Design Library to use teams.
   - **Option C:** Keep both but define clearly: “teams” = catalog/merchandising; “design_teams” = design library only, and Design only references design_teams. Document and ensure no confusion (e.g. same team appearing in both with different ids).
2. Recommendation: **Option B or A** so that “team” is one entity; Option C is acceptable short term if you document and accept two team lists.

### Product Template / Blank Template

1. **Implement “template” inside Blank:** Add the recommended Shopify defaults and product templating config (title/description/tag templates, default price/weight, default category/vendor if needed) to Blank so that new products created from a Blank can pull defaults from it. No separate Product Template or Blank Template top-level object.

### Pages (responsibilities)

1. **Blanks:** After schema changes, extend Blank detail (or list) to edit **Shopify defaults**, **title/description/tag templates**, and **pricing/weight defaults** when those fields exist.
2. **Designs:** No major change; ensure Design Library and create flow use the chosen single Team source after Team unification.
3. **Products:** Product create/detail should use Blank’s new default/template fields when present (title template, default price/weight, etc.). No need for a separate “Product Template” or “Blank Template” page.
4. **Catalog:** After Team unification, Catalog’s “Teams” link should point to the single team system. Leagues can stay as-is if leagues are separate from teams.
5. **Publish:** Stays Shopify-sync focused; no schema change required for Publish itself.

---

## C. Proposed Implementation Order

Recommended order to align the app with the architecture without doing everything at once:

### Phase 1 – Schema and data model (no new pages)

1. **Blank: add `colorFamily`**  
   Add to RPBlank (and seed/migration): e.g. `colorFamily: "light" | "dark"` (or derive from `colorName` and store). Use it in renderer to pick Design’s light vs dark asset.

2. **Blank: add Shopify/product templating and defaults**  
   Add to RPBlank: e.g. `shopifyDefaults?: { titleTemplate?, descriptionTemplate?, tagTemplates? }`, `productTemplating?: { defaultCategory?, defaultVendor? }`, `defaultPricing?: { basePrice?, compareAtPrice?, currencyCode? }`, `defaultShipping?: { defaultWeightGrams? }`. No new top-level Template object.

3. **Team unification (pick Option A or B)**  
   - If Option B: extend **teams** with `state`, `teamName` (and any DesignTeam fields you need); point Design’s `teamId` at **teams**; migrate Design Library + create design to use teams; deprecate or stop using design_teams for new writes.  
   - If Option A: make **design_teams** canonical and migrate Teams page + Catalog to design_teams (and leagues).  
   Document the decision and update types.

### Phase 2 – Placement and render style

4. **Placement authority**  
   Decide: Blank-only vs Design hints + Blank. If Blank-only: add/move placement defaults to Blank (or keep Blank.placements as canonical), and either remove Design.placementDefaults or mark “suggested only” and use Blank in mock/generation. If keeping both, document clearly in types and in one place in the codebase.

5. **Blending/render style on Blank (optional)**  
   Add optional default blend mode/opacity on Blank; product creation or render flow can copy to Product when no override is set.

### Phase 3 – Product and versioning

6. **Product: canonical SKU and overrides (optional)**  
   Add explicit `sku` or `itemNumber` on RpProduct if desired; otherwise document derivation. Optionally group overrides for clarity.

7. **Product: linked design/blank version (optional)**  
   When you need version pinning, add `designVersionId` / `blankVersionId` (or snapshot references) to RpProduct and set them when creating/updating products.

### Phase 4 – UI

8. **Blank UI: templates and defaults**  
   In Blank detail (or a new “Templates” / “Shopify defaults” section), add forms for the new Blank fields: title/description/tag templates, default price/weight, default category/vendor.

9. **Product creation: use Blank defaults**  
   When creating a product from a Blank (and optionally from a Design), prefill title, description, pricing, weight, category from Blank’s new fields.

10. **Catalog and Teams**  
    After Team unification, update Catalog and Teams page to use the single team source and correct links.

---

## Summary

| Area | Main gaps | Priority |
|------|-----------|----------|
| Blank | colorFamily; Shopify/title/description/tag templates; pricing/weight defaults; placement vs Design | High (Phase 1–2) |
| Design | Placement authority vs Blank; optional version | Medium (Phase 2, 3) |
| Product | SKU canonical; design/blank version pinning; overrides grouping | Low (Phase 3) |
| Team | Two systems (teams vs design_teams) | High (Phase 1) |
| Product/Blank Template | Not on Blank today | High (Phase 1 schema, Phase 4 UI) |

Implementing **Phase 1** (colorFamily, Blank templating/defaults, Team unification) gives a locked core model that matches the architecture and sets up Phase 2–4 without further schema churn for those areas.
