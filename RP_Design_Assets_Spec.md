# RP_Design_Assets_Spec.md
**Project:** Rally Panties DesignOps  
**Module:** Design Assets Library (PNG + Print PDF + Color Tags + Team Tags)  
**Audience:** Cursor (build spec)  
**Status:** v1.0 (MVP)  
**Last updated:** 2026-01-25

---

## 0) Context / Why we’re building this
Rally Panties needs a **single source of truth** for reusable artwork files (“designs”) that can be applied across multiple **blank garments** (LA Apparel panty/thong + tanks + sweatshirt). We do **not** want to build a Photoshop/Canva-style editor. Instead, we want:

- A clean place to **upload**:
  - **PNG** (primary art file used for mockups/AI/compositing)
  - **PDF** (print-ready file the screen printer needs)
- A structured way to store required production metadata:
  - **Team** (e.g., SF Giants)
  - **Print colors** (one or more **hex codes**, optionally named like “Pantone-ish labels”)
  - Optional notes (ink type, underbase guidance, “white ink required”, etc.)
- A way to **apply** one design to many blanks (products can be created from “Design × Blank Variant” combos)
- A way to output a **“print pack”** (bundle) per design or per product: design PNG + PDF + color list + blank SKU metadata.

This module is intentionally **simple**: upload, tag, relate, and export. No on-canvas editing.

---

## 1) Non-goals (explicit)
- No drag/drop design placement tool (Photoshop/Canva clone)
- No vector editing
- No auto-tracing or separations (future phase)
- No automatic Shopify product creation in MVP (future phase)

---

## 2) Key concepts & vocabulary
- **Design**: A reusable artwork concept (e.g., “SF Giants Design 1”).
- **Design Asset**: A specific file (PNG/PDF) attached to a Design.
- **Blank Variant**: A specific blank garment/colorway (already in Blanks Library).
- **Product** (existing): Likely “Team + Design + Blank Variant” resulting in a sellable item later.
- **Print Placement Defaults**: Normalized coordinates defining where artwork sits (front center, back center, etc.).

---

## 3) UX summary (MVP)
### 3.1 Navigation
Add a top nav item:
- **Designs** (or **Artwork**)

### 3.2 Designs List page
Route:
- `/designs`

Table columns (desktop) / cards (mobile):
- Thumbnail (from PNG)
- Design Name
- Team (chip)
- Color count (chip) + first color swatches
- Status (Draft / Active / Archived)
- “Coverage” (how many blank variants linked or how many products created—optional)
- Updated
- Actions: View, Duplicate, Archive

Filters:
- Search (name, tags, team)
- Team
- Status
- Has PDF (yes/no)
- Has PNG (yes/no)

Primary CTA:
- **+ Create Design**

Secondary CTA:
- **Import Pack** (future)

### 3.3 Create / Edit Design (Detail page)
Route:
- `/designs/:designId`

Header:
- Title: `TEAM — Design Name`
- Status pills: Draft / Active / Archived
- Quick metadata chips (team, tags)
- Buttons: Save, Export Print Pack, Duplicate, Archive

Tabs:
1) **Overview**
2) **Files**
3) **Colors**
4) **Links** (Blanks + Products)
5) **Notes**

---

## 4) Data model (Firestore)
### 4.1 Collections overview
We’ll follow the same pattern used in your Blanks Library (single-tenant MVP). If you later add multi-team / multi-user roles, this structure already supports it.

**Root collections:**
- `designs/{designId}`  
- `teams/{teamId}` (lightweight metadata)  
- `print_packs/{packId}` (optional pre-generated export bundles; MVP can generate on-demand)

**Optional subcollections:**
- `designs/{designId}/logs/{logId}` (audit)
- `designs/{designId}/links/{linkId}` (link objects to blanks/products)

> If your existing app already namespaces everything under something like `rp/{orgId}/...`, keep the same convention. In this spec we show root collections for clarity—Cursor should map to your existing pattern.

---

### 4.2 Firestore document schemas (TypeScript)
#### 4.2.1 `teams/{teamId}`
```ts
export type TeamDoc = {
  id: string;                 // 'sf_giants'
  name: string;               // 'SF Giants'
  league?: string;            // 'MLB'
  primaryColorHex?: string;   // '#FD5A1E'
  tags?: string[];            // ['mlb','giants']
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
```

