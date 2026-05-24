# HF07 print mask — Photoshop walkthrough (from ChatGPT/Cursor)

Context: how to create the black/white print-zone mask for the HF07 crewneck blank,
and how to verify it's wired up correctly in the dashboard's render profile UI.

Related code/docs:
- `RALLY_BLANK_MASK_RENDER_PROFILE_INTEGRATION.md`
- `app/blanks/[blankId]/BlankRenderProfileEditor.tsx`
- `lib/render/` and the `compositor8394` / mask-resolution code in `functions/lib/`

---

Yes — this is the right place to upload. The mask is a black-and-white PNG that tells the compositor "designs can land here (white), nowhere else (black)." For the HF07 crewneck, the white region is the chest print panel: starts about an inch below the neckline ribbing, ends at the top of the waistband ribbing, stays inside the shoulder seams.

One thing to flag before we start: the **Blank (front)** panel says "No front image." That's the top-level blank reference photo, separate from your per-color variant photos. The mask doesn't strictly need that to be uploaded to *work* — but you'll want it eventually so this side-by-side preview is useful. For now we'll source the reference from one of your variant photos.

**In Photoshop, step by step:**

Open the white/cream HF07 variant photo (the first one you showed me). Use that color specifically — the seams and ribbing edges are easiest to see against white fabric, and since the pose is identical across all 6 colors, one mask works for all of them.

Note the exact pixel dimensions (Image → Image Size). The mask must export at the same dimensions as this photo. If the photo is 1500×1500, the mask is 1500×1500.

Add a new layer below the photo and fill it with pure black. Name it "MASK BG."

On a new layer above the photo, named "PRINT ZONE," grab the **Pen tool** (P). You're going to trace the chest panel as a shape:
- **Top edge:** ~1 inch (visually) below the bottom of the neckline ribbing. Don't go up to the ribbing itself — the ribbed fabric prints terribly.
- **Side edges:** Stay inside the shoulder seams. Looking at your HF07 photos, the visible shoulder seam is where the sleeve meets the body — your mask edge sits a hair inside that seam line.
- **Bottom edge:** Just above the top of the waistband ribbing. Same reason as the top — don't print on the rib.
- Make it a smooth rounded shape, not a hard rectangle. The chest panel curves slightly at the corners and follows the shoulder slope.

Close the path. Right-click → **Make Selection** (0 px feather, anti-aliased on). Fill the selection with **pure white** (#FFFFFF).

Hide the photo layer. You should now see only your white shape on a black background. That's your mask.

**Flatten** (Layer → Flatten Image) and **Export As → PNG** at the original photo dimensions. No transparency, no anti-alias halos, just clean black and white. Name it `HF07_front_mask.png` so future-you can find it.

Back in the dashboard, click **Upload Mask** in the right panel and pick the PNG. The compositor will start using it on the next render.

**Two things to verify after upload:**

The "Print Mask (front)" panel should fill in with your shape and show the dimensions. If the shape looks rotated, mirrored, or scaled wrong relative to the garment, your dimensions didn't match — re-check Image Size in Photoshop.

Switch to the Render profile tab. The new green "Mask (front): Uploaded" pill should appear in the header, the inline pill next to "Mask / clip strategy" should match, and clicking **MASK: Filled** in the canvas toolbar should drop a magenta translucent shape over the chest of the preview garment. If all three show up together, the wiring is good.

Once that's done, run a fresh render of the SF Giants 69 design on HF07 and see if the print clips at the seams correctly. If yes, you're shipped. If the design looks weirdly squashed or the clip happens in the wrong place, the mask coordinate space might not be what we assumed — and that's a real bug worth filing back to Cursor with screenshots.
