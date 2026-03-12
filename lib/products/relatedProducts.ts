/**
 * Taxonomy-driven related products: score candidates by similarity
 * and return top N. Fully client-side; uses existing product fields.
 *
 * Priority: same teamCode > themeCode > leagueCode > sportCode > category > blankId.
 */

import type { RpProduct } from "@/lib/types/firestore";

const WEIGHTS = {
  teamCode: 100,
  themeCode: 80,
  leagueCode: 50,
  sportCode: 30,
  category: 20,
  blankId: 25,
} as const;

function hasValue(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!hasValue(a) || !hasValue(b)) return false;
  return a!.trim().toLowerCase() === b!.trim().toLowerCase();
}

const REASON_LABELS: Record<keyof typeof WEIGHTS, string> = {
  teamCode: "same team",
  themeCode: "same theme",
  leagueCode: "same league",
  sportCode: "same sport",
  category: "same category",
  blankId: "same garment",
};

/**
 * Score a candidate product against the current product and collect reason labels.
 * Excludes the current product (caller should pass candidates that may include it).
 */
function scoreAndReasons(current: RpProduct, candidate: RpProduct): { score: number; reasons: string[] } {
  if (current.id && candidate.id && current.id === candidate.id) return { score: -1, reasons: [] };
  if (current.slug && candidate.slug && current.slug === candidate.slug) return { score: -1, reasons: [] };

  let score = 0;
  const reasons: string[] = [];
  if (eq(current.teamCode, candidate.teamCode)) {
    score += WEIGHTS.teamCode;
    reasons.push(REASON_LABELS.teamCode);
  }
  if (eq(current.themeCode, candidate.themeCode)) {
    score += WEIGHTS.themeCode;
    reasons.push(REASON_LABELS.themeCode);
  }
  if (eq(current.leagueCode, candidate.leagueCode)) {
    score += WEIGHTS.leagueCode;
    reasons.push(REASON_LABELS.leagueCode);
  }
  if (eq(current.sportCode, candidate.sportCode)) {
    score += WEIGHTS.sportCode;
    reasons.push(REASON_LABELS.sportCode);
  }
  if (current.category && candidate.category && current.category === candidate.category) {
    score += WEIGHTS.category;
    reasons.push(REASON_LABELS.category);
  }
  if (hasValue(current.blankId) && hasValue(candidate.blankId) && current.blankId === candidate.blankId) {
    score += WEIGHTS.blankId;
    reasons.push(REASON_LABELS.blankId);
  }
  return { score, reasons };
}

/** Tie-breaker: prefer products with hero media (heroFront > heroBack > none) for merchandisable display. */
function mediaTieBreaker(p: RpProduct): number {
  if (hasValue(p.media?.heroFront)) return 2;
  if (hasValue(p.media?.heroBack)) return 1;
  return 0;
}

export interface RelatedProductWithReasons {
  product: RpProduct;
  reasons: string[];
}

/**
 * Returns up to `limit` related products with reason lists, ordered by similarity (highest first).
 * Excludes the current product. Pure function; no I/O.
 */
export function getRelatedProducts(
  currentProduct: RpProduct,
  candidates: RpProduct[],
  limit: number = 8
): RelatedProductWithReasons[] {
  const currentId = currentProduct.id;
  const currentSlug = currentProduct.slug;

  const scored = candidates
    .filter((p) => p.id !== currentId && p.slug !== currentSlug)
    .map((p) => ({ product: p, ...scoreAndReasons(currentProduct, p), mediaScore: mediaTieBreaker(p) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.mediaScore - a.mediaScore);

  return scored.slice(0, limit).map(({ product, reasons }) => ({ product, reasons }));
}
