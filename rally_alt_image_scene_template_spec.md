# ALT-IMAGE / SCENE TEMPLATE SYSTEM SPEC

**Rally Panties — DesignOps**  
**Version:** v1 deterministic scene pipeline  
**Status:** Proposed — canonical repo copy  
**Goal:** Reusable alt-product image generation for ecommerce, merchandising, and social, without AI model generation in v1.

---

## Alignment with existing Rally code

| Existing | Role | Relation to this spec |
|----------|------|------------------------|
| `rp_scene_presets` / `RpScenePreset` | AI / prompt-driven generation jobs | **Separate** — keep for on-model / Fal paths. |
| `lib/scenes/sceneTemplates.ts` + `productSceneRenderMvp.js` | In-code + env deterministic hanger MVP | **Superseded over time** by Firestore `rp_scene_templates` + workers. |
| `RpProductSceneRendersMvp` / `sceneRenders.hanger` on variant | MVP slot URLs | **Coexists** until migration; new pipeline uses typed `sceneTemplateRenders` (see `lib/types/firestore.ts`). |
| `rp_product_assets` / `RpProductAsset` | Packshots, heroes, jobs | **Extended** with optional semantic `assetKind`, `galleryRole`, scene template refs. |

**Collection names (v1):**

- `rp_scene_templates/{sceneTemplateId}` — deterministic template registry  
- `rp_scene_render_jobs/{jobId}` — queue / observability  
- `rp_product_assets/{assetId}` — canonical typed assets (existing collection)

---

## 1. Objective

Build a **second asset layer** (merchandising / feel) distinct from **core commerce truth** (what the product is).

**In scope (v1):** deterministic templates, variant-level color-accurate outputs when color matters, typed assets, approval, gallery ordering, jobs, admin UI (phased).

**Out of scope (v1):** AI model scenes, freeform prompts, orders, social scheduler, ad builder, theme redesign.

---

## 2. Architecture overview

**Current:** Design → Blank → Product / Variant → generated commerce assets  

**New:** + **Scene Template** → **Scene Render Job** → **Generated scene asset** (typed `rp_product_assets` + optional variant cache)

**Mental model:**

- Core commerce images → “what is the product?”  
- Scene images → “how does it merchandize?”

---

## 3. V1 scene template initial set (library)

| `sceneKey` / slug | `sceneType` | Notes |
|-------------------|-------------|--------|
| `neutral_hanger` | `hanger` | Tees, tanks, crewnecks; `preferredView: front`; neutral wall/studio; deterministic. |
| `neutral_backdrop` | `backdrop` | Most garments; front or back per blank default; plain background. |
| `wood_floor_flatlay` | `flatlay_floor` | Panties, tees, tanks, crewnecks; minimal props. |
| `boutique_blue_flatlay` | `flatlay_boutique` | Strong for panties / women’s; soft decorative props. |
| `soft_bed_scene` | `flatlay_bed` | Panties / soft apparel; textile surface. |
| `promo_hero_card` | `promo_card` | Optional; cutout + text-safe space; marketing/social. |

**Also referenced in doc:** `HANGER_STUDIO`, `FLATLAY_WOOD`, `FLATLAY_BOUTIQUE`, `BACKDROP_NEUTRAL`, `BED_SOFT`, `HERO_PROMO_CARD` — map 1:1 to slugs above in registry (`sceneKey` stable).

---

## 4. Output strategy (variant vs parent)

**Rule:** When **color** matters, generate at **variant** level:  
`rp_products/{parentId}/variants/{variantId}`

**Variant-level (color-accurate):** hanger, flat lays, backdrop, bed, other deterministic alt scenes.

**Parent-level (optional / cache only):** `displayMedia`, gallery summaries, promoted hero scene — **not** source of truth for color-dependent scenes.

---

## 5. Firestore — scene template document

**Collection:** `rp_scene_templates/{sceneTemplateId}`

Recommended fields (see TypeScript `RpSceneTemplate` in `lib/types/firestore.ts`):

