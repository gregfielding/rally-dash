
# RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER.md

Author: Greg Fielding
Purpose: Define the Phase 1 rendering engine for Rally so product images are generated
deterministically (like Photoshop smart-object mockups) before any AI generation occurs.

This document replaces generative rendering for flat product images with a deterministic compositor
that must reproduce Photoshop-quality mockups automatically and at scale.

---

# Core Principle

Phase 1 is NOT AI generation.

It is a deterministic renderer.

Inputs:

- blank garment image
- design PNG
- placement coordinates
- blend mode
- opacity

Output:

- exact composite mockup

Pipeline:

blank
→ scale design
→ translate to placement
→ apply blend mode
→ apply opacity
→ export packshot

No diffusion.
No scene models.
No garment reinterpretation.

---

# Why This Is Critical

If the renderer is not deterministic, the system will:

- change garment shapes
- change garment colors
- change print placement
- hallucinate designs
- produce inconsistent ecommerce listings

All professional POD systems use deterministic compositing.

Examples:

- Printful
- Printify
- Placeit
- Shopify mockup engines

---

# Phase 1 Success Criteria

Rally must generate product images that match the Photoshop benchmark:

• identical garment
• identical placement
• identical proportions
• identical background
• no AI hallucination

Performance requirement:

Generation time:

< 1 second per image

---

# Renderer Architecture

Recommended libraries:

NodeJS:

- sharp
- canvas
- imagemagick (optional)

---

# Blank Template Schema

Each blank garment must include print placement metadata.

Example:

printArea:
  x: 0.18
  y: 0.32
  width: 0.64
  height: 0.28

Coordinates must be normalized:

Range:

0–1

Relative to image size.

---

# Rendering Pipeline

Step 1 — Load Blank

blank.png

Step 2 — Resize Design

designWidth = blankWidth * placement.width

Step 3 — Position Design

x = blankWidth * placement.x
y = blankHeight * placement.y

Step 4 — Apply Blend Mode

Recommended modes:

multiply
overlay
soft-light

For heather garments:

multiply

opacity:

80–90%

Step 5 — Export Packshot

product_mockup.png

White background.

---

# Fabric Mask Support

Some blanks may include:

fabric_texture_mask

When present:

design = design × mask

This integrates the print with the fabric grain.

---

# The Powerful POD Trick (Used by Major Print Platforms)

Professional POD platforms achieve realistic fabric integration using displacement maps.

This trick allows prints to follow fabric wrinkles without AI.

Technique:

1. Create a grayscale displacement map from the garment texture.
2. Warp the design using the displacement map.
3. Apply blend mode + opacity.
4. Overlay the result onto the blank.

Result:

The print appears to follow the fabric naturally.

Implementation options:

ImageMagick:
- displace filter

Canvas / WebGL:
- shader displacement

Sharp:
- custom composite pipeline

Benefits:

• extremely realistic
• deterministic
• very fast
• no hallucination risk

This method is used by:

- Printful
- Placeit
- many large POD rendering systems

---

# Example Final Pipeline

blank
→ displacement warp
→ scale design
→ translate placement
→ multiply blend
→ opacity adjustment
→ export product image

---

# Scaling Advantage

Once implemented, Rally can generate massive product sets automatically.

Example:

30 MLB teams
×
5 colorways
×
3 garments

= 450 product images

Generated automatically in seconds.

---

# Phase 2 (After Renderer Works)

Only after deterministic rendering works should Rally add:

1. AI realism pass
2. Model generation (Amber)
3. Lifestyle scenes (bed, hanger, etc)

---

# Final Directive for Cursor

Implement a deterministic rendering engine for flat product images.

Requirements:

- use blank image as base
- overlay design using placement coordinates
- apply blend mode and opacity
- support optional displacement maps
- preserve garment silhouette exactly
- never modify garment color or style

The output must match the Photoshop reference image as closely as possible.

Target performance:

<1 second per image.

This renderer becomes the foundation for all later AI-powered stages.

---

# Implementation Notes (Cursor)

Implemented in `functions/index.js` (onMockJobCreated + createMockJob):

- **Blank as base:** Blank image loaded and used as base layer.
- **Placement:** Supports both **printArea** (x, y, width, height normalized 0–1) and legacy (x, y, scale, safeArea). Position = top-left when using printArea; center when using scale.
- **Design overlay:** Design PNG scaled to fit placement, then composited with **blend mode** (default `multiply` for heather) and **opacity** (default 87%). Blanks can set `blendMode` and `blendOpacity` per placement.
- **Fabric mask:** When `rp_blank_masks` has a mask for the blank+view, design is multiplied by the mask (design × mask) before blend/opacity, so the print integrates with fabric grain.
- **No diffusion:** Phase 1 is deterministic only. Set `MOCK_PHASE1_DETERMINISTIC_ONLY=true` (default) so Stage B (AI realism) is skipped. Set to `false` to enable optional realism pass (Phase 2).
- **Product-only assets:** Generation jobs with `generationType: "product_only"` use the mockup URL as the asset (exact composite), no generative model.
- **Displacement maps:** Not yet implemented; can be added later (ImageMagick displace or custom sharp pipeline) for the “POD trick” wrinkle-following effect.
- **Print blur:** Design blurred (sigma 0.3, `placement.printBlurSigma`) before blend to remove sticker look.
- **Print desaturation:** Saturation 0.96 (`placement.printSaturation`) for fabric-ink realism.
- **Max-fit scaling:** Design scaled to fit inside print area (min of width/height scale) so long text never crops or overflows.
