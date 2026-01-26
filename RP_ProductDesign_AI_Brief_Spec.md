# Rally Panties DesignOps — ProductDesign + AI Design Brief System
**Cursor‑Ready, Build‑This‑Exactly Spec (EXTREMELY DETAILED)**

Owner: Rally Panties DesignOps  
Authoring Assistant: ChatGPT  
Last updated: 2026‑01‑20  
Status: AUTHORITATIVE SPEC — implement directly

---

## 0. PURPOSE (READ THIS FIRST)

This document defines a **first‑class ProductDesign system** with **AI‑assisted Design Briefing**, fully integrated into the existing Rally Panties Product System.

This is NOT:
- “just storing PNGs”
- “just another AI image generator”

This IS:
- A **production‑grade apparel design system**
- Where **design intent, ink colors, constraints, placement, and files** are preserved
- And AI is used **upstream** (concepting + briefs) and **downstream** (mockups, model shots)

Everything here is written to be:
- Deterministic
- Auditable
- Versionable
- Cursor‑friendly

---

## 1. TERMINOLOGY (LOCKED DEFINITIONS)

### Product
A sellable SKU or variant (e.g. *SF Giants Black Panty Brief*).

### Colorway
The **fabric color of the garment**.
Example:
- name: Black
- hex: #000000

Colorway NEVER includes logo ink colors.

### ProductDesign
A **specific printable design** intended to be applied to a product.
Example:
- “GIANTS Wordmark — Rear Center — Orange Ink”