#### 4.2.2 `designs/{designId}`
```ts
export type DesignStatus = 'draft' | 'active' | 'archived';

export type DesignFile = {
  kind: 'png' | 'pdf';
  storagePath: string;     // 'designs/{designId}/files/...'
  downloadUrl?: string;    // cached, optional
  fileName: string;
  contentType: string;     // 'image/png' | 'application/pdf'
  sizeBytes: number;
  widthPx?: number;        // PNG only
  heightPx?: number;       // PNG only
  sha256?: string;         // idempotency / dedupe
  uploadedAt: FirebaseFirestore.Timestamp;
  uploadedByUid: string;
};

export type DesignColor = {
  hex: string;             // '#000000'
  name?: string;           // 'Black' / 'Giants Orange'
  role?: 'ink' | 'accent' | 'underbase' | 'unknown';
  notes?: string;          // e.g. 'white underbase required'
};

export type DesignPlacementDefault = {
  placementId: 'front_center' | 'back_center' | string;
  // normalized coordinates within the blank preview image:
  // x,y in [0..1] representing center point
  x: number;               // e.g. 0.50
  y: number;               // e.g. 0.50
  // scale is relative to the shorter dimension of the blank image
  scale: number;           // e.g. 0.60
  // safe area (padding) inside which the art must remain
  safeArea: {
    padX: number;          // e.g. 0.20 (20% padding)
    padY: number;          // e.g. 0.20
  };
  // optional rotation support (future)
  rotationDeg?: number;    // default 0
};

export type DesignDoc = {
  id: string;                       // auto-id
  name: string;                     // 'Design 1'
  slug: string;                     // 'sf-giants-design-1'
  teamId: string;                   // 'sf_giants'
  teamNameCache?: string;           // 'SF Giants' (for list speed)
  status: DesignStatus;

  tags: string[];                   // ['sf-giants','mlb','orange-black']
  description?: string;

  // Files
  files: {
    png?: DesignFile;
    pdf?: DesignFile;
  };

  // Production colors
  colors: DesignColor[];            // 1+ ink colors
  colorCount: number;               // denorm for filtering

  // Placement defaults (used by mock generator / product templates)
  placementDefaults: DesignPlacementDefault[];

  // Links (denorm quick stats)
  linkedBlankVariantCount: number;  // how many blank variants are associated
  linkedProductCount: number;       // products that use this design

  // Completeness indicators
  hasPng: boolean;
  hasPdf: boolean;
  isComplete: boolean;              // hasPng && hasPdf && colors.length>0 && teamId set

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdByUid: string;
  updatedByUid: string;
};
```

#### 4.2.3 `designs/{designId}/links/{linkId}`
Links are optional in MVP; you can also store links in product docs. This helps query “what blanks can this design go on?”

```ts
export type DesignLinkType = 'blank_variant' | 'product';

export type DesignLinkDoc = {
  id: string;
  type: DesignLinkType;

  // when linking to blank variants:
  blankId?: string;            // blank style group
  blankVariantId?: string;     // specific colorway
  blankSku?: string;           // supplier SKU or internal sku
  blankNameCache?: string;     // e.g. 'LA Apparel 8394'
  blankColorCache?: string;    // e.g. 'Black'

  // when linking to products:
  productId?: string;
  productNameCache?: string;

  createdAt: FirebaseFirestore.Timestamp;
  createdByUid: string;
};
```

---

## 5) Storage (Firebase Storage) conventions
Use deterministic paths so files are easy to find:

- `designs/{designId}/png/{originalFileName}`
- `designs/{designId}/pdf/{originalFileName}`
- (optional) `designs/{designId}/thumb/{generatedThumbFileName}`

Requirements:
- PNG must be `image/png`
- PDF must be `application/pdf`
- Max sizes (MVP):
  - PNG: 25MB
  - PDF: 50MB

---

## 6) Placement defaults explained (what you’re seeing in UI)
You have a “Placements” tab showing rows like:

- **Front Center (front_center)**
  - **Position (X,Y)**: `0.50, 0.50`
  - **Scale**: `0.60`
  - **Safe Area**: `0.20, 0.20 (0.60 x 0.60)`

Interpretation (normalized placement system):
- We render the blank image in a preview box.  
- **X, Y** are **normalized coordinates** (0 to 1):
  - `x=0.50` = horizontal center
  - `y=0.50` = vertical center
