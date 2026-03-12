# RALLY_SHOPIFY_CATALOG_SYNC_MVP_SPEC.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define the MVP implementation for syncing Rally products into Shopify as a catalog system of record for storefront merchandising, while Shopify remains the order and store operations platform.

---

# 1. Goal

Rally should become the system where products are created, rendered, approved, and prepared for commerce.

Shopify should become the destination where those approved products are published for sale.

This MVP sync should allow Rally to:

- create or update Shopify products
- create or update Shopify variants
- upload approved media
- store Shopify IDs back on Rally products and variants
- attach core custom production metadata
- show clear sync status and errors in the Rally UI

This MVP should **not** yet:

- sync orders into Rally
- manage fulfillment workflows
- publish advanced AI/lifestyle assets automatically
- implement full bulk-launch orchestration
- implement printer status polling

---

# 2. System Philosophy

## Rally is the source of truth for:
- product title / handle
- descriptions
- SEO
- tags
- collection keys
- hero front / hero back
- approved gallery images
- blank/design associations
- production PDF references
- product readiness

## Shopify is the source of truth for:
- storefront presentation
- checkout
- customers
- orders
- order management
- fulfillment UI

---

# 3. MVP Success Criteria

The sync is successful when a user can:

1. open a Rally product
2. confirm it is “ready for Shopify sync”
3. click Sync to Shopify
4. have Rally:
   - create or update the Shopify product
   - create or update variants
   - upload hero images
   - attach key custom data
5. store Shopify IDs/status back in Rally
6. open the product in Shopify from Rally

---

# 4. Pre-Sync Product Requirements

A product should not be syncable unless the minimum required fields are present.

## Required product fields
- title
- handle
- blankId
- at least one hero image (heroFront preferred; heroBack optional but strongly recommended)
- base pricing
- shipping weight
- product type / brand if required by your merchandising rules

## Required production fields
At minimum:
- print PDF front and/or back as applicable
- design/blank linkage
- tags or metadata sufficient for traceability

## Readiness rule
Sync button should be disabled or heavily warned if required data is missing.

---

# 5. Shopify Data Mapping

## Product-level mapping

### Rally → Shopify Product
Map these fields:

- `product.title` → Shopify title
- `product.handle` → Shopify handle
- `product.descriptionHtml` or converted description → Shopify descriptionHtml
- `product.productType` → Shopify productType
- `product.tags[]` → Shopify tags
- `product.seo.title` → Shopify SEO title
- `product.seo.description` → Shopify SEO description

### Product status
Suggested mapping:
- Rally `draft` → Shopify draft / unpublished
- Rally `approved` or `active` → Shopify active/publishable (still allow a manual publish control if desired)

---

## Variant-level mapping

### Rally → Shopify Variant
Map these fields:

- variant title / option values
- SKU
- price
- compareAtPrice
- weight
- taxable
- inventory policy
- inventory tracking setting

For MVP, assume size is the main option:

```text
Size = XS / S / M / L / XL
```

Color or team should not be a variant unless you intentionally choose that later.

---

## Media mapping

### Required MVP media
- `hero_front`
- `hero_back` (optional but recommended)

### Optional later media
- gallery images
- on-model
- lifestyle scenes

For MVP:
- sync hero front first
- sync hero back second
- optionally sync any approved gallery images

---

## Custom production metadata
For MVP, push a small set of production references into Shopify metafields.

Recommended keys:

### Product metafields
- `rally.blank_id`
- `rally.design_front_id`
- `rally.design_back_id`
- `rally.print_pdf_front`
- `rally.print_pdf_back`
- `rally.production_notes`

This keeps Shopify product records traceable without turning Shopify into the production system itself.

---

# 6. Shopify GraphQL Strategy

Use Shopify GraphQL Admin API.

MVP sync should use these core patterns:

## A. Upload files/media
1. `stagedUploadsCreate`
2. upload file to staged target
3. `fileCreate`

This should be used for:
- hero images
- gallery images
- PDFs if you choose to mirror them into Shopify Files

## B. Create / update product
Use `productSet` if practical for your schema version, or a product create/update mutation path if needed.

## C. Create / update metafields
Use metafield mutations after product creation if productSet does not cover the desired custom data cleanly.

---

# 7. Rally Schema Requirements for Sync

MVP assumes the Rally Firestore product schema already includes:

```ts
shopify?: {
  productId?: string | null,
  status?: "not_synced" | "queued" | "synced" | "error",
  lastSyncAt?: Timestamp | null,
  lastSyncError?: string | null
}
```

Recommended additions if not already present:

## On variants
```ts
shopify?: {
  variantId?: string | null,
  inventoryItemId?: string | null,
  status?: "not_synced" | "queued" | "synced" | "error",
  lastSyncAt?: Timestamp | null,
  lastSyncError?: string | null
}
```

## On product assets
Optional but useful:
```ts
shopify?: {
  fileId?: string | null,
  mediaId?: string | null
}
```

This allows Rally to know which Shopify file/media object corresponds to each asset.

---

# 8. Recommended MVP Sync Flow

## Step 1 — Validate product readiness
Before syncing:
- verify required fields
- verify hero media exists
- verify variant rows are present (or generate default ones)
- verify handle is valid

