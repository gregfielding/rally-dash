# Phase 1: Blank as Foundation — Implementation Spec

**Goal:** Make Blank the source of truth for garment-specific rendering and product defaults before touching parser, generation, or dashboard redesign.

**Scope:** Schema and ownership first; then Blank detail page structure; then UI behavior. Team unification is addressed briefly; the main focus is Blank.

---

## 1. Required New Fields on Blank

All new fields are **optional** at write time (nullable or omit) to allow backward-compatible rollout and migration. Required only when “use Blank defaults” is chosen at product creation.

### 1.1 colorFamily

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `colorFamily` | `"light" \| "dark"` | No (optional) | Drives which Design asset the renderer uses: `design.assets.lightPng` vs `design.assets.darkPng`. If missing, derive from `colorName` via a fixed mapping (e.g. Black, Midnight Navy, Navy, Indigo → `"dark"`; White, Off-White, Heather Grey, Athletic Grey, Red, Blue → `"light"`). |

**Recommendation:** Add `colorFamily` to the Blank document. On create/update, allow explicit set or auto-derive from `colorName` using a shared mapping (e.g. in `lib/blanks/colorFamily.ts`). Renderer and product-creation logic should always read `blank.colorFamily ?? deriveColorFamily(blank.colorName)`.

---

### 1.2 Shopify defaults

Single optional object on Blank. Product creation (and optionally Shopify sync) can copy these when the product has no override.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shopifyDefaults` | `RPBlankShopifyDefaults \| null` | No | See shape below. |

**Shape `RPBlankShopifyDefaults`:**

```ts
interface RPBlankShopifyDefaults {
  /** Default product type for Shopify (e.g. "Panties", "Tank Top") */
  productType?: string | null;
  /** Default vendor */
  vendor?: string | null;
  /** Default Shopify product category (taxonomy) if applicable */
  productCategory?: string | null;
  /** Collection handles to add variants of this blank to (e.g. ["panties", "cotton"]) */
  collectionHandles?: string[] | null;
}
```

No title/description here — those live in **templates** (section 1.3).

---

### 1.3 Title / description / tag templates

Templates are strings with **placeholders** (tokens). When creating a product from a Blank (and optionally when syncing to Shopify), replace tokens with context (team name, design name, color name, etc.).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `titleTemplate` | `string \| null` | No | Template for product title. Tokens: see §4. |
| `descriptionTemplate` | `string \| null` | No | Template for product description (plain or HTML). Tokens: see §4. |
| `tagTemplates` | `string[] \| null` | No | List of tag templates; each tag string can contain tokens. Resulting tags are the union of resolved tags (no duplicates). |

**Storage:** These can live at top level on the Blank doc (e.g. `titleTemplate`, `descriptionTemplate`, `tagTemplates`) or inside an object like `productTemplates: { titleTemplate, descriptionTemplate, tagTemplates }`. Recommendation: **top level** for simplicity (`titleTemplate`, `descriptionTemplate`, `tagTemplates`).

---

### 1.4 Default price

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultPrice` | `number \| null` | No | Default base price (e.g. USD cents or dollars — define one convention, e.g. cents). |
| `defaultCompareAtPrice` | `number \| null` | No | Default compare-at price (same unit as defaultPrice). |
| `defaultCurrencyCode` | `string \| null` | No | e.g. `"USD"`. If missing, assume USD. |

**Recommendation:** Single object `defaultPricing?: { basePrice?: number; compareAtPrice?: number; currencyCode?: string } \| null` on Blank. Product creation copies to `product.pricing` when present and no product-level override exists.

---

