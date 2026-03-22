# Rally — Generated Product Model & Creation Flow (Spec v1)

**Status:** Implementation spec / audit (non-code).  
**Scope:** Aligns **Generated Product** (`rp_products`) with **master blank + variants**, **design (light/dark assets)**, and **team** context.  
**Out of scope for this doc:** Parser, bulk generation implementation, dashboard visual redesign.

---

## 1. What a Generated Product owns

A **Generated Product** is the durable commerce/render record for one logical SKU line: **one team + one design + one master blank + one blank variant** (for schema v2). It should own everything needed to list, render, sync, and audit without re-walking upstream docs on every read—while still pointing to authoritative sources via FKs.

### 1.1 Identity & routing
| Area | Owns |
|------|------|
| **IDs** | Firestore doc id, stable internal `productId` usage |
| **Routing** | `slug`, optional `handle` (Shopify-aligned) |
| **Human labels** | `name`, `title` (display); may start as resolved templates, editable later |

### 1.2 Foreign keys (source of truth links)
| Field | Meaning |
|-------|---------|
| `blankId` | Master blank (style document in `rp_blanks`) |
| `blankVariantId` | Variant id **within** that blank (`variants[].variantId`) when using master model; null/omit only for **legacy** color-per-doc blanks |
| `designId` | Primary design (`designs/{id}`); front/back splits via `designIdFront` / `designIdBack` when needed |
| `teamCode` (and related taxonomy) | Denormalized from team/taxonomy for filters and Shopify |

### 1.3 Uniqueness & deduplication
- **Business rule:** At most **one** generated product per **(teamCode, designId, blankId, blankVariantId)** for master blanks (variant distinguishes color).
- **Recommended canonical key:** `productIdentityKey` (or successor) encoding those four dimensions in a stable, documented string format (existing batch-import key can coexist; document precedence).
- **Legacy:** If `blankVariantId` is absent, treat **(teamCode, designId, blankId)** as unique (implicit single color on blank doc).

### 1.4 Resolved merchandising snapshot (product-owned)
Stored on the product so Shopify and UI do not depend on live template resolution for historical rows:
- **Copy:** `description` / `descriptionText` / `descriptionHtml`, `seo`, `tags` / `tagsNormalized`
- **Merch defaults:** `brand`, `productType`, `collectionKeys` (as applicable)
- **Pricing / shipping:** `pricing`, `shipping` (from blank at creation; overridable)
- **Color presentation:** `colorway.name`, `colorway.hex` (from **variant** at creation)

### 1.5 Render & media (product-owned)
- **Canonical:** `renderSetup` (per-side blank URL, design asset URL, placement, blend, mask)
- **Outputs:** `media.*` (hero front/back, gallery), `mockupUrl` / legacy hero fields as bridged
- **Optional:** `production.*` (print PDFs, notes)
- **MVP render storage:** Product owns current primary render/media URLs **directly on the product document**. No required render subcollection for MVP; a render subcollection can be added later if needed.

### 1.6 Workflow & integration
- **Lifecycle:** `status` (`draft` | `active` | `archived`)
- **Shopify:** `shopify.{ productId, variantId, status, lastSyncAt, lastSyncError }` (see §7)
- **AI / LoRA (if used):** `ai.*` triggers and links
- **Provenance:** `generatedFromImportKey` / import metadata when applicable (batch path; not required for manual create)

### 1.7 Audit
- `createdAt`, `updatedAt`, `createdBy`, `updatedBy`
- Optional future: `lastInheritedBlankVersion`, `lastInheritedDesignUpdatedAt` for propagation policies (§5–6)

---

## 2. What the product inherits (conceptual matrix)

“Inherits” means: **default source** for creation-time resolution and/or **ongoing pull** where policy says so. The product **stores a snapshot** for most customer-facing fields; inheritance rules define **when** to refresh.

