# Team Product Matrix — data model & UI (v1)

Purpose: separate **manual / QA** product creation from **team-approved, scalable** catalog generation by giving each design team an explicit **blank + variant allowlist**.

---

## 1. Relationship to existing systems

| Layer | Role |
|--------|------|
| **`RPBlank.eligibility`** (`includedTeamIds`, leagues, color families, etc.) | Broad/default **engine** rules: “this style can conceptually be used with these teams.” Stays for validation, warnings, and non-matrix flows. |
| **`DesignTeam.productCatalogMatrix`** | **Explicit catalog allowlist** for scalable generation: “this team actually sells these blanks in these colors.” |
| **Manual “Create Product from Design + Blank”** | Unchanged as a **QA / one-off** path. May warn if combo is outside matrix (future); never required to match matrix for ops. |

**Scalable generation rule (future):**  
For `Generate Team Products`, expand candidates as:

`(design.teamId)` × `(each matrix entry: blankId + variantId in approvedVariantIds)`  

Optionally intersect with blank eligibility for defense in depth; **matrix is the product-definition source of truth** for what gets auto-created.

---

## 2. Firestore data model

**Collection:** `design_teams/{teamId}` (existing `DesignTeam` document).

**New optional field:**

```ts
productCatalogMatrix?: Record<string, TeamCatalogBlankEntry> | null
```

- **Key:** `blankId` (`rp_blanks` document id).
- **Value:** `TeamCatalogBlankEntry` (see `lib/types/firestore.ts`).

### `TeamCatalogBlankEntry`

| Field | Type | Meaning |
|--------|------|--------|
| `approvedVariantIds` | `string[]` | Allowlisted `variantId`s for that master blank. |
| `enabled` | `boolean?` | If `false`, treat blank as off for bulk flows without deleting variant list. Default **on** when omitted. |
| `updatedAt` | `Timestamp?` | Audit. |
| `updatedBy` | `RPUserRef \| string?` | Audit. |

### Semantics

- **Blank absent from map** → not in team catalog for **bulk** generation.
- **Blank present, `approvedVariantIds: []`** → in catalog structurally but no colors approved (UI should show “select variants”; generator skips or logs).
- **Legacy blanks** (no `variants[]`): matrix can still store a single logical row; use a sentinel or the blank’s implicit color — **defer** until needed; v1 targets **master blanks** with `variants[]`.

### Size & updates

- One map per team is fine for tens of blanks; updates are `updateDoc` with dot paths or replace-merge of `productCatalogMatrix` from client after editing in memory.
- If documents grow large later, split to subcollection `design_teams/{teamId}/catalog_blanks/{blankId}` — **not** in v1.

---

## 3. UI structure (v1 — team-facing)

**Primary surface:** extend **Design Teams** ops experience.

**Recommended layout**

1. **`/design-teams`** (existing roster)  
   - Keep list + filters.  
   - Add column or badge: **“Catalog”** = count of blanks in `productCatalogMatrix` (optional v1.1).

2. **Team detail** (modal on `/design-teams` as of implementation)  
   - Tabs: **Overview** · **Colors / metadata** · **Approved products**  

3. **Approved products tab**  
   - Load all **active master** `rp_blanks` (`useBlanks({ status: "active", mastersOnly: true })`).  
   - **Expandable rows** per blank: header shows `styleCode` + garment/style name, link to blank editor.  
   - **Checkbox per variant** → `approvedVariantIds` (only checked rows are allowlisted).  
   - **Exclude style** → `enabled: false` on that matrix row; keeps `approvedVariantIds` for history; variant checkboxes disabled.  
   - **Not eligible** when `RPBlank.eligibility` (merged variant override) excludes this team — checkbox disabled; matrix still documents intent separately from engine rules.  
   - **Suggested** badge: `colorFamilies` on the team vs variant `colorName` keyword match (`lib/teams/teamProductMatrixHints.ts`); **not** stored and **not** auto-approved.  
   - **+ Neutrals** / **Add neutral defaults (all blanks)**: merges eligible neutral color names only (`isNeutralGarmentVariantName`); operators trigger explicitly — **no** auto-approval when new variants appear.  
   - **Save** → pruned map (omit rows with `enabled !== false` and empty `approvedVariantIds`), `updateDoc(design_teams/{teamId}, { productCatalogMatrix, updatedAt })`, optional per-row `updatedBy`.

4. **Empty state**  
   - “No blanks in catalog yet. Expand a blank and check variant colors to approve.”

**Future:** matrix-aware filter on **Create from Design + Blank** (“show only blanks/variants approved for this design’s team”) — optional toggle, default off for QA.

---

## 4. Manual modal — “Create Product from Design + Blank”

**Keep** current flow (design + blank + variant).

**v1 tweak (dashboard):**

- After design selection, show read-only **Team (from design)** using `teamNameCache` / `teamId` so operators see inferred team **without** separate league/team fields.

**Future:**

- Optional **multi-select variants** for one-shot creation of N products.  
- Optional **warning** when `(blankId, variantId)` ∉ matrix for design’s team.

---

## 5. Future: “Generate Team Products” (not built yet)

**Inputs:** `designId` (team inferred from `design.teamId`).

**Steps:**

1. Load design → require `teamId`.  
2. Load `design_teams/{teamId}` → read `productCatalogMatrix`.  
3. For each `blankId` with `enabled !== false` and each `variantId` in `approvedVariantIds`:  
   - Optionally check `RPBlank.eligibility` for team.  
   - Skip if `rp_products` already exists for same identity key (existing dedupe).  
   - Else enqueue `createProductFromDesignBlank`-equivalent + downstream assets as needed.

**Output:** summary `{ created, skipped, errors }`.

---

## 6. Acceptance checklist (implementation phases)

- [ ] Types in `lib/types/firestore.ts` (`TeamCatalogBlankEntry`, `productCatalogMatrix`).  
- [ ] Team catalog UI (accordion + save).  
- [ ] Firestore security rules: only ops/admin can write `productCatalogMatrix`.  
- [ ] `Generate Team Products` callable or batch job (later).  
- [ ] Optional: matrix filter / warning on manual modal.

---

*Author: Rally DesignOps spec — aligns blank eligibility (broad) with team matrix (catalog allowlist).*
