/**
 * Blank template resolution for product creation.
 * Tokens: {teamName}, {designName}, {colorName}, {garmentStyle}, {category}, {brand}, {vendor}, {league}, {city},
 *         {stadiumName}, {teamSaying}, {fanPhrase} (from Team metadata).
 * Resolve deterministically at product creation.
 */

import type { RPBlank } from "@/lib/types/firestore";

export interface BlankTemplateContext {
  teamName?: string | null;
  designName?: string | null;
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
}

const TOKEN_KEYS = [
  "teamName",
  "designName",
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
] as const;

function replaceTokens(template: string, context: BlankTemplateContext): string {
  let out = template;
  for (const key of TOKEN_KEYS) {
    const value = context[key] ?? "";
    const str = typeof value === "string" ? value : String(value);
    const regex = new RegExp(`\\{${key}\\}`, "gi");
    out = out.replace(regex, str);
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
    colorName: String(colorName),
    garmentStyle: String(garmentStyle),
    category: String(category),
    brand: String(brand),
    vendor: String(brand),
  };

  const title =
    blank.titleTemplate != null && blank.titleTemplate.trim()
      ? replaceTokens(blank.titleTemplate, fullContext)
      : "";
  const description =
    blank.descriptionTemplate != null && blank.descriptionTemplate.trim()
      ? replaceTokens(blank.descriptionTemplate, fullContext)
      : "";

  const tags: string[] = [];
  if (Array.isArray(blank.tagTemplates) && blank.tagTemplates.length > 0) {
    const seen = new Set<string>();
    for (const t of blank.tagTemplates) {
      if (typeof t !== "string" || !t.trim()) continue;
      const resolved = replaceTokens(t, fullContext);
      if (!resolved) continue;
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(resolved);
    }
  }

  return { title, description, tags };
}
