import type { RpProduct, RpVariantGeneratedRenderOutput } from "@/lib/types/firestore";

/** Trimmed URL or empty string. */
export function trimMediaUrl(u: unknown): string {
  return typeof u === "string" ? u.trim() : "";
}

type VariantMediaShape = {
  media?: { heroFront?: string | null; heroBack?: string | null } | null;
  mockupUrl?: string | null;
  flatRenders?: RpProduct["flatRenders"] | null;
  generatedRenderOutputs?: RpVariantGeneratedRenderOutput[] | null;
};

/** Priority tiers for 8394 primary image from `generatedRenderOutputs` (strict lookType, then role-only). */
const GENERATED_PRIMARY_TIERS_8394: ReadonlyArray<{ role: string; lookType: string }> = [
  { role: "model_back", lookType: "model_blended" },
  { role: "flat_back", lookType: "flat_blended" },
  { role: "flat_front", lookType: "flat_clean" },
  { role: "model_front", lookType: "model_clean" },
];

function pickBestBySort(outputs: RpVariantGeneratedRenderOutput[]): RpVariantGeneratedRenderOutput | null {
  if (!outputs.length) return null;
  return [...outputs].sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999))[0] ?? null;
}

/**
 * Picks primary commerce URL from generated outputs for 8394 (deterministic: tier order, then `sort`, then role-only fallback).
 */
export function primaryUrlFromGeneratedOutputs8394(
  outputs: RpVariantGeneratedRenderOutput[] | null | undefined
): string {
  const r = pickGenerated8394Resolution(outputs);
  return r?.url ?? "";
}

export type Primary8394ResolutionSource =
  | "generatedOutputs_strict"
  | "generatedOutputs_loose"
  | "heroBack"
  | "mockupUrl"
  | "heroFront"
  | "flatRenders_model_blended_back"
  | "flatRenders_flat_blended_back"
  | "flatRenders_flat_clean_front"
  | "flatRenders_model_clean_front"
  | "none";

export type PrimaryVariantImage8394Resolution = {
  url: string;
  role: string | null;
  lookType: string | null;
  source: Primary8394ResolutionSource;
  /** Last path segment of URL (quick QA). */
  filename: string | null;
};

export function filenameFromCommerceUrl(url: string): string | null {
  const u = trimMediaUrl(url);
  if (!u) return null;
  try {
    const path = u.split("?")[0] ?? u;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return null;
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return null;
  }
}

function pickGenerated8394Resolution(
  outputs: RpVariantGeneratedRenderOutput[] | null | undefined
): {
  url: string;
  role: string | null;
  lookType: string | null;
  source: "generatedOutputs_strict" | "generatedOutputs_loose";
} | null {
  if (!outputs?.length) return null;
  const withUrl = outputs.filter((o) => trimMediaUrl(o.url));
  if (!withUrl.length) return null;

  for (const { role, lookType } of GENERATED_PRIMARY_TIERS_8394) {
    const strict = withUrl.filter((o) => o.role === role && String(o.lookType || "") === lookType);
    const best = pickBestBySort(strict);
    if (best) {
      return {
        url: trimMediaUrl(best.url),
        role: best.role ?? null,
        lookType: best.lookType != null ? String(best.lookType) : null,
        source: "generatedOutputs_strict",
      };
    }
  }
  for (const { role } of GENERATED_PRIMARY_TIERS_8394) {
    const loose = withUrl.filter((o) => o.role === role);
    const best = pickBestBySort(loose);
    if (best) {
      return {
        url: trimMediaUrl(best.url),
        role: best.role ?? null,
        lookType: best.lookType != null ? String(best.lookType) : null,
        source: "generatedOutputs_loose",
      };
    }
  }
  return null;
}

/**
 * Same resolution order as `primaryVariantImageUrlForShopify` for 8394, with metadata for QA UIs.
 */
