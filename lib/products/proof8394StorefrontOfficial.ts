/**
 * Read-only diagnostics: compare storefront-displayed URLs vs newest official `generatedRenderOutputs`
 * and surface blend parity slices. Does not affect rendering.
 */

import type { RpProductVariant, RpVariantGeneratedRenderOutput } from "@/lib/types/firestore";
import {
  isOfficialGeneratedRenderOutput,
  resolvePrimaryVariantImage8394ForShopify,
  trimMediaUrl,
  type ProductPrintSidesForCommerce,
} from "@/lib/shopify/variantShopifyMedia";

export type BlendParitySlice8394 = {
  previewBlendResolved: { blendMode: string; blendOpacity: number };
  officialBlendResolved: { blendMode: string; blendOpacity: number };
  parityStatus: "match" | "mismatch";
  fieldDiffs: string[];
};

function tsMs(t: unknown): number | null {
  if (!t || typeof t !== "object") return null;
  const fn = (t as { toDate?: () => Date }).toDate;
  if (typeof fn !== "function") return null;
  try {
    return fn.call(t).getTime();
  } catch {
    return null;
  }
}

/** Newest official row for role + lookType (by Firestore `createdAt` when present). */
export function newestOfficial8394Output(
  outs: RpVariantGeneratedRenderOutput[] | null | undefined,
  role: string,
  lookType: string
): { row: RpVariantGeneratedRenderOutput | null; createdAtMs: number | null } {
  const list = (outs ?? []).filter(
    (o) =>
      o &&
      isOfficialGeneratedRenderOutput(o) &&
      String(o.role) === role &&
      String(o.lookType || "") === lookType
  );
  if (!list.length) return { row: null, createdAtMs: null };
  const sorted = [...list].sort((a, b) => (tsMs(b.createdAt) ?? 0) - (tsMs(a.createdAt) ?? 0));
  const row = sorted[0] ?? null;
  return { row, createdAtMs: row ? tsMs(row.createdAt) : null };
}

function urlsEqual(a: string, b: string): boolean {
  return Boolean(a && b && a === b);
}

/**
 * Single object for ops: blend parity (from dashboard helpers) + URL identity for flat/model back.
 */
