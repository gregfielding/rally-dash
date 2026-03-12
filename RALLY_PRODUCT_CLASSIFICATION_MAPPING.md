# Rally Product Classification — Implementation Mapping

This document maps schema, UI, and data flow for Shopify-facing product classification fields (sport, league, team, theme, models) so they are editable and filterable in Rally and later drive Shopify tags and smart collections.

---

## 1. Product schema changes

**File:** `lib/types/firestore.ts` (RpProduct interface)

| Field           | Type              | Status   | Notes |
|----------------|-------------------|----------|--------|
| sportCode      | string \| null    | Existing | Aligns with rp_taxonomy_sports |
| leagueCode     | string \| null    | Existing | rp_taxonomy_leagues |
| teamCode       | string \| null    | Existing | rp_taxonomy_entities |
| themeCode      | string \| null    | Existing | rp_taxonomy_themes |
| **modelCodes** | **string[]**      | **Add**  | Approved model associations (e.g. AMBER, MAYA). Empty array when none. |
| designFamily   | string \| null    | Keep     | Internal only; not Shopify-tag. |

**Changes:**

- Add to `RpProduct`:  
  `modelCodes?: string[];`  
  (Optional; treat as `[]` when undefined for display/filters.)
- No removals. designFamily stays on the product for internal/import use but is not part of “Classification” in the UI (see below).

**Firestore:** Documents in `rp_products` already have sport/league/team/theme/designFamily. Add `modelCodes` as an array field (write `[]` or omit when empty).

---

## 2. Product Detail page — components/files to touch

**File:** `app/products/[slug]/page.tsx`

**Current state:**  
Overview tab has a “Taxonomy” section with: Sport, League, Team/Entity, Theme, Design Family, and “Save taxonomy” (persists via `updateDoc` on `rp_products`).

**Planned changes:**

1. **Rename and scope the section**
   - Rename section to **“Classification (storefront)”** or **“Product classification”**.
   - Include only Shopify-facing fields: **Sport, League, Team, Theme, Models**.
   - Move **Design Family** into a separate small block (e.g. “Internal / import”) or keep in the same card with a visual separator and “Internal” label so it’s clear it’s not for tags.

2. **State and persistence**
   - Add local state: `modelCodes: string[]` (synced from `product.modelCodes ?? []` when product loads).
   - In `handleSaveProductTaxonomy` (or renamed handler), include `modelCodes` in the `updateDoc` payload (and continue sending sportCode, leagueCode, teamCode, themeCode; designFamily can stay in the same save for now).

3. **Models multi-select**
   - **Source of list:** No `rp_taxonomy_models` collection yet. Use a **controlled list** (config or constant), e.g. `const APPROVED_MODEL_CODES = ["AMBER", "MAYA", ...]` in a small module or in the same file. Optionally later: `lib/constants/approvedModelCodes.ts` or config from Firestore.
   - UI: Multi-select (checkboxes or multi-select dropdown). Only allow values from the controlled list; persist as `string[]`.

4. **No other structural changes**
   - Keep using existing taxonomy hooks (useTaxonomySports, useTaxonomyLeagues, useTaxonomyEntities, useTaxonomyThemes). Design Family already uses useTaxonomyDesignFamilies; that can stay for the internal block.

**Summary of touches:**

- `app/products/[slug]/page.tsx`: state for modelCodes; sync from product; Classification section rename/restructure; Models multi-select; save payload including modelCodes; optional “Internal” block for designFamily.

---

## 3. Products table / filter — files to touch

**File:** `app/products/page.tsx` (Products list + table + filters)

**Current state:**  
Table columns: Product (name + colorway), Base Product, Category, Status, Assets, Actions.  
Filters: Search (client-side), Status, Category.  
Data: `useProducts(filters)` from `lib/hooks/useRPProducts.ts`; filters today are status, category, baseProductKey, search (client-side).

**Planned changes:**

1. **Filters**
   - Add filter dropdowns (or multi-selects): **Sport, League, Team, Theme, Model**.
   - Filter values: Sport/League/Team/Theme from taxonomy hooks (same as Design/Product detail). Model: from the same controlled list as Product Detail.
   - **Implementation:** Keep filters **client-side** in `useRPProducts` (or in the page after fetch). No new Firestore composite indexes required. In `app/products/page.tsx`: add state for sportFilter, leagueFilter, teamFilter, themeFilter, modelFilter; pass into `useProducts`; in `fetchRPProducts` (or in the page with useMemo), filter the fetched list by these fields (and array-contains or includes for modelCodes).  
   - **Alternative:** Extend `UseProductsFilters` in `lib/hooks/useRPProducts.ts` with optional `sportCode?, leagueCode?, teamCode?, themeCode?, modelCode?` and apply in `fetchRPProducts` after the Firestore query (client-side). Same outcome, keeps filter logic in one place.

