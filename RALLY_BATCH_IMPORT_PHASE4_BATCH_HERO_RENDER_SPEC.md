# RALLY_BATCH_IMPORT_PHASE4_BATCH_HERO_RENDER_SPEC.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define Phase 4 of the Batch Design Import workflow: deterministic batch hero render generation from Rally products created in Phase 3.

---

# 1. Goal

After products have been created from imported designs, Rally should optionally generate **deterministic front/back hero renders** in batch.

This phase should:

- use existing Rally product records
- read explicit `renderSetup.front` / `renderSetup.back`
- generate hero renders using the deterministic renderer
- assign resulting assets to `hero_front` / `hero_back`
- avoid duplicate hero asset creation where possible
- prepare products for Shopify sync

This phase should **not** yet:
- generate AI lifestyle scenes
- generate model renders
- sync to Shopify automatically
- publish products automatically

---

# 2. Scope

## In scope
- batch-select products for hero rendering
- choose which side(s) to render
- run deterministic renderer only
- create/update product assets
- assign hero front / hero back slots
- show progress and results

## Out of scope
- AI product scenes
- Amber/model generation
- Shopify sync
- order/production flows
- displacement map realism pass (later)
- batch PDF generation (already handled upstream)

---

# 3. Inputs

Phase 4 starts from Rally products that already exist and already have product-level render configuration.

Each product should have, at minimum:

```ts
{
  id: string,
  blankId: string,
  renderSetup?: {
    front?: {
      blankAssetId?: string | null,
      blankImageUrl?: string | null,
      designAssetId?: string | null,
      designAssetUrl?: string | null,
      placementKey?: string | null,
      placementOverride?: { x: number, y: number, scale: number } | null,
      maskUrl?: string | null,
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null,
      blendOpacity?: number | null
    } | null,
    back?: {
      blankAssetId?: string | null,
      blankImageUrl?: string | null,
      designAssetId?: string | null,
      designAssetUrl?: string | null,
      placementKey?: string | null,
      placementOverride?: { x: number, y: number, scale: number } | null,
      maskUrl?: string | null,
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null,
      blendOpacity?: number | null
    } | null
  }
}
```

User-supplied inputs:

- selected products
- render sides:
  - front only
  - back only
  - both
- overwrite policy:
  - skip if hero already exists
  - regenerate and replace
- optional output status update:
  - leave products unchanged
  - mark products as “rendered” if all selected hero views succeed

---

# 4. Rendering Philosophy

This phase must use the deterministic renderer only.

Pipeline per side:

```text
blank image
→ load design PNG
→ detect/crop artwork bounds
→ scale to placement
→ apply mask (optional)
→ apply blend mode
→ apply opacity
→ export deterministic hero render
```

No diffusion.
No AI.
No scene invention.

The output should match the approved Photoshop-quality flat mockup standard.

---

# 5. Render Eligibility Rules

A product side is eligible for hero rendering only if the required data exists.

## Front hero eligible if:
- `renderSetup.front.blankImageUrl` exists
- `renderSetup.front.designAssetUrl` exists
- `renderSetup.front.placementKey` or `placementOverride` exists

## Back hero eligible if:
- `renderSetup.back.blankImageUrl` exists
- `renderSetup.back.designAssetUrl` exists
- `renderSetup.back.placementKey` or `placementOverride` exists

If not eligible:
- skip the side
- show a validation error in results
- do not fail the whole batch

---

# 6. UI Flow

Recommended entry point:

```text
Products → Batch Hero Render
```

Possible alternative:
- action launched from Batch Import Phase 3 results
- action launched from Products table bulk actions

## Main UI sections
1. Product selection
2. Render options
3. Validation preview
4. Run batch
5. Results

---

# 7. Product Selection

Allow the user to select products by:

- checkbox rows
- filter by blank
- filter by team
- filter by design family
- filter by status
- filter by missing hero front/back

Useful quick filters:
- Missing hero front
- Missing hero back
- Missing both
- Ready to render

---

# 8. Render Options

Controls:

## Sides to render
- Front only
- Back only
- Both

## Existing hero behavior
- Skip sides that already have assigned hero assets
- Regenerate and replace hero asset assignment

## Asset handling
- Create new product assets and assign hero slot
- Reuse existing matching deterministic asset if one already exists (optional later)

## Product status handling
- Do nothing
- Mark as rendered if all requested hero sides succeed

---

# 9. Validation Preview

Before running the batch, show a validation summary.

Per selected product:

- product title
- front ready? yes/no
- back ready? yes/no
- missing fields if not ready

Example columns:

| Product | Front Ready | Back Ready | Missing |
|--------|-------------|------------|---------|
| Giants Heather Grey Bikini | ✓ | ✓ | — |
| Dodgers Heather Grey Bikini | ✗ | ✓ | Front design missing |

This helps catch configuration issues before running renders.

---

# 10. Deterministic Render Job Model

