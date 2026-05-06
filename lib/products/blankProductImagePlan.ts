/**
 * Blank-driven 8394 product image shot plan: generation slots, gallery order, launch gates.
 * Mirrors `functions/lib/blankProductImagePlan.js` — keep behavior in sync.
 */

import {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} from "@/lib/blanks/variantRenderSources";
import type {
  RPBlank,
  Rp8394InitialAssetRole,
  RpBlankProductImageGenerationKey,
  RPBlankProductImageTarget,
  RPBlankVariant,
} from "@/lib/types/firestore";
import { RP_BLANK_PRODUCT_IMAGE_DEFAULT_GALLERY_ORDER } from "@/lib/types/firestore";

export const BLANK_PRODUCT_IMAGE_GENERATION_KEYS: readonly RpBlankProductImageGenerationKey[] = [
  "model_blended_back",
  "flat_clean_front",
  "flat_blended_back",
  "model_clean_front",
] as const;

export type Resolved8394ProductImageTarget = RPBlankProductImageTarget & {
  key: RpBlankProductImageGenerationKey;
  enabled: boolean;
  resolvedSourcePhotoUrl: string | null;
  effectiveGalleryOrder: number;
  /** Back composite slots only — defaults true; front slots always false. */
  expectsArtwork: boolean;
};

function trimU(u: unknown): string {
  return u != null && typeof u === "string" ? u.trim() : "";
}

export function resolveSourcePhotoUrlForGenerationKey(
  blank: RPBlank,
  variant: RPBlankVariant,
  key: RpBlankProductImageGenerationKey,
  override?: string | null
): string | null {
  const o = trimU(override);
  if (o) return o;
  switch (key) {
    case "flat_blended_back":
      return trimU(getVariantFlatBackUrl(blank, variant)) || null;
    case "flat_clean_front":
      return trimU(getVariantFlatFrontUrl(blank, variant)) || null;
    case "model_blended_back":
      return trimU(getVariantModelBackUrl(blank, variant)) || null;
    case "model_clean_front":
      return trimU(getVariantModelFrontUrl(blank, variant)) || null;
    default:
      return null;
  }
}

/** Infers which MVP slots have a source photo from master blank URLs (legacy behavior). */
export function inferEnabledGenerationKeys8394(blank: RPBlank, variant: RPBlankVariant): RpBlankProductImageGenerationKey[] {
  const out: RpBlankProductImageGenerationKey[] = [];
  if (trimU(getVariantModelBackUrl(blank, variant))) out.push("model_blended_back");
  if (trimU(getVariantFlatFrontUrl(blank, variant))) out.push("flat_clean_front");
  if (trimU(getVariantFlatBackUrl(blank, variant))) out.push("flat_blended_back");
  if (trimU(getVariantModelFrontUrl(blank, variant))) out.push("model_clean_front");
  return out;
}

/**
 * Full resolved plan per MVP slot: enabled flags, effective URLs, gallery order, artwork expectation.
 */
export function resolve8394ProductImagePlan(
  blank: RPBlank,
  variant: RPBlankVariant
): Record<RpBlankProductImageGenerationKey, Resolved8394ProductImageTarget> {
  const raw = variant.productImageTargets || {};
  const inferred = new Set(inferEnabledGenerationKeys8394(blank, variant));
  const out = {} as Record<RpBlankProductImageGenerationKey, Resolved8394ProductImageTarget>;

  for (const key of BLANK_PRODUCT_IMAGE_GENERATION_KEYS) {
    const row = raw[key];
    const explicit = row && typeof row === "object" ? row : {};
    const hasExplicit = Object.prototype.hasOwnProperty.call(raw, key);
    const resolvedUrl = resolveSourcePhotoUrlForGenerationKey(blank, variant, key, explicit.sourcePhotoUrl);

    let enabled: boolean;
    if (hasExplicit) {
      enabled = explicit.enabled !== false && !!resolvedUrl;
    } else {
      enabled = inferred.has(key);
    }

    const go = explicit.galleryOrder;
    const effectiveGalleryOrder =
      go != null && Number.isFinite(Number(go)) ? Number(go) : RP_BLANK_PRODUCT_IMAGE_DEFAULT_GALLERY_ORDER[key];

    const isBackComposite = key === "flat_blended_back" || key === "model_blended_back";
    const expectsArtwork = isBackComposite ? explicit.expectsArtwork !== false : false;

    out[key] = {
      ...explicit,
      key,
      enabled,
      resolvedSourcePhotoUrl: resolvedUrl,
      effectiveGalleryOrder,
      expectsArtwork,
    };
  }

  return out;
}

export function enabledGenerationKeysInPlanOrder(
  plan: Record<RpBlankProductImageGenerationKey, Resolved8394ProductImageTarget>
): RpBlankProductImageGenerationKey[] {
  return BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => plan[k].enabled).sort(
    (a, b) => plan[a].effectiveGalleryOrder - plan[b].effectiveGalleryOrder
  );
}

