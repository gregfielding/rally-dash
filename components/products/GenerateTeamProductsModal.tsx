"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { getApp } from "firebase/app";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Modal from "@/components/Modal";
import { db, functions as firebaseFunctions } from "@/lib/firebase/config";
import { useLaunchProductsFromDesign } from "@/lib/hooks/useRPProductMutations";
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

/** Firebase callable / HttpsError — surface code, message, and structured details. */
function formatCallableError(e: unknown): string {
  if (e && typeof e === "object") {
    const rec = e as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code : "";
    const message = typeof rec.message === "string" ? rec.message : "";
    const customData = rec.customData;
    const details = rec.details;
    const bits: string[] = [];
    if (code) bits.push(code);
    if (message) bits.push(message);
    const extra = customData !== undefined ? customData : details;
    if (extra !== undefined) {
      try {
        bits.push(typeof extra === "string" ? extra : JSON.stringify(extra));
      } catch {
        bits.push(String(extra));
      }
    }
    if (bits.length) return bits.join(" — ");
  }
  return e instanceof Error ? e.message : String(e);
}

type VariantsBatchResult = {
  productId: string | null;
  slug: string | null;
  parentProductId?: string | null;
  createdColorCount?: number;
  createdSkuCount?: number;
  variantSubdocCountVerified?: number | null;
  assetsBatchId?: string | null;
  assetsStatus?: string | null;
  queuedColorCount?: number | null;
  queuedRoleCount?: number | null;
  assetBatch?: {
    ok?: boolean;
    assetsBatchId?: string;
    assetsStatus?: string;
    queuedColorCount?: number;
    queuedRoleCount?: number;
    code?: string;
  } | null;
  results: Array<{
    blankVariantId: string;
    variantFirestoreId?: string;
    variantFirestoreIds?: string[];
    productId?: string | null;
    slug?: string | null;
    created?: boolean;
    skipped?: boolean;
    message?: string;
  }>;
  errors?: Array<{ blankVariantId: string; message: string }>;
};

