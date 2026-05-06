/**
 * Readiness for 8394 variant-native assets (mock + flats on variant doc).
 * Uses the same inheritance + generated-output resolution as Shopify / fulfillment (`variantShopifyMedia`).
 */

import {
  mergeInheritedMediaForReadiness8394,
  type VariantMediaShape,
} from "@/lib/shopify/variantShopifyMedia";
import { isBackOnly8394FrontImageUrlAllowed } from "@/lib/shopify/backOnly8394Storefront";
import {
  resolveLaunchRequirementKeys8394,
  variantMeetsPlanKeys8394,
} from "@/lib/products/blankProductImagePlan";
import type { RPBlankVariant } from "@/lib/types/firestore";

export type ProductPrintSidesLike = {
  effectiveFront?: boolean;
  effectiveBack?: boolean;
  primaryPlacementSide?: string | null;
  blankMode?: string | null;
  designMode?: string | null;
} | null;

export type VariantRowLike = {
  mockupUrl?: string | null;
  media?: { heroBack?: string | null; heroFront?: string | null } | null;
  flatRenders?: {
    flat_blended?: { back?: { url?: string | null } | null } | null;
    flat_clean?: { front?: { url?: string | null } | null } | null;
    model_blended?: { back?: { url?: string | null } | null } | null;
    model_clean?: { front?: { url?: string | null } | null } | null;
  } | null;
  /** Official pipeline rows — canonical when present (aligned with `primaryVariantImageUrlForShopify`). */
  generatedRenderOutputs?: Array<{ role?: string | null; url?: string | null; lookType?: string | null }> | null;
};

export type Variant8394ReadinessOptions = {
  /** Full matrix (parent product) — merges primary’s media onto siblings with `inheritsMediaFromVariantId`. */
  variantMatrix?: Array<VariantRowLike & { id: string; inheritsMediaFromVariantId?: string | null }> | null;
  /**
   * Master blank color row — when set with `requiredForLaunch` on `productImageTargets`,
   * base-complete requires those generation slots (in addition to hero/mockup rules below).
   */
  blankVariantRowForPlan?: RPBlankVariant | null;
};

function trimU(u: string | null | undefined): string {
  return u != null && typeof u === "string" ? u.trim() : "";
}

/** Back commerce art: flat/model slots or official `generatedRenderOutputs` role `flat_back`. */
function has8394BackCommerceArt(v: VariantRowLike | null | undefined): boolean {
  if (!v) return false;
  if (trimU(v.flatRenders?.flat_blended?.back?.url)) return true;
  if (trimU(v.flatRenders?.model_blended?.back?.url)) return true;
  const outs = v.generatedRenderOutputs;
  if (!Array.isArray(outs)) return false;
  return outs.some(
    (o) =>
      o &&
      String(o.role || "") === "flat_back" &&
      trimU(o.url) &&
      (!o.lookType || String(o.lookType) === "flat_blended")
  );
}

/** Front commerce art: flat/model slots or official `generatedRenderOutputs` role `flat_front`. */
function has8394FrontCommerceArt(v: VariantRowLike | null | undefined): boolean {
  if (!v) return false;
  if (trimU(v.flatRenders?.flat_clean?.front?.url)) return true;
  if (trimU(v.flatRenders?.model_clean?.front?.url)) return true;
  const outs = v.generatedRenderOutputs;
  if (!Array.isArray(outs)) return false;
  return outs.some(
    (o) =>
      o &&
      String(o.role || "") === "flat_front" &&
      trimU(o.url) &&
      (!o.lookType || String(o.lookType) === "flat_clean")
  );
}

function resolve8394RowForReadiness(
  v: (VariantRowLike & { id?: string }) | null | undefined,
  options?: Variant8394ReadinessOptions
): VariantRowLike | null {
  if (!v) return null;
  const matrix = options?.variantMatrix;
  if (!matrix?.length || !v.id) return v;
  const byId = new Map<string, VariantMediaShape & { id?: string | null }>(
    matrix
      .filter((x) => x.id)
      .map((x) => [String(x.id), x as VariantMediaShape & { id?: string | null }])
  );
  return mergeInheritedMediaForReadiness8394(
    { ...(v as unknown as VariantMediaShape), id: String(v.id) },
    byId
  ) as VariantRowLike;
}

/**
 * Variant has Shopify-ready assets for the **effective** print sides (blank ∩ design).
 * Without `printSides`, requires full both-sides 8394 pipeline (legacy behavior).
 * When `variantMatrix` is set, applies the same primary→sibling media merge as fulfillment / Shopify.
 */
