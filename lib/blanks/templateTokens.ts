/**
 * Blank template resolution for product creation.
 * Supports {token} and {{token}}. Canonical keys plus aliases (teamCity → city, designStyle → design theme label).
 * After substitution, strips remaining template artifacts so stored values are never template source.
 */

import type { RPBlank } from "@/lib/types/firestore";

export interface BlankTemplateContext {
  teamName?: string | null;
  /** Full team display name (e.g. San Francisco Giants); storefront titles */
  teamNameFull?: string | null;
  designName?: string | null;
  /** Storefront short design label (e.g. 69); internal name may be richer */
  designShortName?: string | null;
  colorName?: string | null;
  garmentStyle?: string | null;
  category?: string | null;
  /** Shopify brand (same source as shopifyDefaults.brand) */
  brand?: string | null;
  /** @deprecated Alias of brand in templates */
  vendor?: string | null;
  league?: string | null;
  city?: string | null;
  /** From Team (e.g. "Oracle Park", "FedExForum") */
  stadiumName?: string | null;
  /** From Team (e.g. "Whoop That Trick") */
  teamSaying?: string | null;
  /** From Team fan/culture phrase */
  fanPhrase?: string | null;
  /** Human label for design theme (e.g. "City 69") */
  designThemeLabel?: string | null;
  /** Raw designType key (e.g. city_69) */
  designTheme?: string | null;
  /** Kebab theme slug (e.g. city-69) */
  designThemeSlug?: string | null;
  /** Alias of design theme label for legacy templates */
  designStyle?: string | null;
  /** Alias of city for legacy templates (e.g. {{teamCity}}) */
  teamCity?: string | null;
}

const BASE_KEYS = [
  "teamName",
  "teamNameFull",
  "designName",
  "designShortName",
  "colorName",
  "garmentStyle",
  "category",
  "brand",
  "vendor",
  "league",
  "city",
  "stadiumName",
  "teamSaying",
  "fanPhrase",
  "designThemeSlug",
  "designTheme",
  "designStyle",
  "teamCity",
] as const;

export function stripUnresolvedTemplateArtifacts(template: string): string {
  let out = String(template);
  out = out.replace(/\{\{[^{}]+\}\}/g, "");
  out = out.replace(/\{[^{}]+\}/g, "");
  return out.replace(/\s+/g, " ").trim();
}

function replaceTokens(template: string, context: BlankTemplateContext): string {
  let out = template;
  const keys = [...BASE_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const value = (context as Record<string, string | null | undefined>)[key] ?? "";
    const str = typeof value === "string" ? value : String(value);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "gi"), str);
    out = out.replace(new RegExp(`\\{${escaped}\\}`, "gi"), str);
  }
  return out.replace(/\s+/g, " ").trim();
}

export interface ResolvedBlankTemplates {
  title: string;
  description: string;
  tags: string[];
}

/**
 * Resolve Blank title, description, and tag templates with context.
 * Used at product creation (and optional "apply defaults" on existing product).
 */
export function resolveBlankTemplates(
  blank: Pick<
    RPBlank,
    | "titleTemplate"
    | "descriptionTemplate"
    | "tagTemplates"
    | "colorName"
    | "styleName"
    | "styleCode"
    | "garmentStyle"
    | "garmentCategory"
    | "category"
    | "shopifyDefaults"
  >,
  context: BlankTemplateContext
): ResolvedBlankTemplates {
  const colorName = context.colorName ?? blank.colorName ?? "";
  const garmentStyle = blank.garmentStyle ?? blank.styleName ?? blank.styleCode ?? context.garmentStyle ?? "";
  const category =
    blank.shopifyDefaults?.productType ?? blank.category ?? blank.garmentCategory ?? context.category ?? "";
  const brand =
    blank.shopifyDefaults?.brand ??
    blank.shopifyDefaults?.vendor ??
    context.brand ??
    context.vendor ??
    "";

  const fullContext: BlankTemplateContext = {
    ...context,
    teamNameFull:
      context.teamNameFull != null && String(context.teamNameFull).trim()
        ? String(context.teamNameFull)
        : context.teamName != null
          ? String(context.teamName)
          : "",
    designShortName:
      context.designShortName != null && String(context.designShortName).trim()
        ? String(context.designShortName)
        : "",
    colorName: String(colorName),
    garmentStyle: String(garmentStyle),
    category: String(category),
    brand: String(brand),
    vendor: String(brand),
    teamCity: context.teamCity != null ? String(context.teamCity) : context.city != null ? String(context.city) : "",
    designStyle:
      context.designStyle != null && String(context.designStyle).trim()
        ? String(context.designStyle)
        : context.designThemeLabel != null
          ? String(context.designThemeLabel)
          : "",
  };

  const rawTitle =
    blank.titleTemplate != null && blank.titleTemplate.trim()
      ? replaceTokens(blank.titleTemplate, fullContext)
      : "";
  const rawDescription =
    blank.descriptionTemplate != null && blank.descriptionTemplate.trim()
      ? replaceTokens(blank.descriptionTemplate, fullContext)
      : "";

  const title = stripUnresolvedTemplateArtifacts(rawTitle);
  const description = stripUnresolvedTemplateArtifacts(rawDescription);

  const tags: string[] = [];
  if (Array.isArray(blank.tagTemplates) && blank.tagTemplates.length > 0) {
    const seen = new Set<string>();
    for (const t of blank.tagTemplates) {
      if (typeof t !== "string" || !t.trim()) continue;
      const resolved = stripUnresolvedTemplateArtifacts(replaceTokens(t, fullContext));
      if (!resolved) continue;
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(resolved);
    }
  }

  return { title, description, tags };
}