Each requested hero side should become a deterministic render job.

Example job record:

```ts
{
  id: string,
  productId: string,
  side: "front" | "back",
  renderType: "hero_deterministic",
  status: "queued" | "running" | "succeeded" | "failed",
  overwrite: boolean,
  createdAt: Timestamp,
  startedAt?: Timestamp | null,
  finishedAt?: Timestamp | null,
  error?: string | null
}
```

This can be:
- a new collection, or
- a reuse of the existing mock job system with a clearly typed mode

Recommended:
reuse existing deterministic mock pipeline if possible, but add explicit asset-creation behavior for hero slots.

---

# 11. Asset Creation Rules

On successful render, create a new `productAsset` with:

```ts
{
  productId,
  blankId,
  designId,
  side,
  assetType: "productPackshot",
  source: "deterministic_renderer",
  presetMode: "productOnly",
  scenePresetKey: "hero_flat_white",
  fileUrl,
  approved: true,
  heroSlot: side === "front" ? "hero_front" : "hero_back"
}
```

## Then update product.media

If side == front:

```ts
product.media.heroFront = asset.fileUrl
```

If side == back:

```ts
product.media.heroBack = asset.fileUrl
```

## Overwrite behavior
If overwrite = false:
- do not replace existing hero slot
- skip if hero already exists

If overwrite = true:
- create new asset
- assign as hero slot
- old asset remains in asset history unless later cleanup is desired

---

# 12. Duplicate / Idempotency Rules

A batch render run should not create chaos if repeated.

Recommended idempotency logic:

## If overwrite = false
For each product + side:
- if `product.media.heroFront` or `heroBack` already exists, skip
- do not enqueue a new job for that side

## If overwrite = true
- enqueue a new deterministic render job
- create a new asset
- update hero slot assignment

Optional future improvement:
- detect identical render inputs and reuse an existing deterministic asset

---

# 13. Suggested New Asset Metadata

To make deterministic outputs easier to audit, include a render signature.

Suggested optional field on `productAssets`:

```ts
renderSignature?: string | null
```

Example signature inputs:
- blankAssetId or blankImageUrl
- designAssetId or designAssetUrl
- placementKey
- placementOverride
- blendMode
- blendOpacity
- side

This can help future deduplication or cache reuse.

---

# 14. Render Job Algorithm

Recommended flow:

```text
for each selected product:
  for each requested side:
    if side not eligible:
      record validation error
      continue

    if overwrite = false and hero already exists:
      record skipped
      continue

    create deterministic render job
    run renderer using renderSetup.side
    create productAsset
    assign hero slot
    update product.media.heroFront / heroBack
```

Important:
- front and back must be handled independently
- failure on one side should not fail the other side automatically
- failure on one product should not fail the whole batch

---

# 15. UI Results Screen

After running the batch, show a results panel.

Summary example:

```text
Selected 20 products
Requested sides: Back only

15 hero renders created
3 skipped (already had hero back)
2 failed
```

Detailed results table:

- product
- side
- action
- asset created?
- hero assigned?
- link to asset
- error message if failed

Possible action values:
- Created
- Updated
- Skipped existing
- Failed validation
- Failed render

---

# 16. Product Readiness Integration

After hero generation, the existing Product Readiness block should reflect the new status.

Examples:
- if back hero is now present, “Hero back” should become complete
- if both hero front/back are assigned, product may become ready for Shopify sync (assuming other required fields are present)

No extra readiness logic is needed if the product page already reads `product.media.heroFront` / `heroBack`.

---

# 17. MVP Implementation Order

## Step 1
Add Batch Hero Render entry point and product selection UI.

## Step 2
Add validation preview for selected side(s).

## Step 3
Hook into deterministic renderer for batch execution.

## Step 4
Create product assets and assign hero slots.

## Step 5
Show results summary and row-level output.

## Step 6
Optional status update if all selected hero renders succeed.

---

# 18. Success Criteria

Phase 4 is successful when a user can:

1. Select a set of products
2. Choose Front / Back / Both
3. Run deterministic batch hero rendering
4. Have Rally generate correct front/back hero images
5. Assign those images into `product.media.heroFront` / `heroBack`
6. Skip already-rendered products when desired
7. View batch results with errors and asset links

Example ideal result:

```text
Selected 30 products
Back only
Generated 30 hero back renders
Assigned 30 hero back images
0 duplicate products
0 manual Photoshop steps
```

---

# 19. Final Directive for Cursor

Please implement Phase 4 as **deterministic batch hero render generation** from existing products.

Critical rules:

- use explicit `renderSetup.front` / `renderSetup.back`
- deterministic renderer only
- create/update product assets
- assign hero front/back slots
- do not involve AI or Shopify sync
- do not let one failed product/side fail the whole batch

This phase should turn imported/generated products into fully prepared Rally products with approved deterministic hero images, ready for later Shopify sync.

---

# End of Spec
