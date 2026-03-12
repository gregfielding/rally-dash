# RALLY_CURSOR_PRODUCT_IMAGE_FACTORY_UPGRADE.md

Author: Greg Fielding  
Project: Rally Panties DesignOps  
Purpose: Upgrade Rally so it can generate product images faster and better than the current manual Illustrator + Photoshop workflow, while also preparing for automated MLB-scale design generation from a single Illustrator template.

---

# 1. Goal

Rally should evolve from:

- a design library
- a blank library
- a model image generator

into a true **AI product image factory**.

The target outcome is:

```text
Illustrator template
→ exported design assets
→ Rally blank placement + realism engine
→ automatic product images
→ automatic model images
```

Rally should be able to create product images that are:

- faster than the current Photoshop workflow
- visually more realistic than the current flat mockup
- scalable across all MLB teams and future leagues/categories

---

# 2. Current Reality

Current external workflow:

```text
Illustrator
→ create team wordmark artwork

Photoshop
→ manually place design on blank panties
→ export flat product image
```

Current Rally workflow:

```text
Designs
→ SVG / PNG / PDF stored

Blanks
→ garment base images + placements + masks

Products
→ Design + Blank = Product

Generate
→ model-based generation with scene preset + identity
```

What is missing:

1. A **product-only image generation pipeline**
2. A **realism pass** that improves product images beyond basic flat compositing
3. Better support for **template-driven design generation at scale**
4. A cleaner path from **one Illustrator template → all MLB teams**
5. A generation mode that does not require a human model

---

# 3. Product Image Factory — New Concept

Rally needs a second image generator in addition to the current model generator.

## Existing generator
Current generator:

```text
mockup
+
identity
+
LoRA
+
scene preset
=
model photo
```

## New generator
Add a **product image generator**:

```text
blank garment
+
design
+
placement
+
mask
+
scene preset
+
realism pass
=
product image
```

This generator should work **without Identity / Face / Body LoRAs**.

---

# 4. New Image Categories

Rally should support two separate asset categories.

## A. Product Images (No Model)
Used for:

- Shopify primary image
- Etsy gallery images
- Amazon-style images
- Pinterest/social support
- product detail galleries

### Product image presets
Add these scene presets:

```text
Ecommerce Flat (White Background)
Folded Product
Bed / Blanket
Wood Floor
Retail Hanger
Studio Flat Lay
Minimal Lifestyle Surface
```

### Notes
- `Ecommerce Flat (White Background)` should be the first preset built
- `Retail Hanger` is especially important for tank tops, tees, sweatshirts
- `Bed / Blanket` and `Wood Floor` are important for softer lifestyle ecommerce content

---

## B. Model Images
Keep and improve current model scene presets:

```text
Ecommerce White (On Model)
Lifestyle Outdoor (On Model)
Studio Editorial (On Model)
```

These should continue to use Identity + Face LoRA + Body LoRA.

---

# 5. Immediate Product Image Improvement Goal

The current manual Photoshop mockup looks like this:

- clean
- centered
- usable
- but still somewhat flat / manually composited

Rally should be able to generate something better by:

1. starting from the garment blank
2. placing the print artwork using placements
3. using masks to constrain edits
4. running an AI realism pass to add:
   - natural fabric interaction
   - subtle print integration
   - realistic shadows
   - wrinkle-aware blending
   - surface-specific realism

The goal is not dramatic scene invention at first.

The first target should be:

```text
Photoshop-quality flat mockup
+
slightly better print realism
+
fully automated
```

---

# 6. Use of the Attached Photoshop Output

The attached Photoshop-generated image should be treated as:

```text
reference quality target
```

not as the long-term source of truth.

It is useful for:

- visual comparison
- quality benchmarking
- tuning placement realism
- verifying whether Rally output is “good enough”

It should not be the required production path.

Rally should generate comparable or better results directly from:

```text
blank garment image
+
design PNG/SVG
+
placement
+
mask
```

---

# 7. Blank System Enhancements

The current Blank system is already close to correct. Expand it slightly.

## Current blank concept
Blank = garment template

Examples:

- Heather Grey Bikini
- Black Bikini
- White Bikini
- Tank Top
- Sweatshirt

## Required blank structure
Each blank should support:

```text
name
category
garmentCategory
colorway
images.front
images.back
placements.front
placements.back
masks.front
masks.back
```

