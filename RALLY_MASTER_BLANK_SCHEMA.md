# Master blank + variants (canonical model)

## Canonical rules

- **Master Blank** = style-level object (one doc per garment style). It owns pricing, cost, weight, templates, placement, render defaults, brand/supplier/style info.
- **Blank Variant** = color-level object. It owns `colorName`, `colorHex`, `colorFamily`, vendor color metadata, variant images, optional variant render overrides.
- **Color is defined on variants, not on the master blank.** For schema v2, do not imply a single color at the blank root.
- **Generated Product** is created from blank + blankVariant + design + team. Product stores a snapshot at creation; edits to blank/design do not silently mutate products—products become stale instead (see `blankVersionUsed` / `designVersionUsed` and staleness helpers).
- **Archive** blocks future generation; existing products remain. **Delete** is blocked if any products reference the blank.

## Firestore

- **`schemaVersion: 2`** — Master blank: one `rp_blanks` document per **style**. Colors live in **`variants[]`**.
- **Legacy** — `schemaVersion` omitted: one document per style+color; top-level `colorName`, `images`, etc.

## Blank version

- **`version`** (optional number) is bumped in `updateBlank` when any of: placements, renderDefaults, titleTemplate, descriptionTemplate, tagTemplates, shopifyDefaults, defaultPricing, defaultShipping, variants change. Products store `blankVersionUsed` at creation (and on refresh) to detect staleness via `isBlankStale(product, currentBlank)`. If `version` is not yet set, `updatedAt` can be used as the version source.

## Product generation

- **`blankId`** — Master blank document id.
- **`blankVariantId`** — Required when the blank is `schemaVersion === 2` and has variants. Resolves `colorName`, `colorHex`, `colorFamily`, variant images, and optional render overrides.

## Storefront (Shopify) — “Heather Grey” → gallery

**Intent:** When a shopper picks a **color option** (e.g. Heather Grey) on Shopify, the **images they see** should be the **product visuals built from that exact garment color** — not generic style-level shots.

**How the architecture supports this:**

1. **Source mockups** for a color live on **`rp_blanks.variants[]`**: `variants[i].images` (front / back / detail) for that `variantId`. That is the blank’s definition of “this color’s” flat/reference photos.
2. **Each generated product** (`rp_products`) stores **`blankId` + `blankVariantId`** (and `productIdentityKey` includes the variant id for master blanks). One logical SKU/color line = one stable `blankVariantId`.
3. **Rendered merchandising** (composites, flat renders, scene renders, `media.hero*`, `media.gallery`, etc.) is **owned on the product** after generation. Those URLs are what sync/push to Shopify as the variant’s **media gallery**.
4. **Shopify** maps Rally’s color option / variant to `shopify.variantId`; the sync worker should attach **that variant’s** media from the **Rally product** that carries the matching `blankVariantId` — not from the master blank’s style-level fields (which v2 masters do not use for per-color photos).

**Rule of thumb:** *Blank variant images* = inputs for rendering that color; *product `media`* = what the shopper sees for that color after generation; *Shopify variant* = storefront selector that must line up with the same `blankVariantId` / product row.

See also `RALLY_GENERATED_PRODUCT_SPEC.md` (§10 `blankVariantId`, Shopify sync) and `RpProduct.blankVariantId` / `RpProduct.media` in `lib/types/firestore.ts`.

## Migration

- Legacy rows remain valid. Prefer **Seed master blanks** (`seedMasterBlanks`) for new environments.
- Multiple legacy color rows can later be merged into one master + variants (manual or script).

## Types

See `RPBlank`, `RPBlankVariant` in `lib/types/firestore.ts` and helpers in `lib/blanks/blankModel.ts`.

## Eligibility (team catalog)

- **`eligibility`** on `RPBlank` — Broad rules: leagues, color-family matching vs `design_teams.colorFamilies`, design zones, product-family chips, include/exclude team ids.
- **`eligibilityOverride`** on `RPBlankVariant` — When `enabled: true`, **replaces** master rules for that variant (same fields minus zones/families on master-only section).
- **Garment colors** are **only** on `variants[]`; eligibility only filters **which teams** can pair with a variant at generation time.
- Resolver: `lib/blanks/eligibility.ts` (`computeEligibleTeams`, `getEffectiveEligibility`, `getEffectiveEligibilityForVariant`).
