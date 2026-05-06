"use client";

import { useMemo, useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TableSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import { LaunchOpsFilter, useProducts } from "@/lib/hooks/useRPProducts";
import {
  useBulkProductOps,
  useCreateProductFromDesignBlank,
  useLaunchProductsFromDesign,
} from "@/lib/hooks/useRPProductMutations";
import { useBatchGeneration } from "@/lib/hooks/useBatchGeneration";
import { useDesigns, useDesignTeams } from "@/lib/hooks/useDesignAssets";
import GenerateTeamProductsModal from "@/components/products/GenerateTeamProductsModal";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { useCreateMockJob } from "@/lib/hooks/useMockAssets";
import { useScenePresets as useRPScenePresets } from "@/lib/hooks/useRPScenePresets";
import { RpProduct, RpProductStatus, RpProductCategory } from "@/lib/types/firestore";
import { isMasterBlank, getBlankVariants, inferDefaultPrintSides } from "@/lib/blanks";
import useSWR from "swr";
import { collection, getDocs, query, orderBy, doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

function StatusBadge({ status }: { status: RpProductStatus }) {
  const classes = {
    draft: "bg-gray-100 text-gray-800",
    active: "bg-green-100 text-green-800",
    archived: "bg-red-100 text-red-800",
  }[status];

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${classes}`}>
      {status}
    </span>
  );
}

function CategoryBadge({ category }: { category: RpProductCategory }) {
  return (
    <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700">
      {category}
    </span>
  );
}

function LaunchStatusChip({ product }: { product: RpProduct }) {
  const s = product.launchStatus;
  const label = s ? s.replace(/_/g, " ") : "—";
  const classes: Record<string, string> = {
    draft: "bg-slate-100 text-slate-800",
    materializing: "bg-amber-100 text-amber-900",
    generating_assets: "bg-amber-100 text-amber-900",
    assembling_metadata: "bg-amber-100 text-amber-900",
    needs_review: "bg-violet-100 text-violet-900",
    shopify_ready: "bg-emerald-100 text-emerald-900",
    syncing_shopify: "bg-sky-100 text-sky-900",
    live: "bg-green-100 text-green-900",
    failed: "bg-red-100 text-red-900",
  };
  const cls = (s && classes[s]) || "bg-gray-50 text-gray-600";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${cls}`} title={s || ""}>
      {label}
    </span>
  );
}