### Example
```json
{
  "name": "Heather Grey Bikini",
  "category": "panties",
  "garmentCategory": "bikini",
  "colorway": "Heather Grey",
  "images": {
    "front": "...",
    "back": "..."
  },
  "placements": {
    "front": {
      "x": 0.5,
      "y": 0.62,
      "width": 0.45,
      "height": 0.18
    },
    "back": {
      "x": 0.5,
      "y": 0.56,
      "width": 0.50,
      "height": 0.20
    }
  },
  "masks": {
    "front": "...",
    "back": "..."
  }
}
```

## Important
Placements should ideally be normalized (0–1) relative coordinates rather than pixel-only coordinates. This makes them reusable across image sizes.

---

# 8. Product Image Generator — Architecture

Add a new generation path in Rally.

## A. Mockup Pass
First pass:

```text
blank image
+
design artwork
+
placement
=
base mockup
```

This is deterministic.

## B. Realism Pass
Second pass:

```text
base mockup
+
mask
+
product scene preset
=
enhanced product image
```

This pass should be constrained by the mask so that:

- garment silhouette stays stable
- fabric shape stays stable
- only print region and local realism are changed as needed

## C. Output
Store generated product images under product assets, with a source/type indicating product image generation.

Recommended asset types:

```text
mockup
product_scene
model_scene
hero
detail
```

---

# 9. New Generate UI Structure

The current Generate tab is model-centric. Split it into two modes.

## Recommended UI tabs or sections

### Option A — tabs
```text
Generate
  [ Product Images ] [ Model Images ]
```

### Option B — generator type dropdown
```text
Generator Type:
- Product Images
- Model Images
```

## Product Images mode
Fields:

```text
Scene Preset
Image Count
Image Size
Shadow Strength
Wrinkle / Realism Strength
Use Mask (true/false)
```

For some scenes, also support:

```text
Surface Type
Background Style
Hanger Type
Fold Style
```

## Model Images mode
Keep current fields:

```text
Scene Preset
Identity
Face Artifact
Body Artifact
Face Scale
Body Scale
Product Scale
Image Count
Image Size
```

---

# 10. Product Scene Presets — Detailed Recommendations

Implement these product-only presets.

## 1. Ecommerce Flat (White Background)
Purpose:
- main catalog image
- Shopify / Etsy / Amazon style

Behavior:
- centered garment
- clean white or light-neutral background
- soft natural shadow
- no model
- no unnecessary scene clutter

This should be the first and highest-priority preset.

---

## 2. Folded Product
Purpose:
- secondary gallery image
- adds merchandising feel

Behavior:
- folded garment look
- clean retail-like presentation
- optional white/beige background

---

## 3. Bed / Blanket
Purpose:
- soft lifestyle ecommerce / Pinterest

Behavior:
- garment placed on blanket or bedding
- natural shadowing
- realistic wrinkles
- feminine/lifestyle tone

---

## 4. Wood Floor
Purpose:
- casual rustic lifestyle image

Behavior:
- garment on wood surface
- mild wrinkles
- realistic grounding shadows

---

## 5. Retail Hanger
Purpose:
- tanks
- tees
- sweatshirts
- retail presentation

Behavior:
- garment hanging from hanger
- wall / rack backdrop
- realistic garment drape
- subtle shadows

---

## 6. Studio Flat Lay
Purpose:
- more editorial ecommerce support image

Behavior:
- top-down product photo
- neat composition
- optional accessories later

---

# 11. Realism Controls

Add realism controls to product generation.

Suggested fields:

```text
Shadow Strength
Wrinkle Strength
Print Integration Strength
Background Realism
Mask Strictness
```

These do not all need to be exposed immediately in the UI. Some can be preset defaults.

## Recommended default behavior
- subtle realism, not dramatic transformations
- preserve garment shape
- preserve garment color
- preserve overall print layout
- only improve print integration + local realism

---

# 12. Masking Strategy

Masks are important and should remain part of the blank system.

## Role of mask
The product realism pass should only modify allowed regions.

White:
- editable / print zone / realism zone

Black:
- protected / preserve garment + background

## Recommendation
Continue supporting:

```text
Auto-generate from SafeArea
```

This is good for speed.

Later, allow advanced masks where the editable region is slightly larger than the pure print rectangle so realism can affect local surrounding fabric.

Example:

- print box = exact print area
- realism mask = print area + buffer

---

# 13. Product Assets and Storage

Keep the current product asset model but add better typing.

## Recommended product asset fields
```text
type
source
preset
generationMode
approved
hero
```

### Example types
```text
mockup
product_scene
model_scene
hero
detail
```

### Example sources
```text
system_composite
ai_product_generation
ai_model_generation
manual_upload
```

