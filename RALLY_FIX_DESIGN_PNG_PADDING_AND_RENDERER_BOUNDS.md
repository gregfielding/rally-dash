# RALLY_FIX_DESIGN_PNG_PADDING_AND_RENDERER_BOUNDS.md

Author: Greg Fielding  
Project: Rally Panties DesignOps  
Purpose: Fix incorrect design placement caused by padded design PNGs, and add a renderer improvement so Rally auto-detects artwork bounds before scaling.

---

# 1. Problem Summary

The current product renderer is using a design PNG that contains the correct artwork but also includes large transparent padding above and below the artwork.

Example current design PNG behavior:

- the PNG contains:
  - `WILL DROP FOR`
  - `GIANTS`
- but the artwork only occupies a small strip within a much taller canvas

The renderer currently appears to scale the **entire PNG canvas** to the print area instead of scaling the **actual artwork bounds**.

Result:

- `WILL DROP FOR` lands too high, near the waistband
- the top line gets clipped or appears faintly above the intended print region
- `GIANTS` scales disproportionately large relative to the top line

This is not a deterministic rendering failure.  
It is a **design PNG bounding-box / placement bug**.

---

# 2. Immediate Fix

## A. Illustrator export fix

Design PNGs used by the deterministic renderer should be exported as **tight artwork bounds**, not full padded artboards.

### Correct design PNG format
The exported PNG should contain:

- transparent background
- only the design artwork
- no extra transparent padding above or below
- no guide labels
- no print area notes
- no large 2000×2000 empty canvas

Correct example:

```text
+----------------------+
|  WILL DROP FOR       |
|  GIANTS              |
+----------------------+
```

Incorrect example:

```text
+--------------------------------------+
|                                      |
|                                      |
|        WILL DROP FOR                 |
|        GIANTS                        |
|                                      |
|                                      |
+--------------------------------------+
```

### Illustrator instruction
Do NOT export the full artboard for the design PNG used in rendering.

Instead:

- export the artwork/group itself
- or use Asset Export on the artwork group
- or otherwise ensure the output PNG is tightly cropped to the artwork bounds

This will immediately improve placement because the renderer will scale the actual design, not padded empty space.

---

# 3. Why This Matters

The deterministic renderer should assume:

```text
designPNG = artwork only
```

not:

```text
designPNG = artwork + large transparent padding
```

Most POD systems and mockup pipelines assume the design file is tightly bounded.

If the design file contains large transparent margins, scaling becomes unreliable.

---

# 4. Required Renderer Improvement (Important)

Even after tightening Illustrator exports, Rally should become resilient to bad or padded PNGs.

## Requirement
Before scaling the design to the print area, the renderer should automatically compute the **actual visible artwork bounds** of the PNG.

In other words:

### Current behavior (bad)
```text
scale full PNG canvas
```

### Desired behavior (correct)
```text
detect non-transparent pixels
→ compute artwork bounding box
→ crop/normalize artwork region
→ scale artwork bounds to print area
```

This makes the renderer robust even when users accidentally upload padded PNGs.

---

# 5. Very Powerful Improvement for Rally’s Renderer

This is the improvement I want added:

## Auto-detect artwork bounds before scaling

### Concept
For every uploaded design PNG:

1. Read alpha channel
2. Detect all non-transparent pixels
3. Compute the smallest bounding box that contains visible artwork
4. Crop the image logically to that bounding box
5. Scale the cropped artwork to the print area
6. Place it centered within the print area
7. Then apply mask / blend / opacity as usual

This is a major stability improvement because it means:

- padded PNGs no longer break placement
- inconsistent Illustrator exports become less dangerous
- rendering becomes more user-proof
- design placement becomes far more predictable

This is the improvement used in many mature rendering pipelines.

---

# 6. Desired Rendering Order

The renderer should work in this order:

```text
blank image
→ load design PNG
→ detect visible artwork bounds
→ crop to artwork bounds
→ scale cropped artwork to print area
→ center within print area
→ apply optional fabric mask
→ apply blend mode
→ apply opacity
→ composite onto blank
→ export final mockup
```

Important:
Cropping to artwork bounds should happen **before** scaling and placement.

---

# 7. Technical Implementation Direction

## Option A — Use sharp + raw pixel inspection
Cursor can inspect the alpha channel of the PNG.

Suggested approach:

1. Load PNG with sharp
2. Ensure RGBA
3. Read raw pixel buffer
4. Scan for pixels where alpha > threshold
5. Determine:
   - minX
   - minY
   - maxX
   - maxY
6. Extract that region
7. Scale extracted region

Pseudo-logic:

```ts
load image as RGBA
for each pixel:
  if alpha > threshold:
    update minX, minY, maxX, maxY

boundingBox = {
  left: minX,
  top: minY,
  width: maxX - minX + 1,
  height: maxY - minY + 1
}

cropped = extract(boundingBox)
```

Threshold can be small, for example:

```text
alpha > 5
```

to avoid accidental dust/noise.

---

## Option B — Trim transparent edges using existing library behavior
If available, use a transparent trim function.

However, explicit alpha scanning is preferred because it is:
- deterministic
- debuggable
- threshold-aware
- easier to reason about

---

# 8. Placement Behavior After Bounds Detection

After cropping to the artwork bounds:

## Scale rule
Fit the cropped artwork inside the print area while preserving aspect ratio.

Recommended formula:

```text
scale = min(
  printArea.width / artwork.width,
  printArea.height / artwork.height
)
```

Then center it.

This should become the standard placement logic.

---

# 9. UI / Debugging Recommendation

Add a debug preview for design bounds.

For a render preview, it would help to visualize:

- selected blank
- print area rectangle
- original design PNG bounds
- detected artwork bounds
- final placed artwork

This would make problems instantly obvious.

At minimum, add logging like:

```text
original design size: 2000x2000
detected artwork bounds: 1210x420
scaled artwork size: 980x339
placement: back_print
```

This will be extremely helpful while tuning.

---

# 10. Success Criteria

The fix is successful when:

1. The uploaded Giants design renders correctly on the back blank
2. `WILL DROP FOR` no longer lands at the waistband
3. The renderer uses the full design composition proportionally
4. Padded PNGs no longer break placement
5. Final output visually matches the intended design layout

For the current Giants example, the result should look like:

- centered on the back panel
- correct relative size of top line vs bottom line
- no clipping
- no ghost text above the design

---

# 11. Recommended Immediate Work Order

Please implement in this order:

## Step 1
Fix the Illustrator-side export expectation:
- design PNGs should be tightly cropped to artwork bounds

## Step 2
Add renderer auto-bounds detection so Rally becomes resilient to padded PNGs

## Step 3
Update render placement to scale the detected artwork bounds, not the full PNG canvas

## Step 4
Add simple debug logs and/or preview for bounds detection and placement

---

# 12. Final Directive for Cursor

Please fix the current rendering bug by addressing both sides:

### Illustrator-side expectation
Design PNGs should ideally be tightly cropped to visible artwork.

### Renderer-side robustness
Rally must not rely on perfect exports.
The renderer should auto-detect the actual visible artwork bounds of the PNG before scaling and placement.

In short:

```text
bad padded design PNG
→ detect visible artwork
→ crop to bounds
→ scale to print area
→ place correctly
```

This should become part of the deterministic renderer so uploaded files are more forgiving and placement remains correct.

That improvement is important enough that it should be treated as a core renderer enhancement, not a nice-to-have.

---

# End of Document