### 1.5 Default weight

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultWeightGrams` | `number \| null` | No | Default weight in grams for shipping. |
| `requiresShipping` | `boolean \| null` | No | Default “requires shipping” (e.g. true for physical goods). |

**Recommendation:** Single object `defaultShipping?: { defaultWeightGrams?: number; requiresShipping?: boolean } \| null` on Blank. Product creation copies to `product.shipping` when present.

---

### 1.6 Render / blend defaults

Blanks define the **default** blend mode and opacity for compositing the design overlay onto the blank image. Product keeps the ability to override per side.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `renderDefaults` | `RPBlankRenderDefaults \| null` | No | See shape below. |

**Shape `RPBlankRenderDefaults`:**

```ts
interface RPBlankRenderDefaults {
  /** Default blend mode for design-on-blank (e.g. "soft-light", "overlay") */
  blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null;
  /** Default opacity for design layer (0–1). */
  blendOpacity?: number | null;
  /** Optional: per-view overrides (front/back) if different from above */
  front?: { blendMode?: string | null; blendOpacity?: number | null } | null;
  back?: { blendMode?: string | null; blendOpacity?: number | null } | null;
}
```

When creating a product from Design + Blank, initialize `product.renderSetup.front` and `renderSetup.back` from `blank.renderDefaults` (view-specific or fallback to top-level). Product detail can still override per side.

---

### 1.7 Placement authority fields

Blank **owns** canonical placement: where the design sits on the garment (position, scale, safe area). Current Blank already has `placements: RPPlacement[]` with `placementId`, `defaultX`, `defaultY`, `defaultScale`, `safeArea`. Align naming and semantics so that:

- **Blank** is the single source of truth for placement **defaults** (per placementId).
- **Product** may store **overrides** only (`placementOverride` on renderSetup).
- **Design** does **not** own placement; Design’s `placementDefaults` become **deprecated for new use** or **advisory only** (generation can fall back to Design only when Blank has no placement for that id).

**Required changes:**

1. **Blank:** Keep and document `placements: RPPlacement[]` as the canonical placement config. Ensure each entry has:
   - `placementId` (e.g. front_center, back_center)
   - `label`
   - `defaultX`, `defaultY` (normalized 0–1, center of art)
   - `defaultScale` (relative to blank image)
   - `safeArea` (e.g. `{ x, y, w, h }` in normalized coords or `{ padX, padY }`)

2. **Normalize coordinate semantics** so mock/generation use Blank’s placements only. If Design’s `placementDefaults` use a slightly different shape (e.g. `x,y` center + `safeArea.padX/padY`), add a small adapter that maps Blank’s `RPPlacement` into the format the renderer expects, or extend `RPPlacement` to include `safeArea.padX`/`padY` if that’s what the pipeline uses.

3. **No new top-level “placement authority” field** — the existing `placements` array **is** the authority. The spec change is **ownership and usage**: all placement defaults come from Blank; Product only has overrides; Design’s placement is deprecated or advisory.

**Optional:** Add `placementNotes?: string | null` on Blank for operator guidance (e.g. “Use front_center for main art on this style”).

---

## 2. Product and Design: What Moves, Stays, or Is Deprecated

### 2.1 Product (RpProduct)

| Area | Action | Notes |
|------|--------|------|
| **Placement** | **Stay** | `renderSetup.front|back.placementOverride` remain as **overrides**. Canonical defaults come from Blank. When creating product from Blank, copy Blank’s placement for the chosen placementId into renderSetup (or read Blank at render time). |
| **Blend** | **Stay** | `renderSetup.front|back.blendMode`, `blendOpacity` stay. When creating from Blank, **initialize** from `blank.renderDefaults`; product can override. |
| **Title / description / tags** | **Stay** | Product keeps `name`, `title`, `description`, `descriptionHtml`, `tags`. When creating from Blank, **resolve** Blank’s `titleTemplate`, `descriptionTemplate`, `tagTemplates` with context and set these on the product. Product remains the store of the **final** title/description/tags. |
| **Pricing** | **Stay** | Product keeps `pricing: { basePrice, compareAtPrice, currencyCode }`. When creating from Blank, **copy** from `blank.defaultPricing` if present. |
| **Shipping** | **Stay** | Product keeps `shipping: { defaultWeightGrams, requiresShipping }`. When creating from Blank, **copy** from `blank.defaultShipping` if present. |
| **Category / vendor / productType** | **Stay** | Product may keep or add fields for Shopify (category, productType, vendor). When creating from Blank, **copy** from `blank.shopifyDefaults` if present. |

**Summary:** Nothing is removed from Product. Product gains **initial values** from Blank at creation time; Product continues to own all overrides and final values.

### 2.2 Design (DesignDoc)

| Area | Action | Notes |
|------|--------|------|
| **placementDefaults** | **Deprecate for new use** | Mark Design’s `placementDefaults` as **advisory only** or deprecated. Mock and generation should prefer **Blank.placements**; use Design’s only when Blank has no placement for that id (e.g. legacy). Do not remove the field yet (backward compat). |
| **All other Design fields** | **Stay** | Team, league, design type, print colors, assets (light/dark PNG, SVG, PDF), status, completeness — unchanged. Design does not gain any Blank-owned fields. |

---

## 3. Recommended Blank Detail Page Structure

Use a **tabbed** detail page (or clearly separated sections) so that “foundation” areas (rendering, Shopify, pricing) are easy to find and edit.

### 3.1 Tabs (or equivalent sections)

1. **Overview**  
   - Identity: slug, status, supplier, style code, garment category, color name, **color family** (display + edit).  
   - Short summary: “This blank is the base for products. Set defaults and templates below so new products inherit them.”  
   - Optional: linked products count (see §3.8).

2. **Images / Views**  
   - Current behavior: front/back images, upload, delete.  
   - Keep as-is; ensure labels say “Front view” / “Back view” (render views).

3. **Placement**  
   - List Blank’s `placements[]` (placementId, label, defaultX, defaultY, defaultScale, safeArea).  
   - Allow edit of placement defaults (per placementId).  
   - Short copy: “Canonical placement for design on this garment. Products can override per product.”

4. **Rendering**  
   - **Render defaults:** blend mode, blend opacity (global and optional per-view front/back).  
   - **Masks:** Keep current Masks behavior (or move under this tab). Masks are part of “how we render on this blank.”  
   - Copy: “Default blend and opacity for design overlay. Products can override.”

5. **Shopify defaults**  
   - Edit `shopifyDefaults`: product type, vendor, product category, collection handles.  
   - No title/description here — those are in **templates** (next section).

6. **Templates**  
   - **Title template** (single text input/textarea).  
   - **Description template** (textarea; support tokens).  
   - **Tag templates** (list of tag strings, each can contain tokens).  
   - Show token reference (e.g. `{teamName}`, `{designName}`, `{colorName}`, `{garmentStyle}`) and optionally a “Preview with sample values” button.

7. **Pricing / weight**  
   - **Default price** (base price, compare-at, currency).  
   - **Default weight** (grams) and “requires shipping” checkbox.  
   - Copy: “Used when creating a new product from this blank unless overridden on the product.”

8. **Eligibility rules** (optional for Phase 1)  
   - Reserved for future rules (e.g. “this blank only for category panties” or “only for certain leagues”).  
   - Can be a placeholder section or “Coming later.”

9. **Linked products**  
   - List products where `product.blankId === this Blank`.  
   - Read-only list with links to product detail (and optionally product slug/name).  
   - Helps operators see which products use this blank.

**Order of tabs (suggested):** Overview → Images/Views → Placement → Rendering → Shopify Defaults → Templates → Pricing/Weight → (Eligibility) → Linked Products.

---

## 4. How Templating Should Work

### 4.1 Token set

Resolve templates at **product creation time** (and optionally when “Apply Blank defaults” is run on an existing product). Context passed into resolution:

| Token | Source | Example |
|-------|--------|--------|
| `{teamName}` | Design (teamNameCache or design name) | "San Francisco Giants" |
| `{designName}` | Design name | "San Francisco Giants – City 69" |
| `{colorName}` | Blank colorName | "Black" |
| `{garmentStyle}` | Blank styleName or styleCode | "Cotton Panty" / "8394" |
| `{category}` | Blank shopifyDefaults.productType or garmentCategory | "Panties" |
| `{vendor}` | Blank shopifyDefaults.vendor | "Rally" |

Additional tokens (optional): `{league}`, `{productType}`. Keep the set small and document in one place (e.g. `lib/blanks/templateTokens.ts`).

### 4.2 Title template

- **Example:** `{teamName} {designName} – {colorName}`  
- **Resolved:** "San Francisco Giants – City 69 – Black" (or shorten design name if desired).  
- **Rules:** Replace each `{token}` with the value; if value missing, use empty string or a fallback (e.g. "Unknown"). Trim extra spaces. Max length for Shopify title can be enforced at product save (e.g. 255).

### 4.3 Description template

- **Example:** `Official {teamName} gear. Style: {garmentStyle}, Color: {colorName}.`  
- **Resolved:** "Official San Francisco Giants gear. Style: Cotton Panty, Color: Black."  
- **Rules:** Same token replacement. Can be plain text or HTML; store in `product.description` / `product.descriptionHtml` as per existing product schema.

### 4.4 Tags template

- **Example:** `["{teamName}", "{league}", "panties", "{colorName}"]`  
- **Resolved:** ["San Francisco Giants", "MLB", "panties", "Black"].  
- **Rules:** Each array element is a tag template string; resolve tokens; deduplicate; product’s `tags` array is set to the result (or merged with existing if applying defaults to an existing product).

### 4.5 Stored format

- **titleTemplate:** string, e.g. `"{teamName} {designName} – {colorName}"`.  
- **descriptionTemplate:** string (multiline ok).  
- **tagTemplates:** array of strings, e.g. `["{teamName}", "panties", "{colorName}"]`.

Resolution function: `resolveBlankTemplates(blank, context) → { title, description, tags }` where `context` has `{ teamName, designName, league, colorName, garmentStyle, category, vendor }`. Product creation (and any “apply defaults” action) calls this and sets product fields.

---

## 5. How Blank Interacts With Design, Product, and Team

### 5.1 Blank ↔ Design

- **No direct FK.** Blank does not reference Design. Design does not reference Blank.  
- **Rendering:** When generating a mock or product image, the pipeline has (product → designId, blankId). It loads Design and Blank; it picks Design’s asset via `blank.colorFamily` (e.g. `design.assets.darkPng` when `blank.colorFamily === "dark"`). Placement and blend defaults come from Blank.  
- **Product creation:** User selects Design + Blank; product is created with `designId` and `blankId`. Blank’s templates and defaults are applied to the new product.

### 5.2 Blank ↔ Generated Product

- **Product references Blank:** `product.blankId` (required for product-from-Blank flow).  
- **Blank does not reference Product.** “Linked products” is a **query**: products where `blankId === blank.blankId`.  
- **Data flow:** At product creation, copy from Blank: defaultPricing → product.pricing, defaultShipping → product.shipping, shopifyDefaults → product (vendor, productType, etc.), renderDefaults → product.renderSetup (front/back blend), resolve titleTemplate/descriptionTemplate/tagTemplates → product.name/title, product.description, product.tags. Product then owns all overrides.

### 5.3 Blank ↔ Team

- **No direct FK.** Blank has no teamId. Team/design association is on Design (`design.teamId`). When resolving templates for a product, team name comes from the **Design** (or product’s taxonomy), not from Blank.  
- **Eligibility rules (future):** If you add “this blank only for certain teams/leagues,” that would be a small rule set on Blank (e.g. allowedLeagueIds or allowedTeamIds); not part of Phase 1.

---

## 6. TypeScript / Firestore Shape for Upgraded Blank

```ts
// New types (add to firestore.ts or blanks types file)

