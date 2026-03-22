# MLB verified brand colors (`design_teams`)

## Source of truth

| File | Role |
|------|------|
| **`functions/data/mlbVerifiedBrandColors.json`** | All 30 clubs: `teamColors` (role, name, hex, cmyk; optional `pantone` later), `primaryColorHex`, `secondaryColorHex`, `colorFamilies`, `colorVerificationStatus: "verified"`, **`printVerificationStatus: "derived"`** until CMYK is manually confirmed for print. |
| **`functions/scripts/materialize-mlb-verified-brand-colors.js`** | Human-maintained hex + names; **only** runs `hex → CMYK` on those hex values (no algorithmic color picking). |

Regenerate JSON after editing the script’s `ROWS`:

```bash
cd functions && npm run materialize:mlb-verified-colors
```

## Rules

- **1–2** brand colors per team (`teamColors` length 2 for all current rows).
- **`colorFamilies`**: Rally normalized set (`black`, `white`, `grey`, `red`, `blue`, `navy`, `green`, `orange`, `purple`, `teal`, `pink`, `yellow`) for eligibility — chosen to match the **listed** brand colors (e.g. Padres brown → `black` family for matching, gold → `yellow`).
- **`colorVerificationStatus: "verified"`** — brand hex + names are intentionally curated (not algorithmically chosen).
- **`printVerificationStatus: "derived"`** — CMYK is still computed from hex for internal consistency. Flip to **`"verified"`** on a team (in JSON + re-seed) once CMYK/Pantone are confirmed from trusted print sources.
- **CMYK**: sRGB→CMYK of the listed hex until print verification.
- **Optional `pantone`** on each `teamColors[]` entry: supported in types and `teamColorUtils`; omit in JSON until populated.
- **Canonical merge**: `canonicalDesignTeamsPhase1.js` loads verified rows by `id` and **does not** run family-based secondary guessing for MLB.

## JSON shape

Top-level document:

- `schemaVersion`, `leagueCode`, `description`, `teamCount`
- **`teams`**: array of 30 objects, each with:
  - `id`
  - `colorVerificationStatus`: `"verified"`
  - `printVerificationStatus`: `"derived"` | `"verified"`
  - `colorFamilies`: `string[]`
  - `primaryColorHex`, `secondaryColorHex`
  - `teamColors`: `{ role, name, hex, cmyk: { c, m, y, k }, pantone?: string | null }[]`

## Firestore

Seeded fields include `colorVerificationStatus` and `printVerificationStatus` for canonical rows. Non-MLB Phase 1 teams default to `printVerificationStatus: "derived"` (CMYK from hex).
