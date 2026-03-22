/**
 * Built-in sample artwork for blank render profile preview when the design library is empty.
 * Lightweight SVG data-URIs only — no network.
 * Canvas matches canonical print artboard: 2400×1500 (see designArtboardSpec.ts).
 */

import {
  DESIGN_ARTBOARD_HEIGHT_PX,
  DESIGN_ARTBOARD_WIDTH_PX,
} from "@/lib/render/designArtboardSpec";

export type DefaultSampleDesign = {
  id: string;
  label: string;
  url: string;
};

function svgDataUri(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg.trim());
}

const W = DESIGN_ARTBOARD_WIDTH_PX;
const H = DESIGN_ARTBOARD_HEIGHT_PX;

/** Bold block letters — tests heavy coverage */
const BOLD_TEXT_SVG = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="none"/>
  <text x="${W / 2}" y="${Math.round(H * 0.58)}" text-anchor="middle" font-size="280" fill="%231e293b" font-family="system-ui,sans-serif" font-weight="800">SAMPLE</text>
</svg>`);

/** Thin strokes — tests fine detail on fabric */
const THIN_TEXT_SVG = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="none"/>
  <text x="${W / 2}" y="${Math.round(H * 0.52)}" text-anchor="middle" font-size="140" fill="none" stroke="%230f172a" stroke-width="3" font-family="system-ui,sans-serif" font-weight="300">Preview</text>
</svg>`);

/** Icon-style graphic — tests non-text art */
const GRAPHIC_SVG = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="none"/>
  <circle cx="${Math.round(W * 0.5)}" cy="${Math.round(H * 0.42)}" r="200" fill="none" stroke="%23c026d3" stroke-width="28"/>
  <path d="M ${Math.round(W * 0.31)} ${Math.round(H * 0.78)} L ${Math.round(W * 0.5)} ${Math.round(H * 0.52)} L ${Math.round(W * 0.69)} ${Math.round(H * 0.78)} Z" fill="%233b82f6" fill-opacity="0.85"/>
</svg>`);

export const DEFAULT_SAMPLE_DESIGNS: DefaultSampleDesign[] = [
  { id: "rp-sample-bold-text", label: "Bold Text Sample", url: BOLD_TEXT_SVG },
  { id: "rp-sample-thin-text", label: "Thin Text Sample", url: THIN_TEXT_SVG },
  { id: "rp-sample-graphic", label: "Graphic Sample", url: GRAPHIC_SVG },
];

export function getDefaultSampleById(id: string): DefaultSampleDesign | undefined {
  return DEFAULT_SAMPLE_DESIGNS.find((s) => s.id === id);
}
