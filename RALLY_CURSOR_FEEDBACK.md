
# Feedback for Cursor — Rally Dashboard Progress

First, great work implementing the architecture alignment. The system now closely matches the intended Rally production pipeline. I reviewed the implementation summary and wanted to share feedback, confirmations, and a few improvements to consider.

---

# 1. Overall Architecture

The current implementation aligns very well with the intended pipeline:

Illustrator  
↓  
SVG artwork  

Photoshop  
↓  
PNG artwork  

Rally Dashboard  
↓  
mockup generation  

LoRA Ops  
↓  
model generation  

This separation of concerns is exactly what we want:

• Design creation happens outside the app  
• The dashboard acts as a production engine  

No changes needed here.

---

# 2. Design File Support (SVG / PNG / PDF)

The implementation of design assets is excellent.

Current structure:

DesignDoc.files  
 svg  
 png  
 pdf  

And the UI placement:

Design Detail  
→ Files Tab  
 SVG (master vector)  
 PNG (rendering/AI)  
 PDF (print vendor)  

This matches real-world apparel production workflows.

No refactoring needed.

---

# 3. Products Page Flow

The new flow:

Products  
+ Create from Design + Blank  

with modal:

Select Design  
Select Blank  
Create & Generate Mockup  

is exactly correct.

It complements the existing **Design → Mockups** flow and supports both workflows.

### Design-first workflow

Design → try blanks → preview

### Product-first workflow

Product → choose design → choose blank

Both are valuable and should remain.

---

# 4. Mockup Storage

The storage pattern:

/products/{productId}/mockup.png

is correct.

Pipeline:

mock job  
↓  
render image  
↓  
store in Storage  
↓  
update product.mockupUrl  

This is clean and scalable.

---

# 5. LoRA Integration

The addition of:

inputImageUrl

to generation jobs is excellent.

Passing this into `debugInfo` while keeping the current **text → image** generation pipeline is a good incremental step.

This prepares the system for future **img2img generation** without breaking the current worker.

---

# 6. Designs Table Preview

Moving the preview image to the first column is a strong usability improvement.

Preview | Design | Team | Tags | Colors

Design libraries become difficult to use without thumbnails, so this change will matter as the number of designs grows.

---

# 7. Create Design Modal

Keeping the Create Design modal **metadata-only** was the correct decision.

Uploads belong in:

Design Detail → Files

This matches real-world workflows:

Create design record  
↓  
designer exports assets  
↓  
upload artwork  

No changes needed.

---

# 8. Suggested Improvements

The implementation is strong, but there are three small improvements worth adding.

### Improvement 1 — Add hasPng

We added:

hasSvg

But the rendering pipeline actually depends on PNG.

Consider adding:

hasPng  
hasPdf  

Recommended schema:

hasSvg  
hasPng  
hasPdf  

This allows simple UI checks like:

if (!design.hasPng) disable mock generation

---

### Improvement 2 — Prevent Mock Jobs Without PNG

Currently the UI shows:

(no PNG)

but the backend should also guard against this.

Inside:

createProductFromDesignBlank

validate:

if (!design.files.png) throw "Design missing PNG preview"

This prevents job failures and protects the pipeline.

---

### Improvement 3 — Standardize Product Naming

Products are currently generating names and slugs automatically.

Recommend standardizing naming format:

{TEAM} {STYLE} Panty

Examples:

Giants Heather Panty  
Dodgers Black Panty  
Orioles Lace Panty  

This will help with:

• Shopify export  
• product browsing  
• SEO

---

# 9. Alignment with Product Factory Architecture

The document **RALLY_AI_PRODUCT_FACTORY.md** describes the long-term direction where the system supports automated product generation.

Concept:

Design  
+  
Blank  
+  
Model  
=  
Product Images  

Most of this architecture is already implemented.

Please review the document and confirm:

1. Whether the current system already supports this architecture.
2. Any small schema or storage adjustments needed to support bulk generation in the future.

---

# 10. Product Factory Review (Cursor Response Summary)

Cursor’s review confirmed:

Single-product pipeline is working:

Design + Blank → Mockup → Model generation.

Only missing elements:

• Bulk generation orchestration  
• Ecommerce export API

---

# 11. Model Storage Paths

Current storage:

products/{productId}/mockup.png

rp/products/{productId}/assets/{jobId}_{i}.png

Recommendation:

Keep these paths unchanged.

Continue treating `rp_product_assets` as the source of truth.

A logical gallery abstraction can be added later without moving existing files.

---

# 12. Gallery / Hero Asset Handling

Current approach:

heroAssetId  
heroAssetPath  
rp_product_assets  

This works well.

Future improvement (optional):

asset.type = "mockup"  
asset.type = "model"  
asset.type = "hero"

This makes assets easier to query without requiring new storage folders.

---

# 13. Bulk Generation (Next Major Feature)

Next system to implement:

rp_bulk_generation_jobs

Example schema:

bulkJob  
 id  
 designIds[]  
 blankIds[]  
 identityIds[]  
 options { imagesPerProduct }  
 status  
 progress { total, completed, failed }  
 createdAt  

Worker flow:

for each design × blank:

ensure product exists  
create mock job (productId)  
create generation jobs (model set)  
update job progress

---

# 14. Idempotent Product Creation

Products should be reused instead of duplicated.

Use key:

productKey = designId + blankId

If exists:

reuse product and add assets.

If not:

create product.

---

# 15. Bulk Generator UI (Future)

Proposed UI:

Products → Bulk Generate

Fields:

Select Designs  
Select Blanks  
Select Models  
Images Per Product  
Start Generation

This creates a bulk job processed asynchronously.

---

# 16. Rate Limiting and Cost Controls

Bulk workers should enforce limits:

max concurrent mock jobs  
max concurrent generation jobs  

This protects:

• API quotas  
• inference costs  
• queue stability

---

# 17. Ecommerce Export (Future)

Product schema already contains most required data:

title  
description  
tags  
heroAsset  

Possible future APIs:

/api/export/shopify  
/api/export/printify

This is not urgent.

---

# 18. Final Architecture Status

The Rally system now correctly separates:

Design creation  
Garment templates  
Product generation  
AI model generation  

This is the correct architecture for scaling a large product catalog.

---

# 19. Next Development Priority

The next milestone should be:

Bulk Product Generation

Not schema changes.

Needed pieces:

• bulk job collection  
• worker orchestration  
• UI entry point  
• progress tracking

---

# Final Note

The Rally system now functions as a **product production engine** rather than a design tool.

Focus moving forward should be **automation and bulk generation**, not restructuring the existing pipeline.

The current implementation is strong and aligned with the intended product factory architecture.
