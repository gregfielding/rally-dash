# Rally → Shopify Tag Audit & Recommended Smart Collections

This document (1) audits the tag output with example products and (2) recommends an initial set of Smart Collections to create manually in Shopify. No collection automation is implemented yet.

---

## 1. Tag output audit

### 1.1 Tag rules (recap)

- **Prefixes:** `sport:`, `league:`, `team:`, `theme:`, `model:`
- **Values:** Lowercase, non-alphanumeric → `_`, trimmed, max 255 chars (e.g. `RED_SOX` → `red_sox`, `PREMIER_LEAGUE` → `premier_league`)
- **Order:** sport → league → team → theme → model(s). Deduped. Null/empty skipped. `blankId` and `designFamily` are never emitted as tags.

### 1.2 Example Rally products → exact Shopify tags

Below are synthetic Rally products and the **exact** tags that `buildShopifyTags(product)` returns.

| Example product description | Rally fields (product) | Generated Shopify tags |
|-----------------------------|------------------------|-------------------------|
| **MLB Giants panty** | sportCode: `BASEBALL`, leagueCode: `MLB`, teamCode: `GIANTS` | `sport:baseball`, `league:mlb`, `team:giants` |
| **NFL 49ers tee** | sportCode: `FOOTBALL`, leagueCode: `NFL`, teamCode: `FORTY_NINERS` | `sport:football`, `league:nfl`, `team:forty_niners` |
| **NBA Lakers + theme** | sportCode: `BASKETBALL`, leagueCode: `NBA`, teamCode: `LAKERS`, themeCode: `GAME_DAY` | `sport:basketball`, `league:nba`, `team:lakers`, `theme:game_day` |
| **College Colorado** | sportCode: `COLLEGE_SPORTS`, leagueCode: `NCAA`, teamCode: `COLORADO` | `sport:college_sports`, `league:ncaa`, `team:colorado` |
| **F1 Ferrari** | sportCode: `RACING`, leagueCode: `F1`, teamCode: `FERRARI` | `sport:racing`, `league:f1`, `team:ferrari` |
| **Soccer / Premier League / Arsenal** | sportCode: `SOCCER`, leagueCode: `PREMIER_LEAGUE`, teamCode: `ARSENAL` | `sport:soccer`, `league:premier_league`, `team:arsenal` |
| **Theme-only (lifestyle)** | sportCode: `null`, themeCode: `COUNTRY_CLUB` | `theme:country_club` |
| **Generic baseball theme, no team** | sportCode: `BASEBALL`, themeCode: `FUNNY_BASEBALL` | `sport:baseball`, `theme:funny_baseball` |
| **Model Amber** | sportCode: `BASEBALL`, leagueCode: `MLB`, teamCode: `GIANTS`, modelCodes: `["AMBER"]` | `sport:baseball`, `league:mlb`, `team:giants`, `model:amber` |
| **Two models** | sportCode: `FOOTBALL`, leagueCode: `NFL`, teamCode: `CHIEFS`, modelCodes: `["AMBER", "MAYA"]` | `sport:football`, `league:nfl`, `team:chiefs`, `model:amber`, `model:maya` |
| **Olympic theme** | sportCode: `OLYMPIC_SPORTS`, themeCode: `OLYMPIC_SWIMMING` | `sport:olympic_sports`, `theme:olympic_swimming` |
| **MLS Inter Miami** | sportCode: `SOCCER`, leagueCode: `MLS`, teamCode: `INTER_MIAMI` | `sport:soccer`, `league:mls`, `team:inter_miami` |

### 1.3 Consistency check

| Dimension | Example codes (Rally) | Example tags (Shopify) | Consistent? |
|-----------|------------------------|-------------------------|-------------|
| **Sports** | BASEBALL, FOOTBALL, COLLEGE_SPORTS, RACING, OLYMPIC_SPORTS, SOCCER, GOLF, LIFESTYLE | `sport:baseball`, `sport:college_sports`, `sport:racing`, etc. | Yes — one tag per sport, lowercase + underscores |
| **Leagues** | MLB, NFL, NCAA, F1, PREMIER_LEAGUE, MLS | `league:mlb`, `league:ncaa`, `league:premier_league`, etc. | Yes — one tag per league |
| **Entities/teams** | GIANTS, FORTY_NINERS, LAKERS, COLORADO, FERRARI, ARSENAL, INTER_MIAMI | `team:giants`, `team:forty_niners`, `team:colorado`, `team:inter_miami`, etc. | Yes — one tag per entity; multi-word/numbers become single slug (e.g. `forty_niners`) |
| **Themes** | FUNNY_BASEBALL, GAME_DAY, COUNTRY_CLUB, OLYMPIC_SWIMMING | `theme:funny_baseball`, `theme:game_day`, `theme:country_club`, `theme:olympic_swimming` | Yes — one tag per theme |
| **Models** | AMBER, MAYA | `model:amber`, `model:maya` | Yes — one tag per model in array |