### 2.1 From **Master Blank** (`blankId` → `rp_blanks` schema v2)
| Data | Typical use |
|------|-------------|
| Style identity | `styleCode`, `styleName`, `garmentStyle`, `category` → taxonomy / copy tokens |
| **Templates** | `titleTemplate`, `descriptionTemplate`, `tagTemplates` → resolved at creation |
| **Pricing / weight** | `defaultPricing`, `defaultShipping` → `pricing`, `shipping` on product |
| **Shopify defaults** | `shopifyDefaults` (product type, brand, collections) → product fields |
| **Placement** | `placements[]` → default `placementKey` + normalized x/y/scale in `renderSetup` / job input |
| **Rendering** | `renderDefaults` (+ optional variant overrides) → blend mode/opacity defaults |
| **Sourcing (style-level)** | Supplier/style URL notes → optional denorm on `supplier` or internal only |

### 2.2 From **Blank Variant** (`blankId` + `blankVariantId`)
| Data | Typical use |
|------|-------------|
| **Color** | `colorName`, `colorHex`, `colorFamily` → `colorway`, template token `{colorName}`, garment context for light vs dark design asset choice |
| **Images** | `images.front` / `back` / `detail` → `renderSetup.*.blankImageUrl` at creation (and when refreshed) |
| **Vendor SKU / color codes** | Optional denorm for production/Shopify variant SKU |
| **Render overrides** | Variant-level blend → merge over blank `renderDefaults` for that side |

### 2.3 From **Design** (`designId` / `designIdFront` / `designIdBack`)
| Data | Typical use |
|------|-------------|
| **Artwork** | `assets.*` / `files.*` — **light** vs **dark** PNG (and SVG/PDF for production) |
| **Design metadata** | `name`, `designType`, `designFamily`, taxonomy fields → tokens and filters |
| **Placement advisory** | `placementDefaults` — **fallback only** if blank has no placement; blank is canonical |

### 2.4 From **Team** (via `design.teamId` → `design_teams` / team cache on design)
| Data | Typical use |
|------|-------------|
| **Copy tokens** | `{teamName}`, `{city}`, `{league}`, `{stadiumName}`, `{teamSaying}`, `{fanPhrase}` |
| **Taxonomy** | `teamCode`, `leagueCode`, sport, etc. → `rp_products` taxonomy fields |
| **Brand voice** | Indirect (tags, future collections)—usually not a separate doc on product except denorm |

---

## 3. Fields resolved at creation time

**Principle:** Creation produces a **consistent snapshot** so the product is inspectable and syncable even if upstream edits later.

**Resolve and persist on create (or first “materialize”):**
- **FKs:** `blankId`, `blankVariantId` (v2), `designId` (+ front/back if split)
- **Colorway:** from variant (`colorName`, `colorHex`)
- **Title / description / tags:** from blank templates + team/design/variant context (`{colorName}`, `{garmentStyle}`, `{brand}`, etc.)
- **Merch:** `brand`, `productType`, `collectionKeys` from blank `shopifyDefaults` (and policy)
- **Pricing / shipping:** from blank `defaultPricing` / `defaultShipping` (currency rules as product policy)
- **Taxonomy:** `teamCode`, `leagueCode`, … from team/design as defined by Rally taxonomy spec
- **Render setup (initial):** blank image URLs from **variant** for each side; design asset URLs chosen by **colorFamily** (light vs dark garment) + supported sides; placement from blank `placements` for chosen `placementKey`; blend defaults from blank + variant overrides
- **Identity:** `slug` / `handle` generation rules; `productIdentityKey` if used
- **`baseProductKey`:** generation rule (e.g. team + style family) — document explicitly to avoid drift

**Do not require re-query of blank/design for read paths** for core merchandising once set (unless running an explicit “refresh from sources” action).

---

## 4. Fields that can be overridden later

**Principle:** Separate **“snapshot from source”** from **“operator intent”** where possible (future: `overrides` object; until then, implicit “last write wins” on product).

