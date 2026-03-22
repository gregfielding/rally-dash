"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useDesignSystemLeagues } from "@/lib/hooks/useDesignSystemLeagues";
import {
  buildIllustratorSwatchExport,
  buildTeamSwatchJsonObject,
} from "@/lib/designSystem/export";
import {
  teamHexClipboard,
  teamCmykClipboard,
  formatCmykLine,
} from "@/lib/designSystem/format";
import type { DesignSystemLeague, DesignSystemPaletteTeam } from "@/lib/types/firestore";

async function copyText(label: string, text: string, onDone: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onDone(`Copied ${label}`);
  } catch {
    onDone("Copy failed — check browser permissions");
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DesignSystemContent() {
  const { leagues, loading, error, refetch } = useDesignSystemLeagues();
  const [leagueId, setLeagueId] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const selectedLeague: DesignSystemLeague | null = useMemo(() => {
    if (!leagues.length) return null;
    const id = leagueId || leagues[0].id;
    return leagues.find((l) => l.id === id) ?? leagues[0];
  }, [leagues, leagueId]);

  const exportAllSwatches = useCallback(() => {
    if (!leagues.length) {
      showToast("No leagues to export");
      return;
    }
    const payload = buildIllustratorSwatchExport(leagues);
    downloadJson("illustrator-swatches.json", payload);
    showToast("Downloaded illustrator-swatches.json");
  }, [leagues, showToast]);

  return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Design system</h1>
            <p className="text-gray-600 mt-1 text-sm">
              League and team color libraries — source of truth for Illustrator workflow and future
              imports.
            </p>
            <p className="mt-2">
              <Link
                href="/docs/design-guide"
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Design guide (workflow &amp; naming)
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => refetch()}
              className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={exportAllSwatches}
              disabled={!leagues.length}
              className="px-3 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Export Illustrator swatches
            </button>
          </div>
        </div>

        {toast && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-2">
            {toast}
          </div>
        )}

        {loading && (
          <p className="text-gray-500 text-sm">Loading design_system…</p>
        )}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!loading && !leagues.length && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 text-sm">
            <p className="font-medium">No league documents yet</p>
            <p className="mt-2">
              Add documents to the Firestore collection{" "}
              <code className="bg-amber-100 px-1 rounded">design_system</code> with document ID =
              league code (e.g. <code className="bg-amber-100 px-1 rounded">MLB</code>). See{" "}
              <Link href="/docs/design-guide" className="underline font-medium">
                /docs/design-guide
              </Link>{" "}
              and sample{" "}
              <code className="bg-amber-100 px-1 rounded">
                data/firestore-seeds/design-system-mlb.example.json
              </code>
              .
            </p>
          </div>
        )}

        {leagues.length > 0 && (
          <>
            <div className="mb-6">
              <label htmlFor="league-select" className="block text-sm font-medium text-gray-700 mb-1">
                League
              </label>
              <select
                id="league-select"
                value={selectedLeague?.id ?? ""}
                onChange={(e) => setLeagueId(e.target.value)}
                className="block max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.leagueName} ({l.leagueCode})
                  </option>
                ))}
              </select>
            </div>

            {selectedLeague && (
              <TeamTable
                league={selectedLeague}
                onCopy={copyText}
                showToast={showToast}
              />
            )}
          </>
        )}
      </div>
  );
}

function TeamTable({
  league,
  onCopy,
  showToast,
}: {
  league: DesignSystemLeague;
  onCopy: (label: string, text: string, onDone: (msg: string) => void) => void;
  showToast: (msg: string) => void;
}) {
  const teams = league.teams || [];

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Team</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Code</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Swatches</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Values</th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700">Copy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                No teams on this league document.
              </td>
            </tr>
          )}
          {teams.map((team: DesignSystemPaletteTeam) => (
            <tr key={team.teamCode} className="hover:bg-gray-50/80">
              <td className="px-4 py-3 font-medium text-gray-900">{team.teamName}</td>
              <td className="px-4 py-3 text-gray-600 font-mono text-xs">{team.teamCode}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(team.colors || []).map((c, i) => (
                    <span
                      key={`${c.role}-${i}`}
                      title={`${c.name} (${c.role})`}
                      className="inline-block h-9 w-9 rounded border border-gray-200 shadow-sm"
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-gray-700 max-w-md">
                <ul className="space-y-1">
                  {(team.colors || []).map((c, i) => (
                    <li key={`${c.role}-v-${i}`}>
                      <span className="font-medium text-gray-800">{c.name}</span>{" "}
                      <span className="font-mono text-gray-600">{c.hex}</span>
                      <span className="text-gray-500"> · {formatCmykLine(c.cmyk)}</span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <div className="flex flex-col sm:flex-row gap-1 justify-end">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-100"
                    onClick={() =>
                      onCopy("HEX", teamHexClipboard(team.colors || []), showToast)
                    }
                  >
                    Copy HEX
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-100"
                    onClick={() =>
                      onCopy("CMYK", teamCmykClipboard(team.colors || []), showToast)
                    }
                  >
                    Copy CMYK
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-100"
                    onClick={() => {
                      const obj = buildTeamSwatchJsonObject(league, team.teamCode);
                      if (!obj) {
                        showToast("Nothing to copy");
                        return;
                      }
                      onCopy(
                        "Illustrator swatch JSON",
                        JSON.stringify(obj, null, 2),
                        showToast
                      );
                    }}
                  >
                    Copy swatch JSON
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <DesignSystemContent />
    </ProtectedRoute>
  );
}