export type RPBlankColorFamily = "light" | "dark";

export interface RPBlankShopifyDefaults {
  productType?: string | null;
  vendor?: string | null;
  productCategory?: string | null;
  collectionHandles?: string[] | null;
}

export interface RPBlankDefaultPricing {
  basePrice?: number | null;       // e.g. cents
  compareAtPrice?: number | null;
  currencyCode?: string | null;   // e.g. "USD"
}

export interface RPBlankDefaultShipping {
  defaultWeightGrams?: number | null;
  requiresShipping?: boolean | null;
}

export interface RPBlankRenderDefaults {
  blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null;
  blendOpacity?: number | null;
  front?: { blendMode?: string | null; blendOpacity?: number | null } | null;
  back?: { blendMode?: string | null; blendOpacity?: number | null } | null;
}

// RPBlank: add these optional fields to the existing interface

export interface RPBlank {
  // ---------- existing fields unchanged ----------
  blankId: string;
  slug: string;
  status: RPBlankStatus;
  supplier: RPBlankSupplier;
  garmentCategory: RPBlankGarmentCategory;
  styleCode: RPBlankStyleCode;
  styleName: string;
  supplierUrl: string;
  supplierSku?: string;
  colorName: RPBlankColorName;
  colorHex?: string;
  images: { front: RPImageRef | null; back: RPImageRef | null };
  imageMeta?: RPImageMeta;
  placements: RPPlacement[];
  tags: string[];
  searchKeywords: string[];
  createdAt: Timestamp;
  createdBy: RPUserRef;
  updatedAt: Timestamp;
  updatedBy: RPUserRef;

