"use client";

import { useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  useBlanks,
  useCreateBlank,
  useSeedBlanks,
  useSeedMasterBlanks,
  STYLE_REGISTRY,
  ALL_STYLE_CODES,
  ALL_GARMENT_CATEGORIES,
} from "@/lib/hooks/useBlanks";
import { RPBlankStyleCode, RPBlankStatus, RPBlankGarmentCategory } from "@/lib/types/firestore";
import Modal from "@/components/Modal";
import {
  isMasterBlank,
  isLegacyBlank,
  getEffectiveCategory,
  getBlankVariants,
  getMasterBlankPreviewUrl,
  countActiveVariants,
} from "@/lib/blanks";

function BlanksContent() {
  const [styleFilter, setStyleFilter] = useState<RPBlankStyleCode | "">("");
  const [categoryFilter, setCategoryFilter] = useState<RPBlankGarmentCategory | "">("");
  const [statusFilter, setStatusFilter] = useState<RPBlankStatus | "">("");
  const [searchFilter, setSearchFilter] = useState("");
  const [mastersOnly, setMastersOnly] = useState(true);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<RPBlankStyleCode>("8394");
  const [customStyleCode, setCustomStyleCode] = useState("");
  const [usePreset, setUsePreset] = useState(true);
  const [styleNameManual, setStyleNameManual] = useState("");
  const [garmentStyleManual, setGarmentStyleManual] = useState("");
  const [categoryManual, setCategoryManual] = useState("");
  const [supplierManual, setSupplierManual] = useState("Los Angeles Apparel");
  const [supplierUrlManual, setSupplierUrlManual] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);
  const [seedMode, setSeedMode] = useState<"master" | "legacy">("master");

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const filters: any = {};
  if (styleFilter) filters.styleCode = styleFilter;
  if (categoryFilter) filters.garmentCategory = categoryFilter;
  if (statusFilter) filters.status = statusFilter;
  if (searchFilter) filters.search = searchFilter;
  if (mastersOnly) filters.mastersOnly = true;

  const { blanks, loading, error, refetch } = useBlanks(filters);

  const { createBlank } = useCreateBlank();
  const { seedBlanks } = useSeedBlanks();
  const { seedMasterBlanks } = useSeedMasterBlanks();

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCreateMasterBlank = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const styleCode = usePreset ? selectedStyle : customStyleCode.trim() || selectedStyle;
      if (!styleCode) {
        setCreateError("Style code is required");
        setIsCreating(false);
        return;
      }
      const result = await createBlank({
        masterBlank: true,
        createMasterBlank: true,
        schemaIntent: "master_v2",
        styleCode,
        useStylePreset: usePreset,
        styleName: usePreset ? undefined : styleNameManual.trim() || undefined,
        garmentStyle: garmentStyleManual.trim() || undefined,
        category: categoryManual.trim() || undefined,
        supplier: supplierManual.trim() || undefined,
        supplierUrl: supplierUrlManual.trim() || null,
      });
      showToast(`Master blank created: ${result.slug}`, "success");
      setIsCreateModalOpen(false);
      refetch();
    } catch (err: any) {
      console.error(err);
      setCreateError(err.message || "Failed to create blank");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSeed = async () => {
    setIsSeeding(true);
    setSeedResult(null);
    try {
      if (seedMode === "master") {
        const result = await seedMasterBlanks();
        setSeedResult(result);
        showToast(`Master blanks: ${result.created} created, ${result.skipped} skipped`, "success");
      } else {
        const result = await seedBlanks();
        setSeedResult(result);
        showToast(`Legacy: ${result.created} created, ${result.skipped} skipped`, "success");
      }
      refetch();
    } catch (err: any) {
      showToast(err.message || "Seed failed", "error");
    } finally {
      setIsSeeding(false);
    }
  };

  const getCompleteness = (blank: any) => {
    if (isMasterBlank(blank)) {
      const vars = getBlankVariants(blank);
      const withBoth = vars.filter((v) => v.images?.front?.downloadUrl && v.images?.back?.downloadUrl).length;
      if (vars.length === 0) return { label: "No variants", color: "bg-red-100 text-red-700" };
      if (withBoth === vars.length) return { label: "All variants OK", color: "bg-green-100 text-green-700" };
      if (withBoth > 0) return { label: "Partial", color: "bg-yellow-100 text-yellow-700" };
      return { label: "Missing images", color: "bg-red-100 text-red-700" };
    }
    const hasFront = blank.images?.front?.downloadUrl;
    const hasBack = blank.images?.back?.downloadUrl;
    if (hasFront && hasBack) return { label: "Complete", color: "bg-green-100 text-green-700" };
    if (hasFront || hasBack) return { label: "Partial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Missing", color: "bg-red-100 text-red-700" };
  };

  const badges = (blank: any) => {
    const b: string[] = [];
    if (isLegacyBlank(blank)) b.push("Legacy");
    if (blank.defaultPricing?.retailPrice != null || blank.defaultPricing?.basePrice != null) b.push("Pricing");
    if (blank.titleTemplate) b.push("Templates");
    if (blank.placements?.length) b.push("Render zones");
    if (getBlankVariants(blank).length) b.push("Variants");
    return b;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Blanks Library</h1>
            <p className="text-sm text-gray-500 mt-1 max-w-3xl">
              Master blanks: one record per style; colors are variants. See{" "}
              <span className="font-mono text-xs">RALLY_MASTER_BLANK_SCHEMA.md</span>.{" "}
              <span className="text-gray-600">
                Expect to tune images, placements, and variants by hand — for a small set of styles, use{" "}
                <strong>Create master blank</strong> per style; you do <strong>not</strong> need bulk seed.
              </span>
            </p>
          </div>
          <div className="flex gap-2 items-start">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              + Create master blank
            </button>
            <button
              type="button"
              onClick={() => setIsSeedModalOpen(true)}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm font-medium"
              title="Optional: create draft docs for every style in the registry at once"
            >
              Bulk seed…
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Style, slug, keywords..."
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={mastersOnly} onChange={(e) => setMastersOnly(e.target.checked)} />
              Master blanks only
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Style</label>
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value as RPBlankStyleCode | "")}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All Styles</option>
                {ALL_STYLE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} - {STYLE_REGISTRY[code].styleName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as RPBlankGarmentCategory | "")}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All</option>
                {ALL_GARMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as RPBlankStatus | "")}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">Loading…</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
        ) : blanks.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-500 mb-4">No blanks match filters.</p>
            <button onClick={() => setIsSeedModalOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
              Seed master blanks
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Preview</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Style</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Variants</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completeness</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Badges</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {blanks.map((blank) => {
                  const completeness = getCompleteness(blank);
                  const preview = getMasterBlankPreviewUrl(blank);
                  const variantCount = getBlankVariants(blank).length;
                  const activeCount = countActiveVariants(blank);
                  return (
                    <tr key={blank.blankId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="w-12 h-12 bg-gray-100 rounded border overflow-hidden flex items-center justify-center text-[10px] text-gray-400">
                          {preview ? (
                            <img src={preview} alt="" className="w-full h-full object-cover" />
                          ) : (
                            "—"
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{blank.styleCode}</div>
                        <div className="text-xs text-gray-500">{blank.styleName}</div>
                        <div className="text-xs text-gray-400 font-mono truncate max-w-[180px]">{blank.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-900">{getEffectiveCategory(blank) || "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{blank.supplier}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {variantCount}
                        {isMasterBlank(blank) && <span className="text-gray-500"> ({activeCount} active)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            blank.status === "active"
                              ? "bg-green-100 text-green-700"
                              : blank.status === "draft"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {blank.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${completeness.color}`}>{completeness.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {badges(blank).map((x) => (
                            <span key={x} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded">
                              {x}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/blanks/${blank.blankId}`} className="text-blue-600 hover:underline text-sm font-medium">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create master blank" size="medium">
        <div className="space-y-4">
          {createError && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{createError}</div>}
          <p className="text-sm text-gray-600">Creates one style-level blank. Add color variants on the detail page.</p>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={usePreset} onChange={(e) => setUsePreset(e.target.checked)} />
            Use LA Apparel style preset
          </label>
          {usePreset ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Style code *</label>
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value as RPBlankStyleCode)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {ALL_STYLE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} — {STYLE_REGISTRY[code].styleName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Style code *</label>
                <input
                  value={customStyleCode}
                  onChange={(e) => setCustomStyleCode(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g. HF07"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Style name *</label>
                <input
                  value={styleNameManual}
                  onChange={(e) => setStyleNameManual(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Garment style</label>
                <input
                  value={garmentStyleManual}
                  onChange={(e) => setGarmentStyleManual(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  value={categoryManual}
                  onChange={(e) => setCategoryManual(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="panty | thong | tank | crewneck"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <input
                  value={supplierManual}
                  onChange={(e) => setSupplierManual(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier URL</label>
                <input
                  value={supplierUrlManual}
                  onChange={(e) => setSupplierUrlManual(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-gray-600">
              Cancel
            </button>
            <button
              onClick={handleCreateMasterBlank}
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              {isCreating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isSeedModalOpen} onClose={() => setIsSeedModalOpen(false)} title="Bulk seed blanks (optional)" size="medium">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This is for <strong>bootstrapping many draft records</strong> from the style registry in one shot. It does{" "}
            <strong>not</strong> replace manual work (photos, print zones, eligibility). If you only need a few perfect
            blanks, skip this and use <strong>Create master blank</strong> instead.
          </p>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1" checked={seedMode === "master"} onChange={() => setSeedMode("master")} />
              <span>
                <strong>Master blanks</strong> — one <code className="text-xs bg-gray-100 px-1 rounded">rp_blanks</code>{" "}
                doc per registered style, with color variants pre-listed (draft; still needs your pass).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1" checked={seedMode === "legacy"} onChange={() => setSeedMode("legacy")} />
              <span>
                <strong>Legacy</strong> — older model: separate doc per style × color (more rows).
              </span>
            </label>
          </div>
          {seedResult && (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-green-800 text-sm">
              Created: {seedResult.created} · Skipped: {seedResult.skipped}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setIsSeedModalOpen(false)} className="px-4 py-2 text-gray-600">
              Close
            </button>
            <button onClick={handleSeed} disabled={isSeeding} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
              {isSeeding ? "Seeding…" : "Run seed"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function BlanksPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <BlanksContent />
    </ProtectedRoute>
  );
}
