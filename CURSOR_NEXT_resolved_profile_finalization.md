# Cursor — finalize resolved blank profile as source of truth

## Context

The new architecture is correct:

1. `resolveSavedBlankRenderProfile(blankId, variantId)` → canonical recipe from `rp_blanks/{blankId}`
2. `renderFromResolvedProfile(resolvedProfile, design, target)` → deterministic compose for flat roles
3. `persistOfficialProductAssets(productId, results)` → write back to product

That mental model matches the rule: **the blank editor defines the recipe; product generation materializes it.**

The latest 8394 no-identity run produced:

- `flat_front_clean: done` ✅
- `flat_back_designed: queued/running`
- `model_back_designed: skipped_no_identity` ✅
- `model_front_clean: skipped_no_identity` ✅
- `assetsStatus: running`, `assetsProgress: { completed: 3, total: 4 }`

The blank correctly shows `blankMode: "back_only"`, `effectiveFront: false`, `effectiveBack: true`, `primaryPlacementSide: "back"`.

But three things still need to land before this is truly "blank is source of truth, everything else is materialization."

---

## 1. Decide and enforce: front-side policy when `effectiveFront: false`

**Decision needed.** When a blank has `effectiveFront: false`, what does the product pipeline do with `flat_front_clean`?

Three options:

| Option | Behavior | Implication |
|---|---|---|
| **Required** | Always render flat_front_clean (clean garment) regardless of effectiveFront | "Front always exists as a flat photo, design just doesn't go on it." |
| **Optional** | Render if a saved front garment URL exists; don't block launch if missing | Soft — product can ship without a front image |
| **Suppressed** | Don't enqueue front roles at all when `effectiveFront: false` | Hard — blank fully owns side rules |

**My recommendation: Suppressed.**

Rationale: the whole point of the recent refactor is that the blank is the source of truth. If the blank says "this product has no front output," product generation must honor that. Otherwise we're back to product generation second-guessing the blank.

**Implementation:**

In `functions/lib/officialProductImageJobs.js` (and the helper that builds the initial role map in `startInitialProductAssetBatch.js`):

```js
// pseudocode
const sides = resolvedProfile.printSides; // { front: bool, back: bool }
const frontEnabled = sides.front === true;
const backEnabled  = sides.back  === true;

const rolesPlanned = [];
if (frontEnabled) rolesPlanned.push("flat_front_clean");
if (backEnabled)  rolesPlanned.push("flat_back_designed");
if (canEnqueueModelRoles) {
  if (frontEnabled) rolesPlanned.push("model_front_clean");
  if (backEnabled)  rolesPlanned.push("model_back_designed");
}
```