export function build8394StorefrontOfficialDriftProof(args: {
  variant: Pick<RpProductVariant, "flatRenders" | "generatedRenderOutputs" | "media" | "mockupUrl"> | null | undefined;
  printSides: ProductPrintSidesForCommerce | undefined;
  storefrontGalleryUrlsOrdered: string[];
  blendParityByTarget: { flat_back: BlendParitySlice8394; model_back: BlendParitySlice8394 } | null;
}): {
  blendParity: {
    flat_back: BlendParitySlice8394 | null;
    model_back: BlendParitySlice8394 | null;
  };
  displayed: {
    storefrontGalleryUrlsOrdered: string[];
    storefrontGalleryFirstUrl: string;
    primaryResolvedUrl: string;
    primaryResolvedSource: string;
    flatBlendedBackUrl: string;
    modelBlendedBackUrl: string;
    mediaHeroBackUrl: string;
  };
  newestOfficial: {
    flat_back: { url: string; storagePath: string | null; createdAtMs: number | null };
    model_back: { url: string; storagePath: string | null; createdAtMs: number | null };
  };
  identity: {
    flatBlendedBackUrl_equals_newestOfficialFlatBack: boolean;
    modelBlendedBackUrl_equals_newestOfficialModelBack: boolean;
    mediaHeroBack_equals_newestOfficialFlatBack: boolean;
    mediaHeroBack_equals_newestOfficialModelBack: boolean;
    /** First gallery thumb vs primary resolver (often same on back-only; differs when gallery prepends extra scene assets). */
    storefrontGalleryFirst_equals_primaryResolved: boolean;
  };
  /** When blend parity is match and flat/model slots match official URLs, drift vs blank preview is likely CSS/browser—not PNG bytes. */
  firstDriftHintIfUrlsAligned: string | null;
  gallery: {
    indexOfFlatBlendedBackUrl: number | null;
    indexOfModelBlendedBackUrl: number | null;
  };
  opsPrintBlock: string;
} {
  const { variant, printSides, storefrontGalleryUrlsOrdered, blendParityByTarget } = args;
  const primary = resolvePrimaryVariantImage8394ForShopify(variant, printSides);
  const fr = variant?.flatRenders;
  const flatU = trimMediaUrl(fr?.flat_blended?.back?.url);
  const modelU = trimMediaUrl(fr?.model_blended?.back?.url);
  const heroU = trimMediaUrl(variant?.media?.heroBack);

  const nf = newestOfficial8394Output(variant?.generatedRenderOutputs, "flat_back", "flat_blended");
  const nm = newestOfficial8394Output(variant?.generatedRenderOutputs, "model_back", "model_blended");
  const nFlatUrl = trimMediaUrl(nf.row?.url);
  const nModelUrl = trimMediaUrl(nm.row?.url);

  const idFlat = urlsEqual(flatU, nFlatUrl);
  const idModel = urlsEqual(modelU, nModelUrl);
  const galleryTrimmed = storefrontGalleryUrlsOrdered.map((u) => trimMediaUrl(u)).filter(Boolean);
  const galleryFirst = galleryTrimmed[0] || "";
  const idxFlat = flatU ? galleryTrimmed.findIndex((u) => u === flatU) : -1;
  const idxModel = modelU ? galleryTrimmed.findIndex((u) => u === modelU) : -1;

  const blendParity = blendParityByTarget
    ? { flat_back: blendParityByTarget.flat_back, model_back: blendParityByTarget.model_back }
    : { flat_back: null, model_back: null };

  const blendOk =
    blendParityByTarget?.flat_back.parityStatus === "match" &&
    blendParityByTarget.model_back.parityStatus === "match";

  let firstDriftHintIfUrlsAligned: string | null = null;
  if (blendOk && idFlat && idModel) {
    firstDriftHintIfUrlsAligned =
      "Blend parity match and variant flat/model URLs match newest official rows: remaining mismatch vs the blank editor is expected to be browser/CSS (CSS mix-blend-mode + overlay filter + transforms differ from Sharp composite), not a wrong PNG URL. Inspect BlankRenderProfileEditor GarmentPreviewCanvas: overlay div opacity, mixBlendMode, filter (contrast/saturate), 3D warp transform, mask; garment and overlay <img> use object-contain (browser resampling). Product page storefront strip uses plain <img> with no blend.";
  } else if (!blendOk) {
    firstDriftHintIfUrlsAligned = "Blend parity mismatch: server-side tuning curve divergence (check separate blend proof).";
  } else if (!idFlat || !idModel) {
    firstDriftHintIfUrlsAligned =
      "URL mismatch: Firestore flatRenders slot(s) differ from newest official generatedRenderOutputs—re-run official batch or inspect stale variant doc.";
  }

  const pf = blendParityByTarget?.flat_back;
  const pm = blendParityByTarget?.model_back;
  const opsPrintBlock = [
    "=== 8394 drift proof (Images tab variant) ===",
    "",
    "--- flat_back (tuning / blend parity) ---",
    pf
      ? `previewBlendResolved: ${pf.previewBlendResolved.blendMode} · ${pf.previewBlendResolved.blendOpacity}`
      : "previewBlendResolved: —",
    pf
      ? `officialBlendResolved: ${pf.officialBlendResolved.blendMode} · ${pf.officialBlendResolved.blendOpacity}`
      : "officialBlendResolved: —",
    pf ? `parityStatus: ${pf.parityStatus}` : "parityStatus: —",
    pf ? `fieldDiffs: ${pf.fieldDiffs.length ? pf.fieldDiffs.join("; ") : "[]"}` : "fieldDiffs: —",
    "",
    "--- model_back (tuning / blend parity) ---",
    pm
      ? `previewBlendResolved: ${pm.previewBlendResolved.blendMode} · ${pm.previewBlendResolved.blendOpacity}`
      : "previewBlendResolved: —",
    pm
      ? `officialBlendResolved: ${pm.officialBlendResolved.blendMode} · ${pm.officialBlendResolved.blendOpacity}`
      : "officialBlendResolved: —",
    pm ? `parityStatus: ${pm.parityStatus}` : "parityStatus: —",
    pm ? `fieldDiffs: ${pm.fieldDiffs.length ? pm.fieldDiffs.join("; ") : "[]"}` : "fieldDiffs: —",
    "",
    "--- storefront display (Rally Shopify preview strip) ---",
    `displayedStorefrontGalleryFirstUrl: ${galleryFirst || "—"}`,
    `displayedStorefrontPrimaryUrl (commerce resolver): ${trimMediaUrl(primary.url) || "—"} (${primary.source})`,
    "",
    "--- flat_back URLs ---",
    `displayedStorefrontFlatBackUrl (variant.flatRenders.flat_blended.back): ${flatU || "—"}`,
    `newestOfficialFlatBackUrl (generatedRenderOutputs official flat_back / flat_blended): ${nFlatUrl || "—"}`,
    `identical: ${idFlat}`,
    `galleryIndexOfDisplayedFlatUrl: ${idxFlat >= 0 ? idxFlat : "null"}`,
    "",
    "--- model_back URLs ---",
    `displayedStorefrontModelBackUrl (variant.flatRenders.model_blended.back): ${modelU || "—"}`,
    `newestOfficialModelBackUrl (generatedRenderOutputs official model_back / model_blended): ${nModelUrl || "—"}`,
    `identical: ${idModel}`,
    `galleryIndexOfDisplayedModelUrl: ${idxModel >= 0 ? idxModel : "null"}`,
    "",
    `media.heroBack (last official job may overwrite): ${heroU || "—"}`,
    "",
    firstDriftHintIfUrlsAligned ? `hint: ${firstDriftHintIfUrlsAligned}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    blendParity,
    displayed: {
      storefrontGalleryUrlsOrdered: galleryTrimmed,
      storefrontGalleryFirstUrl: galleryFirst,
      primaryResolvedUrl: trimMediaUrl(primary.url),
      primaryResolvedSource: primary.source,
      flatBlendedBackUrl: flatU,
      modelBlendedBackUrl: modelU,
      mediaHeroBackUrl: heroU,
    },
    newestOfficial: {
      flat_back: {
        url: nFlatUrl,
        storagePath: nf.row?.storagePath != null ? String(nf.row.storagePath) : null,
        createdAtMs: nf.createdAtMs,
      },
      model_back: {
        url: nModelUrl,
        storagePath: nm.row?.storagePath != null ? String(nm.row.storagePath) : null,
        createdAtMs: nm.createdAtMs,
      },
    },
    identity: {
      flatBlendedBackUrl_equals_newestOfficialFlatBack: idFlat,
      modelBlendedBackUrl_equals_newestOfficialModelBack: idModel,
      mediaHeroBack_equals_newestOfficialFlatBack: urlsEqual(heroU, nFlatUrl),
      mediaHeroBack_equals_newestOfficialModelBack: urlsEqual(heroU, nModelUrl),
      storefrontGalleryFirst_equals_primaryResolved: urlsEqual(galleryFirst, trimMediaUrl(primary.url)),
    },
    firstDriftHintIfUrlsAligned,
    gallery: {
      indexOfFlatBlendedBackUrl: idxFlat >= 0 ? idxFlat : null,
      indexOfModelBlendedBackUrl: idxModel >= 0 ? idxModel : null,
    },
    opsPrintBlock,
  };
}