/** MVP callable uses the same string identifiers as generation keys. */
export function planEnabledKeysToMvpRenderTypes(
  keys: RpBlankProductImageGenerationKey[]
): string[] {
  return keys.map((k) => String(k));
}

export function expectsArtworkForPlanKey(
  plan: Record<RpBlankProductImageGenerationKey, Resolved8394ProductImageTarget>,
  key: RpBlankProductImageGenerationKey
): boolean {
  return !!plan[key]?.expectsArtwork;
}

/** MVP generation key → `rp_generation_jobs.initialAssetRole` / batch role id (matches `blankProductImagePlan.js`). */
export const GENERATION_KEY_TO_OFFICIAL_ROLE: Record<RpBlankProductImageGenerationKey, Rp8394InitialAssetRole> = {
  model_blended_back: "model_back_designed",
  model_clean_front: "model_front_clean",
  flat_clean_front: "flat_front_clean",
  flat_blended_back: "flat_back_designed",
};

export function officialRoleForGenerationKey(key: RpBlankProductImageGenerationKey): Rp8394InitialAssetRole | null {
  return GENERATION_KEY_TO_OFFICIAL_ROLE[key] ?? null;
}

export function generationKeyForOfficialRole(role: string): RpBlankProductImageGenerationKey | null {
  const e = (
    Object.entries(GENERATION_KEY_TO_OFFICIAL_ROLE) as [RpBlankProductImageGenerationKey, Rp8394InitialAssetRole][]
  ).find(([, r]) => r === role);
  return e ? e[0] : null;
}

export type ResolvedBlankProductImagePlan = {
  generationPlan: Record<RpBlankProductImageGenerationKey, Resolved8394ProductImageTarget>;
  enabledGenerationKeysOrdered: RpBlankProductImageGenerationKey[];
  enabledOfficialRolesOrdered: Rp8394InitialAssetRole[];
  requiredLaunchOfficialRoles: Rp8394InitialAssetRole[];
  requiredShopifyOfficialRoles: Rp8394InitialAssetRole[] | null;
  /** Same as enabled official roles in gallery order (blank-driven). */
  galleryOrderOfficialRoles: Rp8394InitialAssetRole[];
};

/**
 * Single blank color row: enabled targets, gallery order, required launch / Shopify (official role ids).
 * Mirrors `functions/lib/blankProductImagePlan.js` `resolveBlankProductImagePlan`.
 */
export function resolveBlankProductImagePlan(blank: RPBlank, variant: RPBlankVariant): ResolvedBlankProductImagePlan {
  const plan = resolve8394ProductImagePlan(blank, variant);
  const enabledKeys = enabledGenerationKeysInPlanOrder(plan);
  const enabledOfficialRolesOrdered = enabledKeys
    .map((k) => officialRoleForGenerationKey(k))
    .filter((r): r is Rp8394InitialAssetRole => !!r);

  const raw = variant?.productImageTargets;
  const keys = BLANK_PRODUCT_IMAGE_GENERATION_KEYS;
  const hasExplicitLaunch = keys.some((k) => raw?.[k]?.requiredForLaunch === true);
  const hasExplicitShopify = keys.some((k) => raw?.[k]?.requiredForShopify === true);

  let requiredLaunchOfficialRoles: Rp8394InitialAssetRole[];
  if (hasExplicitLaunch) {
    requiredLaunchOfficialRoles = keys
      .filter((k) => raw?.[k]?.requiredForLaunch === true)
      .map((k) => officialRoleForGenerationKey(k))
      .filter((r): r is Rp8394InitialAssetRole => !!r);
  } else {
    requiredLaunchOfficialRoles = enabledKeys
      .filter((k) => k === "flat_clean_front" || k === "flat_blended_back")
      .map((k) => officialRoleForGenerationKey(k))
      .filter((r): r is Rp8394InitialAssetRole => !!r);
  }

  let requiredShopifyOfficialRoles: Rp8394InitialAssetRole[] | null = null;
  if (hasExplicitShopify) {
    requiredShopifyOfficialRoles = keys
      .filter((k) => raw?.[k]?.requiredForShopify === true)
      .map((k) => officialRoleForGenerationKey(k))
      .filter((r): r is Rp8394InitialAssetRole => !!r);
  }

  return {
    generationPlan: plan,
    enabledGenerationKeysOrdered: enabledKeys,
    enabledOfficialRolesOrdered,
    requiredLaunchOfficialRoles,
    requiredShopifyOfficialRoles,
    galleryOrderOfficialRoles: enabledOfficialRolesOrdered,
  };
}

/**
 * When the blank variant sets `requiredForLaunch` on any row, returns those keys (caller enforces outputs).
 * Otherwise returns `null` — keep legacy `isVariantBaseComplete8394` rules.
 */
