
# Response to Cursor — Rally Product Factory Review

Thank you for the detailed review. This feedback is very helpful and confirms that the current implementation is largely aligned with the intended Rally Product Factory architecture.

Overall, I agree with the assessment:

- The **single-product factory pipeline is already working**.
- The system already supports **Design + Blank → Mockup → Model generation**.
- The remaining work is primarily **bulk orchestration and export**, not structural changes.

Below are confirmations and priorities for the next phase.

---

# 1. Architecture Confirmation

The review correctly identifies the core pipeline:

Design
+
Blank
↓
Mockup
↓
LoRA generation
↓
Product assets

The current system already supports this end-to-end for **single products**, which is exactly the foundation we wanted before attempting bulk generation.

The current schema separation is also correct:

designs  
rp_blanks  
rp_products  
rp_product_assets  
rp_generation_jobs  

No structural refactor is required.

---

# 2. Model Storage Paths

I agree with the recommendation to **keep the current storage paths**.

Current system:

products/{productId}/mockup.png  
rp/products/{productId}/assets/{jobId}_{i}.png  

This works well with the existing product asset system.

For now:

- **Keep these paths unchanged**
- Continue treating `rp_product_assets` as the source of truth

Later we may add a **logical gallery abstraction**, but it should not require moving existing files.

---

# 3. Gallery / Hero Assets

The current approach using:

heroAssetId  
heroAssetPath  
rp_product_assets  

is a good system for selecting approved product images.

If we add a gallery concept later, it should likely be **logical rather than filesystem-based**, for example:

asset.type = "model"  
asset.type = "hero"  
asset.type = "mockup"  

This would make assets easier to query without introducing additional storage folders.

---

# 4. Bulk Generation (Next Major Feature)

The recommended bulk job architecture looks good.

The next system to implement should likely be:

rp_bulk_generation_jobs

Example structure:

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

- ensure product exists
- create mock job (productId)
- create generation jobs (model set)
- update job progress

This aligns with the intended **product factory** concept.

---

# 5. Idempotent Product Creation

I agree that products should be reused rather than duplicated.

When creating products in bulk:

productKey = designId + blankId

If a product already exists:

reuse product  
add model assets

If not:

create new product

This prevents duplicate products and allows additional model photos to be added later.

---

# 6. Bulk Generator UI (Future)

When bulk generation is implemented, a new UI entry point makes sense:

Products → Bulk Generate

Form inputs:

Select Designs  
Select Blanks  
Select Models  
Images Per Product  
Start Generation

This should create a single **bulk generation job**, which the worker processes asynchronously.

---

# 7. Rate Limiting and Cost Controls

Agree with the suggestion to include throttling.

Bulk workers should enforce limits such as:

max concurrent mock jobs  
max concurrent generation jobs  

This protects:

- API quotas
- inference costs
- queue stability

---

# 8. Ecommerce Export

The current product schema already contains most required data:

title  
description  
tags  
heroAsset  

A formal **export layer** can be added later once the catalog grows.

For example:

/api/export/shopify  
/api/export/printify  

This is not urgent.

---

# 9. Next Development Priority

The next logical milestone should be:

Bulk product generation

Not new schema work.

The system already supports the product factory architecture; we mainly need:

- bulk job collection
- worker
- UI entry point
- progress tracking

---

# Final Note

The Rally system now successfully separates:

Design creation  
Garment templates  
Product generation  
AI model generation  

which is the correct architecture for scaling a large catalog of products.

The implementation looks solid. The focus going forward should be **automation (bulk generation)** rather than restructuring the existing pipeline.
