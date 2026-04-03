"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Modal from "@/components/Modal";
import { db } from "@/lib/firebase/config";
import { useCreateProductVariantsFromDesignBlank } from "@/lib/hooks/useRPProductMutations";
import { mapRpBlankFromFirestore } from "@/lib/blanks/blankFirestore";
import type { DesignDoc, DesignTeam, RPBlank, RpProduct } from "@/lib/types/firestore";
import {
  buildTeamGenerateExistingLookup,
  buildTeamGenerateReview,
  summarizeTeamGenerate,
  type TeamGenerateBlankGroup,
  type TeamGenerateStatusLabel,
} from "@/lib/products/teamCatalogGenerate";

function rowKey(blankId: string, variantId: string): string {
  return `${blankId}\t${variantId}`;
}

async function fetchBlanksByIds(ids: string[]): Promise<Record<string, RPBlank | null>> {
  const database = db;
  if (!database || ids.length === 0) return {};
  const pairs = await Promise.all(
    ids.map(async (id) => {
      const snap = await getDoc(doc(database, "rp_blanks", id));
      const blank = snap.exists()
        ? mapRpBlankFromFirestore(snap.id, snap.data() as Record<string, unknown>)
        : null;
      return [id, blank] as const;
    })
  );
  return Object.fromEntries(pairs);
}

async function fetchProductsForDesign(designId: string): Promise<RpProduct[]> {
  const database = db;
  if (!database) return [];
  const q = query(collection(database, "rp_products"), where("designId", "==", designId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as RpProduct), id: d.id }));
}

