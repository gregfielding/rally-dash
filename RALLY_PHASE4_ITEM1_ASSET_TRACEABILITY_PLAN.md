# Phase 4 Item 1: Asset/Result Traceability — Smallest Implementation Slice

## Goal

- Expose the created hero asset in batch hero results.
- Persist `assetId` (and optionally URL) so the Batch Hero UI can link directly to the created asset.
- Keep product link + asset link in results.

---

## 1. Where assetId will be captured

**In the worker:** `functions/index.js` — **onMockJobCreated**

- When the worker creates the hero asset (`rp_product_assets.add(sanitizedAsset)`), it currently does not keep the document reference. We will:
  - Capture the ref: `const heroAssetRef = await db.collection("rp_product_assets").add(sanitizedAsset);`
  - Store in variables in scope for the rest of the try block: e.g. `heroAssetId = heroAssetRef.id`, `heroAssetUrl = heroUrl` (already have `heroUrl`).
- When the job is marked succeeded (same function, later in the try block), the job document is updated with:
  - `output: { draftAssetId, finalAssetId, heroAssetId?, heroAssetUrl? }`
  - Add `heroAssetId` and `heroAssetUrl` to `output` only when `job.heroSlot` was set (i.e. when we created a hero asset).

So **assetId is persisted on the existing job document** (`rp_mock_jobs/{jobId}`) in `output.heroAssetId` and `output.heroAssetUrl` once the worker finishes. No new collection or new field on the product is required for traceability.

---

## 2. How the UI will read it

**Async:** The job runs asynchronously. When the user clicks "Run batch", the client gets back `jobId` per created row; the asset does not exist yet. So the UI cannot show the asset link immediately; it must **read the job document after the worker has completed**.

**Options:**

- **A) Poll:** After displaying results, for each result with `action === "created"` and `jobId`, poll `rp_mock_jobs/{jobId}` (e.g. every 2–3 s) until `status === "succeeded"` and `output.heroAssetId` is present, then update that result row with `assetId` and `assetUrl`.
- **B) "Refresh results" button:** Results table shows "Job queued" for created rows. A single "Refresh results" button fetches the job docs for all result `jobId`s and merges `output.heroAssetId` / `output.heroAssetUrl` into the corresponding results, then re-renders so "View asset" links appear.

**Smallest slice:** **B** — "Refresh results" button. No timers or subscriptions; user clicks once after jobs have had time to complete. Optional later: add polling or realtime listener.

**Concrete UI flow:**

1. User runs batch; results state is set with `HeroResult[]` (each has `productId`, `slug`, `side`, `action`, `jobId?`, `error?`).
2. Extend `HeroResult` with optional `assetId?: string` and `assetUrl?: string`.
3. For rows with `action === "created"` and `jobId`, Detail column shows "Job queued" (and product link). No asset link yet.
4. "Refresh results" button: for each result that has `jobId` and no `assetId`, call `getDoc(doc(db, "rp_mock_jobs", jobId))`. If `data().status === "succeeded"` and `data().output?.heroAssetId`, set that result’s `assetId` and `assetUrl` (merge into a new results array and set state).
5. Re-render: for results that now have `assetId`, show "View product" (existing) and "View asset" (link to product page with asset context; see below).
6. Product link: keep existing link to `/products/${slug}`.
7. Asset link: link to `/products/${slug}?assetId=${assetId}` so the product page can optionally scroll to or highlight that asset in a later change. For the smallest slice, the link can be the same URL; we still show "View asset" so the user knows an asset was created and can open the product’s Assets tab.

---

## 3. Files / functions to touch

| File | Change |
|------|--------|
| **functions/index.js** | **onMockJobCreated:** (1) When creating the hero asset, capture ref: `const heroAssetRef = await db.collection("rp_product_assets").add(...)`. (2) In the same try block, declare variables (e.g. `let heroAssetId = null; let heroAssetUrl = null;`) before the hero block, set them when creating the hero asset. (3) In the final `jobRef.update({ status: "succeeded", output: { ... } })`, add `...(heroAssetId && { heroAssetId, heroAssetUrl })` to `output`. |
| **app/products/batch-hero/page.tsx** | (1) Extend `HeroResult` with `assetId?: string` and `assetUrl?: string`. (2) Add "Refresh results" button (visible when `results` exists and some rows have `jobId` and no `assetId`). (3) On click: for each such result, `getDoc` the job; if succeeded and `output.heroAssetId`, update that result’s `assetId`/`assetUrl` and set results state. (4) In the results table Detail column: show product link (existing); if `r.assetId` (or `r.assetUrl`), show a second link "View asset" to `/products/${r.slug}?assetId=${r.assetId}`. (5) Optional: use `getDoc` from Firestore (need `doc`, `getDoc` and `db` if not already). |

No new hooks or new API; job document is the source of truth for `heroAssetId` / `heroAssetUrl`.

---

## 4. Summary

- **Capture:** Worker writes `output.heroAssetId` and `output.heroAssetUrl` on `rp_mock_jobs/{jobId}` when the hero asset is created.
- **Read:** Batch Hero UI uses a "Refresh results" button that fetches each result’s job doc and merges `output.heroAssetId` / `output.heroAssetUrl` into the result row.
- **Display:** Results table shows product link (unchanged) and, when `assetId` is present, a "View asset" link to the product page (with `?assetId=` for future highlighting if desired).
- **Touch:** `functions/index.js` (worker output shape), `app/products/batch-hero/page.tsx` (result type, refresh logic, result table links).