**Conclusion:** Tags are deterministic, slug-safe, and consistent. No `blankId` or `designFamily` appear. Ready to align with Smart Collection rules.

---

## 2. Recommended initial Smart Collection set (create manually)

Create these **20–30** Smart Collections in Shopify Admin. Each uses a single rule: **Product tag** **equals** the value below. Order and naming are tuned for storefront navigation and validation.

### 2.1 Sports (by sport tag)

| # | Collection name | Tag rule (Product tag equals) | Why |
|---|-----------------|--------------------------------|-----|
| 1 | Sport: Baseball | `sport:baseball` | Major sport; all baseball products (any league/team). |
| 2 | Sport: Football | `sport:football` | Major sport; NFL and football-themed. |
| 3 | Sport: Basketball | `sport:basketball` | Major sport; NBA and basketball-themed. |
| 4 | Sport: Soccer | `sport:soccer` | Major sport; MLS, Premier League, etc. |
| 5 | Sport: Hockey | `sport:hockey` | Major sport. |
| 6 | Sport: Racing | `sport:racing` | F1, NASCAR, IndyCar, racing themes. |
| 7 | Sport: College | `sport:college_sports` | All college/NCAA products. |
| 8 | Sport: Olympic | `sport:olympic_sports` | All Olympic-themed products. |
| 9 | Sport: Golf | `sport:golf` | Golf and country-club style. |
| 10 | Sport: Generic / Other | `sport:generic_sports` | Generic/lifestyle sports (e.g. Sports Mom, Beer League). |

### 2.2 Leagues

| # | Collection name | Tag rule (Product tag equals) | Why |
|---|-----------------|--------------------------------|-----|
| 11 | League: MLB | `league:mlb` | Major League Baseball. |
| 12 | League: NFL | `league:nfl` | National Football League. |
| 13 | League: NBA | `league:nba` | National Basketball Association. |
| 14 | League: NHL | `league:nhl` | National Hockey League. |
| 15 | League: MLS | `league:mls` | Major League Soccer. |
| 16 | League: Premier League | `league:premier_league` | Premier League (soccer). |
| 17 | League: NCAA | `league:ncaa` | All NCAA (college) products. |
| 18 | League: F1 | `league:f1` | Formula 1. |
| 19 | League: NASCAR | `league:nascar` | NASCAR. |
| 20 | League: Olympics | `league:olympics` | Olympics. |

### 2.3 Major teams/entities (sample; add more as you add entities)

| # | Collection name | Tag rule (Product tag equals) | Why |
|---|-----------------|--------------------------------|-----|
| 21 | Team: San Francisco Giants | `team:giants` | Major MLB team. |
| 22 | Team: Los Angeles Dodgers | `team:dodgers` | Major MLB team. |
| 23 | Team: San Francisco 49ers | `team:forty_niners` | Major NFL team. |
| 24 | Team: Dallas Cowboys | `team:cowboys` | Major NFL team. |
| 25 | Team: Golden State Warriors | `team:warriors` | Major NBA team. |
| 26 | Team: Los Angeles Lakers | `team:lakers` | Major NBA team. |
| 27 | Team: Colorado (NCAA) | `team:colorado` | Example college entity. |
| 28 | Team: Ferrari (F1) | `team:ferrari` | F1 constructor. |
| 29 | Team: Inter Miami | `team:inter_miami` | MLS / high-profile club. |

### 2.4 Themes

| # | Collection name | Tag rule (Product tag equals) | Why |
|---|-----------------|--------------------------------|-----|
| 30 | Theme: Game Day | `theme:game_day` | Cross-sport game day. |
| 31 | Theme: Funny Baseball | `theme:funny_baseball` | Humor / baseball. |
| 32 | Theme: Country Club | `theme:country_club` | Lifestyle / golf. |
| 33 | Theme: Tailgate | `theme:tailgate` | Tailgate / topical. |
| 34 | Theme: Olympic Swimming | `theme:olympic_swimming` | Example Olympic discipline. |

### 2.5 Models

| # | Collection name | Tag rule (Product tag equals) | Why |
|---|-----------------|--------------------------------|-----|
| 35 | Model: Amber | `model:amber` | Products featuring model Amber. |
| 36 | Model: Maya | `model:maya` | Products featuring model Maya. |

---

## 3. Summary

- **Tag audit:** Example products show tags are consistent for sports, leagues, entities, themes, and models; format is lowercase and slug-safe; no internal-only fields are tagged.
- **Smart Collections:** Create the 20–36 collections above manually in Shopify (Product tag equals [value]). After you validate with real products and collections, you can decide whether to add automation (e.g. create/update collections via GraphQL).
- **Not in scope:** No automation of collection creation or updates in this step.