function statusPillClass(status: TeamGenerateStatusLabel): string {
  switch (status) {
    case "Ready":
      return "bg-emerald-100 text-emerald-900";
    case "Already exists":
      return "bg-slate-200 text-slate-800";
    case "Excluded by team":
      return "bg-gray-100 text-gray-600";
    case "Blocked by eligibility":
      return "bg-amber-100 text-amber-950";
    case "Missing blank images":
    case "Missing design asset":
    case "Missing render profile":
      return "bg-orange-100 text-orange-950";
    case "Inactive blank":
    case "Inactive variant":
      return "bg-red-50 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export interface GenerateTeamProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  designs: DesignDoc[];
  teams: DesignTeam[];
  onProductsChanged: () => void;
}

export default function GenerateTeamProductsModal({
  isOpen,
  onClose,
  designs,
  teams,
  onProductsChanged,
}: GenerateTeamProductsModalProps) {
  const [designId, setDesignId] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{
    created: { slug: string; productId: string }[];
    skipped: number;
    failed: { key: string; message: string }[];
  } | null>(null);

  const design = useMemo(
    () => (designId ? designs.find((d) => d.id === designId) : undefined),
    [designs, designId]
  );

  const team = useMemo(
    () => (design?.teamId ? teams.find((t) => t.id === design.teamId) : undefined),
    [design?.teamId, teams]
  );

  const matrix = team?.productCatalogMatrix ?? null;
  const blankIds = useMemo(() => [...new Set(Object.keys(matrix ?? {}))].sort(), [matrix]);
  const blankIdsSerialized = blankIds.join(",");

  const { data: blanksMap } = useSWR(
    isOpen && designId && blankIdsSerialized
      ? ["gen-team-blanks", blankIdsSerialized]
      : null,
    () => fetchBlanksByIds(blankIdsSerialized.split(",").filter(Boolean))
  );

  const { data: designProducts, mutate: mutateDesignProducts } = useSWR(
    isOpen && designId ? ["rp_products_design", designId] : null,
    () => fetchProductsForDesign(designId)
  );

  const blanksResolved = blankIds.length === 0 || blanksMap !== undefined;
  const productsResolved = designProducts !== undefined;
  const catalogResolved = blanksResolved && productsResolved;

  const existingLookup = useMemo(
    () => buildTeamGenerateExistingLookup(designProducts ?? []),
    [designProducts]
  );

  const groups: TeamGenerateBlankGroup[] = useMemo(() => {
    if (!design || !team || !catalogResolved) return [];
    return buildTeamGenerateReview(design, team, matrix, blanksMap ?? {}, existingLookup);
  }, [design, team, matrix, blanksMap, existingLookup, catalogResolved]);

  const summary = useMemo(() => summarizeTeamGenerate(groups), [groups]);

  useEffect(() => {
    if (!isOpen) return;
    setGenResult(null);
  }, [isOpen, designId]);

  useEffect(() => {
    if (!isOpen || !design || !team || !catalogResolved) return;
    const next = new Set<string>();
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.status === "Ready") {
          next.add(rowKey(g.blankId, r.variantId));
        }
      }
    }
    setSelectedKeys(next);
  }, [isOpen, design?.id, team?.id, groups, catalogResolved]);

  const toggleRow = useCallback((blankId: string, variantId: string, status: TeamGenerateStatusLabel) => {
    if (status !== "Ready") return;
    const k = rowKey(blankId, variantId);
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }, []);

  const readySelectedCount = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.status === "Ready" && selectedKeys.has(rowKey(g.blankId, r.variantId))) n += 1;
      }
    }
    return n;
  }, [groups, selectedKeys]);

  const { createProductVariantsFromDesignBlank } = useCreateProductVariantsFromDesignBlank();

  const handleGenerate = async () => {
    if (!design || readySelectedCount === 0) return;
    setGenerating(true);
    setGenResult(null);
    const created: { slug: string; productId: string }[] = [];
    const failed: { key: string; message: string }[] = [];
    let skipped = 0;

    /** blankId → selected variant ids for that blank (one callable per blank = one parent + N variants). */
    const byBlank = new Map<string, string[]>();
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.status !== "Ready") continue;
        const k = rowKey(g.blankId, r.variantId);
        if (!selectedKeys.has(k)) {
          skipped += 1;
          continue;
        }
        if (!byBlank.has(g.blankId)) byBlank.set(g.blankId, []);
        byBlank.get(g.blankId)!.push(r.variantId);
      }
    }

    for (const [blankId, blankVariantIds] of byBlank) {
      try {
        const batch = await createProductVariantsFromDesignBlank({
          designId: design.id,
          blankId,
          blankVariantIds,
        });
        const slug = batch.slug || "";
        const pid = batch.productId || "";
        if (slug && pid) {
          const already = created.some((c) => c.productId === pid);
          if (!already) created.push({ slug, productId: pid });
        }
        if (batch.errors?.length) {
          for (const err of batch.errors) {
            failed.push({ key: `${blankId}\t${err.blankVariantId}`, message: err.message });
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push({ key: blankId, message: msg });
      }
    }

    setGenResult({ created, skipped, failed });
    setGenerating(false);
    await mutateDesignProducts();
    onProductsChanged();
  };

  const noTeamOnDesign = Boolean(design && !design.teamId?.trim());
  const teamMissing = Boolean(design?.teamId && !team);
  const matrixEmpty = Boolean(team && (!matrix || Object.keys(matrix).length === 0));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Generate Team Products" size="large">
      <div className="space-y-4 text-sm text-gray-800 max-h-[78vh] overflow-y-auto pr-1">
        <p className="text-xs text-gray-600">
          One design → team from design → that team&apos;s <strong>product catalog</strong> matrix. Creates one{" "}
          <strong>parent</strong> product per blank (team + design + blank) and a <strong>variant</strong> per approved
          color under <code className="bg-gray-100 px-1 rounded text-xs">rp_products/…/variants</code>. Same path as
          Design + Blank (render profile on each variant). One server request per blank so a single parent row is
          created and all colors attach as{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">variants</code> subdocs. Does not run mock generation or
          Shopify from here.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Design</label>
          <select
            value={designId}
            onChange={(e) => setDesignId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">Select a design…</option>
            {[...designs]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>

        {design && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Team</span>
              <div className="font-medium text-gray-900">
                {design.teamNameCache || team?.name || design.teamId || "—"}
              </div>
            </div>
            <div>
              <span className="text-gray-500">League</span>
              <div className="font-medium text-gray-900">
                {design.leagueCode || team?.leagueId || team?.league || "—"}
              </div>
            </div>
          </div>
        )}

        {noTeamOnDesign && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950 text-sm">
            This design has no <code className="bg-amber-100 px-1 rounded">teamId</code>. Assign a team on the design
            before generating catalog products.
          </div>
        )}

        {teamMissing && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
            Design references team <code className="bg-red-100 px-1 rounded">{design?.teamId}</code> but no matching
            row was found in <code className="bg-red-100 px-1 rounded">design_teams</code>.
          </div>
        )}

        {team && matrixEmpty && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700 text-sm">
            This team has no product catalog entries yet. Approve blanks/variants under{" "}
            <Link href="/design-teams" className="text-blue-600 underline">
              Design Teams
            </Link>
            .
          </div>
        )}

        {design && team && !matrixEmpty && !catalogResolved && (
          <p className="text-sm text-gray-500 py-4">Loading team catalog and existing products…</p>
        )}

        {design && team && !matrixEmpty && catalogResolved && (
          <>
            <div className="flex flex-wrap gap-3 text-xs border border-gray-100 rounded-lg p-3 bg-gray-50">
              <div>
                <span className="text-gray-500">Approved combinations</span>
                <div className="font-semibold text-gray-900">{summary.approvedCombinations}</div>
              </div>
              <div>
                <span className="text-gray-500">Ready to generate</span>
                <div className="font-semibold text-emerald-800">{summary.ready}</div>
              </div>
              <div>
                <span className="text-gray-500">Already existing</span>
                <div className="font-semibold text-gray-800">{summary.alreadyExists}</div>
              </div>
              <div>
                <span className="text-gray-500">Blocked</span>
                <div className="font-semibold text-orange-900">{summary.blocked}</div>
              </div>
            </div>

            <div className="space-y-4 border border-gray-200 rounded-lg divide-y divide-gray-100">
              {groups.map((g) => (
                <div key={g.blankId} className="p-3">
                  <div className="font-medium text-gray-900 mb-2">
                    {g.styleLabel}{" "}
                    <Link
                      href={`/blanks/${g.blankId}`}
                      className="text-xs font-normal text-blue-600 hover:underline ml-1"
                    >
                      {g.blankId}
                    </Link>
                  </div>
                  <ul className="space-y-2">
                    {g.rows.length === 0 && (
                      <li className="text-xs text-gray-500">No active variants on this blank.</li>
                    )}
                    {g.rows.map((r) => {
                      const k = rowKey(g.blankId, r.variantId);
                      const checked = selectedKeys.has(k);
                      const canToggle = r.status === "Ready";
                      const disabled = !canToggle || generating;
                      return (
                        <li key={k} className="flex flex-wrap items-center gap-2">
                          <label
                            className={`flex items-center gap-2 min-w-0 flex-1 ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleRow(g.blankId, r.variantId, r.status)}
                            />
                            <span
                              className="h-5 w-5 shrink-0 rounded border border-gray-300"
                              style={
                                r.colorHex?.trim()
                                  ? { backgroundColor: r.colorHex }
                                  : {
                                      background:
                                        "linear-gradient(135deg, #f3f4f6 50%, #e5e7eb 50%)",
                                    }
                              }
                            />
                            <span className="truncate">{r.colorName}</span>
                          </label>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${statusPillClass(r.status)}`}
                          >
                            {r.status}
                          </span>
                          {r.existingSlug && (
                            <Link
                              href={`/products/${encodeURIComponent(r.existingSlug)}`}
                              className="text-xs text-blue-600 hover:underline shrink-0"
                            >
                              View
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            {genResult && (
              <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm space-y-2">
                <div className="font-medium text-gray-900">Results</div>
                <div className="text-emerald-800">Created: {genResult.created.length}</div>
                {genResult.created.length > 0 && (
                  <ul className="list-disc pl-4 space-y-1 text-xs">
                    {genResult.created.map((c) => (
                      <li key={c.productId}>
                        <Link href={`/products/${encodeURIComponent(c.slug)}`} className="text-blue-600 hover:underline">
                          {c.slug}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-gray-600">Skipped (unchecked): {genResult.skipped}</div>
                {genResult.failed.length > 0 && (
                  <div className="text-red-800">
                    Failed: {genResult.failed.length}
                    <ul className="mt-1 space-y-1 text-xs font-mono">
                      {genResult.failed.map((f) => (
                        <li key={f.key}>
                          {f.key}: {f.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
              <button
                type="button"
                disabled={
                  generating ||
                  noTeamOnDesign ||
                  teamMissing ||
                  matrixEmpty ||
                  readySelectedCount === 0
                }
                onClick={() => void handleGenerate()}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? "Generating…" : `Generate ${readySelectedCount} variant${readySelectedCount === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={onClose}
                className="px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
