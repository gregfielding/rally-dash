# Rally — Launch Master Plan

**Created:** 2026-07-05 · **Owner tags:** [C] = Claude builds/drafts · [G] = Greg decides/does · [C→G] = Claude builds, Greg approves
**Mission:** Drop 1 fully launched — designs generated, products rendered, Shopify storefront live, marketing engine running — then Part 2: virtual model (Amber) decision + build.
**Companion docs:** `RALLY_DROP1_CAPSULE_MANIFEST.md` (copy + blank matrix), `RALLY_RENDER_CORE_UNIFICATION.md` (engine), `RALLY_CONVENTIONS_REFERENCE.md` (filenames/tags).

---

## Phase 1 — Design files (the unlock) 🔥 IN PROGRESS

The typographic pivot makes every design programmatically generatable. No Illustrator in the loop.

- [x] [C] Build `functions/scripts/generate-design-files.js` — SVG→sharp generator (proof mode done; house rules: left-justified stacked copy, curly apostrophes, Genty wordmark)
- [x] [C] Proof renders → [G] APPROVED 2026-07-05 (left-justified confirmed vs Mahogany Mommies reference). Rally wordmark in all 12 colorways goes on every garment type.
- [x] [C] Production manifest → `functions/scripts/drop1Manifest.js` (33 copy designs + 12 colorways; tokens collision-checked at the 8-char SKU segment; every filename validated through the real `parseDesignFilename`)
- [x] [C] Generate full Drop 1 file set → `design_exports/drop1/upload/` — **102 files** (33 copy designs × light/dark + 12 Rally colorways × light/dark/white, drifted hexes recovered from colorway session) + previews + `UPLOAD_CHECKLIST.md`
- [x] [G] Visual pass — PASSED 2026-07-05 (after tone-semantics fix: _light/_dark = the GARMENT the file is used on; Greg caught the inversion). NOTE: orange colorway already in library — skip or replace deliberately
- [x] [C] City line generated (city_brand created): 12 cities × name (crew) + initials (thong) × 3 tones = 72 files. **Full set: 69 designs, 174 files.** [G] veto pass on city list/inks pending
- [x] PHASE 1 COMPLETE — files locked in design_exports/drop1/upload/ + UPLOAD_CHECKLIST.md

## Phase 2 — Blank readiness

- [ ] [G] 1822GD: shoot or source flat + model photos for 6 colors (check if LAA wholesale terms permit using their product photography — if yes this shortcut applies to all future blanks)
- [ ] [G] 1822GD: masks + per-color render targets in Blank editor (crop = smaller scale/higher Y than TR3008)
- [ ] [G] Order LAA samples: 1822GD (6 colors), 83001 hot shorts (B/W/Grey)
- [ ] [G] 83001 go/no-go after seam test print (word-gap artwork rule in manifest doc)
- [x] [C] Created `design_teams/city_brand` 2026-07-05 (teamCode CITY; matrix: HF07 crew + 8390 thong, 6 variants each) — [G] authorized
- [ ] [C→G] Add 1822GD (+ 83001 if go) to rally_brand / city_brand productCatalogMatrix
- [ ] [C] Verify all 4-5 blanks resolve correct print sides + render profiles (script sweep)

## Phase 3 — Upload → launch → verify

