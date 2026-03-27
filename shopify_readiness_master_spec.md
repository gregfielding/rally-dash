# Shopify Readiness Master Spec for Rally Products

## Objective

We want to define the complete Shopify contract for Rally products so that any generated product can be pushed to Shopify with **zero manual edits** and function correctly for:

- storefront display
- variant selection
- checkout
- fulfillment
- order mapping back into Rally

The guiding rule is:

> If we synced a generated product to Shopify right now, it should work correctly end-to-end.

This spec is intended to be the master checklist before we pivot fully to additional image creation (hanger, bed, floor, hero images, etc.).

---

## What “100% Shopify-ready” means

A product is Shopify-ready only if all of the following layers are complete:

1. **Product identity**
2. **Variant structure**
3. **Media**
4. **Commerce data**
5. **Operations / fulfillment mapping**

Most systems stop at identity + images. Rally needs all five.

---

## 1. Product core fields

These are the required or strongly expected Shopify product-level fields.

### Shopify product fields
- `title`
- `body_html`
- `vendor`
- `product_type`
- `handle`
- `status`
- `tags`

### Rally mapping
- `title` → generated parent product title
- `body_html` → rich product description
- `vendor` → `Rally Panties`
- `product_type` → normalized product type such as `Bikini Panty`
- `handle` → generated canonical slug
- `status` → draft or active depending on flow
- `tags` → generated from the dual-layer tag builder

### Required product-level checks
Every generated parent product should have:
- clean human-readable title
- clean HTML description
- plain text description if needed for editing
- deterministic handle
- deterministic tags
- product type that maps cleanly into Shopify collections and filters

---

## 2. Product taxonomy and tags

Tags are the source of truth for collections and much of storefront organization.

### Required human-readable tags
For a product like `Los Angeles Dodgers 69 Bikini Panty`, tags should include:
- `Los Angeles`
- `Los Angeles Dodgers`
- `MLB`
- `Baseball`
- `69`
- `Bikini Panty`

### Required structured tags
- `city:los_angeles`
- `team:los_angeles_dodgers`
- `league:mlb`
- `sport:baseball`
- `theme:69`
- `product_type:bikini_panty`

### Why this matters
These tags power:
- smart collections
- navigation
- search
- filters
- merchandising logic

### Required taxonomy fields on the product
At minimum:
- `cityName`
- `citySlug`
- `teamName`
- `teamSlug`
- `teamId`
- `teamCode`
- `leagueName`
- `leagueCode`
- `sportName`
- `sportCode`
- `themeName`
- `themeCode`
- `designFamily`
- `productTypeName`
- `productTypeSlug`

### Required taxonomy quality checks
- all tags must be deterministic
- no legacy duplicate tags
- no raw partial team names like `dodgers`
- no mixed slug/display inconsistencies
- one canonical team slug per team

---

## 3. Product model

Rally should remain aligned to the current parent + variant structure:

- **Parent product** = the Shopify product
- **Child variants** = color (and later size) variants

### Rule
Do not create one Shopify product per color.

A parent product should represent:
- one design
- one blank style
- multiple color variants
- later: multiple size variants per color

### Storefront rule
Collection grids should show:
- one card per parent product
- not one card per color

---

## 4. Variant structure

This is the most important commerce layer.

### Shopify variant model we need
At launch, variants should support:
- `Color`
- `Size`

### Required option structure
- `Option1 = Color`
- `Option2 = Size`

### Required size system
We should support:
- `XS`
- `S`
- `M`
- `L`
- `XL`

### Variant matrix
For a product with 5 colors, this means:
- 5 colors × 5 sizes = 25 Shopify variants

### Required variant-level fields
Each variant eventually needs:
- `option1` / Color
- `option2` / Size
- `sku`
- `price`
- `inventory_quantity`
- `inventory_management`
- `weight`
- `weight_unit`
- `requires_shipping`
- `taxable`
- `fulfillment_service`
- internal references back to Rally design/blank/color/size

---

## 5. SKU strategy

We need deterministic SKUs.

### Suggested format
`RP-MLB-SF-C69-BLK-M`

