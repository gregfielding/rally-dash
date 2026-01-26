"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useParams } from "next/navigation";
import { deleteDoc, doc, writeBatch, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useProductBySlug } from "@/lib/hooks/useRPProducts";
import { useProductDesigns } from "@/lib/hooks/useRPProductDesigns";
import { useProductAssets } from "@/lib/hooks/useRPProductAssets";
import { useGenerationJobs } from "@/lib/hooks/useRPGenerationJobs";
import { useScenePresets } from "@/lib/hooks/useRPScenePresets";
import { useGenerateProductAssets } from "@/lib/hooks/useRPProductMutations";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useLoraArtifacts } from "@/lib/hooks/useLoraArtifacts";
import { useDesignBriefs } from "@/lib/hooks/useDesignBriefs";
import { useDesignConcepts } from "@/lib/hooks/useDesignConcepts";
import { useCreateProductDesign, useCreateDesignFromConcept, useCreateDesignBrief } from "@/lib/hooks/useDesignMutations";
import { useInspirations } from "@/lib/hooks/useInspirations";
import { useAttachInspirationToProduct, useAttachInspirationToBrief } from "@/lib/hooks/useInspirationMutations";
import { useAssetCollections } from "@/lib/hooks/useAssetCollections";
import Modal from "@/components/Modal";
import {
  RpPrintMethod,
  RpDesignPlacement,
  RpInkColor,
  RpProduct,
  RpDesignConcept,
  RpDesignBrief,
  RpConceptStatus,
} from "@/lib/types/firestore";

