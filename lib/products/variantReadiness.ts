/**
 * Readiness for 8394 variant-native assets (mock + flats on variant doc).
 */

export type VariantRowLike = {
  mockupUrl?: string | null;
  media?: { heroBack?: string | null; heroFront?: string | null } | null;
  flatRenders?: {
    flat_blended?: { back?: { url?: string | null } | null } | null;
    flat_clean?: { front?: { url?: string | null } | null } | null;
  } | null;
};

/** Variant has Shopify-ready flats: blended back + clean front garment + assigned heroes (not mock-only). */
export function isVariantBaseComplete8394(v: VariantRowLike | null | undefined): boolean {
  if (!v) return false;
  const blendedUrl = v.flatRenders?.flat_blended?.back?.url?.trim();
  const frontFlatUrl = v.flatRenders?.flat_clean?.front?.url?.trim();
  const heroBack = v.media?.heroBack?.trim();
  const heroFront = v.media?.heroFront?.trim();
  return !!(blendedUrl && frontFlatUrl && heroBack && heroFront);
}

/** Default/hero variant passes base complete — enough to treat parent as storefront-ready. */
export function isProductStorefrontReady8394(
  heroOrDefaultVariantId: string | null | undefined,
  variants: Array<{ id: string } & VariantRowLike>
): boolean {
  if (!heroOrDefaultVariantId) return false;
  const row = variants.find((x) => x.id === heroOrDefaultVariantId);
  return isVariantBaseComplete8394(row ?? null);
}

/**
 * Every **color** (blankVariantId) has at least one size variant that is base-complete.
 * Color × Size: asset pipeline runs on the primary size (e.g. XS) per color; sibling sizes may omit flats until copied.
 */
export function isProductFullyCatalogReady8394(
  variants: (VariantRowLike & { blankVariantId?: string | null })[]
): boolean {
  if (!variants.length) return false;
  const byColor = new Map<string, (VariantRowLike & { blankVariantId?: string | null })[]>();
  for (const v of variants) {
    const k = (v.blankVariantId && String(v.blankVariantId).trim()) || "_";
    if (!byColor.has(k)) byColor.set(k, []);
    byColor.get(k)!.push(v);
  }
  for (const group of byColor.values()) {
    if (!group.some((v) => isVariantBaseComplete8394(v))) return false;
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
  opts?: { failedMessage?: string | null }
): Variant8394ReadinessState {
  if (opts?.failedMessage?.trim()) return "error";
  if (isVariantBaseComplete8394(v)) return "base_complete";
  const hasMockOrPartialHero = !!(
    v?.mockupUrl?.trim() ||
    v?.media?.heroBack?.trim() ||
    v?.media?.heroFront?.trim()
  );
  const hasBlendedBack = !!v?.flatRenders?.flat_blended?.back?.url?.trim();
  const hasFrontFlat = !!v?.flatRenders?.flat_clean?.front?.url?.trim();
  const anyProgress = hasMockOrPartialHero || hasBlendedBack || hasFrontFlat;
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
