/**
 * Build review rows from parsed accepted files + existing designs for bulk upload.
 */

import type { DesignDoc } from "@/lib/types/firestore";
import type { DesignTeam } from "@/lib/types/firestore";
import { groupParsedFiles, parseDesignFilename, type ParseResult } from "@/lib/batchImport/parseDesignFilename";
import { inferIdentityFromDesignKey, identityKeyToSlug } from "@/lib/bulkDesignUpload/inferIdentity";
import { matchDesignTeam } from "@/lib/bulkDesignUpload/matchTeam";
import {
  coverageFromKind,
  emptyCoverage,
  hasAnyPng,
  type AssetCoverageKey,
} from "@/lib/bulkDesignUpload/assetSlots";
import type { DesignFileKind } from "@/lib/designs/designAssetKinds";

export type BulkImportItemAction = "create" | "update" | "skip" | "blocked";

export interface BulkReviewFileEntry {
  file: File;
  kind: DesignFileKind;
  originalName: string;
  filenameLegacySide: "front" | "back" | null;
}

export interface BulkReviewItem {
  groupKey: string;
  slug: string;
  designName: string;
  leagueCode: string;
  teamId: string | null;
  teamName: string | null;
  teamCode: string | null;
  themeCode: string | null;
  themeName: string | null;
  designSeries: string | null;
  designType: DesignDoc["designType"];
  files: BulkReviewFileEntry[];
  assetCoverage: Record<AssetCoverageKey, boolean>;
  warnings: string[];
  errors: string[];
  action: BulkImportItemAction;
  existingDesignId: string | null;
  /** Kind → would overwrite existing non-null asset URL */
  overwriteWarnings: Partial<Record<AssetCoverageKey, boolean>>;
  /** Duplicate files targeting same kind in one group */
  duplicateKindConflicts: boolean;
}

function buildDesignName(
  inferred: ReturnType<typeof inferIdentityFromDesignKey>,
  parsedTeamLabel: string,
  teamDisplay: string | null
): string {
  const team = teamDisplay || humanizeSlug(parsedTeamLabel || inferred.teamSlugCandidate);
  if (inferred.designType === "city_69" && inferred.themeDisplayName) {
    return `${team} ${inferred.themeDisplayName}`.trim();
  }
  if (inferred.themeDisplayName) {
    return `${team} ${inferred.themeDisplayName}`.trim();
  }
  return team || "Untitled design";
}

