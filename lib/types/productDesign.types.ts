/**
 * ProductDesign + AI Design Brief System Types
 * 
 * KEY PRINCIPLES:
 * 1. Colorway = fabric color (on Product)
 * 2. Ink colors = print colors (on ProductDesign)
 * 3. ProductDesign immutable once approved (create new version)
 * 4. AI is advisory - produces briefs/concepts, humans approve designs
 */

import { Timestamp } from "firebase/firestore";
import type {
  RpDesignStatus,
  RpBriefStatus,
  RpConceptStatus,
  RpPrintMethod,
  RpDesignPlacement,
  RpInkColor,
  RpProductDesign,
  RpDesignBrief,
  RpDesignConcept,
  RpDesignFile,
} from "./firestore";

// Re-export core types from firestore.ts
export type {
  RpDesignStatus,
  RpBriefStatus,
  RpConceptStatus,
  RpPrintMethod,
  RpDesignPlacement,
  RpInkColor,
  RpProductDesign,
  RpDesignBrief,
  RpDesignConcept,
  RpDesignFile,
} from "./firestore";

// Additional helper types for UI/forms
export interface CreateDesignBriefInput {
  productId: string;
  title: string;
  objective: string;
  audience?: string;
  brandNotes?: string;
  constraints: {
    printMethod: RpPrintMethod;
    maxInkColors: number;
    mustIncludeText?: string[];
    avoid?: string[];
    placementOptions?: RpDesignPlacement[];
    colorway?: { name: string; hex?: string };
    requiredInkColors?: RpInkColor[];
    allowedInkColors?: RpInkColor[];
  };
  inspiration?: {
    notes?: string;
    links?: string[];
  };
}

export interface CreateProductDesignInput {
  productId: string;
  name: string;
  description?: string;
  briefId?: string;
  inkColors: RpInkColor[];
  printMethod: RpPrintMethod;
  maxInkColors?: number;
  placement: RpDesignPlacement;
  placementNotes?: string;
  sizeSpec?: {
    widthIn?: number;
    heightIn?: number;
    notes?: string;
  };
  textElements?: string[];
  styleTags?: string[];
}

export interface CreateDesignFromConceptInput {
  conceptId: string;
  name?: string; // Optional override
  description?: string; // Optional override
}

// AI Concept Generation Output (validated by Zod)
export interface AIConceptOutput {
  concepts: Array<{
    title: string;
    description: string;
    placement: RpDesignPlacement;
    inkColors: Array<{
      name: string;
      hex?: string;
      pantone?: string;
      notes?: string;
    }>;
    rationale?: string;
  }>;
}
