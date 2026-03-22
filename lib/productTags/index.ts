export {
  generateProductTags,
  toProperCase,
  normalizeTagForFilter,
  designTypeToDisplayLabel,
  garmentCategoryToDisplayLabel,
  DESIGN_TYPE_LABELS,
  GARMENT_CATEGORY_LABELS,
} from "./generateProductTags";
export { DESIGN_THEME_LABELS, DESIGN_THEME_OPTIONS, designThemeLabel } from "@/lib/designs/designThemes";
export type {
  ProductTagSources,
  ProductTagTeamSource,
  ProductTagDesignSource,
  ProductTagBlankSource,
  GeneratedProductTags,
} from "./generateProductTags";
