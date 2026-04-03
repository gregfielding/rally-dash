/**
 * Parse 8394 `generateProductFlatRenders` QA: ordered outputs, skip reasons from `renderSelectionLog`.
 */

import { trimMediaUrl } from "@/lib/shopify/variantShopifyMedia";

export type FlatRender8394UrlPayload = {
  flat_clean_back?: string | null;
  flat_blended_back?: string | null;
  flat_clean_front?: string | null;
  flat_blended_front?: string | null;
  model_clean_back?: string | null;
  model_blended_back?: string | null;
  model_clean_front?: string | null;
  model_blended_front?: string | null;
};

export type Ordered8394OutputRow = {
  /** Display order 1–4 */
  order: number;
  id: "model_back" | "flat_front" | "flat_back" | "model_front";
  title: string;
  /** Callable render type that produces this row */
  renderType: "model_blended_back" | "flat_clean_front" | "flat_blended_back" | "model_clean_front";
  /** Primary URL written for this slot in the last run (designed backs use *_blended_back). */
  urlKey: keyof FlatRender8394UrlPayload;
  produced: boolean;
  url: string | null;
  /** From server expand log when skipped */
  skipDetail: string | null;
  requestedInRun: boolean;
};

const OUTPUT_DEFS: Omit<Ordered8394OutputRow, "produced" | "url" | "skipDetail" | "requestedInRun">[] = [
  {
    order: 1,
    id: "model_back",
    title: "model_back",
    renderType: "model_blended_back",
    urlKey: "model_blended_back",
  },
  {
    order: 2,
    id: "flat_front",
    title: "flat_front",
    renderType: "flat_clean_front",
    urlKey: "flat_clean_front",
  },
  {
    order: 3,
    id: "flat_back",
    title: "flat_back",
    renderType: "flat_blended_back",
    urlKey: "flat_blended_back",
  },
  {
    order: 4,
    id: "model_front",
    title: "model_front",
    renderType: "model_clean_front",
    urlKey: "model_clean_front",
  },
];

const RENDER_TYPE_PREFIX: Record<Ordered8394OutputRow["renderType"], string> = {
  model_blended_back: "model_blended_back",
  flat_clean_front: "flat_clean_front",
  flat_blended_back: "flat_blended_back",
  model_clean_front: "model_clean_front",
};

/** Fallback when callable omits `renderTypes` in the client type (server always sends it). */
function parseResolvedRenderTypesFromLog(lines: string[] | null | undefined): string[] | null {
  for (const line of lines || []) {
    const m = String(line).match(/^Resolved renderTypes:\s*(.+)$/i);
    if (m?.[1]) {
      return m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return null;
}

function parseSkipDetail(lines: string[] | null | undefined, renderType: Ordered8394OutputRow["renderType"]): string | null {
  const prefix = RENDER_TYPE_PREFIX[renderType];
  for (const line of lines || []) {
    const s = String(line).trim();
    if (!s.startsWith(prefix + ":")) continue;
    if (s.toLowerCase().includes("skipped")) {
      const parts = s.split(/[—–-]/);
      const tail = parts.slice(1).join("—").trim();
      return tail || "skipped";
    }
  }
  return null;
}

/**
 * Build the four ordered rows for the last generation run.
 * Uses `urls` from the callable response when present; enriches skip reasons from the log.
 */
export function buildOrdered8394OutputRows(
  lines: string[] | null | undefined,
  urls: FlatRender8394UrlPayload | null | undefined,
  renderTypes: string[] | null | undefined
): Ordered8394OutputRow[] {
  const rtList =
    renderTypes && renderTypes.length ? renderTypes : parseResolvedRenderTypesFromLog(lines);
  const rtSet = rtList && rtList.length ? new Set(rtList.map((x) => String(x).trim())) : null;
  const hasAnyUrl =
    urls &&
    Object.values(urls).some((u) => u != null && typeof u === "string" && trimMediaUrl(u).length > 0);

  return OUTPUT_DEFS.map((def) => {
    const requestedInRun = rtSet ? rtSet.has(def.renderType) : Boolean(hasAnyUrl);
    const raw = urls?.[def.urlKey];
    const url = raw != null && String(raw).trim() ? trimMediaUrl(raw) : null;
    const produced = Boolean(url);
    const skipDetail = produced ? null : parseSkipDetail(lines, def.renderType);

    return {
      ...def,
      produced,
      url: url || null,
      skipDetail,
      requestedInRun,
    };
  });
}
