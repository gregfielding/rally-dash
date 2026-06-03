# Rally Panties — AI Model Handbook (Amber)

**Last updated:** 2026-06-01 (Phase I — post deep-research recalibration)
**Audience:** Greg (operator) — solo decisions about who Amber is, what she looks like, and how the catalog uses her.

This handbook tells you how to bring Amber to life now that the backend is wired. It is opinionated; the trade-offs come from a verified deep-research pass against mid-2026 SOTA (see `RALLY_DEEP_RESEARCH_AMBER_2026.md` for the full source-cited rationale). If a recommendation here disagrees with something else in the repo, this file wins.

---

## TL;DR — what changed and what you do

The system was originally architected to **train Amber as a Flux LoRA** (collect 25 photos, run a 30-minute training job, use trigger phrase `rp_amber` in inference). The research said this is **no longer the right default in mid-2026**. Reasoning:

- **Flux 2 native multi-reference** (released late-2025) accepts 4-9 reference photos at inference time and is marketed as the LoRA-replacement for character consistency. No training step, no overfitting risk, no dataset curation week.
- The closest production analog at catalog scale (**Zalando**, ~70% AI editorial Q4 2024) anchors identity to a **real human model**, not a synthetic persona. They invest in 3D digital twins, not 2D LoRAs.
- **Fashion-vertical SaaS** (FASHN AI's Face Reference, ~35s/generation from a single photo) productized this workflow specifically for apparel catalogs.

**Your action plan**, in this order:

1. **Find a real human model to be Amber.** Hire one person for one 4-hour shoot. The Amber persona in `/identities/RallyGirl_Amber_Identity_Refined.md` is the casting brief.
2. **Shoot ~10-15 reference photos** following the angles below.
3. **Upload them** at `/lora/identities/amber/references` and switch identity mode to `reference_images` with `preferredProviderId = flux_2_multireference`.
4. **A/B test on 1 real product** — compare Flux 2 multi-reference vs Flux Fill vs Kolors VTO via the existing `🆚 Compare providers` button.
5. **Fan out** across the catalog only after the A/B shows acceptable consistency.

The trained-LoRA path stays available as a fallback. If reference-image quality disappoints across 50+ generations, train a LoRA *of the real Amber*, not of a fictional one — the photos you've already collected become the training set.

---

## Part 1 — Casting & shooting Amber

### Who Amber should be (the brief)

Per `/identities/RallyGirl_Amber_Identity_Refined.md`:
- Female, **26-28**, athletic build, **Marina-based** (San Francisco neighborhood)
- 49ers / Giants fan energy, karaoke enthusiast (vibe, not a costume)
- Authentic, approachable face — **not a generic Instagram model archetype**

What you're casting for is **consistency, not perfection.** Amber needs to be recognizable across thousands of product shots. A face with one distinct feature (a particular smile, hair texture, eye shape) reads as "the same person" better than a face that's symmetrical-but-forgettable.

Where to source:
- **Local model directories** (Heyitsbianca, Casting Networks, Model Mayhem) — filter by SF Bay Area, 26-28
- **Day rate:** $400-800 for 4 hours including the rights you need (full commercial usage, AI training/derivative work)
- **Releases:** make sure the contract grants:
  - Commercial use of the photos
  - AI training / model derivative use (this clause is non-default; ask for it explicitly)
  - Perpetual usage rights — Amber is supposed to live forever in your catalog

If you can't hire: a personal friend, family member, or even yourself can serve as the seed. Just make sure you have a release on file.

### The shoot brief (4 hours, 10-15 final photos)

**Setting:** plain neutral studio backdrop OR a neutral wall outdoors with diffused light (sunny midday is bad — shoot in shade or golden hour). The goal is to have the AI generate scenes around Amber, so the reference photos should be **as scene-free as possible.**

**Wardrobe:** ONE plain garment for the body shots. Solid color, no logos, no graphics, no print. Either:
- A plain white tee + plain gray sweatpants (default — most flexible)
- A plain dark tee + plain dark leggings (alternative)

The wardrobe doesn't matter for the final output (VTON will swap the garment to your design), but plain solid colors give Flux 2 the cleanest body silhouette to work with.

**Hair + makeup:**
- Hair as it naturally falls. Don't style heavily — operators will be regenerating across thousands of poses, and a heavy style is harder for the model to maintain.
- Natural makeup (or none). Heavy makeup creates "look variants" that confuse identity preservation across shots.

**Mandatory shots (8 of these — these are the references):**

| Role | Description | Notes |
|---|---|---|
| `face_front` | Head-and-shoulders, looking straight at camera, eye-level | Neutral expression. **Take 3-4 variants.** |
| `face_3q` | Head turned ~45°, both eyes visible | Right turn AND left turn — pick the more flattering one |
| `face_profile` | Pure side view, ear visible | One side is enough |
| `body_full` | Head to feet, plain background, neutral stance | **Critical shot.** Hands at sides or one hand on hip. |
| `body_3q` | Knees up, slight hip rotation | Helps the model with body proportions |
| `body_side` | Profile body shot showing posture | Don't lean — straight spine |
| `detail_hands` | Close-up of hands | Optional but improves hand quality |
| `detail_hair` | Close-up showing hair texture | Optional, useful if hair is distinctive |

**Two extra "expression" shots (helpful but skippable):**
- One genuine smile (not a "say cheese" smile)
- One relaxed laugh

**What NOT to do during the shoot:**
- ❌ No dramatic poses ("hand on hip and look mysterious")
- ❌ No styled hair you can't reproduce
- ❌ No heavy lighting (rim light, color gels) — diffused even light only
- ❌ No props (sunglasses, hats, jewelry that's distinctive enough to anchor identity)
- ❌ No more than 15-20 final selections — Flux 2's max is 9-10 per call, so the operator buffer is small

---

## Part 2 — Uploading Amber to the system

### Step 1: Create the identity doc (one-time)

In Firestore (via the admin UI you already have, or directly):

```
rp_identities/amber:
  name: "Amber"
  token: "rp_amber"
  defaultTriggerPhrase: "rp_amber"
  status: "draft"
  mode: "reference_images"
  preferredProviderId: "flux_2_multireference"
  createdAt: <serverTimestamp>
  updatedAt: <serverTimestamp>
```

The `/lora/identities` page should let you create this if it doesn't exist yet. Doc ID = `amber` (lowercase, no spaces).

### Step 2: Upload the references

1. Visit **`http://localhost:3000/lora/identities/amber/references`**
2. Pick a role (start with `face_front`)
3. Optionally add a label ("hero smile", "outdoor shot")
4. Pick the file → uploads to Cloud Storage at `rp/identity_references/amber/face_front_<ts>.png`, then calls `addIdentityReferenceImage`
5. Repeat for each photo + role

The grid below the upload form shows all current references grouped by role. Aim for **at least 1 `face_front` + 1 `body_full`** as the minimum usable set; the Flux 2 sweet spot is **4-9 photos across varied roles**.

### Step 3: Confirm mode + provider

On the same page, the "Identity mode" section should already show:
- Mode: `reference_images` (you set this on doc creation)
- Preferred provider: `Flux 2 multi-reference (recommended)`

If it shows something else, switch + save. Server validates: can't switch to `reference_images` with zero refs, can't switch to `lora` without a trained artifact.

### Step 4: Attach Amber to a design team

Open the Firestore doc for the design team that should use Amber (or all of them):

```
design_teams/sf_giants:
  generationDefaults:
    defaultIdentityId: "amber"
```

Once this is set, every product launched under that team will route through Amber when realism runs. The existing pipeline (`resolveModelIdentity` in `functions/lib/`) reads this and threads `identityId: "amber"` into job docs.

---

## Part 3 — Testing Amber end-to-end

### Single-render test (cheap sanity check)

1. Go to **`/blanks/8394`** → pick a variant that has a `model_front` photo
2. Pick a design (any Giants pillows design works)
3. Render profile tab → click **✨ Product Preview**
4. The job runs through Flux 2 multi-reference because the variant's team has `defaultIdentityId: "amber"` and Amber is in `reference_images` mode

What to look for in the output:
- ✅ The face is recognizably Amber (not generic Instagram model)
- ✅ Hair color and length match the references
- ✅ Body proportions look right (not warped wide or stretched tall)
- ✅ Skin tone matches reference photos (no race/ethnicity drift)
- ✅ The garment + print look correct (Flux 2 should preserve the Stage A composite faithfully)
- ⚠️ Hands and feet — Flux 2 is better than Flux Fill here but still drift-prone

If 4 of 5 look right: you're production-ready.
If 2-3 of 5 look right: try the A/B comparison (next section).
If 0-1 of 5 look right: see "When to fall back to a LoRA" below.

### A/B comparison test (the real verdict)

This is the test that decides whether to fan out across the catalog.

1. From the same blank page, click **🆚 Compare providers**
2. In the modal, check:
   - `Flux 2 multi-reference` (the new path)
   - `Kolors VTO v1.5` (existing fashion-tuned)
   - `Flux Fill (mask-based)` (existing screen-print-tuned)
3. Click **Run A/B test** (~$0.18 total)
4. Wait for all 3 tiles to fill in (~30-60s)
5. Look at the 3 side by side

**Decision tree from the 3-tile comparison:**

- **If Flux 2 looks best AND identity is recognizable → ship Flux 2.** This is the recommended outcome and what the research predicted.
- **If Flux Fill looks best AND identity is "close enough" → keep Flux Fill, set Amber to mode `lora` later.** Identity preservation isn't critical for screen-print on a plain garment if the operator doesn't read faces in those shots.
- **If Kolors VTO looks best (rare) → set Amber's `preferredProviderId` to `kolors_vto`.** Kolors ignores identity refs, so Amber won't be Amber in those — only do this if the catalog doesn't need face consistency.
- **If all 3 look bad → time to train a LoRA.** See fallback section.

Run this test on **3 representative products** (different garment types, different design styles) before committing.

### Scale test (the gate before fan-out)

Before you batch-render the whole catalog:

1. Pick 10 products spanning 3 teams + 4 blanks
2. Run **🎬 Generate 4-shot PDP** on each — that's 40 scene renders total (~$1.60)
3. Eyeball all 40 outputs:
   - Is Amber recognizable in 36+ of them? (≥90%)
   - Are there any "wow that's a different person" failures? Mark them and re-render
   - Does her hair color stay consistent across 40 shots?
4. If 90% pass: you're cleared for full-catalog fan-out via `enqueueProductModelRealismBatch`.
5. If 70-89% pass: tune the prompt language in `vtonProviderFlux2MultiReference.js` (`editPrompt` default) or upload 2-3 more references for the failing angle.
6. If <70% pass: fall back to LoRA training.

---

## Part 4 — When to fall back to training a LoRA

The LoRA training pipeline is **fully built and untouched** — `flux-lora-portrait-trainer` integration, dataset builder, artifact storage. You can fall back to it any time.

**Triggers to train an Amber LoRA:**
- Scale test below 70% identity consistency
- Hair color or skin tone visibly drifts on >10% of generations
- Hands look obviously wrong in >20% of full-body shots
- You're shipping >5,000 generations and want maximum brand-face stability

**How to train (cheap, ~$5-10 + 30 min):**

1. **Reuse the same reference photos** from the references admin page. Don't re-shoot.
2. Visit `/lora/training`
3. Pick the Amber identity, create a dataset from her reference images, pick `flux-lora-portrait-trainer` preset (defaults to 2000 steps — fine for portraits; dial down to 1000-1500 if overfitting appears). The `flux-lora-fast-training` preset defaults to 1000 steps as of Phase J2 (was 1200; fal.ai's documented default is 1000)
4. Submit. Wait ~25 min for completion.
5. Once done, an `rp_lora_artifacts` doc auto-creates with the `.safetensors` weights URL.
6. Go back to `/lora/identities/amber/references` → switch mode to `hybrid` (both LoRA AND reference photos available) OR `lora` (LoRA only).
7. Re-run the scale test. Hybrid mode typically wins because the LoRA anchors face/body, while reference photos preserve specific details Flux can't compress into LoRA weights.

**Cost calc:** training is a one-time ~$5; inference per render with LoRA is roughly the same as Flux Fill ($0.05). Total LoRA cost for 1000 product renders ≈ $50-55. Total Flux 2 multi-ref cost for the same ≈ $60. The LoRA is *cheaper per shot at scale* — but ONLY makes sense if Flux 2 multi-ref doesn't deliver consistency.

---

## Part 5 — Daily operations after Amber is live

### Watching the cost meter

The dashboard widget (`/dashboard` → "fal.ai spend") aggregates Flux 2 endpoint cost automatically. When Amber's reference-image generations start flowing, you'll see a new entry: `fal-ai/flux-2-pro/edit` with cost-per-call ≈ $0.06.

**Daily spend threshold is $25 by default.** If a fan-out pushes you near it, the widget turns amber/red.

### Watching the batch widget

The "Recent batches" widget shows each fan-out's progress + status. If you kicked off a 4-shot PDP and one scene is failing repeatedly, the batch goes `partial` (yellow) — click the row to open the drawer and see which scene template + which provider errored.

### When to add more references

Add a new reference photo when:
- You notice a specific angle drifting (e.g. Amber's left profile keeps coming out wrong → add another `face_profile` from that side)
- The catalog adds a new garment category that exposes a body angle you didn't shoot (e.g. swimwear needs a `body_side` you don't have)

Don't add more than 15 references total. Beyond that, Flux 2 starts ignoring the extra inputs and you're paying for storage with no quality gain.

### Quarterly: re-shoot

Hair grows, makeup styles evolve, the model herself ages. Plan to **re-shoot every 6-12 months** with the same model to refresh the reference set. The system auto-handles the swap — old references stay until you delete them; the operator can decide whether to keep an "Amber 2026" vs "Amber 2027" archive.

---

## Part 6 — Things to NOT do

- ❌ **Don't fully replace photography overnight.** Even Zalando (the most aggressive AI-fashion brand publicly) caps at ~70% AI editorial and explicitly anchors to a real human model. Levi's framing from 2023 ("AI will likely never fully replace human models") has not been publicly reversed. Treat Amber as augmentation, not replacement.
- ❌ **Don't generate Amber in poses the model didn't shoot.** If she never crouched, Flux 2 doesn't know what crouching-Amber looks like. You'll get crouching-some-other-person. If you need a new pose, shoot it.
- ❌ **Don't ship a synthetic Amber whose model rights you don't own.** The biggest legal risk in AI fashion is "your model looks like someone real who didn't consent." Always start from a real human you've contracted with.
- ❌ **Don't ignore the A/B verdict.** If the A/B comparison says Kolors VTO looks best on your specific designs, listen to it — the research is correct that Flux 2 multi-ref is the most likely winner, but YOUR designs might be the exception.
- ❌ **Don't conflate "Amber on every team" with "Amber the brand face."** It's fine to have ONE Amber across the whole catalog. It would be a mistake to train 150 different per-team identities.

---

## Quick reference

| Action | URL / command |
|---|---|
| Upload references | `/lora/identities/amber/references` |
| Switch mode | Same page, "Identity mode" section |
| Single render test | `/blanks/8394` → variant → ✨ Product Preview |
| A/B comparison | Same page → 🆚 Compare providers |
| Watch costs | `/dashboard` → fal.ai spend |
| Watch batches | `/dashboard` → Recent batches |
| Train LoRA (fallback) | `/lora/training` |
| Attach Amber to a team | Firestore: `design_teams/<id>.generationDefaults.defaultIdentityId = "amber"` |
| Run scale test | 🎬 Generate 4-shot PDP on 10 products |
| Production deploy | `cd functions && npm run deploy` |

---

## What's deployed in this Phase I drop

Backend (live):
- `addIdentityReferenceImage`, `removeIdentityReferenceImage`, `setIdentityMode` callables
- `vtonProviderFlux2MultiReference` registered in the VTON registry
- `fal-ai/flux-2-pro/edit` priced in `FAL_ENDPOINT_PRICING` ($0.06/call, verify against first real call)
- Per-endpoint concurrency limiter caps Flux 2 at 4 parallel calls
- `rp_identities` schema extended with `mode`, `referenceImages[]`, `preferredProviderId`, `referenceImageCount`, `migratedFrom/At`
- `RPBlankPreviewJob` carries `identityId` through the trigger
- Storage rules cover `rp/identity_references/{identityId}/`
- Pipeline routing: when a job has `identityId` set + the identity has `mode=reference_images/hybrid` with refs, the trigger routes through the identity's `preferredProviderId`

UI (live):
- `/lora/identities/{id}/references` — upload, role tagging, mode picker, provider picker

Tests: 231/231 passing.

What's NOT yet wired:
- **FASHN AI** as an alternate provider (separate vendor with its own API, not on fal.ai). Worth piloting after Flux 2 multi-ref has a real-world track record.

What IS wired (as of Phase I7, post-handbook v1):
- **Auto-resolution `design_teams.generationDefaults.defaultIdentityId` → job.identityId** in both `enqueueProductModelRealism` (single) AND `enqueueProductModelRealismBatch` (fan-out). Set `defaultIdentityId: "amber"` on any team's `generationDefaults` and every realism enqueue for products under that team automatically routes through Amber's reference photos + her preferred provider. Optional `identityId` callable input still overrides for ad-hoc testing.
