# RP Blanks Library — FINAL Build Spec (v2)
**Project:** Rally Panties DesignOps  
**Doc Type:** Cursor-ready implementation spec  
**Version:** v2 (adds Tanks + Crewneck)  
**Status:** Build exactly as written. This file is the source of truth.

---

## 0) Context / Why we’re doing this (do not skip)
We need a **manual, supplier-truth “Blanks Library”** that represents the *real, physical garments* we’ll print on. This must exist **before** we optimize AI models (e.g., “Amber”) or do large-scale generation, because:

- Our generation pipeline currently “floats” without a grounded product substrate, causing **style drift** and inconsistent mockups.
- We only intend to carry a small curated set of blanks. A tight set gives us:
  - repeatable prompts
  - consistent mockups
  - predictable print placement
  - simpler ops and faster approvals

**Immediate goal:** Make blanks easy to create, browse, filter, and attach to products & generations.  
**Scope:** Product-accurate blanks only (no model training here).

---

## 1) Scope (Locked)
### 1.1 Garments / Styles we will carry (ONLY these)
**Panties**
1) LA Apparel **8394** (Bikini Panty)  
2) LA Apparel **8390** (Thong Panty)

**Tank Tops**
3) LA Apparel **TR3008** (Tri-blend Racerback Tank)  
4) LA Apparel **1822GD** (Garment Dye Crop Tank)

**Sweatshirt**
5) LA Apparel **HF07** (Heavy Fleece Crewneck, Garment Dye)

### 1.2 Colors we will carry (ONLY these per style)
**8394 Bikini Panty:** Black, White, Midnight Navy, Blue, Red, Heather Grey  
**8390 Thong Panty:** Black, White, Midnight Navy, Blue, Red, Heather Grey

**TR3008 Racerback Tank:** Black, Indigo, Athletic Grey  
**1822GD Crop Tank:** Black, Blue, White  
**HF07 Crewneck:** Black, Navy, Off-White

### 1.3 Angles required per blank
- **Panties & Thongs:** Front flat-lay + Back flat-lay (2 images required)
- **Tank tops:** Front flat-lay + Back flat-lay (2 images required)
- **Crewneck:** Front flat-lay + Back flat-lay (2 images required)

> Note: We can support “optional” additional angles later, but **MVP requires exactly 2**.

### 1.4 What is NOT in scope
- “Amber” or model training
- AI-driven background removal (we assume uploads are clean, but we can add optional helpers)
- Full print proofing pipeline (DTF layout etc.) beyond basic placement metadata fields
- E-commerce publishing workflows

---

## 2) UX Goals (Make it user-friendly)
Because we have a small fixed catalog:
- Blanks creation should be **guided + minimal** (no free-form SKU chaos).
- Prefer **dropdowns** for Style + Color.
- Auto-generate sensible IDs and default values.

**User story:**
1) Admin opens **Blanks** tab.
2) Clicks **“+ Create Blank”**.
3) Chooses Style (8394 / 8390 / TR3008 / 1822GD / HF07).
4) Chooses Color (filtered by style).
5) Uploads Front + Back images (required).
6) Save.
7) Blank is now available to attach to a Product.

---

## 3) Data Model (Firestore)
### 3.1 Collections (Top-level)
Create a new top-level collection:

- `rp_blanks` (single source of truth for all blanks)

> We keep this top-level (not nested) because it’s a global library shared across products.

### 3.2 Document ID strategy
Use Firestore auto-id for documents. Maintain a `slug` field for stable human-readable references.

### 3.3 `rp_blanks/{blankId}` schema
```ts
type RPBlank = {
  // identity
  blankId: string;              // same as doc id (denormalized)
  slug: string;                 // e.g. "laa-8394-black"
  status: "draft" | "active" | "archived";

  // supplier + style
  supplier: "Los Angeles Apparel";
  garmentCategory: "panty" | "thong" | "tank" | "crewneck";
  styleCode: "8394" | "8390" | "TR3008" | "1822GD" | "HF07";
  styleName: string;            // derived display label
  supplierUrl: string;          // canonical product page link
  supplierSku?: string;         // optional; some styles have variants

  // color
  colorName: "Black" | "White" | "Midnight Navy" | "Blue" | "Red" | "Heather Grey"
          | "Indigo" | "Athletic Grey" | "Navy" | "Off-White";
  colorHex?: string;            // optional but recommended

  // images (required: front + back)
  images: {
    front: RPImageRef | null;
    back: RPImageRef | null;
  };

  // image metadata (optional)
  imageMeta?: {
    background: "white" | "transparent" | "unknown";
    source: "supplier" | "photo" | "generated";
    notes?: string;
  };

  // print placement defaults (used later by Designs/Generation)
  placements: Array<{
    placementId: "front_center" | "back_center" | "front_left" | "front_right" | "back_left" | "back_right";
    label: string;
    defaultX?: number;          // relative 0..1
    defaultY?: number;          // relative 0..1
    defaultScale?: number;      // relative 0..1
    safeArea?: { x: number; y: number; w: number; h: number }; // relative 0..1
  }>;

  // search + ops
  tags: string[];               // e.g. ["panty","8394","black","los-angeles-apparel"]
  searchKeywords: string[];     // lowercased tokens used for simple search
  createdAt: FirebaseTimestamp;
  createdBy: { uid: string; email?: string };
  updatedAt: FirebaseTimestamp;
  updatedBy: { uid: string; email?: string };
};
type RPImageRef = {
  storagePath: string;          // gs://... or path
  downloadUrl: string;
  width?: number;
  height?: number;
  contentType?: string;
  bytes?: number;
};
```