This makes the asset system queryable without changing existing storage paths.

---

# 14. Immediate Bug / Robustness Improvements

The generation flow previously surfaced a Firestore error related to undefined values.

Cursor should ensure generation job payloads are sanitized so that:

- no undefined values are written
- optional values become null or are omitted

Recommended actions:

1. sanitize generation payload before Firestore writes
2. add defensive validation around:
   - scenePreset
   - identity
   - artifact ids
   - product.mockupUrl
3. optionally enable:
   - ignoreUndefinedProperties

---

# 15. MLB Automation from One Illustrator File

This is a major opportunity and should be built into the product factory strategy.

## Goal
Use one Illustrator template to drive all MLB teams automatically.

### Current manual process
- duplicate artboards
- rename team
- change team color
- export one by one

### Desired process
- one structured Illustrator master
- one data source
- automatic export / ingestion into Rally

## Recommended data model for auto-generation
Create a team design parameter set:

```json
[
  {
    "teamCode": "GIANTS",
    "teamName": "GIANTS",
    "displayName": "San Francisco Giants",
    "primaryHex": "#FD5A1E",
    "secondaryHex": "#000000",
    "lightTopLineHex": "#1A1A1A",
    "darkTopLineHex": "#F2F2F2"
  },
  {
    "teamCode": "DODGERS",
    "teamName": "DODGERS",
    "displayName": "Los Angeles Dodgers",
    "primaryHex": "#005A9C",
    "secondaryHex": "#1A1A1A",
    "lightTopLineHex": "#1A1A1A",
    "darkTopLineHex": "#F2F2F2"
  }
]
```

## Template idea
The Illustrator file should be treated as a source template containing:

- layout for dark version
- layout for light version
- consistent typography system
- named placeholder for team word
- named color roles

### Color roles
Use semantic roles like:

```text
RP_TEAM_PRIMARY
RP_TOPLINE_LIGHT_BG
RP_TOPLINE_DARK_BG
```

not one-off hardcoded fills.

## Ingestion strategy
Rally should eventually support a batch design import path:

```text
templateId
+
league/team parameter set
=
generated design records
```

At minimum, Cursor should prepare for this with:
- design import endpoints
- team metadata awareness
- support for bulk design creation from structured data

---

# 16. Suggested Implementation Phases

## Phase 1 — Make Rally beat Photoshop for flat product images
Implement:

- Product Images generator mode
- Ecommerce Flat (White Background) preset
- use blank + placement + mask
- realism pass with constrained edits
- better product asset typing
- payload sanitization

Success metric:
Rally can generate a product-only white-background image that is as good as or better than the attached Photoshop mockup.

---

## Phase 2 — Add more product-only scenes
Implement:

- Bed / Blanket
- Wood Floor
- Retail Hanger
- Folded Product

Support tanks and sweatshirts especially for hanger scene.

---

## Phase 3 — MLB automation path
Implement:

- structured team parameter set
- bulk design import / generation support
- ability to auto-create design records from one template + team data

---

## Phase 4 — Bulk product generation
Combine:
- bulk job architecture
- products generated from design × blank
- product scene generation
- model scene generation

This becomes the true product factory.

---

# 17. Immediate Tasks for Cursor

Please implement or plan the following in priority order.

## Priority A — Product image generation
1. Add a second generation mode for **Product Images** (no identity required)
2. Add first product preset:
   - Ecommerce Flat (White Background)
3. Use blank image + placement + mask + realism pass
4. Store outputs as product assets with type/source metadata

## Priority B — Quality / stability
5. Fix undefined Firestore payload issues in generation jobs
6. Normalize any optional fields before writes

## Priority C — Better scene support
7. Add support for:
   - Bed / Blanket
   - Wood Floor
   - Retail Hanger
   - Folded Product

## Priority D — MLB automation support
8. Prepare for one-template / many-team generation by supporting structured team parameter import and batch design creation logic

---

# 18. Desired End State

Rally should be able to do this:

```text
One Illustrator template
→ all MLB team designs
→ all color variants
→ all blanks
→ all product images
→ all model images
```

And it should generate better ecommerce assets than the current manual Photoshop workflow.

That means:

- cleaner
- faster
- more scalable
- more realistic
- less manual editing

---

# 19. Reference Quality Benchmark

Attached reference image:

```text
rally_panty_heather_back.jpeg
```

Use this as the benchmark for flat product output quality.

The first product image generator preset should aim to match or exceed this result:

- centered composition
- correct placement
- strong readability
- believable print integration
- clean background

---

# End of Document
