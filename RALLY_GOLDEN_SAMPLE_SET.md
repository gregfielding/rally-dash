# Rally — Golden Sample Set for QA

Small set of representative products to use for QA and regression. Covers major sports, league, college, motorsport, and one generic theme. Use these when validating pipeline, taxonomy, tags, and sync.

---

## 1. MLB Giants

- **Sport:** Baseball  
- **League:** MLB  
- **Team/entity:** San Francisco Giants (teamCode: `GIANTS`)  
- **Use for:** Pro team, baseball, MLB. Design family e.g. WILL_DROP_FOR.  
- **Expected Shopify tags:** `sport:baseball`, `league:mlb`, `team:giants`  
- **Example filename (batch):** `MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png`

---

## 2. NFL 49ers

- **Sport:** Football  
- **League:** NFL  
- **Team/entity:** San Francisco 49ers (teamCode: `FORTY_NINERS`)  
- **Use for:** Pro team, football, NFL.  
- **Expected Shopify tags:** `sport:football`, `league:nfl`, `team:forty_niners`  
- **Example filename (batch):** `NFL_HOME_RUN_FORTY_NINERS_FRONT_DARK.png`

---

## 3. NCAA Colorado

- **Sport:** College sports  
- **League:** NCAA  
- **Team/entity:** Colorado (teamCode: `COLORADO`)  
- **Use for:** College entity; entity → league → sport hierarchy.  
- **Expected Shopify tags:** `sport:college_sports`, `league:ncaa`, `team:colorado`  
- **Example filename (batch):** `NCAA_GAMEDAY_COLORADO_FRONT_LIGHT.png` (or equivalent design family)

---

## 4. F1 Ferrari

- **Sport:** Racing  
- **League:** F1  
- **Team/entity:** Ferrari (teamCode: `FERRARI`; entityType constructor)  
- **Use for:** Motorsport, F1, constructor entity.  
- **Expected Shopify tags:** `sport:racing`, `league:f1`, `team:ferrari`  
- **Example filename (batch):** `F1_CHECKERED_FLAG_FERRARI_BACK_LIGHT.png` (or equivalent)

---

## 5. One generic theme product

- **Sport:** Optional (null for purely thematic) or e.g. GENERIC_SPORTS / GOLF  
- **League:** null  
- **Team:** null  
- **Theme:** e.g. `COUNTRY_CLUB` or `GAME_DAY` or `FUNNY_BASEBALL`  
- **Use for:** Theme-only or lifestyle; no team/league; tag schema and validation (sport null allowed).  
- **Expected Shopify tags:** e.g. `theme:country_club` or `sport:baseball`, `theme:funny_baseball`  
- **Example:** Product with themeCode only (or sport + theme), no teamCode/leagueCode.

---

## How to use

- **Pipeline QA:** Run batch import, product generation, and sync for samples; confirm productIdentityKey, taxonomy, and tags match this reference.  
- **Regression:** After changes to parsing, taxonomy, or tags, re-validate these five cases.  
- **First real product design:** Can align first designs with one of these (e.g. MLB Giants or generic theme) and use the golden set to validate end-to-end.

---

*Defined during organizational pass before pivoting to first real product design.*
