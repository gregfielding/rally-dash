# Rally — Fulfillment Printer Requirements Sheet

**Created:** 2026-07-05 · Phase 8 of `RALLY_LAUNCH_MASTER_PLAN.md` · the critical-path [G] decision this doc de-risks
**Use:** send/read this against any candidate printer. Every "must" below traces to a real constraint in the catalog.

---

## 1. The order profile they're quoting

- **Model:** print-on-demand, one-off prints per order (no inventory runs at launch) — orders trickle, then spike on drops/game days
- **Blanks:** we specify exact LA Apparel styles — printer must accept **customer-supplied blanks** OR stock/order LAA (8394, 8390, TR3008, 1822GD, HF07, later 83001). Ask: do they have an LAA wholesale account?
- **Art:** 300-DPI transparent PNGs, one ink color per design (typographic). Files delivered per-order via API/email/portal — ask what their intake supports (Shopify app? OrderDesk? manual?)
- **Volume honesty:** launch = low double digits/week; design for 100+/week without re-negotiation

## 2. Print method requirements

| Garment | Fabric | Must handle |
|---|---|---|
| TR3008 tank | 50/25/25 tri-blend (poly!) | **Low-bleed/low-cure ink or DTF** — poly dye migration at high cure temps |
| 1822GD crop tank, HF07 crew | 100% cotton GD | Standard DTG/screen/DTF all fine |
| 8394 / 8390 intimates | cotton/spandex, HIGH stretch | **High-elongation ink** (stretch additive) — standard plastisol cracks |
| 83001 hot shorts | cotton/spandex + **center-back seam** | Seam policy: our artwork keeps letters off the seam (gap baked in), but confirm they'll print the placement at all |

**Ask each candidate:** DTG vs DTF vs screen for one-offs? (Expected answer for us: **DTF or DTG** — screen setup costs kill one-off economics.) White-ink underbase quality on Black/Navy garments? Cure temps on tri-blend?

## 3. Quality gates (send with the test order)

Test order = 6 pieces: HOT GIRLS KNOW BALL. on Black TR3008 (white ink) + Creme 1822GD (black ink) · COMES OFF WHEN WE WIN. on Black 8394 · (RUB FOR LUCK) on 8390 · TAILGATING list on Black tank (fine-line stress test) · 83001 seam-gap test print.
- Text edges crisp at arm's length; no halo/underbase peek on dark garments
- **Wash test ×5** (our own washer): no cracking on the stretch garments, no fade
- Placement accuracy ±0.25" vs our placement spec
- The period. If the period is missing or clipped on any piece, that's disqualifying — it's the brand.

## 4. Commercial terms to compare

| Term | Target |
|---|---|
| Per-print cost (1-color chest, DTF/DTG) | $4–8; intimates small print $3–6 |
| Blank handling fee (if we drop-ship LAA to them) | ≤$1/unit |
| Turnaround SLA | ≤3 business days blank-to-shipped; ask peak-season policy |
| Shipping | they ship direct-to-customer, our packing slip/branding? Cost? |
| Misprint policy | free reprint, who eats the blank? |
| Minimums | none (or ≤6/order) |
| Integration | Shopify app / API / CSV — anything that doesn't require manual re-entry per order |

## 5. Candidate types (where to look)

1. **Local SF Bay Area DTF/DTG shop** — fastest iteration, hand-carry test prints, relationship pricing; usually weakest on Shopify automation (acceptable at launch volume)
2. **POD API providers that accept custom blanks** — check whether any support LAA styles natively (most catalog Printful/Printify-style blanks won't include LAA intimates — this is exactly why the custom pipeline exists)
3. **LAA's own printing services** — LA Apparel offers in-house printing for wholesale accounts; one vendor for blank + print kills the logistics hop. **Check this first.**

## 6. Decision checklist

- [ ] LAA blank supply confirmed (their account or ours)
- [ ] Stretch-ink intimates test passed (wash ×5)
- [ ] Tri-blend cure test passed (no dye migration on TR3008)
- [ ] 83001 seam placement accepted + test passed
- [ ] Per-unit costs into the margin sheet → finalize §4 pricing bands in `RALLY_SHOPIFY_LAUNCH_ARCHITECTURE.md`
- [ ] Order intake path defined (even if manual at launch)
- [ ] Test prints double as shoot wardrobe (deliverable 3 in `RALLY_MODEL_SHOOT_BRIEF.md`) — schedule accordingly
