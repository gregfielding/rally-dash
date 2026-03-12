# Rally — Architecture & Status Index

Single index for what’s built, partially built, paused, and what comes next. No major new system work here; use this to pivot back to the first real product design.

---

## What’s built

- **Taxonomy (Phases 1–3)**  
  Seeded collections (sports, leagues, entities, themes, design families). Resolved taxonomy + resolution status in batch import preview. Taxonomy dropdowns on Design and Product detail (Sport, League, Entity, Theme, Design Family). Validation rules (entity → league → sport; sport null only for thematic/lifestyle). Firestore rules: taxonomy collections read for authenticated users, write for admin/ops only.
- **Product classification & related products**  
  Product-level taxonomy fields (sportCode, leagueCode, teamCode, themeCode, designFamily; modelCodes planned). Related-products block on Product detail (client-side scoring: team → theme → league → sport → category → blankId; reasons; media tie-breaker; top 8).
- **Shopify tag system**  
  Canonical tag schema (sport, league, team, theme, model). `buildShopifyTags(product)` (deterministic, slug-safe). Sync worker sends these tags; Product detail shows tag preview. Smart Collections created manually; no automation.
- **Batch import (designs)**  
  Filename parsing (LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT). Grouped preview with resolved taxonomy and resolution status. Design create from batch with taxonomy. Product generation from batch (productIdentityKey, create/update products) implemented.
- **Render setup & product detail**  
  Render setup data model and UI (blank + design + placement per side). Product detail: merchandising, taxonomy, production, media, Shopify section, related products, assets, designs, generate, settings.

---

## What’s partially built

- **Deterministic render**  
  Specs and render-setup structure exist. Render pipeline (blank + design + placement → image) may need validation and consistency passes for “deterministic” guarantees.
- **Batch hero render**  
  Phase 4 spec (batch hero render) exists. Hero assignment and batch hero flow may be partially implemented or pending full wiring.
- **Shopify sync**  
  Worker: productSet (title, handle, media, variant, metafields, tags from buildShopifyTags). Readiness checks. No collection automation; manual Smart Collections.
- **Products table**  
  List, filters (status, category, search), create product, batch generate. Taxonomy columns/filters (sport, league, team, theme, model) from product classification mapping may be partial or pending.

---

## What’s paused

- **Collection automation**  
  No create/update of Shopify Smart Collections via GraphQL. Validate tag schema with manual collections first.
- **Product classification UI (Products table)**  
  Product classification mapping doc exists; full table columns + filters for taxonomy/model may be deferred until after first real product design.
- **modelCodes on product**  
  Schema and tag system support it; controlled list and Product detail multi-select may be pending.

---

## What comes next (later)

- Validate tag schema against real Shopify Smart Collections; then decide if collection automation is worth building.
- First real product design: end-to-end from design asset → product → render → Shopify tags.
- Optional: Products table taxonomy columns and filters; modelCodes UI; batch hero render completion; deterministic render QA.

---

*Last updated: organizational pass before pivoting to first real product design.*
