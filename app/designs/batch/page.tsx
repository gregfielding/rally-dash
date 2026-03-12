"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  doc,
  updateDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  parseDesignFilename,
  groupParsedFiles,
  suggestedDesignName,
  type ParseResult,
} from "@/lib/batchImport/parseDesignFilename";
import {
  productIdentityKey,
  productTitle,
  productHandle,
  slugFromString,
  type ParsedForProduct,
} from "@/lib/batchImport/productGeneration";
import {
  useDesigns,
  useDesignTeams,
  useCreateDesign,
  useUpdateDesignFile,
} from "@/lib/hooks/useDesignAssets";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { db, storage } from "@/lib/firebase/config";
import { useAuth } from "@/lib/providers/AuthProvider";
import type { DesignDoc } from "@/lib/types/firestore";

type Step = "upload" | "preview";
type ImportRowResult = { baseKey: string; action: "created" | "updated" | "skipped"; designId: string; error?: string };
type ProductRowResult = { baseKey: string; productId: string; productSlug?: string; action: "created" | "updated"; error?: string };

function BatchImportContent() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(null);

  const { designs: allDesigns } = useDesigns({});
  const { teams } = useDesignTeams();
  const { createDesign } = useCreateDesign();
  const { updateFile } = useUpdateDesignFile();
  const { blanks } = useBlanks({ status: "active" });
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  const [selectedForProducts, setSelectedForProducts] = useState<Set<string>>(new Set());
  const [selectedBlankId, setSelectedBlankId] = useState<string>("");
  const [productStatus, setProductStatus] = useState<"draft" | "approved">("draft"); // stored as draft | active
  const [generating, setGenerating] = useState(false);
  const [productResults, setProductResults] = useState<ProductRowResult[] | null>(null);

  /** Map importKey → design for duplicate detection */
  const existingByImportKey = useMemo(() => {
    const map = new Map<string, DesignDoc>();
    for (const d of allDesigns ?? []) {
      if (d.importKey) map.set(d.importKey, d);
    }
    return map;
  }, [allDesigns]);

  /** Resolve teamCode (e.g. GIANTS) to teamId. No fallback — unresolved teams are explicit (skip or import without team). */
  const resolveTeamId = useCallback(
    (teamCode: string): string | null => {
      const code = teamCode.toUpperCase();
      const normalized = (s: string) => s.toUpperCase().replace(/\s+/g, " ").replace(/_/g, " ");
      for (const t of teams ?? []) {
        if (t.id.toUpperCase().includes(code) || normalized(t.name).includes(code)) return t.id;
      }
      return null;
    },
    [teams]
  );

  const parseResults: Array<{ file: File; result: ParseResult }> = files.map((file) => ({
    file,
    result: parseDesignFilename(file.name),
  }));

  const grouped = groupParsedFiles(parseResults);
  const validCount = parseResults.filter((r) => r.result.status === "valid").length;
  const invalidCount = files.length - validCount;
  const countByExt = files.reduce(
    (acc, f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      acc[ext] = (acc[ext] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const list = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      return ["png", "svg", "pdf"].includes(ext);
    });
    setFiles((prev) => [...prev, ...list]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).filter((f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      return ["png", "svg", "pdf"].includes(ext);
    });
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setStep("upload");
    setImportResults(null);
    setSelectedForProducts(new Set());
    setProductResults(null);
  }, []);

  const runImport = useCallback(async () => {
    if (!db || !storage || grouped.size === 0) return;
    setImporting(true);
    setImportResults(null);
    const results: ImportRowResult[] = [];
    const defaultColors = [{ hex: "#000000", name: "", role: "ink" as const }];

    for (const [baseKey, row] of grouped.entries()) {
      const { parsed, files: rowFiles } = row;
      const sideLower = parsed.side.toLowerCase();
      const existing = existingByImportKey.get(baseKey);
      let designId: string;

      try {
        if (existing?.id) {
          designId = existing.id;
          for (const { file, ext } of rowFiles) {
            const storagePath = `designs/${designId}/${ext}/${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);
            const isPng = ext === "png";
            await updateFile({
              designId,
              kind: ext as "png" | "svg" | "pdf",
              storagePath,
              downloadUrl,
              fileName: file.name,
              contentType: file.type || (isPng ? "image/png" : ext === "svg" ? "image/svg+xml" : "application/pdf"),
              sizeBytes: file.size,
              ...(isPng && { widthPx: 0, heightPx: 0 }),
            });
          }
          const designRef = doc(db, "designs", designId);
          await updateDoc(designRef, {
            importKey: baseKey,
            leagueCode: parsed.league,
            designFamily: parsed.designFamily,
            teamCode: parsed.team,
            supportedSides: [sideLower],
            variant: parsed.variant,
            updatedAt: new Date(),
            updatedByUid: uid,
          });
          results.push({ baseKey, action: "updated", designId });
        } else {
          const teamId = resolveTeamId(parsed.team);
          if (teamId === null) {
            results.push({ baseKey, action: "skipped", designId: "", error: "Unresolved team: " + parsed.team + " (no matching team; row skipped)" });
            continue;
          }
          const name = suggestedDesignName(parsed);
          const { designId: newId } = await createDesign({ name, teamId, colors: defaultColors });
          designId = newId;
          for (const { file, ext } of rowFiles) {
            const storagePath = `designs/${designId}/${ext}/${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);
            const isPng = ext === "png";
            await updateFile({
              designId,
              kind: ext as "png" | "svg" | "pdf",
              storagePath,
              downloadUrl,
              fileName: file.name,
              contentType: file.type || (isPng ? "image/png" : ext === "svg" ? "image/svg+xml" : "application/pdf"),
              sizeBytes: file.size,
              ...(isPng && { widthPx: 0, heightPx: 0 }),
            });
          }
          const designRef = doc(db, "designs", designId);
          await updateDoc(designRef, {
            importKey: baseKey,
            leagueCode: parsed.league,
            designFamily: parsed.designFamily,
            teamCode: parsed.team,
            supportedSides: [sideLower],
            variant: parsed.variant,
            updatedAt: new Date(),
            updatedByUid: uid,
          });
          results.push({ baseKey, action: "created", designId });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          baseKey,
          action: existing?.id ? "updated" : "created",
          designId: existing?.id ?? "",
          error: message,
        });
      }
    }

    setImportResults(results);
    setImporting(false);
  }, [grouped, existingByImportKey, createDesign, updateFile, resolveTeamId, uid]);

  /** Rows that were successfully imported (created or updated) and can be used for product generation */
  const successfulImportRows = useMemo(() => {
    if (!importResults) return [];
    return importResults.filter(
      (r) => (r.action === "created" || r.action === "updated") && !!r.designId && !r.error
    );
  }, [importResults]);

  const toggleSelectedForProduct = useCallback((baseKey: string) => {
    setSelectedForProducts((prev) => {
      const next = new Set(prev);
      if (next.has(baseKey)) next.delete(baseKey);
      else next.add(baseKey);
      return next;
    });
  }, []);

  const selectAllForProducts = useCallback(() => {
    setSelectedForProducts(new Set(successfulImportRows.map((r) => r.baseKey)));
  }, [successfulImportRows]);

  const runGenerateProducts = useCallback(async () => {
    if (!db || !selectedBlankId || selectedForProducts.size === 0) return;
    const blank = blanks?.find((b) => b.blankId === selectedBlankId);
    if (!blank?.images?.front?.downloadUrl || !blank?.images?.back?.downloadUrl) {
      return;
    }
    setGenerating(true);
    setProductResults(null);
    const results: ProductRowResult[] = [];
    const placementKeyFront = "front_center";
    const placementKeyBack = "back_center";
    const defaultPlacement = { x: 0.5, y: 0.5, scale: 0.6 };

    for (const baseKey of selectedForProducts) {
      const result = importResults?.find((r) => r.baseKey === baseKey);
      const row = grouped.get(baseKey);
      if (!result?.designId || !row) {
        results.push({ baseKey, productId: "", action: "created", error: "Missing design or row" });
        continue;
      }
      const { parsed } = row;
      const side = parsed.side.toUpperCase();
      const parsedForProduct: ParsedForProduct = {
        leagueCode: parsed.league,
        designFamily: parsed.designFamily,
        teamCode: parsed.team,
        side,
        variant: parsed.variant,
      };
      const identityKey = productIdentityKey(
        parsed.league,
        parsed.designFamily,
        parsed.team,
        selectedBlankId,
        parsed.variant
      );

      try {
        const designSnap = await getDoc(doc(db, "designs", result.designId));
        if (!designSnap.exists()) {
          results.push({ baseKey, productId: "", action: "created", error: "Design not found" });
          continue;
        }
        const design = designSnap.data() as DesignDoc & { files?: { png?: { downloadUrl?: string }; pdf?: { downloadUrl?: string } } };
        const designPngUrl = design.files?.png?.downloadUrl ?? null;
        const designPdfUrl = design.files?.pdf?.downloadUrl ?? null;
        if (!designPngUrl) {
          results.push({ baseKey, productId: "", action: "created", error: "Design missing PNG" });
          continue;
        }

        const productsRef = collection(db, "rp_products");
        const q = query(productsRef, where("productIdentityKey", "==", identityKey));
        const existingSnap = await getDocs(q);
        const existingProduct = existingSnap.empty ? null : existingSnap.docs[0];
        const blankFrontUrl = blank.images?.front?.downloadUrl ?? "";
        const blankBackUrl = blank.images?.back?.downloadUrl ?? "";

        const tags = [
          `league:${parsed.league.toLowerCase()}`,
          `team:${parsed.team.toLowerCase()}`,
          `family:${parsed.designFamily.toLowerCase()}`,
          `variant:${parsed.variant.toLowerCase()}`,
        ];
        const renderSideConfig = (designId: string, designUrl: string, blankUrl: string, placementKey: string) => ({
          designAssetId: designId,
          designAssetUrl: designUrl,
          blankAssetId: selectedBlankId,
          blankImageUrl: blankUrl,
          placementKey,
          placementOverride: defaultPlacement,
          blendMode: "multiply" as const,
          blendOpacity: 87,
        });

        if (!existingProduct) {
          const title = productTitle(parsedForProduct, blank.styleName ?? "Product");
          const handleSlug = productHandle(parsedForProduct, blank.slug ?? selectedBlankId);
          let slug = slugFromString(handleSlug);
          const slugCheck = await getDocs(query(productsRef, where("slug", "==", slug)));
          if (!slugCheck.empty) slug = `${slug}-${Date.now().toString(36)}`;
          const name = title;
          const now = serverTimestamp();
          const renderSetup: Record<string, unknown> = {
            defaults: { blankId: selectedBlankId, designIdFront: null, designIdBack: null },
          };
          if (side === "FRONT") {
            renderSetup.front = renderSideConfig(result.designId, designPngUrl, blankFrontUrl, placementKeyFront);
            renderSetup.defaults = { ...(renderSetup.defaults as object), designIdFront: result.designId };
          } else {
            renderSetup.back = renderSideConfig(result.designId, designPngUrl, blankBackUrl, placementKeyBack);
            renderSetup.defaults = { ...(renderSetup.defaults as object), designIdBack: result.designId };
          }
          const productData = {
            slug,
            name,
            title,
            handle: slug,
            description: null,
            category: "panties",
            baseProductKey: `DESIGN_${result.designId}_BLANK_${selectedBlankId}`,
            productIdentityKey: identityKey,
            generatedFromImportKey: baseKey,
            colorway: { name: blank.colorName ?? "Default", hex: blank.colorHex ?? null },
            blankId: selectedBlankId,
            designId: result.designId,
            designIdFront: side === "FRONT" ? result.designId : null,
            designIdBack: side === "BACK" ? result.designId : null,
            status: productStatus === "approved" ? "active" : "draft",
            tags,
            renderSetup,
            media: { heroFront: null, heroBack: null, gallery: [] },
            production: {
              printPdfFront: side === "FRONT" && designPdfUrl ? designPdfUrl : null,
              printPdfBack: side === "BACK" && designPdfUrl ? designPdfUrl : null,
            },
            shopify: { status: "not_synced" as const },
            counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
            createdAt: now,
            updatedAt: now,
            createdBy: uid,
            updatedBy: uid,
          };
          const productRef = await addDoc(productsRef, productData);
          results.push({ baseKey, productId: productRef.id, productSlug: slug, action: "created" });
        } else {
          const productId = existingProduct.id;
          const current = existingProduct.data() as Record<string, unknown>;
          const rs = (current.renderSetup as Record<string, unknown>) || {};
          const updateData: Record<string, unknown> = {
            updatedAt: serverTimestamp(),
            updatedBy: uid,
          };
          if (current.generatedFromImportKey == null) updateData.generatedFromImportKey = baseKey;
          if (side === "FRONT") {
            updateData.designIdFront = result.designId;
            updateData.renderSetup = {
              ...rs,
              front: renderSideConfig(result.designId, designPngUrl, blankFrontUrl, placementKeyFront),
              defaults: { ...(rs.defaults as Record<string, unknown> || {}), blankId: selectedBlankId, designIdFront: result.designId },
            };
            if (designPdfUrl) updateData.production = { ...(current.production as Record<string, unknown> || {}), printPdfFront: designPdfUrl };
          } else {
            updateData.designIdBack = result.designId;
            updateData.renderSetup = {
              ...rs,
              back: renderSideConfig(result.designId, designPngUrl, blankBackUrl, placementKeyBack),
              defaults: { ...(rs.defaults as Record<string, unknown> || {}), blankId: selectedBlankId, designIdBack: result.designId },
            };
            if (designPdfUrl) updateData.production = { ...(current.production as Record<string, unknown> || {}), printPdfBack: designPdfUrl };
          }
          await updateDoc(doc(db, "rp_products", productId), updateData);
          const existingSlug = (existingProduct.data() as { slug?: string }).slug;
          results.push({ baseKey, productId, productSlug: existingSlug, action: "updated" });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ baseKey, productId: "", action: "created", error: message });
      }
    }

    setProductResults(results);
    setGenerating(false);
  }, [
    db,
    uid,
    grouped,
    importResults,
    selectedBlankId,
    selectedForProducts,
    blanks,
    productStatus,
  ]);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-2">
          <Link href="/designs" className="hover:text-gray-700">
            Designs
          </Link>
          <span className="mx-1">/</span>
          <span className="text-gray-900">Batch Import</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Batch Design Import</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload PNG, SVG, or PDF files. Filenames must follow: LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT (e.g. MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT.png).
        </p>
      </div>

      {/* Step 1 — Upload */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Upload</h2>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive ? "border-blue-500 bg-blue-50/50" : "border-gray-300 bg-gray-50/50"
          }`}
        >
          <input
            type="file"
            accept=".png,.svg,.pdf"
            multiple
            onChange={handleFileInput}
            className="hidden"
            id="batch-import-file-input"
          />
          <label htmlFor="batch-import-file-input" className="cursor-pointer block">
            <p className="text-gray-600 mb-1">Drag files here or click to browse</p>
            <p className="text-xs text-gray-500">PNG, SVG, PDF only</p>
          </label>
        </div>
        {files.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <p className="text-sm font-medium text-gray-700">
              {files.length} file{files.length !== 1 ? "s" : ""} selected
              {Object.keys(countByExt).length > 0 && (
                <span className="text-gray-500 font-normal ml-2">
                  ({countByExt.png ?? 0} PNG, {countByExt.svg ?? 0} SVG, {countByExt.pdf ?? 0} PDF)
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setStep("preview")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Parse &amp; preview
            </button>
            <button
              type="button"
              onClick={clearFiles}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              Clear
            </button>
          </div>
        )}
      </section>

      {/* Step 2 — Parsed Preview */}
      {step === "preview" && files.length > 0 && (
        <>
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Parsed preview</h2>
            <p className="text-sm text-gray-500 mb-3">
              {validCount} valid, {invalidCount} invalid or skipped. Grouped into {grouped.size} design(s).
            </p>
            <div className="overflow-x-auto -mx-2">
              <table className="min-w-full text-sm border border-gray-200">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Filename</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Ext</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">League</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Family</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Team</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Side</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Variant</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Suggested name</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResults.map(({ file, result }, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 px-3 text-gray-900 font-mono text-xs max-w-[200px] truncate" title={file.name}>
                        {file.name}
                      </td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.extension ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.league ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.designFamily ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.team ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.side ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{result.parsed?.variant ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-700">{result.parsed ? suggestedDesignName(result.parsed) : "—"}</td>
                      <td className="py-2 px-3">
                        <span
                          className={
                            result.status === "valid"
                              ? "text-green-600"
                              : "text-amber-600"
                          }
                        >
                          {result.status === "valid" ? "Valid" : result.status.replace(/_/g, " ")}
                        </span>
                        {result.message && (
                          <span className="text-gray-500 text-xs block" title={result.message}>
                            {result.message.length > 40 ? result.message.slice(0, 40) + "…" : result.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Grouped designs */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Grouped designs</h2>
            <p className="text-sm text-gray-500 mb-3">
              Files with the same base key become one design record. Matching key: league + family + team + side + variant.
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={runImport}
                disabled={importing || grouped.size === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {importing ? "Importing…" : `Import ${grouped.size} design${grouped.size !== 1 ? "s" : ""}`}
              </button>
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="min-w-full text-sm border border-gray-200">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Key</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Suggested name</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">PNG</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">SVG</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">PDF</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Import</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([key, row]) => {
                    const hasPng = row.files.some((f) => f.ext === "png");
                    const hasSvg = row.files.some((f) => f.ext === "svg");
                    const hasPdf = row.files.some((f) => f.ext === "pdf");
                    const existing = existingByImportKey.get(key);
                    const suggestedName = suggestedDesignName(row.parsed);
                    return (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="py-2 px-3 font-mono text-xs text-gray-900">{row.baseKey}</td>
                        <td className="py-2 px-3 text-gray-700">{suggestedName}</td>
                        <td className="py-2 px-3">{hasPng ? "✓" : "—"}</td>
                        <td className="py-2 px-3">{hasSvg ? "✓" : "—"}</td>
                        <td className="py-2 px-3">{hasPdf ? "✓" : "—"}</td>
                        <td className="py-2 px-3">{existing ? <span className="text-amber-600">Update</span> : <span className="text-green-600">Create</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {importResults && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Import results</h3>
                <ul className="space-y-1 text-sm">
                  {importResults.map((r, i) => (
                    <li key={i} className={r.action === "skipped" || r.error ? "text-amber-700" : "text-gray-700"}>
                      {r.baseKey} → {r.action === "skipped" ? "Skipped (unresolved team)" : r.error ? r.error : (r.action === "created" ? "Created" : "Updated")}
                      {r.designId && <><span className="ml-1">·</span> <Link href={`/designs/${r.designId}`} className="text-blue-600 hover:underline">View</Link></>}
                      {r.action === "skipped" && r.error && <span className="block text-xs text-amber-600 mt-0.5">{r.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Phase 3: Generate products from imported designs */}
            {successfulImportRows.length > 0 && (
              <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Generate products</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Create or update Rally products from selected imported designs. One product per identity (league + family + team + blank + variant); FRONT and BACK imports map to the same product.
                </p>
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700">Blank</span>
                    <select
                      value={selectedBlankId}
                      onChange={(e) => setSelectedBlankId(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="">Select blank…</option>
                      {(blanks ?? []).map((b) => (
                        <option key={b.blankId} value={b.blankId}>
                          {b.styleName ?? b.blankId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700">Status</span>
                    <select
                      value={productStatus}
                      onChange={(e) => setProductStatus(e.target.value as "draft" | "approved")}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="draft">Draft</option>
                      <option value="approved">Approved</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={selectAllForProducts}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Select all ({successfulImportRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={runGenerateProducts}
                    disabled={generating || !selectedBlankId || selectedForProducts.size === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {generating ? "Generating…" : `Generate products (${selectedForProducts.size} selected)`}
                  </button>
                </div>
                <div className="overflow-x-auto -mx-2">
                  <table className="min-w-full text-sm border border-gray-200">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-700 w-8">
                          <input
                            type="checkbox"
                            checked={successfulImportRows.length > 0 && selectedForProducts.size === successfulImportRows.length}
                            onChange={(e) => (e.target.checked ? selectAllForProducts() : setSelectedForProducts(new Set()))}
                            className="rounded border-gray-300"
                          />
                        </th>
                        <th className="text-left py-2 px-3 font-medium text-gray-700">Key</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-700">Side</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-700">Design</th>
                      </tr>
                    </thead>
                    <tbody>
                      {successfulImportRows.map((r) => {
                        const row = grouped.get(r.baseKey);
                        return (
                          <tr key={r.baseKey} className="border-b border-gray-100">
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                checked={selectedForProducts.has(r.baseKey)}
                                onChange={() => toggleSelectedForProduct(r.baseKey)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono text-xs text-gray-900">{r.baseKey}</td>
                            <td className="py-2 px-3 text-gray-600">{row?.parsed?.side ?? "—"}</td>
                            <td className="py-2 px-3">
                              <Link href={`/designs/${r.designId}`} className="text-blue-600 hover:underline">View design</Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {productResults && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Product results</h3>
                    <ul className="space-y-1 text-sm">
                      {productResults.map((r, i) => (
                        <li key={i} className={r.error ? "text-amber-700" : "text-gray-700"}>
                          {r.baseKey} → {r.error ? r.error : (r.action === "created" ? "Created" : "Updated")}
                          {r.productId && (
                            <>
                              <span className="ml-1">·</span>
                              <Link href={r.productSlug ? `/products/${r.productSlug}` : "#"} className="text-blue-600 hover:underline">
                                View product
                              </Link>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-gray-500 mt-2">
                      Created: {productResults.filter((x) => x.action === "created" && !x.error).length} · Updated: {productResults.filter((x) => x.action === "updated").length}
                      {productResults.some((x) => x.error) && ` · Errors: ${productResults.filter((x) => x.error).length}`}
                    </p>
                  </div>
                )}
              </section>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function BatchImportPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <BatchImportContent />
    </ProtectedRoute>
  );
}