- Identity: `name`, `sceneKey` (stable), `sceneType`, `status`, `templateMode: "deterministic" | "future_ai"`
- Eligibility: `productTypesAllowed`, `blankCategoriesAllowed`, `supportsFront`, `supportsBack`, `supportsPerColor`
- Defaults: `defaultGenerationScope` (`hero_variant_only` | `all_colors` | `manual_only`), `defaultGalleryRole`, `sortOrder`, `templateVersion`
- Assets: `backgroundAssetUrl`, `shadowAssetUrl`, `maskAssetUrl`, `placementZone`, `renderDefaults`
- Optional: `usageTags`, `notes`, `preferredSourceKinds` (ordered asset-kind priority for compositing)
- Audit: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

---

## 6. Firestore — variant scene output (cache / convenience)

**Not sole source of truth** — canonical rows live in `rp_product_assets`.

On variant, keyed by `sceneTemplateSlug` / `sceneKey`:

- Type: `RpProductVariantSceneRender` — `sceneTemplateId`, `sceneTemplateSlug`, `sceneType`, pipeline `status`, `approvalState`, URLs, `sourceView`, `sourceAssetRef`, fingerprints, errors, timestamps.

**Field name in app types:** `sceneTemplateRenders` (map) to avoid clashing with existing `sceneRenders` (`RpProductSceneRendersMvp` hanger MVP). Implemented as `RpProductVariant.sceneTemplateRenders` in `lib/types/firestore.ts`.

---

## 7. Firestore — `rp_product_assets` extensions

Each generated scene should create or update an **`rp_product_assets`** row with:

- `semanticAssetKind` (commerce vs scene vs promo vs future AI)  
- `galleryRole`, `gallerySort`  
- `sceneTemplateId`, `sceneTemplateSlug`  
- `variantDocId`, `blankVariantId`, `productId`  
- `approvalState` (distinct from pipeline `status` where applicable)  
- `sourceType: "deterministic_scene"` | `"commerce_render"` | later `"ai_generated"`  
- Provenance: `sourceFingerprint`, `templateVersion` in `metadata`

Existing `RpProductAsset.assetType` / `status` / `review` remain for backward compatibility.

---

## 8. Asset taxonomy (kinds vs roles)

**Kinds** (what the asset *is*) — use `semanticAssetKind`:

**Commerce truth:** `commerce_front_clean`, `commerce_back_clean`, `commerce_front_hero`, `commerce_back_hero`, `commerce_front_blended`, `commerce_back_blended`

**Deterministic scenes:** `scene_hanger`, `scene_backdrop_neutral`, `scene_flatlay_wood`, `scene_flatlay_boutique`, `scene_bed_soft`, `scene_folded`, `scene_hero_studio`

**Marketing:** `promo_social_card`, `promo_drop_hero`, `promo_campaign_tile`

**Future AI:** `ai_model_studio`, `ai_model_lifestyle`, `ai_scene_editorial`, `ai_social_campaign`

**Roles** (where it *plays*) — `galleryRole`: `hero_front`, `hero_back`, `gallery_primary`, `gallery_secondary`, `alt_scene_primary`, `alt_scene_secondary`, `social_scene`

Same asset: e.g. `kind = scene_hanger`, `galleryRole = alt_scene_primary`.

---

## 9. Gallery ordering (deterministic)

**General PDP (variant selected):**

1. Primary commerce for main printable side  
2. Opposite-side clean  
3. Secondary commerce if useful  
4. Primary alt scene  
5. Secondary alt scene  
6. Extra promo / hero scene (if PDP-eligible)

**8394 back-primary panties:** back hero → front clean → back clean/blended → boutique or bed → wood → optional promo.

**Front-print tees/crew:** front hero → back clean → hanger → backdrop → wood → optional promo.

**Sources:** approved/auto-approved `rp_product_assets` + rules; optional cached ordered list on variant for UI speed — **truth** remains typed assets + `galleryRole` + `gallerySort`.

---

## 10. Scene render jobs

**Collection:** `rp_scene_render_jobs/{jobId}`