2. **Table columns**
   - Add columns (at least some always visible, others optional or in a “show more”):
     - **Sport** (sportCode or “—”)
     - **League** (leagueCode or “—”)
     - **Team** (teamCode or “—”)
     - **Theme** (themeCode or “—”)
     - **Models** (modelCodes.join(", ") or “—”)
   - Prefer compact cells (e.g. single line, truncate if needed).

3. **Sorting**
   - Add sort state (e.g. sortBy: "createdAt" | "name" | "sportCode" | "leagueCode" | "teamCode" | "themeCode", sortDir: "asc" | "desc"). Default remains createdAt desc or name.
   - Apply sort **client-side** on the already-fetched list (no new Firestore orderBy). For modelCodes (multi-value), **skip sort-by-model** in the first slice or support “sort by first model” for simplicity.

**Summary of touches:**

- `lib/hooks/useRPProducts.ts`: extend `UseProductsFilters` with sportCode, leagueCode, teamCode, themeCode, modelCode (single value for “filter by this model”); in `fetchRPProducts`, after Firestore fetch and existing client-side search, apply these filters; optionally add client-side sort params and sort the array before return.
- `app/products/page.tsx`: add filter state and filter UI (Sport, League, Team, Theme, Model); add table columns for sport, league, team, theme, models; add sort dropdown/controls and wire to sorted list (client-side).

---

## 4. modelCodes: simple array now vs referenced taxonomy later

**Recommendation: simple array now.**

- **Now:** Store `modelCodes: string[]` on the product. Allowed values come from a **controlled list** (constant or small config, e.g. `["AMBER", "MAYA", ...]`) used in Product Detail and Products table. No new collection or hooks.
- **Later:** If you need a full taxonomy (labels, order, active/inactive), introduce `rp_taxonomy_models` (or similar) and a hook; then the Product Detail and table can read options from there and still store codes on the product. Migration: existing product.modelCodes remain valid as long as codes match the new taxonomy.

This keeps the smallest implementation slice and avoids new collections/indexes until needed.

---

## 5. Smallest implementation slice (order of work)

1. **Schema**
   - Add `modelCodes?: string[]` to `RpProduct` in `lib/types/firestore.ts`.

2. **Controlled model list**
   - Add `lib/constants/approvedModelCodes.ts` (or equivalent) exporting a string array and optionally label map. Use it in Product Detail and Products page for dropdowns/filters.

3. **Product Detail**
   - In `app/products/[slug]/page.tsx`: add `modelCodes` state; sync from product; add Models multi-select using the controlled list; include modelCodes in the existing taxonomy save payload; rename section to “Product classification” and move Design Family to an “Internal” subsection or label.

4. **Products table**
   - In `lib/hooks/useRPProducts.ts`: extend filters with sportCode, leagueCode, teamCode, themeCode, modelCode; apply client-side; optionally add sortBy/sortDir and sort the list.
   - In `app/products/page.tsx`: add filter UI (Sport, League, Team, Theme, Model); add table columns (Sport, League, Team, Theme, Models); add sort controls and client-side sort.

5. **Create product**
   - If “Create product” modal or flow ever sets taxonomy, add modelCodes (e.g. []). No change required if create doesn’t set classification yet.

Result: classification fields are on the product, editable on the Product Detail page, and visible/filterable/sortable in the Products table, with modelCodes as a simple array and a controlled list, ready for a later Shopify tag mapping (sport:*, league:*, etc.) without changing structure.

---

## 6. Summary table

| Area              | What changes |
|-------------------|--------------|
| **Schema**        | RpProduct: add `modelCodes?: string[]`. Keep sport/league/team/theme/designFamily. |
| **Product Detail**| `app/products/[slug]/page.tsx`: Classification section (Sport, League, Team, Theme, Models); internal block for designFamily; save modelCodes. |
| **Products table**| `app/products/page.tsx`: Columns sport, league, team, theme, models; filters Sport/League/Team/Theme/Model; client-side sort by sport/league/team/theme/title. |
| **Hooks**         | `lib/hooks/useRPProducts.ts`: filters for classification fields; client-side filter + optional sort. |
| **modelCodes**   | Simple array on product; controlled list in code (e.g. `lib/constants/approvedModelCodes.ts`) for now. |

---

## 7. Shopify tag mapping (reference only — not implemented here)

- sportCode     → `sport:baseball`
- leagueCode    → `league:mlb`
- teamCode      → `team:giants`
- themeCode     → `theme:panty_drop`
- modelCodes    → `model:amber`, `model:maya`

Tags and metafields are out of scope for this slice; these fields are stored and editable so that a future sync can emit the above tags.
