
# RALLY_BATCH_DESIGN_IMPORT_AND_NAMING_SPEC.md

## Purpose

This document defines the **design naming convention and batch import system** for Rally.
The goal is to allow Rally to ingest large numbers of design assets and automatically
create design records, products, and product renders.

This enables scaling from a few manually created products to **hundreds or thousands of SKUs**.

---

# 1. Core Concept

Rally should not treat every design file as an isolated product.

Instead, Rally should interpret filenames as **structured data** that describe:

- League
- Design Family
- Team
- Side
- Variant

From this information Rally can automatically generate:

- design records
- product records
- render instructions
- Shopify catalog entries

---

# 2. Naming Convention

Design files must follow the format:

LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT

Example:

MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png

Structure:

league = MLB
designName = WILL_DROP_FOR
team = GIANTS
side = BACK
variant = LIGHT

---

# 3. Examples

Example design family: WILL_DROP_FOR

MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_DODGERS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_YANKEES_BACK_LIGHT.png

Another design family:

MLB_HOME_RUN_GIANTS_BACK_LIGHT.png
MLB_HOME_RUN_DODGERS_BACK_LIGHT.png

Another:

MLB_PITCH_SLAP_GIANTS_BACK_LIGHT.png

---

# 4. Parsed Data Structure

When Rally imports the file:

MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png

It should generate:

{
  league: "MLB",
  designFamily: "WILL_DROP_FOR",
  team: "GIANTS",
  side: "BACK",
  variant: "LIGHT"
}

---

# 5. Firestore Design Model

Suggested structure:

designFamilies
    WILL_DROP_FOR

designs
    id
    family: WILL_DROP_FOR
    league: MLB
    team: GIANTS
    side: BACK
    variant: LIGHT

assets
    png
    svg
    pdf

---

# 6. Batch Import Workflow

Input:

A folder of design files.

Example:

MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_DODGERS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_YANKEES_BACK_LIGHT.png

Process:

1. Upload folder
2. Rally parses filenames
3. Rally creates or updates design records
4. Rally assigns design family
5. Rally assigns team and side
6. Rally attaches PNG/SVG/PDF assets

Result:

Design records automatically populated.

---

# 7. Batch Product Generation

After designs exist, Rally can automatically create products.

Example rule:

Design Family: WILL_DROP_FOR
Blank: Heather Grey Bikini

Rally generates:

30 products (one for each MLB team)

Each product inherits:

title
handle
tags
collections
render configuration

---

# 8. Title Generation

Example:

MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT

Title template:

"Will Drop For {Team} – Women's Heather Grey Bikini"

Result:

Will Drop For Giants – Women's Heather Grey Bikini

---

# 9. Shopify Handle Generation

Handle template:

{designSlug}-{team}-{blank}

Example:

will-drop-for-giants-bikini

---

# 10. Product Generation Flow

Illustrator export
→ Rally batch design import
→ Rally creates design records
→ Rally creates products from selected blank
→ Rally deterministic renderer creates hero images
→ Rally syncs products to Shopify

---

# 11. Long-Term Scaling

With this system:

Upload 60 design files
→ Rally creates 60 design records
→ Rally generates 60 products
→ Rally renders hero images
→ Rally syncs to Shopify

This replicates the workflow used by large POD companies.

---

# 12. Implementation Notes

Required future modules:

Batch Design Import
Filename Parser
Design Family System
Batch Product Generator

These modules enable Rally to operate as a **catalog generation engine** rather than a manual product builder.

