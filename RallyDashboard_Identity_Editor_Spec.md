# Rally Dashboard — Identity Editor (LoRA Ops) Spec (MVP v1)

## Goal
Implement the **Identity Editor** inside **LoRA Ops**. This is the core workflow for creating and maintaining long‑lived virtual brand ambassadors (e.g., Amber, Maya) that power LoRA training, generation, and future social distribution.

This spec covers:
- UI/UX requirements
- Firestore schema + constraints
- Cloud Storage paths for uploads
- Validation + status logic
- Seed flow for Pack A

> **Do not build training/dataset generation until this module is stable.**

---

## Navigation & Routes

### Top-level nav
`LoRA Ops` → sub-tabs:
- Packs
- **Identities** ✅ (this module)
- Reference Library
- Datasets
- Training Jobs

### Routes (suggested)
- `GET /lora/identities` → list view
- `GET /lora/packs/:packId/identities/new` → create identity
- `GET /lora/packs/:packId/identities/:identityId` → edit identity

(Exact routing can vary; keep packId context visible.)

---

## Data Model

### Firestore path
`model_packs/{packId}/identities/{identityId}`

### Document shape (MVP)
```ts
type FandomIntensity = "casual" | "strong" | "die-hard";
type IdentityStatus = "draft" | "ready";

type SocialAccountStatus = "planned" | "created" | "active" | "paused";

type TeamRef = {
  league: string;  // "NFL" | "MLB" | "NBA" | "NHL" | "NCAA" | etc
  team: string;    // stored as display string for MVP (later: teamId)
};

type InstagramMeta = {
  handle: string;            // "@amber.rally" (store with @ or normalize - choose one)
  accountStatus: SocialAccountStatus;
  contentTone?: string;      // "playful, confident, game-day energy"
  postingStyle?: string;     // "reels + carousels"
};

type Identity = {
  // Core
  name: string;              // "Amber"
  token: string;             // "rp_amber" (immutable once created)
  bodyType?: string;         // "athletic" | "curvy" | etc (MVP: string)
  ageRange?: string;         // "26–32"
  ethnicity?: string;        // MVP: string
  styleVibe?: string;        // "sporty / confident"
  status: IdentityStatus;    // system-controlled derived state
  notes?: string;

  // Persona
  hometown?: string;         // "San Jose, CA"
  region?: string;           // "Bay Area"
  primaryTeams?: TeamRef[];
  secondaryTeams?: TeamRef[];
  fandomIntensity?: FandomIntensity;
  personaBio?: string;

  // Social
  instagram?: InstagramMeta;

  // Assets summary (derived)
  facesCount?: number;       // maintained by upload function or client after list
  facesTarget?: number;      // default 20 (configurable per identity)
  lastFaceUploadAt?: any;    // Firestore timestamp

  // Audit
  createdAt: any;
  createdBy: string;         // uid
  updatedAt?: any;
  updatedBy?: string;
};
```

### IMPORTANT: Immutability rules
- `token` is **immutable** after creation (do not allow edits in UI once saved)
- `createdAt/createdBy` immutable
- All other persona fields editable

---

## Cloud Storage

### Face images (Identity-specific)
Upload to:
```
modelpacks/{packId}/identities/{identityId}/faces/{fileId}.jpg
```

Recommendations:
- Restrict to JPG/PNG/WebP
- Auto-generate `fileId` (UUID)
- On successful upload, increment `facesCount` and set `lastFaceUploadAt`

### Optional: derived / preview assets (future)
Not needed in MVP, but reserve:
```
modelpacks/{packId}/identities/{identityId}/previews/
```

---

## UI — Identities List View

### Table columns (MVP)
- Name
- Token
- Primary Team (first entry of primaryTeams or “—”)
- Faces (e.g., `14/20`)
- Status (Draft/Ready badge)
- Actions: View/Edit

### Filters (MVP)
- Pack selector (required)
- Status filter (Draft/Ready) (optional)
- Search by name/token (optional)

### CTAs
- “Add Identity” (within a selected pack)

---

## UI — Identity Editor (Create/Edit)

### Layout (recommended sections)
Use a single page with grouped cards/accordions:

#### A) Core Identity
Fields:
- **Name** (required)
- **Token** (required on create; read-only on edit)
  - helper text: “Token is permanent. Use lowercase + underscore. Example: rp_amber”
- Body Type
- Age Range
- Ethnicity
- Style Vibe
- Notes (textarea)

#### B) Persona & Fandom
Fields:
- Hometown
- Region
- Primary Teams (multi-row editor: league + team)
- Secondary Teams (multi-row editor: league + team)
- Fandom Intensity (dropdown)
- Persona Bio (textarea; 140–240 chars suggested)

#### C) Social Presence (Metadata only)
Instagram fields:
- Handle
- Account Status (planned/created/active/paused)
- Content Tone
- Posting Style

> Note: No posting, no IG API, no analytics in MVP.

#### D) Face Assets
- Multi-upload drop zone
- Thumbnail grid
- Count indicator: `facesCount / facesTarget`
- Soft warnings:
  - < 8 images: “Too few faces for training stability”
  - 8–19: “Good start — aim for 20”
  - 20+: “Ready for training”

Actions:
- Upload
- Delete (optional MVP; if too hard, omit delete and re-upload new set)

---

## Validation Rules (MVP)

### On Create
- `name` required
- `token` required
- token format:
  - lowercase letters, numbers, underscore only
  - must start with `rp_`
  - length 4–32
  - uniqueness: unique within the pack (query `identities` for token collision)

### On Save (Edit)
- token cannot be changed
- status cannot be manually set by the user

---

## Identity Status Logic (System-Controlled)

### Recommended derived rules
- `draft` if `facesCount < facesTarget` OR token missing OR name missing
- `ready` if:
  - name + token present
  - `facesCount >= facesTarget` (default target: 20)
  - (optional) at least 1 primaryTeam

Implementation options:
1) **Client-derived** (fastest): update status after uploads/saves
2) **Cloud Function-derived** (safer): trigger on storage upload or identity update

For MVP, client-derived is acceptable if access is admin-only.

---

## Security Rules (High-level)
Firestore:
- Only authenticated `role in ["admin","ops"]` can read/write `model_packs` and subcollections
Storage:
- Only `admin/ops` can upload to `modelpacks/**`

(Exact rules implemented in existing rules file — keep consistent.)

---

## Seed Pack A Flow (Recommended)
After Identity Editor is implemented:
1) Create Pack A (`Pack A – Rally Girls Core`, version `v1`, provider `fal`)
2) Add 10 identities (Amber…Rachel) using the Pack A persona spec
3) Upload face images later (can start with 0 uploads; schema should support it)
4) Confirm list view displays all identities with Draft status

---

## Acceptance Criteria (Definition of Done)
- Can create an identity under a pack
- Token becomes read-only after initial save
- Can edit persona + social fields
- Can upload multiple face images to Storage and see thumbnails + count
- Identities list shows counts and status badges
- Status is not user-editable (derived logic only)

---

## Notes for Cursor Implementation
- Prefer `react-hook-form` or controlled inputs with a single `saveIdentity()` call
- Use Firestore `serverTimestamp()` for createdAt/updatedAt
- Store provider secrets (fal keys) server-side only (not needed for this module)

---

## End of Spec
