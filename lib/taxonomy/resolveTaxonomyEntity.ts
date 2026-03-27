import type { RpTaxonomyEntity } from "@/lib/types/firestore";
import { canonicalTeamSlugFromFullTeamName } from "@/lib/products/canonicalTeamSlug";

/**
 * Resolve a stored entity id, legacy alias, or canonical team slug (`slugify(full official name)`) to a taxonomy entity row.
 */
export function resolveTaxonomyEntity(
  teamIdOrAlias: string | null | undefined,
  entities: RpTaxonomyEntity[]
): RpTaxonomyEntity | null {
  if (!teamIdOrAlias?.trim()) return null;
  const t = teamIdOrAlias.trim();
  const byCode = entities.find((e) => e.code === t);
  if (byCode) return byCode;
  const low = t.toLowerCase();
  const byCanonical = entities.find((e) => {
    const c = canonicalTeamSlugFromFullTeamName(e.name);
    return c != null && c === low;
  });
  if (byCanonical) return byCanonical;
  return entities.find((e) => e.aliases?.some((a) => (a || "").toLowerCase() === low)) ?? null;
}
