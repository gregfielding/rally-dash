/**
 * Canonical print artboard pixel size (design files) and matching garment safe-area defaults.
 * Safe area is normalized to the garment preview image (0–1); aspect matches the artboard.
 */

export const DESIGN_ARTBOARD_WIDTH_PX = 2400;
export const DESIGN_ARTBOARD_HEIGHT_PX = 1500;

/** width / height (landscape 8:5) */
export const DESIGN_ARTBOARD_ASPECT_RATIO = DESIGN_ARTBOARD_WIDTH_PX / DESIGN_ARTBOARD_HEIGHT_PX;

/**
 * Default safe print rectangle on the garment (fractions of garment image width/height).
 * Centered-ish; w/h ratio = DESIGN_ARTBOARD_ASPECT_RATIO.
 */
export const DEFAULT_GARMENT_SAFE_AREA = {
  x: 0.14,
  y: 0.275,
  w: 0.72,
  h: 0.45,
} as const;
