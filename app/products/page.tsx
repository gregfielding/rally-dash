"use client";

import { useMemo, useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TableSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import { useProducts } from "@/lib/hooks/useRPProducts";
import { useCreateProductFromDesignBlank } from "@/lib/hooks/useRPProductMutations";
import { useBatchGeneration } from "@/lib/hooks/useBatchGeneration";
import { useDesigns, useDesignTeams } from "@/lib/hooks/useDesignAssets";
import GenerateTeamProductsModal from "@/components/products/GenerateTeamProductsModal";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { useCreateMockJob } from "@/lib/hooks/useMockAssets";
import { useScenePresets as useRPScenePresets } from "@/lib/hooks/useRPScenePresets";
import { RpProductStatus, RpProductCategory } from "@/lib/types/firestore";
import { isMasterBlank, getBlankVariants } from "@/lib/blanks";
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

  const [isGenTeamProductsOpen, setIsGenTeamProductsOpen] = useState(false);
  const [isDesignBlankOpen, setIsDesignBlankOpen] = useState(false);
  const [designBlankDesignId, setDesignBlankDesignId] = useState("");
  const [designBlankBlankId, setDesignBlankBlankId] = useState("");
  const [designBlankVariantId, setDesignBlankVariantId] = useState("");
  const [designBlankCreating, setDesignBlankCreating] = useState(false);
  const [designBlankError, setDesignBlankError] = useState<string | null>(null);
  
  // Batch generation form state
  const [batchPresetId, setBatchPresetId] = useState("");
  const [batchIdentityId, setBatchIdentityId] = useState("");
  const [batchImageCount, setBatchImageCount] = useState(4);
  const [batchSize, setBatchSize] = useState<"square" | "portrait" | "landscape">("square");
  const [batchName, setBatchName] = useState("");

  const { createProductFromDesignBlank } = useCreateProductFromDesignBlank();
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
    return f;
  }, [statusFilter, categoryFilter, searchQuery, showLegacyTopLevel]);

  const { products, loading, error, refetch } = useProducts(filters);

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
      if (active.length > 0 && !designBlankVariantId) {
        setDesignBlankError("Select a color variant for this master blank.");
        return;
      }
    }
    try {
      setDesignBlankCreating(true);
      const result = await createProductFromDesignBlank({
        designId: designBlankDesignId,
        blankId: designBlankBlankId,
        blankVariantId:
          selBlank && isMasterBlank(selBlank) && designBlankVariantId ? designBlankVariantId : undefined,
      });
      const is8394BackOnly = String(selBlank?.styleCode || "").trim() === "8394";
      const jobId = await createMockJob({
        designId: designBlankDesignId,
        blankId: designBlankBlankId,
        view: is8394BackOnly ? "back" : "front",
        placementId: is8394BackOnly ? "back_center" : "front_center",
        quality: "draft",
        productId: result.productId,
        productVariantId: result.variantId,
        heroSlot: is8394BackOnly ? "hero_back" : "hero_front",
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
        }}
        title="Create One-off Product"
      >
        <form onSubmit={handleCreateFromDesignBlank} className="space-y-4">
          <p className="text-sm text-gray-600">
            Advanced/QA path: select one design + blank to create a single parent product entry, then kick off an initial mockup job.
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Blank color variant *</label>
              <select
                value={designBlankVariantId}
                onChange={(e) => setDesignBlankVariantId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {designBlankVariantOptions.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.colorName}
                    {v.vendorSku ? ` (${v.vendorSku})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Master blanks require a variant; color resolves into the product and templates.</p>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">No products found.</p>
            <p className="text-sm text-gray-400 mt-2">
              {searchQuery || statusFilter !== "all" || categoryFilter !== "all"
                ? "Try adjusting your filters."
                : "Use Generate Team Products for standard creation or Create One-off Product for QA/advanced cases. Legacy-only view is off — enable it above if you need old per-color rows."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Base Product
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Assets
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50 ${selectedProducts.has(product.id || "") ? "bg-blue-50" : ""}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
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
                          <p className="text-xs text-gray-500 mt-1">
                            {product.productKind === "parent" && product.variantCount != null
                              ? `${product.variantCount} color${product.variantCount === 1 ? "" : "s"}`
                              : product.colorway?.name ?? "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900 font-mono">
                        {product.baseProductKey}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <CategoryBadge category={product.category} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {product.counters?.assetsTotal || 0} total
                      {product.counters?.assetsApproved ? (
                        <span className="ml-2 text-green-600">
                          {product.counters.assetsApproved} approved
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
                ))}
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