/** Top-level productId/slug can be null even when `results` rows succeeded (serialization edge cases). */
function deriveParentFromBatch(batch: VariantsBatchResult): { productId: string; slug: string } | null {
  const topPid = batch.productId?.trim();
  const topSlug = batch.slug?.trim();
  if (topPid && topSlug) return { productId: topPid, slug: topSlug };

  const rows = batch.results ?? [];
  const createdRow = rows.find((r) => r.created && r.productId?.trim() && r.slug?.trim());
  if (createdRow) {
    return { productId: createdRow.productId!.trim(), slug: createdRow.slug!.trim() };
  }
  const anyRow = rows.find((r) => r.productId?.trim() && r.slug?.trim());
  if (anyRow) return { productId: anyRow.productId!.trim(), slug: anyRow.slug!.trim() };
  return null;
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
    /** One entry per blank request — includes per-color rows from the callable. */
    batchDetails: Array<{
      blankId: string;
      parent: { productId: string; slug: string } | null;
      batch: VariantsBatchResult;
      /** Same fields as server return payload top level — compare to Cloud Logging FIRESTORE_VERIFY. */
      verification: {
        parentProductId: string | null;
        createdColorCount: number;
        createdSkuCount: number;
        variantSubdocCountVerified: number | null;
      };
    }>;
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

  const { mutate: globalMutate } = useSWRConfig();
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

  const { launchProductsFromDesign } = useLaunchProductsFromDesign();

  const handleGenerate = async () => {
    if (!design || readySelectedCount === 0) return;

    let firebaseProjectId: string | null = null;
    try {
      firebaseProjectId = getApp().options.projectId ?? null;
    } catch {
      firebaseProjectId = null;
    }

    if (!firebaseFunctions) {
      setGenResult({
        created: [],
        skipped: 0,
        failed: [
          {
            key: "cloud_functions",
            message:
              "Cloud Functions not initialized. Set NEXT_PUBLIC_FIREBASE_* in .env.local, restart `npm run dev`, and deploy functions to this project if you have not already.",
          },
        ],
        batchDetails: [],
      });
      console.error(
        "[TEAM_PRODUCT_GEN:UI:ABORT]",
        JSON.stringify({
          reason: "functions_unavailable",
          firebaseProjectId,
          t: new Date().toISOString(),
        })
      );
      return;
    }

    const runT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    setGenerating(true);
    setGenResult(null);
    const created: { slug: string; productId: string }[] = [];
    const failed: { key: string; message: string }[] = [];
    const batchDetails: Array<{
      blankId: string;
      parent: { productId: string; slug: string } | null;
      batch: VariantsBatchResult;
      verification: {
        parentProductId: string | null;
        createdColorCount: number;
        createdSkuCount: number;
        variantSubdocCountVerified: number | null;
      };
    }> = [];
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

    console.info(
      "[TEAM_PRODUCT_GEN:UI:RUN_START]",
      JSON.stringify({
        firebaseProjectId,
        functionsRegion: firebaseFunctions.region,
        designId: design.id,
        blankCount: byBlank.size,
        blanks: [...byBlank.entries()].map(([bid, ids]) => ({
          blankId: bid,
          variantCount: ids.length,
        })),
        t: new Date().toISOString(),
      })
    );

    try {
      for (const [blankId, blankVariantIds] of byBlank) {
        const blankMeta = groups.find((g) => g.blankId === blankId);
        const blankT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
        console.info(
          "[TEAM_PRODUCT_GEN:UI:REQUEST]",
          JSON.stringify({
            designId: design.id,
            blankId,
            selectedBlankVariantIds: blankVariantIds,
            selectedCount: blankVariantIds.length,
            expectedSizesFromBlank:
              (blankMeta?.blank as { availableSizes?: unknown } | null)?.availableSizes ?? null,
            mode: "launchProductsFromDesign",
            timestamp: new Date().toISOString(),
          })
        );

        try {
          const batch = (await launchProductsFromDesign({
            designId: design.id,
            blankId,
            blankVariantIds,
            autoSyncShopify: false,
          })) as VariantsBatchResult & { ok?: boolean };

          const parent = deriveParentFromBatch(batch);
          const fallbackSkuCount = (batch.results ?? []).reduce(
            (acc, r) => acc + (r.variantFirestoreIds?.length ?? 0),
            0
          );
          const verification = {
            parentProductId: batch.parentProductId ?? batch.productId ?? null,
            createdColorCount: batch.createdColorCount ?? (batch.results ?? []).filter((r) => r.created).length,
            createdSkuCount: batch.createdSkuCount ?? fallbackSkuCount,
            variantSubdocCountVerified:
              batch.variantSubdocCountVerified !== undefined ? batch.variantSubdocCountVerified : null,
          };
          batchDetails.push({ blankId, parent, batch, verification });

          const createdRows = (batch.results ?? []).filter((r) => r.created).length;
          const skippedRows = (batch.results ?? []).filter((r) => r.skipped).length;
          const createdIds = (batch.results ?? [])
            .filter((r) => r.productId)
            .map((r) => r.productId as string);
          const variantIds = (batch.results ?? []).flatMap((r) => r.variantFirestoreIds ?? []);

          console.info(
            "[TEAM_PRODUCT_GEN:UI:RESPONSE]",
            JSON.stringify({
              ok: batch.ok !== false,
              blankId,
              parentProductId: verification.parentProductId,
              createdColorCount: verification.createdColorCount,
              createdSkuCount: verification.createdSkuCount,
              variantSubdocCountVerified: verification.variantSubdocCountVerified,
              createdColorRows: createdRows,
              skippedRows,
              createdProductIds: [...new Set(createdIds)],
              createdVariantIds: variantIds.slice(0, 32),
              rawResponse: batch,
            })
          );

          if (parent) {
            const already = created.some((c) => c.productId === parent.productId);
            if (!already) created.push({ slug: parent.slug, productId: parent.productId });
          }

          if (batch.errors?.length) {
            for (const err of batch.errors) {
              failed.push({ key: `${blankId}\t${err.blankVariantId}`, message: err.message });
            }
          }
          const blankElapsedMs =
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - blankT0;
          console.info(
            "[TEAM_PRODUCT_GEN:UI:BLANK_DONE]",
            JSON.stringify({
              blankId,
              elapsedMs: Math.round(blankElapsedMs),
              createdRows: (batch.results ?? []).filter((r) => r.created).length,
              skippedRows: (batch.results ?? []).filter((r) => r.skipped).length,
            })
          );
        } catch (e: unknown) {
          failed.push({ key: blankId, message: formatCallableError(e) });
          console.info(
            "[TEAM_PRODUCT_GEN:UI:RESPONSE]",
            JSON.stringify({
              ok: false,
              blankId,
              error: formatCallableError(e),
            })
          );
          const blankElapsedMs =
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - blankT0;
          console.info(
            "[TEAM_PRODUCT_GEN:UI:BLANK_DONE]",
            JSON.stringify({
              blankId,
              elapsedMs: Math.round(blankElapsedMs),
              error: true,
            })
          );
        }
      }
    } finally {
      const totalElapsedMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - runT0;
      console.info(
        "[TEAM_PRODUCT_GEN:UI:RUN_END]",
        JSON.stringify({
          firebaseProjectId,
          totalElapsedMs: Math.round(totalElapsedMs),
          createdParents: created.length,
          failedCount: failed.length,
          t: new Date().toISOString(),
        })
      );
      setGenerating(false);
    }

    setGenResult({ created, skipped, failed, batchDetails });
    try {
      await mutateDesignProducts();
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      onProductsChanged();
    } catch (revErr) {
      console.error("[TEAM_PRODUCT_GEN:UI:REVALIDATE_ERROR]", revErr);
    }
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
              <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm space-y-3">
                <div className="font-medium text-gray-900">Results</div>
                <div className="text-emerald-800">
                  Parent products linked: {genResult.created.length}
                </div>
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
                {genResult.batchDetails.length > 0 && (
                  <div className="space-y-2 border-t border-gray-100 pt-2">
                    <div className="text-xs font-medium text-gray-700">Server verification (match Cloud logs)</div>
                    {genResult.batchDetails.map((bd) => (
                      <div
                        key={`${bd.blankId}-verify`}
                        className="rounded border border-indigo-200 bg-indigo-50/80 px-2 py-2 font-mono text-[11px] text-indigo-950 space-y-0.5"
                      >
                        <div>
                          <span className="text-indigo-700">parentProductId</span> {bd.verification.parentProductId ?? "—"}
                        </div>
                        <div>
                          <span className="text-indigo-700">createdColorCount</span> {bd.verification.createdColorCount}
                        </div>
                        <div>
                          <span className="text-indigo-700">createdSkuCount</span> {bd.verification.createdSkuCount}
                        </div>
                        <div>
                          <span className="text-indigo-700">variantSubdocCountVerified</span>{" "}
                          {bd.verification.variantSubdocCountVerified ?? "—"}
                        </div>
                      </div>
                    ))}
                    <div className="text-xs font-medium text-gray-700">Per blank (server response)</div>
                    {genResult.batchDetails.map((bd) => (
                      <div key={bd.blankId} className="rounded border border-gray-100 bg-gray-50 px-2 py-2 text-xs space-y-1">
                        <div className="font-mono text-gray-800">
                          Blank <span className="text-blue-700">{bd.blankId}</span>
                          {bd.parent ? (
                            <>
                              {" → "}
                              <Link
                                href={`/products/${encodeURIComponent(bd.parent.slug)}`}
                                className="text-blue-600 hover:underline"
                              >
                                {bd.parent.slug}
                              </Link>
                            </>
                          ) : (
                            <span className="text-amber-800"> — could not resolve parent slug/id from response</span>
                          )}
                        </div>
                        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-gray-700">
                          {(bd.batch.results ?? []).map((r) => (
                            <li key={r.blankVariantId}>
                              {r.blankVariantId}:{" "}
                              {r.created ? (
                                <span className="text-emerald-800">created</span>
                              ) : r.skipped ? (
                                <span className="text-slate-600">skipped (already exists)</span>
                              ) : (
                                <span className="text-gray-600">ok</span>
                              )}
                              {r.message ? ` — ${r.message}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                {genResult.failed.length > 0 && (
                  <div className="text-red-800">
                    Failed: {genResult.failed.length}
                    <ul className="mt-1 space-y-1 text-xs font-mono break-all">
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
