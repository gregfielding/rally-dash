
# Rally Panties — AI Product Factory
Author: Greg Fielding
Purpose: Define the automated product generation engine for Rally Panties.

This document describes how the Rally Dashboard should automatically generate
large volumes of apparel products by combining designs, garment blanks, and AI models.

---

# 1. Overview

The Rally Product Factory automates the creation of ecommerce-ready product photos.

The system combines:

Designs
Blanks
AI Models

to generate finished products.

Pipeline:

Illustrator → SVG artwork
Photoshop → PNG artwork export
Rally Dashboard → mockup generation
LoRA Ops → model photo generation

---

# 2. Product Factory Concept

A product is defined as:

Design
+
Blank
+
Model
=
Product Images

Example:

GIANTS Wordmark
+
Heather Cotton Panty
+
Amber Model
=
Product Photo Set

---

# 3. Inputs

The product factory uses three primary inputs.

## Designs

Stored in the Designs library.

Example:

GIANTS_LIGHT
DODGERS_LIGHT
ORIOLES_LIGHT
YANKEES_LIGHT

Design fields:

design
 id
 name
 teamId
 svgFile
 pngPreview
 pdfFile
 colors[]
 tags[]
 createdAt

---

## Blanks

Garment templates.

Example:

Heather Cotton Panty
Black Cotton Panty
White Cotton Panty
Lace Edge Panty
Thong

Blank fields:

blank
 id
 name
 category
 baseImage
 placements[]
 createdAt

Placement example:

placements:
 back_print:
   x
   y
   width
   height

---

## AI Models

AI identities used for product generation.

Example:

Amber
Maya
Sofia
Ava

Model fields:

model
 id
 name
 loraModel
 description
 promptStyle
 createdAt

---

# 4. Product Generation Pipeline

The product generation pipeline has four stages.

---

## Stage 1 — Mockup Generation

Combine design + blank.

Process:

Load blank garment
Load design PNG
Resize artwork to placement
Composite artwork
Export mockup

Output:

mockup.png

Stored at:

/products/{productId}/mockup.png

---

## Stage 2 — LoRA Model Generation

The mockup image becomes the input for LoRA generation.

Example prompt:

beautiful athletic woman wearing grey cotton panties with orange GIANTS text on the back, studio lighting, ecommerce photography

Input:

mockup.png
model: Amber

Output:

model_photo_1.png
model_photo_2.png
model_photo_3.png

Stored at:

/models/{productId}/

---

## Stage 3 — Product Photo Selection

Generated photos are reviewed.

Best photos are selected for product listing.

Saved as:

/products/{productId}/gallery/

Example:

hero.png
pose_side.png
pose_back.png
pose_lifestyle.png

---

## Stage 4 — Ecommerce Export

Product data becomes ready for ecommerce platforms.

Example export:

title
description
images[]
tags
team
league
productType

---

# 5. Bulk Product Generation

The product factory should support bulk generation.

Example configuration:

Teams: 30 MLB teams
Blanks: 3 panty styles
Colorways: 3
Models: 3

Total products:

30 × 3 × 3 × 3 = 810 products

Generated automatically.

---

# 6. Bulk Generation Workflow

Admin selects:

Design Set
Blank Set
Model Set

Example:

Designs: MLB Teams
Blanks: Heather Panty
Models: Amber

System generates:

30 products

Each with:

mockup
model photos
product gallery

---

# 7. Dashboard UI

Add a Bulk Product Generator.

Location:

Products → Bulk Generate

Fields:

Select Designs
Select Blanks
Select Models
Images Per Product
Start Generation

---

# 8. Job Queue

Bulk generation should use a job queue.

Example job:

generationJob
 id
 designs[]
 blanks[]
 models[]
 status
 progress
 createdAt

Worker tasks:

generate mockup
generate model photos
store results
update progress

---

# 9. Storage Structure

/designs
/blanks
/products
/models
/jobs

Example:

/products/giants_heather_panty/
/products/giants_heather_panty/mockup.png
/products/giants_heather_panty/gallery/
/models/giants_heather_panty/

---

# 10. Future Enhancements

## Fabric Wrinkle Simulation

AI should simulate:

- fabric folds
- stretch
- natural shadowing

---

## Lighting Presets

Generation presets:

studio
mirror selfie
lifestyle
streetwear

---

## Product Variation Engine

Generate variations automatically.

Example:

team
colorway
blank style
model
pose

---

# 11. Example Product Set

Example output:

Giants Heather Panty
Dodgers Heather Panty
Orioles Heather Panty
Yankees Heather Panty

Each product contains:

mockup image
3–5 model photos
product gallery

---

# 12. Scaling Potential

With automated generation:

30 MLB teams
× 5 blanks
× 3 colorways
× 3 models

Total:

1,350 products

Generated in minutes.

---

# 13. System Goal

The Rally Dashboard becomes a Product Factory.

It transforms:

Design assets
+
Garment templates
+
AI models

into

fully ready ecommerce products

with minimal manual work.

---

# End of Document
