"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { useAuth } from "@/lib/providers/AuthProvider";
import { getBlankVariants, isMasterBlank } from "@/lib/blanks";
import {
  isNeutralGarmentVariantName,
  isTeamEligibleForVariant,
  neutralEligibleVariantIds,
  variantMatchesTeamColorFamilies,
} from "@/lib/teams/teamProductMatrixHints";
import type { DesignTeam, RPBlank, TeamCatalogBlankEntry } from "@/lib/types/firestore";

function cloneMatrix(
  m: Record<string, TeamCatalogBlankEntry> | null | undefined
): Record<string, TeamCatalogBlankEntry> {
  if (!m) return {};
  const out: Record<string, TeamCatalogBlankEntry> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = {
      enabled: v.enabled,
      approvedVariantIds: [...(v.approvedVariantIds ?? [])],
    };
  }
  return out;
}

/** Persist only meaningful rows: has approvals or explicit style exclusion. */
export function pruneMatrixForFirestore(m: Record<string, TeamCatalogBlankEntry>): Record<string, TeamCatalogBlankEntry> {
  const out: Record<string, TeamCatalogBlankEntry> = {};
  for (const [id, e] of Object.entries(m)) {
    const hasApprovals = (e.approvedVariantIds ?? []).length > 0;
    const excluded = e.enabled === false;
    if (hasApprovals || excluded) {
      out[id] = {
        enabled: e.enabled,
        approvedVariantIds: [...(e.approvedVariantIds ?? [])],
      };
    }
  }
  return out;
}

function matrixFingerprint(m: Record<string, TeamCatalogBlankEntry>): string {
  const keys = Object.keys(m).sort();
  return JSON.stringify(
    keys.map((k) => [k, m[k].enabled, [...(m[k].approvedVariantIds ?? [])].sort()])
  );
}

function canEditCatalogRole(role: string | undefined): boolean {
  return role === "admin" || role === "editor" || role === "ops";
}

export interface TeamProductMatrixPanelProps {
  team: DesignTeam;
  onSaved?: (next: Record<string, TeamCatalogBlankEntry>) => void;
}

