# Pre-deploy checklist: product generation (Phase 1)

Before testing the new product generation system after `firebase deploy --only functions`.

---

## 1. No required config for Phase 1 product flow

- **Mock job (deterministic composite):** No FAL key needed. Stage B (AI realism) is **off** by default (`MOCK_PHASE1_DETERMINISTIC_ONLY` is true). So deploy works as-is.
- **Product-only generation:** The worker uses the mockup URL as the asset and does **not** call fal.ai. No FAL key needed for this path.
- **Placeholder worker:** If `RP_USE_PLACEHOLDER_WORKER` (or `functions.config().rp.use_placeholder_worker`) is set, it only affects **on_model** jobs. **product_only** jobs always take the exact-composite path and ignore the placeholder flag.

So you can deploy and test the product flow without setting any new env vars or config.

---

## 2. Optional config (only if you need it later)

| Config | When to set | Effect |
|--------|----------------|--------|
| `FAL_API_KEY` or `firebase functions:config:set fal.key="..."` | When testing **model** generation (Amber) or mock **Stage B realism** | Enables real fal.ai calls for on_model and for mock quality=final |
| `MOCK_PHASE1_DETERMINISTIC_ONLY=false` | When you want mock **Stage B** (AI realism pass) | Enables fal.ai img2img/inpaint on the composite (Phase 2) |
| `RP_USE_PLACEHOLDER_WORKER=false` | When you want **real** on_model images (not SVG placeholders) | Uses real fal flux-lora for model generation |

---

## 3. Firestore / auth

- **rp_product_assets** delete: Allowed for admins with role **admin** or **ops**. Your “Delete all assets” button uses the client SDK; the signed-in user must be in `admins` with one of those roles or deletes will be denied.
- **rp_mock_jobs** create: Callable runs in the cloud; the function writes with Admin SDK, so creation is allowed. Ensure the user is authenticated when calling `createMockJob`.
- **rp_generation_jobs** create: Same as above; `generateProductAssets` is callable and writes with Admin SDK.

No Firestore rules changes are required for the current product flow.

---

## 4. After deploy – quick test

1. Open a product that has **Design + Blank** (e.g. SF Giants Heather Grey).
2. **Generate** tab → **Product Images** → click **Generate mockup**. Wait ~30–60 s (or until the product-only form appears).
3. Select a product-only preset (e.g. Ecommerce Flat or Ecommerce White), click **Generate N product image(s)**.
4. In **Assets**, you should see **one** new asset: the exact composite (heather grey + Giants print), no generic black panties.
5. If you had old wrong assets, use **Delete All Assets** to clear them, then re-run the test.

---

## 5. If something fails

- **Mock job never completes:** Check Functions logs for `onMockJobCreated` (fetch blank/design, sharp composite, Storage write). Ensure the product has `designId` and `blankId` and the design has a PNG URL.
- **Product Images says “Product must have a mockup”:** Run **Generate mockup** first and wait until `product.mockupUrl` is set (page polls; or refresh).
- **Generation job fails:** In Firestore, check the `rp_generation_jobs` doc for `debug` and any error. For product_only, the worker only needs the job’s `inputImageUrl` (mockup URL) and does not call fal.
- **Delete All Assets fails:** Confirm the signed-in user is in `admins` with role **admin** or **ops** and that Firestore rules are deployed (`firebase deploy --only firestore:rules` if you changed them).

No other code or config changes are required before testing the new product generation system after deploying functions.