- **Scale** is a normalized size multiplier:
  - `0.60` means the design’s bounding box should fit within ~60% of the available dimension (implementation detail below).
- **Safe Area** is the **padding** from edges where printing should NOT go:
  - `padX=0.20` and `padY=0.20` means: keep artwork within the central area that excludes 20% margin on each side.
  - That yields an inner rectangle of `(1 - 2*0.20) = 0.60` width and height, hence `(0.60 x 0.60)`.

### Recommended implementation detail (simple + stable)
For preview placement calculations:
1) Compute safe bounds:
   - `safeLeft = padX`
   - `safeRight = 1 - padX`
   - `safeTop = padY`
   - `safeBottom = 1 - padY`
2) Place artwork center at `(x,y)` in normalized space, but clamp it so it stays inside safe bounds.
3) Compute artwork render size:
   - Let `safeW = safeRight - safeLeft`
   - Let `safeH = safeBottom - safeTop`
   - Let `base = min(safeW, safeH)`
   - Let `artBoxSize = base * scale`
4) Render the PNG as “contain” within `artBoxSize` square (or maintain its aspect ratio inside that box).

This is enough for consistent mock generation without needing a full editor.

### Default placements for MVP
Set these defaults on every new Design (unless overridden later):
- `front_center`: `x=0.50, y=0.50, scale=0.60, padX=0.20, padY=0.20`
- `back_center`:  `x=0.50, y=0.50, scale=0.60, padX=0.20, padY=0.20`

> Later: per-blank overrides (e.g., different safe area for thong vs sweatshirt).

---

## 7) Cloud Functions (Firebase)
### 7.1 `onDesignWrite` (compute denormalized flags)
Trigger:
- Firestore `onWrite` for `designs/{designId}`

Responsibilities:
- Ensure `hasPng`, `hasPdf`, `colorCount`, `isComplete` are correct
- Maintain `updatedAt`, `updatedByUid` (if your client doesn’t)

Pseudo:
- `hasPng = !!files.png`
- `hasPdf = !!files.pdf`
- `colorCount = colors.length`
- `isComplete = hasPng && hasPdf && colorCount > 0 && !!teamId && status !== 'archived'`

### 7.2 `uploadDesignFile` (callable or HTTPS) — optional
You can upload directly from client using Storage SDK.  
But if you want stronger validation + hashing + metadata extraction, use an HTTPS function.

Inputs:
- `designId`
- `kind: 'png' | 'pdf'`
- `fileName`, `contentType`, `sizeBytes`, `sha256` (optional)

Behavior:
- Validate mime/types & size
- Return signed upload URL (if using GCS signed URLs), OR allow client direct upload and then call `finalizeDesignFile`.

### 7.3 `finalizeDesignFile` (Storage finalize trigger)
Trigger:
- Storage `onFinalize` for `designs/{designId}/(png|pdf)/...`

Responsibilities:
- Read metadata (contentType, size)
- If PNG: read dimensions (sharp)
- Compute sha256 (optional)
- Write `designs/{designId}.files[kind]` with metadata
- Optionally create thumbnail and store `files.pngThumb`

### 7.4 `generatePrintPack` (HTTPS)
Trigger:
- HTTPS callable: `generatePrintPack({ designId, mode })`

Returns:
- A JSON payload with:
  - design metadata
  - file download URLs
  - colors list
  - optional linked blanks/products

Optionally:
- Generate a single ZIP in Storage: `print_packs/{designId}/{timestamp}.zip`
- Store `print_packs/{packId}` doc for retrieval

MVP approach:
- **On-demand JSON export** first; ZIP later.

---