### 3.4 Deterministic defaults
- `supplier` is always `"Los Angeles Apparel"`
- `styleName` derived from `styleCode`
- `garmentCategory` derived from `styleCode`
- `placements` auto-generated per category (see §6.4)
- `tags` auto-generated
- `searchKeywords` auto-generated

---

## 4) Storage (Firebase Storage) layout
Store blank images in:

- `rp/blanks/{blankId}/front.{ext}`
- `rp/blanks/{blankId}/back.{ext}`

Optionally store derived thumbnails:
- `rp/blanks/{blankId}/thumb_front.jpg`
- `rp/blanks/{blankId}/thumb_back.jpg`

---

## 5) Admin UI Requirements (MUI)
### 5.1 Navigation
Add a new top nav item: **Blanks** (between Products and Review is fine, or next to Products)

Route:
- `/blanks` = list view
- `/blanks/:blankId` = detail view

### 5.2 Blanks List View (`/blanks`)
Layout follows existing Products list style.

**Header**
- Title: “Blanks Library”
- Subtitle: “Curated source of truth for supplier-provided blank garments.”
- Primary button: `+ Create Blank`

**Filters (Row)**
- Search input (by slug/style/color)
- Style dropdown (All / 8394 / 8390 / TR3008 / 1822GD / HF07)
- Category dropdown (All / panty / thong / tank / crewneck)
- Color dropdown (All + limited)
- Status dropdown (All / draft / active / archived)

**Grid/Table**
Columns:
- Preview (front thumb)
- Style (code + name)
- Color (chip + name)
- Category
- Status (chip)
- Completeness (front/back uploaded)
- Updated (date)
- Actions (View, Archive)

> Completeness is critical. If front/back missing, show a warning icon.

### 5.3 Create Blank Modal (User-friendly)
Modal title: “Create New Blank”

**Form fields**
1) Style (required) — dropdown (8394, 8390, TR3008, 1822GD, HF07)
2) Color (required) — dropdown filtered based on style
3) Status default = `draft` (hidden or optional)
4) Optional: Color hex (optional; prefill suggestions per color)
5) Upload area:
   - Front image required
   - Back image required
   - Show drag/drop zones with preview

**Behavior**
- On style selection:
  - auto-set category
  - auto-set styleName
  - auto-set supplierUrl
  - filter colors
- On save:
  - create Firestore doc
  - upload images to Storage
  - update Firestore `images.front/back` with URLs and metadata

### 5.4 Blank Detail View (`/blanks/:blankId`)
Two-column layout:

**Left column**
- Front image large preview
- Back image large preview
- Upload replace buttons

**Right column (Metadata card)**
- Style (code + name)
- Category
- Color (chip + hex)
- Supplier link
- Status (editable)
- Created/Updated metadata
- “Generate searchKeywords” button (admin utility; mostly for debugging)

**Bottom section**
- Placements table (read-only for now; later editable)

---

## 6) Business Logic / Constants
### 6.1 Style registry (hard-coded constants)
Create a TS module:

`src/rp/blanks/styleRegistry.ts`

```ts
export type BlankStyleCode = "8394" | "8390" | "TR3008" | "1822GD" | "HF07";

export const STYLE_REGISTRY: Record<BlankStyleCode, {
  supplier: "Los Angeles Apparel";
  garmentCategory: "panty" | "thong" | "tank" | "crewneck";
  styleName: string;
  supplierUrl: string;
  allowedColors: string[];
}> = {
  "8394": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "panty",
    styleName: "Bikini Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8394-bikini-panty",
    allowedColors: ["Black","White","Midnight Navy","Blue","Red","Heather Grey"],
  },
  "8390": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "thong",
    styleName: "Thong Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8390-thong-panty",
    allowedColors: ["Black","White","Midnight Navy","Blue","Red","Heather Grey"],
  },
  "TR3008": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Tri-blend Racerback Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/tr3008-tri-blend-racerback-tank",
    allowedColors: ["Black","Indigo","Athletic Grey"],
  },
  "1822GD": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Garment Dye Crop Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/1822gd-garment-dye-crop-tank",
    allowedColors: ["Black","Blue","White"],
  },
  "HF07": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "crewneck",
    styleName: "Heavy Fleece Crewneck (Garment Dye)",
    supplierUrl: "https://losangelesapparel.net/products/hf07-heavy-fleece-crewneck-sweater-garment-dye",
    allowedColors: ["Black","Navy","Off-White"],
  },
};
```

### 6.2 Color registry (optional)
`src/rp/blanks/colorRegistry.ts` that maps known colors to suggested hexes.
If unknown, allow manual entry.

