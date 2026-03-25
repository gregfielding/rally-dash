"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Modal from "@/components/Modal";
import TeamProductMatrixPanel from "@/components/design-teams/TeamProductMatrixPanel";
import { useDesignTeams } from "@/lib/hooks/useDesignAssets";
import type { DesignTeam, DesignTeamColor } from "@/lib/types/firestore";

type TeamDetailTab = "overview" | "colors" | "products";

function formatCmyk(c: DesignTeamColor["cmyk"] | null | undefined): string {
  if (!c) return "—";
  return `C${c.c} M${c.m} Y${c.y} K${c.k}`;
}

function teamSwatches(team: DesignTeam): { hex: string; label: string }[] {
  const fromPalette = team.teamColors;
  if (Array.isArray(fromPalette) && fromPalette.length > 0) {
    return fromPalette.map((c) => ({
      hex: c.hex,
      label: `${c.role}${c.name ? ` · ${c.name}` : ""}`,
    }));
  }
  const out: { hex: string; label: string }[] = [];
  if (team.primaryColorHex) out.push({ hex: team.primaryColorHex, label: "primary" });
  if (team.secondaryColorHex) out.push({ hex: team.secondaryColorHex, label: "secondary" });
  return out;
}

function DesignTeamsRosterContent() {
  const { teams, isLoading, error, mutate } = useDesignTeams();
  const [leagueFilter, setLeagueFilter] = useState("");
  const [search, setSearch] = useState("");
  const [detailTeam, setDetailTeam] = useState<DesignTeam | null>(null);
  const [detailTab, setDetailTab] = useState<TeamDetailTab>("overview");

  useEffect(() => {
    if (detailTeam) setDetailTab("overview");
  }, [detailTeam?.id]);

  const leagues = useMemo(() => {
    const s = new Set<string>();
    for (const t of teams) {
      const lg = (t.league || t.leagueId || t.leagueCode || "").trim();
      if (lg) s.add(lg);
    }
    return [...s].sort();
  }, [teams]);

  const filtered = useMemo(() => {
    let list = teams;
    if (leagueFilter) {
      list = list.filter((t) => {
        const lg = (t.league || t.leagueId || t.leagueCode || "").trim();
        return lg === leagueFilter;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const hay = [
          t.name,
          t.teamName,
          t.city,
          t.state,
          t.teamCode,
          t.slug,
          ...(t.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, leagueFilter, search]);

  const countsByLeague = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of teams) {
      const lg = (t.league || t.leagueId || t.leagueCode || "—").trim() || "—";
      m[lg] = (m[lg] || 0) + 1;
    }
    return m;
  }, [teams]);

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <p className="text-sm text-gray-500 mb-2">
          <Link href="/designs" className="text-blue-600 hover:text-blue-800 underline">
            ← Designs
          </Link>
          {" · "}
          <Link href="/design-system" className="text-blue-600 hover:text-blue-800 underline">
            Design system (colors)
          </Link>
          {" · "}
          <Link href="/docs/design-guide" className="text-blue-600 hover:text-blue-800 underline">
            Design guide
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-gray-900">Team roster</h1>
        <p className="text-gray-600 text-sm mt-1 max-w-3xl">
          Read-only view of the <code className="bg-gray-100 px-1 rounded text-xs">design_teams</code>{" "}
          collection (canonical Phase 1 seed + any manual rows). This is{" "}
          <strong>not</strong> the legacy <code className="bg-gray-100 px-1 rounded text-xs">/teams</code>{" "}
          page.
        </p>
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-950">
          <strong>Blanks → “Seed”</strong> only seeds <em>master blanks</em> (garment styles) — it does{" "}
          <strong>not</strong> add sports teams. To load the big roster, run from{" "}
          <code className="bg-amber-100 px-1 rounded text-xs">functions/</code>:{" "}
          <code className="bg-amber-100 px-1 rounded text-xs">npm run seed:design-teams</code>{" "}
          (use <code className="bg-amber-100 px-1 rounded text-xs">--merge</code> to refresh fields). The
          “Seed teams” control on <Link href="/designs" className="underline font-medium">Designs</Link> calls
          an older sample callable and skips documents that already exist — it won’t replace Phase 1 data.
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end mb-4">
        <div>
          <label htmlFor="dt-league" className="block text-xs font-medium text-gray-600 mb-1">
            League
          </label>
          <select
            id="dt-league"
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm min-w-[10rem]"
          >
            <option value="">All leagues ({teams.length})</option>
            {leagues.map((lg) => (
              <option key={lg} value={lg}>
                {lg} ({countsByLeague[lg] ?? 0})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[12rem] max-w-md">
          <label htmlFor="dt-search" className="block text-xs font-medium text-gray-600 mb-1">
            Search
          </label>
          <input
            id="dt-search"
            type="search"
            placeholder="Name, city, team code, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => mutate()}
          className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {String(error)}
        </div>
      )}

      {isLoading && (
        <p className="text-gray-500 text-sm py-8">Loading design_teams…</p>
      )}

      {!isLoading && teams.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-600 text-sm">
          No teams in <code className="bg-gray-100 px-1 rounded">design_teams</code>. Run the Phase 1 seed
          from <code className="bg-gray-100 px-1 rounded">functions/</code> (see amber note above).
        </div>
      )}

      {!isLoading && teams.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
          <p className="text-xs text-gray-500 px-4 py-2 border-b border-gray-100">
            Showing <strong>{filtered.length}</strong> of {teams.length} teams
            {leagueFilter ? ` · league = ${leagueFilter}` : ""}
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">League</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Code / slug</th>
                <th className="px-4 py-3">Colors</th>
                <th className="px-4 py-3">Families</th>
                <th className="px-4 py-3">Verify</th>
                <th className="px-4 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50/80 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{t.name}</div>
                    {t.teamName && t.teamName !== t.name && (
                      <div className="text-xs text-gray-500">{t.teamName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {t.league || t.leagueId || t.leagueCode || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {[t.city, t.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    <div>{t.teamCode || "—"}</div>
                    {t.slug && <div className="text-gray-400">{t.slug}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {teamSwatches(t).map((s, i) => (
                        <span
                          key={`${s.hex}-${i}`}
                          title={s.label}
                          className="inline-block h-8 w-8 rounded border border-gray-200 shadow-sm shrink-0"
                          style={{ backgroundColor: s.hex }}
                        />
                      ))}
                    </div>
                    {Array.isArray(t.teamColors) && t.teamColors.length > 0 && (
                      <div className="mt-1 text-[10px] text-gray-500 max-w-[14rem] leading-tight">
                        {t.teamColors.map((c) => c.hex).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[10rem]">
                    {(t.colorFamilies || []).length ? (
                      <span className="line-clamp-3">{(t.colorFamilies || []).join(", ")}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    <div>color: {t.colorVerificationStatus || "—"}</div>
                    <div>print: {t.printVerificationStatus || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDetailTeam(t)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={!!detailTeam}
        onClose={() => setDetailTeam(null)}
        title={detailTeam?.name ?? "Team"}
        size="large"
      >
        {detailTeam && (
          <div className="text-sm text-gray-800 flex flex-col max-h-[75vh] min-h-0">
            <div className="flex gap-1 border-b border-gray-200 pb-2 mb-3 shrink-0">
              {(
                [
                  ["overview", "Overview"],
                  ["colors", "Colors / metadata"],
                  ["products", "Product catalog"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDetailTab(id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    detailTab === id
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="overflow-y-auto pr-1 flex-1 min-h-0 space-y-4">
              {detailTab === "overview" && (
                <>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    <dt className="text-gray-500 text-xs">Firestore id</dt>
                    <dd className="font-mono text-xs">{detailTeam.id}</dd>
                    <dt className="text-gray-500 text-xs">teamCode</dt>
                    <dd className="font-mono text-xs">{detailTeam.teamCode ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">League</dt>
                    <dd>{detailTeam.league || detailTeam.leagueId || detailTeam.leagueCode || "—"}</dd>
                    <dt className="text-gray-500 text-xs">City / state</dt>
                    <dd>{[detailTeam.city, detailTeam.state].filter(Boolean).join(", ") || "—"}</dd>
                    <dt className="text-gray-500 text-xs">Stadium</dt>
                    <dd>{detailTeam.stadiumName ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">Team saying</dt>
                    <dd>{detailTeam.teamSaying ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">Fan phrase</dt>
                    <dd>{detailTeam.fanPhrase ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">Mascot</dt>
                    <dd>{detailTeam.mascot ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">Rivals (codes)</dt>
                    <dd>{(detailTeam.rivals || []).join(", ") || "—"}</dd>
                    <dt className="text-gray-500 text-xs">Tags</dt>
                    <dd className="text-xs">{(detailTeam.tags || []).join(", ") || "—"}</dd>
                    <dt className="text-gray-500 text-xs">Region</dt>
                    <dd className="text-xs">{(detailTeam.region || []).join(", ") || "—"}</dd>
                    <dt className="text-gray-500 text-xs">Hashtags</dt>
                    <dd className="text-xs">{(detailTeam.hashtags || []).join(", ") || "—"}</dd>
                  </dl>
                  {detailTeam.fanPhrases && detailTeam.fanPhrases.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                        Fan phrases (curated)
                      </h3>
                      <ul className="text-xs space-y-1 list-disc pl-4">
                        {detailTeam.fanPhrases.map((fp, i) => (
                          <li key={i}>
                            {fp.text}{" "}
                            <span className="text-gray-400">
                              ({fp.type}, verified: {String(fp.verified)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {detailTab === "colors" && (
                <div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-4">
                    <dt className="text-gray-500 text-xs">Color families</dt>
                    <dd className="text-xs">
                      {(detailTeam.colorFamilies || []).length
                        ? (detailTeam.colorFamilies || []).join(", ")
                        : "—"}
                    </dd>
                    <dt className="text-gray-500 text-xs">Color verification</dt>
                    <dd className="text-xs">{detailTeam.colorVerificationStatus ?? "—"}</dd>
                    <dt className="text-gray-500 text-xs">Print verification</dt>
                    <dd className="text-xs">{detailTeam.printVerificationStatus ?? "—"}</dd>
                  </dl>
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                    Brand colors
                  </h3>
                  {detailTeam.teamColors && detailTeam.teamColors.length > 0 ? (
                    <ul className="space-y-2">
                      {detailTeam.teamColors.map((c, i) => (
                        <li
                          key={i}
                          className="flex gap-3 items-start border border-gray-100 rounded-md p-2 bg-gray-50"
                        >
                          <span
                            className="h-10 w-10 rounded border border-gray-200 shrink-0 mt-0.5"
                            style={{ backgroundColor: c.hex }}
                          />
                          <div>
                            <div className="font-medium">
                              {c.role}
                              {c.name ? ` · ${c.name}` : ""}
                            </div>
                            <div className="font-mono text-xs text-gray-700">{c.hex}</div>
                            <div className="text-xs text-gray-500">{formatCmyk(c.cmyk)}</div>
                            {c.pantone && (
                              <div className="text-xs text-gray-500">Pantone: {c.pantone}</div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-500 text-xs">
                      primary: {detailTeam.primaryColorHex ?? "—"} · secondary:{" "}
                      {detailTeam.secondaryColorHex ?? "—"}
                    </p>
                  )}
                </div>
              )}
              {detailTab === "products" && (
                <TeamProductMatrixPanel
                  team={detailTeam}
                  onSaved={(next) => {
                    setDetailTeam((t) => (t && t.id === detailTeam.id ? { ...t, productCatalogMatrix: next } : t));
                    mutate();
                  }}
                />
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function DesignTeamsRosterPage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <DesignTeamsRosterContent />
    </ProtectedRoute>
  );
}
