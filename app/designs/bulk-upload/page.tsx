"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ref, uploadBytes } from "firebase/storage";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import ProtectedRoute from "@/components/ProtectedRoute";
import { filterBulkDesignFiles } from "@/lib/bulkDesignUpload";
import {
  useDesigns,
  useParseBulkDesignUploadPreview,
  useCommitBulkDesignUpload,
  type CommitBulkDesignUploadItemDecision,
} from "@/lib/hooks/useDesignAssets";
import { db, storage } from "@/lib/firebase/config";
import { useAuth } from "@/lib/providers/AuthProvider";

type WizardStep = "upload" | "review" | "import" | "results";

/**
 * One entry of the available-blanks list the server sends on every preview row.
 * `pipelineReady` is true only for blanks whose downstream
 * `startInitialProductAssetBatch` pipeline is wired today (currently styleCode
 * "8394"). The UI disables the others so operators can't queue dead stubs.
 */
export type AvailableBlank = {
  blankId: string;
  styleCode: string;
  name: string | null;
  category: string | null;
  pipelineReady: boolean;
};

/** Preview row from `parseBulkDesignUploadPreview` (server). */
export type BulkPreviewItem = {
  itemId: string;
  groupKey: string;
  designName: string;
  slug: string;
  leagueCode?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  themeName?: string | null;
  designSeries?: string | null;
  designType?: string;
  defaultAction: "create" | "update" | "skip" | "blocked";
  confirmedAction: "create" | "update" | "skip" | "blocked";
  existingDesignId?: string | null;
  existingMatchReason?: string | null;
  assetCoverage: Record<string, boolean>;
  warnings: string[];
  errors: string[];
  overwriteWarnings?: Record<string, boolean>;
  duplicateKindConflicts?: boolean;
  /** All active master blanks (with pipelineReady flag), same list for every row. */
  availableBlanks?: AvailableBlank[];
  /** Default blank selection (pipelineReady ones), set server-side. */
  defaultTargetBlankIds?: string[];
};

function coverageCell(ok: boolean, optional: boolean) {
  if (ok) return <span className="text-green-600 font-medium">✓</span>;
  if (optional) return <span className="text-amber-600">—</span>;
  return <span className="text-red-600">✗</span>;
}

function safeStorageFileName(original: string, used: Set<string>): string {
  const base = (original.split(/[/\\]/).pop() || original).replace(/[^a-zA-Z0-9._-]/g, "_");
  let name = base;
  let i = 0;
  while (used.has(name)) {
    i++;
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const ext = dot === -1 ? "" : base.slice(dot);
    name = `${stem}_${i}${ext}`;
  }
  used.add(name);
  return name;
}

