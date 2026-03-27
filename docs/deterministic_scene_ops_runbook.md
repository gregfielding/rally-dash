# Deterministic scene templates — internal ops runbook

**Purpose:** Production readiness, QA on real SKUs (panties + tank tops), and **policy definition** for future auto-generation.  
**Scope:** Existing templates only — no new templates, no Shopify multi-image sync, no new automation until output quality and merchandising are confirmed.

**Related code:** `functions/lib/sceneRender*.js`, `functions/scripts/seed-*-scene-template.js`, `functions/lib/sceneTemplateEligibility.js`, `lib/shopify/galleryAssetOrdering.ts`, product page Alt scenes UI.

---

## 1. Templates in scope

| `sceneKey` | Role (intent) | Notes |
|------------|---------------|--------|
| `neutral_hanger` | PDP-first alt (tops) | Not for panties. |
| `backdrop_neutral` | Universal studio PDP | Panties + tops. |
| `flatlay_wood` | PDP + lifestyle | Broad categories. |
| `flatlay_boutique` | PDP selective / marketing-leaning | Narrower eligibility. |

---

## 2. Production checklist (per environment)

Run **staging → prod** in order.

### 2.1 Firestore `rp_scene_templates/{sceneKey}`

For each: `neutral_hanger`, `backdrop_neutral`, `flatlay_wood`, `flatlay_boutique`

- [ ] Document exists; `status: "active"`.
- [ ] **`backgroundAssetUrl`** is a stable HTTPS URL **or** you intentionally rely on Cloud Functions env (see §2.2).
- [ ] Optional: `shadowAssetUrl`, `garmentPlacement` (tune after first real outputs).
- [ ] Seeds: run from `functions/` if docs are missing or stale:
  - `node scripts/seed-neutral-hanger-scene-template.js`
  - `node scripts/seed-backdrop-neutral-scene-template.js`
  - `node scripts/seed-flatlay-wood-scene-template.js`
  - `node scripts/seed-flatlay-boutique-scene-template.js`

### 2.2 Cloud Functions env (when not using Firestore URLs)

Set as appropriate for the project (names align with workers):

- Hanger: `SCENE_HANGER_CREWNECK_BACKGROUND_URL`, optional `SCENE_HANGER_CREWNECK_SHADOW_URL`
- Backdrop: `SCENE_BACKDROP_NEUTRAL_BACKGROUND_URL`, optional `SCENE_BACKDROP_NEUTRAL_SHADOW_URL`
- Wood: `SCENE_FLATLAY_WOOD_BACKGROUND_URL`, optional `SCENE_FLATLAY_WOOD_SHADOW_URL`
- Boutique: `SCENE_FLATLAY_BOUTIQUE_BACKGROUND_URL`, optional `SCENE_FLATLAY_BOUTIQUE_SHADOW_URL`

### 2.3 Deploy

- [ ] Functions that include: `createSceneRenderJob`, `onSceneRenderJobCreated`, `updateSceneAssetApproval`.
- [ ] Firestore rules deployed if rules changed (jobs + templates + assets).

### 2.4 Smoke test (“done” for go-live)

On **one panty SKU** and **one tank SKU** (see §3 for which templates apply):

- [ ] Queue each **eligible** template from the product page → job completes **`succeeded`**.
- [ ] `rp_product_assets` row exists with expected `semanticAssetKind`, `gallerySort`, `approvalState`.
- [ ] `variants/{id}.sceneTemplateRenders[sceneKey]` populated.
- [ ] Approve / reject from UI updates asset + variant cache.
- [ ] Dashboard Shopify preview strip shows commerce images first, then scene URLs (rejected excluded from storefront-style ordering).

---

## 3. QA matrix: panties vs tank tops

Eligibility is **data-driven**: `blankCategoriesAllowed` / optional `productTypesAllowed` on the template doc, evaluated in `sceneTemplateEligibility.js` via `deriveBlankCategoryTags(product)` (e.g. `category`, `blankStyleCode` 8394 → panties, `tee` → tees, `tank` → tanks).

### 3.1 Eligibility (current seeds — verify in Firestore if you change seeds)

| Template | Panties (incl. 8394-style tags) | Tank tops (`tanks`) |
|----------|--------------------------------|---------------------|
| `neutral_hanger` | **No** | **Yes** |
| `backdrop_neutral` | Yes | Yes |
| `flatlay_wood` | Yes | Yes |
| `flatlay_boutique` | Yes | **No** (seed: `panties`, `bralettes`, `tees` only) |

If merchandising requires **boutique for tanks**, change **seed / Firestore** eligibility — not a new template.

### 3.2 Per-SKU QA checklist

1. **Inputs:** Variant has usable commerce sources (`flat_blended` / `flat_clean` / heroes). Jobs fail cleanly if missing.
2. **Per allowed template:** Queue → success → visual QC (placement, scale, background fit, brand).
3. **8394 / panties:** Confirm back-primary source order does not produce bad crops on backdrop / flatlays.
4. **Asset row:** Correct kind, `gallerySort`, approval state.
5. **Cache:** `sceneTemplateRenders` matches URL + approval.
6. **Ordering:** Gallery helpers respect approval → `galleryRole` → `gallerySort` (see `lib/shopify/galleryAssetOrdering.ts`).

---

## 4. Auto-generation — policy only (do not build until quality bar)

**Current state:** All shipped templates use `defaultGenerationScope: "manual_only"` in seeds; **no** automated queue in this slice.

Before any automation:

### 4.1 Decide explicitly

| Question | Record decision |
|----------|-----------------|
| Which **segments** (panties vs tanks vs tees, etc.) get auto scenes? | |
| **Which templates** per segment? | |
| **How many** outputs per product (cap N)? Per **variant** vs **hero color only**? | |
| **Trigger** (e.g. after flats exist, after readiness)? | |
| **Approval:** keep `autoApproveDefault` only where trusted; else `pending_review` / `needs_review` | |

### 4.2 Suggested gate

- Keep **manual-only** until a **documented** set of real SKUs is reviewed (target: dozens across panties + tanks).
- First automation candidate: **one** segment + **one** template + **hero variant only** + hard **cap** (e.g. 1–2 scenes per product).

### 4.3 Out of scope until approved

- New templates, new queue systems, Shopify multi-image sync.

---

## 5. Reference: gallery sort ladder (typical)

Documented in `galleryAssetOrdering.ts` comments; asset rows set by workers:

- `neutral_hanger`: `alt_scene_primary`, `gallerySort` **40**
- `backdrop_neutral`: `alt_scene_secondary`, **50**
- `flatlay_wood`: `alt_scene_secondary`, **52** (override via template `gallerySort`)
- `flatlay_boutique`: `alt_scene_secondary`, **54** (override via template `gallerySort`)

---

## 6. Ownership & revision

- Update this runbook when **seeds**, **eligibility rules**, or **go-live criteria** change.
- **Owner:** Design Ops / whoever runs template seeds and QC sign-off.

**Last updated:** 2026-03-27
