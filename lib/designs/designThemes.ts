/**
 * Design "theme" (concept / campaign) — stored on `DesignDoc.designType` in Firestore for backward compatibility.
 * Not the same as visual style (wordmark vs script); that may be a separate field later.
 */

import type { DesignDesignType, DesignThemeValue } from "@/lib/types/firestore";

/** Canonical options for create/edit selects and filters */
export const DESIGN_THEME_OPTIONS: { value: DesignDesignType; label: string }[] = [
  { value: "city_69", label: "City 69" },
  { value: "slogan", label: "Slogan" },
  { value: "stadium", label: "Stadium" },
  { value: "rivalry", label: "Rivalry" },
  { value: "number", label: "Number" },
  { value: "wordplay", label: "Wordplay" },
  { value: "badge_crest", label: "Badge / Crest" },
  { value: "custom_one_off", label: "Custom / One-off" },
];

const LABELS: Record<string, string> = {
  city_69: "City 69",
  slogan: "Slogan",
  stadium: "Stadium",
  rivalry: "Rivalry",
  number: "Number",
  wordplay: "Wordplay",
  badge_crest: "Badge / Crest",
  custom_one_off: "Custom / One-off",
  // Legacy `designType` values still in Firestore
  wordmark: "Wordmark (legacy)",
  script: "Script (legacy)",
  other: "Other (legacy)",
  badge: "Badge (legacy)",
};

/** All known theme keys → human label (canonical + legacy). */
export const DESIGN_THEME_LABELS: Record<string, string> = { ...LABELS };

export const DESIGN_THEME_CANONICAL_SET = new Set<string>(
  DESIGN_THEME_OPTIONS.map((o) => o.value)
);

export function isCanonicalDesignTheme(v: string): v is DesignDesignType {
  return DESIGN_THEME_CANONICAL_SET.has(v);
}

/** Table / chips / tags */
export function designThemeLabel(v: DesignThemeValue | string | null | undefined): string {
  if (v == null || v === "") return "—";
  return LABELS[v] ?? String(v);
}
