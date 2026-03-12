# Rally Panties — Design Dashboard Architecture (v1)
**Goal:** A simple, operational system that lets you move from *idea → inspiration → Illustrator final art → print pack → mockups → on-model assets → Shopify-ready product*, without building “Photoshop in the browser”.

This spec assumes:
- **Final printable art is created/cleaned in Illustrator** (vector / separations / print-ready PDFs).
- Your dashboard is the **single source of truth** for: prompts, inspo, iterations, approvals, print packs, mock generation, and publishing metadata.
- AI is used for **inspiration + mock realism**, not for guaranteeing perfect vector output.

---

## 1) Reality check (what AI can/can’t do)
### AI can do well
- Generate **style exploration** quickly (layouts, vibes, icon ideas, compositions).
- Create **photorealistic “realism pass”** for mockups (texture, wrinkles, lighting) *if you constrain it* (your inpaint mask work is the right direction).
- Provide **variations** (10–50 ideas) from a tight brand template.

### AI is still weak at (and you should not depend on)
- Producing **true, press-ready vector** that a screen printer can separate cleanly **every time**.
- Respecting **exact typography** (same font, same kerning) without drift unless you lock it down in Illustrator.
- Avoiding **IP pitfalls** automatically (team marks, “too close” logos) unless you explicitly constrain your prompt library and enforce a review step.

**Operational conclusion:**  
Use AI to discover concepts and mock marketing images; use Illustrator to lock the final artwork.

---

## 2) Recommended workflow (simple, repeatable)
### Phase A — Concept → Inspiration
1. Create a **Design** record (name + collection/team concept + intended products).
2. Add **Inspiration** (uploaded screenshots, notes, “vibe prompts”, color palette, fonts).
3. Run **AI Inspiration Batch** (Fal/Flux) to generate 10–20 comps (NOT final print art).

### Phase B — Illustrator cleanup → Final Art
4. Pick 1–2 comps as winners.
5. Rebuild as **printable vector** in Illustrator:
   - Clean typography (actual font)
   - Convert outlines for print
   - Create spot-color layers (if needed)
6. Export:
   - `final_print.pdf` (vector, printer-ready)
   - `final_print.png` (transparent background, for mock overlay; 3000px+ wide)

### Phase C — Mock generation (blank + placement + realism)
7. Select blank(s) + placement(s).
8. Generate:
   - **Stage A:** clean overlay composite (deterministic)
   - **Stage B:** realism pass (img2img low strength)
   - **Optional Stage C:** inpaint with mask (best quality)

### Phase D — On-model assets + social
9. Use your “Amber” identity + on-model generator to create:
   - 3–6 hero images per product
   - 1–3 short clips (later)
10. Export “content pack” for TikTok/IG.

### Phase E — Shopify (optional but likely)
11. Publish product assets + tags + variants to Shopify via API.

---

## 3) Core data model (Firestore)
### 3.1 Collections overview
- `rp_designs/{designId}`
- `rp_design_assets/{assetId}` (all files + generated images; normalized)
- `rp_design_prompts/{promptId}` (stored prompt templates + runs)
- `rp_design_inspirations/{inspoId}` (uploaded refs + notes)
- `rp_print_packs/{printPackId}` (printer deliverables)
- `rp_mock_jobs/{jobId}` (generation jobs + outputs)
- `rp_teams/{teamId}` (concept “team/collection” taxonomy — not necessarily real teams)
- `rp_blanks/{blankId}` (already exists)
- `rp_blank_masks/{blankId}_{view}` (already exists)
- `rp_products/{productId}` (internal product drafts; later can sync to Shopify)

> **Design principle:** one Design = *a reusable artwork concept* that can be applied to multiple blanks/products.

---

