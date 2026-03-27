"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Modal from "@/components/Modal";
import {
  useDesigns,
  useDesignTeams,
  useCreateDesign,
  useUpdateDesignFile,
} from "@/lib/hooks/useDesignAssets";
import {
  DesignStatus,
  DesignColor,
  DesignDesignType,
  HEX_COLOR_REGEX,
  type DesignTeam,
} from "@/lib/types/firestore";
import { DESIGN_THEME_OPTIONS, designThemeLabel } from "@/lib/designs/designThemes";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import {
  getDesignPreviewUrl,
  computeDesignCompleteness,
  designGarmentAssetBadges,
} from "@/lib/designs/designHelpers";
import { normalizeDesignSeriesInput } from "@/lib/designs/normalizeDesignSeries";
import { useProductsByDesignIndex } from "@/lib/hooks/useProductsByDesign";
import type { ProductDesignLink } from "@/lib/designs/productDesignLinks";


function teamOptionLabel(team: DesignTeam): string {
  const geo =
    team.city && team.state ? `${team.city}, ${team.state}` : team.city || team.state || "";
  const league = team.league || team.leagueId || "";
  return geo ? `${team.name} — ${geo}${league ? ` (${league})` : ""}` : `${team.name}${league ? ` (${league})` : ""}`;
}

const PRINT_COLOR_ROLES: { value: string; label: string }[] = [
  { value: "team_primary", label: "team_primary" },
  { value: "team_secondary", label: "team_secondary" },
  { value: "number_light", label: "number_light" },
  { value: "number_dark", label: "number_dark" },
  { value: "accent", label: "accent" },
  { value: "alt", label: "alt" },
  { value: "standard_off_black", label: "standard_off_black (Off Black)" },
  { value: "standard_off_white", label: "standard_off_white (Off White)" },
  { value: "other", label: "other" },
];

/** Standard inks only — no team brand row until league + team are chosen. */
const CREATE_MODAL_STANDARD_COLORS: DesignColor[] = [
  { hex: "#111111", name: "Off Black", role: "standard_off_black" },
  { hex: "#F5F5F5", name: "Off White", role: "standard_off_white" },
];

