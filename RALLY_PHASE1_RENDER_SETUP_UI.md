
# RALLY_PHASE1_RENDER_SETUP_UI.md

Author: Greg Fielding
Purpose: Add explicit asset selection and inspection before deterministic product rendering.
This ensures the renderer uses the correct blank image, correct design file, and correct side (front/back)
before generation occurs.

This file defines the UI and data requirements for Phase 1.

---

# Problem

The renderer is currently choosing assets implicitly using productId / blankId / designId.

This causes issues such as:
- incorrect blank PNG being used
- front/back confusion
- incorrect design file selected
- generation happening without user verification

Example seen:
Design rendered on the front when the intended render was for the back.

For deterministic rendering, Rally must allow explicit asset selection.

---

# Solution: Render Setup Section

Add a **Render Setup** panel on the product page (likely in the Generate tab or Overview tab).

This section must allow the user to explicitly choose:

1. Render Side
2. Blank Image Asset
3. Design Image Asset

Only after these selections are confirmed should generation occur.

---

# Render Side Selector

UI control:

Render Side:
- Front
- Back

Example:

Render Side: Back

Changing the side should automatically filter blank assets and design assets that match that side.

---

# Blank Asset Selector

Show the exact blank image used for rendering.

UI should show:

- thumbnail preview
- blank name
- garment type
- view/side (front/back)

Example:

Blank Asset
Heather Grey Bikini
View: Back
[thumbnail]

Actions:
- Change Blank
- View Full Image

When clicking **Change Blank**, show available blank assets filtered by:
- garment type
- side/view

Selecting a blank sets:

selectedBlankImageUrl

---

# Design Asset Selector

Show the design image that will be rendered.

UI should show:

- thumbnail preview
- file name
- side/view tag
- upload date (optional)

Example:

Design Asset
GIANTS_BACK.png
Side: Back
[thumbnail]

Actions:

- Change Design
- Upload New Design
- Remove Design

Selecting a design sets:

selectedDesignImageUrl

---

# Preview Panel

Before generation, show a preview:

blank image
+
design overlay

Preview should show placement box.

This allows the user to verify:

- correct blank
- correct design
- correct side
- correct scaling

Preview does not need full blending — simple overlay is sufficient.

---

# Generation Rules

Generation must use ONLY the explicitly selected assets.

The renderer must use:

selectedBlankImageUrl
selectedDesignImageUrl
renderSide

And the corresponding placement/mask data.

Generation must NOT infer assets automatically from productId or blankId.

---

# Data Structure

Products should store rendering configuration explicitly.

Example schema:

{
  "renderSide": "back",
  "selectedBlankImageUrl": ".../heather_grey_back.png",
  "selectedDesignImageUrl": ".../GIANTS_BACK.png",
  "placementKey": "back_print"
}

---

# Renderer Pipeline

Once selections are made:

blank
→ scale design to placement
→ apply mask (if available)
→ apply blend mode
→ apply opacity
→ export mockup

---

# UX Requirements

User flow must be:

Select blank
→ select design
→ preview composite
→ generate product images

No generation should occur before assets are explicitly selected.

---

# Success Criteria

Users can clearly see and control:

- which blank image is used
- which design file is used
- which side (front/back) is rendered

Generation becomes predictable and debuggable.

This prevents incorrect renders such as:

- front render when back was intended
- incorrect design PNG used
- incorrect blank asset used

---

# Phase 1 Scope

This change is strictly for deterministic product rendering.

AI model rendering and lifestyle scenes come later.