### Ink Color
A **print color** used in the design.
Example:
- Giants Orange (#FD5A1E)

### Design Brief
A structured creative + production brief used to generate ProductDesigns.
Often AI‑generated.

### Concept
A proposed design direction generated from a brief.
Concepts may be promoted into ProductDesigns.

---

## 2. HIGH‑LEVEL USER FLOWS

### Flow A — Manual Design
1. Create Product
2. Go to Product → Designs
3. Click “Create Design”
4. Set ink colors, placement, print method
5. Upload PNG/SVG
6. Approve
7. Generate mockups / model shots

### Flow B — AI‑Assisted Design
1. Product → Designs
2. “AI Design Brief”
3. AI generates 3–8 concepts
4. User selects 1–N concepts
5. Convert to ProductDesign(s)
6. Upload / refine art
7. Generate assets

---

## 3. FIRESTORE COLLECTIONS (AUTHORITATIVE)

ALL collections are **TOP‑LEVEL** (not nested) for query performance.

```
rp_products
rp_product_designs
rp_design_briefs
rp_design_concepts
rp_design_files
rp_blank_templates        (future, optional)
rp_activity_logs          (shared audit stream)
```

---

## 4. TYPESCRIPT TYPES (SOURCE OF TRUTH)

Create:
`src/types/productDesign.types.ts`

### 4.1 Enums
```ts
export type DesignStatus = "draft" | "approved" | "archived";
export type BriefStatus = "draft" | "final";
export type ConceptStatus = "proposed" | "selected" | "rejected";

export type PrintMethod =
  | "screenprint"
  | "dtf"
  | "sublimation"
  | "embroidery"
  | "heat_transfer"
  | "unknown";

export type DesignPlacement =
  | "front_center"
  | "front_left"
  | "front_right"
  | "back_center"
  | "back_upper"
  | "back_lower"
  | "waistband"
  | "custom";
```

---

### 4.2 Ink Color
```ts
export type InkColor = {
  name: string;
  hex?: string;
  pantone?: string;
  cmyk?: { c: number; m: number; y: number; k: number };
  notes?: string;
};
```

---

### 4.3 ProductDesign (CRITICAL OBJECT)
```ts
export type ProductDesign = {
  id: string;
  productId: string;

  slug: string;                  // giants-wordmark-v1
  name: string;
  status: DesignStatus;
  version: number;

  // Design intent
  briefId?: string;
  description?: string;
  textElements?: string[];
  styleTags?: string[];

  // Color logic
  colorwayName?: string;
  colorwayHex?: string;
  inkColors: InkColor[];

  // Manufacturing constraints
  printMethod: PrintMethod;
  maxInkColors?: number;
  placement: DesignPlacement;
  placementNotes?: string;

  sizeSpec?: {
    widthIn?: number;
    heightIn?: number;
    notes?: string;
  };

  // Assets
  primaryPreviewUrl?: string;
  primaryPrintFileId?: string;

  // AI metadata
  ai?: {
    source: "manual" | "ai-brief";
    lastPrompt?: string;
    model?: string;
    generatedAt?: any;
  };

  createdAt: any;
  createdBy: string;
  updatedAt: any;
  updatedBy: string;
};
```

---

### 4.4 DesignBrief
```ts
export type DesignBrief = {
  id: string;
  productId: string;
  status: BriefStatus;

  title: string;
  objective: string;
  audience?: string;
  brandNotes?: string;

  constraints: {
    printMethod: PrintMethod;
    maxInkColors: number;
    mustIncludeText?: string[];
    avoid?: string[];
    placementOptions?: DesignPlacement[];
    colorway?: { name: string; hex?: string };
    requiredInkColors?: InkColor[];
    allowedInkColors?: InkColor[];
  };

  inspiration?: {
    notes?: string;
    links?: string[];
  };

  aiOutput?: {
    summary: string;
    conceptsGenerated: number;
    model: string;
    prompt: string;
  };

  createdAt: any;
  createdBy: string;
  updatedAt: any;
};
```

---

### 4.5 DesignConcept
```ts
export type DesignConcept = {
  id: string;
  productId: string;
  briefId: string;

  title: string;
  description: string;
  placement: DesignPlacement;
  inkColors: InkColor[];
  rationale?: string;

  status: ConceptStatus;

  createdAt: any;
  createdBy: string;
};
```

---

### 4.6 DesignFile
```ts
export type DesignFile = {
  id: string;
  productId: string;
  designId: string;

  fileType: "png" | "svg" | "ai" | "psd" | "pdf";
  label: string;
  storagePath: string;
  sizeBytes: number;

  createdAt: any;
  createdBy: string;
};
```

---

## 5. STORAGE PATHS (MANDATORY)

```
rp/products/{productId}/designs/{designId}/source/
rp/products/{productId}/designs/{designId}/concepts/
rp/products/{productId}/designs/{designId}/mockups/
```

---

## 6. CLOUD FUNCTIONS (IMPLEMENT EXACTLY)

### 6.1 createDesignBrief
Callable: `createDesignBrief`

Input:
```ts
{
  productId: string;
  title: string;
  objective: string;
  constraints: {...};
}
```

Behavior:
1. Save draft DesignBrief
2. Call OpenAI (JSON‑only response)
3. Validate with Zod
4. Write concepts
5. Mark brief final

---

### 6.2 createProductDesign
Callable: `createProductDesign`

Behavior:
- Auto‑increment version per product
- Enforce inkColors.length <= maxInkColors
- Create audit log

---

### 6.3 createDesignFromConcept
Callable: `createDesignFromConcept`

Behavior:
- Promote concept → ProductDesign
- Copy inks, placement, constraints

---

## 7. AI PROMPT (LOCKED)

System:
“You are a senior apparel graphic designer and screenprint production expert…”

User:
Include:
- Product type
- Colorway
- Print constraints
- Audience
- Must/avoid rules

Return STRICT JSON.

---

## 8. UI IMPLEMENTATION (MUI)

### Designs Tab
- Table of ProductDesigns
- Status chips
- “Create Design”
- “AI Design Brief”

### AI Brief Modal
- Step 1: Inputs
- Step 2: AI concepts
- Step 3: Convert to designs

---

## 9. VALIDATION RULES (NON‑NEGOTIABLE)

- Ink colors MUST be separate from colorway
- maxInkColors enforced
- Approved designs are immutable (clone to edit)
- All AI output validated before save

---

## 10. PHASED ROLLOUT

### Phase 1 (NOW)
- Schemas
- Hooks
- Designs UI
- AI brief text only

### Phase 2
- Concept images
- Blank templates
- Placement maps

### Phase 3
- Full AI design generation
- Video + social assets

---

## 11. ACCEPTANCE CRITERIA

- You can create a design without AI
- You can generate designs with AI
- You can attach files
- You can generate mockups
- Colorway vs ink is never confused

---

END OF SPEC