Then in the initial role map, skipped roles get a clear status — not `queued`, not `skipped_no_identity` (that's reserved for the LoRA case). Use a new sentinel:

```js
suppressed_by_blank // role intentionally excluded because blank says this side is off
```

Update `OFFICIAL_REQUIRED_LAUNCH_ROLES` resolution to dynamically read from the resolved profile rather than hardcoding `["flat_front_clean", "flat_back_designed"]`. The required set is whatever the blank says is enabled, period.

`deriveBatchStatus` should treat `suppressed_by_blank` the same way it treats `skipped_no_identity` — counts toward completion, not toward failure.

`buildFulfillmentPackage` should already match because it goes through the same `resolvePrintSidesForProductBuild`. Verify it does.

**Acceptance:**

For a back-only blank with no identity, a fresh product run should produce:

```
flat_front_clean    = suppressed_by_blank
flat_back_designed  = done
model_front_clean   = suppressed_by_blank   (or skipped_no_identity, your call which wins — see below)
model_back_designed = skipped_no_identity
assetsStatus        = complete
launchStatus        = needs_review or shopify_ready
fulfillmentReady    = true
shopifyReady        = true
```

**Sub-decision:** if a role is BOTH suppressed by blank AND would have been skipped for no identity, which sentinel wins? My vote: `suppressed_by_blank` wins, because that's the more specific "this should never have been planned" signal. Identity skip is "we would have done it but no LoRA." Blank suppression is "this never existed for this product."

---

## 2. Show the resolved profile in the product UI (dev panel)

Right now the product page has the ops summary card and the 8394 last-run QA panel, but the resolved profile object itself is invisible. When debugging "did this product see the blank's intent correctly?" you need to see what `resolveSavedBlankRenderProfile` actually returned for that variant.

**Add to `app/products/[slug]/page.tsx`:**

A new collapsed dev card titled "Resolved blank profile (per variant)" that, when expanded, shows for each variant:

```
Variant: blue (8394-blue)
  blankMode: back_only
  effectiveFront: false
  effectiveBack: true
  primaryPlacementSide: back
  garmentImageUrl: https://...
  tuning: { ... summary ... }
  engineBlend: { ... summary ... }
  placement: { ... summary ... }
  printSides: { front: false, back: true }
  rolesPlanned: [flat_back_designed, model_back_designed]
  rolesSuppressed: [flat_front_clean, model_front_clean]
  source: "rp_blanks/8394-blue (renderTargetsByColor cell)"
```

Read it from a server action that calls `resolveSavedBlankRenderProfile` per variant. Don't re-derive in the client.

This single panel makes 90% of "the render didn't match the blank" debugging trivial.

---

## 3. All readiness logic must consume the same resolved profile

Audit and fix any place that still computes side rules independently. Targets:

- `buildFulfillmentPackage.js` — should call `resolveSavedBlankRenderProfile` once and use its `printSides`. Don't read `variant.renderSetup` directly.
- `productLaunchStatus.js` — `evaluateShopifyReadiness` and any hero/catalog readiness check.
- `lib/products/resolvePrintSidesForProduct.ts` — this should now BE a thin wrapper around `resolveSavedBlankRenderProfile().printSides`, or be deleted in favor of calling the resolver directly. Pick one. Don't have two side resolvers in the codebase.

If two paths derive sides differently, we'll keep getting drift between "render thinks 1 side" and "fulfillment thinks 2 sides."

**Acceptance:** grep for any direct read of `variant.renderSetup.front` / `variant.renderSetup.back` / `variant.printSides` outside of `resolveSavedBlankRenderProfile`. There should be zero hits in product generation, fulfillment, or readiness code paths. The blank editor itself can still write those fields — the blank IS the writer. But everyone else is a reader, and they read through the resolver.

---

## Order of operations

1. Land #1 (suppression policy + dynamic required set) first. Test with the existing back-only 8394 product — should now show `suppressed_by_blank` instead of pretending front was needed.
2. Land #2 (UI dev panel) next. Use the same fresh product to verify the panel renders correctly.
3. Land #3 (readiness consolidation) last. This is the cleanup pass — once #1 is in, removing the duplicate side-derivation paths is safe.

Don't skip #2. The dev panel is what makes #3 verifiable without firing up debug logs every time.

---

## Logging additions

Add these so the next run is self-explaining without me asking for Firestore screenshots:

- `[BLANK_PROFILE_RESOLVED] productId=... variantId=... mode=back_only sides={f:false,b:true} placement=back garmentUrl=...`
- `[ROLES_PLANNED] productId=... variantId=... planned=[flat_back_designed,model_back_designed] suppressed=[flat_front_clean,model_front_clean] reason=blank_effectiveFront_false`
- `[ROLE_RESOLUTION] role=flat_front_clean status=suppressed_by_blank` (one per role at enqueue time)

Keep the existing `[FLAT_RENDER:*]` and `[OFFICIAL_ENQUEUE:*]` logs — those are good.

---

## Out of scope (do not touch this round)

- Banana Pro color replacement
- New blank styles (thong, tank, crewneck) — separate spec
- Identity / LoRA pipeline — separate spec, deferred until front roles are stable for no-identity case
- Shopify sync content (titles, tags, descriptions) — readiness-only this pass

Get sides correct end-to-end first. Then we expand.
