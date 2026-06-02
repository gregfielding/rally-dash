# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Rally Panties DesignOps" — internal dashboard for an AI-powered design → mockup → Shopify publishing pipeline. Next.js 14 (App Router, TypeScript) frontend + Firebase (Auth, Firestore, Storage) + Firebase Cloud Functions backend. Generation runs through **fal.ai** (LoRA inference); image compositing uses **sharp**; Shopify sync runs from the functions package.

## Commands

Web app (repo root):
- `npm run dev` — Next.js dev server on `:3000`
- `npm run dev:clean` — wipe `.next` then dev (use when stale build cache causes weirdness)
- `npm run build` / `npm run start`
- `npm run lint` — `next lint`
- `npm run deploy:functions` / `deploy:firestore:rules` / `deploy:storage:rules`

Cloud functions (`functions/` — Node 20):
- `npm --prefix functions run serve` — Firebase emulator (functions only)
- `npm --prefix functions run deploy` — deploy all functions
- `npm --prefix functions run logs` — tail deployed logs
- Seeders/migrations live under `functions/scripts/`, exposed as `seed:*`, `migrate:*`, `backfill:*`, `shopify:*`, `verify:*` npm scripts in `functions/package.json`. Most accept `--dry-run`.

No automated test suite is configured. Verification is done via emulator, scripts in `functions/scripts/`, and manual UI exercise.

## Architecture

### Layout
- `app/` — Next.js App Router routes. Top-level surfaces: `blanks`, `designs`, `products`, `teams`, `leagues`, `catalog`, `design-teams`, `inspirations`, `lora`, `publish`, `review`, `analytics`, `dashboard`, `design-system`, `login`. The only API route is `app/api/storage-proxy/route.ts` (signed-URL/CORS proxy for Firebase Storage).
- `components/` — shared React (MUI-based) plus feature subfolders (`components/products`, `components/design-teams`).
- `lib/` — frontend domain logic and Firestore types. Major modules: `blanks/`, `designs/`, `products/`, `render/`, `generation/`, `hero/`, `scenes/`, `print/`, `shopify/`, `taxonomy/`, `batchImport/`, `bulkDesignUpload/`, `teams/`, `productTags/`, `dashboard/`, `designSystem/`, `firebase/` (client SDK config + auth), `providers/` (Auth + SWR), `hooks/`, `types/`.
- `functions/` — Cloud Functions. Entry point `functions/index.js` registers **~52 callable/trigger functions**; implementations are split into `functions/lib/*.js` modules (one file per concern: `compositor8394`, `launchProductsFromDesign`, `productFlatRenderMvp`, `productSceneRenderMvp`, `variant8394Pipeline`, `shopifySync`, `shopifySmartCollections`, `bulkDesignImport*`, etc.). Seed/migration helpers in `functions/scripts/`.
- Firebase config at repo root: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `.firebaserc`.
- TypeScript path alias: `@/*` → repo root (set in `tsconfig.json`).

### Core object model