### 6.3 Slug builder
`slug = "laa-" + styleCode.toLowerCase() + "-" + colorName.toLowerCase().replace(" ","-")`

Examples:
- `laa-8394-black`
- `laa-tr3008-athletic-grey`
- `laa-hf07-off-white`

### 6.4 Default placements
Implement a helper:
`getDefaultPlacements(category)`

- panties/thongs: front_center, back_center
- tanks: front_center, back_center
- crewneck: front_center, back_center

Set safeArea defaults as conservative central rectangles (tunable later).

---

## 7) Cloud Functions (Firebase)
We need minimal functions primarily for:
- **idempotent image metadata updates**
- **thumbnail generation** (optional but recommended)
- **searchKeywords regeneration** (admin utility)

### 7.1 `onBlankWrite` (Firestore trigger)
Path: `rp_blanks/{blankId}`  
Trigger: onCreate + onUpdate

Responsibilities:
- Ensure `blankId` stored equals doc id
- Auto-generate:
  - `tags`
  - `searchKeywords`
- Validate:
  - styleCode exists in registry
  - color allowed for style
- If invalid, set status `draft` and attach `validationErrors` (optional)

> Keep this safe: do not delete docs; only annotate.

### 7.2 `generateBlankThumbnails` (Storage trigger) — optional but recommended
Trigger on finalize for:
- `rp/blanks/{blankId}/front.*`
- `rp/blanks/{blankId}/back.*`

Creates jpg thumbnails and writes back to Firestore imageMeta if desired.

### 7.3 Callable: `rebuildBlankSearchKeywords`
Admin-only callable function
- Recomputes `searchKeywords` and `tags` for all blanks or one blank

---

## 8) Firestore Security Rules
Assume we have role-based auth already (admin users).
Implement:

- Read: authenticated users
- Write: admin only

### 8.1 Rules snippet
```rules
match /rp_blanks/{blankId} {
  allow read: if request.auth != null;

  allow create, update, delete: if request.auth != null
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.accessRole == "admin";
}
```

> Adjust the admin check to match your existing auth model if different (e.g. `securityLevel >= X`).

---

## 9) Task Order (Implementation Plan)
**Build in this exact order:**

### Phase 1 — Data + Registry
1) Add `STYLE_REGISTRY` + `colorRegistry`
2) Add TypeScript types (`RPBlank`, `RPImageRef`)
3) Add Firestore collection access helpers (CRUD)

### Phase 2 — UI (List + Create + Detail)
4) Add nav item + routes `/blanks`, `/blanks/:blankId`
5) Build list page with filters + table
6) Build create modal with style/color dropdowns + image upload
7) Build detail view with front/back previews and metadata

### Phase 3 — Storage Integration
8) Implement upload helper:
   - uploads images to `rp/blanks/{blankId}/front/back`
   - captures metadata
   - writes `images` refs to Firestore

### Phase 4 — Functions + Rules
9) Add Firestore rules for `rp_blanks`
10) Add `onBlankWrite` function to normalize/validate and generate tags/searchKeywords
11) (Optional) Add thumbnail generation function

### Phase 5 — Seed Starter Data (Recommended)
12) Add a script or admin UI “Seed defaults” that creates all expected blank docs (without images)
    - This helps you quickly fill them in with uploads.

---

## 10) Seed Set (What should exist in the library)
### 10.1 Panties / Thongs (12 total)
- 8394 x 6 colors = 6 blanks (each needs front/back)
- 8390 x 6 colors = 6 blanks

Colors:
- Black
- White
- Midnight Navy
- Blue
- Red
- Heather Grey

### 10.2 Tanks (6 total)
- TR3008 x 3 colors = 3 blanks
  - Black, Indigo, Athletic Grey
- 1822GD x 3 colors = 3 blanks
  - Black, Blue, White

### 10.3 Crewneck (3 total)
- HF07 x 3 colors = 3 blanks
  - Black, Navy, Off-White

**Total blanks in library after seeding:** 12 + 6 + 3 = **21**

---

## 11) Integration with Products (Minimal touch)
Your Product currently stores:
- `baseProduct` / category / colorway, etc.

Add a new optional field on Product (or later enforce):
- `blankId: string`

Behavior:
- When a Product is created, it should select a Blank from the library.
- Product “Generate” uses the Blank’s front/back imagery as the base for composition.

---

## 12) Acceptance Criteria
A build is complete when:

1) Admin can create a blank in < 60 seconds:
   - choose style
   - choose color
   - upload front/back
   - save

2) `/blanks` shows:
   - searchable list
   - filterable by style/category/color/status
   - completeness indicator

3) `/blanks/:id` shows:
   - front/back images
   - style/category/color/supplier link
   - status edit

4) Firestore rules prevent non-admin edits.

5) Firestore docs are normalized (tags/searchKeywords generated).

---

## 13) Notes for Cursor
- Do not add extra garment types.
- Do not allow arbitrary style/color combinations.
- Keep the UI consistent with the existing DesignOps pages (MUI, spacing, cards, subtle borders).
- Prioritize usability over flexibility.

**Build this spec exactly as written.**