// Assets Tab Component with Collections
function AssetsTab({
  product,
  assets,
  assetsLoading,
  refetchAssets,
  showToast,
  lightboxImage,
  setLightboxImage,
}: {
  product: RpProduct | null;
  assets: any[];
  assetsLoading: boolean;
  refetchAssets: () => void;
  showToast: (message: string, type: "success" | "error") => void;
  lightboxImage: string | null;
  setLightboxImage: (url: string | null) => void;
}) {
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDescription, setNewCollectionDescription] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  
  const { collections, createCollection, addAssetsToCollection, removeAssetsFromCollection } = useAssetCollections();

  const handleAddToCollection = async () => {
    if (!selectedCollectionId || selectedAssetIds.size === 0) {
      showToast("Please select a collection and at least one asset.", "error");
      return;
    }

    try {
      await addAssetsToCollection(selectedCollectionId, Array.from(selectedAssetIds));
      showToast(`✅ Added ${selectedAssetIds.size} asset(s) to collection`, "success");
      setSelectedAssetIds(new Set());
      setIsCollectionModalOpen(false);
      refetchAssets();
    } catch (error) {
      console.error("[AssetsTab] Failed to add assets to collection:", error);
      showToast("Failed to add assets to collection.", "error");
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      showToast("Please enter a collection name.", "error");
      return;
    }

    try {
      const collectionId = await createCollection(newCollectionName, newCollectionDescription);
      showToast(`✅ Created collection "${newCollectionName}"`, "success");
      setNewCollectionName("");
      setNewCollectionDescription("");
      setSelectedCollectionId(collectionId);
    } catch (error) {
      console.error("[AssetsTab] Failed to create collection:", error);
      showToast("Failed to create collection.", "error");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Assets</h2>
        <div className="flex gap-2">
          {assets.length > 0 && selectedAssetIds.size > 0 && (
            <button
              onClick={() => setIsCollectionModalOpen(true)}
              className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 border border-blue-300 rounded-lg"
            >
              Add to Collection ({selectedAssetIds.size})
            </button>
          )}
          {assets.length > 0 && (
            <button
              onClick={async () => {
                if (!confirm(`Delete all ${assets.length} placeholder assets?`)) return;
                if (!db) return;
                
                const batch = writeBatch(db);
                let deleteCount = 0;
                assets.forEach((asset) => {
                  const isPlaceholder = asset.downloadUrl?.includes('placeholder') || asset.downloadUrl?.includes('data:image/svg');
                  if (isPlaceholder && asset.id && db) {
                    batch.delete(doc(db, "rp_product_assets", asset.id));
                    deleteCount++;
                  }
                });
                
                if (deleteCount > 0) {
                  await batch.commit();
                  showToast(`✅ Deleted ${deleteCount} placeholder assets`, "success");
                  refetchAssets();
                }
              }}
              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-300 rounded-lg"
            >
              Delete All Placeholders ({assets.length})
            </button>
          )}
        </div>
      </div>
      {assetsLoading ? (
        <p className="text-sm text-gray-500">Loading assets…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-gray-500">No assets yet. Generate some in the Generate tab.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {assets.map((asset) => {
            const isPlaceholder = asset.downloadUrl?.includes('placeholder') || asset.downloadUrl?.includes('data:image/svg');
            const isSelected = selectedAssetIds.has(asset.id || "");
            return (
              <div key={asset.id} className={`border-2 rounded-lg overflow-hidden relative group ${isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"}`}>
                <div className="absolute top-1 left-1 z-10">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      const newSet = new Set(selectedAssetIds);
                      if (e.target.checked) {
                        newSet.add(asset.id || "");
                      } else {
                        newSet.delete(asset.id || "");
                      }
                      setSelectedAssetIds(newSet);
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                {asset.downloadUrl ? (
                  <img
                    src={asset.downloadUrl}
                    alt={`Asset ${asset.id}`}
                    className="w-full h-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setLightboxImage(asset.downloadUrl || null)}
                  />
                ) : (
                  <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                    <span className="text-xs text-gray-400">No image</span>
                  </div>
                )}
                {isPlaceholder && (
                  <div className="absolute top-1 right-1">
                    <span className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded">Placeholder</span>
                  </div>
                )}
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        asset.status === "approved"
                          ? "bg-green-100 text-green-800"
                          : asset.status === "published"
                          ? "bg-blue-100 text-blue-800"
                          : asset.status === "rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {asset.status}
                    </span>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete asset ${asset.id}?`)) return;
                        if (!db) return;
                        await deleteDoc(doc(db, "rp_product_assets", asset.id));
                        showToast("✅ Asset deleted", "success");
                        refetchAssets();
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 text-xs"
                      title="Delete asset"
                    >
                      🗑️
                    </button>
                  </div>
                  {asset.collectionIds && asset.collectionIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {asset.collectionIds.slice(0, 2).map((collectionId: string) => {
                        const collection = collections.find((c) => c.id === collectionId);
                        return collection ? (
                          <span key={collectionId} className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                            {collection.name}
                          </span>
                        ) : null;
                      })}
                      {asset.collectionIds.length > 2 && (
                        <span className="text-xs text-gray-500">+{asset.collectionIds.length - 2}</span>
                      )}
                    </div>
                  )}
                  {asset.similarAssetIds && asset.similarAssetIds.length > 0 && (
                    <div className="mt-1">
                      <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                        ⚠️ {asset.similarAssetIds.length} similar asset(s) found
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collection Management Modal */}
      <Modal
        isOpen={isCollectionModalOpen}
        onClose={() => setIsCollectionModalOpen(false)}
        title="Manage Collections"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Create New Collection
            </label>
            <div className="space-y-2">
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <textarea
                value={newCollectionDescription}
                onChange={(e) => setNewCollectionDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={handleCreateCollection}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Create Collection
              </button>
            </div>
          </div>

          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Add {selectedAssetIds.size} Selected Asset(s) to Collection
            </label>
            <select
              value={selectedCollectionId}
              onChange={(e) => setSelectedCollectionId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white mb-2"
            >
              <option value="">Select a collection...</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({collection.assetIds.length} assets)
                </option>
              ))}
            </select>
            <button
              onClick={handleAddToCollection}
              disabled={!selectedCollectionId}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Add to Collection
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Designs Table Component
function DesignsTable({
  designs,
  designsLoading,
  onDelete,
}: {
  designs: any[];
  designsLoading: boolean;
  onDelete: (designId: string) => Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (designId: string) => {
    if (!confirmDeleteId || confirmDeleteId !== designId) {
      setConfirmDeleteId(designId);
      return;
    }

    setDeletingId(designId);
    try {
      await onDelete(designId);
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("[DesignsTable] Error deleting design:", error);
    } finally {
      setDeletingId(null);
    }
  };
  if (designsLoading) {
    return <p className="text-sm text-gray-500">Loading designs…</p>;
  }

  if (designs.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-500 mb-2">No designs yet.</p>
        <p className="text-xs text-gray-400">
          Create a design manually or use AI Design Brief to generate concepts.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Design
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Print Method
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Placement
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Ink Colors
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Version
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {designs.map((design) => (
            <tr key={design.id} className="hover:bg-gray-50">
              <td className="px-6 py-4">
                <div>
                  <div className="text-sm font-medium text-gray-900">{design.name}</div>
                  <div className="text-xs text-gray-500 font-mono mt-1">{design.code}</div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-900 capitalize">
                  {design.printMethod || "unknown"}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-900 capitalize">
                  {(design.placement || "").replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-wrap gap-1">
                  {design.inkColors?.map((ink: RpInkColor, idx: number) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded"
                      style={{
                        backgroundColor: ink.hex ? `${ink.hex}20` : "#f3f4f6",
                        color: ink.hex || "#374151",
                        border: ink.hex ? `1px solid ${ink.hex}` : "1px solid #d1d5db",
                      }}
                    >
                      {ink.hex && (
                        <span
                          className="w-3 h-3 rounded-full border border-gray-300"
                          style={{ backgroundColor: ink.hex }}
                        />
                      )}
                      {ink.name}
                    </span>
                  ))}
                  {(!design.inkColors || design.inkColors.length === 0) && (
                    <span className="text-xs text-gray-400">None</span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    design.status === "approved"
                      ? "bg-green-100 text-green-800"
                      : design.status === "draft"
                      ? "bg-gray-100 text-gray-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {design.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-500">v{design.version || 1}</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {confirmDeleteId === design.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(design.id!)}
                      disabled={deletingId === design.id}
                      className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingId === design.id ? "Deleting..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deletingId === design.id}
                      className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDelete(design.id!)}
                    disabled={deletingId === design.id}
                    className="px-3 py-1 text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {deletingId === design.id ? "Deleting..." : "Delete"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Concepts Table Component
interface ConceptsTableProps {
  concepts: RpDesignConcept[];
  conceptsLoading: boolean;
  product: RpProduct;
  brief: RpDesignBrief | undefined;
  onPromote: (input: { productId: string; briefId: string; conceptId: string; name?: string; description?: string }) => Promise<any>;
  onToast: (message: string, type?: "success" | "error") => void;
  onRefetch: () => void;
}

function ConceptsTable({
  concepts,
  conceptsLoading,
  product,
  brief,
  onPromote,
  onToast,
  onRefetch,
}: ConceptsTableProps) {
  const [promotingConceptId, setPromotingConceptId] = useState<string | null>(null);
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<RpDesignConcept | null>(null);
  const [designKey, setDesignKey] = useState("");
  const [name, setName] = useState("");

  const handlePromoteClick = (concept: RpDesignConcept) => {
    if (concept.status === "selected") return;
    setSelectedConcept(concept);
    // Derive designKey from concept title + product key
    const baseKey = product.baseProductKey || product.slug?.toUpperCase().replace(/-/g, "_") || "DESIGN";
    const conceptKey = concept.title.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    setDesignKey(`${baseKey}_${conceptKey}`);
    setName(concept.title);
    setIsPromoteModalOpen(true);
  };

  const handlePromoteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedConcept || !brief) return;

    setPromotingConceptId(selectedConcept.id || null);
    try {
      if (!product.id || !brief.id || !selectedConcept.id) return;
      const result = await onPromote({
        productId: product.id,
        briefId: brief.id,
        conceptId: selectedConcept.id,
        name: name.trim() || undefined,
        description: selectedConcept.description || undefined,
      });

      onToast(`✅ Created ${designKey} v${result.version}`);
      setIsPromoteModalOpen(false);
      setSelectedConcept(null);
      onRefetch();
    } catch (err: any) {
      console.error("[ConceptsTable] Error promoting concept:", err);
      onToast(err?.message || "Failed to promote concept", "error");
    } finally {
      setPromotingConceptId(null);
    }
  };

  if (conceptsLoading) {
    return <p className="text-sm text-gray-500">Loading concepts…</p>;
  }

  if (!brief) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-500 mb-2">No brief selected.</p>
        <p className="text-xs text-gray-400">
          Create an AI Design Brief to generate concepts.
        </p>
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-500 mb-2">No concepts for this brief.</p>
        <p className="text-xs text-gray-400">
          Brief: {brief.title}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Concept
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Placement
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Ink Colors
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {concepts.map((concept) => (
              <tr key={concept.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{concept.title}</div>
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {concept.description}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 capitalize">
                    {(concept.placement || "").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {concept.inkColors?.map((ink: RpInkColor, idx: number) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded"
                        style={{
                          backgroundColor: ink.hex ? `${ink.hex}20` : "#f3f4f6",
                          color: ink.hex || "#374151",
                          border: ink.hex ? `1px solid ${ink.hex}` : "1px solid #d1d5db",
                        }}
                      >
                        {ink.hex && (
                          <span
                            className="w-3 h-3 rounded-full border border-gray-300"
                            style={{ backgroundColor: ink.hex }}
                          />
                        )}
                        {ink.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      concept.status === "selected"
                        ? "bg-green-100 text-green-800"
                        : concept.status === "rejected"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {concept.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => handlePromoteClick(concept)}
                    disabled={concept.status === "selected" || promotingConceptId === concept.id}
                    className={`px-3 py-1 text-xs font-medium rounded ${
                      concept.status === "selected"
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    }`}
                  >
                    {promotingConceptId === concept.id ? "Promoting..." : "Promote"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Promote Modal */}
      <Modal
        isOpen={isPromoteModalOpen}
        onClose={() => {
          setIsPromoteModalOpen(false);
          setSelectedConcept(null);
        }}
        title="Promote Concept to Design"
      >
        {selectedConcept && (
          <form onSubmit={handlePromoteSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Design Key *
              </label>
              <input
                type="text"
                value={designKey}
                onChange={(e) => setDesignKey(e.target.value.toUpperCase())}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Design Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => {
                  setIsPromoteModalOpen(false);
                  setSelectedConcept(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!designKey.trim() || !name.trim() || promotingConceptId !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {promotingConceptId !== null ? "Promoting..." : "Promote"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

interface AIDesignBriefModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: RpProduct;
  onCreateBrief: (input: any) => Promise<any>;
  onToast: (message: string, type?: "success" | "error") => void;
  onBriefCreated: () => void;
}

function AIDesignBriefModal({
  isOpen,
  onClose,
  product,
  onCreateBrief,
  onToast,
  onBriefCreated,
}: AIDesignBriefModalProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<any>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [printMethod, setPrintMethod] = useState<RpPrintMethod>("screenprint");
  const [maxInkColors, setMaxInkColors] = useState(2);
  const [mustIncludeText, setMustIncludeText] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [placementOptions, setPlacementOptions] = useState<RpDesignPlacement[]>([]);
  const [requiredInkColors, setRequiredInkColors] = useState<Array<{ name: string; hex?: string }>>([]);

  const [newTextItem, setNewTextItem] = useState("");
  const [newAvoidItem, setNewAvoidItem] = useState("");

  // Inspiration selection
  const { inspirations, loading: inspirationsLoading } = useInspirations(null);
  const [selectedInspirationIds, setSelectedInspirationIds] = useState<string[]>([]);
  const [showInspirationSelector, setShowInspirationSelector] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !objective.trim()) return;

    setError(null);
    setCreating(true);

    try {
      const result = await onCreateBrief({
        productId: product.id,
        title: title.trim(),
        objective: objective.trim(),
        constraints: {
          printMethod,
          maxInkColors,
          mustIncludeText: mustIncludeText.length > 0 ? mustIncludeText : undefined,
          avoid: avoid.length > 0 ? avoid : undefined,
          placementOptions: placementOptions.length > 0 ? placementOptions : undefined,
          requiredInkColors: requiredInkColors.length > 0 ? requiredInkColors.map((ink) => ({
            name: ink.name.trim(),
            hex: ink.hex?.trim() || undefined,
          })) : undefined,
        },
        inspirationIds: selectedInspirationIds.length > 0 ? selectedInspirationIds : undefined,
      });

      setBriefResult(result);
      onToast(`✅ Created brief with ${result.conceptsGenerated} concepts`);
      onBriefCreated();
    } catch (err: any) {
      console.error("[AIDesignBriefModal] Error:", err);
      const errorMessage = err?.message || "Failed to create design brief";
      
      if (errorMessage.includes("OpenAI API key not configured")) {
        setError(
          `OpenAI not configured. Run: firebase functions:config:set openai.key="YOUR_KEY"`
        );
      } else if (errorMessage.includes("validation failed")) {
        setError("AI response invalid — try again");
      } else {
        setError(errorMessage);
      }
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI Design Brief" size="large">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
            {error}
            {error.includes("OpenAI") && (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText('firebase functions:config:set openai.key="YOUR_KEY"')}
                className="ml-2 text-xs underline"
              >
                Copy command
              </button>
            )}
          </div>
        )}

        {briefResult ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded p-4">
              <h3 className="font-semibold text-green-900 mb-2">Brief Created!</h3>
              <p className="text-sm text-green-800">
                Generated {briefResult.conceptsGenerated} concepts. Check the Concepts tab to promote them.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setBriefResult(null);
                  setTitle("");
                  setObjective("");
                  setPrintMethod("screenprint");
                  setMaxInkColors(2);
                  setMustIncludeText([]);
                  setAvoid([]);
                  setPlacementOptions([]);
                  setRequiredInkColors([]);
                  setSelectedInspirationIds([]);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Pre-filled Product Info */}
            <div className="bg-gray-50 rounded p-3 text-sm">
              <p className="font-medium text-gray-700 mb-1">Product: {product.name}</p>
              {product.colorway && (
                <p className="text-gray-600">
                  Colorway: {product.colorway.name}
                  {product.colorway.hex && (
                    <span
                      className="ml-2 inline-block w-4 h-4 rounded border border-gray-300"
                      style={{ backgroundColor: product.colorway.hex }}
                    />
                  )}
                </p>
              )}
            </div>

            {/* Inspiration Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Inspiration ({selectedInspirationIds.length}/8)
                </label>
                <button
                  type="button"
                  onClick={() => setShowInspirationSelector(!showInspirationSelector)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {showInspirationSelector ? "Hide" : "Select"}
                </button>
              </div>
              {selectedInspirationIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {inspirations
                    .filter((insp) => selectedInspirationIds.includes(insp.id || ""))
                    .map((inspiration) => (
                      <div
                        key={inspiration.id}
                        className="flex items-center gap-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs"
                      >
                        <span className="font-medium text-blue-900">{inspiration.title}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedInspirationIds(
                              selectedInspirationIds.filter((id) => id !== inspiration.id)
                            )
                          }
                          className="text-blue-600 hover:text-blue-800"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {showInspirationSelector && (
                <div className="border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto bg-gray-50">
                  {inspirationsLoading ? (
                    <p className="text-sm text-gray-500">Loading inspirations...</p>
                  ) : inspirations.length === 0 ? (
                    <p className="text-sm text-gray-500">No inspirations available. Upload some first!</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {inspirations.map((inspiration) => {
                        const isSelected = selectedInspirationIds.includes(inspiration.id || "");
                        const canSelect = selectedInspirationIds.length < 8 || isSelected;
                        return (
                          <div
                            key={inspiration.id}
                            onClick={() => {
                              if (!canSelect) return;
                              if (isSelected) {
                                setSelectedInspirationIds(
                                  selectedInspirationIds.filter((id) => id !== inspiration.id)
                                );
                              } else {
                                setSelectedInspirationIds([...selectedInspirationIds, inspiration.id || ""]);
                              }
                            }}
                            className={`border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
                              isSelected
                                ? "border-blue-600 ring-2 ring-blue-200"
                                : canSelect
                                ? "border-gray-200 hover:border-gray-300"
                                : "border-gray-100 opacity-50 cursor-not-allowed"
                            }`}
                          >
                            {inspiration.imageUrls && inspiration.imageUrls.length > 0 && (
                              <img
                                src={inspiration.imageUrls[0]}
                                alt={inspiration.title}
                                className="w-full h-20 object-cover"
                              />
                            )}
                            <div className="p-1.5">
                              <h4 className="font-semibold text-xs text-gray-900 line-clamp-1">
                                {inspiration.title}
                              </h4>
                              {isSelected && (
                                <span className="inline-flex mt-1 px-1 py-0.5 bg-blue-600 text-white rounded text-xs">
                                  Selected
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Select up to 8 inspirations to guide the AI. These will be used as visual reference only.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brief Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Giants Pride Collection Q1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Objective *
              </label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                required
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Describe the design goal, vibe, target audience..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Print Method *
                </label>
                <select
                  value={printMethod}
                  onChange={(e) => setPrintMethod(e.target.value as RpPrintMethod)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="screenprint">Screenprint</option>
                  <option value="dtf">DTF</option>
                  <option value="sublimation">Sublimation</option>
                  <option value="embroidery">Embroidery</option>
                  <option value="heat_transfer">Heat Transfer</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Ink Colors *
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={maxInkColors}
                  onChange={(e) => setMaxInkColors(parseInt(e.target.value) || 2)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Placement Options
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  "front_center",
                  "front_left",
                  "front_right",
                  "back_center",
                  "back_upper",
                  "back_lower",
                  "waistband",
                  "custom",
                ] as RpDesignPlacement[]).map((placement) => (
                  <label key={placement} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={placementOptions.includes(placement)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPlacementOptions([...placementOptions, placement]);
                        } else {
                          setPlacementOptions(placementOptions.filter((p) => p !== placement));
                        }
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">
                      {placement.replace(/_/g, " ")}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Must Include Text
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newTextItem}
                  onChange={(e) => setNewTextItem(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newTextItem.trim()) {
                        setMustIncludeText([...mustIncludeText, newTextItem.trim()]);
                        setNewTextItem("");
                      }
                    }
                  }}
                  placeholder="Type and press Enter"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {mustIncludeText.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                  >
                    {item}
                    <button
                      type="button"
                      onClick={() => setMustIncludeText(mustIncludeText.filter((_, i) => i !== idx))}
                      className="hover:text-blue-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Avoid</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newAvoidItem}
                  onChange={(e) => setNewAvoidItem(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newAvoidItem.trim()) {
                        setAvoid([...avoid, newAvoidItem.trim()]);
                        setNewAvoidItem("");
                      }
                    }
                  }}
                  placeholder="Type and press Enter"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {avoid.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 rounded text-xs"
                  >
                    {item}
                    <button
                      type="button"
                      onClick={() => setAvoid(avoid.filter((_, i) => i !== idx))}
                      className="hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !objective.trim() || creating}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "Generating..." : "Generate Brief"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

interface CreateDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: RpProduct;
  onCreateDesign: (input: any) => Promise<any>;
  onToast: (message: string, type?: "success" | "error") => void;
  onDesignCreated: () => void;
}

function CreateDesignModal({ isOpen, onClose, product, onCreateDesign, onToast, onDesignCreated }: CreateDesignModalProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [designKey, setDesignKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [printMethod, setPrintMethod] = useState<RpPrintMethod>("screenprint");
  const [placement, setPlacement] = useState<RpDesignPlacement>("front_center");
  const [maxInkColors, setMaxInkColors] = useState(2);
  const [inkColors, setInkColors] = useState<Array<{ name: string; hex?: string }>>([
    { name: "", hex: "" },
  ]);

  const handleAddInkColor = () => {
    setInkColors([...inkColors, { name: "", hex: "" }]);
  };

  const handleRemoveInkColor = (index: number) => {
    if (inkColors.length > 1) {
      setInkColors(inkColors.filter((_, i) => i !== index));
    }
  };

  const handleInkColorChange = (index: number, field: "name" | "hex", value: string) => {
    const updated = [...inkColors];
    updated[index] = { ...updated[index], [field]: value };
    setInkColors(updated);
  };

  const isValidHex = (hex: string) => {
    if (!hex) return true; // Optional
    return /^#([A-Fa-f0-9]{6})$/.test(hex);
  };

  const validInkColors = inkColors.filter((ink) => ink.name.trim() !== "");
  const allInksValid = validInkColors.every((ink) => !ink.hex || isValidHex(ink.hex));
  const withinMaxColors = validInkColors.length <= maxInkColors;
  const canSubmit =
    designKey.trim() &&
    name.trim() &&
    printMethod &&
    placement &&
    validInkColors.length > 0 &&
    allInksValid &&
    withinMaxColors;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setCreating(true);

    try {
      const result = await onCreateDesign({
        productId: product.id,
        designKey: designKey.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        printMethod,
        placement,
        maxInkColors: maxInkColors || undefined,
        inkColors: validInkColors.map((ink) => ({
          name: ink.name.trim(),
          hex: ink.hex?.trim() || undefined,
        })),
      });

      // Success - close modal and reset form
      onToast(`✅ Created design v${result.version}: ${result.name}`);
      onClose();
      
      // Refetch designs to show the new one
      onDesignCreated();
      
      // Reset form
      setDesignKey("");
      setName("");
      setDescription("");
      setPrintMethod("screenprint");
      setPlacement("front_center");
      setMaxInkColors(2);
      setInkColors([{ name: "", hex: "" }]);
    } catch (err: any) {
      console.error("[CreateDesignModal] Error:", err);
      setError(err?.message || "Failed to create design");
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Design">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Design Key *
            </label>
            <input
              type="text"
              value={designKey}
              onChange={(e) => setDesignKey(e.target.value.toUpperCase())}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              placeholder="GIANTS_WORDMARK"
            />
            <p className="text-xs text-gray-500 mt-1">
              Version-independent key (e.g., GIANTS_WORDMARK)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Design Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="GIANTS Wordmark — Rear Center — Orange Ink"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Optional description"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Print Method *
            </label>
            <select
              value={printMethod}
              onChange={(e) => setPrintMethod(e.target.value as RpPrintMethod)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="screenprint">Screenprint</option>
              <option value="dtf">DTF</option>
              <option value="sublimation">Sublimation</option>
              <option value="embroidery">Embroidery</option>
              <option value="heat_transfer">Heat Transfer</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Placement *
            </label>
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value as RpDesignPlacement)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="front_center">Front Center</option>
              <option value="front_left">Front Left</option>
              <option value="front_right">Front Right</option>
              <option value="back_center">Back Center</option>
              <option value="back_upper">Back Upper</option>
              <option value="back_lower">Back Lower</option>
              <option value="waistband">Waistband</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max Ink Colors
          </label>
          <input
            type="number"
            min={1}
            max={8}
            value={maxInkColors}
            onChange={(e) => setMaxInkColors(parseInt(e.target.value) || 2)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Current: {validInkColors.length} / max {maxInkColors}
            {!withinMaxColors && (
              <span className="text-red-600 ml-2">⚠ Exceeds max colors</span>
            )}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Ink Colors * ({validInkColors.length} / max {maxInkColors})
            </label>
            <button
              type="button"
              onClick={handleAddInkColor}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              + Add Color
            </button>
          </div>
          <div className="space-y-2">
            {inkColors.map((ink, index) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    value={ink.name}
                    onChange={(e) => handleInkColorChange(index, "name", e.target.value)}
                    placeholder="Color name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={ink.hex || ""}
                    onChange={(e) => handleInkColorChange(index, "hex", e.target.value)}
                    placeholder="#RRGGBB"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${
                      ink.hex && !isValidHex(ink.hex)
                        ? "border-red-300 bg-red-50"
                        : "border-gray-300"
                    }`}
                  />
                  {ink.hex && !isValidHex(ink.hex) && (
                    <p className="text-xs text-red-600 mt-1">Invalid hex format</p>
                  )}
                </div>
                {inkColors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveInkColor(index)}
                    className="px-3 py-2 text-red-600 hover:text-red-800 text-sm"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || creating}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Design"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DesignsTabContent({
  product,
  designs,
  designsLoading,
  onRefetchDesigns,
}: {
  product: RpProduct | null;
  designs: any[];
  designsLoading: boolean;
  onRefetchDesigns: () => void;
}) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAIBriefOpen, setIsAIBriefOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"designs" | "concepts">("designs");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  
  const { createProductDesign } = useCreateProductDesign();
  const { createDesignBrief } = useCreateDesignBrief();
  const { createDesignFromConcept } = useCreateDesignFromConcept();
  
  const { briefs } = useDesignBriefs(product?.id);
  const mostRecentBrief = briefs[0]; // Already sorted by createdAt desc
  
  const { concepts, loading: conceptsLoading, refetch: refetchConcepts } = useDesignConcepts(
    product?.id
      ? {
          productId: product.id,
          briefId: mostRecentBrief?.id,
        }
      : undefined
  );

  // Simple toast handler
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!product) return null;

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
            toast.type === "success"
              ? "bg-green-100 text-green-800 border border-green-200"
              : "bg-red-100 text-red-800 border border-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Designs</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAIBriefOpen(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
          >
            AI Design Brief
          </button>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Create Design
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSubTab("designs")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === "designs"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Designs ({designs.length})
          </button>
          <button
            onClick={() => setActiveSubTab("concepts")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === "concepts"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Concepts ({concepts.length})
            {mostRecentBrief && (
              <span className="ml-2 text-xs text-gray-400">({mostRecentBrief.title})</span>
            )}
          </button>
        </nav>
      </div>

      {/* Designs table */}
      {activeSubTab === "designs" && (
        <DesignsTable
          designs={designs}
          designsLoading={designsLoading}
          onDelete={async (designId) => {
            if (!db) throw new Error("Database not initialized");
            await deleteDoc(doc(db, "rp_product_designs", designId));
            onRefetchDesigns();
            showToast("✅ Design deleted");
          }}
        />
      )}

      {/* Concepts table */}
      {activeSubTab === "concepts" && (
        <ConceptsTable
          concepts={concepts}
          conceptsLoading={conceptsLoading}
          product={product}
          brief={mostRecentBrief}
          onPromote={createDesignFromConcept}
          onToast={showToast}
          onRefetch={refetchConcepts}
        />
      )}

      {/* Create Design Modal */}
      <CreateDesignModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        product={product}
        onCreateDesign={createProductDesign}
        onToast={showToast}
        onDesignCreated={onRefetchDesigns}
      />

      {/* AI Design Brief Modal */}
      <AIDesignBriefModal
        isOpen={isAIBriefOpen}
        onClose={() => setIsAIBriefOpen(false)}
        product={product}
        onCreateBrief={createDesignBrief}
        onToast={showToast}
        onBriefCreated={() => {
          // Refresh concepts after brief is created
          refetchConcepts();
        }}
      />
    </div>
  );
}