- [ ] [G] Bulk-upload Drop 1 in waves (tanks+crew first; intimates second; DON'T target 1822GD until Phase 2 done)
- [ ] [C] Post-launch verification sweep per wave: products spawned per identity key, renders written, tags correct (theme/color/garment), zero stuck jobs
- [ ] [C] Fix any launch failures same-day (pattern: timeout/config issues)

## Phase 4 — Claude in the product (API integration)

- [ ] [G] Add `ANTHROPIC_API_KEY` to functions env (same pattern as FAL_API_KEY — never in source)
- [ ] [C] `functions/lib/claudeClient.js` — thin wrapper; `claude-fable-5` for copy, `claude-haiku-4-5` for high-volume QA
- [ ] [C] **Render QA gate**: vision pass on each flatRender before Shopify push (checks: text legible/uncut, correct ink color, placement sane) → writes `qaStatus` + reason to variant; Products UI surfaces failures
- [ ] [C] **PDP copy generator**: callable — product title/description/SEO from taxonomy + design copy, brand-voice prompt (her-voice, anti-Etsy, no team trademarks) → metafields
- [ ] [C] Collection copy generator (same voice) for smart collections
- [ ] [C] **Engine upgrade — displacement-map realism** (replaces Flux Fill for most renders): one-time displacement + shading map per garment photo, then pure Sharp compositing. Zero marginal AI cost, instant, consistent. Prototype on 8394 + TR3008, A/B vs Flux Fill output.

## Phase 5 — Shopify redesign & reconfiguration

- [ ] [C→G] Collection architecture: by shelf (Know Ball / Lucky / After Dark / City / Trend Drop) × by sport × by color — mapped to existing tag schema (theme:/color:/sport:)
- [ ] [C] Wire smart-collection automation for new shelves (LEAF_PREFIX families already built)
- [ ] [C→G] PDP template: size guide per blank, fabric copy, brand story block, cross-sell (matching set: tank ↔ panty; SKU color-line recs)
- [ ] [C→G] Theme/nav/brand pages: bold-type anti-Etsy aesthetic, About page (founding story: female fan, actually a fan), FAQ, shipping/returns
- [ ] [G] Pricing per blank (margin sheet: [C] drafts from LAA wholesale + print cost)
- [x] [G] ~~Decision: master-brand naming~~ — DECIDED 2026-07-05: brand stays **Rally Panties** (feminine energy)
- [ ] [C→G] Draft→publish QA flow: nothing goes live without render QA pass + copy review
- [ ] [G] Publish Drop 1 (trend-shelf items first — they're perishable)

## Phase 6 — Dashboard simplification

- [x] [C] Nav visibility config 2026-07-05: `HIDDEN_NAV_HREFS` in components/Layout.tsx hides Inspirations + LoRA Ops (pages stay URL-routable; one-line revert)
- [ ] [C] Default landing = launch loop; dashboard widgets reordered around it (batches, QA failures, sync status)
- [ ] [C→G] Audit remaining pages after 2 weeks of new-direction use; delete what stayed hidden

## Phase 7 — Marketing engine

- [ ] [C] Brand voice guide (one page: her-voice rules, viral test, banned words/marks)
- [ ] [C] 30-day content calendar: TikTok/IG scripts riding the trend shelf (pointing meme, World Cup window, know-ball trend) + evergreen capsule content
- [ ] [C] Launch email flow (3-part) + welcome flow for list
- [ ] [C] Post-purchase survey (KPI: % female buyers — the acquisition-story metric) + repeat-rate tracking plan
- [ ] [C] UGC engine plan: ASK ME ABOUT MY RALLY PANTIES as the conversation-starter product; screenshot-bait design rationale per product
- [ ] [C→G] Seeding list criteria: women's-sports podcasts/creators (The GIST/Togethxr audience adjacents), tailgate creators, sports-betting women creators
- [ ] [G] Social handles + posting cadence commitment

## Phase 8 — Ops & legal

- [ ] [G] **Fulfillment printer** — the biggest non-software gap: who prints when an order lands? [C] drafts printer requirements sheet (DTG/DTF, stretch ink, seam policy, LAA blank supply, per-unit costs, SLA)
- [ ] [G] Test prints: 1 per blank type incl. 83001 seam test + wash test
- [ ] [G] Trademark filings: RALLY (apparel classes), WOMANSPLAIN (ownable), consult IP attorney with Smack-Apparel exposure summary ([C] drafts the brief)
- [ ] [C] Margin sheet: per-SKU cost stack (blank + print + ship + fees) vs price points

## Phase 9 — PART 2: Amber (virtual model) — revisit → decide → build

Existing infra: `rp_identities` (LoRA + reference-image modes), Flux 2 multi-ref VTON provider, identity routing, reference-image UI (I1–I7 all built, unused).

- [x] [C] Audit complete 2026-07-05. Findings: legacy SYNTHETIC Amber LoRA exists (rp_identities/XRDYafQYgmMmZHbFAabd, trigger rp_amber, 3 artifacts Dec'25–Jan'26, flux-lora, scale 0.65) — predates the Phase I recalibration. The Phase I reference-image infra (Flux 2 multi-ref, A/B harness, references UI, 231 tests) is fully built and 100% unused: no `amber` doc in modern schema, 0 reference images, 0 of 156 teams wired to any identity. The handbook's step 1 (hire real model, 4-hr shoot, $400-800) never happened — that's the true blocker and it's a [G]-world action. 10 persona briefs exist in /identities/ (Amber + 9 more Rally Girls — over-scoped; one face is right per handbook).
- [x] [C] Benchmark complete 2026-07-05 — $0 spent (evaluated the existing Phase B A/B renders: flux_fill vs kolors_vto on TR3008 Black + Athletic Blue, City 69 design). Findings: (1) realism is production-viable TODAY on real model photos — flux_fill keeps truer screen-print ink + garment fidelity; kolors_vto is crisper but regenerates the garment and CLIPPED the text ("AN FRANCISCO") on the side-angle pose; (2) identity consistency is a NON-ISSUE on this path — it edits a real photograph, the face is real and free; (3) both failure modes seen (text clipping at torso edge, low-contrast tone picks) are exactly what the Phase 4 render-QA vision gate catches. ALSO: the legacy LoRA artifacts are MOCKS (weightsUrl → example.com) — no trained Amber ever existed; nothing lost.
- [x] [C] Economics reframe: Amber's actual value = RIGHTS-CLEAN model imagery in poses/scenes we don't have photos for. The current renders paint designs onto LA APPAREL's photography — so the Phase 2 LAA-photo-licensing check gates this whole track. If LAA photos are usable → Amber is post-launch marketing nice-to-have. If NOT → one hired-model shoot solves BOTH problems at once (product photography rights + Amber reference set) for the same $400-800.
- [ ] [G] **GO/NO-GO gate — reframed:** decision is now "book the combined shoot (product photos + Amber references, one model, one day)" — timing yours; nothing further is buildable code-side until photos exist. Everything downstream ([C] items below) activates the day reference photos land.
- [ ] If GO: [C] complete Amber autonomously —
  - [ ] Reference set completion (poses per blank type: front/back, flat + lifestyle)
  - [ ] Per-blank pose library wired to render pipeline (modelPrintQuad per pose)
  - [ ] Virtual photoshoot pipeline: scene templates × Amber × hero products
  - [ ] Brand consistency guide (Amber's look locked: face, build, styling rules)
  - [ ] Rollout: hero products first, QA gate applies, then fleet-wide
  - [ ] Amber as marketing asset: social content presence decision → [G]

---

## Sequencing (critical path)

```
Phase 1 (files) ──→ Phase 3 (launch) ──→ Phase 5 (Shopify live) ──→ Phase 7 (marketing)
Phase 2 (blanks) ──↗                      Phase 4 (Claude QA) ──↗
Phase 6 (dashboard) — anytime            Phase 8 ops — parallel, printer BEFORE publish
Phase 9 (Amber) — after Drop 1 is live
```

Trend-shelf designs (pointing meme, World Cup) are perishable — they jump the queue at every phase.
