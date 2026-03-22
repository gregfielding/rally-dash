# Rally — Canonical DesignTeam dataset (Phase 1)

**Collection:** `design_teams`  
**Scope:** MLB (30), NFL (32), NBA (30), NHL (32), MLS (30) — **154 teams total**.  
**NCAA:** Not included in Phase 1.

## Files

| Path | Purpose |
|------|---------|
| `functions/data/mlbDesignTeams.js` | Base MLB rows (city, state, legacy `primaryColorHex` on doc — superseded at merge by verified file). |
| `functions/data/mlbCanonicalMeta.json` | MLB-only: `teamCode`, `slug`, `stadiumName` (no colors — see verified file). |
| `functions/data/mlbVerifiedBrandColors.json` | **Verified** MLB palette: `teamColors`, hex, CMYK, `colorFamilies`, `colorVerificationStatus`. See `RALLY_MLB_VERIFIED_COLORS.md`. |
| `functions/scripts/materialize-mlb-verified-brand-colors.js` | Regenerates `mlbVerifiedBrandColors.json` from hand-picked hex (CMYK = transform of those hexes only). |
| `functions/data/nflDesignTeams.json` | Full NFL records. |
| `functions/data/nbaDesignTeams.json` | Full NBA records. |
| `functions/data/nhlDesignTeams.json` | Full NHL records (includes **Utah Mammoth** as `utah_mammoth`; replaces suspended Arizona Coyotes franchise slot). |
| `functions/data/mlsDesignTeams.json` | Full MLS records (includes **San Diego FC**; 30 clubs). |
| `functions/data/teamColorUtils.js` | Hex normalize, approximate CMYK, `teamColors` assembly from `primaryColorHex` + `colorFamilies`. |
| `functions/data/canonicalDesignTeamsPhase1.js` | Merges leagues, validates `colorFamilies`, enriches **`teamColors`** (hex + CMYK) on every team. |
| `functions/data/designTeams.phase1.json` | **Generated** export (v2+) of all 154 teams incl. `teamColors` (run `npm run export:design-teams-json` in `functions/`). |

## Allowed `colorFamilies` (normalized)

`black`, `white`, `grey`, `red`, `blue`, `navy`, `green`, `orange`, `purple`, `teal`, `pink`, `yellow`

Aliases normalized at build time: `gray`→`grey`, `gold`→`yellow`, etc.

## Firestore fields written

Per team document (doc id = `id`, e.g. `sf_giants`):

- `name`, `league`, `leagueId`, `leagueCode`, `city`, `state`, `teamName`
- `teamCode` (uppercase, no spaces), `slug` (kebab-case)
- **`teamColors`**: array of `{ role, name, hex, cmyk: { c, m, y, k } }`  
  - At least **one** color per team; roles are typically `primary` / `secondary` / `tertiary` (not fixed count).  
  - CMYK is a **reasonable approximation** (0–100 integers), derived from hex when not supplied.  
  - Secondary/tertiary: optional explicit `secondaryColorHex` / `tertiaryColorHex` on source rows; otherwise a **secondary** is suggested from `colorFamilies` (family anchor hex different from primary’s nearest family).
- **`primaryColorHex`**, **`secondaryColorHex`** — UI convenience; mirror the primary (and secondary if any) hex from `teamColors`.
- **`colorFamilies`** (required on canonical rows) — 1–3 normalized tokens for **eligibility** only.
- `stadiumName`, `teamSaying`, `fanPhrase` (optional; seeds often `null`)
- `tags`, `createdAt`, `updatedAt`

`fullName` in the JSON export equals `name` (official full display name).

### Optional source-only fields (merged away in export)

Rows may set `secondaryColorHex`, `tertiaryColorHex`, `primaryColorName`, etc. before build; canonical output always includes computed `teamColors`.

## How to seed

**CLI (recommended for local / CI):**

```bash
cd functions
npm run export:design-teams-json   # refresh designTeams.phase1.json only
npm run seed:design-teams          # create missing docs only
npm run seed:design-teams:merge    # upsert all canonical fields on existing docs
```

**Callable (admin):** `seedDesignTeamsCanonicalPhase1`  
- Default: create if missing; skip if exists.  
- `{ merge: true }`: merge canonical fields onto every team doc.

## Team counts per league

| League | Code | Count |
|--------|------|------:|
| MLB | MLB | 30 |
| NFL | NFL | 32 |
| NBA | NBA | 30 |
| NHL | NHL | 32 |
| MLS | MLS | 30 |
| **Total** | | **154** |

## Sample records (validation)

**MLB — San Francisco Giants (`sf_giants`)**

- `teamCode`: `SFGIANTS` · `slug`: `sf-giants` · `colorFamilies`: `["orange","black"]` · `stadiumName`: `Oracle Park`  
- `teamColors`: primary `#FD5A1E` (orange) + secondary `#000000` (black), each with `cmyk` object  
- `secondaryColorHex`: `#000000`

**NFL — Kansas City Chiefs (`kansas_city_chiefs`)**

- `teamCode`: `KCCHIEFS`  
- `slug`: `kansas-city-chiefs`  
- `colorFamilies`: `["red","yellow"]`  

**NBA — Los Angeles Lakers (`la_lakers`)**

- `teamCode`: `LALAKERS`  
- `slug`: `la-lakers`  
- `colorFamilies`: `["purple","yellow"]`  

## Migration note (legacy sample seeds)

The older `seedDesignTeams` callable may have created **`sf_49ers`** (sample id) with a short display name; repo data now uses **`name`: "San Francisco 49ers"** (stable **`id`** remains `sf_49ers`). The canonical Phase 1 NFL doc is **`san_francisco_49ers`** (separate id). If any `designs` reference `sf_49ers`, keep `teamId` or migrate to `san_francisco_49ers` as needed — Phase 1 does not duplicate the legacy id.

The **`batch_import`** pseudo-team is **not** in Phase 1; keep using the legacy `seedDesignTeams` flow or create that doc manually if still required.

## TypeScript

`DesignTeam` in `lib/types/firestore.ts` includes optional `slug` and `leagueCode` aligned with this seed.

## Extended metadata (tags, region, hashtags, …)

Canonical seed also writes **`tags`**, **`region`**, **`rivals`**, **`mascot`**, **`hashtags`**, **`fanPhrases`** via `designTeamEnrichment.js`. See **`RALLY_DESIGN_TEAM_METADATA.md`**.
