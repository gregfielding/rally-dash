# Batch Design Import — Phase 2 Implementation Plan

## Scope (this slice only)

- Add **Import** action for grouped rows.
- For each grouped row: **create** a new design if no match exists, or **update** an existing design.
- Populate on the design: `leagueCode`, `designFamily`, `teamCode`, `supportedSides`, `variant`, `files.png` / `files.svg` / `files.pdf`, `hasPng` / `hasSvg` / `hasPdf`.
- Use grouped **base identity** `league + designFamily + team + side + variant` as the **matching key** (stored as `importKey` on the design).
- **Out of scope:** product generation, rendering.

---

## 1. Duplicate detection and update-vs-create

- **Matching key:** `baseKey` = `LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT` (e.g. `MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT`). Same as the key used for grouping files.
- **Stored on design:** optional `importKey` (string). Set on create and update so future imports can detect duplicates.
- **Duplicate detection:** Before import, fetch all designs (e.g. `useDesigns({})`), then build a `Map<string, DesignDoc>` keyed by `design.importKey` for designs that have `importKey` set. For each grouped row, `existing = existingByImportKey.get(row.baseKey)`. If `existing` → **Update** (upload files to that design, update file metadata, then update batch fields). If not → **Create** (create design, upload files, update file metadata, then set batch fields + `importKey`).
- **Update meaning:** Replace or add PNG/SVG/PDF for that design (upload new files, call `updateDesignFile`), and set batch metadata (`importKey`, `leagueCode`, `designFamily`, `teamCode`, `supportedSides`, `variant`) via Firestore `updateDoc` so the design stays in sync with the import key.

---

## 2. Files and functions to touch

| File | Changes |
|------|--------|
| `lib/types/firestore.ts` | Add optional `importKey?: string` to `DesignDoc`. |
| `lib/batchImport/parseDesignFilename.ts` | Add `suggestedDesignName(parsed)` for human-friendly title (and future preview). |
| `app/designs/batch/page.tsx` | Fetch designs and build `existingByImportKey`. Resolve `teamCode` → `teamId` via design teams. Add **Import** button; on Import: for each grouped row create or update design, upload files to Storage, call `updateDesignFile`, then `updateDoc` batch fields + `importKey`. Show suggested name in grouped table. Optional: show "Create" vs "Update" per row. |
| `lib/firebase/config.ts` | (no change; already export `db`, `storage`.) |
| `lib/hooks/useDesignAssets.ts` | (no change; use existing `useCreateDesign`, `useUpdateDesignFile`, `useDesigns`, `useDesignTeams`.) |
| Cloud Functions | (no change for this slice; optional later: extend `createDesignAsset` to accept optional batch fields so client does not need to call `updateDoc`.) |

---

## 3. Create flow (no existing design)

1. Resolve `teamCode` (e.g. `GIANTS`) to `teamId` (e.g. `sf_giants`) from `design_teams` (match by name or id).
2. `createDesign` with: `name: suggestedDesignName(parsed)`, `teamId`, `colors: [{ hex: "#000000", name: "", role: "ink" }]`.
3. For each file in the group (png, svg, pdf): upload to Storage `designs/{designId}/{kind}/{filename}`, then `updateDesignFile(designId, kind, storagePath, downloadUrl, fileName, …)`.
4. `updateDoc(designRef, { importKey: baseKey, leagueCode, designFamily, teamCode, supportedSides: [side], variant })`. (hasPng/hasSvg/hasPdf are set by `updateDesignFile`.)

---

## 4. Update flow (existing design with same importKey)

1. `designId = existing.id`.
2. For each file in the group: upload to Storage `designs/{designId}/{kind}/{filename}`, then `updateDesignFile(designId, kind, …)`.
3. `updateDoc(designRef, { importKey: baseKey, leagueCode, designFamily, teamCode, supportedSides: [side], variant })`.

---

## 5. Team resolution

- Load `design_teams`. Match `teamCode` (e.g. `GIANTS`) to a team: prefer `team.id` or `team.name` containing the code (case-insensitive, normalize spaces/underscores).
- **Unresolved teams:** Do **not** default to the first team (too risky for large imports). If no match:
  - **Option A (implemented):** Skip the row and mark it as **skipped** in the import results with message e.g. "Unresolved team: GIANTS (no matching team; row skipped)".
  - **Option B (alternative):** Import the design with parsed `teamCode` but no resolved `teamId` / team reference (would require backend support for optional teamId).
- Unresolved team mappings must be explicit, not silently assigned.

---

## 6. Later improvement (not in this slice)

- Parsed preview: show human-friendly interpreted title per row, e.g.  
  `MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT` → League: MLB, Family: WILL_DROP_FOR, Team: GIANTS, Side: BACK, Variant: LIGHT, **Suggested design name: Will Drop For Giants Back Light**.