**Commonly overridden on the product (without changing blank/design):**
- **Copy:** `title`, `name`, `description*`, `seo`, `tags` (with guardrails if tags are supposed to be generated-only)
- **Pricing / shipping:** `pricing`, `shipping`
- **Placement / render:** `renderSetup.*.placementOverride`, per-side `blendMode` / `blendOpacity`, `maskUrl`
- **Media:** `media.*` heroes, gallery ordering
- **Production:** `production.*` PDFs, notes
- **Status:** `draft` → `active` → `archived`

**Should not be casually overridden (treat as structural):**
- `blankId`, `blankVariantId`, `designId` — changing these effectively defines a **different** product; prefer archive + new product unless explicit “relink” workflow with audit log.

---

## 5. How master blank updates should affect linked products

**Recommended default policy: snapshot + optional refresh (no silent auto-mutation).**

| Change on blank | Suggested behavior |
|-----------------|-------------------|
| **Templates / Shopify defaults / pricing** | **Do not auto-push** to existing products. Offer **“Apply blank defaults to linked products”** (batch, scoped, preview). |
| **Placements / render defaults** | **Do not auto-change** live `renderSetup` on all products. Optional: **“Reset placement from blank”** per product or batch; warn if product has `placementOverride`. |
| **Variant images** | Products keep URLs until **regenerate mockup** or **“Refresh blank images from variant”** job. |
| **New variant added** | Does not create products automatically (bulk generator will). |
| **Blank archived** | Block **new** generation from this blank; existing products unchanged; Shopify sync policy = business rule (usually allow updates until manually archived). |

**Rationale:** Shopify listings and approved art are contractual; silent inheritance breaks audit and compliance.

**Optional future:** `blank.version` bumped on meaningful change; products store `materializedFromBlankVersion` to detect staleness in UI (“Blank updated since last sync”).

---

## 6. How design updates should affect linked products

| Change on design | Suggested behavior |
|------------------|-------------------|
| **New light/dark PNG** | **Do not auto-replace** `renderSetup` URLs on all products. Show **stale asset** badge; actions: **Refresh design assets** / **Regenerate mockup**. |
| **SVG/PDF production files** | Optional auto-attach only if product has no locked `production.*`; otherwise notify + manual refresh. |
| **Design name / taxonomy** | Optional **lightweight denorm refresh** (title tokens) — only if product titles are defined as “always derived”; if titles are hand-edited, skip or prompt. |
| **Design archived** | Prevent **new** products using it; existing products: warn on sync; do not hard-delete. |

**Rationale:** Same as blank—published storefronts need predictable behavior.

---

## 7. How Shopify sync state should be tracked

### 7.1 On the product document (`shopify`)
- **`status`:** `not_synced` | `queued` | `synced` | `error`
- **`productId` / `variantId`:** remote IDs after successful push
- **`lastSyncAt` / `lastSyncError`:** diagnostics

**Rules:**
- Set `queued` when a sync job is enqueued; worker moves to `synced` or `error`.
- On product edits that matter to Shopify, either bump to `not_synced` or auto-queue (product policy); document which fields trigger re-queue.

### 7.2 Job queue (`shopifySyncJobs` or equivalent)
- Per-job: `entityId` = product id, `status`, timestamps, error payload
- Supports retries and admin visibility without overloading the product doc

### 7.3 Variant granularity
- One Shopify **product** may map to one Rally product with one **color variant** (current model); `shopify.variantId` aligns with **blank variant**–driven SKU/color.
- If future many-SKU Shopify products exist, document mapping table; until then, **1 Rally product : 1 primary Shopify variant** is the simple rule.

---

## 8. Recommended Generated Product detail page sections / tabs

Order can vary; group by operator mental model.