function normalizeTeamHex(hex: string): string {
  const t = hex.trim();
  if (!t) return "#000000";
  const withHash = t.startsWith("#") ? t : `#${t}`;
  if (withHash.length === 4 && /^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return withHash.length >= 7 ? withHash.slice(0, 7).toUpperCase() : withHash.toUpperCase();
}

function mapTeamColorRoleToPrintRole(role: string): string {
  const r = role.toLowerCase();
  if (r === "primary") return "team_primary";
  if (r === "secondary") return "team_secondary";
  if (r === "tertiary") return "accent";
  if (r === "team_primary" || r === "team_secondary") return r;
  return "accent";
}

/** Build print-color rows from roster team (shown above standard Off Black / Off White). */
function designColorsFromTeam(team: DesignTeam): DesignColor[] {
  const out: DesignColor[] = [];

  if (team.teamColors && team.teamColors.length > 0) {
    for (const tc of team.teamColors) {
      const hex = normalizeTeamHex(tc.hex);
      if (!HEX_COLOR_REGEX.test(hex)) continue;
      out.push({
        hex,
        name: tc.name || "",
        role: mapTeamColorRoleToPrintRole(tc.role),
      });
    }
  }

  if (out.length === 0) {
    if (team.primaryColorHex) {
      const hex = normalizeTeamHex(team.primaryColorHex);
      if (HEX_COLOR_REGEX.test(hex)) {
        out.push({
          hex,
          name: team.teamName || "",
          role: "team_primary",
        });
      }
    }
    if (team.secondaryColorHex) {
      const hex = normalizeTeamHex(team.secondaryColorHex);
      if (HEX_COLOR_REGEX.test(hex)) {
        out.push({
          hex,
          name: "",
          role: "team_secondary",
        });
      }
    }
  }

  return out;
}

function teamLeagueLabel(t: DesignTeam): string {
  return (t.league || t.leagueId || "").trim();
}

function DesignsContent() {
  // Filters: League → Team → designs (mental model)
  const [leagueFilter, setLeagueFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [designTypeFilter, setDesignTypeFilter] = useState<DesignDesignType | "">("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<DesignStatus | "">("");
  const [searchFilter, setSearchFilter] = useState("");

  // Create modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newDesignName, setNewDesignName] = useState("");
  const [newDesignLeague, setNewDesignLeague] = useState("");
  const [newDesignTeam, setNewDesignTeam] = useState("");
  const [newDesignType, setNewDesignType] = useState<DesignDesignType>("city_69");
  const [newDesignSeries, setNewDesignSeries] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [newDesignColors, setNewDesignColors] = useState<DesignColor[]>(() => [...CREATE_MODAL_STANDARD_COLORS]);
  const [lightPngFile, setLightPngFile] = useState<File | null>(null);
  const [darkPngFile, setDarkPngFile] = useState<File | null>(null);
  const [lightSvgFile, setLightSvgFile] = useState<File | null>(null);
  const [darkSvgFile, setDarkSvgFile] = useState<File | null>(null);
  const [lightPdfFile, setLightPdfFile] = useState<File | null>(null);
  const [darkPdfFile, setDarkPdfFile] = useState<File | null>(null);
  const lightInputRef = useRef<HTMLInputElement>(null);
  const darkInputRef = useRef<HTMLInputElement>(null);
  const lightSvgInputRef = useRef<HTMLInputElement>(null);
  const darkSvgInputRef = useRef<HTMLInputElement>(null);
  const lightPdfInputRef = useRef<HTMLInputElement>(null);
  const darkPdfInputRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Build filters (team is Firestore filter when set; league is applied client-side)
  const filters: Record<string, string | DesignStatus> = {};
  if (teamFilter) filters.teamId = teamFilter;
  if (statusFilter) filters.status = statusFilter;
  if (searchFilter) filters.search = searchFilter;

  // Fetch data
  const { designs, isLoading, error, mutate } = useDesigns(
    Object.keys(filters).length > 0 ? filters : undefined
  );
  const { teams } = useDesignTeams();
  const { getProductsForDesign, loading: productsIndexLoading } = useProductsByDesignIndex();

  const leagues = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) {
      const lg = teamLeagueLabel(t);
      if (lg) set.add(lg);
    }
    return [...set].sort();
  }, [teams]);

  const teamsForLeague = useMemo(() => {
    if (!leagueFilter) return teams;
    return teams.filter((t) => teamLeagueLabel(t) === leagueFilter);
  }, [teams, leagueFilter]);

  /** Create modal: teams in the selected league (league matches `league` or `leagueId` on roster). */
  const teamsForCreateModal = useMemo(() => {
    if (!newDesignLeague) return [];
    return teams.filter((t) => teamLeagueLabel(t) === newDesignLeague);
  }, [teams, newDesignLeague]);

  const createModalHasLeagueStep = leagues.length > 0;

  // Reset team if league changes and current team not in league
  useEffect(() => {
    if (!leagueFilter || !teamFilter) return;
    const ok = teamsForLeague.some((t) => t.id === teamFilter);
    if (!ok) setTeamFilter("");
  }, [leagueFilter, teamFilter, teamsForLeague]);

  const displayDesigns = useMemo(() => {
    let list = designs;
    if (leagueFilter) {
      list = list.filter((d) => {
        const team = teams.find((t) => t.id === d.teamId);
        const lg =
          (d.leagueId && String(d.leagueId).trim()) || (team ? teamLeagueLabel(team) : "");
        return lg === leagueFilter;
      });
    }
    if (designTypeFilter) {
      list = list.filter((d) => d.designType === designTypeFilter);
    }
    if (seriesFilter.trim()) {
      const q = seriesFilter.trim().toLowerCase();
      list = list.filter((d) => String(d.designSeries || "").toLowerCase().includes(q));
    }
    return list;
  }, [designs, leagueFilter, designTypeFilter, seriesFilter, teams]);

  const leagueLabelForDesign = (d: (typeof designs)[0]) => {
    const team = teams.find((t) => t.id === d.teamId);
    return d.leagueId?.trim() || (team ? teamLeagueLabel(team) : "") || "—";
  };
  const { createDesign } = useCreateDesign();
  const { updateFile } = useUpdateDesignFile();

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleAddColor = () => {
    setNewDesignColors([
      ...newDesignColors,
      { hex: "#000000", name: "", role: "accent" },
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

  const onCreateModalLeagueChange = (league: string) => {
    setNewDesignLeague(league);
    setNewDesignTeam("");
    setNewDesignColors([...CREATE_MODAL_STANDARD_COLORS]);
  };

  const onCreateModalTeamChange = (teamId: string) => {
    setNewDesignTeam(teamId);
    if (!teamId) {
      setNewDesignColors([...CREATE_MODAL_STANDARD_COLORS]);
      return;
    }
    const team = teams.find((t) => t.id === teamId);
    if (!team) {
      setNewDesignColors([...CREATE_MODAL_STANDARD_COLORS]);
      return;
    }
    const fromTeam = designColorsFromTeam(team);
    setNewDesignColors([...fromTeam, ...CREATE_MODAL_STANDARD_COLORS]);
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

  const loadImageDims = (file: File) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read image"));
      };
      img.src = url;
    });

  const uploadDesignFile = async (
    designId: string,
    kind:
      | "lightPng"
      | "darkPng"
      | "lightSvg"
      | "darkSvg"
      | "lightPdf"
      | "darkPdf",
    file: File
  ) => {
    if (!storage) throw new Error("Storage not initialized");
    const folder =
      kind === "lightPng"
        ? "png/light"
        : kind === "darkPng"
          ? "png/dark"
          : kind === "lightSvg"
            ? "svg/light"
            : kind === "darkSvg"
              ? "svg/dark"
              : kind === "lightPdf"
                ? "pdf/light"
                : "pdf/dark";
    const storagePath = `designs/${designId}/${folder}/${file.name}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);
    let widthPx: number | undefined;
    let heightPx: number | undefined;
    if (kind === "lightPng" || kind === "darkPng" || kind === "lightSvg" || kind === "darkSvg") {
      try {
        const d = await loadImageDims(file);
        widthPx = d.width;
        heightPx = d.height;
      } catch {
        /* optional */
      }
    }
    await updateFile({
      designId,
      kind,
      storagePath,
      downloadUrl,
      fileName: file.name,
      contentType: file.type || undefined,
      sizeBytes: file.size,
      widthPx,
      heightPx,
    });
  };

  const handleCreateDesign = async () => {
    setCreateError(null);

    if (!newDesignName.trim()) {
      setCreateError("Design name is required (e.g. San Francisco Giants – City 69)");
      return;
    }

    if (createModalHasLeagueStep) {
      if (!newDesignLeague.trim()) {
        setCreateError("Select a league first");
        return;
      }
      const picked = teams.find((t) => t.id === newDesignTeam);
      if (!picked || teamLeagueLabel(picked) !== newDesignLeague.trim()) {
        setCreateError("Pick a team from the selected league");
        return;
      }
    }

    if (!newDesignTeam) {
      setCreateError("Team is required");
      return;
    }

    if (!newDesignType) {
      setCreateError("Design theme is required");
      return;
    }

    if (!lightPngFile || !darkPngFile) {
      setCreateError("Light Garment PNG and Dark Garment PNG uploads are required.");
      return;
    }

    if (!validateColors()) {
      return;
    }

    setIsCreating(true);

    try {
      const seriesForCreate = normalizeDesignSeriesInput(newDesignSeries);
      const result = await createDesign({
        name: newDesignName.trim(),
        teamId: newDesignTeam,
        designType: newDesignType,
        designSeries: seriesForCreate,
        colors: newDesignColors.map((c) => ({
          ...c,
          role: c.role || "team_primary",
        })),
        internalNotes: internalNotes.trim() || undefined,
      });

      const designId = result.designId;

      await uploadDesignFile(designId, "lightPng", lightPngFile);
      await uploadDesignFile(designId, "darkPng", darkPngFile);
      if (lightSvgFile) await uploadDesignFile(designId, "lightSvg", lightSvgFile);
      if (darkSvgFile) await uploadDesignFile(designId, "darkSvg", darkSvgFile);
      if (lightPdfFile) await uploadDesignFile(designId, "lightPdf", lightPdfFile);
      if (darkPdfFile) await uploadDesignFile(designId, "darkPdf", darkPdfFile);

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
    setNewDesignLeague("");
    setNewDesignTeam("");
    setNewDesignType("city_69");
    setNewDesignSeries("");
    setInternalNotes("");
    setNewDesignColors([...CREATE_MODAL_STANDARD_COLORS]);
    setLightPngFile(null);
    setDarkPngFile(null);
    setLightSvgFile(null);
    setDarkSvgFile(null);
    setLightPdfFile(null);
    setDarkPdfFile(null);
    setCreateError(null);
  };

  const completenessStyle = (level: string) => {
    if (level === "complete") return "bg-green-100 text-green-700";
    if (level === "partial") return "bg-yellow-100 text-yellow-700";
    return "bg-red-100 text-red-700";
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
            <h1 className="text-2xl font-bold text-gray-900">Design Library</h1>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Reusable artwork inventory: what exists, which league/team, and whether assets are uploaded. Products
              reference designs separately.{" "}
              <Link href="/design-teams" className="text-blue-600 hover:text-blue-800 underline font-medium">
                Browse team roster
              </Link>{" "}
              (all <code className="text-xs bg-gray-100 px-1 rounded">design_teams</code> — colors &amp; metadata).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/designs/bulk-upload"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
            >
              Bulk upload designs
            </Link>
            <Link
              href="/designs/batch"
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
            >
              Batch import (legacy + products)
            </Link>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 border border-dashed border-gray-400 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
            >
              Manual create (single)
            </button>
          </div>
        </div>

        {/* Filters: League → Team first */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">League</label>
              <select
                value={leagueFilter}
                onChange={(e) => {
                  setLeagueFilter(e.target.value);
                  setTeamFilter("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All leagues</option>
                {leagues.map((lg) => (
                  <option key={lg} value={lg}>
                    {lg}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Team</label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All teams</option>
                {teamsForLeague.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Design theme</label>
              <select
                value={designTypeFilter}
                onChange={(e) => setDesignTypeFilter((e.target.value || "") as DesignDesignType | "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All themes</option>
                {DESIGN_THEME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Series</label>
              <input
                type="text"
                placeholder="e.g. will_drop_for"
                value={seriesFilter}
                onChange={(e) => setSeriesFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as DesignStatus | "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
              <input
                type="text"
                placeholder="Name, team, league…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
                    Preview
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Design name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    League
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Design theme
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Series
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Assets
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Used on
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {displayDesigns.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                      No designs match your filters. Create a design or adjust filters.
                    </td>
                  </tr>
                ) : (
                  displayDesigns.map((design) => {
                    const completeness = computeDesignCompleteness(design);
                    const preview = getDesignPreviewUrl(design);
                    const linked = getProductsForDesign(design.id);
                    return (
                      <tr key={design.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                            {preview ? (
                              <img
                                src={preview}
                                alt=""
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900">{design.name}</div>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-800">{leagueLabelForDesign(design)}</td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-800">
                            {design.teamNameCache || design.teamId}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-800">{designThemeLabel(design.designType)}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 font-mono" title={design.designSeries || undefined}>
                          {design.designSeries || "—"}
                        </td>
                        <td className="px-4 py-4">
                          {(() => {
                            const { light, dark, white } = designGarmentAssetBadges(design);
                            return (
                              <div className="flex flex-wrap gap-1">
                                <span
                                  className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded font-medium ${
                                    light ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                                  }`}
                                >
                                  Light Garment {light ? "✓" : "missing"}
                                </span>
                                <span
                                  className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded font-medium ${
                                    dark ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                                  }`}
                                >
                                  Dark Garment {dark ? "✓" : "missing"}
                                </span>
                                <span
                                  className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded font-medium ${
                                    white ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                                  }`}
                                >
                                  White artwork {white ? "✓" : "missing"}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          {productsIndexLoading ? (
                            <span className="text-gray-400">…</span>
                          ) : linked.length === 0 ? (
                            <span className="text-gray-400">0 products</span>
                          ) : (
                            <div className="space-y-1">
                              <span className="text-gray-800 font-medium">{linked.length} product{linked.length !== 1 ? "s" : ""}</span>
                              <div className="flex flex-wrap gap-1">
                                {linked.slice(0, 3).map((p: ProductDesignLink) => (
                                  <Link
                                    key={p.id}
                                    href={`/products/${encodeURIComponent(p.slug)}`}
                                    className="inline-block max-w-[140px] truncate text-xs text-blue-600 hover:underline"
                                    title={p.name}
                                  >
                                    {p.name}
                                  </Link>
                                ))}
                                {linked.length > 3 && (
                                  <span className="text-xs text-gray-500">+{linked.length - 3}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-flex items-center w-fit px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(
                                design.status
                              )}`}
                            >
                              {design.status}
                            </span>
                            <span
                              className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-[10px] font-medium ${completenessStyle(
                                completeness.level
                              )}`}
                              title={completeness.detail}
                            >
                              {completeness.label}
                            </span>
                          </div>
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
        {!isLoading && displayDesigns.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {displayDesigns.length} design{displayDesigns.length !== 1 ? "s" : ""}
            {designs.length !== displayDesigns.length && (
              <span className="text-gray-400"> (of {designs.length} total)</span>
            )}
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
        title="Manual create (single design)"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            For one-off entry when filenames are not available. For multiple tone files (light / dark / white), use{" "}
            <Link href="/designs/bulk-upload" className="text-blue-600 font-medium underline">
              Bulk upload designs
            </Link>
            .
          </p>
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
              placeholder="e.g., San Francisco Giants – City 69"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use team + concept (not garment colors like “Heather Grey”).
            </p>
          </div>

          {/* League → Team (team colors load only after team is selected) */}
          {teams.length === 0 ? (
            <p className="text-sm text-gray-600">
              No teams in <code className="text-xs bg-gray-100 px-1 rounded">design_teams</code>. Seed the roster from{" "}
              <code className="text-xs bg-gray-100 px-1 rounded">functions/</code>{" "}
              <code className="text-xs bg-gray-100 px-1 rounded">npm run seed:design-teams</code>, then check{" "}
              <Link href="/design-teams" className="text-blue-600 underline font-medium">
                Team roster
              </Link>
              .
            </p>
          ) : (
            <>
              {createModalHasLeagueStep ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">League *</label>
                  <select
                    value={newDesignLeague}
                    onChange={(e) => onCreateModalLeagueChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                  >
                    <option value="">Select a league</option>
                    {leagues.map((lg) => (
                      <option key={lg} value={lg}>
                        {lg}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[#737373] mt-1">
                    Then choose a team. Roster brand colors appear in the list below only after you pick a team.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-800">
                  No <code className="text-xs bg-gray-100 px-1 rounded">league</code> /{" "}
                  <code className="text-xs bg-gray-100 px-1 rounded">leagueId</code> on roster teams — select a team
                  below. Brand colors load after you choose a team.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team *</label>
                <select
                  value={newDesignTeam}
                  onChange={(e) => onCreateModalTeamChange(e.target.value)}
                  disabled={
                    createModalHasLeagueStep &&
                    (!newDesignLeague.trim() || teamsForCreateModal.length === 0)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 disabled:bg-gray-100 disabled:text-gray-700 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {createModalHasLeagueStep && !newDesignLeague.trim()
                      ? "Select a league first"
                      : createModalHasLeagueStep && teamsForCreateModal.length === 0
                        ? "No teams in this league"
                        : "Select a team"}
                  </option>
                  {(createModalHasLeagueStep ? teamsForCreateModal : teams).map((team) => (
                    <option key={team.id} value={team.id}>
                      {createModalHasLeagueStep ? team.name : teamOptionLabel(team)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Design theme (concept / campaign — not visual style) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Design theme *</label>
            <select
              value={newDesignType}
              onChange={(e) => setNewDesignType(e.target.value as DesignDesignType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              {DESIGN_THEME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#737373] mt-1">
              What the design is conceptually (library, filters, batch). Not the same as visual style.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Design series (optional)</label>
            <input
              type="text"
              value={newDesignSeries}
              onChange={(e) => setNewDesignSeries(e.target.value)}
              onBlur={() => setNewDesignSeries((v) => normalizeDesignSeriesInput(v) ?? "")}
              placeholder="e.g. will_drop_for"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-[#737373] mt-1">
              Group related designs (e.g. city_69, will_drop_for, bad_decisions). Leave blank if one-off. Normalizes on
              blur to lowercase snake_case.
            </p>
          </div>

          {/* Colors */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Print colors * (role + hex)
            </label>
            <p className="text-xs text-[#737373] mb-2">
              <strong>Off Black</strong> and <strong>Off White</strong> are always listed for printer orders. Team / brand
              rows appear above them <strong>after you select a team</strong> (from roster{" "}
              <code className="text-[10px] bg-gray-100 px-1 rounded">teamColors</code> or primary/secondary hex). Edit roles
              as needed — if you remove the standard rows, they can be re-added on save.
            </p>
            <div className="space-y-2">
              {newDesignColors.map((color, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    value={color.role || "team_primary"}
                    onChange={(e) => handleColorChange(index, "role", e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm min-w-[8rem]"
                  >
                    {PRINT_COLOR_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
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
                    placeholder="#RRGGBB"
                    className="w-28 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    value={color.name || ""}
                    onChange={(e) => handleColorChange(index, "name", e.target.value)}
                    placeholder="Label (optional)"
                    className="flex-1 min-w-[6rem] px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  {newDesignColors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveColor(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddColor}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add color
              </button>
            </div>
          </div>

          {/* Assets — garment variants (not ink / not a design-mode toggle) */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/80 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Assets</h3>
              <p className="text-xs text-gray-500 mt-1">
                Artwork tone files (light / dark / white): these are side-agnostic unless you add per-side files on the
                design detail page. Garment print placement comes from the blank and product build, not from filenames.
                PNGs here map to <code className="text-[10px] bg-white px-1 rounded">assets.lightPng</code> /{" "}
                <code className="text-[10px] bg-white px-1 rounded">assets.darkPng</code>. Optional SVG/PDF follow the
                same tone split for production masters.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Light Garment PNG *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Use for light-colored garments (white, grey, etc.). → <code className="text-xs">assets.lightPng</code>
                </p>
                <input
                  ref={lightInputRef}
                  type="file"
                  accept="image/png"
                  className="text-sm w-full"
                  onChange={(e) => setLightPngFile(e.target.files?.[0] || null)}
                />
                {lightPngFile && (
                  <p className="text-xs text-gray-500 mt-1">
                    {lightPngFile.name}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dark Garment PNG *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Use for dark-colored garments (black, navy, etc.). → <code className="text-xs">assets.darkPng</code>
                </p>
                <input
                  ref={darkInputRef}
                  type="file"
                  accept="image/png"
                  className="text-sm w-full"
                  onChange={(e) => setDarkPngFile(e.target.files?.[0] || null)}
                />
                {darkPngFile && (
                  <p className="text-xs text-gray-500 mt-1">
                    {darkPngFile.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Light garment SVG (optional)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Production vector for light blanks → <code className="text-xs">assets.lightSvg</code>
              </p>
              <input
                ref={lightSvgInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="text-sm w-full"
                onChange={(e) => setLightSvgFile(e.target.files?.[0] || null)}
              />
              {lightSvgFile && (
                <p className="text-xs text-gray-500 mt-1">{lightSvgFile.name}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dark garment SVG (optional)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Production vector for dark blanks → <code className="text-xs">assets.darkSvg</code>
              </p>
              <input
                ref={darkSvgInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="text-sm w-full"
                onChange={(e) => setDarkSvgFile(e.target.files?.[0] || null)}
              />
              {darkSvgFile && (
                <p className="text-xs text-gray-500 mt-1">{darkSvgFile.name}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Light garment PDF (optional)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Print-ready for light blanks → <code className="text-xs">assets.lightPdf</code>
              </p>
              <input
                ref={lightPdfInputRef}
                type="file"
                accept="application/pdf"
                className="text-sm w-full"
                onChange={(e) => setLightPdfFile(e.target.files?.[0] || null)}
              />
              {lightPdfFile && (
                <p className="text-xs text-gray-500 mt-1">{lightPdfFile.name}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dark garment PDF (optional)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Print-ready for dark blanks → <code className="text-xs">assets.darkPdf</code>
              </p>
              <input
                ref={darkPdfInputRef}
                type="file"
                accept="application/pdf"
                className="text-sm w-full"
                onChange={(e) => setDarkPdfFile(e.target.files?.[0] || null)}
              />
              {darkPdfFile && (
                <p className="text-xs text-gray-500 mt-1">{darkPdfFile.name}</p>
              )}
            </div>
          </div>

          {/* Internal notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal notes (optional)
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Operator notes only — not product or Shopify copy."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