export default function TeamProductMatrixPanel({ team, onSaved }: TeamProductMatrixPanelProps) {
  const { user, adminUser } = useAuth();
  const canEdit = canEditCatalogRole(adminUser?.role);
  const { blanks, loading, error } = useBlanks({ status: "active", mastersOnly: true });

  const [matrix, setMatrix] = useState<Record<string, TeamCatalogBlankEntry>>(() =>
    cloneMatrix(team.productCatalogMatrix)
  );
  const [baselineFp, setBaselineFp] = useState(() =>
    matrixFingerprint(pruneMatrixForFirestore(cloneMatrix(team.productCatalogMatrix)))
  );
  const [blankSearch, setBlankSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  /** Neutrals pre-filled on first expand per blank (only when blank not on persisted matrix). */
  const expandSeededNeutralRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = cloneMatrix(team.productCatalogMatrix);
    setMatrix(next);
    setBaselineFp(matrixFingerprint(pruneMatrixForFirestore(next)));
    setSaveError(null);
    setSaveSuccess(false);
    expandSeededNeutralRef.current.clear();
  }, [team.id, team.productCatalogMatrix]);

  const sortedBlanks = useMemo(() => {
    const list = blanks.filter((b) => isMasterBlank(b));
    return [...list].sort((a, b) => {
      const la = `${a.styleCode} ${a.garmentStyle || a.styleName}`.toLowerCase();
      const lb = `${b.styleCode} ${b.garmentStyle || b.styleName}`.toLowerCase();
      return la.localeCompare(lb);
    });
  }, [blanks]);

  const filteredBlanks = useMemo(() => {
    const q = blankSearch.trim().toLowerCase();
    if (!q) return sortedBlanks;
    return sortedBlanks.filter((b) => {
      const hay = [
        b.blankId,
        b.styleCode,
        b.styleName,
        b.garmentStyle,
        b.slug,
        b.garmentCategory,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedBlanks, blankSearch]);

  const dirty = matrixFingerprint(pruneMatrixForFirestore(matrix)) !== baselineFp;

  useEffect(() => {
    if (dirty) setSaveSuccess(false);
  }, [dirty]);

  const toggleOpen = useCallback(
    (blankId: string) => {
      const opening = !openIds.has(blankId);
      setOpenIds((prev) => {
        const next = new Set(prev);
        if (next.has(blankId)) next.delete(blankId);
        else next.add(blankId);
        return next;
      });

      if (!opening) return;

      const persisted = team.productCatalogMatrix?.[blankId];
      if (persisted || expandSeededNeutralRef.current.has(blankId)) return;
      expandSeededNeutralRef.current.add(blankId);

      const blank = sortedBlanks.find((b) => b.blankId === blankId);
      if (!blank) return;
      const ids = neutralEligibleVariantIds(team, blank);
      if (ids.length === 0) return;

      setMatrix((m) => {
        const curr = m[blankId];
        if (curr?.enabled === false) return m;
        if ((curr?.approvedVariantIds?.length ?? 0) > 0) return m;
        return {
          ...m,
          [blankId]: { enabled: true, approvedVariantIds: [...ids] },
        };
      });
    },
    [openIds, sortedBlanks, team]
  );

  const getEntry = useCallback(
    (blankId: string): TeamCatalogBlankEntry => {
      return (
        matrix[blankId] ?? {
          enabled: true,
          approvedVariantIds: [],
        }
      );
    },
    [matrix]
  );

  const setVariantApproved = useCallback((blankId: string, variantId: string, on: boolean) => {
    setMatrix((prev) => {
      const curr = prev[blankId] ?? { enabled: true, approvedVariantIds: [] };
      const set = new Set(curr.approvedVariantIds ?? []);
      if (on) set.add(variantId);
      else set.delete(variantId);
      return {
        ...prev,
        [blankId]: {
          ...curr,
          enabled: curr.enabled !== false,
          approvedVariantIds: [...set],
        },
      };
    });
  }, []);

  const setStyleExcluded = useCallback((blankId: string, excluded: boolean) => {
    setMatrix((prev) => {
      const curr = prev[blankId] ?? { enabled: true, approvedVariantIds: [] };
      return {
        ...prev,
        [blankId]: {
          ...curr,
          enabled: excluded ? false : true,
        },
      };
    });
  }, []);

  const applyNeutralForBlank = useCallback(
    (blank: RPBlank) => {
      const ids = neutralEligibleVariantIds(team, blank);
      if (ids.length === 0) return;
      setMatrix((prev) => {
        const curr = prev[blank.blankId] ?? { enabled: true, approvedVariantIds: [] };
        const set = new Set([...(curr.approvedVariantIds ?? []), ...ids]);
        return {
          ...prev,
          [blank.blankId]: {
            ...curr,
            enabled: true,
            approvedVariantIds: [...set],
          },
        };
      });
    },
    [team]
  );

  const handleSave = async () => {
    if (!db || !canEdit) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const pruned = pruneMatrixForFirestore(matrix);
    const updatedBy =
      user?.uid != null
        ? { uid: user.uid, email: user.email ?? undefined }
        : undefined;
    const stamped: Record<string, TeamCatalogBlankEntry> = {};
    for (const [bid, e] of Object.entries(pruned)) {
      stamped[bid] = updatedBy ? { ...e, updatedBy } : { ...e };
    }
    try {
      await updateDoc(doc(db, "design_teams", team.id), {
        productCatalogMatrix: stamped,
        updatedAt: serverTimestamp(),
      });
      const next = stamped;
      setMatrix(cloneMatrix(next));
      setBaselineFp(matrixFingerprint(next));
      setSaveSuccess(true);
      onSaved?.(next);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!saveSuccess) return;
    const t = window.setTimeout(() => setSaveSuccess(false), 4000);
    return () => window.clearTimeout(t);
  }, [saveSuccess]);

  const handleDiscard = () => {
    const next = cloneMatrix(team.productCatalogMatrix);
    setMatrix(next);
    setBaselineFp(matrixFingerprint(pruneMatrixForFirestore(next)));
    setSaveError(null);
    setSaveSuccess(false);
    expandSeededNeutralRef.current.clear();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Checked variants are saved to this team’s <strong className="text-slate-900">product catalog</strong>. A blank
        with no checked variants is not stored in{" "}
        <code className="bg-white px-1 rounded border border-slate-200">productCatalogMatrix</code> (not active for that
        team). Opening a blank for the first time here pre-selects <em>eligible neutral</em> colors only in this
        editor—nothing is written until you click Save. New variants elsewhere are never auto-approved for all teams.
      </div>

      {saveSuccess && (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          role="status"
        >
          <span className="font-medium">Saved.</span>
          <span className="text-emerald-800/90">Product catalog updated for this team.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="matrix-blank-search" className="block text-xs font-medium text-gray-600 mb-1">
            Filter blanks
          </label>
          <input
            id="matrix-blank-search"
            type="search"
            value={blankSearch}
            onChange={(e) => setBlankSearch(e.target.value)}
            placeholder="Style code, name, id…"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="p-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>
      )}
      {loading && <p className="text-sm text-gray-500">Loading blanks…</p>}

      {!loading && filteredBlanks.length === 0 && (
        <p className="text-sm text-gray-500">No active master blanks match this filter.</p>
      )}

      <ul className="space-y-2 max-h-[48vh] overflow-y-auto pr-1 border border-gray-100 rounded-lg">
        {filteredBlanks.map((blank) => {
          const entry = getEntry(blank.blankId);
          const excluded = entry.enabled === false;
          const approved = new Set(entry.approvedVariantIds ?? []);
          const variants = getBlankVariants(blank).filter((v) => v.isActive !== false);
          const open = openIds.has(blank.blankId);
          const label = `${blank.styleCode} ${blank.garmentStyle || blank.styleName}`.trim();
          const prunedRow = pruneMatrixForFirestore(matrix)[blank.blankId];
          const catalogActive =
            Boolean(prunedRow) && prunedRow.enabled !== false && (prunedRow.approvedVariantIds?.length ?? 0) > 0;
          const catalogExcluded = Boolean(prunedRow) && prunedRow.enabled === false;

          return (
            <li key={blank.blankId} className="border-b border-gray-100 last:border-0 bg-white">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleOpen(blank.blankId)}
                  className="text-left font-medium text-gray-900 flex-1 min-w-[12rem] hover:text-blue-700"
                >
                  <span className="text-gray-400 mr-1">{open ? "▼" : "▶"}</span>
                  {label}
                </button>
                <span className="text-[10px] uppercase tracking-wide shrink-0 text-gray-500">
                  {catalogActive ? (
                    <span className="text-emerald-700">In catalog</span>
                  ) : catalogExcluded ? (
                    <span className="text-amber-800">Excluded</span>
                  ) : (
                    <span>Not in catalog</span>
                  )}
                </span>
                <Link
                  href={`/blanks/${blank.blankId}`}
                  className="text-xs text-blue-600 hover:underline shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {blank.blankId}
                </Link>
                {canEdit && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={excluded}
                        onChange={(e) => setStyleExcluded(blank.blankId, e.target.checked)}
                      />
                      Exclude style
                    </label>
                    <button
                      type="button"
                      onClick={() => applyNeutralForBlank(blank)}
                      className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                    >
                      + Neutrals
                    </button>
                  </>
                )}
              </div>
              {open && (
                <ul className="pl-8 pr-3 pb-3 space-y-1.5">
                  {variants.length === 0 && (
                    <li className="text-xs text-gray-500">No active variants.</li>
                  )}
                  {variants.map((v) => {
                    const eligible = isTeamEligibleForVariant(team, blank, v);
                    const isNeutral = isNeutralGarmentVariantName(v.colorName);
                    const showTeamColorTag =
                      !isNeutral && variantMatchesTeamColorFamilies(v.colorName, team.colorFamilies);
                    const checked = approved.has(v.variantId);
                    const hex = v.colorHex?.trim();
                    return (
                      <li key={v.variantId} className="flex flex-wrap items-center gap-2 text-sm">
                        <label
                          className={`flex items-center gap-2 cursor-pointer min-w-0 ${!eligible || excluded ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit || excluded || !eligible}
                            onChange={(e) => setVariantApproved(blank.blankId, v.variantId, e.target.checked)}
                          />
                          <span
                            className="h-5 w-5 shrink-0 rounded border border-gray-300 shadow-inner"
                            style={
                              hex
                                ? { backgroundColor: hex }
                                : { background: "linear-gradient(135deg, #f3f4f6 50%, #e5e7eb 50%)" }
                            }
                            title={hex || "No swatch"}
                          />
                          <span className="truncate">{v.colorName || v.variantId}</span>
                        </label>
                        {isNeutral && (
                          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Neutral</span>
                        )}
                        {showTeamColorTag && eligible && !excluded && (
                          <span className="text-[10px] text-violet-800 bg-violet-100 px-1.5 py-0.5 rounded">
                            Team color
                          </span>
                        )}
                        {!eligible && (
                          <span className="text-[10px] text-gray-500" title="Not eligible under blank eligibility rules">
                            Not eligible
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save catalog"}
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={handleDiscard}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Discard changes
          </button>
          {saveError && <span className="text-sm text-red-600">{saveError}</span>}
        </div>
      )}
      {!canEdit && (
        <p className="text-xs text-gray-500">Editor, ops, or admin role required to edit this matrix.</p>
      )}
    </div>
  );
}