function ProductDetailContent() {
  const params = useParams();
  const slug = (params?.slug as string) || "";
  const [activeTab, setActiveTab] = useState<"overview" | "designs" | "assets" | "inspiration" | "generate" | "settings">("overview");
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [experimentId, setExperimentId] = useState("");
  const [variantId, setVariantId] = useState("");

  console.log("[ProductDetailContent] Slug from URL:", slug);
  const { product, loading: productLoading, error: productError } = useProductBySlug(slug);
  
  useEffect(() => {
    if (productError) {
      console.error("[ProductDetailContent] Error loading product:", productError);
    }
    if (product) {
      console.log("[ProductDetailContent] Product loaded:", product.id, product.slug);
    }
  }, [product, productError]);
  const { designs, loading: designsLoading, refetch: refetchDesigns } = useProductDesigns(
    product?.id ? { productId: product.id } : null
  );
  const { assets, loading: assetsLoading, refetch: refetchAssets } = useProductAssets(
    product?.id ? { productId: product.id, productSlug: product.slug } : null
  );
  const { jobs, loading: jobsLoading, refetch: refetchJobs } = useGenerationJobs(
    product?.id ? { productId: product.id, limit: 10 } : undefined
  );
  // Hardcoded presets for now (Firestore query issue)
  // Fallback hardcoded presets with supportedModes (if fetchedPresets fails)
  const hardcodedPresets = [
    { id: "vVygHYFuqMoNhD4yYQWN", name: "Ecommerce White", sceneType: "ecommerce", supportedModes: ["product_only", "on_model"] },
    { id: "6PSbRuuBHXltiTQ4Ms21", name: "Studio Editorial", sceneType: "studio", supportedModes: ["on_model"] },
    { id: "uX9mvPDuuFrSPCmhpWFA", name: "Lifestyle Outdoor", sceneType: "lifestyle", supportedModes: ["on_model"] },
  ];
  const { presets: fetchedPresets, loading: presetsLoading } = useScenePresets({ isActive: true });
  
  // Generate form state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false); // Debug panel toggle
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [selectedFaceArtifactId, setSelectedFaceArtifactId] = useState("");
  const [selectedBodyArtifactId, setSelectedBodyArtifactId] = useState("");
  const [faceScale, setFaceScale] = useState(0.80);
  const [bodyScale, setBodyScale] = useState(0.60);
  const [productScale, setProductScale] = useState(0.90);
  const [imageCount, setImageCount] = useState(4);
  const [imageSize, setImageSize] = useState<"square" | "portrait" | "landscape">("square");
  
  // Use fetched presets if available, otherwise fall back to hardcoded
  const allPresets = fetchedPresets.length > 0 ? fetchedPresets : hardcodedPresets;
  
  // Get selected preset to determine mode
  const selectedPreset = allPresets.find(p => p.id === selectedPresetId);
  const presetMode = (selectedPreset && "mode" in selectedPreset && selectedPreset.mode) || 
    (selectedPreset?.supportedModes?.includes("product_only") ? "productOnly" : "onModel");
  const isProductOnly = presetMode === "productOnly";
  const isOnModel = presetMode === "onModel";
  
  // Derive generationType from preset mode (for backward compatibility with function)
  const generationType = isProductOnly ? "product_only" : "on_model";
  const { generateProductAssets } = useGenerateProductAssets();
  const { packs } = useModelPacks();
  
  // Fetch identities from the first pack (or all packs in the future)
  const firstPackId = packs.length > 0 ? packs[0].id : undefined;
  const { identities, loading: identitiesLoading } = useIdentities(firstPackId);
  const { artifacts: allArtifacts } = useLoraArtifacts();
  
  // Update scales when preset changes (use preset defaults)
  useEffect(() => {
    if (selectedPreset && "mode" in selectedPreset) {
      if ("defaultFaceScale" in selectedPreset && selectedPreset.defaultFaceScale !== undefined) setFaceScale(selectedPreset.defaultFaceScale);
      if ("defaultBodyScale" in selectedPreset && selectedPreset.defaultBodyScale !== undefined) setBodyScale(selectedPreset.defaultBodyScale);
      if ("defaultProductScale" in selectedPreset && selectedPreset.defaultProductScale !== undefined) setProductScale(selectedPreset.defaultProductScale);
      if ("defaultImageCount" in selectedPreset && selectedPreset.defaultImageCount !== undefined) setImageCount(selectedPreset.defaultImageCount);
      if ("defaults" in selectedPreset && selectedPreset.defaults?.imageSize) setImageSize(selectedPreset.defaults.imageSize);
      
      // Clear identity/artifacts if switching to productOnly
      if (selectedPreset && "mode" in selectedPreset && selectedPreset.mode === "productOnly") {
        setSelectedIdentityId("");
        setSelectedFaceArtifactId("");
        setSelectedBodyArtifactId("");
      }
    }
  }, [selectedPresetId, selectedPreset]);
  
  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Update productScale when product loads
  useEffect(() => {
    if (product?.ai?.productRecommendedScale) {
      setProductScale(product.ai.productRecommendedScale);
    }
  }, [product?.ai?.productRecommendedScale]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Handle ESC key to close lightbox
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && lightboxImage) {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [lightboxImage]);

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!product?.id || !selectedPresetId) {
      setGenerateError("Preset is required");
      return;
    }

    // On-model requires identity (check preset.requireIdentity)
    if (isOnModel && selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && !selectedIdentityId) {
      setGenerateError("Identity is required for this preset");
      return;
    }

    setGenerateError(null);
    setGenerating(true);

    console.log("[handleGenerate] Generation type:", generationType);
    console.log("[handleGenerate] Selected presetId:", selectedPresetId);
      console.log("[handleGenerate] Available presets:", allPresets.map(p => ({ id: p.id, name: p.name })));

    try {
      await generateProductAssets({
        productId: product.id,
        generationType, // For backward compatibility
        identityId: isOnModel ? selectedIdentityId : undefined,
        presetId: selectedPresetId,
        artifacts: isOnModel ? {
          faceArtifactId: (selectedPreset && "allowFaceArtifact" in selectedPreset ? selectedPreset.allowFaceArtifact !== false : true) ? (selectedFaceArtifactId || undefined) : undefined,
          faceScale,
          bodyArtifactId: (selectedPreset && "allowBodyArtifact" in selectedPreset ? selectedPreset.allowBodyArtifact !== false : true) ? (selectedBodyArtifactId || undefined) : undefined,
          bodyScale,
          productArtifactId: (selectedPreset && "allowProductArtifact" in selectedPreset ? selectedPreset.allowProductArtifact !== false : true) ? (product.ai?.productArtifactId || undefined) : undefined,
          productScale,
        } : {
          productArtifactId: (selectedPreset && "allowProductArtifact" in selectedPreset ? selectedPreset.allowProductArtifact !== false : true) ? (product.ai?.productArtifactId || undefined) : undefined,
          productScale,
        },
        imageCount,
        imageSize,
        experimentId: experimentId.trim() || undefined,
        variantId: variantId.trim() || undefined,
      });

      // Show success message
      showToast(`✅ Generation started! Assets will appear in the Assets tab when ready (usually 20-30 seconds).`, "success");

      // Reset form (preserve generationType)
      setSelectedPresetId("");
      if (generationType === "on_model") {
        setSelectedIdentityId("");
        setSelectedFaceArtifactId("");
        setSelectedBodyArtifactId("");
      }

      // Refetch jobs immediately
      await refetchJobs();
      
      // Switch to Assets tab immediately to show progress
      setActiveTab("assets");
      
      // Clear any existing polling interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      // Poll for assets - generation takes ~20-30 seconds
      // Poll every 3 seconds for up to 2 minutes
      let pollAttempts = 0;
      const maxPollAttempts = 40; // 40 * 3s = 2 minutes
      
      pollIntervalRef.current = setInterval(async () => {
        pollAttempts++;
        
        // Refetch both jobs and assets
        await refetchJobs();
        await refetchAssets();
        
        // Stop polling after max attempts
        if (pollAttempts >= maxPollAttempts) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          showToast(`✅ Generation completed! Check the Assets tab.`, "success");
        }
      }, 3000);
    } catch (err: any) {
      console.error("[ProductDetail] Failed to generate:", err);
      setGenerateError(err?.message || "Failed to generate assets");
    } finally {
      setGenerating(false);
    }
  };

  if (productLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading product…</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-sm font-semibold text-red-800 mb-2">Product not found</p>
          <p className="text-xs text-red-600 mb-2">Slug from URL: <code className="bg-red-100 px-1 rounded">{slug}</code></p>
          {productError && (
            <p className="text-xs text-red-600">Error: {productError}</p>
          )}
          <p className="text-xs text-red-600 mt-2">
            <a href="/products" className="underline">← Back to Products</a>
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "designs", label: "Designs" },
    { id: "assets", label: "Assets" },
    { id: "inspiration", label: "Inspiration" },
    { id: "generate", label: "Generate" },
    { id: "settings", label: "Settings" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === "success" ? "bg-green-100 text-green-800 border border-green-300" : "bg-red-100 text-red-800 border border-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={(e) => {
            // Close if clicking the backdrop (not the image itself)
            if (e.target === e.currentTarget) {
              setLightboxImage(null);
            }
          }}
        >
          <div className="relative max-w-7xl max-h-full">
            {/* Close button */}
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              aria-label="Close lightbox"
            >
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            
            {/* Image */}
            <img
              src={lightboxImage}
              alt="Asset preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            
            {/* ESC hint */}
            <div className="absolute -bottom-10 left-0 right-0 text-center text-white text-sm opacity-75">
              Press ESC to close
            </div>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {product.baseProductKey} · {product.colorway.name}
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Product Overview</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        product.status === "active"
                          ? "bg-green-100 text-green-800"
                          : product.status === "draft"
                          ? "bg-gray-100 text-gray-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {product.status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Category</dt>
                  <dd className="mt-1 text-sm text-gray-900">{product.category}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Base Product</dt>
                  <dd className="mt-1 text-sm font-mono text-gray-900">{product.baseProductKey}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Colorway</dt>
                  <dd className="mt-1 text-sm text-gray-900">{product.colorway.name}</dd>
                </div>
                {product.description && (
                  <div className="md:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">Description</dt>
                    <dd className="mt-1 text-sm text-gray-900">{product.description}</dd>
                  </div>
                )}
                {product.ai.productTrigger && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Product Trigger</dt>
                    <dd className="mt-1 text-sm font-mono text-gray-900">{product.ai.productTrigger}</dd>
                  </div>
                )}
                {product.ai.productRecommendedScale && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Recommended Scale</dt>
                    <dd className="mt-1 text-sm text-gray-900">{product.ai.productRecommendedScale}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Asset Counters */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Asset Statistics</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-gray-900">
                    {product.counters?.assetsTotal || 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Total Assets</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {product.counters?.assetsApproved || 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Approved</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-600">
                    {product.counters?.assetsPublished || 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Published</div>
                </div>
              </div>
            </div>

            {/* Hero Image */}
            {product.heroAssetPath && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Hero Image</h3>
                <img
                  src={product.heroAssetPath}
                  alt="Hero"
                  className="max-w-md h-auto rounded-lg border border-gray-200"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "designs" && (
          <DesignsTabContent
            product={product}
            designs={designs}
            designsLoading={designsLoading}
            onRefetchDesigns={refetchDesigns}
          />
        )}

        {activeTab === "assets" && (
          <AssetsTab
            product={product}
            assets={assets}
            assetsLoading={assetsLoading}
            refetchAssets={refetchAssets}
            showToast={showToast}
            lightboxImage={lightboxImage}
            setLightboxImage={setLightboxImage}
          />
        )}

        {activeTab === "inspiration" && product && product.id && (
          <InspirationTab
            product={product}
            productId={product.id}
          />
        )}

        {activeTab === "generate" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Assets</h2>
              
              {/* Generate Form */}
              <form onSubmit={handleGenerate} className="space-y-4 mb-6">
                {generateError && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
                    {generateError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Scene Preset *
                    </label>
                    <select
                      value={selectedPresetId}
                      onChange={(e) => {
                        setSelectedPresetId(e.target.value);
                      }}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">Select preset...</option>
                      {allPresets.map((preset) => {
                        const mode = ("mode" in preset && preset.mode) || (preset.supportedModes?.includes("product_only") ? "productOnly" : "onModel");
                        const modeLabel = mode === "productOnly" ? "Product Only" : "On Model";
                        return (
                          <option key={preset.id} value={preset.id}>
                            {preset.name} ({modeLabel})
                          </option>
                        );
                      })}
                    </select>
                    {selectedPreset && "mode" in selectedPreset && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded ${
                          isProductOnly 
                            ? "bg-gray-100 text-gray-800" 
                            : "bg-blue-100 text-blue-800"
                        }`}>
                          {isProductOnly ? "Product Only" : "On Model"}
                        </span>
                        {"safetyProfile" in selectedPreset && selectedPreset.safetyProfile === "underwear_strict" && (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded bg-orange-100 text-orange-800">
                            Strict Safety
                          </span>
                        )}
                      </div>
                    )}
                    {selectedPreset && (
                      <p className="text-xs text-gray-500 mt-1">
                        {isProductOnly
                          ? "Generates clean catalog shots of the product without a model."
                          : "Generates images of a selected identity wearing the product in the chosen scene."}
                      </p>
                    )}
                  </div>

                  {/* Identity selector - only show for onModel */}
                  {isOnModel && selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Identity *
                    </label>
                    <select
                      value={selectedIdentityId}
                      onChange={(e) => setSelectedIdentityId(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      disabled={identitiesLoading || !firstPackId}
                    >
                      <option value="">
                        {identitiesLoading
                          ? "Loading identities..."
                          : !firstPackId
                          ? "No packs available"
                          : "Select identity..."}
                      </option>
                      {identities.map((identity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.name || identity.token || `Identity ${identity.id}`}
                        </option>
                      ))}
                    </select>
                    {identities.length === 0 && !identitiesLoading && firstPackId && (
                      <p className="text-xs text-gray-500 mt-1">
                        No identities found in pack. Create identities first.
                      </p>
                    )}
                    {!firstPackId && !identitiesLoading && (
                      <p className="text-xs text-gray-500 mt-1">
                        No model packs found. Create a pack first.
                      </p>
                    )}
                  </div>
                  )}
                </div>

                {/* Artifact selectors - only show for onModel and if preset allows */}
                {isOnModel && selectedPreset && ("allowFaceArtifact" in selectedPreset ? selectedPreset.allowFaceArtifact !== false : true) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Face Artifact {"allowFaceArtifact" in selectedPreset && selectedPreset.allowFaceArtifact === false ? "(disabled)" : ""}
                    </label>
                    <select
                      value={selectedFaceArtifactId}
                      onChange={(e) => setSelectedFaceArtifactId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">None</option>
                      {allArtifacts
                        .filter((a) => !a.artifactKind || a.artifactKind === "face")
                        .map((artifact: any) => (
                          <option key={artifact.id} value={artifact.id}>
                            {artifact.name || `Face LoRA ${artifact.id?.substring(0, 8)}`}
                          </option>
                        ))}
                    </select>
                    {selectedFaceArtifactId && (
                      <div className="mt-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Face Scale ({faceScale.toFixed(2)})
                        </label>
                        <input
                          type="range"
                          min={0.4}
                          max={1.0}
                          step={0.05}
                          value={faceScale}
                          onChange={(e) => setFaceScale(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    )}
                  </div>

                  {selectedPreset && ("allowBodyArtifact" in selectedPreset ? selectedPreset.allowBodyArtifact !== false : true) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Body Artifact
                    </label>
                    <select
                      value={selectedBodyArtifactId}
                      onChange={(e) => setSelectedBodyArtifactId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">None</option>
                      {allArtifacts
                        .filter((a) => a.artifactKind === "body")
                        .map((artifact: any) => (
                          <option key={artifact.id} value={artifact.id}>
                            {artifact.name || `Body LoRA ${artifact.id?.substring(0, 8)}`}
                          </option>
                        ))}
                    </select>
                    {selectedBodyArtifactId && (
                      <div className="mt-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Body Scale ({bodyScale.toFixed(2)})
                        </label>
                        <input
                          type="range"
                          min={0.3}
                          max={0.9}
                          step={0.05}
                          value={bodyScale}
                          onChange={(e) => setBodyScale(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    )}
                  </div>
                  )}
                </div>
                )}

                {/* Product Scale - always shown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Scale ({productScale.toFixed(2)})
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={productScale}
                    onChange={(e) => setProductScale(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Image Count
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={imageCount}
                      onChange={(e) => setImageCount(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Image Size
                    </label>
                    <select
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value as "square" | "portrait" | "landscape")}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="square">Square</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>

                {/* A/B Testing Fields */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">A/B Testing (Optional)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Experiment ID
                      </label>
                      <input
                        type="text"
                        value={experimentId}
                        onChange={(e) => setExperimentId(e.target.value)}
                        placeholder="e.g., prompt-variant-test-2026"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Group related generations for comparison
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Variant ID
                      </label>
                      <input
                        type="text"
                        value={variantId}
                        onChange={(e) => setVariantId(e.target.value)}
                        placeholder="e.g., variant-a, variant-b"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Identifier for this specific variant
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={generating || !selectedPresetId || (isOnModel && selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && !selectedIdentityId)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {generating ? "Generating..." : `Generate ${imageCount} Image${imageCount > 1 ? "s" : ""}`}
                </button>
              </form>

              {/* Debug Panel (Section 5.3) */}
              <div className="mt-6 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDebug(!showDebug)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2"
                >
                  <span>{showDebug ? "▼" : "▶"}</span>
                  <span>Debug Info</span>
                </button>
                {showDebug && selectedPresetId && (
                  <div className="mt-3 space-y-3 p-4 bg-gray-50 rounded-lg text-xs font-mono">
                    <div>
                      <div className="font-semibold text-gray-700 mb-1">Preset Mode:</div>
                      <div className="text-gray-600">{presetMode}</div>
                    </div>
                    {selectedPreset && "mode" in selectedPreset && (
                      <>
                        <div>
                          <div className="font-semibold text-gray-700 mb-1">Safety Profile:</div>
                          <div className="text-gray-600">{"safetyProfile" in selectedPreset ? (selectedPreset.safetyProfile || "general_safe") : "general_safe"}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700 mb-1">Require Identity:</div>
                          <div className="text-gray-600">{"requireIdentity" in selectedPreset ? (selectedPreset.requireIdentity !== false ? "Yes" : "No") : "Yes"}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700 mb-1">Allow Face Artifact:</div>
                          <div className="text-gray-600">{"allowFaceArtifact" in selectedPreset ? (selectedPreset.allowFaceArtifact !== false ? "Yes" : "No") : "Yes"}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700 mb-1">Allow Body Artifact:</div>
                          <div className="text-gray-600">{"allowBodyArtifact" in selectedPreset ? (selectedPreset.allowBodyArtifact !== false ? "Yes" : "No") : "Yes"}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700 mb-1">Default Scales:</div>
                          <div className="text-gray-600">
                            Face: {"defaultFaceScale" in selectedPreset ? (selectedPreset.defaultFaceScale ?? "N/A") : "N/A"}, 
                            Body: {"defaultBodyScale" in selectedPreset ? (selectedPreset.defaultBodyScale ?? "N/A") : "N/A"}, 
                            Product: {"defaultProductScale" in selectedPreset ? (selectedPreset.defaultProductScale ?? "N/A") : "N/A"}
                          </div>
                        </div>
                      </>
                    )}
                    <div>
                      <div className="font-semibold text-gray-700 mb-1">Current Scales:</div>
                      <div className="text-gray-600">
                        Face: {faceScale.toFixed(2)}, 
                        Body: {bodyScale.toFixed(2)}, 
                        Product: {productScale.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-700 mb-1">Selected Artifacts:</div>
                      <div className="text-gray-600">
                        Face: {selectedFaceArtifactId || "None"}, 
                        Body: {selectedBodyArtifactId || "None"}, 
                        Product: {product?.ai?.productArtifactId || "None"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Jobs */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Generation Jobs</h3>
              {jobsLoading ? (
                <p className="text-sm text-gray-500">Loading jobs…</p>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-gray-500">No generation jobs yet.</p>
              ) : (
                <div className="space-y-3">
                  {jobs.map((job) => (
                    <div key={job.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            Job {job.id?.substring(0, 8)}...
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Status: {job.status} · {job.params?.imageCount || 0} images · {job.params?.size || "square"}
                          </p>
                        </div>
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            job.status === "succeeded"
                              ? "bg-green-100 text-green-800"
                              : job.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : job.status === "running"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings</h2>
            
            {/* Data Maintenance Section */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Data Maintenance</h3>
              <p className="text-sm text-gray-500 mb-3">
                Recalculate asset counters if they appear out of sync with actual assets.
              </p>
              <button
                onClick={async () => {
                  if (!db || !product?.id) return;
                  
                  try {
                    // Count actual assets for this product
                    const assetsRef = collection(db, "rp_product_assets");
                    const q = query(assetsRef, where("productId", "==", product.id));
                    const snapshot = await getDocs(q);
                    const actualCount = snapshot.docs.length;
                    
                    // Count approved assets
                    const approvedQuery = query(assetsRef, where("productId", "==", product.id), where("status", "==", "approved"));
                    const approvedSnapshot = await getDocs(approvedQuery);
                    const approvedCount = approvedSnapshot.docs.length;
                    
                    // Count published assets
                    const publishedQuery = query(assetsRef, where("productId", "==", product.id), where("status", "==", "published"));
                    const publishedSnapshot = await getDocs(publishedQuery);
                    const publishedCount = publishedSnapshot.docs.length;
                    
                    // Update product counters
                    const productRef = doc(db, "rp_products", product.id);
                    await updateDoc(productRef, {
                      "counters.assetsTotal": actualCount,
                      "counters.assetsApproved": approvedCount,
                      "counters.assetsPublished": publishedCount,
                      updatedAt: new Date(),
                    });
                    
                    showToast(`Counters updated: ${actualCount} total, ${approvedCount} approved, ${publishedCount} published`, "success");
                    
                    // Refresh product data
                    window.location.reload();
                  } catch (error) {
                    console.error("[Settings] Failed to recalculate counters:", error);
                    showToast("Failed to recalculate counters", "error");
                  }
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
              >
                Recalculate Asset Counters
              </button>
            </div>
            
            <p className="text-sm text-gray-500">
              Additional product settings and configuration will be available here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Inspiration Tab Component
function InspirationTab({
  product,
  productId,
}: {
  product: RpProduct;
  productId: string;
}) {
  const { inspirations, loading: inspirationsLoading } = useInspirations(null);
  const { attachInspirationToProduct } = useAttachInspirationToProduct();
  const [selectedInspirationIds, setSelectedInspirationIds] = useState<string[]>(
    product.inspirationIds || []
  );
  const [isSelecting, setIsSelecting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get attached inspirations
  const attachedInspirations = inspirations.filter((insp) =>
    selectedInspirationIds.includes(insp.id || "")
  );

  const handleToggleSelection = (inspirationId: string) => {
    setSelectedInspirationIds((prev) => {
      if (prev.includes(inspirationId)) {
        return prev.filter((id) => id !== inspirationId);
      } else {
        return [...prev, inspirationId];
      }
    });
  };

  const handleSave = async () => {
    if (selectedInspirationIds.length === 0) {
      setError("Please select at least one inspiration");
      return;
    }

    setAttaching(true);
    setError(null);
    try {
      await attachInspirationToProduct(productId, {
        inspirationIds: selectedInspirationIds,
      });
      setIsSelecting(false);
      // Show success toast (you can add toast notifications here)
    } catch (err: any) {
      console.error("[InspirationTab] Error attaching:", err);
      setError(err?.message || "Failed to attach inspirations");
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Inspiration</h2>
        <button
          onClick={() => setIsSelecting(!isSelecting)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {isSelecting ? "Cancel" : "Select Inspirations"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isSelecting ? (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Select inspirations from the library to attach to this product:
          </p>
          {inspirationsLoading ? (
            <p className="text-sm text-gray-500">Loading inspirations...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
                {inspirations.map((inspiration) => {
                  const isSelected = selectedInspirationIds.includes(inspiration.id || "");
                  return (
                    <div
                      key={inspiration.id}
                      onClick={() => handleToggleSelection(inspiration.id || "")}
                      className={`border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? "border-blue-600 ring-2 ring-blue-200"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {inspiration.imageUrls && inspiration.imageUrls.length > 0 && (
                        <img
                          src={inspiration.imageUrls[0]}
                          alt={inspiration.title}
                          className="w-full h-32 object-cover"
                        />
                      )}
                      <div className="p-2">
                        <h3 className="font-semibold text-xs text-gray-900 line-clamp-2">
                          {inspiration.title}
                        </h3>
                        {isSelected && (
                          <span className="inline-flex mt-1 px-1.5 py-0.5 bg-blue-600 text-white rounded text-xs">
                            Selected
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleSave}
                  disabled={attaching || selectedInspirationIds.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {attaching ? "Saving..." : `Save (${selectedInspirationIds.length} selected)`}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div>
          {attachedInspirations.length === 0 ? (
            <p className="text-sm text-gray-500">
              No inspirations attached. Click &quot;Select Inspirations&quot; to add some.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {attachedInspirations.map((inspiration) => (
                <div
                  key={inspiration.id}
                  className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {inspiration.imageUrls && inspiration.imageUrls.length > 0 && (
                    <img
                      src={inspiration.imageUrls[0]}
                      alt={inspiration.title}
                      className="w-full h-48 object-cover"
                    />
                  )}
                  <div className="p-3">
                    <h3 className="font-semibold text-sm text-gray-900 mb-1 line-clamp-2">
                      {inspiration.title}
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                        {inspiration.sourceType}
                      </span>
                    </div>
                    {inspiration.tags && inspiration.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {inspiration.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex px-1.5 py-0.5 bg-gray-50 text-gray-600 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ProductDetailContent />
      </div>
    </ProtectedRoute>
  );
}
