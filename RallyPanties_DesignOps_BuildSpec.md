# Rally Panties — DesignOps (AI-Powered Design + Mockup + Shopify Publisher)
*Build spec for Cursor (Google Auth + Firestore + Cloud Functions)*

## 0) Goal
Create an internal web app (“DesignOps”) that lets Rally Panties generate and publish **hundreds → thousands** of compliant, print-ready designs and ecommerce assets with minimal manual work.

**Primary outcomes**
- Generate **print-ready** art files (PNG + PDF) from repeatable “design families”
- Generate **product-page mockups** (Route A: photoreal flat-lay/hanger using base photos + warp/placement)
- Generate **social lifestyle assets** (Route B: AI models/LoRAs via API; used for ads & organic)
- Generate and publish Shopify product drafts (title/description/images/tags/collections/variants)
- Track all assets, prompts, approvals, and versions in Firestore
- Enforce **brand & trademark compliance rules** (no logos, no protected marks, no banned phrases)

---

## 1) MVP Scope (Phase 1)
### Must-have (MVP)
1. **Google Auth** (admin-only access)
2. Team & League library (palette, keywords, banned terms)
3. Design Generator (text + icon library + layout templates)
4. Print File Builder (exact print area + export PNG/PDF)
5. Mockup Generator — Route A
   - Apply generated design onto **base garment photos** with proper placement/warp
6. Social Generator — Route B (optional in MVP; recommended as “beta”)
   - Generate 3–6 lifestyle images using pre-trained model packs (LoRA IDs)
7. Shopify Publisher (create **draft products** + upload images)
8. Review & Approval workflow (draft → approved → published)

### Nice-to-have (Phase 1.5)
- Batch generation (e.g., “Create 10 Ohio State designs across panties/tank/crewneck”)
- A/B variant generator (colorways, alternate copy, alternate placements)
- Auto SEO landing pages (“Shop Ohio State”)

---

## 2) Key Product Concepts
### Route A — Product Page Mockups (conversion)
Use **real base photography** for each garment type and programmatically:
- place artwork into the print area
- apply warp/displacement to match fabric curves
- apply subtle shading blending
- export consistent ecommerce-ready images

**Why:** predictable, clean, no AI artifacts, better conversion.

### Route B — Social Lifestyle (virality)
Use AI image generation with **model packs** (LoRA IDs) to create consistent “Rally girls” content:
- game-day vibe, stadium/tailgate context
- team colors and seasonality
- portrait 4:5 for IG/TikTok ads
- do **not** rely on these for “exact print realism”

**Why:** scalable lifestyle content without photoshoots.

---

## 3) Architecture Overview (Google stack)
### Frontend
- **Next.js** (App Router) + TypeScript
- UI: MUI or Tailwind (pick one; keep consistent)
- Firebase Web SDK: Auth + Firestore + Storage
- Admin-only gating via custom claims and Firestore rules

### Backend
- **Google Cloud Functions (Gen2)** (Node 20, TypeScript)
- Firestore for data + workflow state
- Cloud Storage for:
  - print files (PDF/PNG/SVG)
  - mockups (web images)
  - base garment images
- Optional: Cloud Tasks for batch jobs and retries

### External integrations
- AI generation API(s) (choose one):
  - Replicate / FAL / OpenAI Images / Stability / custom SDXL endpoint
- Shopify Admin API for product creation and image uploads
- (Later) Fulfillment partner API or order webhooks (optional)

---

## 4) Data Model (Firestore)
Use a **tenantless** internal admin system (single brand) to start. If needed later, add `brandId`.

### Collections
#### `admins/{uid}`
- `email`
- `role`: `"admin" | "editor" | "viewer"`
- `createdAt`

#### `leagues/{leagueId}`
- `name` (NFL, NCAA, MLB, etc.)
- `slug`
- `active`

