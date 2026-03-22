# DesignTeam extended metadata

Optional fields beyond colors support templates, search, and marketing **without** encoding risky or trademark-heavy data in the default seed.

## Fields (see `DesignTeam` in `lib/types/firestore.ts`)

| Field | Purpose | Default seed behavior |
|-------|---------|------------------------|
| **tags** | Lowercase hyphenated tokens (city, nickname, league, slug, team id, teamCode) | Merged from source `tags` + derived tokens in `designTeamEnrichment.js` |
| **region** | Geography keywords (`california`, `west-coast`, …) | From US/CA `state` map when not set in JSON |
| **rivals** | `teamCode` strings (uppercase) | `[]` — **never** auto-filled |
| **mascot** | Public mascot name | `null` — **never** auto-filled |
| **hashtags** | Social tags (`#sf-giants`, `#sfgiants`, …) | Derived from `slug` + `teamCode` only (no slogans) |
| **fanPhrases** | `{ text, type, verified }[]` | `[]` — **never** auto-filled |

Legacy single-string **`fanPhrase`** remains for backward compatibility; prefer **`fanPhrases`** for structured data.

## Safety rules

- **`fanPhrases` are not safe for automatic product generation** without human review. Use `verified: true` and an explicit `type` (`official` vs `fan_generated`) before any templated merch copy.
- Do **not** bulk seed trademarked slogans, top sellers, or jersey numbers via this model.
- **Rivals** and **mascot** should be curated manually when needed.

## Implementation

- **`functions/data/designTeamEnrichment.js`** — `enrichDesignTeamMetadata(team)` runs at end of canonical `finalizeTeamRecord`.
- Re-seed or merge: `npm run seed:design-teams:merge` or `seedDesignTeamsCanonicalPhase1` with `{ merge: true }`.