## 8) Firestore Security Rules (MVP)
Assumptions:
- You already have auth and an admin role check (e.g., `isAdmin()`).
- Only admins can create/edit designs in MVP.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() {
      // Replace with your existing role logic
      return isSignedIn() && request.auth.token.admin == true;
    }

    match /teams/{teamId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /designs/{designId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();

      match /links/{linkId} {
        allow read: if isSignedIn();
        allow write: if isAdmin();
      }

      match /logs/{logId} {
        allow read: if isAdmin();
        allow create: if isAdmin();
        allow update, delete: if false;
      }
    }

    match /print_packs/{packId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
  }
}
```

### Storage rules (MVP)
```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() { return isSignedIn() && request.auth.token.admin == true; }

    match /designs/{designId}/{folder}/{fileName} {
      allow read: if isSignedIn();
      allow write: if isAdmin()
        && (folder == 'png' || folder == 'pdf' || folder == 'thumb');
    }

    match /print_packs/{allPaths=**} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
  }
}
```

---

## 9) UI details (MUI)
### 9.1 Create Design modal (simple)
Fields:
- Team (autocomplete from `teams`)
- Design Name (required)
- Tags (optional)
- Default placements: prefilled (front/back center)

On submit:
- Create `designs/{designId}` with:
  - status `draft`
  - empty `files`, empty `colors`
  - default placements
  - denorm flags false
- Navigate to detail page.

### 9.2 Files tab (PNG + PDF)
Layout:
- Two cards side-by-side:
  - PNG Upload
  - PDF Upload

Each card shows:
- Preview (PNG shows image; PDF shows icon + filename)
- File metadata (size, dimensions if PNG)
- Buttons: Upload / Replace / Remove

On upload success:
- Update doc `files.png` or `files.pdf` (either via finalize trigger or direct write after upload).

### 9.3 Colors tab
- List of color rows:
  - color swatch
  - hex input (validated `^#([0-9A-Fa-f]{6})$`)
  - optional name
  - optional role select
  - notes
- Add color button
- Auto-update `colorCount`

### 9.4 Links tab
Two sections:

**A) “Recommended blanks”**
- Multi-select list of blank variants (from your Blanks Library)
- Add link(s) as `designs/{designId}/links/{linkId}` docs
- Update `linkedBlankVariantCount` (denorm, via function or client)

**B) “Products using this design”**
- Read-only list of products that reference this design (query products collection by `designId`)

### 9.5 Notes tab
- Multi-line notes for printer instructions
- Optional structured fields later (ink type, mesh count, etc.)

---

## 10) Integration points with existing modules
### 10.1 Products
A product should reference:
- `designId`
- `blankVariantId`
- `teamId`

This allows batch generation:
- Choose a design → select many blank variants → generate many products.

### 10.2 Batch Generate workflow (future but plan now)
A “Batch Generate” action should accept:
- `designId`
- `blankVariantIds[]`
- `placements` (use design defaults)
Then produce:
- product docs
- mock generation jobs (FAL/Flux pipeline) (separate spec)

---

## 11) Task order (build plan for Cursor)
### Phase 1 — Data + rules (foundation)
1. Add Firestore types/interfaces for `DesignDoc`, `TeamDoc`
2. Add Firestore rules for `designs`, `teams`, `print_packs`
3. Add Storage rules for `designs/*` uploads

### Phase 2 — UI: Designs List + Create + Detail skeleton
4. Add routes: `/designs`, `/designs/:designId`
5. Build DesignsList table + filters
6. Build CreateDesign modal + create doc

### Phase 3 — UI: Files (PNG/PDF) + Colors
7. Implement Storage upload components (PNG/PDF)
8. Save file metadata into Firestore doc
9. Implement Colors tab (hex validation + roles)

### Phase 4 — Placement defaults + preview
10. Implement Placements tab (read-only MVP)
11. Implement preview rendering logic (normalized placement system)

### Phase 5 — Export / Print Pack
12. Implement “Export Print Pack” button:
    - Generate JSON export (download)
    - (optional) create a `print_packs` doc

### Phase 6 — Links to blanks
13. Implement Links tab (associate blank variants)
14. Denormalize counts for list view (optional function)

---

## 12) Acceptance criteria (MVP)
- Admin can create a design with Team + Name.
- Admin can upload a PNG and a PDF and see them persist.
- Admin can add 1+ hex colors and see swatches.
- Design list shows status + completeness (Missing/Complete).
- Placement defaults are visible and explained; preview uses normalized logic.
- Export produces a printable “packet” (JSON at minimum) that includes:
  - design name, team, colors
  - links to PNG and PDF
  - placement defaults
- Security rules prevent non-admin edits.

---

## 13) Future enhancements (not now)
- ZIP export with files included
- Color separation / layer management
- Per-blank placement overrides
- Shopify integration (auto create products + variants)
- Printer portal / approvals workflow
- Versioning (design v1/v2) + audit diffs

---

## 14) Cursor instructions (paste into Cursor)
> Build this spec exactly as written. Do not infer or simplify.  
> Start with Phase 1 and proceed in order.  
> Use existing project patterns for auth/roles/routing/components.