## 4) Document schemas (TypeScript-ready)
### 4.1 `rp_designs/{designId}`
```ts
export type RPDesignStatus = "draft" | "in_review" | "approved" | "archived";

export interface RPDesignDoc {
  id: string;
  name: string;                 // "Gamer Babe - Bay City"
  slug: string;                 // gamer-babe-bay-city
  teamId: string;               // rp_teams
  status: RPDesignStatus;

  // Creative intent
  description?: string;
  tags: string[];               // ["wordmark","flirty","bay-bridge"]
  paletteHex: string[];         // ["#000000", "#FF5A1F", "#FFFFFF"]
  fonts?: { name: string; source?: "local"|"adobe"|"google"; notes?: string }[];

  // Links to “final” assets (by assetId)
  finalPrintPdfAssetId?: string;
  finalPrintPngAssetId?: string;

  // Quick health / completeness
  hasInspo: boolean;
  hasPromptRuns: boolean;
  hasFinalArt: boolean;
  hasMockFinals: boolean;
  hasOnModel: boolean;

  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}
```

### 4.2 `rp_design_assets/{assetId}`
All files/images generated or uploaded related to a design.
```ts
export type RPAssetKind =
  | "inspiration"
  | "prompt_output"
  | "illustrator_draft"
  | "final_print_pdf"
  | "final_print_png"
  | "mock_draft"
  | "mock_final_realistic"
  | "on_model_image"
  | "social_export"
  | "other";

export interface RPDesignAssetDoc {
  id: string;
  designId: string;
  kind: RPAssetKind;

  // Storage reference
  file: {
    storagePath: string;
    downloadUrl?: string;
    contentType: string;     // "image/png", "application/pdf"
    bytes?: number;
    width?: number;
    height?: number;
  };

  // Optional metadata
  view?: "front"|"back";
  blankId?: string;
  placementKey?: string;      // "front_center"
  versionLabel?: string;      // "v03"
  notes?: string;

  // AI provenance (if generated)
  ai?: {
    provider: "fal" | "openai" | "other";
    model: string;
    prompt?: string;
    negativePrompt?: string;
    params?: Record<string, any>;
    seed?: number;
    sourceAssetId?: string;   // what it was derived from
    usedMask?: boolean;
    maskDocId?: string;
  };

  createdAt: any;
  createdByUid: string;
}
```

### 4.3 `rp_design_inspirations/{inspoId}`
```ts
export interface RPDesignInspirationDoc {
  id: string;
  designId: string;
  title?: string;
  notes?: string;
  sourceUrl?: string;          // optional
  assetId: string;             // references rp_design_assets (kind=inspiration)
  createdAt: any;
  createdByUid: string;
}
```

### 4.4 `rp_design_prompts/{promptId}`
Stores both templates and prompt “runs”.
```ts
export type RPPromptType = "template" | "run";

export interface RPDesignPromptDoc {
  id: string;
  designId: string;
  type: RPPromptType;

  name: string;               // "Etsy retro wordmark v1"
  prompt: string;
  negativePrompt?: string;
  variables?: Record<string,string>;   // { phrase: "GAMER BABE", city: "Bay City" }

  // If type="run"
  run?: {
    provider: "fal";
    model: string;
    params: Record<string, any>;
    outputAssetIds: string[]; // rp_design_assets kind=prompt_output
    startedAt: any;
    finishedAt?: any;
    status: "queued"|"running"|"success"|"error";
    error?: { message: string; code?: string };
  };

  createdAt: any;
  createdByUid: string;
}
```

### 4.5 `rp_print_packs/{printPackId}`
This is what your printer needs.
```ts
export interface RPPrintPackDoc {
  id: string;
  designId: string;

  // Required
  printPdfAssetId: string;     // final_print_pdf
  colors: Array<{
    hex: string;               // "#FF5A1F"
    name?: string;             // "Orange"
    inkType?: "plastisol"|"waterbased"|"dtf"|"other";
  }>;

  // Optional supporting docs
  notesToPrinter?: string;
  mockReferenceAssetIds?: string[];  // mock finals to show placement

  status: "draft"|"ready"|"sent"|"archived";
  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}
```

