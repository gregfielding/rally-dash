
# RALLY_RENDER_SETUP_DATA_MODEL.md

## Purpose

This document defines the **Render Setup data model for `rp_products`** in Rally.

The goal is to make product rendering **fully deterministic** by explicitly specifying:

- the exact blank asset
- the exact design asset
- the placement configuration
- blending rules

This prevents the renderer from guessing which assets or sides to use and ensures predictable, reproducible product images.

---

# 1. Canonical Architecture

- **`product.renderSetup`** is the **canonical** persisted render configuration. All render decisions (mockup, hero, product images) read from `renderSetup.front` or `renderSetup.back` based on the requested view.
- **`product.renderConfig`** is **UI-only** (e.g. which modal is open). It is not used for rendering or persistence of render configuration.
- **Front and back** are edited **separately** in the UI. There is no single “render side” toggle; each side has its own blank, design, and placement.
- **Generate flow** uses an explicit **generateView** (“front” | “back”). The renderer receives the view and uses `renderSetup.front` or `renderSetup.back` for that view. No dependency on a stored “current side.”

---

# 2. Render Setup Data Model

Per-side schema (same shape for `front` and `back`):

```ts
renderSetup?: {
  front?: {
    blankAssetId?: string | null    // selected blank identity (e.g. rp_blanks doc id)
    blankImageUrl?: string | null
    designAssetId?: string | null
    designAssetUrl?: string | null
    placementKey?: string | null
    placementOverride?: { x?: number; y?: number; scale?: number } | null
    maskUrl?: string | null
    blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null
    blendOpacity?: number | null
  } | null

  back?: { /* same shape */ } | null

  defaults?: {
    blankId?: string | null
    designIdFront?: string | null
    designIdBack?: string | null
  } | null

  lastVerifiedAt?: Timestamp | null
  lastVerifiedBy?: string | null
}
```

---

# 3. Field Explanations

## front / back

These represent the **actual render instructions** for each side. The renderer chooses config by **requested view** (e.g. `createMockJob({ view: "front" })` → use `renderSetup.front`).

---

## blankAssetId

The selected blank **identity** (e.g. blank document id). Persisted alongside `blankImageUrl` so debugging, asset replacement, and versioning can reference the exact blank asset.

---

## blankImageUrl

The exact blank **image** URL for that side.

Examples:

```
/blanks/heather_grey_front.png
/blanks/heather_grey_back.png
```

Each blank may have multiple views:

- front
- back
- folded
- angled

The renderer should **always use the explicit asset chosen here**.

---

## designAssetUrl

The exact PNG design file used in rendering.

Examples:

```
/designs/giants_front.png
/designs/giants_back.png
```

---

## designAssetId

Optional but useful.

This allows the system to trace the render back to the design asset document rather than relying only on a URL.

---

## placementKey

Maps to the placement defined on the blank configuration.

Examples:

```
front_print
back_print
front_center
back_center
```

This allows the blank definition to control placement coordinates instead of hardcoding them per product.

---

## maskUrl

Optional mask override.

If a blank uses fabric texture masking, the renderer can apply:

```
design × mask
```

before blending onto the blank.

---

## blendMode

Default should typically be:

```
multiply
```

This produces realistic results for fabric such as heather grey.

Other supported values:

```
normal
multiply
overlay
soft-light
```

---

## blendOpacity

Controls how strongly the design is blended with the blank texture.

Typical values:

```
80 – 90
```

Default recommendation:

```
87
```

---

# 3. Defaults Object

The `defaults` section helps the UI understand the base product configuration.

Example:

```
defaults: {
  blankId: "heather_grey_panty",
  designIdFront: "giants_logo_front",
  designIdBack: "giants_logo_back"
}
```

This does not drive rendering directly but helps simplify product editing.

---

# 4. Product Detail UI Requirements

The Product Detail → Render Setup section should allow:

## Front Setup

- Select blank front image
- Select design asset
- Select placement key
- Preview render result

## Back Setup

- Select blank back image
- Select design asset
- Select placement key
- Preview render result

Optional advanced controls:

- blend mode
- opacity
- mask override

---

# 5. Product Readiness Rules

A product should not be considered **ready for generation or Shopify sync** unless render setup is complete.

## Front requirements

```
renderSetup.front.blankImageUrl
renderSetup.front.designAssetUrl
renderSetup.front.placementKey
```

