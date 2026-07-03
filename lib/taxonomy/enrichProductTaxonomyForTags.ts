/**
 * Merge Product tab taxonomy form + linked blank into a full RpTaxonomyDisplay row and rebuild tags (spec overwrite).
 */

import {
  buildProductTags,
  buildProductTypeForTags,
  slugifyUnderscore,
  tagsNormalizedFromTags,
} from "@/lib/products/buildProductTags";
import {
  canonicalTeamSlugFromFullTeamName,
  canonicalTeamSlugFromTaxonomy,
} from "@/lib/products/canonicalTeamSlug";
import { resolveTaxonomyEntity } from "@/lib/taxonomy/resolveTaxonomyEntity";
import type {
  RpTaxonomyDisplay,
  RpTaxonomyEntity,
  RpTaxonomyLeague,
  RpTaxonomySport,
  RpTaxonomyTheme,
  RpProduct,
  RPBlank,
} from "@/lib/types/firestore";

export interface TaxonomyFormForTags {
  taxSportCode: string | null;
  taxLeagueCode: string | null;
  taxTeamId: string | null;
  taxThemeCode: string | null;
  taxDesignFamily: string | null;
}

export function enrichTaxonomyAndTagsForSave(
  product: RpProduct,
  form: TaxonomyFormForTags,
  sports: RpTaxonomySport[],
  leagues: RpTaxonomyLeague[],
  entities: RpTaxonomyEntity[],
  themes: RpTaxonomyTheme[],
  blank: RPBlank | null | undefined
): { taxonomy: RpTaxonomyDisplay; tags: string[]; tagsNormalized: string[] } {
  const prev = product.taxonomy ?? {};
  const sport = sports.find((s) => s.code === form.taxSportCode) ?? null;
  const league = leagues.find((l) => l.code === form.taxLeagueCode) ?? null;
  const ent = resolveTaxonomyEntity(form.taxTeamId, entities);
  const theme = themes.find((th) => th.code === form.taxThemeCode) ?? null;

  const teamName = ent?.name ?? product.teamName ?? prev.teamName ?? null;
  const cityFromMeta = ent?.metadata?.city?.trim() || prev.teamCity || prev.cityName || null;
  const inferredCity = (() => {
    if (cityFromMeta) return cityFromMeta;
    if (!teamName?.trim()) return null;
    const parts = teamName.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts
      .slice(0, -1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  })();
  const cityName = inferredCity;
  const citySlug = cityName ? slugifyUnderscore(cityName) : prev.citySlug ?? null;

  const teamSlug =
    (ent?.name ? canonicalTeamSlugFromFullTeamName(ent.name) : null) ??
    canonicalTeamSlugFromTaxonomy({
      ...prev,
      teamName: teamName ?? undefined,
      cityName: cityName ?? undefined,
      citySlug: citySlug ?? undefined,
      teamCity: cityName ?? prev.teamCity ?? undefined,
      teamNickname: ent?.metadata?.nickname ?? prev.teamNickname ?? undefined,
    }) ??
    (prev.teamSlug != null && String(prev.teamSlug).trim() ? String(prev.teamSlug).trim() : null);

  const pt = buildProductTypeForTags(blank ?? null);

  const taxonomy: RpTaxonomyDisplay = {
    ...prev,
    sportName: sport?.name ?? prev.sportName,
    leagueName: league?.name ?? prev.leagueName,
    teamName: teamName ?? undefined,
    teamId: teamSlug ?? undefined,
    teamCity: cityName ?? prev.teamCity ?? undefined,
    teamNickname: ent?.metadata?.nickname ?? prev.teamNickname,
    teamCode: ent?.code ?? product.teamCode ?? prev.teamCode,
    themeName: theme?.name ?? prev.themeName,
    themeCode: form.taxThemeCode ?? prev.themeCode,
    designFamily: form.taxDesignFamily ?? prev.designFamily,
    cityName: cityName ?? undefined,
    citySlug: citySlug ?? undefined,
    teamSlug: teamSlug ?? undefined,
    leagueCode: form.taxLeagueCode ?? prev.leagueCode,
    sportCode: form.taxSportCode ?? prev.sportCode,
    productTypeName: pt.productTypeName,
    productTypeSlug: pt.productTypeSlug,
  };

  const tags = buildProductTags({
    taxonomy,
    sportCode: form.taxSportCode ?? product.sportCode ?? null,
    leagueCode: form.taxLeagueCode ?? product.leagueCode ?? null,
    themeCode: form.taxThemeCode ?? product.themeCode ?? null,
    /** Preserve color/garment tags on taxonomy re-save — these aren't in the form; sourced from the doc. */
    accentColor: product.accentColor ?? null,
    garmentColors: product.garmentColors ?? null,
  });
  const tagsNormalized = tagsNormalizedFromTags(tags);

  return { taxonomy, tags, tagsNormalized };
}