1. **Overview** — Status, identity key, team, design, blank (style), **variant** (color), created/updated, quick links.
2. **Merchandising** — Title, description, SEO, tags (with “reset from templates” if implemented), brand, product type, collections.
3. **Pricing & fulfillment** — Retail, cost (if stored), weight, shipping flags; compare to blank defaults.
4. **Blank & variant** — Read-only FKs + **live preview** of master blank + selected variant metadata; deep links to blank detail.
5. **Design** — Design summary, light/dark asset thumbs, link to design detail; **asset refresh** action.
6. **Placement & render** — Side tabs (front/back): placement picker, overrides, blend, mask; **open in** full mockup editor if exists.
7. **Media** — Heroes, gallery, generated mockups; regenerate actions.
8. **Production** — PDFs, print colors, notes.
9. **Shopify** — Sync status, last error, IDs, **Push / Update** / **View in Shopify**; job history snippet.
10. **Activity / audit** (future) — Inheritance refresh events, sync attempts, who changed overrides.

---

## 9. Recommended Products Library columns

**Default visible (library table):**
| Column | Source |
|--------|--------|
| **Thumbnail** | Hero or latest mockup |
| **Title** | `title` or `name` |
| **Team** | `teamCode` or denorm display name |
| **Design** | `designId` + cached design name (denorm or lookup) |
| **Style** | From blank: `styleCode` / `styleName` (denorm or join) |
| **Color** | `colorway.name` + optional swatch from `colorway.hex` |
| **Blank variant** | `blankVariantId` (short id or color label) |
| **Status** | `status` |
| **Shopify** | `shopify.status` |
| **Updated** | `updatedAt` |

**Optional / column picker:**
- `productIdentityKey`
- `leagueCode`
- Staleness flags (“blank updated”, “design asset updated”) when version fields exist

---

## 10. How `blankVariantId` should be used consistently

### 10.1 Meaning
- **`blankVariantId`** is the stable id of an element in **`rp_blanks/{blankId}.variants[]`** for **schemaVersion === 2** master blanks.
- It is **not** the Shopify variant id (that lives under `shopify.variantId`).

### 10.2 Required vs optional
| Context | Rule |
|---------|------|
| **Create product (master blank)** | **Required** when the blank has one or more variants (current Cloud Function behavior). |
| **Legacy blank** (single color on doc) | Omit or null; color comes from blank root / synthetic legacy variant in code paths. |

### 10.3 Flow touchpoints (consistency checklist)
- **Product create UI** — Variant picker; pass `blankVariantId` into callable alongside `blankId` + `designId`.
- **Server create** — Validate variant exists and `isActive`; resolve color, images, template `colorName`, pricing; persist `blankVariantId` on `rp_products`.
- **Queries / indexes** — Filter “products for this blank” by `blankId`; filter “products for this color line” by `blankId` + `blankVariantId`.
- **Shopify SKU / options** — Map Rally `blankVariantId` or vendor SKU to Shopify variant metadata in sync worker (document single source of truth for SKU string).
- **Shopify storefront gallery** — When the shopper selects a color (e.g. Heather Grey), the listing should show **media from the Rally product** tied to that color: same row as `blankId` + **`blankVariantId`**. Source blank mockups live on `rp_blanks.variants[].images`; generated heroes/gallery live on **`rp_products.media`** (and related render fields). Do not use master style–level images for per-color galleries on v2 masters (see `RALLY_MASTER_BLANK_SCHEMA.md` § Storefront).
- **Linked products tab (blank detail)** — Show `blankVariantId` and color for each row (already aligned).
- **Bulk generation (future)** — Iterate `(design × team × blankVariant)` with same FK pair.
- **Analytics / dedupe** — Include `blankVariantId` in `productIdentityKey` for master blanks.

### 10.4 Relinking / data integrity
- If a variant is **removed** from a blank document, products pointing to that id are **orphaned** — UI should detect missing variant, block sync, and force remap or archive.
- Prefer **deactivate variant** (`isActive: false`) over delete when products exist (matches blank UX rules).

---

## Summary

