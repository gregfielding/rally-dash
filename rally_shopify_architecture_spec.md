
# Rally x Shopify Architecture Specification
Author: Greg Fielding
Audience: Cursor Engineering Agent
Purpose: Define the architecture for Rally as a **Product Creation, Rendering, and Production Sync Platform** integrated with Shopify, which remains the **storefront and order management system**.

---

# 1. Guiding Principles

Rally should **NOT replace Shopify**.

Shopify is already excellent at:
- Storefront
- Checkout
- Payments
- Customers
- Orders
- Refunds
- Fulfillment visibility
- Channel publishing

Rally should focus on:

1. Product creation
2. Design rendering
3. Media generation
4. Production specification
5. Shopify catalog sync
6. Printer handoff

Therefore the system architecture becomes:

Rally = Product Intelligence + Rendering + Production  
Shopify = Commerce + Orders + Customers

---

# 2. High Level System Flow

```
Design Created
     ↓
Rally Renderer
     ↓
Product Media Approved
     ↓
Rally Product Definition
     ↓
Shopify Product Sync
     ↓
Customer Orders (Shopify)
     ↓
Webhook → Rally
     ↓
Production Packet Sent to Printer
     ↓
Printer Produces Item
     ↓
Tracking Sent → Shopify
```

---

# 3. Core Rally Modules

## Dashboard / Control Tower
Displays:
• products missing images  
• products missing production PDFs  
• unsynced Shopify products  
• rendering failures  
• today's Shopify orders  
• orders awaiting production packet  

---

## Designs

Fields:
designId  
name  
team  
league  
colors  
tags  
supportedSides

Assets:
designSVG  
designPNG  
printPDF

Status:
draft / approved / archived

---

## Blanks

Fields:
blankId  
garmentType  
color  
frontBlankImage  
backBlankImage

Rendering:
frontPlacementBox  
backPlacementBox  
blendMode  
opacity  
maskImage  

---

## Products

Fields:
productId  
title  
handle  
description  
brand  
productType  
tags  
collections

SEO:
seoTitle  
seoDescription

Media:
heroFrontImage  
heroBackImage  
galleryImages[]

Production:
printPDFFront  
printPDFBack  
printColors  
productionNotes

Render Config:
blankId  
designId  
sideUsed

Shopify Sync:
shopifyProductId  
syncStatus  
lastSyncTime

---

## Variants

Fields:
variantId  
productId  
size  
sku  
price  
compareAtPrice  
weight

---

# 4. Renderer Requirements

Steps:

1. Load design PNG
2. Detect non-transparent pixels
3. Crop to artwork bounds
4. Scale artwork to placement box
5. Composite onto blank
6. Export render

---

# 5. Shopify Integration

Use **GraphQL Admin API**.

Rally handles:
• product creation
• variant creation
• media upload
• tags
• collections
• metafields

---

# 6. Media Strategy

Slots:

hero_front  
hero_back  
gallery_1  
gallery_2  
on_model_primary  
lifestyle_scene

Upload flow:

stagedUploadsCreate → fileCreate → attach media to product

---

# 7. Production Metadata

Stored as Shopify metafields:

production.print_pdf_front  
production.print_pdf_back  
production.blank_id  
production.design_id

---

# 8. Order Handling

Shopify remains order manager.

Rally subscribes to webhooks:

orders/create  
orders/paid  
orders/fulfilled

---

# 9. Order Production Flow

1. Shopify order created
2. Webhook → Rally
3. Rally identifies variant
4. Rally retrieves production spec
5. Rally sends printer packet
6. Printer fulfills item
7. Tracking returned to Shopify

---

# 10. Production Packet Example

{
 orderId: "",
 sku: "",
 size: "",
 quantity: 1,
 blank: "",
 printPdf: "",
 shipping: {}
}

---

# 11. Firestore Collections

designs  
blanks  
products  
variants  
renders  
mediaAssets  
productionSpecs  
shopifySyncLogs  
ordersCache

---

# 12. Dashboard Tables

Catalog table columns:

thumbnail  
title  
team  
blank  
status  
price  
collections  
heroFront  
heroBack  
shopifyStatus

Actions:

edit  
duplicate  
sync  
archive

---

# 13. Bulk Launch Workflow

1. Select designs
2. Select blank
3. Generate renders
4. Generate titles
5. Generate descriptions
6. Review media
7. Bulk sync to Shopify

---

# 14. Long Term Vision

Rally becomes:

• product design engine  
• merchandising command center  
• production coordinator  
• Shopify catalog automation layer

Shopify remains:

• storefront  
• checkout  
• order management  
• customer system

---

# End of Spec