export function resolvePrimaryVariantImage8394ForShopify(
  variant: VariantMediaShape | null | undefined
): PrimaryVariantImage8394Resolution {
  const gen = pickGenerated8394Resolution(variant?.generatedRenderOutputs ?? null);
  if (gen) {
    return {
      url: gen.url,
      role: gen.role,
      lookType: gen.lookType,
      source: gen.source,
      filename: filenameFromCommerceUrl(gen.url),
    };
  }

  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;

  const tryUrl = (
    url: string,
    source: Primary8394ResolutionSource,
    role: string | null,
    lookType: string | null
  ): PrimaryVariantImage8394Resolution | null => {
    const u = trimMediaUrl(url);
    if (!u) return null;
    return { url: u, role, lookType, source, filename: filenameFromCommerceUrl(u) };
  }

  return (
    tryUrl(m.heroBack ?? "", "heroBack", null, null) ||
    tryUrl(variant?.mockupUrl ?? "", "mockupUrl", null, null) ||
    tryUrl(m.heroFront ?? "", "heroFront", null, null) ||
    tryUrl(fr?.model_blended?.back?.url ?? "", "flatRenders_model_blended_back", "model_back", "model_blended") ||
    tryUrl(fr?.flat_blended?.back?.url ?? "", "flatRenders_flat_blended_back", "flat_back", "flat_blended") ||
    tryUrl(fr?.flat_clean?.front?.url ?? "", "flatRenders_flat_clean_front", "flat_front", "flat_clean") ||
    tryUrl(fr?.model_clean?.front?.url ?? "", "flatRenders_model_clean_front", "model_front", "model_clean") || {
      url: "",
      role: null,
      lookType: null,
      source: "none",
      filename: null,
    }
  );
}

/** How `media.heroBack` was produced for 8394 QA (matches post-`generateProductFlatRenders` writes). */
export function resolveHeroBackSource8394(variant: VariantMediaShape | null | undefined): {
  label: string;
  url: string;
} {
  const url = trimMediaUrl(variant?.media?.heroBack);
  if (!url) return { label: "none", url: "" };
  const fr = variant?.flatRenders;
  if (url === trimMediaUrl(fr?.model_blended?.back?.url)) {
    return { label: "flatRenders.model_blended.back (pipeline hero — on-model back composite)", url };
  }
  if (url === trimMediaUrl(fr?.flat_blended?.back?.url)) {
    return { label: "flatRenders.flat_blended.back (fallback when no model back)", url };
  }
  if (url === trimMediaUrl(variant?.mockupUrl)) {
    return { label: "mockupUrl", url };
  }
  return { label: "media.heroBack (no matching flatRenders slot — legacy or manual)", url };
}

/** How `media.heroFront` was produced for 8394 QA (flat garment pass-through only). */
export function resolveHeroFrontSource8394(variant: VariantMediaShape | null | undefined): {
  label: string;
  url: string;
} {
  const url = trimMediaUrl(variant?.media?.heroFront);
  if (!url) return { label: "none", url: "" };
  const fr = variant?.flatRenders;
  if (url === trimMediaUrl(fr?.flat_clean?.front?.url)) {
    return { label: "flatRenders.flat_clean.front (8394 garment copy)", url };
  }
  return { label: "media.heroFront (no flat_clean.front match — legacy or manual)", url };
}

/**
 * Primary image URL for this sellable variant’s Shopify featured media.
 * 8394: `generatedRenderOutputs` first (model_blended back → flat_blended back → flat_clean front → model_clean front),
 * then hero/mockup, then flat render slots.
 */
export function primaryVariantImageUrlForShopify(
  variant: VariantMediaShape | null | undefined,
  blankStyleCode: string | null | undefined
): string {
  const m = variant?.media ?? {};
  const fr = variant?.flatRenders;
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  if (is8394) {
    return resolvePrimaryVariantImage8394ForShopify(variant).url;
  }
  return (
    trimMediaUrl(m.heroFront) ||
    trimMediaUrl(variant?.mockupUrl) ||
    trimMediaUrl(m.heroBack) ||
    trimMediaUrl(fr?.flat_clean?.front?.url) ||
    trimMediaUrl(fr?.flat_blended?.back?.url) ||
    ""
  );
}