Per `RALLY_CORE_OBJECT_MODEL_AUDIT.md` (read this if you're touching schema):

| Object | Collection | Owns |
|---|---|---|
| **Blank** | `rp_blanks` (+ subcollection `rp_blank_masks`) | Garment type, color, placements, render views, masking; planned: Shopify defaults + pricing/weight defaults |
| **Design** | `designs` | Reusable artwork (lightPng/darkPng/svg/pdf), team+league, design type, print colors, status |
| **Generated Product** | `rp_products` | A specific design × blank × team × variant; renderSetup, media, taxonomy, Shopify sync state |
| **Team** | `design_teams` (canonical; legacy `teams` collection merged in Phase F 2026-06-01) | Full name, league/sport codes, CMYK + Pantone colors, productCatalogMatrix (approved blanks per team), generation defaults. Doc id is the canonical slug (e.g. `san_francisco_giants`). |
| **Taxonomy** | `rp_taxonomy_sports`, `rp_taxonomy_leagues`, `rp_taxonomy_entities`, `rp_taxonomy_themes`, `rp_taxonomy_design_families` | Codes referenced by products for filtering, related-products, and Shopify tags |

Known structural quirks (don't refactor without checking the audit doc first):
- Placement authority is **split** between Blank (`placements[]`) and Design (`placementDefaults[]`). Target is Blank-as-canonical, but both are live today.
- Products link to design/blank by **id only** — no version pinning (`designVersionId`/`blankVersionId` are not implemented).
- Blending/render-style (blendMode, blendOpacity) lives on **Product `renderSetup`**, not Blank.

### Render / generation pipeline

The dominant pipeline is for blank "8394" (a panty SKU) — most files prefixed `*8394*` or `compositor8394*` belong to it. Generation flow:

1. **Design upload** → batch importer parses filenames (`lib/batchImport/`) and creates `designs` docs.
2. **Product launch** → `launchProductsFromDesign` (callable) fans out per-team-per-blank product docs and creates initial asset batches (`startInitialProductAssetBatch`, `productAssetBatchHelpers`).
3. **Render-profile resolution** → `resolveProductRenderProfile` / `resolveSavedBlankRenderProfile` (mirrored in `lib/products/` and `functions/lib/`) compute placement + masking + render targets per (blank, side, variant).
4. **Flat / scene composition** → `productFlatRenderMvp`, `productSceneRenderMvp`, `compositor8394`, `officialProductFlatCompose`, `officialProductModelCompose`, scene workers (`sceneRender*Job`).
5. **Jobs** are tracked in Firestore `rp_generation_jobs` (the "official" primary path per recent commits) — triggers `onRpGenerationJobCreated` / `onRpGenerationJobStatusChanged` drive state transitions. fal.ai is invoked from `runGeneration`.
6. **Shopify sync** → `shopifySync.js` calls `productSet` (title, handle, media, variants, metafields, tags) using tags from `buildShopifyTags`. Smart Collections are currently **manual** (no GraphQL automation).

The render-profile + 8394 mask integration is in active flux — see `RALLY_BLANK_MASK_RENDER_PROFILE_INTEGRATION.md` and recent commits (`e2156df`, `084f057`, `bf01c21`) before changing those files.

### Auth & access control

- Firebase Auth (Google provider). Client SDK config in `lib/firebase/config.ts`; auth helpers in `lib/firebase/auth.ts`; React context via `lib/providers/AuthProvider.tsx`.
- All Firestore access is gated by the `admins/{uid}` doc. Roles: `admin`, `editor`, `viewer`, `ops`. Rules in `firestore.rules` use `isAdmin()` + `hasRole(...)`. There is **no public read** — even taxonomy requires `isAuthenticated()`.
- Routes are wrapped in `components/ProtectedRoute.tsx`.

## Canonical conventions

Authoritative source: `RALLY_CONVENTIONS_REFERENCE.md`. Quick rules:

- **Design filename**: `LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT.ext`, all UPPER_SNAKE_CASE; `SIDE` ∈ {FRONT, BACK}. Parser: `lib/batchImport/parseDesignFilename.ts`. The same string (no ext) is the grouping key.
- **productIdentityKey**: `leagueCode_designFamily_teamCode_blankId_variant` (no side). Used for batch dedupe; one product per identity key. Builder: `lib/batchImport/productGeneration.ts`.
- **Taxonomy codes**: UPPER_SNAKE_CASE, hierarchical (team ⇒ league ⇒ sport). `sportCode` may be null only for thematic/lifestyle products.
- **Shopify tags**: deterministic, lowercase, `<prefix>:<value>` with prefixes `sport: league: team: theme: model:`. Order: sport → league → team → theme → model. Built by `lib/shopify/buildShopifyTags.ts` (and mirrored `functions/buildShopifyTags.js`). **Never** add blankId or designFamily as Shopify tags.

When changing tag/identity/filename logic, update **both** the web and functions copies — many helpers exist in mirror pairs (`lib/products/*.ts` ↔ `functions/lib/*.js`) because the same logic runs on the client and in callables/triggers.

## Doc-driven project

The repo root contains **dozens of spec/plan/audit markdown docs** (`RALLY_*.md`, `RP_*.md`, `PHASE_*.md`, `shopify_readiness_*.md`, etc.). Treat them as the design source of truth — when a request touches a system, search for a matching spec before guessing. Useful starting points:

- `RALLY_ARCHITECTURE_AND_STATUS_INDEX.md` — what's built / partial / paused / next
- `RALLY_CORE_OBJECT_MODEL_AUDIT.md` — schema gaps and refactor recommendations
- `RALLY_CONVENTIONS_REFERENCE.md` — filenames, identity keys, taxonomy codes, tag schema
- `RALLY_BLANK_MASK_RENDER_PROFILE_INTEGRATION.md` — current render-profile work
- `RALLY_FIRESTORE_AND_PRODUCT_PAGE_MAPPING.md` — schema ↔ UI mapping
- `Cursor_Instructions_Fal_Inference_Contract.md` + `FAL_INFERENCE_CONTRACT_VALIDATED.md` — the validated fal.ai request/response contract

Many older docs were written for Cursor; the conventions in them still apply unless superseded by a newer dated doc.

## Things to be careful about

- **`teams` is deprecated as of Phase F (2026-06-01)** — it has been merged into `design_teams`. The `/teams` UI now redirects to `/design-teams`; `useTeams` is marked @deprecated. Migration script: `functions/scripts/migrate-teams-into-design-teams.js`. If you find a new caller of the `teams` collection, port it to `design_teams` instead of adding to the legacy surface.
- **Don't unify placement** between Blank and Design without checking the audit doc; both are referenced by live code paths.
- **fal.ai key** is never in source — it's read from `process.env.FAL_API_KEY` or `functions.config().fal.key`. Same pattern for Shopify creds.
- **Firestore `undefined`** is rejected — `functions/index.js` has a `sanitizeForFirestore` helper that strips undefined recursively. Use it when writing arbitrary objects.
- Recent renderer/launch work treats `rp_generation_jobs` as the **primary** path and `8394`-specific paths as **secondary** — keep that ordering when adding new job dispatch.