- **Generated Product** = **owned snapshot** + **FKs** to master blank, **blank variant**, design, and team context—optimized for **one product per (team, design, blank, variant)** under v2.
- **Create** resolves templates, colorway, merch, pricing, and initial `renderSetup` from blank + variant + design + team.
- **Upstream changes** to blank/design should **not silently rewrite** live products; use **staleness signals** and explicit **refresh/regenerate** actions.
- **Shopify** state lives on the product plus a **job queue** for retries and visibility.
- **`blankVariantId`** is the **linchpin** for color/SKU/image alignment across creation, library, sync, and future bulk generation.

---

## Spec refinement (pre-implementation)

The following three areas are **locked** before implementation: canonical identity key, denormalized field list, and version/staleness + edit policies.

---

### Refinement 1: `productIdentityKey` — canonical format

**Purpose:** Deterministic, unique-per-product key for dedupe, bulk generation, and analytics. One product per `(teamCode, designId, blankId, blankVariantId)` for v2; legacy uses three-tuple.

**Canonical format (string):**

```
{leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantIdOrLegacy}
```

**Rules:**

| Part | Source | Normalization |
|------|--------|---------------|
| `leagueCode` | Team/design taxonomy (e.g. `leagueCode` on product or design) | Uppercase, alphanumeric + underscore; empty → `_` or omit per rule below |
| `teamCode` | `teamCode` on product (from design/team) | Uppercase, alphanumeric; required |
| `designId` | `designId` (Firestore doc id) | As-is (ids are already stable) |
| `blankId` | `blankId` (Firestore doc id) | As-is |
| `blankVariantIdOrLegacy` | `blankVariantId` when present, else single sentinel for legacy | When `blankVariantId` is set: use as-is. When null/omit (legacy single-color blank): use literal `legacy` |

**Full pattern:**

- **Master blank (v2):**  
  `{leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantId}`  
  Example: `MLB_GIANTS_abc123_def456_v_xyz789`

- **Legacy (no variant):**  
  `{leagueCode}_{teamCode}_{designId}_{blankId}_legacy`  
  Example: `MLB_GIANTS_abc123_def456_legacy`

**Uniqueness:** Two products with the same `productIdentityKey` are considered the same logical SKU; bulk generation and imports must **upsert by this key** (create or update existing).

**Generation:** Set at **creation time** only. Do not change when product is edited (copy, price, etc.); changing `blankId` / `designId` / `blankVariantId` / `teamCode` means a **different** product (archive + create with new key).

**Optional:** If `leagueCode` is missing at create, use `_` or a reserved token (e.g. `UNK`) so the key is still valid and sortable; document in code.

---

### Refinement 2: Denormalized fields — explicit list

**Principle:** At creation we write a **resolved snapshot** onto the product. Distinguish **source lineage** (pointers for refresh/audit) from **resolved product fields** (what the product “is” for display, sync, and queries).

#### 2.1 Source lineage (FKs + version refs; do not use for display)

| Field | Type | Meaning |
|-------|------|---------|
| `blankId` | string | Master blank doc id |
| `blankVariantId` | string \| null | Variant id within blank (v2); null = legacy |
| `designId` | string | Primary design doc id |
| `designIdFront` | string \| null | Optional front design id |
| `designIdBack` | string \| null | Optional back design id |
| `teamCode` | string \| null | From team/taxonomy (for identity key + filters) |
| `productIdentityKey` | string \| null | Canonical key per Refinement 1 |
| `blankVersionUsed` | number \| null | See Refinement 3 |
| `designVersionUsed` | number \| Timestamp \| null | See Refinement 3 |

These are **not** re-resolved on every read; they are written at create (and optionally on “refresh from source”).

#### 2.2 Resolved product fields (copied at creation; used for library, Shopify, persistence)

**Copy & merchandising (from templates + context):**

| Field | Source at create |
|-------|-------------------|
| `name` | Resolved title (or fallback from template) |
| `title` | Resolved title |
| `description`, `descriptionText`, `descriptionHtml` | Resolved description |
| `seo.title`, `seo.description` | Resolved or default |
| `tags`, `tagsNormalized` | Resolved tag list + normalized for search |

