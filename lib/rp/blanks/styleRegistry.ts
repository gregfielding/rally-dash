/**
 * Style Registry for Blanks Library
 * Per RP_Blanks_Library_Spec_v2.md Section 6.1
 * 
 * This is the source of truth for all allowed styles and colors.
 */

export type BlankStyleCode = "8394" | "8390" | "TR3008" | "1822GD" | "HF07";
export type BlankGarmentCategory = "panty" | "thong" | "tank" | "crewneck";

export type BlankColorName =
  | "Black"
  | "White"
  | "Midnight Navy"
  | "Blue"
  | "Red"
  | "Heather Grey"
  | "Indigo"
  | "Athletic Grey"
  | "Navy"
  | "Off-White";

export interface StyleRegistryEntry {
  supplier: "Los Angeles Apparel";
  garmentCategory: BlankGarmentCategory;
  styleName: string;
  supplierUrl: string;
  allowedColors: BlankColorName[];
}

export const STYLE_REGISTRY: Record<BlankStyleCode, StyleRegistryEntry> = {
  "8394": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "panty",
    styleName: "Bikini Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8394-bikini-panty",
    allowedColors: ["Black", "White", "Midnight Navy", "Blue", "Red", "Heather Grey"],
  },
  "8390": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "thong",
    styleName: "Thong Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8390-thong-panty",
    allowedColors: ["Black", "White", "Midnight Navy", "Blue", "Red", "Heather Grey"],
  },
  "TR3008": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Tri-blend Racerback Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/tr3008-tri-blend-racerback-tank",
    allowedColors: ["Black", "Indigo", "Athletic Grey"],
  },
  "1822GD": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Garment Dye Crop Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/1822gd-garment-dye-crop-tank",
    allowedColors: ["Black", "Blue", "White"],
  },
  "HF07": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "crewneck",
    styleName: "Heavy Fleece Crewneck (Garment Dye)",
    supplierUrl: "https://losangelesapparel.net/products/hf07-heavy-fleece-crewneck-sweater-garment-dye",
    allowedColors: ["Black", "Navy", "Off-White"],
  },
};

// All style codes as array
export const ALL_STYLE_CODES: BlankStyleCode[] = ["8394", "8390", "TR3008", "1822GD", "HF07"];

// All garment categories as array
export const ALL_GARMENT_CATEGORIES: BlankGarmentCategory[] = ["panty", "thong", "tank", "crewneck"];

/**
 * Color Registry - hex values for colors
 * Per Section 6.2
 */
export const COLOR_REGISTRY: Record<BlankColorName, string> = {
  "Black": "#000000",
  "White": "#FFFFFF",
  "Midnight Navy": "#1C2841",
  "Blue": "#0066CC",
  "Red": "#CC0000",
  "Heather Grey": "#9B9B9B",
  "Indigo": "#3F51B5",
  "Athletic Grey": "#808080",
  "Navy": "#001F3F",
  "Off-White": "#FAF9F6",
};

/**
 * Build slug from style code and color name
 * Per Section 6.3
 * Examples: "laa-8394-black", "laa-tr3008-athletic-grey"
 */
export function buildBlankSlug(styleCode: BlankStyleCode, colorName: BlankColorName): string {
  return `laa-${styleCode.toLowerCase()}-${colorName.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Get allowed colors for a style
 */
export function getAllowedColors(styleCode: BlankStyleCode): BlankColorName[] {
  return STYLE_REGISTRY[styleCode]?.allowedColors || [];
}

/**
 * Validate style/color combination
 */
export function isValidStyleColor(styleCode: BlankStyleCode, colorName: BlankColorName): boolean {
  const entry = STYLE_REGISTRY[styleCode];
  if (!entry) return false;
  return entry.allowedColors.includes(colorName);
}

/**
 * Get style info
 */
export function getStyleInfo(styleCode: BlankStyleCode): StyleRegistryEntry | null {
  return STYLE_REGISTRY[styleCode] || null;
}

/**
 * Default placements per category
 * Per Section 6.4
 */
export type PlacementId = 
  | "front_center" 
  | "back_center" 
  | "front_left" 
  | "front_right" 
  | "back_left" 
  | "back_right";

export interface PlacementConfig {
  placementId: PlacementId;
  label: string;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  safeArea: { x: number; y: number; w: number; h: number };
}

export function getDefaultPlacements(category: BlankGarmentCategory): PlacementConfig[] {
  // All categories get front_center and back_center for MVP
  return [
    {
      placementId: "front_center",
      label: "Front Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
    },
    {
      placementId: "back_center",
      label: "Back Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
    },
  ];
}

/**
 * Generate tags for a blank
 */
export function generateBlankTags(
  styleCode: BlankStyleCode,
  colorName: BlankColorName,
  category: BlankGarmentCategory
): string[] {
  return [
    category,
    styleCode.toLowerCase(),
    colorName.toLowerCase().replace(/\s+/g, "-"),
    "los-angeles-apparel",
    "laa",
  ];
}

/**
 * Generate search keywords for a blank
 */
export function generateSearchKeywords(
  styleCode: BlankStyleCode,
  styleName: string,
  colorName: BlankColorName,
  category: BlankGarmentCategory
): string[] {
  const keywords = new Set<string>();
  
  // Add style code variations
  keywords.add(styleCode.toLowerCase());
  
  // Add style name words
  styleName.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
  
  // Add color name words
  colorName.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
  
  // Add category
  keywords.add(category);
  
  // Add supplier keywords
  keywords.add("los");
  keywords.add("angeles");
  keywords.add("apparel");
  keywords.add("laa");
  
  return Array.from(keywords);
}
