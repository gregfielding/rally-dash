import type {
  DesignDoc,
  DesignTeam,
  RPBlank,
  RpGenerationType,
  RpScenePreset,
  RpSceneType,
} from "@/lib/types/firestore";
import { inferDefaultPrintSides } from "@/lib/blanks/defaultPrintSides";
import {
  DEFAULT_SCENE_RENDER_KEY,
  FALLBACK_SCENE_PRESET_IDS,
  STYLE_CODES_PRIMARY_BACK,
} from "./generationDefaultsConfig";

export type GenerationRuleSource = "blank" | "team" | "design" | "config" | "inferred" | "product";

export interface GenerationRule<T> {
  value: T;
  source: GenerationRuleSource;
  /** Short note for UI, e.g. field path or reason */
  detail?: string;
}

export interface ResolvedProductGeneration {
  primaryView: GenerationRule<"front" | "back">;
  productOnlyPresetId: GenerationRule<string | null>;
  onModelPresetId: GenerationRule<string | null>;
  defaultIdentityId: GenerationRule<string | null>;
  sceneRenderKey: GenerationRule<string>;
  /** Allowed scene types from blank when set; otherwise unrestricted in UI. */
  allowedSceneTypes: GenerationRule<RpSceneType[] | null>;
}

function rule<T>(value: T, source: GenerationRuleSource, detail?: string): GenerationRule<T> {
  return { value, source, detail };
}

/**
 * Resolve generation defaults for the Product page from blank → team → design → central config.
 * Product-level persisted overrides can be merged in a later phase.
 */
export function resolveProductGeneration(params: {
  blank: RPBlank | null | undefined;
  team: DesignTeam | null | undefined;
  design: DesignDoc | null | undefined;
}): ResolvedProductGeneration {
  const { blank, team, design } = params;
  const styleCode = String(blank?.styleCode || "").trim();

  // Primary view — blank.defaultPrintSides (or category inference) is the garment-level default
  let primaryView: GenerationRule<"front" | "back">;
  const dps = inferDefaultPrintSides(blank);
  if (dps === "back_only") {
    primaryView = rule("back", "blank", "blank.defaultPrintSides / garment category → back");
  } else if (dps === "front_only") {
    primaryView = rule("front", "blank", "blank.defaultPrintSides / garment category → front");
  } else if (blank?.generationDefaults?.primaryView === "front" || blank?.generationDefaults?.primaryView === "back") {
    primaryView = rule(blank.generationDefaults.primaryView, "blank", "blank.generationDefaults.primaryView");
  } else if (styleCode && STYLE_CODES_PRIMARY_BACK.has(styleCode)) {
    primaryView = rule("back", "inferred", `styleCode ${styleCode} → back-primary set`);
  } else {
    primaryView = rule("front", "config", "default front-primary");
  }

  // Product-only preset
  let productOnlyPresetId: GenerationRule<string | null>;
  if (design?.generationOverrides?.productOnlyPresetId) {
    productOnlyPresetId = rule(
      design.generationOverrides.productOnlyPresetId,
      "design",
      "design.generationOverrides.productOnlyPresetId"
    );
  } else if (blank?.generationDefaults?.productOnlyPresetId) {
    productOnlyPresetId = rule(
      blank.generationDefaults.productOnlyPresetId,
      "blank",
      "blank.generationDefaults.productOnlyPresetId"
    );
  } else {
    productOnlyPresetId = rule(FALLBACK_SCENE_PRESET_IDS.productOnly, "config", "FALLBACK_SCENE_PRESET_IDS.productOnly");
  }

  // On-model preset
  let onModelPresetId: GenerationRule<string | null>;
  if (design?.generationOverrides?.onModelPresetId) {
    onModelPresetId = rule(
      design.generationOverrides.onModelPresetId,
      "design",
      "design.generationOverrides.onModelPresetId"
    );
  } else if (team?.generationDefaults?.defaultOnModelPresetId) {
    onModelPresetId = rule(
      team.generationDefaults.defaultOnModelPresetId,
      "team",
      "team.generationDefaults.defaultOnModelPresetId"
    );
  } else if (blank?.generationDefaults?.onModelPresetId) {
    onModelPresetId = rule(blank.generationDefaults.onModelPresetId, "blank", "blank.generationDefaults.onModelPresetId");
  } else {
    onModelPresetId = rule(FALLBACK_SCENE_PRESET_IDS.onModel, "config", "FALLBACK_SCENE_PRESET_IDS.onModel");
  }

  // Identity (on-model)
  let defaultIdentityId: GenerationRule<string | null>;
  if (design?.generationOverrides?.identityId) {
    defaultIdentityId = rule(design.generationOverrides.identityId, "design", "design.generationOverrides.identityId");
  } else if (team?.generationDefaults?.defaultIdentityId) {
    defaultIdentityId = rule(
      team.generationDefaults.defaultIdentityId,
      "team",
      "team.generationDefaults.defaultIdentityId"
    );
  } else {
    defaultIdentityId = rule(null, "config", "none — pick in Advanced or set team default");
  }

  const sceneKey =
    blank?.generationDefaults?.defaultSceneRenderKey?.trim() || DEFAULT_SCENE_RENDER_KEY;
  const sceneRenderKey = rule(sceneKey, blank?.generationDefaults?.defaultSceneRenderKey ? "blank" : "config", "scene composite key");

  const allowed =
    blank?.generationDefaults?.allowedSceneTypes && blank.generationDefaults.allowedSceneTypes.length > 0
      ? blank.generationDefaults.allowedSceneTypes
      : null;
  const allowedSceneTypes = rule(
    allowed,
    allowed ? "blank" : "config",
    allowed ? "blank.generationDefaults.allowedSceneTypes" : "none listed — all preset types available"
  );

  return {
    primaryView,
    productOnlyPresetId,
    onModelPresetId,
    defaultIdentityId,
    sceneRenderKey,
    allowedSceneTypes,
  };
}

export function presetLabel(presets: RpScenePreset[], id: string | null | undefined): string {
  if (!id) return "—";
  const p = presets.find((x) => x.id === id);
  return p?.name || id;
}

/** `sceneType` from the loaded preset list (Firestore `rp_scene_presets`). */
export function sceneTypeFromPreset(
  presets: RpScenePreset[],
  presetId: string | null | undefined
): RpSceneType | null {
  if (!presetId) return null;
  const p = presets.find((x) => x.id === presetId);
  if (!p) return null;
  return p.sceneType ?? null;
}

const SCENE_TYPE_LABELS: Record<RpSceneType, string> = {
  ecommerce: "Ecommerce",
  studio: "Studio",
  lifestyle: "Lifestyle",
  social: "Social",
  ugc: "UGC",
  video: "Video",
};

export function formatSceneTypeLabel(sceneType: RpSceneType | null | undefined): string {
  if (sceneType == null) return "—";
  return SCENE_TYPE_LABELS[sceneType] ?? String(sceneType);
}

/** Infer Cloud Function generationType from a Firestore scene preset. */
export function inferGenerationTypeFromPreset(preset: RpScenePreset | undefined): "product_only" | "on_model" {
  if (!preset) return "product_only";
  const mode = (preset as { mode?: string }).mode;
  if (mode === "productOnly") return "product_only";
  if (mode === "onModel") return "on_model";
  const sm = preset.supportedModes as RpGenerationType[] | undefined;
  if (sm?.includes("product_only") && !sm.includes("on_model")) return "product_only";
  if (sm?.includes("on_model") && !sm.includes("product_only")) return "on_model";
  return sm?.includes("product_only") ? "product_only" : "on_model";
}