export function isVariantBaseComplete8394(
  v: VariantRowLike | null | undefined,
  printSides?: ProductPrintSidesLike,
  options?: Variant8394ReadinessOptions
): boolean {
  const row = resolve8394RowForReadiness(
    v as VariantRowLike & { id?: string },
    options
  );
  if (!row) return false;

  const heroBack = row.media?.heroBack?.trim();
  const heroFront = row.media?.heroFront?.trim();
  const mockup = row.mockupUrl?.trim();

  const ef = printSides?.effectiveFront;
  const eb = printSides?.effectiveBack;
  const backOnly = printSides != null && eb === true && ef === false;
  const frontOnly = printSides != null && ef === true && eb === false;

  const launchKeys = resolveLaunchRequirementKeys8394(options?.blankVariantRowForPlan ?? null);
  if (launchKeys && launchKeys.length > 0) {
    if (!variantMeetsPlanKeys8394(row, launchKeys)) return false;
  }

  if (backOnly) {
    const hasBackArt =
      launchKeys && launchKeys.length > 0 ? true : has8394BackCommerceArt(row);
    const hasBackDisplay = !!(heroBack || mockup);
    if (!hasBackArt || !hasBackDisplay) return false;
    /** If any front supplemental URL exists, it must be garment-only (never front-with-art for back-only). */
    const frontCandidates = new Set<string>();
    const a = trimU(row.media?.heroFront);
    const b = trimU(row.flatRenders?.flat_clean?.front?.url);
    const c = trimU(row.flatRenders?.model_clean?.front?.url);
    if (a) frontCandidates.add(a);
    if (b) frontCandidates.add(b);
    if (c) frontCandidates.add(c);
    for (const u of frontCandidates) {
      if (!isBackOnly8394FrontImageUrlAllowed(row as VariantMediaShape, u)) return false;
    }
    return true;
  }
  if (frontOnly) {
    const hasFrontArt =
      launchKeys && launchKeys.length > 0 ? true : has8394FrontCommerceArt(row);
    const hasFrontDisplay = !!(heroFront || mockup);
    return !!(hasFrontArt && hasFrontDisplay);
  }
  const artOk =
    launchKeys && launchKeys.length > 0
      ? true
      : !!(has8394BackCommerceArt(row) && has8394FrontCommerceArt(row));
  return !!(artOk && heroBack && heroFront);
}

/** Default/hero variant passes base complete — enough to treat parent as storefront-ready. */
export function isProductStorefrontReady8394(
  heroOrDefaultVariantId: string | null | undefined,
  variants: Array<{ id: string } & VariantRowLike>,
  printSides?: ProductPrintSidesLike
): boolean {
  if (!heroOrDefaultVariantId) return false;
  const row = variants.find((x) => x.id === heroOrDefaultVariantId);
  return isVariantBaseComplete8394(row ?? null, printSides, { variantMatrix: variants });
}

/**
 * Every **color** (blankVariantId) has at least one size variant that is base-complete.
 * Color × Size: asset pipeline runs on the primary size (e.g. M) per color; sibling sizes may omit flats until copied.
 */
export function isProductFullyCatalogReady8394(
  variants: (VariantRowLike & { id: string; blankVariantId?: string | null })[],
  printSides?: ProductPrintSidesLike
): boolean {
  if (!variants.length) return false;
  const byColor = new Map<string, (VariantRowLike & { id: string; blankVariantId?: string | null })[]>();
  for (const v of variants) {
    const k = (v.blankVariantId && String(v.blankVariantId).trim()) || "_";
    if (!byColor.has(k)) byColor.set(k, []);
    byColor.get(k)!.push(v);
  }
  const matrixOpts: Variant8394ReadinessOptions = { variantMatrix: variants };
  for (const group of byColor.values()) {
    if (!group.some((v) => isVariantBaseComplete8394(v, printSides, matrixOpts))) return false;
  }
  return true;
}

export type Variant8394ReadinessState = "not_started" | "mock_only" | "base_complete" | "error";

/**
 * UI state for 8394 variant-native assets. Prefer clearing `failedMessage` when the variant is base-complete
 * so stale failed-job docs do not block the badge.
 */
export function getVariant8394ReadinessState(
  v: VariantRowLike | null | undefined,
  opts?: {
    failedMessage?: string | null;
    printSides?: ProductPrintSidesLike;
    variantMatrix?: Variant8394ReadinessOptions["variantMatrix"];
    blankVariantRowForPlan?: RPBlankVariant | null;
  }
): Variant8394ReadinessState {
  if (opts?.failedMessage?.trim()) return "error";
  const ps = opts?.printSides;
  const matrix = opts?.variantMatrix;
  const options: Variant8394ReadinessOptions = {};
  if (matrix?.length) options.variantMatrix = matrix;
  if (opts?.blankVariantRowForPlan) options.blankVariantRowForPlan = opts.blankVariantRowForPlan;
  if (isVariantBaseComplete8394(v, ps, Object.keys(options).length ? options : undefined)) return "base_complete";

  const merged = resolve8394RowForReadiness(v as VariantRowLike & { id?: string }, options);
  const view = merged || v;

  const hasMockOrPartialHero = !!(
    view?.mockupUrl?.trim() ||
    view?.media?.heroBack?.trim() ||
    view?.media?.heroFront?.trim()
  );
  const hasBlendedBack = !!view?.flatRenders?.flat_blended?.back?.url?.trim();
  const hasModelBack = !!view?.flatRenders?.model_blended?.back?.url?.trim();
  const hasFrontFlat = !!view?.flatRenders?.flat_clean?.front?.url?.trim();
  const hasGenBack =
    Array.isArray(view?.generatedRenderOutputs) &&
    view!.generatedRenderOutputs!.some((o) => o && String(o.role || "") === "flat_back" && o.url?.trim());
  const hasGenFront =
    Array.isArray(view?.generatedRenderOutputs) &&
    view!.generatedRenderOutputs!.some((o) => o && String(o.role || "") === "flat_front" && o.url?.trim());
  const anyProgress =
    hasMockOrPartialHero || hasBlendedBack || hasModelBack || hasFrontFlat || hasGenBack || hasGenFront;
  if (!anyProgress) return "not_started";
  return "mock_only";
}

export function variant8394ReadinessLabel(state: Variant8394ReadinessState): string {
  switch (state) {
    case "not_started":
      return "Not started";
    case "mock_only":
      return "Mock only";
    case "base_complete":
      return "Base complete";
    case "error":
      return "Error";
    default:
      return state;
  }
}
