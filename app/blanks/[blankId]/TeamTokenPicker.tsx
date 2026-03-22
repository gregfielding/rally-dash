"use client";

import { useMemo, useState } from "react";
import type { DesignTeam } from "@/lib/types/firestore";

export function TeamTokenPicker({
  label,
  teams,
  selectedIds,
  onChange,
  otherSelected,
  placeholder,
}: {
  label: string;
  teams: DesignTeam[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  otherSelected: Set<string>;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return teams.slice(0, 12);
    return teams
      .filter(
        (t) =>
          t.id.toLowerCase().includes(s) ||
          (t.name && t.name.toLowerCase().includes(s)) ||
          (t.leagueId && t.leagueId.toLowerCase().includes(s)) ||
          (t.league && t.league.toLowerCase().includes(s)) ||
          (t.city && t.city.toLowerCase().includes(s)) ||
          (t.teamName && t.teamName.toLowerCase().includes(s))
      )
      .slice(0, 20);
  }, [teams, q]);

  const add = (id: string) => {
    if (selectedIds.includes(id) || otherSelected.has(id)) return;
    onChange([...selectedIds, id]);
    setQ("");
  };
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex flex-wrap gap-1 min-h-[2rem]">
        {selectedIds.map((id) => {
          const t = teams.find((x) => x.id === id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-900 text-xs border border-blue-100"
            >
              {t?.name ?? id}
              <button type="button" className="text-blue-600 hover:text-blue-800" onClick={() => remove(id)} aria-label="Remove">
                ×
              </button>
            </span>
          );
        })}
      </div>
      <input
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim() && (
        <ul className="border border-gray-200 rounded-lg max-h-36 overflow-y-auto text-sm bg-white shadow-sm">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-40"
                disabled={selectedIds.includes(t.id) || otherSelected.has(t.id)}
                onClick={() => add(t.id)}
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-gray-500 text-xs ml-2">
                  {t.leagueId || t.league || ""}
                  {t.city ? ` · ${t.city}` : ""}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-2 text-gray-500">No matches</li>}
        </ul>
      )}
    </div>
  );
}