**Merch & taxonomy (from blank + design/team):**

| Field | Source at create |
|-------|-------------------|
| `brand` | Blank `shopifyDefaults.brand` |
| `productType` | Blank `shopifyDefaults.productType` |
| `collectionKeys` | Blank `shopifyDefaults.collectionHandles` or equivalent |
| `leagueCode`, `sportCode`, `themeCode`, `designFamily`, etc. | Design/team taxonomy |

**Color (from variant only):**

| Field | Source at create |
|-------|-------------------|
| `colorway.name` | Variant `colorName` |
| `colorway.hex` | Variant `colorHex` |

**Pricing & fulfillment (from blank):**

| Field | Source at create |
|-------|-------------------|
| `pricing.basePrice`, `pricing.compareAtPrice`, `pricing.currencyCode` | Blank `defaultPricing` (retail → basePrice) |
| `shipping.defaultWeightGrams`, `shipping.requiresShipping` | Blank `defaultShipping` |

**Render inputs (from blank variant + design assets):**

| Field | Source at create |
|-------|-------------------|
| `renderSetup.front.blankImageUrl`, `renderSetup.back.blankImageUrl` | Variant `images.front` / `back` |
| `renderSetup.front.designAssetUrl`, etc. | Design asset URL by colorFamily (light/dark) |
| `renderSetup.front.placementKey`, placement defaults | Blank `placements` |
| `renderSetup.*.blendMode`, `blendOpacity` | Blank `renderDefaults` + variant `renderOverrides` |

**Library / display helpers (denormalized for fast lists):**

| Field | Source at create | Purpose |
|-------|-------------------|--------|
| `baseProductKey` | e.g. `{teamCode}_{categoryOrStyle}` (document rule) | Grouping / filters |
| Design name cache | Design `name` | Product detail / list without join |
| Style cache | Blank `styleCode` / `styleName` | List column “Style” without join |

**Implementation note:** Add explicit “designNameCache”, “styleCodeCache”, “styleNameCache” (or equivalent) if library queries must avoid joining designs/blanks. Otherwise resolve via FKs and document.

**Summary:**  
- **Lineage** = identity + where it came from + version refs.  
- **Resolved** = everything needed to show, sync to Shopify, and re-render without reading blank/design again (until refresh/regenerate).

---

### Refinement 3: Staleness / version fields and edit policies

#### 3.1 Version fields on Generated Product

| Field | Type | Meaning |
|-------|------|---------|
| `blankVersionUsed` | number \| null | Value of `blank.version` (or `blank.updatedAt` as number) at the time we last materialized from this blank. |
| `designVersionUsed` | number \| Timestamp \| null | Value of `design.updatedAt` (or a `design.version` if added) at the time we last pulled design assets/metadata. |

**Blank document:** Add or use a monotonic `version` (number) on `rp_blanks`, incremented when any of the following change: templates, shopifyDefaults, defaultPricing, defaultShipping, placements, renderDefaults, sourcing (style-level). Optionally also bump when `variants[]` (e.g. variant images or eligibility) change. If no `version` exists, use `updatedAt` (Firestore Timestamp) for comparison.

**Design document:** Use `design.updatedAt` as the design “version” for staleness; optionally add `design.version` later for finer control.

#### 3.2 Derived staleness (computed when displaying product)

| Concept | Derivation |
|---------|------------|
| **isBlankStale** | `blankVersionUsed != null` and current `blank.version` (or `blank.updatedAt`) &gt; `blankVersionUsed`. If blank has no `version`, compare `blank.updatedAt` with `designVersionUsed`-equivalent for blank (e.g. store `blankUpdatedAtUsed` at create). |
| **isDesignStale** | `designVersionUsed != null` and current `design.updatedAt` &gt; `designVersionUsed`. |

