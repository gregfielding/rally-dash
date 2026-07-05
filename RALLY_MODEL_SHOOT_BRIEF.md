# Rally — Model Shoot Brief (one shoot, three deliverables)

**Created:** 2026-07-05 · **Shoot window:** ~3 weeks out · **Duration:** 4 hours · **Budget frame:** $400–800 day rate
**Why this doc:** the shoot feeds three pipelines at once. Miss a shot list and we pay for a second shoot; miss the contract clause and Amber is dead on arrival.

---

## 0. Before booking — the two blockers

### A. Order blanks NOW (lead time!)
The render pipeline composites designs onto photos of **blank (unprinted) garments**. The model must wear actual LAA blanks in each launch color. Order this week so they arrive, get steamed, and fit-checked before the shoot:

| Blank | Colors needed | Qty | Why |
|---|---|---|---|
| 1822GD Crop Tank | Black, White, Creme, Reflex Blue, Sage, Light Pink | 1 each, model's size | Phase 2 blocker — zero model photos exist |
| 83001 Hot Shorts | Black, Heather Grey, White | 1 each | New cheeky blank — back-print photos |
| TR3008 / HF07 / 8394 / 8390 | any missing-photo colors (check Blanks editor slots) | as needed | Gap-fill only |
| + one plain white tee & grey sweatpants | — | 1 | Amber reference wardrobe (see §2) |

### B. The release contract (non-negotiable clauses)
Standard commercial releases do NOT cover virtual-model use. The contract must explicitly grant:
1. **Commercial use** of all photographs (product listings, ads, social)
2. **AI training and derivative works** — the photos may be used as reference inputs and/or training data for AI-generated imagery depicting the model's likeness ("virtual model" use). *Ask for this explicitly; it is never default.*
3. **Perpetual, irrevocable term** — Amber lives in the catalog indefinitely
4. Optional but smart: a **re-shoot option** clause (same model, same rates, 6–12 months out) for reference refreshes

If the model declines clause 2: proceed with the shoot anyway (deliverables 1 + 3 still land) and Amber's reference set waits for a different model.

---

## 1. Deliverable 1 — Blank model photos (render pipeline)

These become `variant.images.modelFront` / `modelBack` in the Blanks editor. The pipeline masks + chest-quads these photos, so **consistency beats artistry**.

**Rules:**
- Plain light-grey or white seamless background, even diffused light, no shadows across the garment
- **Same pose, same framing, same distance for every color of the same blank** — quads and masks transfer across colors only if the body doesn't move
- Garment steamed/smoothed — wrinkles on the print zone become AI artifacts
- No props, no jewelry near print zones, hair OFF the chest for front-print garments (ponytail or behind shoulders)

**Shot list per blank:**
| Blank | Pose | Frames |
|---|---|---|
| 1822GD (×6 colors) | Front: straight-on, arms relaxed at sides, chest print zone unobstructed | 2–3 per color, pick 1 |
| 83001 (×3 colors) | Back: standing, weight even, butt print zone unobstructed (straight-on from behind) | 2–3 per color |
| Gap-fill blanks | Match the EXISTING pose for that blank (pull up current modelFront on a phone and copy it) | as needed |

~30–40 minutes total if the changing area is next to the set. **Do this block FIRST** while energy and light are best.

## 2. Deliverable 2 — Amber reference set (only if clause 2 signed)

Per `RALLY_AMBER_HANDBOOK.md`. Wardrobe: the plain white tee + grey sweatpants. Hair natural, makeup minimal.

Mandatory (8): `face_front` ×3–4 · `face_3q` (both sides, keep the better) · `face_profile` · `body_full` (critical) · `body_3q` · `body_side` · `detail_hands` · `detail_hair`
Bonus (2): genuine smile · relaxed laugh
Rules: no dramatic poses, no heavy styling, no rim light/gels, no distinctive props. 10–15 final selects max.

~45 minutes. **Do this block SECOND.**

## 3. Deliverable 3 — Launch marketing content

Wearing **printed Drop 1 samples** (order test prints from the printer in time — HOT GIRLS KNOW BALL. tank, ASK ME ABOUT MY RALLY PANTIES. tee/tank, IT'S NOT LUCK. IT'S MY PANTIES. + one PILLOWS. panty if tasteful-shootable):
- Gameday energy: laughing, mid-cheer, beer in hand (product visible + legible)
- The "caught the joke" shot: someone reading her shirt / her pointing at it
- Clean lookbook frames: front, 3/4, detail crop of the print
- Vertical framing for TikTok/Reels; leave headroom for text overlay

Remaining time (~90+ min). Fun block, but it's the FIRST thing cut if running late — deliverables 1 and 2 are the ones a second shoot can't cheaply replace… actually it's the reverse: 1 and 2 are cheap to re-stage; brand content is not. Judgment call on the day: if the model is great on camera, steal time for this block.

## 4. Run of show (4 hours)

| Time | Block |
|---|---|
| 0:00–0:20 | Setup, steaming, framing test frames |
| 0:20–1:00 | **Deliverable 1** — blank photos (1822GD ×6, 83001 ×3, gap-fill) |
| 1:00–1:45 | **Deliverable 2** — Amber references |
| 1:45–2:00 | Break / wardrobe to printed samples |
| 2:00–3:40 | **Deliverable 3** — marketing content |
| 3:40–4:00 | Buffer / re-takes flagged during review |

**On-set QA:** after each block, flip through frames at 100% zoom on a laptop — check print zones for wrinkles/occlusion (block 1), check the 8 roles are all covered (block 2). Re-take on the spot; a $0 re-take on set is a $500 re-shoot later.

## 5. After the shoot (Claude takes over)

1. [G] drop selects into a folder → [C] processes: blank photos into variant image slots, masks + chest quads per new photo, render-target tuning
2. [C] creates `rp_identities/amber` (modern schema, mode `reference_images`, provider `flux_2_multireference`), uploads references with role tags
3. [C] runs the real identity A/B (Flux 2 multi-ref vs Flux Fill vs Kolors) on 3 products → scale test per handbook → evidence pack for fan-out decision
4. [C] marketing content → cropped/captioned per the Phase 7 content calendar
