# Rally Dashboard — LoRA Ops & Identity Personas (Full Scope + Pack A Personas)

## PURPOSE
This document defines the complete MVP scope for Rally Dashboard’s LoRA Operations system **and** the finalized Pack A identity personas.  
This file is intended to be **uploaded directly into Cursor** (no copy/paste required).

---

## TECH STACK
- Firebase Auth (Google Auth)
- Firestore
- Google Cloud Storage
- Google Cloud Functions
- fal.ai (LoRA training + inference)

No AI training or inference occurs client-side.

---

## CORE PRINCIPLES
- Identities are **not disposable models**
- Identities are long-lived brand ambassadors
- Personas guide authenticity, fandom alignment, and future social growth
- This architecture is acquisition-grade

---

## FIRESTORE DATA MODEL

### users/{uid}
```ts
{
  email,
  displayName,
  role: "admin" | "ops",
  createdAt
}
```

### model_packs/{packId}
```ts
{
  name: "Pack A – Rally Girls Core",
  provider: "fal",
  status: "draft" | "training" | "ready" | "failed",
  version: "v1",
  loraModelId?: string,
  createdBy,
  createdAt
}
```

### model_packs/{packId}/identities/{identityId}
```ts
{
  name,
  token,
  bodyType,
  ageRange,
  ethnicity,
  styleVibe,

  hometown,
  region,
  primaryTeams,
  secondaryTeams,
  fandomIntensity,
  personaBio,

  instagram: {
    handle,
    accountStatus,
    contentTone,
    postingStyle
  },

  status,
  createdAt
}
```

---

## CLOUD STORAGE STRUCTURE
```
modelpacks/{packId}/identities/{identityId}/faces/*.jpg
reference_library/{category}/{refId}.jpg
training_zips/{packId}/{datasetId}.zip
```

---

## CLOUD FUNCTIONS
- buildTrainingZip(packId)
- startTraining(packId, datasetId)
- trainingWebhookHandler
- pollTrainingJobs (fallback)

---

## UI MODULES (MVP)
LoRA Ops → Packs | Identities | Reference Library | Datasets | Training Jobs

---

## MVP DEFINITION OF DONE
1. Admin login via Google Auth
2. Pack A created
3. 10 identities created
4. Face images uploaded
5. Reference images uploaded
6. Training dataset built
7. Training job completes
8. Pack becomes ready

---

# PACK A — RALLY GIRLS CORE (FINALIZED PERSONAS)

## 1. Amber
token: rp_amber  
Age: 26–32  
Body: Athletic  
Ethnicity: White  
Hometown: San Jose, CA  
Primary Team: NFL – 49ers  
Secondary: MLB – Giants  
Fandom: Die-hard  
IG: @amber.rally  
Bio: Bay Area born. Faithful forever. Sundays are sacred.

## 2. Maya
token: rp_maya  
Age: 28–35  
Body: Petite  
Ethnicity: Latina  
Hometown: Boston, MA  
Primary: MLB – Red Sox  
Secondary: NBA – Celtics, NFL – Patriots  
Fandom: Strong  
IG: @maya.rally  
Bio: Boston blood. Fenway nights. Banner city energy.

## 3. Sierra
token: rp_sierra  
Age: 24–30  
Body: Curvy  
Ethnicity: Black  
Hometown: Atlanta, GA  
Primary: NFL – Falcons  
Secondary: MLB – Braves  
Fandom: Strong  
IG: @sierra.rally  
Bio: ATL raised. Game day glam. Southern heat.

## 4. Jess
token: rp_jess  
Age: 22–27  
Body: Slim  
Ethnicity: White  
Hometown: Ann Arbor, MI  
Primary: NCAA – Michigan  
Secondary: NFL – Lions  
Fandom: Die-hard  
IG: @jess.rally  
Bio: Big House Saturdays. Blue forever.

## 5. Talia
token: rp_talia  
Age: 30–38  
Body: Athletic  
Ethnicity: Middle Eastern  
Hometown: Los Angeles, CA  
Primary: NBA – Lakers  
Secondary: MLB – Dodgers  
Fandom: Strong  
IG: @talia.rally  
Bio: LA nights. Legacy teams. Championship energy.

## 6. Brooke
token: rp_brooke  
Age: 27–34  
Body: Curvy  
Ethnicity: White  
Hometown: Austin, TX  
Primary: NCAA – Texas  
Secondary: NFL – Cowboys  
Fandom: Strong  
IG: @brooke.rally  
Bio: Burnt orange. Big wins. Texas forever.

## 7. Nia
token: rp_nia  
Age: 25–32  
Body: Athletic  
Ethnicity: Black  
Hometown: Chicago, IL  
Primary: MLB – Cubs  
Secondary: NFL – Bears  
Fandom: Die-hard  
IG: @nia.rally  
Bio: North side heart. Wrigley summer nights.

## 8. Olivia
token: rp_olivia  
Age: 32–40  
Body: Fit  
Ethnicity: White  
Hometown: Denver, CO  
Primary: NFL – Broncos  
Secondary: NHL – Avalanche  
Fandom: Strong  
IG: @olivia.rally  
Bio: Mile high loyalty. Cold weather grit.

## 9. Priya
token: rp_priya  
Age: 29–36  
Body: Petite  
Ethnicity: South Asian  
Hometown: San Francisco, CA  
Primary: NBA – Warriors  
Secondary: NFL – 49ers  
Fandom: Strong  
IG: @priya.rally  
Bio: Bay energy. Dynasty era believer.

## 10. Rachel
token: rp_rachel  
Age: 35–45  
Body: Curvy  
Ethnicity: White  
Hometown: Philadelphia, PA  
Primary: NFL – Eagles  
Secondary: MLB – Phillies  
Fandom: Die-hard  
IG: @rachel.rally  
Bio: Philly loud. Philly proud. Fly Eagles Fly.

---

## END OF SPEC
