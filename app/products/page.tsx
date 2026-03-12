"use client";

import { useMemo, useState, FormEvent } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TableSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import { useProducts } from "@/lib/hooks/useRPProducts";
import { useCreateProduct, useCreateProductFromDesignBlank } from "@/lib/hooks/useRPProductMutations";
import { useBatchGeneration } from "@/lib/hooks/useBatchGeneration";
import { useDesigns } from "@/lib/hooks/useDesignAssets";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { useCreateMockJob } from "@/lib/hooks/useMockAssets";
import { useScenePresets as useRPScenePresets } from "@/lib/hooks/useRPScenePresets";
import { RpProductStatus, RpProductCategory } from "@/lib/types/firestore";
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [isDesignBlankOpen, setIsDesignBlankOpen] = useState(false);
  const [designBlankDesignId, setDesignBlankDesignId] = useState("");
  const [designBlankBlankId, setDesignBlankBlankId] = useState("");
  const [designBlankCreating, setDesignBlankCreating] = useState(false);
  const [designBlankError, setDesignBlankError] = useState<string | null>(null);
  
  // Batch generation form state
  const [batchPresetId, setBatchPresetId] = useState("");
  const [batchIdentityId, setBatchIdentityId] = useState("");
  const [batchImageCount, setBatchImageCount] = useState(4);
  const [batchSize, setBatchSize] = useState<"square" | "portrait" | "landscape">("square");
  const [batchName, setBatchName] = useState("");

  // Form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState<RpProductCategory>("panties");
  const [newBaseProductKey, setNewBaseProductKey] = useState("");
  const [newColorwayName, setNewColorwayName] = useState("");
  const [newColorwayHex, setNewColorwayHex] = useState("");
  const [newProductTrigger, setNewProductTrigger] = useState("");

  const { createProduct } = useCreateProduct();
  const { createProductFromDesignBlank } = useCreateProductFromDesignBlank();
  const { createJob: createMockJob } = useCreateMockJob();
  const { batchGenerate } = useBatchGeneration();
  const { presets } = useRPScenePresets({ isActive: true });
  const { designs } = useDesigns();
  // Load all blanks for the Create from Design + Blank modal (no status filter so dropdown works without requiring composite index)
  const { blanks } = useBlanks();
  
  // Fetch rp_identities (not model pack identities)
  const { data: identities } = useSWR("rp_identities", async () => {
    if (!db) return [];
    const snapshot = await getDocs(query(collection(db, "rp_identities"), orderBy("name")));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  const filters = useMemo(() => {
    const f: any = {};
    if (statusFilter !== "all") {
      f.status = statusFilter;
    }
    if (categoryFilter !== "all") {
      f.category = categoryFilter;
    }
    if (searchQuery.trim()) {
      f.search = searchQuery.trim();
    }
    return f;
  }, [statusFilter, categoryFilter, searchQuery]);

  const { products, loading, error, refetch } = useProducts(filters);

  const handleOpenCreate = () => {
    setIsCreateOpen(true);
    setCreateError(null);
    setNewName("");
    setNewDescription("");
    setNewCategory("panties");
    setNewBaseProductKey("");
    setNewColorwayName("");
    setNewColorwayHex("");
    setNewProductTrigger("");
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newName.trim() || !newBaseProductKey.trim() || !newColorwayName.trim()) {
      setCreateError("Name, base product key, and colorway name are required.");
      return;
    }

    try {
      setCreating(true);
      const result = await createProduct({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        category: newCategory,
        baseProductKey: newBaseProductKey.trim(),
        colorway: {
          name: newColorwayName.trim(),
          hex: newColorwayHex.trim() || undefined,
        },
        ai: newProductTrigger.trim()
          ? {
              productTrigger: newProductTrigger.trim(),
              productRecommendedScale: 0.9,
            }
          : undefined,
      });

      await refetch();
      setIsCreateOpen(false);
      // Navigate to new product
      window.location.href = `/products/${result.slug}`;
    } catch (err: any) {
      console.error("[ProductsContent] Failed to create product:", err);
      setCreateError(err?.message || "Failed to create product.");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateFromDesignBlank = async (e: FormEvent) => {
    e.preventDefault();
    setDesignBlankError(null);
    if (!designBlankDesignId || !designBlankBlankId) {
      setDesignBlankError("Select a design and a blank.");
      return;
    }
    try {
      setDesignBlankCreating(true);
      const result = await createProductFromDesignBlank({
        designId: designBlankDesignId,
        blankId: designBlankBlankId,
      });
      const jobId = await createMockJob({
        designId: designBlankDesignId,
        blankId: designBlankBlankId,
        view: "front",
        quality: "draft",
        productId: result.productId,
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
            Manage products, designs, and generated assets
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/products/bulk"
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium inline-block"
          >
            Bulk Generate
          </Link>
          <Link
            href="/products/batch-hero"
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium inline-block"
          >
            Batch Hero Render
          </Link>
          <button
            onClick={() => setIsDesignBlankOpen(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
          >
            Create from Design + Blank
          </button>
          <button
            onClick={() => setIsBatchOpen(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
            disabled={products.length === 0}
          >
            Batch Generate
          </button>
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Create Product
          </button>
        </div>
      </div>

      {/* Create Product Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Product">
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {createError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              {createError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name *
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="SF Giants Classic Black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category *
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as RpProductCategory)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="panties">Panties</option>
                <option value="bralette">Bralette</option>
                <option value="tank">Tank</option>
                <option value="tee">Tee</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Base Product Key *
              </label>
              <input
                type="text"
                value={newBaseProductKey}
                onChange={(e) => setNewBaseProductKey(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="SFGIANTS_PANTY_1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Colorway Name *
              </label>
              <input
                type="text"
                value={newColorwayName}
                onChange={(e) => setNewColorwayName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Colorway Hex
              </label>
              <input
                type="text"
                value={newColorwayHex}
                onChange={(e) => setNewColorwayHex(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="#000000"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Trigger (LoRA)
            </label>
            <input
              type="text"
              value={newProductTrigger}
              onChange={(e) => setNewProductTrigger(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              placeholder="rp_sfg_panty_1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional: LoRA trigger phrase for this product
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Product"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create from Design + Blank Modal */}
      <Modal
        isOpen={isDesignBlankOpen}
        onClose={() => {
          setIsDesignBlankOpen(false);
          setDesignBlankError(null);
          setDesignBlankDesignId("");
          setDesignBlankBlankId("");
        }}
        title="Create Product from Design + Blank"
      >
        <form onSubmit={handleCreateFromDesignBlank} className="space-y-4">
          <p className="text-sm text-gray-600">
            Select a design and a blank. A product will be created and a mockup will be generated automatically.
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
                  {b.styleCode} {b.styleName} — {b.colorName}
                </option>
              ))}
            </select>
          </div>
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
                !designs.find((d) => d.id === designBlankDesignId)?.hasPng
              }
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {designBlankCreating ? "Creating & generating mockup..." : "Create & Generate Mockup"}
            </button>
          </div>
        </form>
      </Modal>

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
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">No products found.</p>
            <p className="text-sm text-gray-400 mt-2">
              {searchQuery || statusFilter !== "all" || categoryFilter !== "all"
                ? "Try adjusting your filters."
                : "Create your first product to get started."}
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
                            {product.name}
                          </Link>
                          <p className="text-xs text-gray-500 mt-1">
                            {product.colorway.name}
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
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
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

      {/* Batch Generate Modal */}
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
