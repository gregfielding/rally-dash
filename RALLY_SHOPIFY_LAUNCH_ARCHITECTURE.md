# Rally — Shopify Launch Architecture (Drop 1)

**Created:** 2026-07-05 · Phase 5 of `RALLY_LAUNCH_MASTER_PLAN.md` · Status: [C] drafted → awaiting [G] approval
**Grounding:** smart-collection automation (`functions/lib/shopifySmartCollections.js`) auto-creates tag-rule collections for the sport/league/team/theme/color families; a `product_type:` rule pattern exists; `garment:` tags exist but are deliberately NOT a collection family. All products push as DRAFT.

---

## 1. Shelf → theme code mapping (drives everything)

Every Drop 1 design now carries a shelf theme in `drop1Manifest.js`, surfaced in the upload checklist — the operator sets it in the review screen and the `theme:` tag flows to Shopify automatically:

| Theme code | Storefront name | What's in it |
|---|---|---|
| `KNOW_BALL` | Know Ball | Know More ×5, Fluent ×4, Hot Girls, My Number |
| `TALK` | Say It To His Face *(wc)* | Womansplain ×2, Another Beer, Drinks On You, Kiss Cam |
| `GAMEDAY` | Gameday | Parlay ×2, Tailgating list, Bad Decisions ×3 |
| `LUCKY` | The Lucky Collection | Not Luck, Comes Off, Rub For Luck |
| `AFTER_DARK` | After Dark | Baddie ×2, Fantasy, Floor Seats, Will Drop ×2 |
| `PILLOWS` | Pillows *(theme exists in taxonomy already)* | Pillows brand line (+ future team singulars) |
| `RALLY` | The Rally Line | 12 wordmark colorways + Ask Me |
| `CITY` | City | 12 city crews + 12 initial thongs |

Smart collections auto-create as `theme-know-ball` / "Theme: Know Ball" etc. **Storefront titles are editable in Shopify admin without breaking the tag rules** — retitle to the storefront names above after first sync ("Theme:" prefix is internal housekeeping, not customer language).

## 2. Collection tree + nav

**Auto (tag rules, zero maintenance):**
- 8 shelf collections (`theme:` equality, table above)
- 12 color-line collections (`color:` — already automated; nav under "Shop by Color")
- Garment-type collections via `product_type:` rule: Tanks / Crewnecks / Panties / Thongs (+ Crop Tanks, Shorts when live)

**Manual (2 only):**
- **New Drop** — manual collection, curated per drop; the homepage hero target
- **Best Sellers** — Shopify's built-in sort or manual after 30 days of data

**Main nav (7 items max):**
`New Drop · Know Ball · Gameday · After Dark · The Lucky Collection · City · Shop All`
Footer/secondary: Shop by Color, Tanks/Crews/Intimates, About, FAQ.
(TALK and PILLOWS live inside Shop All + cross-links until they have enough SKUs to earn nav slots.)

## 3. PDP template

**Title formula (existing commit-time builder):** `{Label} {Garment}` — e.g. "Hot Girls Know Ball Racerback Tank." Keep — but audit post-spawn that Labels read as titles (checklist Label column is written for this).

**Description = 4 stacked blocks:**
1. **The line itself** as the opening sentence, verbatim with the period. (It's the whole pitch. Don't explain it.)
2. **Shelf blurb** (one per theme, reused): e.g. KNOW_BALL → "For women who watch the game, not the boyfriend watching the game." · LUCKY → "Rally caps are his superstition. This is yours." · AFTER_DARK → "For the fan he's lucky to know." · CITY → "No logos. We know who we are." · RALLY → "The wordmark, in your colors." · GAMEDAY → "Parking-lot to final whistle." · TALK → "Shirts that end arguments."
3. **Fabric/fit block** — from the blank's `descriptionTemplate` (already per-blank; strip `{teamSaying}/{teamName}` placeholders for team-agnostic lines → template needs a brand-line variant: *action item below*)
4. **Brand block** (global, one sentence + care): "Rally Panties — made for the fan, not the fan's girlfriend. Machine washable. Made in USA blanks."

**Size guide:** per-blank metafield (LAA size charts; 1822GD runs boxy/cropped — note "size up for length").

**Cross-sells (3 slots, rule-driven):**
1. Same design, other garment (match designFamily) — tank ↔ crew ↔ panty
2. Matching-set: apparel PDP → intimates from same shelf; intimates PDP → the tank
3. Same color line (`color:` tag match) — Rally colorway products recommend same-ink city/copy products

## 4. Pricing bands (placeholder until printer costs land — Phase 8 margin sheet finalizes)

| Garment | Band | Anchor logic |
|---|---|---|
| TR3008 tank | $28–32 | graphic-tank market $26–36; we're premium-attitude, not premium-fabric |
| 1822GD crop tank | $30–34 | GD fabric story supports +$2 |
| HF07 crewneck | $52–58 | heavyweight GD fleece; comps $48–68 |
| 8394 panty | $18–22 | novelty intimates ceiling ~$24 |
| 8390 thong | $16–20 | |
| 83001 hot shorts | $26–30 | printed booty short comps $24–34 |
| Sets (tank + panty) | bundle −10% | AOV play; Shopify native bundles |

Free shipping threshold at ~1.8× AOV once AOV is known (goal: push 2-item carts → the cross-sell slots do the work).

## 5. Draft → publish QA gate

1. Products sync as **DRAFT** (existing default — keep)
2. Gate A (automated, Phase 4): render-QA vision pass writes `qaStatus` per image — no publish with failures
3. Gate B (human, fast): Greg approves title/price/collection membership from the Products screen (bulk publish button exists)
4. Trend-shelf items jump the queue; After Dark items get a second eyeball on imagery tastefulness (platform ad policies)

## 6. Action items out of this doc

- [ ] [G] Approve: theme mapping (§1), nav (§2), shelf blurbs (§3.2), price bands (§4)
- [ ] [C] Brand-line `descriptionTemplate` variant per blank (no `{teamName}` placeholders) — data patch to 5 rp_blanks docs (needs [G] authorization, values above)
- [ ] [C] After first sync: run smart-collection sync for the new theme values; verify 8 shelf collections + retitle pass
- [ ] [C] PDP copy generator (Phase 4) emits blocks 1–2 automatically once `ANTHROPIC_API_KEY` lands; blocks 3–4 are static per blank/brand
- [ ] [G] Shopify theme choice: current theme vs a bold-type refresh (Dawn + heavy Helvetica headings gets 90% of the anti-Etsy look for $0)
