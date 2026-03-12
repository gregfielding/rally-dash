# RALLY_BATCH_DESIGN_IMPORT_UI_SPEC.md

Author: Greg Fielding  
Audience: Cursor Engineering Agent  
Project: Rally Panties / Rally DesignOps  
Purpose: Define the Batch Design Import UI so Rally can ingest large folders of design assets, parse structured filenames, create/update design records, and optionally generate products from selected blanks.

---

# 1. Goal

The Batch Design Import UI should make Rally dramatically faster than manual Photoshop + product-by-product setup.

Target workflow:

```text
Export 60 design files from Illustrator
→ drag folder into Rally
→ Rally parses filenames
→ Rally creates/updates design records
→ Rally groups by design family
→ Rally optionally generates products
```

This should support:

- hundreds of assets
- multiple design families
- multiple teams
- front/back files
- light/dark or other variants
- optional matching SVG / PNG / PDF sets

---

# 2. Supported Naming Convention

Files should follow:

```text
LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT
```

Examples:

```text
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.svg
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.pdf

MLB_HOME_RUN_DODGERS_BACK_DARK.png
MLB_HOME_RUN_DODGERS_BACK_DARK.svg
MLB_HOME_RUN_DODGERS_BACK_DARK.pdf
```

Parsed fields:

- league
- designFamily
- team
- side
- variant
- extension

The UI should preview the parsed result before import.

---

# 3. Main UI Entry Point

Add a new page or modal:

```text
Designs → Batch Import
```

Recommended main sections:

1. Upload
2. Parsed Preview
3. Mapping / Validation
4. Import Options
5. Results

---

# 4. Step 1 — Upload

## UI

Show a large drag-and-drop upload zone.

Allowed:
- multiple files
- folder upload if browser supports it
- PNG, SVG, PDF

Display count immediately:

```text
63 files selected
42 PNG
14 SVG
7 PDF
```

## Requirements

- support drag/drop
- support file picker
- ideally support dropping a whole exported folder
- do not start creating records immediately

After upload, go to parsing.

---

# 5. Step 2 — Parsed Preview

Show a table of all uploaded files and how Rally interprets them.

Columns:

- filename
- extension
- league
- design family
- team
- side
- variant
- status

Example:

| Filename | Ext | League | Family | Team | Side | Variant | Status |
|---------|-----|--------|--------|------|------|---------|--------|
| MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png | png | MLB | WILL_DROP_FOR | GIANTS | BACK | LIGHT | Valid |

Status examples:
- Valid
- Missing token
- Unknown team
- Duplicate asset
- Unsupported extension

This step is critical so the user can see if naming was interpreted correctly.

---

# 6. Step 3 — Mapping / Validation

The import UI should validate and normalize data before writing anything.

## Validation checks

### Required parsing fields
- league
- design family
- team
- side
- variant

### Team mapping
Map parsed team token to a known team record if available.

Example:
- `GIANTS` → `San Francisco Giants`
- `DODGERS` → `Los Angeles Dodgers`

### Duplicate detection
Detect if a Rally design already exists for:

```text
league + designFamily + team + side + variant
```

Possible outcomes:
- Create new design
- Update existing design
- Skip duplicate
- Replace asset on existing design

### Asset grouping
Files with the same base token should be grouped together.

Example:

```text
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.svg
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.pdf
```

These should become one grouped design import row.

## Grouped row columns

- key
- PNG present?
- SVG present?
- PDF present?
- existing design?
- action

Example action values:
- Create
- Update files
- Skip
- Manual review

---

# 7. Step 4 — Import Options

Before final import, allow the user to choose behavior.

## Option group A — Design import behavior

- Create new design records
- Update matching design records if they already exist
- Replace existing files when uploaded
- Skip duplicates

## Option group B — Auto-approval
- leave imported designs as draft
- auto-approve designs if PNG exists
- auto-approve only if PNG + SVG + PDF all exist

## Option group C — Product generation (optional)
After import, optionally generate products.

Fields:
- Generate products after import? yes/no
- Select blank(s)
- Generate front products? yes/no
- Generate back products? yes/no
- Create products as draft or approved

Example:
```text
Generate products: Yes
Blank: Heather Grey Bikini
Sides: Back only
Status: Draft
```

