"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useProducts } from "@/lib/hooks/useRPProducts";
import { useCreateMockJob } from "@/lib/hooks/useMockAssets";
import type { RpProduct } from "@/lib/types/firestore";

type SidesOption = "front" | "back" | "both";
type OverwriteOption = "skip" | "replace";
type ResultAction = "created" | "skipped_existing" | "skipped_ineligible" | "failed";
type HeroResult = { productId: string; slug: string; side: "front" | "back"; action: ResultAction; jobId?: string; error?: string };

function isFrontEligible(p: RpProduct): boolean {
  const front = p.renderSetup?.front;
  if (!front) return false;
  const hasBlank = !!(front.blankImageUrl ?? front.blankAssetId);
  const hasDesign = !!(front.designAssetUrl ?? front.designAssetId);
  const hasPlacement = !!(front.placementKey ?? front.placementOverride);
  return !!(hasBlank && hasDesign && hasPlacement);
}

function isBackEligible(p: RpProduct): boolean {
  const back = p.renderSetup?.back;
  if (!back) return false;
  const hasBlank = !!(back.blankImageUrl ?? back.blankAssetId);
  const hasDesign = !!(back.designAssetUrl ?? back.designAssetId);
  const hasPlacement = !!(back.placementKey ?? back.placementOverride);
  return !!(hasBlank && hasDesign && hasPlacement);
}

function frontMissingFields(p: RpProduct): string[] {
  const front = p.renderSetup?.front;
  if (!front) return ["No renderSetup.front"];
  const out: string[] = [];
  if (!front.blankImageUrl && !front.blankAssetId) out.push("Blank image");
  if (!front.designAssetUrl && !front.designAssetId) out.push("Design image");
  if (!front.placementKey && !front.placementOverride) out.push("Placement");
  return out;
}

function backMissingFields(p: RpProduct): string[] {
  const back = p.renderSetup?.back;
  if (!back) return ["No renderSetup.back"];
  const out: string[] = [];
  if (!back.blankImageUrl && !back.blankAssetId) out.push("Blank image");
  if (!back.designAssetUrl && !back.designAssetId) out.push("Design image");
  if (!back.placementKey && !back.placementOverride) out.push("Placement");
  return out;
}

