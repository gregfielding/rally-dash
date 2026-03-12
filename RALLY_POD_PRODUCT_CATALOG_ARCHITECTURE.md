# RALLY_POD_PRODUCT_CATALOG_ARCHITECTURE.md
Author: ChatGPT
Audience: Cursor Engineering Agent
Purpose: Define how large Print‑On‑Demand (POD) companies structure their product catalog systems so they can launch and manage thousands of SKUs efficiently. This document provides implementation guidance for Rally's internal product catalog.

---

# 1. Why POD Companies Structure Catalogs Differently

Traditional Shopify stores treat **each product as a manually managed object**.

Large POD systems treat products as **generated outputs of a structured catalog model**.

Instead of managing products individually, they manage:

Designs  
Blanks  
Product Templates  
Variants  
Render Configurations

Products are **programmatically generated combinations** of these components.

Example:

Design:  
`WILL_DROP_FOR`

Team:  
`GIANTS`

Blank:  
`HEATHER_GREY_BIKINI`

Variant:  
`LIGHT`

Final product generated:

```
Will Drop For Giants – Heather Grey Bikini Panty
```

This allows thousands of SKUs to be created quickly.

---

# 2. Rally Catalog Model (Recommended)

Rally should organize product data into **five primary layers**.

```
Designs
↓
Blanks
↓
Product Templates
↓
Products
↓
Variants
```

Each layer stores different information.

---

# 3. Designs

Collection:
```
rp_designs
```

Designs represent the **print artwork**, independent of product type.

Example design:

```
WILL_DROP_FOR_GIANTS_BACK_LIGHT
```

Recommended fields:

```
id
importKey
designFamily
teamCode
leagueCode
variant
supportedSides
pngUrl
svgUrl
pdfUrl
createdAt
```

Designs should **not contain product information**.

They represent artwork only.

---

# 4. Blanks

Collection:
```
rp_blanks
```

Blanks represent the **physical product base**.

Examples:

```
HEATHER_GREY_BIKINI
BLACK_BIKINI
WHITE_THONG
```

Recommended fields:

```
id
name
slug
brand
productType
baseCost
defaultPrice
weight
placements
frontImageUrl
backImageUrl
active
```

Placements define where designs are rendered.

Example:

```
front_center
back_center
```

---

# 5. Product Templates

Collection:
```
rp_product_templates
```

Templates define how designs become products.

Example template:

```
bikini_template
```

Template fields:

```
id
titleTemplate
handleTemplate
descriptionTemplate
tagsTemplate
collectionKeys
defaultPlacements
defaultVariants
blankTypesAllowed
```

Example title template:

```
{Design Family} {Team} – {Blank Name}
```

Example handle template:

```
{design-family}-{team}-{blank-slug}
```

Templates allow Rally to create products automatically.

---

# 6. Products

Collection:
```
rp_products
```

Products represent **design + blank combinations**.

Example product identity:

```
MLB_WILL_DROP_FOR_GIANTS_HEATHER_GREY_BIKINI_LIGHT
```

Recommended fields:

```
id
productIdentityKey
title
handle
slug
blankId
designIdFront
designIdBack
variantGroup
tags
collectionKeys
renderSetup
media
production
shopify
status
createdAt
```

Products should be **generated automatically**, not manually authored.

---

# 7. Variants

Collection:
```
rp_variants
```

Variants represent **size or style options**.

Example variants:

```
XS
S
M
L
XL
```

Recommended fields:

```
id
productId
size
sku
price
compareAtPrice
weight
inventoryPolicy
shopify
createdAt
```

Variants are usually generated automatically.

---

# 8. Media System

Collection:
```
rp_product_assets
```

Assets represent generated images.

Examples:

```
hero_front
hero_back
gallery
model
lifestyle
```

Fields:

```
id
productId
assetType
side
fileUrl
approved
source
renderSignature
createdAt
```

Hero images should be deterministic renders.

---

# 9. Product Generation Pipeline

Large POD companies use a pipeline like this:

```
Import Designs
↓
Create Design Records
↓
Generate Products (Design + Blank)
↓
Generate Variants
↓
Render Hero Images
↓
Approve Media
↓
Sync to Shopify
```

This pipeline allows launching thousands of SKUs rapidly.

---

# 10. Identity Key (Critical)

Products must use a deterministic identity key.

Example format:

```
leagueCode_designFamily_teamCode_blankId_variant
```

Example:

```
MLB_WILL_DROP_FOR_GIANTS_HEATHER_GREY_BIKINI_LIGHT
```

This prevents duplicate products.

Front/back designs update the same product.

---

# 11. Bulk Launch Strategy

Instead of manually creating products, Rally should support:

```
Select Designs
↓
Select Blank
↓
Generate Products
↓
Generate Variants
↓
Batch Render Heroes
↓
Push to Shopify
```

This is how large POD platforms launch hundreds of products at once.

---

# 12. Catalog Dashboard Requirements

Rally's dashboard should include:

### Designs
Import / manage artwork

### Blanks
Manage product bases

### Products
Generated design + blank combinations

### Variants
Size or option variants

### Media
Hero / model / lifestyle assets

### Batch Tools

```
Batch Import Designs
Batch Generate Products
Batch Render Heroes
Batch Shopify Sync
```

These tools enable large-scale launches.

---

# 13. Shopify Relationship

Rally should remain the **catalog source of truth**.

Shopify should only store:

```
productId
variantIds
media
metafields
```

All product creation logic should live in Rally.

---

# 14. Scaling Capability

This architecture allows:

```
50 designs
× 30 teams
× 3 blanks
× 5 sizes
=
22,500 SKUs
```

generated automatically.

Without this architecture, managing the catalog becomes impossible.

---

# 15. Recommended Next Steps for Cursor

1. Ensure Rally collections follow the structure above.
2. Confirm `productIdentityKey` logic exists and is indexed.
3. Ensure products are generated programmatically from designs + blanks.
4. Implement variant generation if not already present.
5. Ensure batch hero rendering assigns hero assets.
6. Implement Shopify catalog sync.

---

# 16. Final Directive

Rally should behave like a **POD product factory**, not a manual product editor.

Products should be generated from structured inputs:

```
Design
+ Blank
+ Template
+ Variant
```

This architecture allows Rally to scale to thousands of SKUs while keeping catalog management simple and deterministic.

---

End of document.