### 4.6 `rp_products/{productId}` (internal)
```ts
export interface RPProductDoc {
  id: string;
  title: string;
  designId: string;
  blankId: string;
  colorway: string;
  view: "front"|"back";
  placementKey: string;

  // Hero assets
  heroAssetId?: string;        // mock_final_realistic or on_model
  galleryAssetIds: string[];

  // Publishing
  status: "draft"|"ready"|"published"|"archived";
  shopify?: {
    productId?: string;
    variantId?: string;
    handle?: string;
    lastSyncedAt?: any;
  };

  tags: string[];
  priceCents?: number;

  createdAt: any;
  updatedAt: any;
}
```

---

## 5) Storage layout (Firebase Storage)
Keep it predictable and debuggable:
```
rp/designs/{designId}/inspo/{assetId}.png
rp/designs/{designId}/prompt_outputs/{assetId}.png
rp/designs/{designId}/illustrator/{assetId}.ai        (optional, if you store it)
rp/designs/{designId}/final/{assetId}.pdf
rp/designs/{designId}/final/{assetId}.png
rp/designs/{designId}/mocks/{mockJobId}/draft.png
rp/designs/{designId}/mocks/{mockJobId}/final.png
rp/designs/{designId}/on_model/{assetId}.png
rp/blank_masks/{blankId}/{view}/{fileName}.png        (already spec’d)
```

---

## 6) UI architecture (keep it dead simple)
### 6.1 Sidebar nav (suggested)
- Designs
- Blanks
- Products
- Review
- LoRA Ops (separate)

### 6.2 Designs list page
Filters:
- Search
- Team / Collection
- Status
- Has Final Art (Y/N)
- Has Print Pack (Y/N)
- Has Mock Finals (Y/N)

Table columns:
- Design (name + tags)
- Team
- Status
- Completeness chips (Inspo / Final / Mock / PrintPack)
- Updated
- Actions (View)

### 6.3 Design detail page (tabs)
**Tab 1: Overview**
- Status control (Draft → In Review → Approved)
- Key metadata (team, tags, palette, fonts)
- “Next step” checklist (what’s missing)

**Tab 2: Inspiration**
- Upload images (drag/drop)
- Notes per inspo
- “Generate Inspiration Batch” button

**Tab 3: AI Variations**
- Prompt template picker
- Variables (phrase, city, vibe)
- Batch size (10/20)
- Gallery grid of outputs with “Select as candidate” ✅

**Tab 4: Illustrator Files**
- Upload `draft.ai` (optional) + `draft.png`
- Upload “Final Print PDF” + “Final Print PNG”
- Auto-create/attach Print Pack

**Tab 5: Mockups**
- Choose blank + view + placement
- Generate Draft / Generate Final
- Show outputs + provenance + logs
- “Add to Product Draft” button

**Tab 6: Print Pack**
- Required: Final PDF + colors
- Export button: download PDF + color list (CSV/JSON) + reference mock images
- Status: Ready / Sent

**Tab 7: On-model**
- Choose model identity (Amber)
- Generate 3–6 images
- Select hero

**Tab 8: Publishing (optional)**
- Shopify sync controls
- Tags, title, description, pricing
- “Push to Shopify” (gated)

> **MVP UI rule:** Everything should be possible with **upload + select + generate**. No canvas editors.

---

## 7) Prompt library strategy (so outputs don’t suck)
Create a small set of **locked templates** and never free-form prompt the core pipeline.

### 7.1 Template: “Etsy Retro Wordmark”
Variables:
- `{phrase}` (e.g., “GAMER BABE”)
- `{cityTheme}` (e.g., “bay bridge, coastal fog”)
- `{palette}` (hex list)
- `{style}` (“retro collegiate, screenprint 1–2 inks, bold shapes”)

Hard rules baked into prompt:
- “**vector-like** screenprint design, minimal colors, crisp shapes, no gradients”
- “no official team logos, no trademarked marks”

### 7.2 Negative prompt (important)
- “official logo, MLB, NFL, SF logo, interlocking letters”
- “photorealistic, gradients, tiny details, halftone noise unless requested”
- “misspelled text, warped text, extra letters”

