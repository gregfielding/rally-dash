# RP_Blanks_Library_Spec.md
## Rally Panties — Blanks Library (Source of Truth)

### Purpose & Context
Rally Panties is standardizing its product design pipeline by separating garment blanks from designs and models.
The Blanks Library is the canonical, human-curated source of truth for physical garments, colors, and base imagery.

This exists to:
- Prevent visual drift
- Enable predictable AI rendering
- Mirror real apparel workflows
- Reduce cognitive load for operators

---

## Business Constraints (Hard Rules)
- Supplier: Los Angeles Apparel ONLY
- Panty Styles:
  - 8394 — Bikini Panty
  - 8390 — Thong Panty
- Allowed Colors:
  - Black
  - White
  - Midnight Navy
  - Blue
  - Red
  - Heather Grey

No other suppliers, styles, or colors are allowed unless this document changes.

---

## Conceptual Model
Blank = physical garment + color + images  
Product = branded concept (e.g. SF Giants Panty)  
Design = artwork applied to blank  
Asset = rendered output (AI or composited)

Blanks are reusable across products.

---

## Firestore Schema

### Collection: blanks

```ts
blanks/{blankId}
```

```ts
interface Blank {
  id: string;

  supplier: "Los Angeles Apparel";
  supplierStyle: "8394" | "8390";
  garmentType: "panty";
  fitType: "bikini" | "thong";

  color: {
    name: "Black" | "White" | "Midnight Navy" | "Blue" | "Red" | "Heather Grey";
    hex: string;
  };

  images: {
    frontUrl: string;
    backUrl: string;
  };

  status: "active" | "archived";

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## Firebase Storage Layout

```
/blanks/
  /8394-bikini/
    /black/
      front.png
      back.png
  /8390-thong/
    /black/
      front.png
      back.png
```

One folder per style + color. Images are immutable once approved.

---

## Cloud Functions

### createBlank (callable, admin only)
- Validate supplier, style, and color
- Ensure front + back images exist
- Normalize color slug
- Create Firestore doc

### seedLABlanks (admin only)
- Creates 12 blanks (2 styles × 6 colors)
- Used for initial setup

### onBlankDelete
- Prevent deletion if referenced by products
- Archive instead of hard delete

---

## Security Rules

### Firestore
```rules
match /blanks/{blankId} {
  allow read: if request.auth != null;
  allow write: if request.auth.token.admin == true;
}
```

### Storage
```rules
match /blanks/{allPaths=**} {
  allow read: if request.auth != null;
  allow write: if request.auth.token.admin == true;
}
```

---

## Admin UI

### Route: /blanks

Table Columns:
- Thumbnail (front image)
- Style
- Fit
- Color
- Status
- Actions

Filters:
- Style
- Color
- Status

---

### Create Blank Modal (Admin Only)

Fields:
- Style (8394 / 8390 only)
- Color (predefined list)
- Color Hex (auto)
- Front Image Upload
- Back Image Upload

No free-text supplier input.

---

## Product Integration Rules
- Products reference blanks via blankIds[]
- Archived blanks cannot be selected
- Blank geometry drives AI generation
- Model (Amber) is layered later

---

## Task Order (STRICT)
1. Create Firestore collection
2. Apply security rules
3. Create Storage folders
4. Upload flat-lay images
5. Implement cloud functions
6. Build admin UI
7. Lock product creation to blanks
8. Disable ad-hoc garment creation

---

## Explicit Non-Goals
- No AI-generated blanks
- No scraping suppliers
- No extra garment types
- No model imagery here

---

## Final Note
This file is the source of truth.
Do not infer.
Do not generalize.
Implement exactly as written.