## Option group D — Render after product creation (optional later)
- Do not render now
- Generate deterministic hero renders immediately

For MVP this can be off by default.

---

# 8. Step 5 — Import Results

After import, show a results summary.

Example:

```text
Imported 60 grouped designs
Created 42 new designs
Updated 18 existing designs
Generated 60 products
Skipped 3 invalid files
```

Results table:

- grouped key
- design record link
- product created? yes/no
- warnings
- errors

Allow:
- view imported designs
- view generated products
- export import log CSV

---

# 9. Data Model Behavior

## Grouping key

Use a normalized base key:

```text
LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT
```

Example:

```text
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT
```

All matching extensions attach to the same design.

## Recommended design fields populated on import

When Rally creates/updates a design, it should set:

```ts
{
  name: "Will Drop For Giants Back Light",
  leagueCode: "MLB",
  designFamily: "WILL_DROP_FOR",
  teamCode: "GIANTS",
  supportedSides: ["back"],
  tags: ["league:mlb", "team:giants", "family:will_drop_for", "side:back", "variant:light"],
  files: {
    png: "...",
    svg: "...",
    pdf: "..."
  },
  hasPng: true,
  hasSvg: true,
  hasPdf: true
}
```

## Optional design family collection

If useful later, Rally can also maintain a lightweight design family index:

```text
designFamilies
  WILL_DROP_FOR
  HOME_RUN
  PITCH_SLAP
```

But this is not required for MVP if the design fields already carry family metadata.

---

# 10. Product Generation Behavior

If “Generate products after import” is enabled:

For each imported design row:

1. determine side
2. determine blank
3. create product title/handle
4. attach designIdFront or designIdBack depending on side
5. set blankId
6. initialize renderSetup for that side
7. leave as draft unless specified otherwise

## Example title generation

Filename:

```text
MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT
```

Possible title:

```text
Will Drop For Giants – Women's Heather Grey Bikini
```

## Example handle generation

```text
will-drop-for-giants-bikini
```

## Suggested product mapping behavior

If side = BACK:
- set designIdBack
- initialize renderSetup.back

If side = FRONT:
- set designIdFront
- initialize renderSetup.front

---

# 11. Recommended UI Components

Cursor can build the UI using the following components:

## BatchImportPage
Main container with stepper or multi-section flow.

## FileDropZone
Handles drag/drop and file selection.

## ParsedFilesTable
Shows raw file parsing results.

## GroupedDesignsTable
Shows grouped rows by base token with PNG/SVG/PDF presence.

## ImportOptionsPanel
Contains create/update/approval/product generation options.

## ImportResultsPanel
Shows final import results and links.

---

# 12. MVP Implementation Order

Build this in stages.

## Phase 1 — Parse and preview
- upload multiple files
- parse filenames
- show parsed table
- group matching files

## Phase 2 — Create/update design records
- create Rally designs from grouped rows
- attach PNG/SVG/PDF
- update existing records when selected

## Phase 3 — Optional product generation
- choose blank
- generate products from imported designs
- initialize renderSetup by side

## Phase 4 — Optional batch render
- generate hero front/back renders for imported products

---

# 13. Error Handling

Common error types:

- invalid filename format
- unknown team token
- duplicate grouped key with conflicting files
- upload failure
- Firestore write failure
- missing selected blank for product generation

UI should show warnings clearly and allow skipping bad rows without failing the entire batch.

---

# 14. Success Criteria

The Batch Design Import UI is successful when a user can:

1. Export a folder of assets from Illustrator
2. Drag the folder into Rally
3. See Rally correctly parse filenames
4. Import grouped design records automatically
5. Optionally generate products for a selected blank
6. Avoid manual one-by-one design creation

Ideal example outcome:

```text
Upload 60 files
→ Rally creates 20 grouped designs
→ Rally generates 20 products
→ Rally prepares them for deterministic rendering
```

---

# 15. Final Directive for Cursor

Please implement a Batch Design Import UI that treats filenames as structured metadata.

The system must:

- upload many files at once
- parse the naming convention
- group PNG/SVG/PDF by shared base key
- preview the parsed results
- create/update design records
- optionally generate products from selected blanks

This is a critical scaling feature for Rally because it turns Illustrator exports into structured catalog data rather than manual design entry.

---

# End of Spec
