import type { DesignDoc, DesignTeam, RPBlank, RpProduct } from "@/lib/types/firestore";

/**
 * Hero template id resolution (architecture-only; hero generation stays dormant until activated).
 *
 * **Conceptual ownership** (baseline → overrides — not the order we loop in code):
 * - **Blank** — baseline / default capability for the garment format
 * - **Team** — brand preference
 * - **Design** — campaign override
 * - **Product** — rare explicit override
 *
 * **Precedence when resolving a single id** (most specific wins; we check in this order):
 * 1. **Product** — `RpProduct.heroTemplateId`
 * 2. **Design** — `DesignDoc.generationOverrides.heroTemplateId`
 * 3. **Team** — `DesignTeam.generationDefaults.preferredHeroTemplateId`
 * 4. **Blank** — `RPBlank.generationDefaults.preferredHeroTemplateId`
 * 5. **Temporary stub only** — `allowedHeroTemplateIds[0]` if no preferred id (see below)
 * 6. **None** — caller applies global fallback or skips hero generation
 *
 * **`allowedHeroTemplateIds[0]` is not long-term selection logic.** It exists only as a temporary
 * development stub until hero UI / proper allowlist semantics (e.g. intersection with resolved template,
 * explicit default index, or no fallback) are defined. Do not rely on array order for production behavior.
 *
 * Future work (not implemented here): load `rp_hero_templates/{id}`, require `isActive`, and filter by
 * `allowedBlankStyleCodes`, `excludedBlankStyleCodes`, `allowedProductCategories`, `allowedLeagueCodes`,
 * `allowedTeamIds`, `requiresRenderedProductImage`, `requiresModelPipeline`, etc.
 */
export type HeroTemplateResolutionSource = "product" | "design" | "team" | "blank" | "blank_allowlist" | "none";

export interface ResolvedHeroTemplateRef {
  templateId: string | null;
  source: HeroTemplateResolutionSource;
  detail?: string;
}

function trimId(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

/**
 * Structural stub: returns the first template id in the precedence list above.
 * Does **not** validate against `rp_hero_templates` or eligibility rules.
 */
export function resolveHeroTemplateId(params: {
  product?: RpProduct | null;
  design?: DesignDoc | null;
  team?: DesignTeam | null;
  blank?: RPBlank | null;
}): ResolvedHeroTemplateRef {
  const p = trimId(params.product?.heroTemplateId);
  if (p) {
    return { templateId: p, source: "product", detail: "rp_products.heroTemplateId" };
  }

  const d = trimId(params.design?.generationOverrides?.heroTemplateId);
  if (d) {
    return { templateId: d, source: "design", detail: "designs.generationOverrides.heroTemplateId" };
  }

  const t = trimId(params.team?.generationDefaults?.preferredHeroTemplateId);
  if (t) {
    return { templateId: t, source: "team", detail: "design_teams.generationDefaults.preferredHeroTemplateId" };
  }

  const b = trimId(params.blank?.generationDefaults?.preferredHeroTemplateId);
  if (b) {
    return { templateId: b, source: "blank", detail: "rp_blanks.generationDefaults.preferredHeroTemplateId" };
  }

  // TEMPORARY STUB: do not treat as production selection — see module JSDoc.
  const allow = params.blank?.generationDefaults?.allowedHeroTemplateIds;
  if (allow && allow.length > 0) {
    const first = trimId(allow[0]);
    if (first) {
      return {
        templateId: first,
        source: "blank_allowlist",
        detail:
          "TEMP STUB: allowedHeroTemplateIds[0] only — replace with real allowlist/default rules before hero generation ships",
      };
    }
  }

  return { templateId: null, source: "none", detail: "No hero template id in chain" };
}
