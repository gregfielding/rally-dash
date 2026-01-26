# Rally Panties DesignOps — Inspiration Library System (Cursor-Ready Spec)

OWNER: Rally Panties DesignOps  
PURPOSE: Centralized, internal-only inspiration system to support AI design briefs, product design, and creative direction.

---

## 1. GOALS & WHY THIS EXISTS

The Inspiration Library exists to:
- Capture design inspiration from external sources (Etsy, Pinterest, Shopify, screenshots)
- Provide structured creative context to AI Design Briefs
- Maintain brand consistency across products, designs, and generations
- Prevent creative drift when generating AI concepts

This system is **internal-only** and explicitly **not for publishing**.

---

## 2. CORE CONCEPTS

### Inspiration Item
A single piece of creative reference:
- Image (screenshot, mockup, typography, layout)
- Optional URL (source)
- Tags + notes explaining why it’s relevant

### Inspiration Set
A curated group of inspiration items attached to:
- A Product
- A Design Brief
- A Design Concept (optional)

---

## 3. FIRESTORE SCHEMA

### Collection: `rp_inspirations`

```ts
rp_inspirations/{inspirationId} {
  title: string
  description?: string
  sourceType: 'etsy' | 'pinterest' | 'shopify' | 'screenshot' | 'internal' | 'other'
  sourceUrl?: string
  category?: 'panties' | 'bras' | 'tops' | 'general'
  tags: string[]
  licenseNote?: string // e.g. "Internal inspiration only"
  imageUrls: string[] // Firebase Storage URLs
  createdBy: string
  createdAt: Timestamp
}
```

---

### Product attachment
```ts
rp_products/{productId} {
  inspirationIds?: string[]
}
```

### Design brief attachment
```ts
rp_design_briefs/{briefId} {
  inspirationIds?: string[]
}
```

---

## 4. TYPESCRIPT TYPES

```ts
export type RpInspiration = {
  id: string
  title: string
  description?: string
  sourceType: RpInspirationSource
  sourceUrl?: string
  category?: RpProductCategory
  tags: string[]
  licenseNote?: string
  imageUrls: string[]
  createdBy: string
  createdAt: Timestamp
}

export type RpInspirationSource =
  | 'etsy'
  | 'pinterest'
  | 'shopify'
  | 'screenshot'
  | 'internal'
  | 'other'
```

---

## 5. STORAGE

### Firebase Storage
Path convention:
```
/rp/inspirations/{inspirationId}/{filename}.png
```

---

## 6. CLOUD FUNCTIONS

### createInspiration
```ts
createInspiration(data) => inspirationId
```

Responsibilities:
- Validate input (Zod)
- Upload images to Storage
- Create Firestore doc
- Return inspirationId + URLs

---

### attachInspirationToProduct
```ts
attachInspirationToProduct(productId, inspirationIds[])
```

---

### attachInspirationToBrief
```ts
attachInspirationToBrief(briefId, inspirationIds[])
```

---

## 7. REACT HOOKS

```ts
useInspirations(filters)
useCreateInspiration()
useAttachInspirationToProduct()
useAttachInspirationToBrief()
```

---

## 8. UI — INSPIRATION LIBRARY PAGE

Route:
```
/inspirations
```

Features:
- Grid view (image-first)
- Filters: sourceType, tags, category
- Search by title/tag
- Upload Inspiration button

Card shows:
- Thumbnail
- Title
- Tags
- Source badge (Etsy, Pinterest, etc.)

---

## 9. UI — UPLOAD INSPIRATION MODAL

Fields:
- Title (required)
- Description (optional)
- Source Type (dropdown)
- Source URL (optional)
- Category (optional)
- Tags (chip input)
- Image upload (1–5 images)

Validation:
- At least 1 image required
- Tags max 10

---

## 10. UI — ATTACHING INSPIRATION

### Product page
- Tab: "Inspiration"
- Multi-select from Inspiration Library
- Show attached inspirations as thumbnails

### AI Design Brief modal
- Section: "Inspiration"
- Select up to 8 inspiration items
- Selected inspirations passed to AI

---

## 11. AI DESIGN BRIEF INTEGRATION

When calling `createDesignBrief`, include:

```ts
{
  inspiration: inspirations.map(i => ({
    title: i.title,
    tags: i.tags,
    description: i.description
  }))
}
```

Prompt guidance:
- "Use these as visual inspiration only"
- "Do not replicate exact artwork"
- "Match style, layout, tone, placement"

---

## 12. SECURITY RULES (SUMMARY)

- Read: authenticated users
- Write: admin/design roles only
- Inspiration images never public

---

## 13. PHASED IMPLEMENTATION

### Phase 1 (MVP)
- Upload inspiration
- Browse inspiration library
- Attach to product
- Attach to AI brief

### Phase 2
- AI tag suggestion from images
- “Similar inspiration” suggestions
- Inspiration scoring / favorites

---

## 14. DESIGN PRINCIPLES

- Inspiration ≠ assets
- Inspiration is internal only
- Human-curated beats auto-scraped
- AI should follow inspiration, not clone it

---

END OF SPEC
