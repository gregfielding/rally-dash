
# Rally Sports & Lifestyle Product Taxonomy Spec
Author: ChatGPT
Purpose: Define a scalable taxonomy system for Rally that supports sports leagues, colleges, motorsports, generic sports themes, and lifestyle designs while remaining compatible with Shopify collections and Firestore data models.

---

# 1. Overview

Rally is a **design-driven POD platform**, not just a storefront. The taxonomy must support:

• Professional sports teams  
• Colleges (NCAA)  
• Motorsports teams  
• Generic sports themes  
• Funny / topical designs  
• Lifestyle themes  

This taxonomy is designed to power:

- Rally backend filters
- Batch design imports
- Product generation
- Shopify catalog structure
- Future AI / automation tools

---

# 2. Core Taxonomy Fields

Every **Design** and **Product** should support these core structured fields.

## sportCode

Top level grouping.

Examples:

BASEBALL  
FOOTBALL  
BASKETBALL  
HOCKEY  
SOCCER  
RACING  
GOLF  
TENNIS  
COLLEGE_SPORTS  
GENERIC_SPORTS  
LIFESTYLE  

---

## leagueCode

Used when a sport has an official league.

Examples:

MLB  
NFL  
NBA  
NHL  
MLS  
PREMIER_LEAGUE  
NCAA  
NASCAR  
INDYCAR  
F1  

Generic sports designs may leave this NULL.

Example:

sportCode = BASEBALL  
leagueCode = null  

---

## teamCode

Represents a specific team or entity.

Examples:

GIANTS  
DODGERS  
YANKEES  
COWBOYS  
49ERS  
LAKERS  
USC  
ALABAMA  
COLORADO  
FERRARI  
MCLAREN  
RED_BULL  

Generic sports themes should leave teamCode NULL.

---

## themeCode

Used for **generic sports, humor, lifestyle, or topical designs**.

Examples:

GENERIC_BASEBALL  
GENERIC_SOFTBALL  
GOLF_GIRL  
TAILGATE  
GAME_DAY  
CHECKERED_FLAG  
FUNNY_SPORTS  
SPORTS_MOM  
BEER_LEAGUE  
TRASH_TALK  
COUNTRY_CLUB  
BACHELORETTE  

---

## designFamily

Internal creative concept grouping.

Examples:

WILL_DROP_FOR  
HOME_RUN  
TEE_TIME  
FULL_THROTTLE  
GAME_DAY_GIRL  
PITCH_SLAP  
CHECKERED_FLAG_SERIES  

Design families are primarily used for:

- backend filtering
- batch generation
- creative grouping
- analytics

They do NOT need to appear in the storefront.

---

# 3. Example Products

## MLB Product

sportCode = BASEBALL  
leagueCode = MLB  
teamCode = GIANTS  
themeCode = null  
designFamily = WILL_DROP_FOR  

Title example:

Will Drop For Giants – Heather Grey Bikini Panty

---

## College Product

sportCode = COLLEGE_SPORTS  
leagueCode = NCAA  
teamCode = USC  
themeCode = null  
designFamily = GAME_DAY_GIRL  

Title example:

Game Day Girl USC – Black Bikini Panty

---

## Racing Product

sportCode = RACING  
leagueCode = F1  
teamCode = FERRARI  
themeCode = null  
designFamily = FULL_THROTTLE  

Title example:

Full Throttle Ferrari – White Bikini Panty

---

## Generic Baseball Humor

sportCode = BASEBALL  
leagueCode = null  
teamCode = null  
themeCode = FUNNY_BASEBALL  
designFamily = PITCH_SLAP  

Title example:

Pitch Slap – Grey Bikini Panty

---

# 4. Firestore Schema Recommendation

Add these fields to **designs** and **products**.

```
sportCode?: string | null
leagueCode?: string | null
teamCode?: string | null
themeCode?: string | null
designFamily?: string | null
```

Optional display names:

```
taxonomy?: {
  sportName?: string
  leagueName?: string
  teamName?: string
  themeName?: string
}
```

---

# 5. Seed Data (Initial Catalog)

## Sports

BASEBALL  
FOOTBALL  
BASKETBALL  
HOCKEY  
SOCCER  
RACING  
GOLF  
TENNIS  
COLLEGE_SPORTS  
GENERIC_SPORTS  
LIFESTYLE  

---

## Leagues

MLB  
NFL  
NBA  
NHL  
MLS  
PREMIER_LEAGUE  
NCAA  
NASCAR  
INDYCAR  
F1  

---

## Example Teams

GIANTS  
DODGERS  
YANKEES  
COWBOYS  
49ERS  
PACKERS  
LAKERS  
CELTICS  

Colleges

USC  
ALABAMA  
COLORADO  
TEXAS  
MICHIGAN  
LSU  

Motorsports

FERRARI  
MCLAREN  
RED_BULL  

---

## Themes

GENERIC_BASEBALL  
GENERIC_SOFTBALL  
FUNNY_BASEBALL  
GOLF_GIRL  
TAILGATE  
GAME_DAY  
CHECKERED_FLAG  
SPORTS_MOM  
BEER_LEAGUE  
TRASH_TALK  
COUNTRY_CLUB  

---

## Design Families

WILL_DROP_FOR  
HOME_RUN  
TEE_TIME  
FULL_THROTTLE  
GAME_DAY_GIRL  
PITCH_SLAP  
CHECKERED_FLAG_SERIES  

---

# 6. Shopify Collection Strategy

Shopify should mirror only the **customer-facing layers**.

Recommended collections:

### Sport Collections

Baseball  
Football  
Basketball  
Soccer  
Racing  
Golf  
College Sports  

### Team Collections

San Francisco Giants  
Los Angeles Dodgers  
USC Trojans  
Alabama Crimson Tide  
Ferrari Racing  

### Theme Collections

Funny Sports Panties  
Game Day  
Tailgate  
Race Day  
Country Club  

---

# 7. Rally Backend Filters

Recommended filters for Rally UI:

Sport  
League  
Team  
Theme  
Design Family  
Blank  
Status  
Ready for Shopify  

---

# 8. Why This Model Works

This taxonomy supports:

• Professional teams  
• College teams  
• Motorsports  
• Generic sports humor  
• Lifestyle designs  

while allowing:

• scalable product generation  
• batch design imports  
• Shopify storefront organization  
• future automation tools

---

# 9. Future Enhancements

Possible future taxonomy additions:

genderTarget  
audienceType (fans, golfers, bachelorette, etc.)  
season (opening_day, playoffs, super_bowl, etc.)  

---

End of Rally Taxonomy Spec
