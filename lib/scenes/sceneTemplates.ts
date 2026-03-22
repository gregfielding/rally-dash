/**
 * Deterministic scene templates (non-AI lifestyle). MVP: one hanger + crewneck layout.
 * Server uses the same sceneId + placement; asset URLs come from env on the function.
 */

export type SceneTemplateCategory = "hanger" | "flat_lay" | "studio" | string;

/** Garment silhouette the template is framed for (layout / art direction). */
export type SceneTemplateGarmentType = "crewneck" | "tank" | "panty" | string;

export interface SceneTemplatePlacement {
  /** Horizontal center of garment in scene, 0–1. */
  x: number;
  /** Vertical center of garment in scene, 0–1. */
  y: number;
  /**
   * Max width of the flat render as a fraction of scene width (height follows aspect, fit inside).
   * 0–1.
   */
  scale: number;
}

/**
 * Canonical scene recipe. Asset URLs may be omitted here and supplied only on the server via env.
 */
export interface SceneTemplate {
  sceneId: string;
  category: SceneTemplateCategory;
  garmentType: SceneTemplateGarmentType;
  backgroundImageUrl: string;
  placement: SceneTemplatePlacement;
  maskUrl?: string | null;
  shadowUrl?: string | null;
  /**
   * Blank style codes this template is validated for. Empty or ["*"] = any (MVP proof mode).
   */
  compatibleBlankStyles: string[];
}

/** MVP single template metadata (URLs configured on Cloud Function env). */
export const HANGER_CREWNECK_SCENE_ID = "hanger_crewneck" as const;

export const HANGER_CREWNECK_SCENE_TEMPLATE: Omit<SceneTemplate, "backgroundImageUrl"> & {
  backgroundImageUrl?: string;
} = {
  sceneId: HANGER_CREWNECK_SCENE_ID,
  category: "hanger",
  garmentType: "crewneck",
  placement: { x: 0.5, y: 0.46, scale: 0.52 },
  compatibleBlankStyles: ["*"],
  maskUrl: null,
  shadowUrl: null,
};