function AssetsStatusChip({ product }: { product: RpProduct }) {
  const s = product.assetsStatus;
  const label = s ?? "—";
  const classes: Record<string, string> = {
    idle: "bg-gray-50 text-gray-600",
    queued: "bg-amber-50 text-amber-900",
    running: "bg-amber-50 text-amber-900",
    complete: "bg-emerald-50 text-emerald-800",
    failed: "bg-red-50 text-red-800",
    partial: "bg-orange-50 text-orange-900",
  };
  const cls = (s && classes[s]) || "bg-gray-50 text-gray-600";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function BoolChip({ ok, label }: { ok: boolean | undefined; label: string }) {
  const good = ok === true;
  const bad = ok === false;
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${
        good ? "bg-emerald-50 text-emerald-800" : bad ? "bg-red-50 text-red-800" : "bg-gray-50 text-gray-500"
      }`}
    >
      {good ? `${label}: yes` : bad ? `${label}: no` : "—"}
    </span>
  );
}

function ProductsContent() {
  const [statusFilter, setStatusFilter] = useState<RpProductStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<RpProductCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  /** When true, list includes legacy top-level per-color docs (not parent rows). Default: parent products only. */
  const [showLegacyTopLevel, setShowLegacyTopLevel] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [launchOpsFilter, setLaunchOpsFilter] = useState<LaunchOpsFilter>("all");
  const [bulkOpsBusy, setBulkOpsBusy] = useState(false);

  const [isGenTeamProductsOpen, setIsGenTeamProductsOpen] = useState(false);
  const [isDesignBlankOpen, setIsDesignBlankOpen] = useState(false);
  const [designBlankDesignId, setDesignBlankDesignId] = useState("");
  const [designBlankBlankId, setDesignBlankBlankId] = useState("");
  const [designBlankVariantId, setDesignBlankVariantId] = useState("");
  /** When set, create only one color row; otherwise master blanks materialize all active blank colors. */
  const [designBlankSingleColorOnly, setDesignBlankSingleColorOnly] = useState(false);
  const [designBlankCreating, setDesignBlankCreating] = useState(false);
  const [designBlankError, setDesignBlankError] = useState<string | null>(null);
  
  // Batch generation form state
  const [batchPresetId, setBatchPresetId] = useState("");
  const [batchIdentityId, setBatchIdentityId] = useState("");
  const [batchImageCount, setBatchImageCount] = useState(4);
  const [batchSize, setBatchSize] = useState<"square" | "portrait" | "landscape">("square");
  const [batchName, setBatchName] = useState("");

  const { createProductFromDesignBlank } = useCreateProductFromDesignBlank();
  const { launchProductsFromDesign } = useLaunchProductsFromDesign();
  const { bulkMarkProductsReviewed, bulkSyncProductsToShopify, bulkRetryProductAssets } = useBulkProductOps();
  const { createJob: createMockJob } = useCreateMockJob();
  const { batchGenerate } = useBatchGeneration();
  const { presets } = useRPScenePresets({ isActive: true });
  const { designs } = useDesigns();
  const { teams: designTeams } = useDesignTeams();
  // Load all blanks for the one-off create modal (no status filter so dropdown works without requiring composite index)
  const { blanks } = useBlanks();

  const selectedDesignBlank = useMemo(
    () => blanks.find((b) => b.blankId === designBlankBlankId),
    [blanks, designBlankBlankId]
  );
  const designBlankVariantOptions = useMemo(() => {
    if (!selectedDesignBlank || !isMasterBlank(selectedDesignBlank)) return [];
    return getBlankVariants(selectedDesignBlank).filter((v) => v.isActive !== false);
  }, [selectedDesignBlank]);

  const designBlankSelectedDesign = useMemo(
    () => (designBlankDesignId ? designs.find((d) => d.id === designBlankDesignId) : undefined),
    [designs, designBlankDesignId]
  );

  useEffect(() => {
    if (!selectedDesignBlank || !isMasterBlank(selectedDesignBlank)) {
      setDesignBlankVariantId("");
      return;
    }
    const opts = getBlankVariants(selectedDesignBlank).filter((v) => v.isActive !== false);
    if (opts.length === 0) {
      setDesignBlankVariantId("");
      return;
    }
    setDesignBlankVariantId((prev) => (prev && opts.some((v) => v.variantId === prev) ? prev : opts[0].variantId));
  }, [selectedDesignBlank]);
  
  // Fetch rp_identities (not model pack identities)
  const { data: identities } = useSWR("rp_identities", async () => {
    if (!db) return [];
    const snapshot = await getDocs(query(collection(db, "rp_identities"), orderBy("name")));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  const filters = useMemo(() => {
    const f: {
      status?: RpProductStatus;
      category?: RpProductCategory;
      search?: string;
      parentsOnly?: boolean;
      launchOpsFilter?: LaunchOpsFilter;
    } = {};
    if (statusFilter !== "all") {
      f.status = statusFilter;
    }
    if (categoryFilter !== "all") {
      f.category = categoryFilter;
    }
    if (searchQuery.trim()) {
      f.search = searchQuery.trim();
    }
    f.parentsOnly = !showLegacyTopLevel;
    if (launchOpsFilter !== "all") {
      f.launchOpsFilter = launchOpsFilter;
    }
    return f;
  }, [statusFilter, categoryFilter, searchQuery, showLegacyTopLevel, launchOpsFilter]);

  const { products, loading, error, refetch } = useProducts(filters);

  useEffect(() => {
    if (loading) return;
    const sample = products.slice(0, 25).map((p) => {
      const derivedDistinctBlankVariantIds = p.variantSummary?.length
        ? new Set(p.variantSummary.map((s) => s.blankVariantId).filter(Boolean)).size
        : 0;
      return {
        productId: p.id,
        slug: p.slug,
        productKind: p.productKind,
        colorVariantCount: p.colorVariantCount ?? null,
        variantCount: p.variantCount ?? null,
        derivedDistinctBlankVariantIds,
        variantSummaryLength: p.variantSummary?.length ?? 0,
      };
    });
    console.info("[PRODUCT_LIST:READ]", JSON.stringify({ total: products.length, sample }));
  }, [products, loading]);

  const handleCreateFromDesignBlank = async (e: FormEvent) => {
    e.preventDefault();
    setDesignBlankError(null);
    if (!designBlankDesignId || !designBlankBlankId) {
      setDesignBlankError("Select a design and a blank.");
      return;
    }
    const selBlank = blanks.find((b) => b.blankId === designBlankBlankId);
    if (selBlank && isMasterBlank(selBlank)) {
      const active = getBlankVariants(selBlank).filter((v) => v.isActive !== false);
      if (active.length === 0) {
        setDesignBlankError("This master blank has no active color variants.");
        return;
      }
      if (designBlankSingleColorOnly && !designBlankVariantId) {
        setDesignBlankError("Select a color variant, or turn off “single color only” to create all active colors.");
        return;
      }
    }
    try {
      setDesignBlankCreating(true);
      let result: {
        productId: string;
        slug: string;
        variantId?: string;
      };

      if (selBlank && isMasterBlank(selBlank)) {
        const active = getBlankVariants(selBlank).filter((v) => v.isActive !== false);
        const blankVariantIds = designBlankSingleColorOnly
          ? designBlankVariantId
            ? [designBlankVariantId]
            : []
          : active.map((v) => v.variantId);
        if (blankVariantIds.length === 0) {
          setDesignBlankError("No blank variant ids to create.");
          setDesignBlankCreating(false);
          return;
        }
        const batch = await launchProductsFromDesign({
          designId: designBlankDesignId,
          blankId: designBlankBlankId,
          blankVariantIds,
          autoSyncShopify: false,
          queue8394Secondary: false,
        });
        const pid =
          batch.productId ||
          batch.results?.find((r) => r.productId)?.productId ||
          "";
        const slug =
          batch.slug ||
          batch.results?.find((r) => r.slug)?.slug ||
          "";
        const firstWithVariant = batch.results?.find((r) => r.variantFirestoreId);
        result = {
          productId: pid,
          slug,
          variantId: firstWithVariant?.variantFirestoreId,
        };
        if (!pid || !slug) {
          throw new Error(batch.errors?.map((e) => e.message).join(" ") || "Product creation did not return a parent id.");
        }
      } else {
        const single = await createProductFromDesignBlank({
          designId: designBlankDesignId,
          blankId: designBlankBlankId,
          blankVariantId: undefined,
        });
        result = single;
      }
      const useBack = selBlank ? inferDefaultPrintSides(selBlank) === "back_only" : false;
      const jobId = await createMockJob({
        designId: designBlankDesignId,
        blankId: designBlankBlankId,
        view: useBack ? "back" : "front",
        placementId: useBack ? "back_center" : "front_center",
        quality: "draft",
        productId: result.productId,
        productVariantId: result.variantId,
        heroSlot: useBack ? "hero_back" : "hero_front",
      });
      if (jobId) {
        setIsDesignBlankOpen(false);
        setDesignBlankDesignId("");
        setDesignBlankBlankId("");
        await refetch();
        window.location.href = `/products/${result.slug}`;
      } else {
        setDesignBlankError("Product created but mock generation could not start. Open the product to generate mockup.");
        await refetch();
        window.location.href = `/products/${result.slug}`;
      }
    } catch (err: any) {
      console.error("[ProductsContent] Create from Design+Blank failed:", err);
      setDesignBlankError(err?.message || "Failed to create product or generate mockup.");
    } finally {
      setDesignBlankCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <TableSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
          Error loading products: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-600 mt-1">
            Create products from team matrix defaults, then generate assets for created products
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsGenTeamProductsOpen(true)}
            className="px-4 py-2 bg-violet-700 text-white rounded-lg hover:bg-violet-800 text-sm font-medium"
          >
            Generate Team Products
          </button>
          <button
            onClick={() => setIsBatchOpen(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
            disabled={products.length === 0}
          >
            Batch Generate Assets
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreActionsOpen((o) => !o)}
              className="px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              More ▾
            </button>
            {moreActionsOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onClick={() => setMoreActionsOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Product creation (advanced)
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreActionsOpen(false);
                      setIsDesignBlankOpen(true);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Create One-off Product
                  </button>

                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Asset generation
                  </div>
                  <Link
                    href="/products/batch-hero"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => setMoreActionsOpen(false)}
                  >
                    Batch Hero Render
                  </Link>

                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Ops / admin
                  </div>
                  <Link
                    href="/products/bulk"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => setMoreActionsOpen(false)}
                  >
                    Bulk Product Jobs
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setMoreActionsOpen(false);
                      if (selectedProducts.size === 0) return;
                      const n = selectedProducts.size;
                      if (!window.confirm(`Delete ${n} product${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
                      if (!db) return;
                      setBulkDeleting(true);
                      try {
                        for (const id of selectedProducts) {
                          await deleteDoc(doc(db, "rp_products", id));
                        }
                        setSelectedProducts(new Set());
                        await refetch();
                      } catch (err) {
                        console.error("[Products] Bulk delete failed:", err);
                        alert("Failed to delete some products. See console for details.");
                      } finally {
                        setBulkDeleting(false);
                      }
                    }}
                    disabled={selectedProducts.size === 0 || bulkDeleting}
                    className="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {bulkDeleting ? "Deleting…" : `Delete selected${selectedProducts.size > 0 ? ` (${selectedProducts.size})` : ""}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* One-off product create modal */}
      <Modal
        isOpen={isDesignBlankOpen}
        onClose={() => {
          setIsDesignBlankOpen(false);
          setDesignBlankError(null);
          setDesignBlankDesignId("");
          setDesignBlankBlankId("");
          setDesignBlankVariantId("");
          setDesignBlankSingleColorOnly(false);
        }}
        title="Create One-off Product"
      >
        <form onSubmit={handleCreateFromDesignBlank} className="space-y-4">
          <p className="text-sm text-gray-600">
            Creates a <strong>parent</strong> in <code className="text-xs bg-gray-100 px-1 rounded">rp_products</code> and
            sellable rows under <code className="text-xs bg-gray-100 px-1 rounded">variants/</code>. For <strong>master blanks</strong>,{" "}
            <strong>all active garment colors</strong> are materialized by default (each color × sizes from the blank). Then a
            draft mockup job starts for the first variant.
          </p>
          {designBlankError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              {designBlankError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Design *
            </label>
            <select
              value={designBlankDesignId}
              onChange={(e) => setDesignBlankDesignId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select design...</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.teamNameCache} — {d.name} {d.hasPng ? "" : "(no PNG)"}
                </option>
              ))}
            </select>
            {designBlankSelectedDesign && (
              <p className="mt-2 text-xs text-gray-600 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="font-medium text-gray-800">Team (from design):</span>{" "}
                {designBlankSelectedDesign.teamNameCache?.trim() ||
                  (designBlankSelectedDesign.teamId
                    ? `Linked team id: ${designBlankSelectedDesign.teamId}`
                    : "No team on this design — fine for one-offs; link a team for catalog alignment.")}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Blank *
            </label>
            <select
              value={designBlankBlankId}
              onChange={(e) => setDesignBlankBlankId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select blank...</option>
              {blanks.map((b) => (
                <option key={b.blankId} value={b.blankId}>
                  {b.styleCode} — {b.styleName}
                  {b.colorName ? ` (${b.colorName})` : ""}
                </option>
              ))}
            </select>
          </div>
          {designBlankVariantOptions.length > 0 && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-3">
              <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={designBlankSingleColorOnly}
                  onChange={(e) => setDesignBlankSingleColorOnly(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300"
                />
                <span>
                  <span className="font-medium">Single color only</span>{" "}
                  <span className="text-gray-600">
                    (advanced — create one color row + sizes instead of every active blank color)
                  </span>
                </span>
              </label>
              {designBlankSingleColorOnly ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Blank color variant *</label>
                  <select
                    value={designBlankVariantId}
                    onChange={(e) => setDesignBlankVariantId(e.target.value)}
                    required={designBlankSingleColorOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    {designBlankVariantOptions.map((v) => (
                      <option key={v.variantId} value={v.variantId}>
                        {v.colorName}
                        {v.vendorSku ? ` (${v.vendorSku})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-gray-600">
                  Will create{" "}
                  <strong>{designBlankVariantOptions.length} color line{designBlankVariantOptions.length === 1 ? "" : "s"}</strong>{" "}
                  × sizes (e.g. XS–XL) — matching active colors on the blank.
                </p>
              )}
            </div>
          )}
          {designBlankDesignId && !designs.find((d) => d.id === designBlankDesignId)?.hasPng && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
              Selected design has no PNG. Upload a PNG in Design Detail → Files before creating a product.
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => setIsDesignBlankOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                designBlankCreating ||
                !designBlankDesignId ||
                !designBlankBlankId ||
                (designBlankVariantOptions.length > 0 && !designBlankVariantId) ||
                !designs.find((d) => d.id === designBlankDesignId)?.hasPng
              }
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {designBlankCreating ? "Creating & generating mockup..." : "Create & Generate Mockup"}
            </button>
          </div>
        </form>
      </Modal>

      <GenerateTeamProductsModal
        isOpen={isGenTeamProductsOpen}
        onClose={() => setIsGenTeamProductsOpen(false)}
        designs={designs}
        teams={designTeams}
        onProductsChanged={() => void refetch()}
      />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RpProductStatus | "all")}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as RpProductCategory | "all")}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="all">All Categories</option>
              <option value="panties">Panties</option>
              <option value="bralette">Bralette</option>
              <option value="tank">Tank</option>
              <option value="tee">Tee</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Launch / ops
            </label>
            <select
              value={launchOpsFilter}
              onChange={(e) => setLaunchOpsFilter(e.target.value as LaunchOpsFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="all">All (launch stages)</option>
              <option value="generating">Generating / in progress</option>
              <option value="needs_review">Needs review</option>
              <option value="shopify_ready">Shopify ready</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={showLegacyTopLevel}
              onChange={(e) => setShowLegacyTopLevel(e.target.checked)}
            />
            <span>Show legacy top-level products (pre–parent-model per-color docs)</span>
          </label>
          {!showLegacyTopLevel && (
            <span className="text-xs text-gray-500">Listing parent products only — one row per team + design + blank.</span>
          )}
        </div>
      </div>

      {selectedProducts.size > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/80 px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-violet-900">
            {selectedProducts.size} selected
          </span>
          <button
            type="button"
            disabled={bulkOpsBusy}
            onClick={async () => {
              const ids = Array.from(selectedProducts);
              setBulkOpsBusy(true);
              try {
                const out = await bulkMarkProductsReviewed({ productIds: ids, action: "approve" });
                const failed = out.results?.filter((r) => !r.ok) ?? [];
                alert(
                  failed.length
                    ? `Approved ${ids.length - failed.length}/${ids.length}. Failed: ${failed.map((f) => `${f.productId} (${f.reason})`).join("; ")}`
                    : `Approved ${ids.length} product(s). They are now Shopify ready (when server checks passed).`
                );
                setSelectedProducts(new Set());
                await refetch();
              } catch (e: unknown) {
                const err = e as { message?: string };
                alert(err?.message || "Approve failed.");
              } finally {
                setBulkOpsBusy(false);
              }
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-50"
          >
            Approve / mark reviewed
          </button>
          <button
            type="button"
            disabled={bulkOpsBusy}
            onClick={async () => {
              const ids = Array.from(selectedProducts);
              setBulkOpsBusy(true);
              try {
                const out = await bulkSyncProductsToShopify({ productIds: ids });
                const failed = out.results?.filter((r) => !r.ok) ?? [];
                alert(
                  failed.length
                    ? `Sync queued ${(out.results?.filter((r) => r.ok).length ?? 0)}/${ids.length}. Failed: ${failed.map((f) => `${f.productId} (${f.reason})`).join("; ")}`
                    : `Queued Shopify sync for ${ids.length} product(s).`
                );
                setSelectedProducts(new Set());
                await refetch();
              } catch (e: unknown) {
                const err = e as { message?: string };
                alert(err?.message || "Sync failed.");
              } finally {
                setBulkOpsBusy(false);
              }
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Sync selected to Shopify
          </button>
          <button
            type="button"
            disabled={bulkOpsBusy}
            onClick={async () => {
              const ids = Array.from(selectedProducts);
              if (!window.confirm(`Retry asset generation for ${ids.length} product(s)?`)) return;
              setBulkOpsBusy(true);
              try {
                const out = await bulkRetryProductAssets({ productIds: ids });
                const failed = out.results?.filter((r) => !r.ok) ?? [];
                alert(
                  failed.length
                    ? `Retried ${ids.length - failed.length}/${ids.length}. Errors: ${failed.map((f) => `${f.productId}: ${f.error || "?"}`).join("; ")}`
                    : `Retried asset batch for ${ids.length} product(s).`
                );
                if (!failed.length) setSelectedProducts(new Set());
                await refetch();
              } catch (e: unknown) {
                const err = e as { message?: string };
                alert(err?.message || "Retry failed.");
              } finally {
                setBulkOpsBusy(false);
              }
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Retry generation
          </button>
          <button
            type="button"
            disabled={bulkOpsBusy}
            onClick={async () => {
              const ids = Array.from(selectedProducts);
              setBulkOpsBusy(true);
              try {
                const out = await bulkMarkProductsReviewed({ productIds: ids, action: "hold" });
                const failed = out.results?.filter((r) => !r.ok) ?? [];
                alert(failed.length ? `Hold failed for some rows: ${failed.map((f) => f.productId).join(", ")}` : `Marked ${ids.length} on hold.`);
                if (!failed.length) setSelectedProducts(new Set());
                await refetch();
              } catch (e: unknown) {
                const err = e as { message?: string };
                alert(err?.message || "Hold failed.");
              } finally {
                setBulkOpsBusy(false);
              }
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-400 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Mark hold
          </button>
        </div>
      )}

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">No products found.</p>
            <p className="text-sm text-gray-400 mt-2">
              {searchQuery || statusFilter !== "all" || categoryFilter !== "all" || launchOpsFilter !== "all"
                ? "Try adjusting your filters."
                : "Use Generate Team Products for standard creation or Create One-off Product for QA/advanced cases. Legacy-only view is off — enable it above if you need old per-color rows."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-14">
                    {/* thumb */}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Launch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Assets
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Shopify
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fulfill
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Colors / SKUs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Base Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider max-w-[220px]">
                    Last error
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.map((product) => {
                  const derivedColorLines =
                    product.colorVariantCount ??
                    (product.variantSummary?.length
                      ? new Set(product.variantSummary.map((s) => s.blankVariantId).filter(Boolean)).size
                      : null);
                  const thumbUrl = product.displayMedia?.thumbUrl || product.displayMedia?.heroUrl;
                  const fulfillmentReady = product.fulfillmentSummary?.fulfillmentReady;
                  return (
                  <tr key={product.id} className={`hover:bg-gray-50 ${selectedProducts.has(product.id || "") ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-3 whitespace-nowrap align-middle">
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl}
                          alt=""
                          className="h-10 w-10 rounded object-cover border border-gray-200 bg-gray-50"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded border border-dashed border-gray-200 bg-gray-50" title="No hero thumbnail" />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedProducts.has(product.id || "")}
                          onChange={(e) => {
                            const newSet = new Set(selectedProducts);
                            if (e.target.checked) {
                              newSet.add(product.id || "");
                            } else {
                              newSet.delete(product.id || "");
                            }
                            setSelectedProducts(newSet);
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div>
                          <Link
                            href={`/products/${product.slug}`}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800"
                          >
                            {product.title ?? product.name}
                          </Link>
                          {product.productKind !== "parent" && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 uppercase tracking-wide">
                              Legacy
                            </span>
                          )}
                          {product.opsReviewStatus && product.opsReviewStatus !== "pending" && (
                            <span className="ml-2 text-[10px] uppercase font-semibold text-gray-500">
                              ({product.opsReviewStatus})
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <LaunchStatusChip product={product} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1">
                        <AssetsStatusChip product={product} />
                        <span className="text-[11px] text-gray-500">
                          {product.counters?.assetsTotal ?? 0} total
                          {product.counters?.assetsApproved != null ? (
                            <span className="text-green-700"> · {product.counters.assetsApproved} ok</span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <BoolChip ok={product.shopifyReady} label="Ready" />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <BoolChip ok={fulfillmentReady} label="Ready" />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {product.productKind === "parent" && (derivedColorLines != null || product.variantCount != null)
                        ? [
                            derivedColorLines != null ? `${derivedColorLines} colors` : null,
                            product.variantCount != null ? `${product.variantCount} SKUs` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"
                        : product.colorway?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-gray-900 font-mono">
                        {product.baseProductKey}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <CategoryBadge category={product.category} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-red-700 max-w-[220px] align-top">
                      <span className="line-clamp-2" title={product.lastPipelineError || ""}>
                        {product.lastPipelineError || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/products/${product.slug}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          View →
                        </Link>
                        <button
                          type="button"
                          onClick={async () => {
                            const name = product.name || product.slug || "this product";
                            if (!window.confirm(`Are you sure you want to delete "${name}"?\n\nThis action cannot be undone.`)) return;
                            if (!db || !product.id) return;
                            setDeletingId(product.id);
                            try {
                              await deleteDoc(doc(db, "rp_products", product.id));
                              setSelectedProducts((prev) => {
                                const next = new Set(prev);
                                next.delete(product.id || "");
                                return next;
                              });
                              await refetch();
                            } catch (err) {
                              console.error("[Products] Delete failed:", err);
                              alert("Failed to delete product. See console for details.");
                            } finally {
                              setDeletingId(null);
                            }
                          }}
                          disabled={deletingId === product.id}
                          className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                          title="Delete this product"
                        >
                          {deletingId === product.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Batch Generate Assets modal */}
      <Modal isOpen={isBatchOpen} onClose={() => setIsBatchOpen(false)} title="Batch Generate Assets">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBatchError(null);

            if (selectedProducts.size === 0) {
              setBatchError("Please select at least one product.");
              return;
            }

            if (!batchPresetId) {
              setBatchError("Please select a scene preset.");
              return;
            }

            const selectedPreset = presets?.find((p) => p.id === batchPresetId);
            const presetMode = selectedPreset?.mode || "onModel";
            
            if (presetMode === "onModel" && !batchIdentityId) {
              setBatchError("Identity is required for on-model generation.");
              return;
            }

            try {
              setBatchGenerating(true);
              const requests = Array.from(selectedProducts).map((productId) => {
                const product = products.find((p) => p.id === productId);
                return {
                  productId,
                  presetId: batchPresetId,
                  identityId: presetMode === "onModel" ? batchIdentityId : undefined,
                  generationType: (presetMode === "productOnly" ? "product_only" : "on_model") as "product_only" | "on_model",
                  imageCount: batchImageCount,
                  size: batchSize,
                };
              });

              const result = await batchGenerate({
                requests,
                batchName: batchName || `Batch ${new Date().toLocaleString()}`,
              });

              alert(
                `Batch generation started!\n\n` +
                  `Total: ${result.totalRequests}\n` +
                  `Successful: ${result.successfulJobs}\n` +
                  `Failed: ${result.failedJobs}\n\n` +
                  `Batch Job ID: ${result.batchJobId}`
              );

              setSelectedProducts(new Set());
              setIsBatchOpen(false);
            } catch (err: any) {
              console.error("[ProductsContent] Batch generation failed:", err);
              setBatchError(err?.message || "Failed to start batch generation.");
            } finally {
              setBatchGenerating(false);
            }
          }}
          className="space-y-4"
        >
          {batchError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              {batchError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Selected Products ({selectedProducts.size})
            </label>
            <div className="bg-gray-50 rounded p-3 max-h-40 overflow-y-auto">
              {selectedProducts.size === 0 ? (
                <p className="text-sm text-gray-500">No products selected. Check products in the table above.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {Array.from(selectedProducts).map((productId) => {
                    const product = products.find((p) => p.id === productId);
                    return (
                      <li key={productId} className="flex items-center justify-between">
                        <span>{product?.name || productId}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newSet = new Set(selectedProducts);
                            newSet.delete(productId);
                            setSelectedProducts(newSet);
                          }}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scene Preset *
            </label>
            <select
              value={batchPresetId}
              onChange={(e) => setBatchPresetId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select a preset...</option>
              {presets?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.mode || "onModel"})
                </option>
              ))}
            </select>
          </div>

          {batchPresetId && presets?.find((p) => p.id === batchPresetId)?.mode !== "productOnly" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Identity *
              </label>
              <select
                value={batchIdentityId}
                onChange={(e) => setBatchIdentityId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select an identity...</option>
                {identities?.map((identity: any) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name || identity.token || `Identity ${identity.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Image Count
              </label>
              <input
                type="number"
                value={batchImageCount}
                onChange={(e) => setBatchImageCount(parseInt(e.target.value) || 4)}
                min={1}
                max={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Image Size
              </label>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="square">Square</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Batch Name (Optional)
            </label>
            <input
              type="text"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Q1 2026 Campaign"
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">Estimated Cost:</p>
            <p>
              ${((selectedProducts.size * batchImageCount * 0.02).toFixed(2))} USD
              <span className="text-xs text-blue-600 ml-2">
                ({selectedProducts.size} products × {batchImageCount} images × $0.02/image)
              </span>
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => setIsBatchOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={batchGenerating || selectedProducts.size === 0 || !batchPresetId}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {batchGenerating ? "Generating..." : `Generate ${selectedProducts.size} Products`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ProductsContent />
      </div>
    </ProtectedRoute>
  );
}