#### `teams/{teamId}`
- `leagueId`
- `name`
- `slug`
- `city`
- `colors`: `{ primary, secondary, accent }` (hex)
- `keywords`: string[] (fan phrases)
- `bannedTerms`: string[] (protected marks you want to avoid)
- `notes`
- `active`

#### `products/{productId}`
Represents a garment type + print area template.
- `name` (Panty, Tank, Crewneck)
- `skuPrefix`
- `printArea`: `{ widthIn, heightIn, dpi, x, y }` (relative or absolute for templates)
- `basePhotos`: `{ flatLayUrl, hangerUrl, ... }`
- `mockupTemplateId` (for Route A)
- `variants`: array (colorways, sizes)

#### `designFamilies/{familyId}`
Repeatable style templates.
- `name` (Text-Only, Icon+Text, Back-Butt Word, Front-Chest Word, etc.)
- `allowedElements`: `{ text: true, icon: true }`
- `fontSetId`
- `layoutRules` (JSON)
- `complianceRules` (JSON)
- `active`

#### `icons/{iconId}`
Your “safe” icon library (clover, stars, generic shapes, etc.)
- `name`
- `tags`
- `svgUrl`
- `license` (must be clean)

#### `modelPacks/{packId}`
For Route B lifestyle generation.
- `name` (“Rally Pack A”)
- `provider` (“replicate” | “fal” | etc.)
- `modelId` (external model identifier)
- `triggerWords` (string[])
- `recommendedPrompt` (string)
- `negativePrompt` (string)
- `poses` (array of pose descriptors)
- `active`

#### `designs/{designId}`
Core artifact: a concept + print-ready output.
- `leagueId`
- `teamId`
- `familyId`
- `productId`
- `titleWorking`
- `copyText` (e.g., “BUCKEYE BABE”)
- `iconId` (optional)
- `colorway` (optional)
- `status`: `"draft" | "generated" | "needs_review" | "approved" | "published" | "rejected"`
- `compliance`: `{ flags: string[], approvedBy?: uid, approvedAt?: ts }`
- `files`: `{ pngUrl, pdfUrl, svgUrl? }`
- `spec`: `{ widthPx, heightPx, dpi, printArea }`
- `promptTrace`: `{ generatorVersion, params, seed? }`
- `createdBy`
- `createdAt`, `updatedAt`

#### `mockups/{mockupId}`
- `designId`
- `type`: `"flatLay" | "hanger" | "detail" | "social"`
- `status`: `"queued" | "rendering" | "complete" | "failed"`
- `imageUrl`
- `meta`: `{ templateId, displacementMapId, providerJobId }`
- `createdAt`

#### `publishes/{publishId}`
Tracks Shopify drafts/publishing.
- `designId`
- `shopifyProductId` (optional until created)
- `status`: `"not_started" | "draft_created" | "images_uploaded" | "published" | "failed"`
- `payload`: `{ title, handle, tags, collections, variants }`
- `errors`: array
- `createdAt`, `updatedAt`

#### `jobs/{jobId}`
Batch/bulk operations
- `type`: `"bulk_generate" | "bulk_mockup" | "bulk_publish" | "train_model"`
- `params`
- `status`
- `progress`: `{ total, done, failed }`
- `logsRef` (pointer)

---

## 5) Security (Auth + Rules)
### Authentication
- Use Firebase Auth with **Google provider**.
- Only allow access if `admins/{uid}` exists.

### Firestore Rules (high level)
- Deny all by default
- Allow read/write only for authenticated users whose uid exists in `admins`
- Optional role-based restrictions:
  - `viewer`: read-only
  - `editor`: can create designs and mockups
  - `admin`: can publish & manage teams/rules

---

## 6) Core Workflows
## Workflow A — Generate Print-Ready Design
1. User selects: League → Team → Product → Design Family
2. User enters: Copy text + optional icon + notes
3. System runs compliance pre-check:
   - banned terms (team names, protected phrases)
   - prohibited elements (logos, mascots)
4. Cloud Function generates design output:
   - SVG master (preferred)
   - PNG (for mockups)
   - PDF (for printer)