function BatchHeroContent() {
  const { products, loading: isLoading } = useProducts({});
  const { createJob: createMockJob } = useCreateMockJob();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sides, setSides] = useState<SidesOption>("both");
  const [overwrite, setOverwrite] = useState<OverwriteOption>("skip");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<HeroResult[] | null>(null);
  const [filterMissingFront, setFilterMissingFront] = useState(false);
  const [filterMissingBack, setFilterMissingBack] = useState(false);

  const productsList = useMemo(() => {
    let list = products ?? [];
    if (filterMissingFront) list = list.filter((p) => !p.media?.heroFront);
    if (filterMissingBack) list = list.filter((p) => !p.media?.heroBack);
    return list;
  }, [products, filterMissingFront, filterMissingBack]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(productsList.map((p) => p.id!).filter(Boolean)));
  }, [productsList]);

  const runBatch = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setRunning(true);
    setResults(null);
    const out: HeroResult[] = [];
    const sidesToRun: ("front" | "back")[] = sides === "both" ? ["front", "back"] : sides === "front" ? ["front"] : ["back"];

    for (const productId of selectedIds) {
      const p = products?.find((x) => x.id === productId) as RpProduct | undefined;
      if (!p?.id || !p.slug) continue;
      const hasHeroFront = !!p.media?.heroFront;
      const hasHeroBack = !!p.media?.heroBack;

      for (const side of sidesToRun) {
        const eligible = side === "front" ? isFrontEligible(p) : isBackEligible(p);
        if (!eligible) {
          out.push({
            productId: p.id,
            slug: p.slug,
            side,
            action: "skipped_ineligible",
            error: side === "front" ? frontMissingFields(p).join(", ") || "Missing front config" : backMissingFields(p).join(", ") || "Missing back config",
          });
          continue;
        }
        const hasHero = side === "front" ? hasHeroFront : hasHeroBack;
        if (!overwrite && hasHero) {
          out.push({ productId: p.id, slug: p.slug, side, action: "skipped_existing" });
          continue;
        }
        const config = side === "front" ? p.renderSetup?.front : p.renderSetup?.back;
        const blankUrl = config?.blankImageUrl ?? "";
        const designUrl = config?.designAssetUrl ?? "";
        const designId = config?.designAssetId ?? (side === "front" ? p.designIdFront : p.designIdBack);
        if (!blankUrl || !designUrl || !designId || !p.blankId) {
          out.push({ productId: p.id, slug: p.slug, side, action: "failed", error: "Missing URL or designId/blankId" });
          continue;
        }
        try {
          const jobId = await createMockJob({
            designId: designId,
            blankId: p.blankId,
            view: side,
            quality: "draft",
            productId: p.id,
            heroSlot: side === "front" ? "hero_front" : "hero_back",
            blankImageUrl: blankUrl,
            designPngUrl: designUrl,
            placementOverride: config?.placementOverride
              ? { x: config.placementOverride.x ?? 0.5, y: config.placementOverride.y ?? 0.5, scale: config.placementOverride.scale ?? 0.6 }
              : undefined,
          });
          if (jobId) {
            out.push({ productId: p.id, slug: p.slug, side, action: "created", jobId });
          } else {
            out.push({ productId: p.id, slug: p.slug, side, action: "failed", error: "createMockJob returned null" });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          out.push({ productId: p.id, slug: p.slug, side, action: "failed", error: msg });
        }
      }
    }

    setResults(out);
    setRunning(false);
  }, [products, selectedIds, sides, overwrite, createMockJob]);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-2">
          <Link href="/products" className="hover:text-gray-700">
            Products
          </Link>
          <span className="mx-1">/</span>
          <span className="text-gray-900">Batch Hero Render</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Batch Hero Render</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate deterministic front/back hero images for selected products. Uses renderSetup only; no AI.
        </p>
      </div>

      {/* Render options */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Options</h2>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Sides</span>
            <select
              value={sides}
              onChange={(e) => setSides(e.target.value as SidesOption)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="front">Front only</option>
              <option value="back">Back only</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Existing hero</span>
            <select
              value={overwrite}
              onChange={(e) => setOverwrite(e.target.value as OverwriteOption)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="skip">Skip if hero already exists</option>
              <option value="replace">Regenerate and replace</option>
            </select>
          </label>
        </div>
      </section>

      {/* Quick filters */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Quick filters</h2>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filterMissingFront} onChange={(e) => setFilterMissingFront(e.target.checked)} className="rounded border-gray-300" />
            Missing hero front
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filterMissingBack} onChange={(e) => setFilterMissingBack(e.target.checked)} className="rounded border-gray-300" />
            Missing hero back
          </label>
          <button type="button" onClick={selectAll} className="text-sm text-blue-600 hover:underline">
            Select all ({productsList.length})
          </button>
        </div>
      </section>

      {/* Product selection & validation */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Product selection</h2>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <button
            type="button"
            onClick={runBatch}
            disabled={running || selectedIds.size === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {running ? "Running…" : `Run batch (${selectedIds.size} selected)`}
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading products…</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="min-w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700 w-8">
                    <input
                      type="checkbox"
                      checked={productsList.length > 0 && selectedIds.size === productsList.length}
                      onChange={(e) => (e.target.checked ? selectAll() : setSelectedIds(new Set()))}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Product</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Front ready</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Back ready</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Hero front</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Hero back</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Missing</th>
                </tr>
              </thead>
              <tbody>
                {productsList.map((p) => {
                  const frontOk = isFrontEligible(p);
                  const backOk = isBackEligible(p);
                  const frontMissing = frontMissingFields(p);
                  const backMissing = backMissingFields(p);
                  const missingStr = [...new Set([...(frontOk ? [] : ["Front: " + frontMissing.join(", ")]), ...(backOk ? [] : ["Back: " + backMissing.join(", ")])])].filter(Boolean).join("; ") || "—";
                  return (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id!)}
                          onChange={() => toggleSelect(p.id!)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Link href={`/products/${p.slug}`} className="text-blue-600 hover:underline font-medium">
                          {p.title ?? p.name ?? p.slug}
                        </Link>
                      </td>
                      <td className="py-2 px-3">{frontOk ? "✓" : "✗"}</td>
                      <td className="py-2 px-3">{backOk ? "✓" : "✗"}</td>
                      <td className="py-2 px-3">{p.media?.heroFront ? "✓" : "—"}</td>
                      <td className="py-2 px-3">{p.media?.heroBack ? "✓" : "—"}</td>
                      <td className="py-2 px-3 text-gray-600 max-w-[200px] truncate" title={missingStr}>
                        {missingStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Results */}
      {results && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Results</h2>
          <p className="text-sm text-gray-500 mb-2">
            Created: {results.filter((r) => r.action === "created").length} · Skipped (existing): {results.filter((r) => r.action === "skipped_existing").length} · Skipped (ineligible):{" "}
            {results.filter((r) => r.action === "skipped_ineligible").length} · Failed: {results.filter((r) => r.action === "failed").length}
          </p>
          <div className="overflow-x-auto -mx-2">
            <table className="min-w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Product</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Side</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Action</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-3">
                      <Link href={`/products/${r.slug}`} className="text-blue-600 hover:underline">
                        {r.slug}
                      </Link>
                    </td>
                    <td className="py-2 px-3">{r.side}</td>
                    <td className="py-2 px-3">
                      {r.action === "created" && "Created"}
                      {r.action === "skipped_existing" && "Skipped (existing)"}
                      {r.action === "skipped_ineligible" && "Skipped (ineligible)"}
                      {r.action === "failed" && "Failed"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{r.error ?? (r.jobId ? "Job queued" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function BatchHeroPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <BatchHeroContent />
    </ProtectedRoute>
  );
}
