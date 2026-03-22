import type { DesignSystemCmyk, DesignSystemPaletteColor } from "@/lib/types/firestore";

export function formatCmykLine(c?: Partial<DesignSystemCmyk> | null): string {
  const v = {
    c: c?.c ?? 0,
    m: c?.m ?? 0,
    y: c?.y ?? 0,
    k: c?.k ?? 0,
  };
  return `C${v.c} M${v.m} Y${v.y} K${v.k}`;
}

export function teamHexClipboard(colors: DesignSystemPaletteColor[]): string {
  return (colors || []).map((x) => x.hex).join("\n");
}

export function teamCmykClipboard(colors: DesignSystemPaletteColor[]): string {
  return (colors || [])
    .map((x) => `${x.name}: ${formatCmykLine(x.cmyk ?? undefined)}`)
    .join("\n");
}