## Back requirements (if back design exists)

```
renderSetup.back.blankImageUrl
renderSetup.back.designAssetUrl
renderSetup.back.placementKey
```

---

# 6. Why This Model Is Important

Using only:

```
blankId + designId
```

is not sufficient because:

A blank can have:

- multiple views
- different placements
- different masks

A design can have:

- front PNG
- back PNG
- alternate versions

Rendering must therefore always use:

```
exact blank asset
+
exact design asset
+
exact placement key
```

This guarantees that Rally rendering remains deterministic and debuggable.

---

# 7. Outcome

With this model:

- Render behavior becomes predictable
- Debugging becomes easier
- Products can be validated before rendering
- Shopify sync will rely on stable product definitions

---

# 8. Implementation status

**Canonical:** `product.renderSetup` (with `blankAssetId`, `blankImageUrl`, `designAssetUrl`, `designAssetId`, `placementKey`, `placementOverride` per side) is in `lib/types/firestore.ts`. **renderConfig** is UI-only. **Front/back** are edited separately; **generateView** is explicit; **createMockJob** reads from `renderSetup.front` or `renderSetup.back` by view. Backward compat: effective config falls back to renderConfig + product when renderSetup is missing.

**Legacy / reference (superseded by current implementation):**

| Spec (`renderSetup`)              | Current implementation                                      |
|-----------------------------------|-------------------------------------------------------------|
| `renderSetup.front.blankImageUrl` | `renderConfig.selectedBlankImageUrl` (single; side from `renderConfig.renderSide`) |
| `renderSetup.back.blankImageUrl`  | Same URL today; back blank could be from blank’s back view  |
| `renderSetup.front.designAssetUrl`| `renderConfig.selectedDesignImageUrlFront`                  |
| `renderSetup.back.designAssetUrl` | `renderConfig.selectedDesignImageUrlBack`                  |
| `renderSetup.front.designAssetId` | `product.designIdFront`                                     |
| `renderSetup.back.designAssetId`  | `product.designIdBack`                                      |
| `renderSetup.front.placementKey`  | `renderConfig.placementKey` when side is front              |
| `renderSetup.back.placementKey`   | `renderConfig.placementKey` when side is back               |
| `renderSetup.defaults`            | `product.blankId`, `product.designIdFront`, `product.designIdBack` |
| `maskUrl` / `blendMode` / `blendOpacity` | Not yet in UI or renderer                          |

**Migration path:**

1. **Populate `renderSetup` from current choices**  
   When the user saves Render Setup (blank, design front/back, placement), also write:
   - `renderSetup.front`: `blankImageUrl` (front view of selected blank), `designAssetUrl` (from selected front design PNG), `designAssetId` = `designIdFront`, `placementKey` = `"front_center"` (or chosen key).
   - `renderSetup.back`: same for back view/design/placement.
   - `renderSetup.defaults`: `blankId`, `designIdFront`, `designIdBack`.

2. **Read from `renderSetup` when present**  
   In the Product Detail UI and in `createMockJob`, if `product.renderSetup?.front` (or `.back`) exists, use those URLs and placement key instead of resolving from `renderConfig` + design docs.

3. **Readiness**  
   Require `renderSetup.front.blankImageUrl`, `renderSetup.front.designAssetUrl`, `renderSetup.front.placementKey` (and same for `.back` when back design exists) for “Ready for Shopify sync.”

4. **Optional**  
   Add UI for blend mode/opacity and mask override; persist to `renderSetup.front`/`.back` and use in the render pipeline when supported.

---

# 9. Next: Renderer correctness

With the data model in place, the next focus is **renderer correctness** so that output matches Photoshop-quality expectations:

1. **Correct design asset** — Verify the render pipeline uses the design URL from the selected view’s config (e.g. `renderSetup.front.designAssetUrl` for view `"front"`). No cross-side or fallback design.
2. **Correct blank side** — Verify the blank image URL used is the one for the requested view (front vs back). No wrong view or single-blank assumption.
3. **placementKey and placementOverride** — Verify the renderer applies the placement from the selected view’s config: placementKey (e.g. `front_center`) for slot lookup, and placementOverride (x, y, scale) for position/size.
4. **Artwork-bounds detection** — Verify artwork bounds are detected (e.g. from design PNG alpha or content) **before** scaling/placement, so scaling and centering are correct and padding/bounds logic matches the design asset.