function humanizeSlug(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function findExistingDesign(
  designs: DesignDoc[],
  groupKey: string,
  slug: string,
  leagueCode: string | null,
  teamId: string | null,
  themeCode: string | null,
  designSeries: string | null
): DesignDoc | null {
  const byImport = designs.find((d) => d.importKey === groupKey);
  if (byImport) return byImport;
  const bySlug = designs.find((d) => d.slug?.toLowerCase() === slug.toLowerCase());
  if (bySlug) return bySlug;
  return (
    designs.find(
      (d) =>
        d.leagueCode === leagueCode &&
        d.teamId === teamId &&
        (d.themeCode === themeCode || (!themeCode && !d.themeCode)) &&
        (d.designSeries === designSeries || (!designSeries && !d.designSeries))
    ) ?? null
  );
}

function assetKeyToFilesField(key: AssetCoverageKey): keyof NonNullable<DesignDoc["files"]> | null {
  const m: Record<AssetCoverageKey, string> = {
    hasLightPng: "lightPng",
    hasDarkPng: "darkPng",
    hasWhitePng: "whitePng",
    hasLightSvg: "lightSvg",
    hasDarkSvg: "darkSvg",
    hasWhiteSvg: "whiteSvg",
    hasLightPdf: "lightPdf",
    hasDarkPdf: "darkPdf",
    hasWhitePdf: "whitePdf",
  };
  return (m[key] as keyof NonNullable<DesignDoc["files"]>) ?? null;
}

function computeOverwriteWarnings(
  existing: DesignDoc | null,
  coverage: Record<AssetCoverageKey, boolean>
): Partial<Record<AssetCoverageKey, boolean>> {
  if (!existing?.files) return {};
  const out: Partial<Record<AssetCoverageKey, boolean>> = {};
  const f = existing.files;
  for (const key of Object.keys(coverage) as AssetCoverageKey[]) {
    if (!coverage[key]) continue;
    const slot = assetKeyToFilesField(key);
    if (!slot) continue;
    const entry = f[slot as keyof typeof f] as { downloadUrl?: string } | undefined;
    if (entry?.downloadUrl) out[key] = true;
  }
  return out;
}

export function buildBulkReviewItems(
  accepted: { file: File; ext: string }[],
  designs: DesignDoc[],
  teams: DesignTeam[]
): { items: BulkReviewItem[]; parseFailures: { name: string; message: string }[] } {
  const parseFailures: { name: string; message: string }[] = [];
  const results: Array<{ file: File; result: ParseResult }> = [];

  for (const { file, ext } of accepted) {
    const result = parseDesignFilename(file.name);
    if (result.status !== "valid" || !result.parsed) {
      parseFailures.push({
        name: file.name,
        message: result.message || result.status,
      });
      continue;
    }
    if (result.parsed.extension !== ext) {
      parseFailures.push({ name: file.name, message: "Extension mismatch" });
      continue;
    }
    results.push({ file, result });
  }

  const grouped = groupParsedFiles(results);
  const items: BulkReviewItem[] = [];

  for (const [, row] of grouped) {
    const groupKey = row.designKey;
    const inferred = inferIdentityFromDesignKey(groupKey);
    const parsed = row.parsed;
    const teamSlugForMatch =
      inferred.designType === "city_69"
        ? inferred.teamSlugCandidate
        : parsed.team || inferred.teamSlugCandidate;
    const { team, warnings: teamWarnings } = matchDesignTeam(teamSlugForMatch, teams);

    const teamDisplay = team?.name ?? null;
    const teamId = team?.id ?? null;
    const teamCode = team?.teamCode ?? null;
    const leagueCode = team?.leagueCode ?? team?.leagueId ?? inferred.leagueCode;

    const themeCode =
      inferred.themeSlugCandidate?.toUpperCase().replace(/[^A-Z0-9_]/g, "_") ||
      parsed.designFamily?.toUpperCase() ||
      null;
    const themeName =
      inferred.designType === "city_69"
        ? inferred.themeDisplayName
        : humanizeSlug(parsed.designFamily || inferred.themeSlugCandidate || "");

    const designSeries =
      inferred.designSeriesCandidate || (parsed.designFamily === "city_69" ? "69" : null);

    const designName =
      inferred.designType === "city_69"
        ? buildDesignName(inferred, parsed.team, teamDisplay)
        : teamDisplay
          ? `${teamDisplay} ${humanizeSlug(parsed.designFamily || "")}`.trim()
          : humanizeSlug(`${parsed.designFamily}_${parsed.team}`.replace(/^_+|_+$/g, ""));

    const slug = identityKeyToSlug(groupKey);

    const files: BulkReviewFileEntry[] = [];
    const coverage = emptyCoverage();
    const kindCounts = new Map<DesignFileKind, number>();
    let duplicateKindConflicts = false;

    for (const f of row.files) {
      const k = f.kind;
      kindCounts.set(k, (kindCounts.get(k) || 0) + 1);
      if (kindCounts.get(k)! > 1) duplicateKindConflicts = true;
      const cov = coverageFromKind(k);
      if (cov) coverage[cov] = true;
      files.push({
        file: f.file,
        kind: k,
        originalName: f.file.name,
        filenameLegacySide: f.filenameLegacySide,
      });
    }

    const warnings: string[] = [...teamWarnings];
    if (files.some((x) => x.filenameLegacySide)) {
      warnings.push("Legacy _front_/_back_ segment in filename (ignored for placement)");
    }
    if (duplicateKindConflicts) {
      warnings.push("Duplicate file for same tone/format in group — resolve before import");
    }

    const errors: string[] = [];
    if (!hasAnyPng(coverage)) {
      errors.push("No PNG artwork — design is not render-ready (SVG/PDF only)");
    }

    const existing = findExistingDesign(
      designs,
      groupKey,
      slug,
      leagueCode ?? null,
      teamId,
      themeCode,
      designSeries
    );

    let action: BulkImportItemAction = "create";
    if (errors.length > 0 && !hasAnyPng(coverage)) {
      action = "blocked";
    } else if (existing) {
      action = "update";
    }

    const overwriteWarnings = computeOverwriteWarnings(existing, coverage);

    items.push({
      groupKey,
      slug,
      designName,
      leagueCode: leagueCode || inferred.leagueCode,
      teamId,
      teamName: teamDisplay,
      teamCode,
      themeCode,
      themeName: themeName || null,
      designSeries,
      designType: inferred.designType,
      files,
      assetCoverage: coverage,
      warnings,
      errors,
      action,
      existingDesignId: existing?.id ?? null,
      overwriteWarnings,
      duplicateKindConflicts,
    });
  }

  return { items, parseFailures };
}
