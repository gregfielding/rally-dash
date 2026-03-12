
# RALLY_CURSOR_TWO_STAGE_PRODUCT_PIPELINE.md

Author: Greg Fielding
Purpose: Fix Rally generation flow so product images are created before model images and support automated MLB team generation from a single Illustrator template.

---

# Problem Observed

Current generation pipeline:

Design → Product → Model Generation

This causes the generator to ignore:
- the selected blank garment
- the design placement
- the mask system

Result: generic model placeholders instead of real products.

Example: Amber images generated without the Giants design or heather grey panties.

---

# Correct Generation Architecture

The Rally pipeline must become a **two-stage generation system**.

Stage 1: Product Images  
Stage 2: Model Images

---

# Stage 1 — Product Image Generation

Goal:
Generate 2–6 realistic product-only images before any model generation.

Inputs:
- blank garment image
- design PNG/SVG
- placement coordinates
- mask
- scene preset

Pipeline:

1. **Exact composite (deterministic, required)**  
   blank + design + placement + mask → base mockup (sharp composite).  
   This is produced by the **mock job** (onMockJobCreated Stage A).  
   For product_only generation jobs, the worker uses this mockup **as-is** as the product asset — no generative model. Same heather grey garment, same shape, same print, same placement, clean white background (Phase 1 success criterion).

2. **Optional realism (tightly constrained)**  
   If the mock job runs with quality=final, Stage B can apply a mild fal.ai img2img/inpaint pass.  
   Allowed: subtle print integration, mild shadowing, mild wrinkle realism.  
   Not allowed: changing garment silhouette, style/cut, color, replacing or moving the print.  
   After that, product_only jobs use the final mockup URL as the single product asset (exact composite first; no second generative pass).

---

# Required Product Scene Presets

Ecommerce Flat (White Background)  
Folded Product  
Bed / Blanket  
Wood Floor  
Retail Hanger  
Studio Flat Lay

First preset to implement:

Ecommerce Flat (White Background)

This should match or exceed the quality of the Photoshop reference mockup.

---

# Stage 2 — Model Image Generation

After product images exist and one is approved as the hero product image.

Inputs:
- approved product image
- identity (Amber, etc)
- model scene preset

Pipeline:

approved product
+
identity LoRA
+
scene preset
→ model images

This ensures the model is wearing the correct product with the correct design placement.

---

# UI Changes

Generate tab should split into two modes:

Generate → Product Images  
Generate → Model Images

Product mode fields:

Scene Preset  
Image Count  
Image Size  
Shadow Strength  
Wrinkle Strength  
Mask Strictness  

Model mode keeps current fields.

---

# Product Asset Types

mockup  
product_scene  
model_scene  
hero  
detail

Assets should store metadata:

type  
source  
preset  
generationMode  

---

# Blank Template Improvements

Blank object structure:

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

Placements should be normalized (0–1 coordinates).

---

# Realism Pass

Second generation pass improves product realism:

Add:
fabric wrinkles  
print integration  
natural shadows  
surface interaction  

Must respect mask boundaries.

---

# MLB Automation From One Illustrator Template

Goal:
Generate every MLB team automatically.

Approach:

Use a parameter dataset:

teamCode  
teamName  
primaryColor  
secondaryColor

Illustrator template contains placeholders:

TEAM_NAME  
RP_TEAM_PRIMARY  
RP_TEAM_SECONDARY

Batch process:

template
+
team parameters
→ generate designs
→ auto-create design records

---

# Desired Final Pipeline

Illustrator Template
→ MLB team dataset
→ Design generation
→ Blank matching
→ Product image generation
→ Model image generation

---

# Success Criteria

Rally must produce product images:

- faster than Photoshop
- more realistic than current mockups
- fully automated
