# Rally Pipeline — Simple Checklist

Use this to track the main pipeline areas. Not exhaustive; enough to see status at a glance.

---

## Deterministic render

- [ ] Render setup (blank + design + placement per side) is the single source of truth for product/blank renders.
- [ ] Same setup → same visual output (deterministic).
- [ ] Bounds/padding and asset traceability documented or implemented per spec.

---

## Batch import

- [ ] Filename convention enforced (LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT).
- [ ] Parsed + grouped preview with resolved taxonomy and resolution status.
- [ ] Design create from batch with taxonomy (sport, league, entity, theme, design family).
- [ ] Rows with unresolved team skipped or clearly marked.

---

## Product generation

- [ ] productIdentityKey used for dedupe (leagueCode_designFamily_teamCode_blankId_variant).
- [ ] Products created/updated from batch import with correct taxonomy and identity key.
- [ ] Link from product to design(s) and import key for traceability.

---

## Batch hero render

- [ ] Batch hero flow specified (Phase 4).
- [ ] Hero assignment (front/back) and batch hero job/UI wired where intended.
- [ ] Hero media available for sync and related-products.

---

## Taxonomy

- [ ] Taxonomy seeded (sports, leagues, entities, themes, design families).
- [ ] Design and product forms: taxonomy dropdowns and validation (entity → league → sport).
- [ ] Firestore rules: taxonomy read (authenticated), write (admin/ops).
- [ ] Entity type on entities (e.g. pro_team, college, club, constructor); not stored on product.

---

## Shopify sync

- [ ] Tags from Rally taxonomy only (buildShopifyTags: sport, league, team, theme, model).
- [ ] Sync worker sends tags; no blankId/designFamily as tags.
- [ ] Product detail shows tag preview before sync.
- [ ] Smart Collections created manually; tag schema validated against them.
- [ ] Collection automation deferred until after validation.

---

*Use this list when resuming pipeline work or onboarding. No automation of checklist itself.*