---

## 8) IP / naming risk (practical guidance)
I’m not a lawyer, but practically:
- **Exact team names** (e.g., “San Francisco Giants”) and **lookalike marks** are high risk.
- “Giants” alone can still be risky *if the trade dress and context* clearly points to a specific team (colors, font vibe, SF references).
- “Gamer Babe” is generally safer as a phrase (still check for existing trademarks in apparel).
- “Gigantes” is likely safer than “Giants” *but if paired with SF colors/bridge/baseball context*, it can still create association.

**Operational policy (recommended):**
- Build “city vibe” collections: “Bay City”, “Bridge City”, “Fog City”
- Avoid league/team names, official abbreviations, and any mark-like monograms.
- Use **generic sports motifs** (ball, bat, stadium outline) you license or create yourself.
- If you want sports fandom, consider **licensing** later, after you have traction.

---

## 9) Shopify integration (when to do it)
### Option A — Keep Shopify separate (recommended for next 30 days)
- Dashboard creates designs + mockups + print packs.
- You manually upload products and images to Shopify.
- **Fastest path to revenue**.

### Option B — Add Shopify API sync (Phase 4)
- Auto-create products/variants.
- Upload images and set tags.
- Store Shopify IDs on `rp_products`.

**Recommendation:** Start with Option A now. Add Option B once you have 20+ SKUs and the manual process hurts.

---

## 10) 30-day operational plan (to avoid “tech rabbit hole”)
**Week 1: Production pipeline proof**
- Pick 3 phrases: “GAMER BABE”, “GAME DAY”, “BAD BITCH ENERGY” (or your picks)
- For each: create a Design record + inspo + 10 AI comps
- Rebuild 1 winner per phrase in Illustrator (final PDF + PNG)
- Generate 3 blank mock finals per design (panty, tank, crewneck)

**Week 2: On-model + store readiness**
- Generate 3 on-model images per product (Amber)
- Build 9 product drafts (3 designs × 3 blanks)
- Create print packs for each design

**Week 3: Shopify + content**
- Upload 9 products (manual) with strong titles, tags, descriptions
- Make 1 “content pack” per design (5 images + 1 story + 1 reel script)

**Week 4: Scale**
- Add 10 more designs (AI-inspired, Illustrator finalized)
- Start exploring Shopify sync if you’re drowning.

---

## 11) Engineering checklist (Cursor-ready)
### Firestore
- Ensure collections exist and are indexed for:
  - designs by `teamId`, `status`, `updatedAt`
  - assets by `designId`, `kind`, `createdAt`

### Cloud Functions
- `createDesign` (server-side slug, keywords)
- `runDesignPromptBatch` (fal/flux → assets)
- `createMockJob` (Stage A + Stage B + optional mask inpaint)
- `createPrintPackFromFinal` (optional helper)
- `exportPrintPackZip` (optional: zip pdf + csv + reference images)

### Security rules
- Read: authenticated users
- Write: admin only (or role-based)

### UI
- A single **DesignDetail** route with tabs
- A single **UploadAsset** component reused everywhere
- A single **AssetGallery** component with filters

---

## 12) What I would change in your current “Designs” UI
Your current “Create Design” modal is good. The missing piece is the **Design Detail page** that acts like a “project folder”:
- Prompts
- Inspiration uploads
- AI outputs
- Illustrator drafts/finals
- Print pack
- Mockups (blank selection + generation)
- On-model results

**Keep the list page lightweight.** The power is in the detail view.

---

## 13) Next action (today)
1. Create 1 Design: **Gamer Babe (Bay City)**  
2. Upload 3 inspo screenshots (Etsy vibe + your own)  
3. Run batch: 20 AI comps  
4. Pick 1 comp and rebuild in Illustrator  
5. Upload final PDF + PNG  
6. Generate mock final (with mask) for 1 blank  
7. If that looks good: replicate to 3 blanks and you’re “operational”.
