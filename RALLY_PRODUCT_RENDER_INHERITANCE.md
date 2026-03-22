# Product render inheritance (blank → product)

## Ownership

| Layer | Role |
|--------|------|
| **Blank** (`rp_blanks.placements[]`, `renderDefaults`, zone `renderZoneDefaults`) | **Canonical** placement geometry, safe area, zone blend, 8394 simple controls. |
| **Variant** (`variants[].renderOverrides`, images) | Colorway images + optional blend overrides; not the owner of placement rows. |
| **Design** | Artwork assets only; `placementDefaults` are advisory for legacy flows, not the default engine source. |
| **Product** (`placementOverrides`, `renderOverrides`) | **Optional** per-SKU deviation only. Omit = inherit blank (+ variant) fully. |

## Product fields

- `placementOverrides.front` / `.back` — `{ defaultX?, defaultY?, defaultScale?, safeArea? }`
- `renderOverrides.front` / `.back` — `{ blendMode?, blendOpacity?, renderStylePreset? }`
- **Legacy:** `renderSetup.*.placementOverride` and `renderSetup.*.blendMode` are still read as overrides until migrated (see `resolveProductRenderProfile`).

## Resolution

Shared helpers (client: `lib/products/resolveProductRenderProfile.ts`, server: `functions/lib/resolveProductRenderProfile.js`):

- `resolveEffectivePlacement(product, blank, side)`
- `resolveEffectiveRenderSettings(product, blank, variant, placementRow, side)`
- `getPlacementFingerprintSliceForProduct(blank, product, side)` — for **flat render fingerprint** / stale detection

Order: structured product override → legacy `renderSetup` → blank row (+ variant for blend).

## Creation

`createProductFromDesignBlank` **does not** copy blank blend/placement into `renderSetup`. Products inherit at render time.

## UI copy

Prefer: **Blank default**, **Inherited from blank**, **Product override**, **Reset to blank default**.
