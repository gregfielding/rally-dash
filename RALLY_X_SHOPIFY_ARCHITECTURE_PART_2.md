# RALLY_X_SHOPIFY_ARCHITECTURE_PART_2.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Expand the Rally × Shopify architecture into an implementation-ready Part 2 spec covering Firestore schema, Shopify GraphQL sync templates, webhook processing, printer handoff, and dashboard UI structure.

---

# 1. Product Philosophy

Rally is the **catalog, render, and production control plane**.

Shopify is the **storefront and order system of record**.

That means:

- Shopify handles:
  - storefront
  - checkout
  - payments
  - customers
  - orders
  - refund / return flows
  - fulfillment visibility
- Rally handles:
  - designs
  - blanks
  - deterministic product rendering
  - product metadata authoring
  - media approvals
  - production PDFs
  - Shopify catalog sync
  - production handoff to printer

Rally should **see Shopify orders**, but not replace Shopify’s native order management UI.

---

# 2. Core Architecture

```text
Illustrator / Photoshop / Renderer
        ↓
      Rally
  (designs, blanks, renders,
   products, variants, PDFs)
        ↓
   Shopify Catalog Sync
        ↓
     Shopify Store
 (storefront, checkout, orders)
        ↓
 Shopify order webhook → Rally
        ↓
 Production packet → Printer
        ↓
 Printer status / tracking → Rally → Shopify
```

---

# 3. Firestore Schema

Use Firestore as Rally’s authoritative operational database.

## 3.1 designs

Document id:
```text
DESIGN_<id>
```

Suggested fields:

```ts
{
  id: string,
  name: string,
  slug: string,
  teamCode: string | null,
  teamName: string | null,
  leagueCode: string | null,
  designFamily: string | null,
  supportedSides: ("front" | "back")[],
  status: "draft" | "approved" | "archived",
  tags: string[],
  colors: Array<{
    hex: string,
    name?: string,
    role?: "ink" | "base" | "accent"
  }>,
  files: {
    svg?: string | null,
    png?: string | null,
    pdf?: string | null
  },
  hasSvg: boolean,
  hasPng: boolean,
  hasPdf: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  createdBy?: string | null,
  updatedBy?: string | null
}
```

---

## 3.2 blanks

Document id:
```text
BLANK_<id>
```

Suggested fields:

```ts
{
  id: string,
  name: string,
  slug: string,
  garmentType: "panties" | "tank" | "sweatshirt" | "tee" | string,
  silhouette: string,
  colorway: string,
  status: "active" | "archived",
  images: {
    front?: string | null,
    back?: string | null,
    side?: string | null,
    folded?: string | null
  },
  placements: {
    front?: {
      x: number,
      y: number,
      width: number,
      height: number,
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light",
      blendOpacity?: number,
      safeArea?: { x: number, y: number, width: number, height: number } | null
    } | null,
    back?: {
      x: number,
      y: number,
      width: number,
      height: number,
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light",
      blendOpacity?: number,
      safeArea?: { x: number, y: number, width: number, height: number } | null
    } | null
  },
  masks: {
    front?: string | null,
    back?: string | null
  },
  displacementMaps: {
    front?: string | null,
    back?: string | null
  },
  cost: {
    baseUnitCost?: number | null
  },
  shipping: {
    defaultWeightGrams?: number | null
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## 3.3 products

This is the core merchandising record in Rally.

Document id:
```text
PRODUCT_<id>
```

Suggested fields:

```ts
{
  id: string,
  title: string,
  handle: string,
  brand: string,
  productType: string,
  garmentType: string,
  teamCode?: string | null,
  teamName?: string | null,
  leagueCode?: string | null,
  blankId: string,
  designIdFront?: string | null,
  designIdBack?: string | null,
  selectedBlankSide?: "front" | "back" | null,
  selectedDesignSide?: "front" | "back" | null,

  descriptionHtml?: string | null,
  descriptionText?: string | null,

  seo: {
    title?: string | null,
    description?: string | null
  },

  tags: string[],
  collectionKeys: string[],
  status: "draft" | "approved" | "published" | "archived",

  pricing: {
    basePrice?: number | null,
    compareAtPrice?: number | null,
    currencyCode?: string | null
  },

  shipping: {
    defaultWeightGrams?: number | null,
    requiresShipping: boolean
  },

  media: {
    heroFront?: string | null,
    heroBack?: string | null,
    gallery?: string[],
    modelAssets?: string[],
    lifestyleAssets?: string[]
  },

  production: {
    printPdfFront?: string | null,
    printPdfBack?: string | null,
    printPdfMaster?: string | null,
    printColors?: string[],
    productionNotes?: string | null
  },

  shopify: {
    productId?: string | null,
    status?: "not_synced" | "queued" | "synced" | "error",
    lastSyncAt?: Timestamp | null,
    lastSyncError?: string | null
  },

  createdAt: Timestamp,
  updatedAt: Timestamp,
  createdBy?: string | null,
  updatedBy?: string | null
}
```

---

## 3.4 variants

Document id:
```text
VARIANT_<id>
```

Suggested fields:

```ts
{
  id: string,
  productId: string,
  optionValues: {
    size?: string | null,
    color?: string | null
  },
  title: string,
  sku: string,
  barcode?: string | null,
  price: number,
  compareAtPrice?: number | null,
  weightGrams?: number | null,
  taxable: boolean,
  inventoryTracked: boolean,
  inventoryPolicy: "deny" | "continue",
  active: boolean,

  shopify: {
    variantId?: string | null,
    inventoryItemId?: string | null,
    status?: "not_synced" | "queued" | "synced" | "error",
    lastSyncAt?: Timestamp | null,
    lastSyncError?: string | null
  },

  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## 3.5 productAssets

Document id:
```text
ASSET_<id>
```

Suggested fields:

```ts
{
  id: string,
  productId: string,
  blankId?: string | null,
  designId?: string | null,
  side?: "front" | "back" | null,
  assetType: "mockup" | "productPackshot" | "product_scene" | "model_scene" | "hero" | "detail",
  source: "deterministic_renderer" | "manual_upload" | "ai_product_generation" | "ai_model_generation",
  presetMode?: "productOnly" | "onModel" | null,
  scenePresetKey?: string | null,
  fileUrl: string,
  thumbnailUrl?: string | null,
  width?: number | null,
  height?: number | null,
  approved: boolean,
  heroSlot?: "hero_front" | "hero_back" | null,
  shopify: {
    fileId?: string | null,
    mediaId?: string | null
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## 3.6 productionSpecs

Document id:
```text
PRODUCTION_<id>
```

Suggested fields:

```ts
{
  id: string,
  productId: string,
  variantIds: string[],
  blankId: string,
  printPdfFront?: string | null,
  printPdfBack?: string | null,
  printPdfMaster?: string | null,
  printColors?: string[],
  placementNotes?: string | null,
  printerRoutingKey?: string | null,
  packNotes?: string | null,
  active: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## 3.7 shopifySyncJobs

Document id:
```text
SYNC_<id>
```

Suggested fields:

```ts
{
  id: string,
  entityType: "product" | "variant" | "collection" | "media" | "metafields",
  entityId: string,
  action: "create" | "update" | "publish" | "archive",
  status: "queued" | "running" | "succeeded" | "failed",
  requestSummary?: string | null,
  responseSummary?: string | null,
  error?: string | null,
  startedAt?: Timestamp | null,
  finishedAt?: Timestamp | null,
  createdAt: Timestamp
}
```

---

## 3.8 ordersCache (read-only operational cache)

Document id:
```text
ORDER_<shopifyOrderId>
```

Suggested fields:

```ts
{
  id: string,
  shopifyOrderId: string,
  orderName: string,
  createdAtShopify: Timestamp,
  financialStatus?: string | null,
  fulfillmentStatus?: string | null,
  customerEmail?: string | null,
  lineItems: Array<{
    shopifyLineItemId: string,
    productId?: string | null,
    variantId?: string | null,
    sku?: string | null,
    quantity: number
  }>,
  productionStatus: "new" | "packet_sent" | "in_production" | "fulfilled" | "error",
  printerPacketId?: string | null,
  lastWebhookAt?: Timestamp | null,
  updatedAt: Timestamp
}
```

---

# 4. Shopify Sync Strategy

Use Shopify GraphQL Admin API as the primary integration surface.

## 4.1 Product sync philosophy

Rally is the catalog source of truth. Shopify is the commerce destination.

When a Rally product is approved:
1. Ensure media/files are uploaded to Shopify
2. Create/update product
3. Create/update variants
4. Attach media
5. Sync metafields/metaobjects
6. Publish product if approved

---

# 5. Shopify GraphQL Mutation Templates

## 5.1 Upload file target

```graphql
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

---

## 5.2 Create file from staged upload

```graphql
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      fileStatus
      ... on MediaImage {
        image {
          url
        }
      }
      ... on GenericFile {
        url
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

---

## 5.3 Product sync via productSet

```graphql
mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(input: $input, synchronous: $synchronous) {
    product {
      id
      title
      handle
    }
    productSetOperation {
      id
      status
      userErrors {
        code
        field
        message
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

---

## 5.4 Example ProductSetInput mapping

```ts
const input = {
  identifier: product.shopify.productId
    ? { id: product.shopify.productId }
    : { handle: product.handle },

  title: product.title,
  handle: product.handle,
  descriptionHtml: product.descriptionHtml,
  productType: product.productType,
  tags: product.tags,
  seo: {
    title: product.seo?.title ?? undefined,
    description: product.seo?.description ?? undefined
  },

  productOptions: [
    {
      name: "Size",
      values: variantRows.map(v => ({ name: v.optionValues.size }))
    }
  ],

  variants: variantRows.map(v => ({
    id: v.shopify?.variantId ?? undefined,
    optionValues: [
      { optionName: "Size", name: v.optionValues.size }
    ],
    sku: v.sku,
    price: `${v.price}`,
    compareAtPrice: v.compareAtPrice ? `${v.compareAtPrice}` : undefined,
    inventoryPolicy: v.inventoryPolicy.toUpperCase(),
    taxable: v.taxable
  }))
};
```

---

## 5.5 Product / variant metafields

Suggested namespaces/keys:

### Product metafields
- `rally.blank_id`
- `rally.design_front_id`
- `rally.design_back_id`
- `rally.print_pdf_front`
- `rally.print_pdf_back`
- `rally.production_notes`

### Variant metafields
- `rally.production_spec_id`
- `rally.blank_size_code`

---

## 5.6 Collections

Approach:
- maintain `collectionKeys` in Rally
- map those to Shopify collection IDs or handles
- keep collection sync separate from base product sync

---

# 6. Webhook Processing Architecture

Rally should subscribe to Shopify events, but not replace Shopify order management.

## 6.1 Core webhooks to subscribe to

Recommended initial set:
- `orders/create`
- `orders/paid`
- `orders/fulfilled`
- `orders/updated`

## 6.2 Webhook ingestion flow

```text
Shopify webhook
→ verify signature
→ persist raw payload
→ enqueue internal processing job
→ process idempotently
→ write/update ordersCache
→ if paid/new order, create printer packet
→ optionally update production status
```

## 6.3 Idempotency requirements

Every webhook processor should:
- use Shopify object id as idempotency key
- safely reprocess duplicates
- compare event timestamps or payload version markers if needed

Do not assume exactly-once delivery.

## 6.4 Recommended collections

### webhookEvents

```ts
{
  id: string,
  topic: string,
  shopDomain: string,
  shopifyResourceId?: string | null,
  receivedAt: Timestamp,
  processedAt?: Timestamp | null,
  status: "received" | "processed" | "failed",
  payloadUrl?: string | null,
  error?: string | null
}
```

---

# 7. Printer Integration Contract

Rally’s role when Shopify creates a paid order is to generate a printer-ready packet.

## 7.1 Production packet requirements

```ts
{
  packetId: string,
  shopifyOrderId: string,
  orderName: string,
  lineItems: [
    {
      shopifyLineItemId: string,
      rallyProductId: string,
      rallyVariantId: string,
      sku: string,
      quantity: number,
      size: string,
      blankId: string,
      blankName: string,
      printPdfFront?: string | null,
      printPdfBack?: string | null,
      printColors?: string[],
      productionNotes?: string | null
    }
  ],
  shipping: {
    name: string,
    address1: string,
    address2?: string | null,
    city: string,
    province: string,
    zip: string,
    country: string,
    phone?: string | null
  },
  createdAt: string
}
```

## 7.2 Printer adapter pattern

```ts
interface PrinterAdapter {
  sendProductionPacket(packet: ProductionPacket): Promise<PrinterAck>;
  fetchStatus?(externalJobId: string): Promise<PrinterStatus>;
}
```

## 7.3 Production status states

Recommended:
- `new`
- `packet_built`
- `packet_sent`
- `accepted_by_printer`
- `in_production`
- `fulfilled`
- `error`

---

# 8. Dashboard UI / Wireframe Spec

Rally should be intuitive and operationally tight.

## 8.1 Main modules

### Dashboard
Widgets:
- products missing hero front/back
- products missing PDFs
- Shopify sync failures
- products awaiting publish
- today’s orders (read-only)
- printer packet failures
- renderer failures

---

### Designs

Table columns:
- thumbnail
- design name
- team
- side support
- colors
- files present
- linked products
- status
- updated at

---

### Blanks

Table columns:
- thumbnail
- blank name
- garment type
- colorway
- front/back present
- placements configured
- masks configured
- status

Blank detail tabs:
- Images
- Placements
- Masks
- Shipping / Weight
- Rendering Defaults

---

### Products

Table columns:
- thumbnail
- title
- team
- blank
- status
- hero front
- hero back
- price
- sizes count
- collection count
- Shopify sync status
- PDF status
- updated at

Bulk actions:
- generate renders
- approve images
- sync to Shopify
- assign collections
- archive

Filters:
- team
- garment type
- sync status
- missing hero images
- missing PDFs
- published/draft

---

### Product Detail Page

#### Section A — Merchandising
- title
- handle
- description
- brand
- product type
- tags
- collection keys
- SEO title
- SEO description

#### Section B — Render Setup
- selected blank
- selected design asset
- side selector
- view full blank
- view full design
- deterministic preview
- generate hero front/back

#### Section C — Media
Slots:
- hero_front
- hero_back
- gallery
- on-model
- lifestyle

Actions:
- approve asset
- assign hero slot
- delete asset
- regenerate image
- push selected media to Shopify

#### Section D — Variants
Editable size table:
- size
- SKU
- price
- compare-at
- weight
- inventory tracked?
- active?

#### Section E — Production
- front PDF
- back PDF
- print colors
- production notes
- printer routing
- production spec version

#### Section F — Shopify
- Shopify product id
- variant ids
- last sync at
- sync status
- sync error
- open in Shopify
- push update
- publish / unpublish

---

### Orders Feed (light operational view only)

Columns:
- order number
- created at
- financial status
- fulfillment status
- production status
- printer packet status
- tracking present?
- total items

Actions:
- view packet
- resend packet
- open order in Shopify

Do not rebuild full order management. Shopify remains the true order UI.

---

# 9. CSV / Spreadsheet Strategy

Do not make a spreadsheet the primary source of truth.

Instead:
- Firestore = source of truth
- Dashboard = primary UI
- CSV import/export = convenience tool

Useful CSV imports:
- bulk product metadata
- pricing updates
- collection assignments
- SEO updates

Useful CSV exports:
- product audit
- sync status audit
- printer-ready batch exports

---

# 10. Sync Job Architecture

Use queue-based sync.

## 10.1 Why
Because large launches will involve:
- hundreds of products
- thousands of assets
- rate limits
- retries
- partial failure handling

## 10.2 Recommended job flow

```text
User clicks "Sync to Shopify"
→ create shopifySyncJob
→ worker processes job
→ update entity sync statuses
→ write success/failure logs
```

## 10.3 Retry rules
- retry transient API failures
- do not blindly retry validation failures
- store last error message on product/variant/sync job

---

# 11. Media / PDF Sync Rules

## 11.1 Product media
Only approved media should sync to Shopify.

Recommended:
- always sync `hero_front`
- sync `hero_back`
- sync selected gallery images
- sync on-model/lifestyle only when approved

## 11.2 PDFs
Production PDFs can be:
- stored only in Rally and referenced there, or
- mirrored into Shopify Files and referenced via metafields

Recommended:
- keep Rally as the primary production source
- mirror to Shopify only when useful for integrations or redundancy

---

# 12. Minimal Go-Live Scope

## Must-have
1. deterministic renderer
2. product + variant schema
3. hero front/back assignment
4. Shopify product sync
5. Shopify variant sync
6. media upload sync
7. PDF production spec storage
8. order webhook ingestion
9. printer packet generation

## Wait / later
- advanced analytics
- full inventory system
- deep returns workflow
- AI lifestyle scene generation
- printer status polling if the printer doesn’t support it yet
- displacement maps if Step 1 still needs attention

---

# 13. Engineering Priorities

## Priority 1
Finish deterministic renderer and correct product hero images.

## Priority 2
Implement final Firestore schema and migrate current data shape as needed.

## Priority 3
Build Product Detail page sections:
- Merchandising
- Variants
- Production
- Shopify

## Priority 4
Implement Shopify sync worker:
- files
- productSet
- metafields

## Priority 5
Implement webhook ingestion + printer packet flow.

---

# 14. Final Recommendation

Rally should become:
- product creation engine
- rendering engine
- media approval system
- Shopify catalog sync layer
- production handoff system

Shopify should remain:
- storefront
- checkout
- customer/order system
- day-to-day store operations UI

This keeps the architecture powerful but not overcomplicated.

---

# 15. Optional Phase 3+ Enhancements

Once the above is stable, consider:
- automatic collection rules
- AI-generated lifestyle scenes
- AI-generated model scenes
- product SEO drafting assistant
- batch launch planner
- printer analytics
- displacement-map realism pass
- bundle/set merchandising

---

# End of Spec
