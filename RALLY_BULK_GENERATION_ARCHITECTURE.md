
# Rally Bulk Generation Architecture — Parent Job + Child Items

Purpose: Define the recommended architecture for the Rally bulk product generation system so that it scales safely and remains observable and retryable.

---

# Core Principle

Bulk generation should use a **two‑layer architecture**:

1. **Parent Job** — represents the overall request
2. **Child Job Items** — represent each unit of work

Instead of processing everything inside one large loop, each combination becomes a durable task.

---

# Why This Architecture

Benefits:

• Safe retries  
• Better observability  
• Parallel processing support  
• Simpler debugging  
• Scales to thousands of jobs

This pattern is used in most large job processing systems.

---

# Data Model

## Parent Job

Collection:

rp_bulk_generation_jobs

Example document:

{
  "id": "bulkJobId",
  "designIds": ["giants", "dodgers"],
  "blankIds": ["heather", "black"],
  "identityIds": ["amber", "maya"],
  "options": {
    "imagesPerProduct": 3
  },
  "status": "pending",
  "progress": {
    "total": 8,
    "completed": 0,
    "failed": 0
  },
  "createdAt": "timestamp",
  "createdBy": "userId"
}

---

## Child Job Items

Collection:

rp_bulk_generation_job_items

Each item represents a **single generation unit**.

Example:

{
  "bulkJobId": "bulkJobId",
  "designId": "giants",
  "blankId": "heather",
  "identityId": "amber",
  "productId": null,
  "mockJobId": null,
  "generationJobId": null,
  "status": "pending",
  "error": null,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}

---

# Job Expansion

When a parent job is created, the system expands:

designIds × blankIds × identityIds

Example:

2 designs × 2 blanks × 2 models = 8 job items

Each combination becomes one document in:

rp_bulk_generation_job_items

---

# Worker Execution Flow

Workers process items independently.

Process:

1. Query items where:

status == "pending"

2. Claim the job item

Update:

status → running

3. Resolve or create product

Product key:

designId + blankId

If product exists → reuse  
If not → create product

4. Generate mockup (if needed)

Create mock job with:

productId

Mockups should only be generated once per product.

5. Generate model images

Create generation job using:

product.mockupUrl

6. Store job IDs on item

mockJobId  
generationJobId

7. Mark item completed

status → completed

If error:

status → failed

---

# Parent Job Progress

Parent job progress should be calculated from child items.

progress.total = number of items

progress.completed = items where status == completed

progress.failed = items where status == failed

Parent status transitions:

pending → running → completed

or

running → failed

---

# Important Optimization

Mockups should **not be regenerated per model**.

Example:

GIANTS + HEATHER + AMBER  
GIANTS + HEATHER + MAYA  
GIANTS + HEATHER + SOFIA

All three share the same product mockup.

Flow should therefore be:

design + blank → product → mockup (once)

Then:

product + identity → model generation

---

# Optional Error Tracking Fields

Add the following fields to job items:

{
  "attemptCount": 0,
  "lastAttemptAt": null,
  "errorCode": null,
  "errorMessage": null
}

Benefits:

• Retry visibility  
• Debugging  
• Error analytics

---

# Concurrency Control

Workers should enforce limits such as:

max concurrent mock jobs = 5  
max concurrent generation jobs = 10

This prevents:

• API overload  
• inference cost spikes  
• queue instability

---

# Future UI

Once the backend is implemented, the UI can add:

Products → Bulk Generate

Form fields:

Select Designs  
Select Blanks  
Select Models  
Images Per Product

Submit creates one parent job.

Admins can view:

Bulk Jobs  
Status  
Progress  
Created Date

---

# Final Summary

Bulk generation should not run as a single in‑memory loop.

Instead the system should:

1. Create a parent bulk job
2. Expand combinations into child items
3. Process items independently
4. Track progress centrally

This architecture ensures the Rally Product Factory remains reliable as it scales to thousands of products.
