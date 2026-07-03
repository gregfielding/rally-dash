"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ref, uploadBytes } from "firebase/storage";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import ProtectedRoute from "@/components/ProtectedRoute";
import { filterBulkDesignFiles } from "@/lib/bulkDesignUpload";
import { parseDesignFilename } from "@/lib/batchImport/parseDesignFilename";
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

/**
 * Filename color token → canonical Ink-color value (Rally colorway convention:
 * `rally_orange_rally_light.png` parses to theme "Orange" → seeds "orange").
 * Multi-word canonical values ("royal blue") keep the shopper-facing tag pretty
 * (`color:royal_blue` → "Color: Royal Blue"). Non-color tokens never match.
 */
const INK_COLOR_SEED_BY_TOKEN: Record<string, string> = {
  orange: "orange",
  red: "red",
  royal: "royal blue",
  navy: "navy",
  green: "kelly green",
  gold: "gold",
  yellow: "yellow",
  purple: "purple",
  pink: "pink",
  powder: "powder blue",
  maroon: "maroon",
  black: "black",
  white: "white",
  blue: "blue",
  grey: "grey",
  gray: "grey",
};

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
  /**
   * Per-item editable storefront label ("Pillows", "Subway Series", "Vintage"...).
   * Defaults to the parser-derived themeName. Empty = use designType fallback
   * in product naming ("Custom" for custom_one_off).
   */
  const [productLabelByItem, setProductLabelByItem] = useState<Record<string, string>>({});
  /**
   * Per-item ink/brand accent color (e.g. "orange") — independent of garment fabric
   * colors. Flows to design.accentColor → product.accentColor → `color:` Shopify tag
   * + "Color: X" smart collection. Empty = no color tag.
   *
   * Auto-seeded from the filename when the parsed identity token is a recognized
   * color (Rally colorway convention: `rally_orange_rally_light.png` → "orange").
   * Non-color tokens ("Pillows", "City 69") never match, so team designs stay blank.
   */
  const [accentColorByItem, setAccentColorByItem] = useState<Record<string, string>>({});
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

  /**
   * Phase K6: shared file intake. Runs the existing extension/dotfile filter,
   * THEN a client-side filename-parse pass so structurally-broken names (missing
   * league/team/side tokens, bad garment tone) are rejected at drop time with a
   * clear reason — instead of riding through upload → server parse → review
   * screen before failing. Team-resolution ambiguity still defers to the server
   * (it needs the design_teams registry the client doesn't have), so we ONLY
   * demote on hard structural parse failures, never on team-matching.
   */
  const splitFiles = useCallback((list: File[]) => {
    const { accepted: acc, ignored: ign } = filterBulkDesignFiles(list);
    const STRUCTURAL_FAIL = new Set([
      "invalid_format",
      "unsupported_extension",
      "missing_token",
      "unknown_garment_tone",
    ]);
    const stillAccepted: typeof acc = [];
    const parseRejected: { name: string; reason: string; detail?: string }[] = [];
    for (const entry of acc) {
      const fname = entry.file.name;
      let res: { status?: string; message?: string };
      try {
        res = parseDesignFilename(fname);
      } catch (err) {
        res = { status: "invalid_format", message: err instanceof Error ? err.message : "parse error" };
      }
      if (res.status && STRUCTURAL_FAIL.has(res.status)) {
        parseRejected.push({ name: fname, reason: res.status, detail: res.message });
      } else {
        stillAccepted.push(entry);
      }
    }
    const ignoredAll = [
      ...ign.map((x) => ({ name: x.name, reason: x.reason, detail: x.detail })),
      ...parseRejected,
    ];
    return { accepted: stillAccepted, ignored: ignoredAll };
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const list = Array.from(e.dataTransfer.files);
    setRawFiles(list);
    const { accepted: acc, ignored: ign } = splitFiles(list);
    setAccepted(acc);
    setIgnoredClient(ign);
    setNameOverrides({});
    setActionOverrides({});
    setOverwriteByItem({});
    setPrepareError(null);
    setItems([]);
    setParseFailures([]);
    setIgnoredServer([]);
    setStep("upload");
  }, [splitFiles]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    setRawFiles(list);
    const { accepted: acc, ignored: ign } = splitFiles(list);
    setAccepted(acc);
    setIgnoredClient(ign);
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
      const nextLabels: Record<string, string> = {};
      const nextInkColors: Record<string, string> = {};
      for (const it of serverItems) {
        nextActions[it.itemId] = it.confirmedAction || it.defaultAction;
        nextOw[it.itemId] = false;
        nextTargets[it.itemId] = Array.isArray(it.defaultTargetBlankIds)
          ? [...it.defaultTargetBlankIds]
          : [];
        /**
         * Seed the Label field with the parser's themeName when it's NOT the
         * same word as the blank category — operators usually want the parsed
         * theme; only the "Thong"==="Thong" collision case starts empty so
         * they're prompted to type something meaningful.
         */
        const parsedTheme = (it.themeName || "").trim();
        nextLabels[it.itemId] = parsedTheme;
        /**
         * Seed Ink color when the parsed identity token IS a color (Rally
         * colorway filenames). Editable/clearable like the Label field.
         */
        const colorSeed = INK_COLOR_SEED_BY_TOKEN[parsedTheme.toLowerCase().replace(/[\s_]+/g, "")];
        if (colorSeed) {
          nextInkColors[it.itemId] = colorSeed;
        }
      }
      setActionOverrides(nextActions);
      setOverwriteByItem(nextOw);
      setTargetBlanksByItem(nextTargets);
      setProductLabelByItem(nextLabels);
      setAccentColorByItem(nextInkColors);

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

  /**
   * Same-team duplicate detection: any group of rows whose action ≠ "skip" that
   * share a teamId AND target overlapping blanks would spawn multiple distinct
   * products for the same team+blank slot — almost always because the operator
   * dropped two filename-variants of the same design. We don't auto-merge them
   * (the importKey + groupKey are genuinely different), but we surface a clear
   * banner + per-row warning so they don't get committed by mistake.
   */
  const duplicateTeamWarnings = useMemo(() => {
    const map = new Map<string, { itemIds: string[]; designNames: string[] }>();
    for (const it of effectiveItems) {
      if (it.action === "skip") continue;
      const teamId = (it.teamId || "").trim();
      if (!teamId) continue;
      const selectedBlanks = (targetBlanksByItem[it.itemId] ?? it.defaultTargetBlankIds ?? [])
        .slice()
        .sort();
      if (selectedBlanks.length === 0) continue;
      for (const blankId of selectedBlanks) {
        const key = `${teamId}::${blankId}`;
        if (!map.has(key)) map.set(key, { itemIds: [], designNames: [] });
        const entry = map.get(key)!;
        entry.itemIds.push(it.itemId);
        entry.designNames.push(it.designName);
      }
    }
    /** Per-item: ids of other items it collides with on at least one (team, blank). */
    const perItem: Record<string, { otherDesignNames: string[]; sharedBlanks: string[] }> = {};
    for (const [key, entry] of map.entries()) {
      if (entry.itemIds.length < 2) continue;
      const [, blankId] = key.split("::");
      for (const id of entry.itemIds) {
        if (!perItem[id]) perItem[id] = { otherDesignNames: [], sharedBlanks: [] };
        const others = entry.itemIds.filter((x) => x !== id);
        for (const o of others) {
          const otherName = effectiveItems.find((x) => x.itemId === o)?.designName || o;
          if (!perItem[id].otherDesignNames.includes(otherName)) {
            perItem[id].otherDesignNames.push(otherName);
          }
        }
        if (!perItem[id].sharedBlanks.includes(blankId)) {
          perItem[id].sharedBlanks.push(blankId);
        }
      }
    }
    const totalCollisionGroups = [...map.values()].filter((e) => e.itemIds.length > 1).length;
    return { perItem, totalCollisionGroups };
  }, [effectiveItems, targetBlanksByItem]);

  /**
   * Phase K5: pre-commit product-count preview. Pure client computation over
   * the in-memory items — gives the operator a "this will create N products"
   * number BEFORE clicking commit, so the bulk fan-out is never a surprise.
   *
   * Counts ONLY pipeline-ready blanks (onDesignCreated skips non-ready ones),
   * and only items whose action will actually create/update. A product is one
   * (design × pipeline-ready blank).
   */
  const commitPreview = useMemo(() => {
    let designs = 0;
    let products = 0;
    let nonReadySelected = 0;
    for (const it of effectiveItems) {
      if (it.confirmedAction !== "create" && it.confirmedAction !== "update") continue;
      const selected = targetBlanksByItem[it.itemId] ?? it.defaultTargetBlankIds ?? [];
      if (selected.length === 0) continue;
      const readyById = new Map((it.availableBlanks || []).map((b) => [b.blankId, b.pipelineReady]));
      let readyForItem = 0;
      for (const blankId of selected) {
        if (readyById.get(blankId) === true) readyForItem += 1;
        else if (readyById.has(blankId)) nonReadySelected += 1;
      }
      if (readyForItem > 0) {
        designs += 1;
        products += readyForItem;
      }
    }
    return { designs, products, nonReadySelected };
  }, [effectiveItems, targetBlanksByItem]);

  const runCommit = useCallback(async (commitMode: "with_products" | "library" = "with_products") => {
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
        productLabel: productLabelByItem[it.itemId] ?? "",
        accentColor: accentColorByItem[it.itemId] ?? "",
      }));

      const out = await commitBulkImport({ jobId, items: decisions, commitMode });
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
  }, [
    jobId,
    effectiveItems,
    nameOverrides,
    targetBlanksByItem,
    productLabelByItem,
    accentColorByItem,
    commitBulkImport,
    mutateDesigns,
  ]);

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
              <div className="flex flex-col items-end gap-2">
                {/* Phase K5: live product-count preview so the fan-out is never a surprise. */}
                <div className="text-xs text-gray-600">
                  {commitPreview.products > 0 ? (
                    <span>
                      Will create <strong className="text-gray-900">{commitPreview.products}</strong> product
                      {commitPreview.products === 1 ? "" : "s"} across{" "}
                      <strong className="text-gray-900">{commitPreview.designs}</strong> design
                      {commitPreview.designs === 1 ? "" : "s"}.
                      {commitPreview.nonReadySelected > 0 ? (
                        <span className="text-amber-700">
                          {" "}
                          {commitPreview.nonReadySelected} selected blank
                          {commitPreview.nonReadySelected === 1 ? "" : "s"} not pipeline-ready — skipped.
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-gray-400">No products will spawn (no pipeline-ready blanks selected).</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runCommit("library")}
                    disabled={effectiveItems.length === 0 || importing}
                    title="Save the design files to the library only. No products are spawned. You can launch products later from the design page."
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    Commit to library
                  </button>
                  <button
                    type="button"
                    onClick={() => runCommit("with_products")}
                    disabled={effectiveItems.length === 0 || importing}
                    title="Save the design files AND auto-launch a product for each blank checked in the Apply to blanks column."
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {commitPreview.products > 0
                      ? `Commit + create ${commitPreview.products} product${commitPreview.products === 1 ? "" : "s"}`
                      : "Commit + create products"}
                  </button>
                </div>
              </div>
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

            {duplicateTeamWarnings.totalCollisionGroups > 0 && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  Possible duplicate designs detected
                </p>
                <p className="mt-1">
                  {duplicateTeamWarnings.totalCollisionGroups === 1
                    ? "Two or more rows below"
                    : `${duplicateTeamWarnings.totalCollisionGroups} groups of rows below`}{" "}
                  target the same team + blank slot. Committing them all would
                  create separate products with different importKeys instead of
                  one product. If they&rsquo;re really the same design under different
                  filenames, set all-but-one to <span className="font-mono">skip</span> in
                  the Action column. Affected rows are highlighted in amber below.
                </p>
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
                    <th
                      className="text-left py-2 px-3"
                      title="Storefront label used in product titles (e.g. 'Pillows', 'Subway Series'). Defaults to the parsed theme from the filename; edit to whatever should appear after the team name. Leave blank to fall back to the designType default ('Custom' for one-offs)."
                    >
                      Label
                    </th>
                    <th
                      className="text-left py-2 px-3"
                      title="Ink/brand accent color of the artwork (e.g. 'orange') — NOT the garment fabric color. Adds a color: tag to spawned products, which auto-creates a 'Color: X' Shopify collection for shop-by-color. Leave blank for no color tag."
                    >
                      Ink&nbsp;color
                    </th>
                    <th className="text-left py-2 px-3">Apply to blanks</th>
                    <th className="text-left py-2 px-3">Series</th>
                    <th className="text-left py-2 px-3">Match</th>
                    <th
                      className="text-center py-2 px-1"
                      title="Light-tone PNG (filename ends _light.png). Required for rendering light fabric mockups."
                    >
                      Light&nbsp;PNG
                    </th>
                    <th
                      className="text-center py-2 px-1"
                      title="Dark-tone PNG (filename ends _dark.png). Required for rendering dark fabric mockups."
                    >
                      Dark&nbsp;PNG
                    </th>
                    <th
                      className="text-center py-2 px-1"
                      title="White-tone PNG (filename ends _white.png). Optional — used for special-case high-contrast prints (e.g. pink fabric)."
                    >
                      White&nbsp;PNG
                    </th>
                    <th
                      className="text-center py-2 px-1"
                      title="Vector SVG (any tone). Optional — production asset; not rendered into mockups."
                    >
                      SVG
                    </th>
                    <th
                      className="text-center py-2 px-1"
                      title="Print PDF (any tone). Optional — production asset; not rendered into mockups."
                    >
                      PDF
                    </th>
                    <th className="text-left py-2 px-3">Overwrite</th>
                    <th className="text-left py-2 px-3">Notes</th>
                    <th className="text-left py-2 px-3">Action</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {effectiveItems.map((it) => {
                    const dupe = duplicateTeamWarnings.perItem[it.itemId];
                    return (
                    <tr
                      key={it.itemId}
                      className={`border-b border-gray-100 ${
                        dupe ? "bg-amber-50" : ""
                      }`}
                    >
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
                      <td className="py-2 px-3 align-top text-xs">
                        <input
                          className="w-full min-w-[110px] border border-gray-200 rounded px-2 py-1 text-xs text-gray-900"
                          placeholder={it.themeName || "Custom"}
                          value={productLabelByItem[it.itemId] ?? ""}
                          onChange={(e) =>
                            setProductLabelByItem((o) => ({
                              ...o,
                              [it.itemId]: e.target.value,
                            }))
                          }
                          title="Goes in product title between team name and blank type. Leave blank to use the designType default."
                        />
                      </td>
                      <td className="py-2 px-3 align-top text-xs">
                        <input
                          className="w-full min-w-[80px] border border-gray-200 rounded px-2 py-1 text-xs text-gray-900"
                          placeholder="e.g. orange"
                          value={accentColorByItem[it.itemId] ?? ""}
                          onChange={(e) =>
                            setAccentColorByItem((o) => ({
                              ...o,
                              [it.itemId]: e.target.value,
                            }))
                          }
                          title="Ink/brand color of the artwork itself (not the garment). Adds a color: tag → auto 'Color: X' Shopify collection. Leave blank for none."
                        />
                      </td>
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
                                      ? `On commit, auto-spawn a ${
                                          b.name || b.styleCode
                                        } product for this team with all of its catalog colors as variants.`
                                      : `Renderer pipeline for ${
                                          b.name || b.styleCode
                                        } is not wired yet. Only blanks whose asset-generation pipeline can produce mockups today are selectable — currently styleCode 8394 (Bikini Panty) is the only one. This blank stays in the catalog and remains orderable; it just can't auto-launch products until its render path is built.`
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
                      <td className="py-2 px-3 align-top text-xs">
                        <div className="flex flex-col gap-1 max-w-[260px]">
                          {it.errors.length === 0 &&
                            it.warnings.length === 0 &&
                            !dupe && <span className="text-gray-400">—</span>}
                          {it.errors.length > 0 && (
                            <p className="text-red-700 font-medium">
                              <span className="font-semibold">Error:</span>{" "}
                              {it.errors.join("; ")}
                            </p>
                          )}
                          {dupe && (
                            <p className="text-amber-900 font-medium">
                              <span className="font-semibold">Possible duplicate:</span>{" "}
                              targets the same team + blank as{" "}
                              {dupe.otherDesignNames
                                .map((n) => `"${n}"`)
                                .join(", ")}
                              . Set this row or the other to{" "}
                              <span className="font-mono">skip</span> before commit.
                            </p>
                          )}
                          {it.warnings.length > 0 && (
                            <p className="text-amber-800">
                              <span className="font-semibold">Warning:</span>{" "}
                              {it.warnings.join("; ")}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top">
                        <select
                          className="border border-gray-200 rounded text-xs text-gray-900"
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
                      </td>
                    </tr>
                  );
                  })}
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
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 text-sm space-y-2">
                    <p>
                      <strong>Auto-launch:</strong> Products are being created in the background for each new design ×
                      active master blank. Renders queue automatically — watch them on the{" "}
                      <Link href="/dashboard" className="underline">dashboard</Link> &ldquo;Recent batches&rdquo;.
                    </p>
                    {(() => {
                      /** Phase K3: deep link to exactly the products this import spawned,
                       *  filtered by the design ids that committed OK. */
                      const okDesignIds = commitResults
                        .filter((r) => r.resultStatus === "ok" && r.resultDesignId)
                        .map((r) => r.resultDesignId as string);
                      if (okDesignIds.length === 0) return null;
                      const href = `/products?designImportIds=${encodeURIComponent(okDesignIds.join(","))}`;
                      return (
                        <Link
                          href={href}
                          className="inline-block px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                        >
                          View created products ({okDesignIds.length} design{okDesignIds.length === 1 ? "" : "s"}) →
                        </Link>
                      );
                    })()}
                  </div>
                )}
                <ul className="space-y-2 text-sm">
                  {commitResults.map((r) => {
                    /** Phase K7: join back to the reviewed item so the operator
                     *  sees the friendly design name + team that committed —
                     *  verifies the filename parse + naming convention fired
                     *  without opening any product page. */
                    const item = items.find((it) => it.itemId === r.itemId);
                    const friendly = item
                      ? [item.teamName, item.themeName || item.designName].filter(Boolean).join(" · ")
                      : null;
                    return (
                      <li key={r.itemId} className="flex flex-wrap gap-2 items-baseline">
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
                        {friendly ? (
                          <span className="font-medium text-gray-900">{friendly}</span>
                        ) : (
                          <span className="font-mono text-xs">{r.itemId}</span>
                        )}
                        {item?.slug ? (
                          <span className="font-mono text-[11px] text-gray-400">{item.slug}</span>
                        ) : null}
                        {r.resultDesignId && (
                          <Link href={`/designs/${r.resultDesignId}`} className="text-blue-600 text-xs">
                            Open design
                          </Link>
                        )}
                        {r.resultError && <span className="text-xs text-red-600">{r.resultError}</span>}
                      </li>
                    );
                  })}
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