export default function BulkDesignUploadPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { mutate: mutateDesigns } = useDesigns({});
  const { parsePreview } = useParseBulkDesignUploadPreview();
  const { commitBulkImport } = useCommitBulkDesignUpload();

  const [step, setStep] = useState<WizardStep>("upload");
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [accepted, setAccepted] = useState<{ file: File; ext: string }[]>([]);
  const [ignoredClient, setIgnoredClient] = useState<{ name: string; reason: string; detail?: string }[]>([]);
  const [parseFailures, setParseFailures] = useState<{ name: string; message: string }[]>([]);
  const [ignoredServer, setIgnoredServer] = useState<{ name: string; reason: string }[]>([]);
  const [items, setItems] = useState<BulkPreviewItem[]>([]);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [actionOverrides, setActionOverrides] = useState<
    Record<string, "create" | "update" | "skip" | "blocked">
  >({});
  const [overwriteByItem, setOverwriteByItem] = useState<Record<string, boolean>>({});
  /**
   * Per-item picker: which master blanks should auto-launch products. Seeded
   * from `item.defaultTargetBlankIds` (server picks pipelineReady ones).
   */
  const [targetBlanksByItem, setTargetBlanksByItem] = useState<Record<string, string[]>>({});
  const [importing, setImporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [commitSummary, setCommitSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    blocked: number;
    failed: number;
  } | null>(null);
  const [commitResults, setCommitResults] = useState<
    Array<{ itemId: string; resultStatus: string; resultDesignId?: string | null; resultError?: string | null }>
  >([]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const list = Array.from(e.dataTransfer.files);
    setRawFiles(list);
    const { accepted: acc, ignored: ign } = filterBulkDesignFiles(list);
    setAccepted(acc);
    setIgnoredClient(ign.map((x) => ({ name: x.name, reason: x.reason, detail: x.detail })));
    setNameOverrides({});
    setActionOverrides({});
    setOverwriteByItem({});
    setPrepareError(null);
    setItems([]);
    setParseFailures([]);
    setIgnoredServer([]);
    setStep("upload");
  }, []);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    setRawFiles(list);
    const { accepted: acc, ignored: ign } = filterBulkDesignFiles(list);
    setAccepted(acc);
    setIgnoredClient(ign.map((x) => ({ name: x.name, reason: x.reason, detail: x.detail })));
    setNameOverrides({});
    setActionOverrides({});
    setOverwriteByItem({});
    setPrepareError(null);
    setItems([]);
    setParseFailures([]);
    setIgnoredServer([]);
    setStep("upload");
    e.target.value = "";
  }, []);

  const runUploadAndParse = useCallback(async () => {
    if (!db || !storage || !uid) return;
    if (accepted.length === 0) return;
    setParsing(true);
    setPrepareError(null);
    try {
      const jobRef = await addDoc(collection(db, "rp_design_import_jobs"), {
        status: "uploading" as const,
        importVersion: "1",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: uid,
        totalFiles: accepted.length,
        acceptedFiles: 0,
        ignoredFiles: ignoredClient.length,
        groupedDesignCount: 0,
        ignoredList: ignoredClient.map((x) => ({ name: x.name, reason: x.reason })),
      });
      const jid = jobRef.id;
      setJobId(jid);

      const used = new Set<string>();
      const descriptors: Array<{
        originalFilename: string;
        storagePath: string;
        ext: string;
        size: number;
        contentType?: string;
      }> = [];

      for (const { file, ext } of accepted) {
        const storageName = safeStorageFileName(file.name, used);
        const storagePath = `rp_design_imports/${uid}/${jid}/raw/${storageName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        descriptors.push({
          originalFilename: file.name,
          storagePath,
          ext,
          size: file.size,
          contentType: file.type || undefined,
        });
      }

      const preview = await parsePreview({
        jobId: jid,
        files: descriptors,
        options: { requirePng: true },
      });

      const serverItems = (preview.items || []) as BulkPreviewItem[];
      setItems(serverItems);
      setParseFailures(preview.parseFailures || []);
      setIgnoredServer(preview.ignored || []);

      const nextActions: Record<string, "create" | "update" | "skip" | "blocked"> = {};
      const nextOw: Record<string, boolean> = {};
      const nextTargets: Record<string, string[]> = {};
      for (const it of serverItems) {
        nextActions[it.itemId] = it.confirmedAction || it.defaultAction;
        nextOw[it.itemId] = false;
        nextTargets[it.itemId] = Array.isArray(it.defaultTargetBlankIds)
          ? [...it.defaultTargetBlankIds]
          : [];
      }
      setActionOverrides(nextActions);
      setOverwriteByItem(nextOw);
      setTargetBlanksByItem(nextTargets);

      setStep("review");
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, [uid, accepted, ignoredClient, parsePreview]);

  const effectiveItems = useMemo(() => {
    return items.map((it) => ({
      ...it,
      designName: nameOverrides[it.itemId] ?? it.designName,
      action: actionOverrides[it.itemId] ?? it.confirmedAction ?? it.defaultAction,
      overwriteAllowed: overwriteByItem[it.itemId] ?? false,
    }));
  }, [items, nameOverrides, actionOverrides, overwriteByItem]);

  const runCommit = useCallback(async () => {
    if (!jobId) return;
    setImporting(true);
    setImportError(null);
    setCommitSummary(null);
    setCommitResults([]);
    setStep("import");

    try {
      const decisions: CommitBulkDesignUploadItemDecision[] = effectiveItems.map((it) => ({
        itemId: it.itemId,
        action: it.action,
        overwriteAllowed: it.overwriteAllowed,
        name: nameOverrides[it.itemId],
        teamId: undefined,
        themeCode: undefined,
        designSeries: undefined,
        slug: undefined,
        targetBlankIds: targetBlanksByItem[it.itemId] ?? it.defaultTargetBlankIds ?? [],
      }));

      const out = await commitBulkImport({ jobId, items: decisions });
      setCommitSummary(out.summary);
      setCommitResults(
        (out.results || []).map((r) => ({
          itemId: r.itemId,
          resultStatus: r.resultStatus,
          resultDesignId: r.resultDesignId,
          resultError: r.resultError,
        }))
      );
      await mutateDesigns();
      setStep("results");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setStep("results");
    } finally {
      setImporting(false);
    }
  }, [jobId, effectiveItems, nameOverrides, commitBulkImport, mutateDesigns]);

  return (
    <ProtectedRoute requiredRole="ops">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <nav className="text-sm text-gray-500 mb-2">
          <Link href="/designs" className="hover:text-gray-700">
            Designs
          </Link>
          <span className="mx-1">/</span>
          <span className="text-gray-900">Bulk upload</span>
        </nav>

        <h1 className="text-2xl font-bold text-gray-900">Bulk upload designs</h1>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Filename-driven ingestion: identity ends with <code className="text-xs bg-gray-100 px-1 rounded">_light</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">_dark</code>, or{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">_white</code> before the extension. Artwork is side-agnostic;
          placement is set on blanks and products. Preview and grouping are computed on the server.
        </p>

        <ol className="flex flex-wrap gap-4 mt-6 text-sm">
          {(["upload", "review", "import", "results"] as WizardStep[]).map((s, i) => (
            <li
              key={s}
              className={step === s ? "font-semibold text-blue-700" : "text-gray-500"}
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </li>
          ))}
        </ol>

        {step === "upload" && (
          <section className="mt-8 bg-white rounded-lg border border-gray-200 p-8">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="border-2 border-dashed border-gray-300 rounded-lg p-16 text-center bg-gray-50/50"
            >
              <input
                type="file"
                multiple
                className="hidden"
                id="bulk-upload-input"
                onChange={onFileInput}
              />
              <label htmlFor="bulk-upload-input" className="cursor-pointer">
                <p className="text-gray-800 font-medium">Drop files or click to browse</p>
                <p className="text-xs text-gray-500 mt-2">
                  PNG required for render-ready designs. SVG/PDF optional. .ai and other sources are ignored client-side;
                  the server validates again.
                </p>
              </label>
            </div>
            {accepted.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <p className="text-sm text-gray-700">
                  {rawFiles.length} file(s) selected · {accepted.length} accepted · {ignoredClient.length} ignored
                  (client)
                </p>
                <button
                  type="button"
                  disabled={parsing}
                  onClick={runUploadAndParse}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {parsing ? "Uploading & parsing…" : "Upload to server & preview"}
                </button>
              </div>
            )}
            {prepareError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                {prepareError}
              </div>
            )}
          </section>
        )}

        {step === "review" && (
          <section className="mt-8 space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-gray-700">
                Job <span className="font-mono">{jobId}</span> · {items.length} design group(s) · server ignored{" "}
                {ignoredServer.length} file(s)
                {parseFailures.length > 0 && (
                  <span className="text-amber-700"> · {parseFailures.length} parse error(s)</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep("upload");
                  setItems([]);
                  setJobId(null);
                }}
                className="text-sm text-gray-600 underline"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={runCommit}
                disabled={effectiveItems.length === 0 || importing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Commit import
              </button>
            </div>

            {(ignoredClient.length > 0 || ignoredServer.length > 0) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Ignored files</h3>
                <ul className="text-xs text-gray-600 max-h-32 overflow-y-auto space-y-1">
                  {ignoredClient.map((x) => (
                    <li key={`c-${x.name}`}>
                      <span className="font-mono">{x.name}</span> — {x.reason}
                      {x.detail && ` (${x.detail})`} <span className="text-gray-400">(client)</span>
                    </li>
                  ))}
                  {ignoredServer.map((x) => (
                    <li key={`s-${x.name}`}>
                      <span className="font-mono">{x.name}</span> — {x.reason}{" "}
                      <span className="text-gray-400">(server)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {parseFailures.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">Parse errors</h3>
                <ul className="text-xs space-y-1">
                  {parseFailures.map((p) => (
                    <li key={p.name}>
                      <span className="font-mono">{p.name}</span>: {p.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm text-gray-900">
                <thead className="bg-gray-50 border-b text-gray-800 font-semibold">
                  <tr>
                    <th className="text-left py-2 px-3">Name</th>
                    <th className="text-left py-2 px-3">Slug / key</th>
                    <th className="text-left py-2 px-3">League</th>
                    <th className="text-left py-2 px-3">Team</th>
                    <th className="text-left py-2 px-3">Theme</th>
                    <th className="text-left py-2 px-3">Apply to blanks</th>
                    <th className="text-left py-2 px-3">Series</th>
                    <th className="text-left py-2 px-3">Match</th>
                    <th className="text-center py-2 px-1">Lpng</th>
                    <th className="text-center py-2 px-1">Dpng</th>
                    <th className="text-center py-2 px-1">Wpng</th>
                    <th className="text-center py-2 px-1">SVG</th>
                    <th className="text-center py-2 px-1">PDF</th>
                    <th className="text-left py-2 px-3">Overwrite</th>
                    <th className="text-left py-2 px-3">Action</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {effectiveItems.map((it) => (
                    <tr key={it.itemId} className="border-b border-gray-100">
                      <td className="py-2 px-3 align-top">
                        <input
                          className="w-full min-w-[180px] border border-gray-200 rounded px-2 py-1 text-xs"
                          value={nameOverrides[it.itemId] ?? it.designName}
                          onChange={(e) =>
                            setNameOverrides((o) => ({ ...o, [it.itemId]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="py-2 px-3 align-top font-mono text-xs text-gray-800 max-w-[200px] break-all">
                        {it.slug}
                      </td>
                      <td className="py-2 px-3 align-top">{it.leagueCode}</td>
                      <td className="py-2 px-3 align-top text-xs">
                        {it.teamName || <span className="text-amber-700">Unmatched</span>}
                      </td>
                      <td className="py-2 px-3 align-top text-xs">{it.themeName}</td>
                      <td className="py-2 px-3 align-top text-xs">
                        <div className="flex flex-col gap-1 min-w-[160px]">
                          {(it.availableBlanks ?? []).length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            (it.availableBlanks ?? []).map((b) => {
                              const selected = (
                                targetBlanksByItem[it.itemId] ?? it.defaultTargetBlankIds ?? []
                              ).includes(b.blankId);
                              return (
                                <label
                                  key={b.blankId}
                                  className={`flex items-center gap-1 ${
                                    b.pipelineReady ? "text-gray-900" : "text-gray-500"
                                  }`}
                                  title={
                                    b.pipelineReady
                                      ? `Spawn a ${b.name || b.styleCode} product on commit`
                                      : "Renderer pipeline not ready yet for this blank"
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={!b.pipelineReady}
                                    onChange={(e) => {
                                      setTargetBlanksByItem((prev) => {
                                        const cur = new Set(
                                          prev[it.itemId] ?? it.defaultTargetBlankIds ?? []
                                        );
                                        if (e.target.checked) cur.add(b.blankId);
                                        else cur.delete(b.blankId);
                                        return { ...prev, [it.itemId]: [...cur] };
                                      });
                                    }}
                                  />
                                  <span className="font-mono">{b.styleCode}</span>
                                  <span className="truncate">{b.name || ""}</span>
                                  {!b.pipelineReady && (
                                    <span className="text-[10px] italic text-gray-500">
                                      (soon)
                                    </span>
                                  )}
                                </label>
                              );
                            })
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top text-xs">{it.designSeries ?? "—"}</td>
                      <td className="py-2 px-3 align-top text-xs">
                        {it.existingDesignId ? (
                          <Link href={`/designs/${it.existingDesignId}`} className="text-blue-600">
                            existing
                          </Link>
                        ) : (
                          "new"
                        )}
                      </td>
                      <td className="text-center">{coverageCell(it.assetCoverage.hasLightPng, false)}</td>
                      <td className="text-center">{coverageCell(it.assetCoverage.hasDarkPng, false)}</td>
                      <td className="text-center">{coverageCell(it.assetCoverage.hasWhitePng, true)}</td>
                      <td className="text-center">
                        {coverageCell(
                          it.assetCoverage.hasLightSvg ||
                            it.assetCoverage.hasDarkSvg ||
                            it.assetCoverage.hasWhiteSvg,
                          true
                        )}
                      </td>
                      <td className="text-center">
                        {coverageCell(
                          it.assetCoverage.hasLightPdf ||
                            it.assetCoverage.hasDarkPdf ||
                            it.assetCoverage.hasWhitePdf,
                          true
                        )}
                      </td>
                      <td className="py-2 px-3 align-top">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={overwriteByItem[it.itemId] ?? false}
                            disabled={
                              !it.existingDesignId || Object.keys(it.overwriteWarnings || {}).length === 0
                            }
                            onChange={(e) =>
                              setOverwriteByItem((o) => ({ ...o, [it.itemId]: e.target.checked }))
                            }
                          />
                          allow
                        </label>
                        {it.existingDesignId && Object.keys(it.overwriteWarnings || {}).length > 0 && (
                          <p className="text-[10px] text-amber-800 mt-1">
                            Slots: {Object.keys(it.overwriteWarnings || {}).join(", ")}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-3 align-top">
                        <select
                          className="border border-gray-200 rounded text-xs"
                          value={it.action}
                          onChange={(e) =>
                            setActionOverrides((o) => ({
                              ...o,
                              [it.itemId]: e.target.value as BulkPreviewItem["defaultAction"],
                            }))
                          }
                        >
                          <option value="create">create</option>
                          <option value="update">update</option>
                          <option value="skip">skip</option>
                          <option value="blocked">blocked</option>
                        </select>
                        {it.warnings.length > 0 && (
                          <p className="text-[10px] text-amber-800 mt-1">{it.warnings.join("; ")}</p>
                        )}
                        {it.errors.length > 0 && (
                          <p className="text-[10px] text-red-700 mt-1">{it.errors.join("; ")}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {step === "import" && (
          <div className="mt-12 text-center text-gray-600">
            <p>Importing on server…</p>
          </div>
        )}

        {step === "results" && (
          <section className="mt-8 space-y-4">
            {importError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{importError}</div>
            )}
            {!importError && commitSummary && (
              <>
                <p className="text-sm text-gray-700">
                  Job{" "}
                  <span className="font-mono">{jobId}</span>: created {commitSummary.created}, updated{" "}
                  {commitSummary.updated}, skipped {commitSummary.skipped}, blocked {commitSummary.blocked}, failed{" "}
                  {commitSummary.failed}.
                </p>
                {commitSummary.created > 0 && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 text-sm">
                    <strong>Auto-launch:</strong> Products are being created in the background for each new design ×
                    active master blank. Watch the <Link href="/products" className="underline">Products</Link> page —
                    rows will appear shortly and renders will queue automatically.
                  </div>
                )}
                <ul className="space-y-2 text-sm">
                  {commitResults.map((r) => (
                    <li key={r.itemId} className="flex flex-wrap gap-2 items-baseline">
                      <span className="font-mono text-xs">{r.itemId}</span>
                      <span
                        className={
                          r.resultStatus === "ok"
                            ? "text-green-700"
                            : r.resultStatus === "failed"
                              ? "text-red-700"
                              : "text-gray-600"
                        }
                      >
                        {r.resultStatus}
                      </span>
                      {r.resultDesignId && (
                        <Link href={`/designs/${r.resultDesignId}`} className="text-blue-600 text-xs">
                          Open design
                        </Link>
                      )}
                      {r.resultError && <span className="text-xs text-red-600">{r.resultError}</span>}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/designs"
                  className="inline-block mt-4 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm"
                >
                  Back to library
                </Link>
              </>
            )}
          </section>
        )}
      </div>
    </ProtectedRoute>
  );
}