Fields: `productId`, `productVariantId?`, `blankVariantId`, `sceneTemplateId`, `sceneKey`, `jobType: "scene_render"`, `generationScope`, `status`, `inputSnapshot`, `output`, `errorMessage`, `attemptCount`, audit fields.

**Why:** retry, observability, approval history, concurrency.

---

## 11. Generation input hierarchy

1. Variant-native commerce: flat_blended / flat_clean, commerce heroes  
2. Else: `media.heroBack` / `media.heroFront` / `mockupUrl`  
3. Else: **fail cleanly** — no fake composite

Templates should declare **`preferredSourceKinds`** (ordered).

---

## 12. Default generation policy (v1 cost control)

- **Panties:** hero color: boutique + (wood **or** bed); all colors optional/manual later.  
- **Tees/tanks/crew:** hero: hanger + backdrop; all-colors hanger optional.  
- Do **not** auto-generate full matrix of 8 scenes × every color.

---

## 13. Approval

- **status** = pipeline (`queued` | `processing` | `generated` | `error` | …)  
- **approvalState** = merchandising (`auto_approved` | `needs_review` | `approved` | `rejected`)

Trusted deterministic templates → `auto_approved`; new templates → `needs_review`; future AI → `needs_review`.

---

## 14. Parent vs variant ownership

- **Variant:** any scene that **changes with garment color**.  
- **Parent:** promo/campaign tiles that intentionally use hero/default only.

Default: if it changes with color → `productVariantId` on asset.

---

## 15. UI (phased)

- **Admin:** `/scene-templates` — CRUD templates, assets, placement, eligibility.  
- **Product:** Scene Assets section — per variant, generate/retry, approve/reject, gallery hints.  
- **Approval:** bulk approve deterministic, archive failures.

---

## 16. Backend (phased)

1. `createSceneRenderJob` (callable or internal)  
2. `onSceneRenderJobCreated` worker — compose, upload, write `rp_product_assets`, update `sceneTemplateRenders` cache  
3. `retrySceneRenderJob`  
4. `approveProductAsset` / `rejectProductAsset`

---

## 17. Storage paths (suggested)

- `rp/scene_templates/{sceneTemplateId}/background.png` …  
- `rp/products/{productId}/variants/{variantId}/scenes/{sceneKey}/final.jpg`  
- Parent-owned: `rp/products/{productId}/scenes/{sceneKey}/final.jpg`

---

## 18. Staleness

Regenerate when: source commerce asset changes, `templateVersion` changes, placement metadata changes, hero/default changes (for parent-owned). Track `sourceFingerprint`, `generationFingerprint`, `templateVersion` on jobs and assets.

---

## 19. Implementation phases (recommended)

| Phase | Scope |
|-------|--------|
| **1** | Firestore types, taxonomy enums, `rp_scene_templates` + `rp_scene_render_jobs` shapes, seed docs (optional) |
| **2** | Worker for **one** template (e.g. hanger or wood flatlay), `rp_product_assets` writes, product UI section |
| **3** | Approval, gallery ordering, retry/regeneration |
| **4** | Remaining v1 templates + eligibility + auto-queue policy |

---

## 20. Acceptance criteria (v1 complete)

1. Admin can define templates in Firestore-backed UI  
2. Enqueue scene jobs from product creation or manual action  
3. Worker produces deterministic outputs from commerce sources  
4. Typed `rp_product_assets` rows  
5. `status` + `approvalState` on assets  
6. Product page shows scene assets per color  
7. Gallery ordering includes approved scenes after commerce  
8. Parent vs variant ownership consistent  
9. Staleness via fingerprint/version  
10. No AI model required for v1  

---

## 21. Cursor deliverable format (when implementing)

Report:

1. Files changed  
2. Firestore schema added/updated  
3. Asset kinds added  
4. Scene template shape  
5. Render job shape  
6. Generation flow  
7. Approval workflow  
8. Gallery ordering logic  
9. Product-owned vs variant-owned  
10. TypeScript / Node checks passing  

---

*End of spec.*