5. Save URLs in `designs.files` and set `status="generated"`

### Implementation notes
- Use a **deterministic SVG compositor** where possible:
  - text layout, icon placement, stroke/shadow rules
  - consistent fonts
- Export outputs using a server-side renderer:
  - Node: `sharp` (for PNG), `pdfkit` or `puppeteer` for PDF, or `resvg` for SVG→PNG

## Workflow B — Route A Mockups (Product pages)
1. Select a completed design
2. Queue mockup jobs:
   - flat lay
   - hanger
   - (optional) zoom detail
3. Function applies design onto base photo:
   - scale/position to print area template
   - warp using displacement map
   - blend/shadow
4. Store final images in Storage; write `mockups` docs

### Implementation options for warp
- Simple: perspective transform + mild mesh warp (good enough for MVP)
- Better: displacement maps per garment (recommended)
- Tools/libraries: `sharp` + custom displacement, or call a dedicated image processing service

## Workflow C — Route B Lifestyle (Social)
1. Choose a Model Pack
2. Generate N images (3–6) using AI provider
3. Save images + prompt trace
4. Tag as `mockups.type="social"`

**Brand prompt template** (example)
- “High-quality fashion editorial photo, game-day vibe, flattering, confident, playful…”
- Include team colors (palette)
- Avoid logos and identifiable stadium trademarks
- Use negative prompt to avoid text artifacts

## Workflow D — Publish to Shopify (draft first)
1. Create Shopify product draft:
   - title, handle, description, tags, collections
   - variants (size/color)
2. Upload images:
   - Route A mockups for product page
   - Route B optional in gallery or marketing
3. Save Shopify product ID and publish state in `publishes`

---

## 7) UI Screens (MVP)
### 1) Login
- Google sign-in
- If signed in but not admin → “Access denied” with contact email

### 2) Dashboard
- KPIs: designs generated, approved, published last 7/30 days
- Quick actions: “Generate New Design”, “Bulk Generate”, “Review Queue”

### 3) Teams & Leagues
- CRUD for leagues and teams
- color palettes
- keywords/banned terms

### 4) Products & Templates
- garment types
- print areas and base photo template manager
- upload base images + displacement maps

### 5) Design Generator
- selectors: League/Team/Product/Family
- fields: copy text, icon, colorway
- live preview (SVG in browser)
- buttons:
  - Generate Print Files
  - Queue Mockups (Route A)

### 6) Review Queue
- list of designs needing review
- compliance flags shown
- approve/reject with notes

### 7) Mockups
- see all mockups for a design
- regenerate/replace

### 8) Publish
- preview Shopify payload
- create draft
- upload images
- publish
- history log

---

## 8) Cloud Functions (Gen2) — Required
### `generateDesign`
**Input:** `teamId, productId, familyId, copyText, iconId?, colorway?`
**Output:** URLs `{svg,png,pdf}`
- Enforces compliance
- Uses compositor + exporters
- Writes/updates `designs/{designId}`

### `renderMockup`
**Input:** `designId, mockupType`
- Loads base photo template for product
- Applies PNG
- Writes `mockups/{mockupId}`

### `generateLifestyle`
**Input:** `designId, modelPackId, count`
- Calls AI provider
- Saves images to Storage
- Writes `mockups` docs (type social)

### `createShopifyDraft`
**Input:** `designId`
- Creates product draft
- Writes `publishes/{publishId}`

### `uploadShopifyImages`
**Input:** `publishId`
- Uploads Route A mockups first
- Optionally uploads Route B assets
- Updates publish state

### `bulkJobRunner`
**Input:** `jobId`
- Executes bulk generation in safe batches
- Updates progress
- Retries failed items

---

## 9) Compliance Guardrails (Critical)
Because you’re selling **unlicensed** fan apparel, build strict controls.

### Compliance rules engine (MVP)
- `bannedTerms` per team (and global):
  - team names, trademarks, slogans, mascot names, stadium names
