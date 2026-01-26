"use client";

import { useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Modal from "@/components/Modal";
import {
  useDesigns,
  useDesignTeams,
  useCreateDesign,
  useSeedDesignTeams,
} from "@/lib/hooks/useDesignAssets";
import { DesignStatus, DesignColor, HEX_COLOR_REGEX } from "@/lib/types/firestore";

function DesignsContent() {
  // Filters state
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<DesignStatus | "">("");
  const [hasPngFilter, setHasPngFilter] = useState<boolean | undefined>(undefined);
  const [hasPdfFilter, setHasPdfFilter] = useState<boolean | undefined>(undefined);
  const [searchFilter, setSearchFilter] = useState("");

  // Create modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newDesignName, setNewDesignName] = useState("");
  const [newDesignTeam, setNewDesignTeam] = useState("");
  const [newDesignDescription, setNewDesignDescription] = useState("");
  const [newDesignTags, setNewDesignTags] = useState("");
  const [newDesignColors, setNewDesignColors] = useState<DesignColor[]>([
    { hex: "#000000", name: "", role: "ink" },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Seed teams modal state
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Build filters
  const filters: any = {};
  if (teamFilter) filters.teamId = teamFilter;
  if (statusFilter) filters.status = statusFilter;
  if (hasPngFilter !== undefined) filters.hasPng = hasPngFilter;
  if (hasPdfFilter !== undefined) filters.hasPdf = hasPdfFilter;
  if (searchFilter) filters.search = searchFilter;

  // Fetch data
  const { designs, isLoading, error, mutate } = useDesigns(
    Object.keys(filters).length > 0 ? filters : undefined
  );
  const { teams, isLoading: teamsLoading, mutate: mutateTeams } = useDesignTeams();
  const { createDesign } = useCreateDesign();
  const { seedTeams } = useSeedDesignTeams();

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSeedTeams = async () => {
    setIsSeeding(true);
    setSeedResult(null);

    try {
      const result = await seedTeams();
      setSeedResult(result);
      showToast(`Seeded ${result.created} teams (${result.skipped} skipped)`, "success");
      mutateTeams();
    } catch (err: any) {
      console.error("[DesignsPage] Failed to seed teams:", err);
      showToast(err.message || "Failed to seed teams", "error");
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAddColor = () => {
    setNewDesignColors([
      ...newDesignColors,
      { hex: "#000000", name: "", role: "ink" },
    ]);
  };

  const handleRemoveColor = (index: number) => {
    if (newDesignColors.length <= 1) return;
    setNewDesignColors(newDesignColors.filter((_, i) => i !== index));
  };

  const handleColorChange = (index: number, field: keyof DesignColor, value: string) => {
    const updated = [...newDesignColors];
    updated[index] = { ...updated[index], [field]: value };
    setNewDesignColors(updated);
  };

  const validateColors = (): boolean => {
    for (const color of newDesignColors) {
      if (!HEX_COLOR_REGEX.test(color.hex)) {
        setCreateError(`Invalid hex color: ${color.hex}. Use #RRGGBB format.`);
        return false;
      }
    }
    return true;
  };

  const handleCreateDesign = async () => {
    setCreateError(null);

    if (!newDesignName.trim()) {
      setCreateError("Design name is required");
      return;
    }

    if (!newDesignTeam) {
      setCreateError("Team is required");
      return;
    }

    if (!validateColors()) {
      return;
    }

    setIsCreating(true);

    try {
      const tags = newDesignTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const result = await createDesign({
        name: newDesignName.trim(),
        teamId: newDesignTeam,
        colors: newDesignColors,
        tags,
        description: newDesignDescription.trim() || undefined,
      });

      showToast(`Design created: ${result.slug}`, "success");
      setIsCreateModalOpen(false);
      resetCreateForm();
      mutate();
    } catch (err: any) {
      console.error("[DesignsPage] Failed to create design:", err);
      setCreateError(err.message || "Failed to create design");
    } finally {
      setIsCreating(false);
    }
  };

  const resetCreateForm = () => {
    setNewDesignName("");
    setNewDesignTeam("");
    setNewDesignDescription("");
    setNewDesignTags("");
    setNewDesignColors([{ hex: "#000000", name: "", role: "ink" }]);
    setCreateError(null);
  };

  // Get completeness indicator
  const getCompleteness = (design: any) => {
    if (design.isComplete) return { label: "Complete", color: "bg-green-100 text-green-700" };
    if (design.hasPng || design.hasPdf) return { label: "Partial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Missing", color: "bg-red-100 text-red-700" };
  };

  // Get status badge
  const getStatusBadge = (status: DesignStatus) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-700";
      case "draft":
        return "bg-gray-100 text-gray-700";
      case "archived":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
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
            <h1 className="text-2xl font-bold text-gray-900">Designs Library</h1>
            <p className="text-sm text-gray-500 mt-1">
              Reusable artwork with PNG/PDF files, print colors, and team tagging.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsSeedModalOpen(true)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
            >
              Seed Teams
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              + Create Design
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Search */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Search
              </label>
              <input
                type="text"
                placeholder="Search by name, team..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Team */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Team
              </label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as DesignStatus | "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Has PNG */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Has PNG
              </label>
              <select
                value={hasPngFilter === undefined ? "" : hasPngFilter ? "yes" : "no"}
                onChange={(e) =>
                  setHasPngFilter(
                    e.target.value === "" ? undefined : e.target.value === "yes"
                  )
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* Has PDF */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Has PDF
              </label>
              <select
                value={hasPdfFilter === undefined ? "" : hasPdfFilter ? "yes" : "no"}
                onChange={(e) =>
                  setHasPdfFilter(
                    e.target.value === "" ? undefined : e.target.value === "yes"
                  )
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loading / Error states */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading designs...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-red-600">Error loading designs</p>
          </div>
        )}

        {/* Designs table */}
        {!isLoading && !error && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Design
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Colors
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Files
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completeness
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {designs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                      No designs found. Create your first design to get started.
                    </td>
                  </tr>
                ) : (
                  designs.map((design) => {
                    const completeness = getCompleteness(design);
                    return (
                      <tr key={design.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            {/* Thumbnail placeholder */}
                            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                              {design.files?.png?.downloadUrl ? (
                                <img
                                  src={design.files.png.downloadUrl}
                                  alt={design.name}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{design.name}</div>
                              <div className="text-xs text-gray-500">{design.slug}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            {design.teamNameCache || design.teamId}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1">
                            {design.colors.slice(0, 4).map((color, i) => (
                              <div
                                key={i}
                                className="w-5 h-5 rounded-full border border-gray-300"
                                style={{ backgroundColor: color.hex }}
                                title={color.name || color.hex}
                              />
                            ))}
                            {design.colors.length > 4 && (
                              <span className="text-xs text-gray-500">
                                +{design.colors.length - 4}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 text-xs">
                            <span className={design.hasPng ? "text-green-600" : "text-gray-400"}>
                              PNG {design.hasPng ? "✓" : "✗"}
                            </span>
                            <span className={design.hasPdf ? "text-green-600" : "text-gray-400"}>
                              PDF {design.hasPdf ? "✓" : "✗"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(
                              design.status
                            )}`}
                          >
                            {design.status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${completeness.color}`}
                          >
                            {completeness.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            href={`/designs/${design.id}`}
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats */}
        {!isLoading && designs.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {designs.length} design{designs.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Create Design Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          resetCreateForm();
        }}
        title="Create New Design"
      >
        <div className="space-y-4">
          {createError && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {createError}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Design Name *
            </label>
            <input
              type="text"
              value={newDesignName}
              onChange={(e) => setNewDesignName(e.target.value)}
              placeholder="e.g., Giants Wordmark"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team *
            </label>
            {teams.length === 0 ? (
              <p className="text-sm text-gray-500">
                No teams available. Click &quot;Seed Teams&quot; to add sample teams.
              </p>
            ) : (
              <select
                value={newDesignTeam}
                onChange={(e) => setNewDesignTeam(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.league})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Colors */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Print Colors * (at least one required)
            </label>
            <div className="space-y-2">
              {newDesignColors.map((color, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color.hex}
                    onChange={(e) => handleColorChange(index, "hex", e.target.value)}
                    className="w-10 h-10 border border-gray-300 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={color.hex}
                    onChange={(e) => handleColorChange(index, "hex", e.target.value)}
                    placeholder="#000000"
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    value={color.name || ""}
                    onChange={(e) => handleColorChange(index, "name", e.target.value)}
                    placeholder="Color name (optional)"
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <select
                    value={color.role || "ink"}
                    onChange={(e) => handleColorChange(index, "role", e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="ink">Ink</option>
                    <option value="accent">Accent</option>
                    <option value="underbase">Underbase</option>
                  </select>
                  {newDesignColors.length > 1 && (
                    <button
                      onClick={() => handleRemoveColor(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={handleAddColor}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add another color
              </button>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={newDesignTags}
              onChange={(e) => setNewDesignTags(e.target.value)}
              placeholder="e.g., mlb, orange, wordmark"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={newDesignDescription}
              onChange={(e) => setNewDesignDescription(e.target.value)}
              placeholder="Brief description of the design..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <button
              onClick={() => {
                setIsCreateModalOpen(false);
                resetCreateForm();
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateDesign}
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreating ? "Creating..." : "Create Design"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Seed Teams Modal */}
      <Modal
        isOpen={isSeedModalOpen}
        onClose={() => {
          setIsSeedModalOpen(false);
          setSeedResult(null);
        }}
        title="Seed Design Teams"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            This will create sample sports teams for design tagging:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
            <li>SF Giants (MLB)</li>
            <li>SF 49ers (NFL)</li>
            <li>LA Dodgers (MLB)</li>
            <li>LA Lakers (NBA)</li>
            <li>NY Yankees (MLB)</li>
            <li>Chicago Bulls (NBA)</li>
          </ul>
          <p className="text-sm text-gray-500">
            Existing teams will be skipped.
          </p>

          {seedResult && (
            <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">
              Created: {seedResult.created}, Skipped: {seedResult.skipped}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button
              onClick={() => {
                setIsSeedModalOpen(false);
                setSeedResult(null);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
            <button
              onClick={handleSeedTeams}
              disabled={isSeeding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSeeding ? "Seeding..." : "Seed Teams"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function DesignsPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <DesignsContent />
    </ProtectedRoute>
  );
}