### Suggested breakdown
- `RP` = brand
- `MLB` = league
- `SF` = team shorthand
- `C69` = design/theme
- `BLK` = color
- `M` = size

### Required SKU qualities
- deterministic
- unique per sellable Shopify variant
- decodable back into design + blank + color + size
- safe for fulfillment and reporting

### Minimum requirement
Before Shopify sync, every sellable Shopify variant must have a valid SKU.

---

## 6. Pricing and cost

We need both customer-facing pricing and internal cost structure.

### Required fields
At minimum:
- `price`
- `cost`
- optional `compare_at_price`

### Why
We need:
- storefront pricing
- profitability tracking
- promotional pricing later

### Example
- `price = 24.99`
- `cost = 6.50`
- optional `compare_at_price = 29.99`

### Required decisions
We need to define:
- default retail price by blank/product type
- default cost basis by blank/product type
- whether cost is stored at product level, variant level, or both
- whether price can vary by size or remain constant across XS–XL

---

## 7. Inventory strategy

We need a defined inventory approach before claiming Shopify readiness.

### Launch options
#### Option A — soft inventory / fake stock
- `inventory_management = null`
- `inventory_quantity = 999`
- simplest for early launch

#### Option B — tracked inventory
- real stock counts
- more complex
- likely later

### Recommendation for early launch
Start with a simple managed-unmanaged strategy that does not block checkout while the fulfillment process is manual.

### Required field decisions
- whether inventory is tracked in Shopify
- what default quantity should be
- whether variants default to in-stock
- what happens if a blank/color/size combination becomes unavailable

---

## 8. Shipping and weight

Every sellable Shopify variant needs shipping-relevant data.

### Required fields
- `requires_shipping = true`
- `weight`
- `weight_unit`

### Example
- `weight = 0.1`
- `weight_unit = lb`

### Required decision
Weights should be determined by blank/product type and inherited automatically into generated variants.

---

## 9. Tax settings

Every variant should explicitly define tax behavior.

### Required
- `taxable = true` unless intentionally not taxable

This should be deterministic and not left implicit.

---

## 10. Fulfillment

We need a clear launch fulfillment stance.

### Required field
- `fulfillment_service`

### Recommended launch value
- `manual`

### Later
This can map to:
- fulfillment house
- print partner
- third-party warehouse
- custom workflow

But for now, it should be explicit and not undefined.

---

## 11. Media and images

A Shopify-ready product must have a complete and predictable image package.

### For each color variant, minimum required visual package
For 8394 / back-only panties:
- front clean image
- back primary image

### Current direction
Variant-native image generation is correct.

Each variant should ultimately have:
- `media.heroBack`
- `media.heroFront`
- `mockupUrl`
- `flatRenders.flat_blended.back`
- `flatRenders.flat_clean.front`
- `media.gallery[]`

### Parent-level media
Parent product should cache:
- `displayMedia.heroUrl`
- `displayMedia.thumbUrl`

These should come only from the designated:
- `heroVariantId`
- or `defaultVariantId`

### Required media rule for Shopify readiness
At minimum, the default/hero variant must have:
- primary back image
- secondary front image

And eventually every color variant should also have a complete package.

---

## 12. Shopify image behavior

Shopify product images are product-level, but Rally variants need per-color visual accuracy.

### Required strategy
We need to confirm:
- how images are attached to the Shopify product
- whether variant-specific images are mapped per color
- how the storefront swaps images when a user changes color

### Desired behavior
When user switches color:
- corresponding images for that color should appear

### Required audit question
Does current sync logic support:
- parent-level image list only
- or variant-associated images
- or both

This must be made explicit.

---

## 13. Metafields / internal references

We should use Shopify metafields or equivalent mapping so orders can be resolved back into Rally.

### Recommended metafields
At minimum:
- `design_id`
- `design_slug`
- `blank_id`
- `blank_variant_id`
- `team_id`
- `theme_code`
- `render_profile_id` if useful
- `front_image_url`
- `back_image_url` if useful

### Why
This makes:
- debugging easier
- fulfillment mapping easier
- re-sync and reconciliation easier

---

## 14. Order mapping readiness

This is the hidden layer many systems miss.

