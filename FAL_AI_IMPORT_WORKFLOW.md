# Fal.ai Image Import Workflow

## Overview
This document explains how to import images generated via Fal.ai into your datasets.

## Current Workflow

### 1. Generate Images via Fal.ai
- Go to **Training** page (`/lora/training`)
- Select an identity (e.g., Amber)
- Select a LoRA artifact
- Configure your generation settings:
  - Prompt
  - Negative prompt
  - Image count (1-8)
  - Scale (0.4-0.9)
  - Size preset (square/portrait/landscape)
  - Optional: Seed, Body/Product artifact stacking
- Click **"Run Test Generation"**
- Wait for generation to complete (images appear in "Latest Generation Results")

### 2. Import Images to Dataset
After generation completes:

1. **Select Target Dataset**
   - In the "Latest Generation Results" section, find the dropdown labeled "Promote images to dataset:"
   - Select the dataset you want to add images to (e.g., "Amber Face v1")

2. **Add Individual Images**
   - Each generated image has an **"Add to Dataset"** button
   - Click the button for each image you want to import
   - The image will be:
     - Downloaded from Fal.ai
     - Saved to Firebase Storage at `datasets/{datasetId}/{genId}_{imageIndex}.jpg`
     - Added to Firestore as an `rp_dataset_images` document
     - Tagged with source: `fal_inference`
     - Preserves generation metadata (prompt, seed, scale, etc.)

3. **Verify Import**
   - Go to the dataset detail page (`/lora/datasets/{datasetId}`)
   - You should see the imported images in the image grid
   - Images from Fal.ai will have `isApproved: false` by default (you can approve them later)

## Cloud Functions

### `addGenerationImageToDataset`
**Location:** `functions/index.js`

**Purpose:** Copies a Fal.ai generated image into a dataset.

**Parameters:**
- `identityId` (string, required)
- `genId` (string, required) - Generation document ID
- `imageIndex` (number, required) - Index of image in `resultImageUrls` array
- `datasetId` (string, required) - Target dataset ID

**What it does:**
1. Validates authentication and parameters
2. Fetches the generation record from `rp_generations`
3. Validates the dataset exists and matches identity
4. Downloads the image from Fal.ai URL
5. Saves to Firebase Storage at `datasets/{datasetId}/{genId}_{imageIndex}.jpg`
6. Makes the file publicly readable
7. Creates an `rp_dataset_images` document with:
   - `source: "fal_inference"`
   - `isApproved: false`
   - Generation metadata (prompt, seed, scale, steps, loraId, etc.)
8. Updates the generation record with `addedToDatasetId`

**Recent Fix:**
- Changed from `getSignedUrl()` to `makePublic()` + public URL construction
- This avoids IAM permission errors (`Permission 'iam.serviceAccounts.signBlob' denied`)

## UI Components

### ArtifactsPanel (`app/lora/training/components/ArtifactsPanel.tsx`)
- Shows latest generation results
- Dataset selector dropdown
- "Add to Dataset" button for each image
- "Add to Reference Library" button (alternative workflow)

### Dataset Detail Page (`app/lora/datasets/[datasetId]/page.tsx`)
- Displays all images in the dataset
- Shows image metadata (kind, source, etc.)
- Allows manual uploads
- Shows "Import from Other Datasets" section

## Tips

1. **Bulk Import:** Currently, you need to click "Add to Dataset" for each image individually. For bulk imports, you can:
   - Use the dataset detail page to import from other datasets
   - Or we could add a "Add All to Dataset" button (future enhancement)

2. **Image Approval:** Fal.ai images are imported with `isApproved: false`. You may want to:
   - Review them in the dataset detail page
   - Approve them manually (if we add that feature)
   - Or auto-approve them (modify the Cloud Function)

3. **Metadata Preservation:** All generation parameters are preserved:
   - Prompt, negative prompt
   - Seed, scale, steps
   - LoRA ID used
   - Fal.ai request ID

4. **Storage Organization:** Images are stored at:
   - `datasets/{datasetId}/{genId}_{imageIndex}.jpg`
   - This makes it easy to trace back to the generation

## Troubleshooting

### "Failed to add to dataset"
- Check that you've selected a dataset in the dropdown
- Verify the generation completed successfully
- Check browser console for detailed error messages
- Verify Firebase Storage permissions

### Images not appearing in dataset
- Refresh the dataset detail page
- Check that the image was actually added (check Firestore `rp_dataset_images` collection)
- Verify the dataset ID matches

### Permission errors
- The function now uses `makePublic()` instead of signed URLs
- If you still see permission errors, check Firebase Storage rules

## Future Enhancements

1. **Bulk Import:** Add "Add All to Dataset" button
2. **Auto-approval:** Option to auto-approve Fal.ai images
3. **Batch Operations:** Import multiple images in one call
4. **Image Preview:** Show image before importing
5. **Import History:** Track which images came from which generations
