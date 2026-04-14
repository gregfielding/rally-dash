/**
 * Resolve team catalog rows + status labels for Generate Team Products (design → team matrix → SKUs).
 */

import { getPlacementRowForSide } from "@/lib/products/resolveProductRenderProfile";
import {
  resolveLeagueCodeRawForProductIdentity,
  resolveTeamCodeRawForProductIdentity,
} from "@/lib/products/productIdentityCodes";
import { buildParentProductIdentityKey, buildProductIdentityKey } from "@/lib/products/staleness";
import { designHasUsablePng } from "@/lib/designs/designHelpers";
import { isTeamEligibleForVariant } from "@/lib/teams/teamProductMatrixHints";
import { getBlankVariants, isMasterBlank, variantHasFrontBack } from "@/lib/blanks";
import type {
  DesignDoc,
  DesignTeam,
  RPBlank,
  RPBlankVariant,
  RpProduct,
  TeamCatalogBlankEntry,
} from "@/lib/types/firestore";

export type TeamGenerateStatusLabel =
  | "Ready"
  | "Already exists"
  | "Excluded by team"
  | "Blocked by eligibility"
  | "Missing blank images"
  | "Missing design asset"
  | "Missing render profile"
  | "Inactive blank"
  | "Inactive variant";

export interface TeamGenerateVariantRow {
  variantId: string;
  colorName: string;
  colorHex?: string | null;
  /** In team's approvedVariantIds for this blank */
  approved: boolean;
  status: TeamGenerateStatusLabel;
  productIdentityKey: string;
  existingProductId?: string;
  existingSlug?: string;
}

export interface TeamGenerateBlankGroup {
  blankId: string;
  styleLabel: string;
  blank: RPBlank | null;
  matrixEntry: TeamCatalogBlankEntry | null;
  rows: TeamGenerateVariantRow[];
}

/** Match Cloud Function createProductFromDesignBlank identity logic. */
export function computeProductIdentityKeyForCatalogRow(
  design: DesignDoc,
  team: DesignTeam,
  blank: RPBlank,
  variantIdOrLegacy: string
): string {
  const leagueCodeRaw = resolveLeagueCodeRawForProductIdentity(design, team);
  const teamCodeRaw = resolveTeamCodeRawForProductIdentity(design, team);
  return buildProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId: design.id,
    blankId: blank.blankId,
    blankVariantIdOrLegacy: variantIdOrLegacy,
  });
}

export function computeParentProductIdentityKeyForCatalogRow(
  design: DesignDoc,
  team: DesignTeam,
  blank: RPBlank
): string {
  const leagueCodeRaw = resolveLeagueCodeRawForProductIdentity(design, team);
  const teamCodeRaw = resolveTeamCodeRawForProductIdentity(design, team);
  return buildParentProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId: design.id,
    blankId: blank.blankId,
  });
}

/** Indexes for dedupe: legacy per-color docs + parent + variant rows under parent. */
export interface TeamGenerateExistingLookup {
  legacyByFullKey: Map<string, { id: string; slug: string }>;
  parentByParentKey: Map<string, { id: string; slug: string }>;
  /** parentId → blankVariantIds that already have a variant subcollection doc */
  variantBlankIdsByParent: Map<string, Set<string>>;
}

export function buildTeamGenerateExistingLookup(products: RpProduct[]): TeamGenerateExistingLookup {
  const legacyByFullKey = new Map<string, { id: string; slug: string }>();
  const parentByParentKey = new Map<string, { id: string; slug: string }>();
  const variantBlankIdsByParent = new Map<string, Set<string>>();

  for (const p of products) {
    const id = p.id;
    const slug = p.slug;
    if (!id || !slug) continue;

    if (p.productKind === "parent" && p.parentProductIdentityKey?.trim()) {
      parentByParentKey.set(p.parentProductIdentityKey.trim(), { id, slug });
      const set = new Set<string>();
      for (const row of p.variantSummary ?? []) {
        if (row.blankVariantId) set.add(row.blankVariantId);
      }
      variantBlankIdsByParent.set(id, set);
      continue;
    }

    const k = p.productIdentityKey?.trim();
    if (k) {
      if (!legacyByFullKey.has(k)) legacyByFullKey.set(k, { id, slug });
    }
  }

  return { legacyByFullKey, parentByParentKey, variantBlankIdsByParent };
}

function variantHasRenderableImages(blank: RPBlank, v: RPBlankVariant): boolean {
  const { front, back } = variantHasFrontBack(v);
  if (front || back) return true;
  if (!isMasterBlank(blank)) {
    return !!(blank.images?.front?.downloadUrl || blank.images?.back?.downloadUrl);
  }
  return false;
}

function blankHasRenderProfile(blank: RPBlank): boolean {
  return getPlacementRowForSide(blank, "front") != null || getPlacementRowForSide(blank, "back") != null;
}