If not ready:
- return a clear error
- do not partially sync

## Step 2 — Upload media
For each approved hero asset:
- upload to Shopify via staged upload
- create Shopify file/media record
- capture returned IDs

## Step 3 — Create/update product
Create or update Shopify product using:
- title
- handle
- description
- tags
- SEO
- product type

Store returned Shopify product ID in Rally.

## Step 4 — Create/update variants
For each Rally variant:
- create or update Shopify variant
- store returned Shopify variant IDs in Rally

## Step 5 — Attach metafields
Write custom production references:
- blank id
- design ids
- print PDF refs
- notes

## Step 6 — Update Rally sync status
On success:
- `shopify.status = "synced"`
- `shopify.lastSyncAt = now`
- clear error

On failure:
- `shopify.status = "error"`
- store `shopify.lastSyncError`

---

# 9. Sync Job Architecture

Do not implement sync as a giant blocking UI action.

Use a job model.

## Recommended flow
```text
User clicks Sync to Shopify
→ create sync job
→ background worker processes job
→ updates Rally product / variants
→ writes logs
→ UI reflects progress and result
```

## Suggested collection
`shopifySyncJobs`

Suggested fields:

```ts
{
  id: string,
  entityType: "product",
  entityId: string,
  action: "create_or_update",
  status: "queued" | "running" | "succeeded" | "failed",
  requestSummary?: string | null,
  responseSummary?: string | null,
  error?: string | null,
  createdAt: Timestamp,
  startedAt?: Timestamp | null,
  finishedAt?: Timestamp | null
}
```

This keeps the UI responsive and makes retries safer.

---

# 10. UI Requirements

## Product Detail → Shopify section
Add a clear Shopify panel on the product page showing:

- Shopify sync status
- last sync time
- last sync error
- Shopify product ID
- open in Shopify button
- Sync to Shopify button
- Re-sync button if already synced

## Button behavior
### If not ready
Show disabled state or warning:
```text
Not ready for Shopify sync
Missing: hero front, weight, price
```

### If ready
Allow:
```text
Sync to Shopify
```

## Sync result
After sync:
- show success message
- show product ID
- show “Open in Shopify”

---

## Products table bulk actions (later but useful)
After MVP single-product sync, support bulk sync from the products table:
- selected products
- queued job per product
- batch progress

But do not make this part of the first implementation slice.

---

# 11. Variant Strategy for MVP

If variants are not fully built in Rally yet, choose one of these MVP approaches:

## Option A — minimal single variant product
Create one default variant per product.

Use fields:
- SKU
- price
- weight

## Option B — size variants if already available
If Rally already has variant rows, sync them.

Recommendation:
Implement whichever is already easiest in the repo. Do not block MVP sync on a perfect variant system if it is not ready.

---

# 12. Media Rules

## For MVP
Only sync approved deterministic hero assets.

Required:
- heroFront
Optional:
- heroBack

If both exist:
- sync both

## Later
Add support for:
- gallery images
- on-model images
- lifestyle images

Keep MVP narrow.

---

# 13. Error Handling

Common failures:
- missing access token / API auth
- duplicate handle conflict
- invalid media upload
- bad product payload
- variant mismatch
- metafield validation errors

UI should show:
- clear job failure
- error summary
- retry option later

Do not leave users guessing.

---

# 14. Recommended Implementation Order

## Step 1
Add product readiness gating for Shopify sync.

## Step 2
Add Shopify sync section to Product Detail page:
- status
- product id
- error
- open in Shopify
- sync button

## Step 3
Implement single-product sync job creation from the UI.

## Step 4
Implement backend worker:
- upload media
- create/update Shopify product
- create/update variants
- write metafields
- update Rally IDs/status

## Step 5
Store returned Shopify IDs on products / variants / assets.

## Step 6
Support re-sync.

---

# 15. Minimal Backend Function Responsibilities

The sync worker/backend should:

1. load Rally product by ID
2. validate readiness
3. upload approved hero assets
4. create/update Shopify product
5. create/update Shopify variants
6. attach media/metafields
7. update Rally product + variant + asset sync fields
8. write a sync log entry

This can be:
- Cloud Function
- background queue worker
- whichever matches the current Rally architecture

---

# 16. Success Example

A Rally product:

```text
Will Drop For Giants – Heather Grey Bikini Panty
```

with:
- heroFront
- heroBack
- blankId
- designIdBack
- price
- weight
- tags
- SEO
- printPdfBack

should sync to Shopify and result in:

- a Shopify product with title/handle
- at least one variant
- hero images attached
- production refs stored in metafields
- Rally showing:
  - synced
  - Shopify product ID
  - open in Shopify link

---

# 17. Final Directive for Cursor

Please implement an MVP Shopify Catalog Sync focused on single-product sync first.

Critical rules:

- Rally remains the source of truth for product creation and approved media
- Shopify remains the storefront/order platform
- Sync only approved products/assets
- Keep the first slice narrow:
  - single-product sync
  - approved hero images
  - basic variants
  - core metafields
- Use a job-based sync model, not a long blocking UI action

Once this MVP is working, bulk sync and order/printer integrations can be layered on cleanly.

---

# End of Spec