  // ---------- Phase 1 new fields (all optional) ----------

  /** Drives design asset choice: lightPng vs darkPng. Derive from colorName if missing. */
  colorFamily?: RPBlankColorFamily | null;

  /** Shopify product type, vendor, category, collection handles. */
  shopifyDefaults?: RPBlankShopifyDefaults | null;

  /** Title template with tokens {teamName}, {designName}, {colorName}, etc. */
  titleTemplate?: string | null;

  /** Description template (plain or HTML). */
  descriptionTemplate?: string | null;

  /** Tag templates; each string may contain tokens; resolved to product.tags. */
  tagTemplates?: string[] | null;

  /** Default price/compare-at/currency for products created from this blank. */
  defaultPricing?: RPBlankDefaultPricing | null;

  /** Default weight and requiresShipping for products created from this blank. */
  defaultShipping?: RPBlankDefaultShipping | null;

  /** Default blend mode/opacity for design-on-blank; products can override. */
  renderDefaults?: RPBlankRenderDefaults | null;

  /** Optional operator notes for placement (e.g. "Use front_center for main art"). */
  placementNotes?: string | null;
}
```

**Firestore:** Same collection `rp_blanks`. New fields are optional; existing documents remain valid. No migration of existing docs required for Phase 1; migration can backfill `colorFamily` from `colorName` in a separate pass if desired.

---

## 7. Implementation Order Within Phase 1

### Step 1 — Schema and ownership (no UI)

1. **Types:** Add `RPBlankColorFamily`, `RPBlankShopifyDefaults`, `RPBlankDefaultPricing`, `RPBlankDefaultShipping`, `RPBlankRenderDefaults` and extend `RPBlank` with the new optional fields in `lib/types/firestore.ts`.  
2. **Color family:** Add `deriveColorFamily(colorName: RPBlankColorName): RPBlankColorFamily` (and optionally a mapping table). Use it wherever the renderer or product flow needs colorFamily (e.g. `blank.colorFamily ?? deriveColorFamily(blank.colorName)`).  
3. **Placement ownership:** Document in code/comments that Blank.placements is canonical; mark Design.placementDefaults as advisory/deprecated in types and in the one place that reads it (e.g. mock or generation). Prefer Blank.placements when Blank has a matching placementId.  
4. **Templates:** Add `resolveBlankTemplates(blank, context)` in `lib/blanks/` (or similar) with token replacement; unit-test with sample templates.  
5. **Product creation (Cloud Function):** In `createProductFromDesignBlank`, when building the new product:
   - Set `product.colorway` from blank.colorName/colorHex (already partially there).
   - Copy `blank.defaultPricing` → `product.pricing` if present.
   - Copy `blank.defaultShipping` → `product.shipping` if present.
   - Copy `blank.shopifyDefaults` to product (productType, vendor, etc.) if present.
   - Copy `blank.renderDefaults` into `product.renderSetup.front` and `.back` (blendMode, blendOpacity) if present.
   - If `blank.titleTemplate` or `descriptionTemplate` or `tagTemplates` exist, call `resolveBlankTemplates(blank, context)` with context from design + blank, and set product.name/title, description, tags from the result.
   - Keep existing fallbacks when Blank has no templates (e.g. current name logic).  
6. **Renderer/mock:** Ensure mock generation uses `blank.colorFamily ?? deriveColorFamily(blank.colorName)` to choose design asset, and uses Blank’s placements and (when no product override) Blank’s renderDefaults.

### Step 2 — Blank detail page structure

7. **Tabs/sections:** Restructure Blank detail page into the sections listed in §3 (Overview, Images/Views, Placement, Rendering, Shopify Defaults, Templates, Pricing/Weight, Eligibility placeholder, Linked Products). Use existing Overview/Images/Placements/Masks content where it fits; add new tabs/sections for Shopify Defaults, Templates, Pricing/Weight, Linked Products.  
8. **Overview:** Add display and edit for `colorFamily` (dropdown or derived display with override).  
9. **Placement:** Ensure Placement tab only edits Blank.placements (no Design placement here).  
10. **Rendering:** New section/tab for `renderDefaults` (blend mode, opacity; optional per-view). Keep Masks here or under same “Rendering” concept.  
11. **Shopify Defaults:** Form for `shopifyDefaults` (productType, vendor, productCategory, collectionHandles).  
12. **Templates:** Form for `titleTemplate`, `descriptionTemplate`, `tagTemplates`; show token reference; optional “Preview” with sample context.  
13. **Pricing/Weight:** Form for `defaultPricing` and `defaultShipping`.  
14. **Linked Products:** Query products where `blankId === blank.blankId`; display list with links (read-only).

### Step 3 — UI behavior and polish

15. **Blank list:** Optionally show a column or badge for “has defaults” (e.g. has titleTemplate or defaultPricing) so operators see which blanks are “configured.”  
16. **Product create flow:** In the “Create product from Design + Blank” flow, after selection, show a short summary: “This product will use [Blank]’s defaults: title from template, price $X, weight Y g” when Blank has those set.  
17. **Validation:** Optional: validate token syntax in templates (e.g. known tokens only); warn on unknown `{foo}`.  
18. **Docs:** Add a short internal doc or comment listing tokens and that Blank is the source of truth for placement and product defaults.

---

## 8. Team Unification (Brief)

**Recommendation:** Unify on **design_teams** as the single Team source for the app (Design Library, Catalog, and future Product “team” display). Rationale: design_teams already has league, city, state, teamName, and is used by the Design flow; Teams page and Catalog can be switched to read/write design_teams and treat “leagues” as either a separate collection or derived from design_teams. Alternative is to make **teams** canonical and add state/teamName to it, then point Design at teams — either way, one list. Prefer **design_teams** so that Design Library does not need a migration of team IDs. Implementation: (1) Add design_teams (or teams) to Catalog and Teams page; (2) Deprecate or alias the other collection; (3) Ensure product creation and product detail can resolve “team name” from the chosen store. Do **not** block Phase 1 Blank work on this; do Team unification in a separate, follow-up phase.

---

## Summary

| Deliverable | Content |
|-------------|---------|
| **New Blank fields** | colorFamily; shopifyDefaults; titleTemplate, descriptionTemplate, tagTemplates; defaultPricing; defaultShipping; renderDefaults; placementNotes (optional). Placement authority = existing placements array. |
| **Product** | Keeps all current fields; receives **initial** values from Blank at creation (templates resolved, defaults copied). Overrides stay on Product. |
| **Design** | placementDefaults deprecated for new use / advisory only; all other fields unchanged. |
| **Blank detail page** | Overview, Images/Views, Placement, Rendering, Shopify Defaults, Templates, Pricing/Weight, (Eligibility), Linked Products. |
| **Templating** | Tokens: teamName, designName, colorName, garmentStyle, category, vendor. Resolution at product creation (and optional “apply defaults”). |
| **Interactions** | Blank ↔ Design: no FK; renderer uses blank.colorFamily to pick design asset. Blank ↔ Product: product.blankId; product gets defaults from Blank at create. Blank ↔ Team: no FK; team name for templates comes from Design/context. |
| **Implementation order** | 1) Schema + derive colorFamily + placement ownership + resolveBlankTemplates + product creation + renderer; 2) Blank detail structure and new tabs/forms; 3) List polish, product-create summary, validation, docs. |