function resolveStatusForApprovedVariant(params: {
  design: DesignDoc;
  team: DesignTeam;
  blank: RPBlank;
  variant: RPBlankVariant;
  existing: TeamGenerateExistingLookup;
}): Omit<TeamGenerateVariantRow, "variantId" | "colorName" | "colorHex" | "approved"> {
  const { design, team, blank, variant, existing } = params;

  const variantIdOrLegacy =
    isMasterBlank(blank) && variant.variantId ? variant.variantId : "legacy";
  const productIdentityKey = computeProductIdentityKeyForCatalogRow(design, team, blank, variantIdOrLegacy);
  const parentKey = computeParentProductIdentityKeyForCatalogRow(design, team, blank);

  if (blank.status && blank.status !== "active") {
    return { status: "Inactive blank", productIdentityKey };
  }
  if (variant.isActive === false) {
    return { status: "Inactive variant", productIdentityKey };
  }
  if (!isTeamEligibleForVariant(team, blank, variant)) {
    return { status: "Blocked by eligibility", productIdentityKey };
  }

  if (!designHasUsablePng(design)) {
    return { status: "Missing design asset", productIdentityKey };
  }

  if (!blankHasRenderProfile(blank)) {
    return { status: "Missing render profile", productIdentityKey };
  }

  if (!variantHasRenderableImages(blank, variant)) {
    return { status: "Missing blank images", productIdentityKey };
  }

  const legacyHit = existing.legacyByFullKey.get(productIdentityKey);
  if (legacyHit) {
    return {
      status: "Already exists",
      productIdentityKey,
      existingProductId: legacyHit.id,
      existingSlug: legacyHit.slug,
    };
  }

  const parentHit = existing.parentByParentKey.get(parentKey);
  if (parentHit) {
    const set = existing.variantBlankIdsByParent.get(parentHit.id);
    if (set?.has(variant.variantId)) {
      return {
        status: "Already exists",
        productIdentityKey,
        existingProductId: parentHit.id,
        existingSlug: parentHit.slug,
      };
    }
  }

  return { status: "Ready", productIdentityKey };
}

/**
 * Build review groups: every blank key in the matrix, all active variants listed.
 * Variants not in approvedVariantIds → Excluded by team (unless whole blank is disabled → all excluded).
 */
export function buildTeamGenerateReview(
  design: DesignDoc,
  team: DesignTeam,
  matrix: Record<string, TeamCatalogBlankEntry> | null | undefined,
  blanksById: Record<string, RPBlank | null | undefined>,
  existing: TeamGenerateExistingLookup
): TeamGenerateBlankGroup[] {
  const entries = Object.entries(matrix ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const groups: TeamGenerateBlankGroup[] = [];

  for (const [blankId, entry] of entries) {
    const blank = blanksById[blankId] ?? null;
    const variants = blank ? getBlankVariants(blank).filter((v) => v.isActive !== false) : [];
    const approvedSet = new Set(entry.approvedVariantIds ?? []);
    const styleLabel = blank
      ? `${blank.styleCode} — ${blank.garmentStyle || blank.styleName}`.trim()
      : blankId;

    const rows: TeamGenerateVariantRow[] = [];

    if (!blank) {
      for (const vid of entry.approvedVariantIds ?? []) {
        rows.push({
          variantId: vid,
          colorName: vid,
          colorHex: null,
          approved: true,
          status: "Inactive blank",
          productIdentityKey: "",
        });
      }
      groups.push({
        blankId,
        styleLabel,
        blank: null,
        matrixEntry: entry,
        rows,
      });
      continue;
    }

    const wholeExcluded = entry.enabled === false;
    const seenVariantIds = new Set<string>();

    for (const v of variants) {
      seenVariantIds.add(v.variantId);
      const approved = approvedSet.has(v.variantId);
      const variantIdOrLegacy =
        isMasterBlank(blank) && v.variantId ? v.variantId : "legacy";
      const productIdentityKey = computeProductIdentityKeyForCatalogRow(design, team, blank, variantIdOrLegacy);

      if (wholeExcluded || !approved) {
        rows.push({
          variantId: v.variantId,
          colorName: v.colorName,
          colorHex: v.colorHex,
          approved,
          status: "Excluded by team",
          productIdentityKey,
        });
        continue;
      }

      const rest = resolveStatusForApprovedVariant({
        design,
        team,
        blank,
        variant: v,
        existing,
      });
      rows.push({
        variantId: v.variantId,
        colorName: v.colorName,
        colorHex: v.colorHex,
        approved: true,
        ...rest,
      });
    }

    if (!wholeExcluded) {
      for (const vid of approvedSet) {
        if (seenVariantIds.has(vid)) continue;
        const variantIdOrLegacy = isMasterBlank(blank) ? vid : "legacy";
        const productIdentityKey = computeProductIdentityKeyForCatalogRow(design, team, blank, variantIdOrLegacy);
        rows.push({
          variantId: vid,
          colorName: "(variant missing on blank)",
          colorHex: null,
          approved: true,
          status: "Inactive variant",
          productIdentityKey,
        });
      }
    }

    groups.push({
      blankId,
      styleLabel,
      blank,
      matrixEntry: entry,
      rows,
    });
  }

  return groups;
}

/** @deprecated Use buildTeamGenerateExistingLookup */
export function indexProductsByIdentityKey(
  products: { id?: string; productIdentityKey?: string | null; slug?: string }[]
): Map<string, { id: string; slug: string }> {
  const m = new Map<string, { id: string; slug: string }>();
  for (const p of products) {
    const k = p.productIdentityKey?.trim();
    const id = p.id;
    const slug = p.slug;
    if (!k || !id || !slug) continue;
    if (!m.has(k)) m.set(k, { id, slug });
  }
  return m;
}

export function summarizeTeamGenerate(groups: TeamGenerateBlankGroup[]): {
  approvedCombinations: number;
  ready: number;
  alreadyExists: number;
  blocked: number;
} {
  let approvedCombinations = 0;
  let ready = 0;
  let alreadyExists = 0;
  let blocked = 0;

  for (const g of groups) {
    for (const r of g.rows) {
      if (r.approved) approvedCombinations += 1;
      if (r.status === "Ready") {
        ready += 1;
      } else if (r.status === "Already exists") {
        alreadyExists += 1;
      } else if (r.approved && r.status !== "Excluded by team") {
        blocked += 1;
      }
    }
  }

  return { approvedCombinations, ready, alreadyExists, blocked };
}
