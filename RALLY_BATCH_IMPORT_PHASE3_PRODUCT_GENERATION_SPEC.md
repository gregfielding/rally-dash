# RALLY_BATCH_IMPORT_PHASE3_PRODUCT_GENERATION_SPEC.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define Phase 3 of the Batch Design Import workflow: optional product generation from imported designs.

---

# 1. Goal

After designs are successfully batch-imported, Rally should optionally generate products from those imported designs.

This phase should:

- use already-imported design records
- allow the user to choose one or more blanks
- create Rally product records
- map imported designs to the correct front/back fields
- initialize `renderSetup.front` / `renderSetup.back`
- avoid duplicate product creation

This phase should **not** yet perform rendering automatically unless explicitly added later.

---

# 2. Scope

## In scope
- optional product generation after import
- blank selection
- side-aware design assignment
- product title / handle generation
- renderSetup initialization
- duplicate detection for products

## Out of scope
- batch rendering
- Shopify sync
- order / printer flows
- advanced merchandising templates
- variant creation UI beyond a minimal default if needed

---

# 3. Inputs

Phase 3 starts from grouped imported design rows that have already created or updated Rally design records.

Each imported design row provides at least:

```ts
{
  designId: string,
  importKey: string,
  leagueCode: string,
  designFamily: string,
  teamCode: string,
  teamName?: string | null,
  side: "FRONT" | "BACK",
  variant: string,
  files: {
    png?: string | null,
    svg?: string | null,
    pdf?: string | null
  }
}
```

User-supplied inputs:

- Generate products? yes/no
- Selected blank(s)
- Product status to create as:
  - draft
  - approved
- Optional title template / handle template later

---

# 4. Product Generation Philosophy

Products should be generated deterministically.

The importer should not blindly create a new product for every design row.

Instead, it should:

1. determine the intended product identity
2. check whether a product already exists for that identity
3. update the existing product if appropriate
4. otherwise create a new product

This is critical because FRONT and BACK imports for the same design family + blank may belong to the same product.

---

# 5. Product Identity / Deduplication Rule

Use a product identity key derived from:

```text
leagueCode + designFamily + teamCode + blankId + variant
```

Example:

```text
MLB_WILL_DROP_FOR_GIANTS_blank_heather_grey_LIGHT
```

This means:

- FRONT import and BACK import can converge onto the same product
- repeated imports do not create duplicate products
- one product can have both `designIdFront` and `designIdBack`

## Important
Side should **not** be part of the product identity key.

Side determines whether the imported design maps to:
- `designIdFront`
- `designIdBack`

but not whether a new product is created.

---

# 6. Product Mapping Rules

## If imported design side = FRONT

Set/update:

```ts
product.designIdFront = designId
product.renderSetup.front = {
  designAssetId: designId,
  designAssetUrl: designPngUrl,
  blankAssetId: selectedBlank front asset id if available,
  blankImageUrl: selectedBlank front image url,
  placementKey: "front_print" or blank default,
  blendMode: blank placement default,
  blendOpacity: blank placement default
}
```

## If imported design side = BACK

Set/update:

```ts
product.designIdBack = designId
product.renderSetup.back = {
  designAssetId: designId,
  designAssetUrl: designPngUrl,
  blankAssetId: selectedBlank back asset id if available,
  blankImageUrl: selectedBlank back image url,
  placementKey: "back_print" or blank default,
  blendMode: blank placement default,
  blendOpacity: blank placement default
}
```

## Blank defaults
Also set:

```ts
product.blankId = selectedBlank.id
product.renderSetup.defaults.blankId = selectedBlank.id
```

---

# 7. Product Title and Handle Generation

Product generation must produce consistent merchandising fields.

## Title template

Recommended default title pattern:

```text
{Design Family Humanized} {Team Humanized} – {Blank Name}
```

Example:

```text
Will Drop For Giants – Heather Grey Bikini Panty
```

## Handle template

Recommended default handle pattern:

```text
{design-family}-{team}-{blank-slug}
```

Example:

```text
will-drop-for-giants-heather-grey-bikini-panty
```

## Humanization rules

Examples:

```text
WILL_DROP_FOR → Will Drop For
GIANTS → Giants
HEATHER_GREY_BIKINI → Heather Grey Bikini
```

Cursor can start with a simple token-humanization helper.

---

# 8. Product Fields to Initialize

When a product is created from an imported design, initialize at minimum:

```ts
{
  title,
  handle,
  blankId,
  designIdFront?: string | null,
  designIdBack?: string | null,
  tags: [
    `league:${leagueCode.toLowerCase()}`,
    `team:${teamCode.toLowerCase()}`,
    `family:${designFamily.toLowerCase()}`,
    `variant:${variant.toLowerCase()}`
  ],
  status: selectedStatus, // draft or approved
  renderSetup: {
    front?: ...,
    back?: ...,
    defaults: {
      blankId: selectedBlank.id,
      designIdFront?: ...,
      designIdBack?: ...
    }
  },
  media: {
    heroFront: null,
    heroBack: null,
    gallery: []
  },
  production: {
    printPdfFront?: imported FRONT pdf if applicable,
    printPdfBack?: imported BACK pdf if applicable
  },
  shopify: {
    status: "not_synced"
  }
}
```

---

# 9. PDF Mapping Rules

If the imported design has a PDF:

## FRONT import
Set:

```ts
product.production.printPdfFront = design.files.pdf
```

## BACK import
Set:

```ts
product.production.printPdfBack = design.files.pdf
```

If the product already exists and only one side is present, update the missing side only.

Do not overwrite an existing PDF with null.

---

# 10. UI / Workflow

After Phase 2 import results, add an optional “Generate products” step.

## Import Results screen additions

For successful imported designs:

- checkbox per grouped design row
- bulk select
- selected blank dropdown
- selected status (draft / approved)
- Generate Products button

## Optional later enhancement
Support grouping imported FRONT and BACK rows before generation so the user sees:

```text
WILL_DROP_FOR / GIANTS / LIGHT
  FRONT imported
  BACK imported
```

But this is not required for MVP if deduplication is handled correctly.

---

# 11. Product Generation Algorithm

Recommended flow:

```text
for each selected imported design row:
  derive productIdentityKey from league + family + team + blank + variant
  lookup existing product by productIdentityKey

  if no product exists:
     create new product with blankId and design side fields

  if product exists:
     update product for the imported side only

  if side == FRONT:
     set designIdFront + renderSetup.front
     set printPdfFront if pdf exists

  if side == BACK:
     set designIdBack + renderSetup.back
     set printPdfBack if pdf exists
```

## Important
Never erase the opposite side if it already exists.

Example:
- importing BACK should not clear FRONT
- importing FRONT should not clear BACK

---

# 12. Suggested New Product Field

To support deterministic product deduplication, add:

```ts
productIdentityKey?: string | null
```

Example value:

```text
MLB_WILL_DROP_FOR_GIANTS_blank_heather_grey_LIGHT
```

This makes product lookup much simpler and safer during batch generation.

---

# 13. Error Handling

Common errors to handle:

- selected blank missing
- imported design missing PNG
- imported design missing team mapping
- duplicate products with same identity key
- Firestore write failure
- invalid handle collision

UI should show:
- created count
- updated count
- skipped count
- errors with links to product or design rows

---

# 14. MVP Implementation Order

## Step 1
Add product identity key logic.

## Step 2
Add “Generate products” controls to the batch import results screen.

## Step 3
Create/update products from imported design rows.

## Step 4
Initialize `renderSetup.front` / `renderSetup.back`.

## Step 5
Store PDF refs and basic merchandising fields.

## Step 6
Show links to generated products in results.

---

# 15. Success Criteria

Phase 3 is successful when a user can:

1. Batch import design files
2. Select a blank
3. Generate products from imported designs
4. Have FRONT imports populate `designIdFront` / `renderSetup.front`
5. Have BACK imports populate `designIdBack` / `renderSetup.back`
6. Avoid duplicate products
7. See created/updated products linked in the results view

Example ideal result:

```text
Imported 20 grouped designs
Selected blank: Heather Grey Bikini
Generated 10 products
- 10 BACK designs mapped
- 10 FRONT designs mapped
- existing products updated where applicable
```

---

# 16. Final Directive for Cursor

Please implement Phase 3 as **optional product generation from imported designs**, not rendering yet.

Critical rules:

- deduplicate by product identity, not by side
- FRONT and BACK imports should map onto the same product
- initialize `renderSetup.front` / `renderSetup.back`
- do not erase existing side data
- populate PDFs and basic merchandising fields
- keep rendering and Shopify sync out of this slice

This will turn batch-imported designs into structured Rally products and prepare them for deterministic hero rendering later.

---

# End of Spec