export function resolveLaunchRequirementKeys8394(
  variant: RPBlankVariant | null | undefined
): RpBlankProductImageGenerationKey[] | null {
  const raw = variant?.productImageTargets;
  if (!raw || typeof raw !== "object") return null;
  const keys = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => raw[k]?.requiredForLaunch === true);
  return keys.length ? keys : null;
}

export function resolveShopifyRequirementKeys8394(
  variant: RPBlankVariant | null | undefined
): RpBlankProductImageGenerationKey[] | null {
  const raw = variant?.productImageTargets;
  if (!raw || typeof raw !== "object") return null;
  const keys = BLANK_PRODUCT_IMAGE_GENERATION_KEYS.filter((k) => raw[k]?.requiredForShopify === true);
  return keys.length ? keys : null;
}

export type VariantRowForPlanKeys = {
  flatRenders?: {
    flat_blended?: { back?: { url?: string | null } | null } | null;
    flat_clean?: { front?: { url?: string | null } | null } | null;
    model_blended?: { back?: { url?: string | null } | null } | null;
    model_clean?: { front?: { url?: string | null } | null } | null;
  } | null;
  generatedRenderOutputs?: Array<{ role?: string | null; url?: string | null; lookType?: string | null }> | null;
};

function hasGen(
  v: VariantRowForPlanKeys,
  role: string,
  lookType?: string
): boolean {
  const outs = v.generatedRenderOutputs;
  if (!Array.isArray(outs)) return false;
  return outs.some(
    (o) =>
      o &&
      String(o.role || "") === role &&
      trimU(o.url) &&
      (!lookType || !o.lookType || String(o.lookType) === lookType)
  );
}

/** Whether the variant row has a persisted output for this MVP generation slot. */
export function variantHasGenerationKeyOutput8394(
  v: VariantRowForPlanKeys | null | undefined,
  key: RpBlankProductImageGenerationKey
): boolean {
  if (!v) return false;
  switch (key) {
    case "flat_blended_back":
      return !!(trimU(v.flatRenders?.flat_blended?.back?.url) || hasGen(v, "flat_back", "flat_blended"));
    case "model_blended_back":
      return !!(trimU(v.flatRenders?.model_blended?.back?.url) || hasGen(v, "model_back", "model_blended"));
    case "flat_clean_front":
      return !!(trimU(v.flatRenders?.flat_clean?.front?.url) || hasGen(v, "flat_front", "flat_clean"));
    case "model_clean_front":
      return !!(trimU(v.flatRenders?.model_clean?.front?.url) || hasGen(v, "model_front", "model_clean"));
    default:
      return false;
  }
}

export function variantMeetsPlanKeys8394(
  v: VariantRowForPlanKeys | null | undefined,
  keys: RpBlankProductImageGenerationKey[] | null | undefined
): boolean {
  if (!keys?.length) return true;
  for (const k of keys) {
    if (!variantHasGenerationKeyOutput8394(v, k)) return false;
  }
  return true;
}

/**
 * Ordered still URLs for Shopify preview: heroes (if present), then enabled plan slots that have URLs on the variant row.
 */
export function build8394PreviewStillUrlsFromPlan(params: {
  backFirst: boolean;
  row: {
    media?: { heroBack?: string | null; heroFront?: string | null } | null;
    mockupUrl?: string | null;
    flatRenders?: VariantRowForPlanKeys["flatRenders"];
  };
  blank: RPBlank | null | undefined;
  blankVariant: RPBlankVariant | null | undefined;
}): string[] | null {
  const { backFirst, row, blank, blankVariant } = params;
  if (!blank || !blankVariant) return null;

  const plan = resolve8394ProductImagePlan(blank, blankVariant);
  const orderedKeys = enabledGenerationKeysInPlanOrder(plan);

  const out: string[] = [];
  const add = (u?: string | null) => {
    const s = trimU(u);
    if (s && !out.includes(s)) out.push(s);
  };

  const m = row.media || {};
  const hasHeroSlot = !!(trimU(m.heroBack) || trimU(m.heroFront));
  if (backFirst) {
    add(m.heroBack);
    add(m.heroFront);
  } else {
    add(m.heroFront);
    add(m.heroBack);
  }
  if (!hasHeroSlot) {
    add(row.mockupUrl);
  }

  const fr = row.flatRenders;
  for (const key of orderedKeys) {
    switch (key) {
      case "model_blended_back":
        add(fr?.model_blended?.back?.url);
        break;
      case "flat_clean_front":
        add(fr?.flat_clean?.front?.url);
        break;
      case "flat_blended_back":
        add(fr?.flat_blended?.back?.url);
        break;
      case "model_clean_front":
        add(fr?.model_clean?.front?.url);
        break;
      default:
        break;
    }
  }

  return out;
}