When an order comes in, Rally must be able to map:

- Shopify order
- line item
- Shopify variant id
- SKU

back into:

- design
- blank
- blank variant/color
- size
- pricing/cost context
- fulfillment instructions

### Required order mapping rule
We need at least one deterministic mapping path:
- `shopifyVariantId`
or
- `SKU`

preferably both.

### Required operational question
Can current Rally data model map Shopify order line items back to:
- designId
- blankId
- blankVariantId
- size

If not, this is a pre-launch gap.

---

## 15. Product status / publish readiness

We need clear states between:
- generated
- image-complete
- Shopify-ready
- storefront-ready
- published

### Suggested readiness states
#### Variant base complete
A variant is base complete when it has:
- `media.heroBack` or equivalent primary image
- `flatRenders.flat_blended.back.url`
- `media.heroFront` or `flatRenders.flat_clean.front.url`

#### Product storefront ready
A product is storefront ready when:
- the `heroVariantId` / `defaultVariantId` is base complete

#### Product catalog complete
A product is catalog complete when:
- all variants are base complete

### Shopify-ready definition
A product is Shopify-ready only when:
- all required product fields exist
- all required variant fields exist
- required images exist
- pricing/cost/shipping/tax fields are set
- order mapping can work

---

## 16. Data that must exist in Rally before Shopify sync

### Product-level
- title
- handle
- body_html / descriptionHtml
- vendor
- product_type
- tags
- taxonomy fields
- displayMedia
- shopify sync state fields

### Variant-level
- color
- size
- SKU
- price
- cost
- weight
- shipping/tax config
- inventory fields
- image references
- internal ids

### Blank-level / inherited
- product type
- weight
- sizing support
- print side default
- render defaults

### Design-level / inherited
- design name
- theme
- series
- artwork tone files
- team / league / sport mapping

---

## 17. Likely gaps to audit

Based on current system direction, likely missing or incomplete areas include:

- size matrix implementation (XS–XL)
- SKU generation
- cost storage
- compare_at_price support
- inventory strategy
- weight population
- fulfillment_service
- tax settings
- Shopify metafields
- order mapping contract
- variant-specific Shopify image association
- explicit publish readiness rules

---

## 18. Audit request to run against codebase

The next step is to ask Cursor for a full Shopify readiness audit.

### Audit objective
Determine whether every required Shopify field is already populated, partially populated, or missing.

### Cursor audit should answer:
1. Product-level fields: what exists, where populated, what is missing
2. Variant-level fields: what exists, where populated, what is missing
3. Whether Color × Size is implemented or still pending
4. SKU generation status
5. Pricing + cost status
6. Inventory strategy status
7. Shipping + weight status
8. Tax + fulfillment status
9. Media included in Shopify payload
10. Metafields included in Shopify payload
11. Order mapping readiness
12. Final gap list before declaring Shopify complete

### Important constraint
The audit should not redesign the system yet.
It should identify:
- what exists
- what is missing
- what must be filled next

---

## 19. Definition of done

We can declare “Shopify settings are complete” only when:

### Product level
- all required Shopify product fields are deterministic and populated

### Variant level
- Color × Size matrix is supported
- every sellable variant has SKU, price, weight, shipping/tax config, inventory strategy

### Media
- default/hero variant has complete images
- storefront/Shopify preview reflects correct image logic
- color switching behavior is defined

### Operations
- order line item can map back into Rally via SKU and/or Shopify ids
- fulfillment path is clear
- sync behavior is deterministic

### Collections / tags
- tags are correct
- collections/navigation structure is correct

---

## 20. Recommended next sequence

Before additional image creation (hanger, bed, wood floor, hero scenes), the sequence should be:

1. run Shopify readiness audit
2. fill all missing Shopify/product/variant/ops fields
3. declare Shopify contract complete
4. then move to additional image generation

That keeps the system from becoming visually polished while still operationally incomplete.

---

## Final principle

The question is not:

> “Can this product be displayed?”

The real question is:

> “Can this product be sold, fulfilled, and reconciled correctly through Shopify without manual rescue work?”

That is the bar for Shopify readiness.
