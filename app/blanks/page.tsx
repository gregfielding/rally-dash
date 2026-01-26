"use client";

import { useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { 
  useBlanks, 
  useCreateBlank, 
  useSeedBlanks,
  STYLE_REGISTRY,
  ALL_STYLE_CODES,
  ALL_GARMENT_CATEGORIES,
  COLOR_REGISTRY,
  getAllowedColors,
} from "@/lib/hooks/useBlanks";
import { RPBlankStyleCode, RPBlankColorName, RPBlankStatus, RPBlankGarmentCategory } from "@/lib/types/firestore";
import Modal from "@/components/Modal";

function BlanksContent() {
  // Filters state
  const [styleFilter, setStyleFilter] = useState<RPBlankStyleCode | "">("");
  const [categoryFilter, setCategoryFilter] = useState<RPBlankGarmentCategory | "">("");
  const [colorFilter, setColorFilter] = useState<RPBlankColorName | "">("");
  const [statusFilter, setStatusFilter] = useState<RPBlankStatus | "">("");
  const [searchFilter, setSearchFilter] = useState("");
  
  // Create modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<RPBlankStyleCode>("8394");
  const [selectedColor, setSelectedColor] = useState<RPBlankColorName>("Black");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Seed modal state
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Fetch blanks
  const filters: any = {};
  if (styleFilter) filters.styleCode = styleFilter;
  if (categoryFilter) filters.garmentCategory = categoryFilter;
  if (colorFilter) filters.colorName = colorFilter;
  if (statusFilter) filters.status = statusFilter;
  if (searchFilter) filters.search = searchFilter;

  const { blanks, loading, error, refetch } = useBlanks(
    Object.keys(filters).length > 0 ? filters : undefined
  );

  const { createBlank } = useCreateBlank();
  const { seedBlanks } = useSeedBlanks();

  // Get allowed colors for selected style
  const allowedColors = getAllowedColors(selectedStyle);

  // Reset color when style changes
  const handleStyleChange = (newStyle: RPBlankStyleCode) => {
    setSelectedStyle(newStyle);
    const newAllowed = getAllowedColors(newStyle);
    if (!newAllowed.includes(selectedColor)) {
      setSelectedColor(newAllowed[0]);
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCreateBlank = async () => {
    setCreateError(null);
    setIsCreating(true);

    try {
      const result = await createBlank({
        styleCode: selectedStyle,
        colorName: selectedColor,
      });

      showToast(`Blank created: ${result.slug}`, "success");
      setIsCreateModalOpen(false);
      refetch();
    } catch (err: any) {
      console.error("[BlanksPage] Failed to create blank:", err);
      setCreateError(err.message || "Failed to create blank");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSeedBlanks = async () => {
    setIsSeeding(true);
    setSeedResult(null);

    try {
      const result = await seedBlanks();
      setSeedResult(result);
      showToast(`Seeded ${result.created} blanks (${result.skipped} skipped)`, "success");
      refetch();
    } catch (err: any) {
      console.error("[BlanksPage] Failed to seed blanks:", err);
      showToast(err.message || "Failed to seed blanks", "error");
    } finally {
      setIsSeeding(false);
    }
  };

  // Get completeness indicator
  const getCompleteness = (blank: any) => {
    const hasFront = blank.images?.front?.downloadUrl;
    const hasBack = blank.images?.back?.downloadUrl;
    if (hasFront && hasBack) return { label: "Complete", color: "bg-green-100 text-green-700" };
    if (hasFront || hasBack) return { label: "Partial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Missing", color: "bg-red-100 text-red-700" };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Blanks Library</h1>
            <p className="text-sm text-gray-500 mt-1">
              Curated source of truth for supplier-provided blank garments.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsSeedModalOpen(true)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
            >
              Seed Defaults
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              + Create Blank
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Search
              </label>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search by slug, style, color..."
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Style
              </label>
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
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as RPBlankGarmentCategory | "")}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">All Categories</option>
                {ALL_GARMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Status
              </label>
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

        {/* Content */}
        {loading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            Loading blanks...
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        ) : blanks.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-500 mb-4">No blanks found.</p>
            <button
              onClick={() => setIsSeedModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Seed All Blanks (21 items)
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Preview
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Style
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Color
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Images
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {blanks.map((blank) => {
                  const completeness = getCompleteness(blank);
                  return (
                    <tr key={blank.blankId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="w-12 h-12 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-xs text-gray-400 overflow-hidden">
                          {blank.images?.front?.downloadUrl ? (
                            <img 
                              src={blank.images.front.downloadUrl} 
                              alt="Front"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <span>No img</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <span className="text-sm font-medium text-gray-900">
                            {blank.styleCode}
                          </span>
                          <p className="text-xs text-gray-500">{blank.styleName}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-5 h-5 rounded border border-gray-300"
                            style={{ backgroundColor: blank.colorHex || COLOR_REGISTRY[blank.colorName] || "#ccc" }}
                          />
                          <span className="text-sm text-gray-900">{blank.colorName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 capitalize">
                          {blank.garmentCategory}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${completeness.color}`}>
                          {completeness.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          href={`/blanks/${blank.blankId}`}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
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

      {/* Create Blank Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Blank"
        size="medium"
      >
        <div className="space-y-4">
          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {createError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Style *
            </label>
            <select
              value={selectedStyle}
              onChange={(e) => handleStyleChange(e.target.value as RPBlankStyleCode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {ALL_STYLE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} - {STYLE_REGISTRY[code].styleName} ({STYLE_REGISTRY[code].garmentCategory})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Color *
            </label>
            <select
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value as RPBlankColorName)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {allowedColors.map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </select>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded border border-gray-300"
                style={{ backgroundColor: COLOR_REGISTRY[selectedColor] || "#ccc" }}
              />
              <div>
                <p className="font-medium">{selectedColor}</p>
                <p className="text-xs text-gray-500">{COLOR_REGISTRY[selectedColor]}</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">
            <strong>Note:</strong> After creating, you&apos;ll need to upload front and back images.
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateBlank}
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? "Creating..." : "Create Blank"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Seed Blanks Modal */}
      <Modal
        isOpen={isSeedModalOpen}
        onClose={() => setIsSeedModalOpen(false)}
        title="Seed All Blanks"
        size="medium"
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">
            <p className="font-semibold mb-2">This will create 21 blanks:</p>
            <ul className="list-disc ml-4 space-y-1">
              <li><strong>8394</strong> (Bikini Panty): 6 colors</li>
              <li><strong>8390</strong> (Thong Panty): 6 colors</li>
              <li><strong>TR3008</strong> (Racerback Tank): 3 colors</li>
              <li><strong>1822GD</strong> (Crop Tank): 3 colors</li>
              <li><strong>HF07</strong> (Crewneck): 3 colors</li>
            </ul>
            <p className="mt-2 text-xs">Existing blanks will be skipped.</p>
          </div>

          {seedResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
              <strong>Seed Complete!</strong>
              <p>Created: {seedResult.created} blanks</p>
              <p>Skipped: {seedResult.skipped} blanks (already exist)</p>
              <p>Total checked: {seedResult.total}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setIsSeedModalOpen(false)}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Close
            </button>
            <button
              onClick={handleSeedBlanks}
              disabled={isSeeding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSeeding ? "Seeding..." : "Seed All Blanks"}
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