- disallow:
  - official logos
  - exact team wordmarks
  - “®”, “™”
- allow:
  - generic shapes/icons
  - city/state references
  - “fan identity” words that are non-trademarked (still review)

### Review requirements
- Any design containing:
  - team name
  - mascot name
  - player name
  - “Property of …”
  → must be flagged as **needs_review**

### Logging
Store:
- prompt trace
- generator version
- who approved

---

## 10) AI Provider Strategy (Recommended)
You can plug in different providers; design the backend to be provider-agnostic.

### Route B (Lifestyle) providers
- Replicate (easy; lots of LoRA hosting)
- FAL (fast)
- Custom hosted SDXL/Flux on RunPod (more control)

Store per provider:
- `provider`
- `modelId`
- `apiKeySecretName`
- `paramsSchema`

**Important:** Keep a per-pack “prompt recipe” so outputs stay consistent.

---

## 11) Storage Layout (Cloud Storage)
Use a clean folder structure:
- `base-photos/{productId}/{type}.png`
- `displacement/{productId}/{map}.png`
- `designs/{designId}/master.svg`
- `designs/{designId}/print.png`
- `designs/{designId}/print.pdf`
- `mockups/{designId}/{mockupId}.jpg`
- `social/{designId}/{mockupId}.jpg`

---

## 12) Shopify Integration Notes
- Use Shopify Admin API (GraphQL preferred)
- Store credentials in Secret Manager
- Create products as **draft**
- Use collections mapped by League/Team/Product

### Tagging strategy
- `league:NCAA`
- `team:ohio-state` (slug)
- `product:panty`
- `family:text-only`
- `colorway:scarlet-gray`

---

## 13) Build Plan (Cursor-friendly)
### Phase 0 — Setup (Day 1)
- Next.js + Firebase init
- Google Auth sign-in
- Firestore rules + `admins` gating
- Basic admin page shell

### Phase 1 — Core Data (Days 2–4)
- Leagues/Teams CRUD
- Products/Templates CRUD
- Upload base photos to Storage

### Phase 2 — Design Generator (Days 5–10)
- SVG compositor + in-browser preview
- `generateDesign` function (exports SVG/PNG/PDF)
- Save outputs + design detail page

### Phase 3 — Route A Mockups (Days 11–16)
- mockup templates for panties + tank + crewneck
- `renderMockup` function
- mockups gallery and regenerate

### Phase 4 — Shopify Draft Publisher (Days 17–21)
- create draft product
- upload images
- store publish records

### Phase 5 — Route B Social (Beta) (Days 22–28)
- add `modelPacks`
- `generateLifestyle` function
- add social asset gallery

---

## 14) MVP “Ohio State Drop” Example (Acceptance Test)
In <30 minutes the operator can:
1. Select “NCAA → Ohio State”
2. Generate 10 designs (text/icon)
3. For each, generate:
   - print files (PNG/PDF)
   - flat lay + hanger mockups
   - 3 lifestyle images using “Rally Pack A”
4. Publish 3 best designs to Shopify as drafts
5. Export a campaign folder for ads (optional)

---

## 15) What I Need From You (Inputs)
1. Base garment photos per product type (flat lay + hanger)
2. Print area specs from fulfillment partner (exact dimensions)
3. Approved font set(s)
4. Approved icon library (safe, original)
5. Shopify API access + store details
6. Initial admin emails list

---

## 16) Future Enhancements (Post-MVP)
- Auto “Shop by Team” landing pages and SEO generation
- Batch seasonal drops (playoffs, rivalry week, etc.)
- Automated email + social calendar generation
- UGC ingestion and “top performers” scoring
- Full multi-brand/tenant mode (if you ever white-label)

---

## 17) Definition of Done
MVP is complete when:
- Admin can generate compliant print-ready designs
- Admin can generate clean Route A mockups
- Admin can push drafts to Shopify with images and metadata
- System logs versions, prompts, approvals, and outputs
- Bulk generation works for at least 10 teams × 10 designs without crashing