**UI:** Show badges “Blank updated” / “Design updated” when stale; offer “Refresh from blank” / “Refresh design assets” / “Regenerate mockup” as appropriate.

#### 3.3 Which edits mark a product stale

**Blank edits that should mark product stale (product’s blank is this blank):**

- Templates (`titleTemplate`, `descriptionTemplate`, `tagTemplates`) changed.
- `shopifyDefaults` (brand, productType, collectionHandles) changed.
- `defaultPricing` or `defaultShipping` changed.
- `placements` or `renderDefaults` changed.
- **Variant** (for this `blankVariantId`): variant `images` (front/back/detail) or `renderOverrides` changed; or variant removed/deactivated.

**Detection:** Blank bumps `version` (or `updatedAt` changes). Product stores `blankVersionUsed`; staleness = (current blank version &gt; blankVersionUsed). No need to write “stale” on the product if we can derive it on read.

**Design edits that should mark product stale (product’s design is this design):**

- Design `assets` / `files` (lightPng, darkPng, etc.) changed (new upload or replace).
- `design.updatedAt` changes (or design `version` if added).

**Detection:** Product stores `designVersionUsed`; staleness = (current design.updatedAt &gt; designVersionUsed).

#### 3.4 Which edits re-queue Shopify sync

**Re-queue sync (set product `shopify.status` → `not_synced` or enqueue job) when any of these change on the product:**

- **Copy:** `title`, `name`, `description`, `descriptionHtml`, `seo`, `tags`.
- **Merch:** `brand`, `productType`, `collectionKeys` (or equivalent).
- **Pricing:** `pricing.basePrice`, `pricing.compareAtPrice`, `pricing.currencyCode`.
- **Shipping:** `shipping.defaultWeightGrams`, `shipping.requiresShipping`.
- **Color:** `colorway.name`, `colorway.hex` (affects variant title/option in Shopify).
- **Media:** `media.heroFront`, `media.heroBack`, or primary image URLs that are sent to Shopify.

**Do not** auto re-queue for:
- Internal-only fields (e.g. `renderSetup`, `blankVersionUsed`, `designVersionUsed`).
- Status change alone (`draft` → `active`) unless business rule says “publish = sync”.

**Implementation:** On product save (or specific field save), if any “Shopify-relevant” field changed, set `shopify.status = 'not_synced'` and optionally enqueue a sync job.

#### 3.5 Which edits require mockup regeneration

**Require (or strongly recommend) mockup regeneration when:**

- **Blank:** Variant images (`images.front` / `back` / `detail`) for this product’s `blankVariantId` changed.
- **Design:** Design asset URLs (light/dark PNG or equivalent) used for this product changed.
- **Product:** `renderSetup` placement or blend overrides changed; or `designId` / `blankId` / `blankVariantId` changed (relink).

**Detection:** Staleness of blank (variant images) or design (assets) implies “mockup may be out of date”. Product detail UI can show “Regenerate mockup” when `isBlankStale` or `isDesignStale`, or when user changed placement/blend.

**Summary table**

| Event | Mark product stale (blank/design) | Re-queue Shopify sync | Require / suggest mockup regen |
|-------|-----------------------------------|------------------------|----------------------------------|
| Blank: templates, pricing, placements, renderDefaults, shopifyDefaults | Yes (blank) | No (until product refreshed) | No |
| Blank: variant images or renderOverrides for this variant | Yes (blank) | No | Yes |
| Design: asset URLs (PNG, etc.) | Yes (design) | No | Yes |
| Product: copy, pricing, shipping, color, merch, hero media | N/A | Yes | No (unless media changed) |
| Product: placement/blend overrides | N/A | No | Suggest |
| Product: “Refresh from blank” | Clear blank stale (update blankVersionUsed) | Optional (if copy/price changed) | Optional |
| Product: “Refresh design assets” | Clear design stale (update designVersionUsed) | No | Yes (regen mockup) |

---

*End of spec v1 + refinement.*
