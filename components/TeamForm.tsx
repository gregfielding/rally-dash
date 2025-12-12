"use client";

import { useState, FormEvent } from "react";
import { Team, League } from "@/lib/types/firestore";

interface TeamFormProps {
  team?: Team;
  leagues: League[];
  onSubmit: (team: Omit<Team, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function TeamForm({ team, leagues, onSubmit, onCancel, loading }: TeamFormProps) {
  const [leagueId, setLeagueId] = useState(team?.leagueId || "");
  const [name, setName] = useState(team?.name || "");
  const [city, setCity] = useState(team?.city || "");
  const [primaryColor, setPrimaryColor] = useState(team?.colors?.primary || "#000000");
  const [secondaryColor, setSecondaryColor] = useState(team?.colors?.secondary || "#ffffff");
  const [accentColor, setAccentColor] = useState(team?.colors?.accent || "");
  const [keywords, setKeywords] = useState(team?.keywords?.join(", ") || "");
  const [bannedTerms, setBannedTerms] = useState(team?.bannedTerms?.join(", ") || "");
  const [notes, setNotes] = useState(team?.notes || "");
  const [active, setActive] = useState(team?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!leagueId) newErrors.leagueId = "League is required";
    if (!name.trim()) newErrors.name = "Name is required";
    if (!city.trim()) newErrors.city = "City is required";
    if (!primaryColor.match(/^#[0-9A-F]{6}$/i)) newErrors.primaryColor = "Invalid hex color";
    if (!secondaryColor.match(/^#[0-9A-F]{6}$/i)) newErrors.secondaryColor = "Invalid hex color";
    if (accentColor && !accentColor.match(/^#[0-9A-F]{6}$/i)) {
      newErrors.accentColor = "Invalid hex color";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await onSubmit({
        leagueId,
        name,
        slug: "",
        city,
        colors: {
          primary: primaryColor,
          secondary: secondaryColor,
          ...(accentColor && { accent: accentColor }),
        },
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        bannedTerms: bannedTerms.split(",").map((t) => t.trim()).filter(Boolean),
        notes: notes || undefined,
        active,
      });
    } catch (error: any) {
      setErrors({ submit: error.message || "Failed to save team" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
      {errors.submit && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {errors.submit}
        </div>
      )}

      <div>
        <label htmlFor="leagueId" className="block text-sm font-medium text-gray-700 mb-1">
          League *
        </label>
        <select
          id="leagueId"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Select a league</option>
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>
        {errors.leagueId && <p className="mt-1 text-sm text-red-600">{errors.leagueId}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Team Name *
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Ohio State"
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
            City *
          </label>
          <input
            type="text"
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Columbus"
          />
          {errors.city && <p className="mt-1 text-sm text-red-600">{errors.city}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="primaryColor" className="block text-sm font-medium text-gray-700 mb-1">
            Primary Color *
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              id="primaryColor"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-10 w-16 border border-gray-300 rounded cursor-pointer"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="#000000"
            />
          </div>
          {errors.primaryColor && <p className="mt-1 text-sm text-red-600">{errors.primaryColor}</p>}
        </div>

        <div>
          <label htmlFor="secondaryColor" className="block text-sm font-medium text-gray-700 mb-1">
            Secondary Color *
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              id="secondaryColor"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="h-10 w-16 border border-gray-300 rounded cursor-pointer"
            />
            <input
              type="text"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="#ffffff"
            />
          </div>
          {errors.secondaryColor && <p className="mt-1 text-sm text-red-600">{errors.secondaryColor}</p>}
        </div>

        <div>
          <label htmlFor="accentColor" className="block text-sm font-medium text-gray-700 mb-1">
            Accent Color (optional)
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              id="accentColor"
              value={accentColor || "#000000"}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-10 w-16 border border-gray-300 rounded cursor-pointer"
            />
            <input
              type="text"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="#cccccc"
            />
          </div>
          {errors.accentColor && <p className="mt-1 text-sm text-red-600">{errors.accentColor}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="keywords" className="block text-sm font-medium text-gray-700 mb-1">
          Keywords (comma-separated)
        </label>
        <input
          type="text"
          id="keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="e.g., buckeye, osu, go bucks"
        />
        <p className="mt-1 text-xs text-gray-500">Fan phrases and keywords</p>
      </div>

      <div>
        <label htmlFor="bannedTerms" className="block text-sm font-medium text-gray-700 mb-1">
          Banned Terms (comma-separated)
        </label>
        <input
          type="text"
          id="bannedTerms"
          value={bannedTerms}
          onChange={(e) => setBannedTerms(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="e.g., Ohio State University, OSU"
        />
        <p className="mt-1 text-xs text-gray-500">Protected marks to avoid</p>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Additional notes..."
        />
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="active" className="ml-2 block text-sm text-gray-700">
          Active
        </label>
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : team ? "Update Team" : "Create Team"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

