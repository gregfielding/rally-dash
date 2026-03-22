"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RPBlank, RPBlankEligibility, RPPlacementId } from "@/lib/types/firestore";
import type { UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { useDesignTeams } from "@/lib/hooks/useDesignAssets";
import Modal from "@/components/Modal";
import {
  TEAM_COLOR_FAMILY_OPTIONS,
  computeEligibleTeams,
  getEffectiveEligibility,
  countActiveVariants,
  isMasterBlank,
} from "@/lib/blanks";
import { TeamTokenPicker } from "./TeamTokenPicker";

const PLACEMENT_ZONE_OPTIONS: RPPlacementId[] = [
  "front_center",
  "back_center",
  "front_left",
  "front_right",
  "back_left",
  "back_right",
];

function emptyEligibility(): RPBlankEligibility {
  return {
    allowedLeagues: [],
    allowAllTeamsInAllowedLeagues: true,
    matchTeamColorFamilies: false,
    allowedTeamColorFamilies: [],
    supportedDesignZones: [],
    supportedProductFamilies: [],
    includedTeamIds: [],
    excludedTeamIds: [],
  };
}

function normalizeIncoming(e: RPBlankEligibility | null | undefined): RPBlankEligibility {
  if (!e) return emptyEligibility();
  return {
    allowedLeagues: [...(e.allowedLeagues ?? [])].filter(Boolean),
    allowAllTeamsInAllowedLeagues: e.allowAllTeamsInAllowedLeagues !== false,
    matchTeamColorFamilies: e.matchTeamColorFamilies === true,
    allowedTeamColorFamilies: [...(e.allowedTeamColorFamilies ?? [])].filter(Boolean),
    supportedDesignZones: [...(e.supportedDesignZones ?? [])].filter(Boolean),
    supportedProductFamilies: [...(e.supportedProductFamilies ?? [])].filter(Boolean),
    includedTeamIds: [...(e.includedTeamIds ?? [])].filter(Boolean),
    excludedTeamIds: [...(e.excludedTeamIds ?? [])].filter(Boolean),
  };
}

export function BlankEligibilityTab({
  blank,
  updateBlank,
  refetchBlank,
  showToast,
}: {
  blank: RPBlank;
  updateBlank: (i: UpdateBlankInput) => Promise<unknown>;
  refetchBlank: () => void;
  showToast: (m: string, t: "success" | "error") => void;
}) {
  const { teams } = useDesignTeams();
  const [form, setForm] = useState<RPBlankEligibility>(() => normalizeIncoming(blank.eligibility));
  const [productFamilyInput, setProductFamilyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [allModalOpen, setAllModalOpen] = useState(false);

  useEffect(() => {
    setForm(normalizeIncoming(blank.eligibility));
  }, [blank.blankId, blank.eligibility]);

  const leagueOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const t of teams) {
      const id = t.leagueId?.trim() || t.league?.trim();
      if (!id) continue;
      const key = id.toUpperCase();
      if (!set.has(key)) set.set(key, id);
    }
    return [...set.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([, v]) => v);
  }, [teams]);

  const toggleLeague = (lg: string) => {
    const u = lg.toUpperCase();
    setForm((f) => {
      const has = (f.allowedLeagues ?? []).some((x) => x.toUpperCase() === u);
      return {
        ...f,
        allowedLeagues: has
          ? (f.allowedLeagues ?? []).filter((x) => x.toUpperCase() !== u)
          : [...(f.allowedLeagues ?? []), lg],
      };
    });
  };

  const toggleColorFamily = (c: string) => {
    const cl = c.toLowerCase();
    setForm((f) => {
      const list = f.allowedTeamColorFamilies ?? [];
      const has = list.some((x) => x.toLowerCase() === cl);
      return {
        ...f,
        allowedTeamColorFamilies: has ? list.filter((x) => x.toLowerCase() !== cl) : [...list, c],
      };
    });
  };

  const toggleZone = (z: RPPlacementId) => {
    setForm((f) => {
      const list = f.supportedDesignZones ?? [];
      const has = list.includes(z);
      return {
        ...f,
        supportedDesignZones: has ? list.filter((x) => x !== z) : [...list, z],
      };
    });
  };

  const addProductFamilyChip = () => {
    const v = productFamilyInput.trim();
    if (!v) return;
    setForm((f) =>
      (f.supportedProductFamilies ?? []).includes(v)
        ? f
        : { ...f, supportedProductFamilies: [...(f.supportedProductFamilies ?? []), v] }
    );
    setProductFamilyInput("");
  };

  const effective = useMemo(
    () =>
      getEffectiveEligibility(
        { eligibility: form },
        null
      ),
    [form]
  );

  const preview = useMemo(() => computeEligibleTeams(teams, effective), [teams, effective]);

  const excludedSet = useMemo(() => new Set(form.excludedTeamIds ?? []), [form.excludedTeamIds]);
  const includedSet = useMemo(() => new Set(form.includedTeamIds ?? []), [form.includedTeamIds]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateBlank({
        blankId: blank.blankId,
        eligibility: {
          allowedLeagues: form.allowedLeagues?.length ? form.allowedLeagues : null,
          allowAllTeamsInAllowedLeagues: form.allowAllTeamsInAllowedLeagues,
          matchTeamColorFamilies: form.matchTeamColorFamilies,
          allowedTeamColorFamilies: form.allowedTeamColorFamilies?.length ? form.allowedTeamColorFamilies : null,
          supportedDesignZones: form.supportedDesignZones?.length ? form.supportedDesignZones : null,
          supportedProductFamilies: form.supportedProductFamilies?.length ? form.supportedProductFamilies : null,
          includedTeamIds: form.includedTeamIds?.length ? form.includedTeamIds : null,
          excludedTeamIds: form.excludedTeamIds?.length ? form.excludedTeamIds : null,
        },
      });
      refetchBlank();
      showToast("Eligibility saved", "success");
    } catch (e: unknown) {
      showToast((e as Error)?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }, [blank.blankId, form, updateBlank, refetchBlank, showToast]);

  const previewSlice = preview.teams.slice(0, 18);

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-4 text-sm text-blue-950 space-y-2">
        <p className="font-medium">Use broad rules first, then add team-specific overrides only when needed.</p>
        <ul className="list-disc list-inside text-blue-900/90 space-y-1">
          <li>
            <strong>Garment colors</strong> are defined only on the <strong>Variants</strong> tab — not here. Eligibility only
            controls which <em>teams</em> can use each variant at generation time.
          </li>
          <li>Neutral colors (black, white, grey) often use broad league rules without color-family matching.</li>
          <li>Use color-family matching for team-colored blanks (e.g. royal blue → blue + navy).</li>
          <li>Use included / excluded teams for exceptions — not as the default path.</li>
        </ul>
        {isMasterBlank(blank) && (
          <p className="text-xs text-blue-800/90 pt-1">
            This master blank has <strong>{countActiveVariants(blank)}</strong> active variant(s) — each can override these rules
            in the variant editor.
          </p>
        )}
      </div>

      {/* Section 1 */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">1. Scope</h3>
        <p className="text-xs text-gray-500">Restrict which leagues are in play before applying color rules.</p>
        <div className="flex flex-wrap gap-2">
          {leagueOptions.length === 0 && <span className="text-sm text-gray-500">No leagues found in design_teams.</span>}
          {leagueOptions.map((lg) => {
            const on = (form.allowedLeagues ?? []).some((x) => x.toUpperCase() === lg.toUpperCase());
            return (
              <button
                key={lg}
                type="button"
                onClick={() => toggleLeague(lg)}
                className={`px-3 py-1.5 rounded-full text-sm border ${
                  on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {lg}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.allowAllTeamsInAllowedLeagues !== false}
            onChange={(e) => setForm((f) => ({ ...f, allowAllTeamsInAllowedLeagues: e.target.checked }))}
          />
          Allow all teams in selected leagues (then apply color filter below if enabled)
        </label>
      </section>

      {/* Section 2 */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">2. Color-family matching</h3>
        <p className="text-xs text-gray-500">
          When enabled, teams must have overlapping <code className="text-xs bg-gray-100 px-1 rounded">colorFamilies</code> on
          their design_teams record (backfill over time).
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.matchTeamColorFamilies === true}
            onChange={(e) => setForm((f) => ({ ...f, matchTeamColorFamilies: e.target.checked }))}
          />
          Restrict to teams matching selected color families
        </label>
        <div className="flex flex-wrap gap-2">
          {TEAM_COLOR_FAMILY_OPTIONS.map((c) => {
            const on = (form.allowedTeamColorFamilies ?? []).some((x) => x.toLowerCase() === c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleColorFamily(c)}
                className={`px-2.5 py-1 rounded-md text-xs capitalize border ${
                  on ? "bg-amber-100 border-amber-400 text-amber-950" : "bg-white border-gray-200 text-gray-600"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 3 */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">3. Design / product constraints</h3>
        <p className="text-xs text-gray-500">Optional hints for future generation (zones = placement ids).</p>
        <div>
          <span className="text-xs font-medium text-gray-600 block mb-2">Supported design zones</span>
          <div className="flex flex-wrap gap-2">
            {PLACEMENT_ZONE_OPTIONS.map((z) => {
              const on = (form.supportedDesignZones ?? []).includes(z);
              return (
                <button
                  key={z}
                  type="button"
                  onClick={() => toggleZone(z)}
                  className={`px-2 py-1 rounded text-xs font-mono border ${
                    on ? "bg-gray-800 text-white border-gray-800" : "bg-white border-gray-300"
                  }`}
                >
                  {z}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="text-xs font-medium text-gray-600 block mb-2">Supported product families</span>
          <div className="flex flex-wrap gap-1 mb-2">
            {(form.supportedProductFamilies ?? []).map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs border border-gray-200"
              >
                {p}
                <button
                  type="button"
                  className="text-gray-500 hover:text-red-600"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      supportedProductFamilies: (f.supportedProductFamilies ?? []).filter((x) => x !== p),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              placeholder="e.g. panty, core, premium"
              value={productFamilyInput}
              onChange={(e) => setProductFamilyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addProductFamilyChip())}
            />
            <button type="button" className="px-3 py-1.5 text-sm bg-gray-200 rounded-lg" onClick={addProductFamilyChip}>
              Add
            </button>
          </div>
        </div>
      </section>

      {/* Section 4 */}
      <details className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">4. Team overrides (exceptions)</summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <TeamTokenPicker
            label="Included teams (always add)"
            teams={teams}
            selectedIds={form.includedTeamIds ?? []}
            onChange={(ids) => setForm((f) => ({ ...f, includedTeamIds: ids }))}
            otherSelected={excludedSet}
            placeholder="Search by name, league, city…"
          />
          <TeamTokenPicker
            label="Excluded teams (always remove)"
            teams={teams}
            selectedIds={form.excludedTeamIds ?? []}
            onChange={(ids) => setForm((f) => ({ ...f, excludedTeamIds: ids }))}
            otherSelected={includedSet}
            placeholder="Search by name, league, city…"
          />
        </div>
      </details>

      {/* Section 5 */}
      <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
        <h3 className="text-sm font-semibold text-gray-900">5. Eligibility preview (master rules)</h3>
        {preview.notConfigured && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded px-3 py-2">
            Not fully configured for generation — add leagues, color matching, or included teams.
          </p>
        )}
        {preview.notes.map((n) => (
          <p key={n} className="text-xs text-gray-600">
            {n}
          </p>
        ))}
        <p className="text-lg font-semibold text-emerald-900">
          {preview.teams.length} team{preview.teams.length === 1 ? "" : "s"} matched
        </p>
        <ul className="text-sm text-gray-800 divide-y divide-emerald-100 border border-emerald-100 rounded-lg bg-white max-h-64 overflow-y-auto">
          {previewSlice.map((t) => (
            <li key={t.id} className="px-3 py-2 flex justify-between gap-2">
              <span>{t.name}</span>
              <span className="text-xs text-gray-500 shrink-0">{t.leagueId || t.league || "—"}</span>
            </li>
          ))}
        </ul>
        {preview.teams.length > previewSlice.length && (
          <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setAllModalOpen(true)}>
            View all matched teams ({preview.teams.length})
          </button>
        )}
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save eligibility"}
        </button>
        <button
          type="button"
          onClick={() => setForm(normalizeIncoming(blank.eligibility))}
          className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          Reset form
        </button>
      </div>

      <Modal isOpen={allModalOpen} onClose={() => setAllModalOpen(false)} title={`Matched teams (${preview.teams.length})`} size="large">
        <div className="p-4 overflow-y-auto max-h-[70vh]">
          <ul className="text-sm space-y-1">
            {preview.teams.map((t) => (
              <li key={t.id} className="flex justify-between border-b border-gray-100 py-1">
                <span>{t.name}</span>
                <span className="text-gray-500 text-xs">{t.id}</span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
