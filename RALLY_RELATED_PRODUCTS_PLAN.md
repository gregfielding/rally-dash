# Taxonomy-Driven Related Products — Implementation Plan

Goal: For a given product, surface similar products in a sensible order (same team → same theme → same league → same sport → same garment type) in a "Related Products" block on the Product detail page.

---

## 1. Existing product fields that already support this

All of the following exist on `RpProduct` and require **no schema changes**:

| Signal | Field(s) | Notes |
|--------|----------|--------|
| **Same team/entity** | `teamCode` | string \| null; aligns with rp_taxonomy_entities |
| **Same theme** | `themeCode` | string \| null; aligns with rp_taxonomy_themes |
| **Same league** | `leagueCode` | string \| null |
| **Same sport** | `sportCode` | string \| null |
| **Same garment type** | `category`, `blankId` | `category` = panties \| bralette \| tank \| tee \| other (high-level). `blankId` = specific physical blank (same cut/style). Use both: category for “same kind of product,” blankId for “same blank.” |

So the full priority order can be implemented today using:

- `teamCode`
- `themeCode`
- `leagueCode`
- `sportCode`
- `category` and/or `blankId` for garment type

No new product fields are required.

---

## 2. Schema additions

**None.** All signals above are already on the product. `entityType` correctly stays on the entity record and is not stored on the product.

---

## 3. Smallest implementation slice for a “Related Products” block

### 3.1 Approach: client-side scoring (no new indexes)

- **Fetch a candidate set** of products (e.g. active products, optionally scoped by `category` to keep size reasonable).
- **Exclude the current product** by `id` or `slug`.
- **Score each candidate** by strength of match (see below), then **sort by score descending** and take the top N (e.g. 8–12).
- **Render** a “Related Products” section on the Product detail page (Overview tab) with links and minimal product info (name, colorway, optional thumbnail).

This avoids new Firestore composite indexes and works with existing `useProducts` (or a thin wrapper) that fetches by `status: "active"` and optional `category` / `limit`.

### 3.2 Scoring (priority order)

Suggested weights (tune as needed):

1. **Same team/entity** — `teamCode` match → highest (e.g. +100).
2. **Same theme** — `themeCode` match → high (e.g. +80).
3. **Same league** — `leagueCode` match → medium (e.g. +50).
4. **Same sport** — `sportCode` match → lower (e.g. +30).
5. **Same garment type** — `category` match (+20) and/or `blankId` match (+25). Can combine.

Sum scores for each candidate; sort by total descending, then by a tie-breaker (e.g. `createdAt` desc). Exclude product with `product.id === candidate.id`.

### 3.3 Where it lives

| Piece | Location |
|-------|----------|
| **Candidate fetch** | Reuse `useProducts({ status: "active", limit: 100 })` or add optional `category: product.category` to narrow. No new hook required for slice 1. |
| **Scoring + sort** | Pure function in `lib/products/relatedProducts.ts` (or similar): `getRelatedProducts(currentProduct, candidates, limit)` → `RpProduct[]`. |
| **UI** | Product detail page, Overview tab: new “Related Products” block after Asset Statistics (or after Taxonomy). List/grid of links to `/products/[slug]` with name, colorway, optional image. |

### 3.4 Edge cases (minimal slice)

- **Few or no candidates** — Show block only if `related.length > 0`; otherwise hide.
- **Current product missing taxonomy** — Scoring still works; candidates with matching taxonomy will rank higher; products with no taxonomy will have lower scores.
- **Performance** — With a cap (e.g. 100 candidates) and client-side sort, this is acceptable for an admin dashboard; later you can move to a Cloud Function or precomputed field if needed.

### 3.5 Optional later enhancements (out of scope for smallest slice)

- Firestore queries filtered by `teamCode` / `themeCode` / etc. (would need composite indexes and merging of result sets).
- Thumbnail from product media or first asset.
- “Same base product” (e.g. `baseProductKey`) as an extra signal or tie-breaker.

---

## 4. Summary

| Question | Answer |
|----------|--------|
| **Existing fields** | `sportCode`, `leagueCode`, `teamCode`, `themeCode`, `category`, `blankId` — all on product, no schema change. |
| **Schema additions** | None. |
| **Smallest slice** | (1) `useProducts({ status: "active", limit })` (optional `category`), (2) `getRelatedProducts(product, candidates, 8)` in a small util, (3) “Related Products” block on Product detail Overview using that list. |

This gets a taxonomy-driven “Related Products” block working on the Product page with no schema changes and minimal new code.
