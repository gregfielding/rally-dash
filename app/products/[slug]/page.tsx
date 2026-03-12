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
import { useCreateMockJob, useWatchMockJob } from "@/lib/hooks/useMockAssets";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useLoraArtifacts } from "@/lib/hooks/useLoraArtifacts";
import { useDesignBriefs } from "@/lib/hooks/useDesignBriefs";
import { useDesignConcepts } from "@/lib/hooks/useDesignConcepts";
import { useCreateProductDesign, useCreateDesignFromConcept, useCreateDesignBrief } from "@/lib/hooks/useDesignMutations";
import { useDesign, useDesigns } from "@/lib/hooks/useDesignAssets";
import { useBlank, useBlanks } from "@/lib/hooks/useBlanks";
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
  onSetHeroSlot,
}: {
  product: RpProduct | null;
  assets: any[];
  assetsLoading: boolean;
  refetchAssets: () => void;
  showToast: (message: string, type: "success" | "error") => void;
  lightboxImage: string | null;
  setLightboxImage: (url: string | null) => void;
  onSetHeroSlot?: (assetId: string, url: string, slot: "hero_front" | "hero_back") => Promise<void>;
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
            <>
              <button
                onClick={async () => {
                  const placeholders = assets.filter(
                    (a) => a.id && (a.downloadUrl?.includes("placeholder") || a.downloadUrl?.includes("data:image/svg"))
                  );
                  if (placeholders.length === 0) {
                    showToast("No placeholder assets (SVG/placeholder URL) to delete. Use “Delete all assets” to remove generated images.", "error");
                    return;
                  }
                  if (!confirm(`Delete ${placeholders.length} placeholder asset(s)?`)) return;
                  if (!db) return;
                  const firestore = db;
                  const batch = writeBatch(firestore);
                  placeholders.forEach((asset) => {
                    batch.delete(doc(firestore, "rp_product_assets", asset.id!));
                  });
                  await batch.commit();
                  showToast(`Deleted ${placeholders.length} placeholder asset(s)`, "success");
                  refetchAssets();
                }}
                className="px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 border border-amber-300 rounded-lg"
              >
                Delete Placeholders
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete all ${assets.length} assets? This cannot be undone.`)) return;
                  if (!db) return;
                  const firestore = db;
                  const batch = writeBatch(firestore);
                  assets.forEach((asset) => {
                    if (asset.id) batch.delete(doc(firestore, "rp_product_assets", asset.id));
                  });
                  await batch.commit();
                  showToast(`Deleted all ${assets.length} assets`, "success");
                  refetchAssets();
                }}
                className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-300 rounded-lg"
              >
                Delete All Assets ({assets.length})
              </button>
            </>
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
                    <div className="flex gap-1">
                      {onSetHeroSlot && (asset.downloadUrl || asset.publicUrl) && (
                        <>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onSetHeroSlot(asset.id!, (asset.downloadUrl || asset.publicUrl)!, "hero_front");
                              showToast("Set as hero front", "success");
                            }}
                            className="text-xs px-1.5 py-0.5 bg-gray-200 hover:bg-gray-300 rounded"
                          >
                            Hero front
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onSetHeroSlot(asset.id!, (asset.downloadUrl || asset.publicUrl)!, "hero_back");
                              showToast("Set as hero back", "success");
                            }}
                            className="text-xs px-1.5 py-0.5 bg-gray-200 hover:bg-gray-300 rounded"
                          >
                            Hero back
                          </button>
                        </>
                      )}
                    </div>
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
  const mockupPollCancelledRef = useRef(false);
  const [experimentId, setExperimentId] = useState("");
  const [variantId, setVariantId] = useState("");
  // Two-stage pipeline: Product Images (Stage 1) vs Model Images (Stage 2)
  const [generateMode, setGenerateMode] = useState<"product" | "model">("product");

  const { product, loading: productLoading, error: productError, refetch: refetchProduct } = useProductBySlug(slug);

  useEffect(() => {
    if (productError) {
      console.error("[ProductDetailContent] Error loading product:", productError);
    }
  }, [productError]);
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
  // Fallback hardcoded presets with supportedModes (if fetchedPresets fails). Run seed-scene-presets.js for Ecommerce Flat.
  const hardcodedPresets = [
    { id: "vVygHYFuqMoNhD4yYQWN", name: "Ecommerce White", sceneType: "ecommerce", mode: "productOnly" as const, supportedModes: ["product_only", "on_model"] },
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
  const { createJob: createMockJob } = useCreateMockJob();
  const [lastMockJobId, setLastMockJobId] = useState<string | null>(null);
  const { job: mockJob } = useWatchMockJob(lastMockJobId);
  const { packs } = useModelPacks();

  // Render Setup: explicit blank/design/side (part of product definition)
  const { blank: currentBlank, loading: blankLoading } = useBlank(product?.blankId);
  const designIdForFront = product?.designIdFront ?? product?.designId ?? null;
  const designIdForBack = product?.designIdBack ?? null;
  const { design: designFront, isLoading: designFrontLoading } = useDesign(designIdForFront);
  const { design: designBack, isLoading: designBackLoading } = useDesign(designIdForBack);
  const { designs: allDesigns } = useDesigns({});
  const { blanks: allBlanks } = useBlanks();
  const [renderSetupModal, setRenderSetupModal] = useState<"blank_front" | "blank_back" | "placement_front" | "placement_back" | "design_front" | "design_back" | null>(null);
  const [savingRenderSetup, setSavingRenderSetup] = useState(false);
  // Local state for placement editor (normalized 0-1); synced when placement modal opens
  const [placementEdit, setPlacementEdit] = useState({ x: 0.5, y: 0.5, scale: 0.6 });
  /** Which side's placement we're editing (when placement modal is open) */
  const [placementEditSide, setPlacementEditSide] = useState<"front" | "back">("front");
  // UI-only: which view to generate in Generate tab (renderer still chooses config by view)
  const [generateView, setGenerateView] = useState<"front" | "back">("front");

  // Merchandising form state (spec-aligned fields); synced from product when product loads
  const [merchandising, setMerchandising] = useState({
    title: "",
    handle: "",
    descriptionHtml: "",
    seoTitle: "",
    seoDescription: "",
    tagsStr: "",
    collectionKeysStr: "",
  });
  const [savingMerchandising, setSavingMerchandising] = useState(false);
  useEffect(() => {
    if (!product) return;
    setMerchandising({
      title: product.title ?? product.name ?? "",
      handle: product.handle ?? product.slug ?? "",
      descriptionHtml: product.descriptionHtml ?? product.description ?? "",
      seoTitle: product.seo?.title ?? "",
      seoDescription: product.seo?.description ?? "",
      tagsStr: (product.tags ?? []).join(", "),
      collectionKeysStr: (product.collectionKeys ?? []).join(", "),
    });
  }, [product?.id, product?.title, product?.name, product?.handle, product?.slug, product?.descriptionHtml, product?.description, product?.seo?.title, product?.seo?.description, product?.tags, product?.collectionKeys]);

  // Production form state
  const [production, setProduction] = useState({
    printPdfFront: "",
    printPdfBack: "",
    printColorsStr: "",
    productionNotes: "",
  });
  const [savingProduction, setSavingProduction] = useState(false);
  useEffect(() => {
    if (!product) return;
    const p = product.production;
    setProduction({
      printPdfFront: p?.printPdfFront ?? "",
      printPdfBack: p?.printPdfBack ?? "",
      printColorsStr: (p?.printColors ?? []).join(", "),
      productionNotes: p?.productionNotes ?? "",
    });
  }, [product?.id, product?.production]);

  // When mock job fails, show error and stop polling
  useEffect(() => {
    if (mockJob?.status === "failed") {
      const errMsg = (mockJob as { error?: { message?: string } }).error?.message || "Mockup generation failed.";
      setGenerateError(errMsg);
      mockupPollCancelledRef.current = true;
    }
  }, [mockJob?.status, mockJob]);

  // When mock job succeeds, refetch product so we get new updatedAt (and cache-busted mockup image loads)
  useEffect(() => {
    if (mockJob?.status === "succeeded") {
      setLastMockJobId(null);
      refetchProduct();
      const t = setTimeout(() => refetchProduct(), 2000);
      return () => clearTimeout(t);
    }
  }, [mockJob?.status, refetchProduct]);

  // Clear mock job id once we have a mockup (e.g. refetch or another tab)
  useEffect(() => {
    if (product?.mockupUrl && lastMockJobId) setLastMockJobId(null);
  }, [product?.mockupUrl, lastMockJobId]);

  // Resolve blank for a side (for fallback when renderSetup is missing)
  const blankIdForFallback = product?.renderConfig?.selectedBlankId || product?.blankId;
  const blankForFallback =
    blankIdForFallback === product?.blankId ? currentBlank : allBlanks.find((b) => (b as { blankId?: string }).blankId === blankIdForFallback) || currentBlank;
  const fallbackFrontBlankUrl = (blankForFallback?.images?.front as { downloadUrl?: string } | null)?.downloadUrl ?? product?.renderConfig?.selectedBlankImageUrl;
  const fallbackBackBlankUrl = (blankForFallback?.images?.back as { downloadUrl?: string } | null)?.downloadUrl ?? product?.renderConfig?.selectedBlankImageUrl;

  const designFrontUrlResolved = product?.renderConfig?.selectedDesignImageUrlFront || (designFront?.files as { png?: { downloadUrl?: string } } | undefined)?.png?.downloadUrl;
  const designBackUrlResolved = product?.renderConfig?.selectedDesignImageUrlBack || (designBack?.files as { png?: { downloadUrl?: string } } | undefined)?.png?.downloadUrl;

  /** Effective config per side: prefer renderSetup, fallback to renderConfig + product (backward compat). */
  type SideConfig = { blankAssetId?: string | null; blankImageUrl?: string | null; designAssetId?: string | null; designAssetUrl?: string | null; placementKey?: string | null; placementOverride?: { x?: number; y?: number; scale?: number } | null };
  const effectiveFrontConfig: SideConfig = {
    blankAssetId: product?.renderSetup?.front?.blankAssetId ?? blankIdForFallback ?? null,
    blankImageUrl: product?.renderSetup?.front?.blankImageUrl ?? fallbackFrontBlankUrl ?? null,
    designAssetId: product?.renderSetup?.front?.designAssetId ?? designIdForFront ?? null,
    designAssetUrl: product?.renderSetup?.front?.designAssetUrl ?? designFrontUrlResolved ?? null,
    placementKey: product?.renderSetup?.front?.placementKey ?? "front_center",
    placementOverride: product?.renderSetup?.front?.placementOverride ?? product?.renderConfig?.placementOverride ?? undefined,
  };
  const effectiveBackConfig: SideConfig = {
    blankAssetId: product?.renderSetup?.back?.blankAssetId ?? blankIdForFallback ?? null,
    blankImageUrl: product?.renderSetup?.back?.blankImageUrl ?? fallbackBackBlankUrl ?? null,
    designAssetId: product?.renderSetup?.back?.designAssetId ?? designIdForBack ?? null,
    designAssetUrl: product?.renderSetup?.back?.designAssetUrl ?? designBackUrlResolved ?? null,
    placementKey: product?.renderSetup?.back?.placementKey ?? "back_center",
    placementOverride: product?.renderSetup?.back?.placementOverride ?? product?.renderConfig?.placementOverride ?? undefined,
  };

  const designFrontUrl = effectiveFrontConfig.designAssetUrl ?? designFrontUrlResolved;
  const designBackUrl = effectiveBackConfig.designAssetUrl ?? designBackUrlResolved;

  /** Persist one side's config to product.renderSetup (canonical). Also sync product.designIdFront/Back and defaults when saving design/blank. */
  const persistRenderSetupSide = async (side: "front" | "back", updates: Partial<NonNullable<NonNullable<RpProduct["renderSetup"]>["front"]>>) => {
    if (!product?.id || !db) return;
    setSavingRenderSetup(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const rs = { ...product.renderSetup };
      const current = side === "front" ? { ...rs.front } : { ...rs.back };
      const next = { ...current, ...updates };
      if (side === "front") rs.front = next; else rs.back = next;
      const payload: Record<string, unknown> = { renderSetup: rs, updatedAt: new Date(), updatedBy: product.updatedBy || "" };
      if (updates.designAssetId != null) {
        if (side === "front") payload.designIdFront = updates.designAssetId; else payload.designIdBack = updates.designAssetId;
      }
      if (updates.blankImageUrl != null && rs.defaults) {
        rs.defaults = { ...rs.defaults, blankId: blankIdForFallback ?? undefined };
        payload.renderSetup = rs;
      }
      await updateDoc(productRef, payload);
      await refetchProduct();
    } finally {
      setSavingRenderSetup(false);
    }
  };

  /** Persist blank for a side: set renderSetup.front/back.blankAssetId + blankImageUrl and defaults.blankId. */
  const persistBlankForSide = async (side: "front" | "back", blankId: string, blankImageUrl: string) => {
    if (!product?.id || !db) return;
    setSavingRenderSetup(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const rs = { ...product.renderSetup };
      const current = side === "front" ? { ...rs.front } : { ...rs.back };
      const next = { ...current, blankAssetId: blankId, blankImageUrl };
      if (side === "front") rs.front = next; else rs.back = next;
      rs.defaults = { ...(rs.defaults ?? {}), blankId };
      await updateDoc(productRef, { renderSetup: rs, blankId, updatedAt: new Date(), updatedBy: product.updatedBy || "" });
      await refetchProduct();
    } finally {
      setSavingRenderSetup(false);
    }
  };

  /** Persist design for a side: renderSetup + product.designIdFront/designIdBack. */
  const persistDesignForSide = async (side: "front" | "back", designId: string, designPngUrl: string) => {
    await persistRenderSetupSide(side, { designAssetUrl: designPngUrl, designAssetId: designId });
  };

  /** Remove design from a side (e.g. front = blank only). Clears renderSetup and designIdFront/Back. */
  const clearDesignForSide = async (side: "front" | "back") => {
    if (!product?.id || !db) return;
    setSavingRenderSetup(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const rs = { ...product.renderSetup };
      const current = side === "front" ? { ...rs.front } : { ...rs.back };
      const next = { ...current, designAssetUrl: null, designAssetId: null };
      if (side === "front") rs.front = next; else rs.back = next;
      await updateDoc(productRef, {
        renderSetup: rs,
        ...(side === "front" ? { designIdFront: null } : { designIdBack: null }),
        updatedAt: new Date(),
        updatedBy: product.updatedBy || "",
      });
      await refetchProduct();
    } finally {
      setSavingRenderSetup(false);
    }
  };

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

  // Cleanup all polling on unmount
  useEffect(() => {
    return () => {
      mockupPollCancelledRef.current = true;
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
      
      // Poll for assets - generation takes ~20-30 seconds. Poll every 5s, stop after 2 min or on unmount.
      let pollAttempts = 0;
      const maxPollAttempts = 24; // 24 * 5s = 2 minutes
      const pollMs = 5000;

      pollIntervalRef.current = setInterval(async () => {
        pollAttempts++;
        await refetchJobs();
        await refetchAssets();
        if (pollAttempts >= maxPollAttempts && pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          showToast(`✅ Generation completed! Check the Assets tab.`, "success");
        }
      }, pollMs);
    } catch (err: any) {
      console.error("[ProductDetail] Failed to generate:", err);
      setGenerateError(err?.message || "Failed to generate assets");
    } finally {
      setGenerating(false);
    }
  };

  const [mockupGenerating, setMockupGenerating] = useState(false);
  const handleGenerateMockup = async () => {
    const view = generateView;
    const config = view === "front" ? effectiveFrontConfig : effectiveBackConfig;
    if (!product?.id || !product.blankId) {
      setGenerateError("Product must have a blank (create from Design + Blank first).");
      return;
    }
    if (!config.designAssetId) {
      setGenerateError("Set a design for the " + view + " side in Render Setup.");
      return;
    }
    if (!config.blankImageUrl || !config.designAssetUrl) {
      setGenerateError("Select a blank and design for the " + view + " side in Render Setup first.");
      return;
    }
    setGenerateError(null);
    setMockupGenerating(true);
    try {
      const jobId = await createMockJob({
        designId: config.designAssetId,
        blankId: product.blankId,
        view,
        quality: "final",
        productId: product.id,
        blankImageUrl: config.blankImageUrl,
        designPngUrl: config.designAssetUrl,
        placementId: (config.placementKey as "front_center" | "back_center") || (view === "front" ? "front_center" : "back_center"),
        placementOverride: {
          x: config.placementOverride?.x ?? 0.5,
          y: config.placementOverride?.y ?? 0.5,
          scale: config.placementOverride?.scale ?? 0.6,
        },
      });
      if (jobId) {
        setLastMockJobId(jobId);
        setGenerateError(null);
        showToast("Mockup generation started. It will appear when ready (usually 30–60 seconds).", "success");
        refetchJobs();
        mockupPollCancelledRef.current = false;
        const pollProduct = async (attempt = 0) => {
          if (mockupPollCancelledRef.current || attempt >= 24) return;
          await new Promise((r) => setTimeout(r, 5000));
          if (mockupPollCancelledRef.current) return;
          const updated = await refetchProduct();
          if (updated?.mockupUrl) {
            setLastMockJobId(null);
            return;
          }
          pollProduct(attempt + 1);
        };
        pollProduct();
      }
    } catch (err: any) {
      setGenerateError(err?.message || "Failed to start mockup generation");
    } finally {
      setMockupGenerating(false);
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
      
      {/* Header (spec: title ?? name, handle ?? slug) */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{product.title ?? product.name}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {(product.handle ?? product.slug) && (
            <span className="font-mono">/{(product.handle ?? product.slug)}</span>
          )}
          {" · "}
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
            {/* Section A — Merchandising (spec-aligned) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Merchandising</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                  <input
                    type="text"
                    value={merchandising.title}
                    onChange={(e) => setMerchandising((m) => ({ ...m, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Product title"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Handle (URL slug)</label>
                  <input
                    type="text"
                    value={merchandising.handle}
                    onChange={(e) => setMerchandising((m) => ({ ...m, handle: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                    placeholder="product-handle"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <textarea
                    value={merchandising.descriptionHtml}
                    onChange={(e) => setMerchandising((m) => ({ ...m, descriptionHtml: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Product description (HTML or plain text)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SEO Title</label>
                  <input
                    type="text"
                    value={merchandising.seoTitle}
                    onChange={(e) => setMerchandising((m) => ({ ...m, seoTitle: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="SEO title"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SEO Description</label>
                  <input
                    type="text"
                    value={merchandising.seoDescription}
                    onChange={(e) => setMerchandising((m) => ({ ...m, seoDescription: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="SEO meta description"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={merchandising.tagsStr}
                    onChange={(e) => setMerchandising((m) => ({ ...m, tagsStr: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="tag1, tag2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Collection keys (comma-separated)</label>
                  <input
                    type="text"
                    value={merchandising.collectionKeysStr}
                    onChange={(e) => setMerchandising((m) => ({ ...m, collectionKeysStr: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="mlb, giants"
                  />
                </div>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!product?.id || !db) return;
                    setSavingMerchandising(true);
                    try {
                      const productRef = doc(db, "rp_products", product.id);
                      await updateDoc(productRef, {
                        title: merchandising.title || null,
                        handle: merchandising.handle || null,
                        descriptionHtml: merchandising.descriptionHtml || null,
                        seo: {
                          title: merchandising.seoTitle || null,
                          description: merchandising.seoDescription || null,
                        },
                        tags: merchandising.tagsStr ? merchandising.tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [],
                        collectionKeys: merchandising.collectionKeysStr ? merchandising.collectionKeysStr.split(",").map((k) => k.trim()).filter(Boolean) : [],
                        updatedAt: new Date(),
                        updatedBy: product.updatedBy ?? "",
                      });
                      await refetchProduct();
                      showToast("Merchandising saved", "success");
                    } catch (err) {
                      console.error(err);
                      showToast("Failed to save merchandising", "error");
                    } finally {
                      setSavingMerchandising(false);
                    }
                  }}
                  disabled={savingMerchandising}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingMerchandising ? "Saving…" : "Save merchandising"}
                </button>
              </div>
            </div>

            {/* Section B — Render Setup (product.renderSetup: front and back configs; no renderSide) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Render Setup</h2>
              <p className="text-xs text-gray-500 mb-3">Set blank, design, and placement for each side. Renderer uses the config for the requested view.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Front */}
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Front</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Blank</label>
                      {effectiveFrontConfig.blankImageUrl ? (
                        <>
                          <div className="flex gap-2 items-center">
                            <img src={effectiveFrontConfig.blankImageUrl} alt="Front blank" className="w-12 h-12 object-contain bg-gray-100 rounded" />
                            <p className="text-sm truncate">{(blankForFallback || currentBlank)?.styleName ?? (blankForFallback || currentBlank)?.slug ?? "Blank"}</p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button type="button" onClick={() => setRenderSetupModal("blank_front")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300">Change</button>
                            <a href={effectiveFrontConfig.blankImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View full</a>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-amber-600">No blank. <button type="button" onClick={() => setRenderSetupModal("blank_front")} className="text-blue-600 underline">Pick blank</button></p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Design</label>
                      {designFrontUrl ? (
                        <>
                          <div className="flex gap-2 items-center">
                            <img src={designFrontUrl} alt="Front design" className="w-12 h-12 object-contain bg-gray-100 rounded" />
                            <p className="text-sm truncate">{designFront?.name ?? "Design"}</p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button type="button" onClick={() => setRenderSetupModal("design_front")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300">Change</button>
                            <button type="button" onClick={() => clearDesignForSide("front")} disabled={savingRenderSetup} className="text-xs px-2 py-1 text-amber-700 border border-amber-400 rounded hover:bg-amber-50">Remove design</button>
                            <a href={designFrontUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View full</a>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <p className="text-xs text-amber-600">No design.</p>
                          <button type="button" onClick={() => setRenderSetupModal("design_front")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Set design</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Placement</label>
                      <p className="text-sm font-mono text-gray-700">{effectiveFrontConfig.placementKey ?? "front_center"}</p>
                      {effectiveFrontConfig.blankImageUrl && designFrontUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setPlacementEdit({
                              x: effectiveFrontConfig.placementOverride?.x ?? 0.5,
                              y: effectiveFrontConfig.placementOverride?.y ?? 0.5,
                              scale: effectiveFrontConfig.placementOverride?.scale ?? 0.6,
                            });
                            setPlacementEditSide("front");
                            setRenderSetupModal("placement_front");
                          }}
                          disabled={savingRenderSetup}
                          className="mt-1 text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300"
                        >
                          Edit placement
                        </button>
                      )}
                    </div>
                    {effectiveFrontConfig.blankImageUrl && designFrontUrl && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Preview</label>
                        <div className="relative w-24 h-24 bg-gray-100 rounded overflow-hidden">
                          <img src={effectiveFrontConfig.blankImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                          <div className="absolute inset-0 flex items-center justify-center p-1">
                            <img src={designFrontUrl} alt="" className="max-w-full max-h-full object-contain" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Back */}
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Back</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Blank</label>
                      {effectiveBackConfig.blankImageUrl ? (
                        <>
                          <div className="flex gap-2 items-center">
                            <img src={effectiveBackConfig.blankImageUrl} alt="Back blank" className="w-12 h-12 object-contain bg-gray-100 rounded" />
                            <p className="text-sm truncate">{(blankForFallback || currentBlank)?.styleName ?? (blankForFallback || currentBlank)?.slug ?? "Blank"}</p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button type="button" onClick={() => setRenderSetupModal("blank_back")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300">Change</button>
                            <a href={effectiveBackConfig.blankImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View full</a>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-amber-600">No blank. <button type="button" onClick={() => setRenderSetupModal("blank_back")} className="text-blue-600 underline">Pick blank</button></p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Design</label>
                      {designBackUrl ? (
                        <>
                          <div className="flex gap-2 items-center">
                            <img src={designBackUrl} alt="Back design" className="w-12 h-12 object-contain bg-gray-100 rounded" />
                            <p className="text-sm truncate">{designBack?.name ?? "Design"}</p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button type="button" onClick={() => setRenderSetupModal("design_back")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300">Change</button>
                            <button type="button" onClick={() => clearDesignForSide("back")} disabled={savingRenderSetup} className="text-xs px-2 py-1 text-amber-700 border border-amber-400 rounded hover:bg-amber-50">Remove design</button>
                            <a href={designBackUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View full</a>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <p className="text-xs text-amber-600">No design.</p>
                          <button type="button" onClick={() => setRenderSetupModal("design_back")} disabled={savingRenderSetup} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Set design</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Placement</label>
                      <p className="text-sm font-mono text-gray-700">{effectiveBackConfig.placementKey ?? "back_center"}</p>
                      {effectiveBackConfig.blankImageUrl && designBackUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setPlacementEdit({
                              x: effectiveBackConfig.placementOverride?.x ?? 0.5,
                              y: effectiveBackConfig.placementOverride?.y ?? 0.5,
                              scale: effectiveBackConfig.placementOverride?.scale ?? 0.6,
                            });
                            setPlacementEditSide("back");
                            setRenderSetupModal("placement_back");
                          }}
                          disabled={savingRenderSetup}
                          className="mt-1 text-xs px-2 py-1 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300"
                        >
                          Edit placement
                        </button>
                      )}
                    </div>
                    {effectiveBackConfig.blankImageUrl && designBackUrl && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Preview</label>
                        <div className="relative w-24 h-24 bg-gray-100 rounded overflow-hidden">
                          <img src={effectiveBackConfig.blankImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                          <div className="absolute inset-0 flex items-center justify-center p-1">
                            <img src={designBackUrl} alt="" className="max-w-full max-h-full object-contain" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Section C — Product readiness (Shopify sync) */}
            {(() => {
              const hasFrontDesign = !!(designIdForFront);
              const hasBackDesign = !!(designIdForBack);
              const needsHeroBack = true; // require both heroes for sync
              const needsBackDesign = needsHeroBack && !!(product?.media?.heroBack);
              const checks: { label: string; ok: boolean; detail?: string }[] = [
                { label: "Title", ok: !!(product?.title?.trim()) },
                { label: "Handle", ok: !!(product?.handle?.trim()) },
                { label: "Hero front", ok: !!(product?.media?.heroFront) },
                { label: "Hero back", ok: !!(product?.media?.heroBack) },
                { label: "Blank", ok: !!(product?.blankId) },
                { label: "Design (front)", ok: hasFrontDesign, detail: hasFrontDesign ? undefined : "Set design in Render Setup" },
                { label: "Design (back)", ok: !needsBackDesign || hasBackDesign, detail: needsBackDesign && !hasBackDesign ? "Set design in Render Setup" : undefined },
                { label: "Print PDF front", ok: !hasFrontDesign || !!(product?.production?.printPdfFront) },
                { label: "Print PDF back", ok: !hasBackDesign || !!(product?.production?.printPdfBack) },
                { label: "Pricing (base)", ok: typeof product?.pricing?.basePrice === "number" && product.pricing.basePrice >= 0 },
                { label: "Weight", ok: typeof product?.shipping?.defaultWeightGrams === "number" && product.shipping.defaultWeightGrams >= 0 },
              ];
              const allOk = checks.every((c) => c.ok);
              return (
                <div className={`border rounded-lg p-4 ${allOk ? "border-green-300 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Product readiness</h2>
                  <p className="text-xs text-gray-500 mb-3">Checks required for Shopify sync. Fix missing items before syncing.</p>
                  <ul className="space-y-1.5">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-center gap-2 text-sm">
                        <span className={c.ok ? "text-green-600" : "text-amber-700"}>{c.ok ? "✓" : "✗"}</span>
                        <span className={c.ok ? "text-gray-700" : "text-amber-800"}>{c.label}</span>
                        {c.detail && <span className="text-xs text-gray-500">— {c.detail}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-3 text-sm font-medium ${allOk ? "text-green-700" : "text-amber-700"}`}>
                    {allOk ? "Ready for Shopify sync" : "Not ready — fix items above"}
                  </p>
                </div>
              );
            })()}

            {/* Section E — Production (spec-aligned) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Production</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Print PDF Front (URL)</label>
                  <input
                    type="text"
                    value={production.printPdfFront}
                    onChange={(e) => setProduction((p) => ({ ...p, printPdfFront: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Print PDF Back (URL)</label>
                  <input
                    type="text"
                    value={production.printPdfBack}
                    onChange={(e) => setProduction((p) => ({ ...p, printPdfBack: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Print colors (comma-separated)</label>
                  <input
                    type="text"
                    value={production.printColorsStr}
                    onChange={(e) => setProduction((p) => ({ ...p, printColorsStr: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Orange, Black"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Production notes</label>
                  <textarea
                    value={production.productionNotes}
                    onChange={(e) => setProduction((p) => ({ ...p, productionNotes: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Notes for printer"
                  />
                </div>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!product?.id || !db) return;
                    setSavingProduction(true);
                    try {
                      const productRef = doc(db, "rp_products", product.id);
                      await updateDoc(productRef, {
                        production: {
                          printPdfFront: production.printPdfFront || null,
                          printPdfBack: production.printPdfBack || null,
                          printColors: production.printColorsStr ? production.printColorsStr.split(",").map((c) => c.trim()).filter(Boolean) : [],
                          productionNotes: production.productionNotes || null,
                        },
                        updatedAt: new Date(),
                        updatedBy: product.updatedBy ?? "",
                      });
                      await refetchProduct();
                      showToast("Production saved", "success");
                    } catch (err) {
                      console.error(err);
                      showToast("Failed to save production", "error");
                    } finally {
                      setSavingProduction(false);
                    }
                  }}
                  disabled={savingProduction}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingProduction ? "Saving…" : "Save production"}
                </button>
              </div>
            </div>

            {/* Section F — Shopify (read-only until sync implemented) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Shopify</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">Sync status</dt>
                  <dd className="font-medium">{product.shopify?.status ?? "not_synced"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Shopify product ID</dt>
                  <dd className="font-mono text-gray-700">{product.shopify?.productId ?? "—"}</dd>
                </div>
                {product.shopify?.lastSyncAt && (
                  <div>
                    <dt className="text-gray-500">Last sync</dt>
                    <dd>
                      {typeof (product.shopify.lastSyncAt as { toDate?: () => Date })?.toDate === "function"
                        ? (product.shopify.lastSyncAt as { toDate: () => Date }).toDate().toLocaleString()
                        : product.shopify.lastSyncAt instanceof Date
                        ? product.shopify.lastSyncAt.toLocaleString()
                        : String(product.shopify.lastSyncAt)}
                    </dd>
                  </div>
                )}
                {product.shopify?.lastSyncError && (
                  <div className="md:col-span-2">
                    <dt className="text-gray-500">Last sync error</dt>
                    <dd className="text-red-600 text-xs mt-1">{product.shopify.lastSyncError}</dd>
                  </div>
                )}
              </dl>
              {product.shopify?.productId && (
                <a
                  href={
                    process.env.NEXT_PUBLIC_SHOPIFY_STORE
                      ? `https://admin.shopify.com/store/${process.env.NEXT_PUBLIC_SHOPIFY_STORE}/products/${product.shopify.productId}`
                      : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 text-sm text-blue-600 hover:underline"
                >
                  Open in Shopify →
                </a>
              )}
              <p className="text-xs text-gray-500 mt-2">Push to Shopify and Publish will be available after sync is implemented.</p>
            </div>

            {/* Section C — Media (hero slots; assign in Assets tab) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Media</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">Hero front</div>
                  {product.media?.heroFront ? (
                    <img src={product.media.heroFront} alt="Hero front" className="max-w-full h-32 object-contain border border-gray-200 rounded" />
                  ) : (
                    <p className="text-sm text-gray-500">Not set. Use Assets tab to set as hero front.</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">Hero back</div>
                  {product.media?.heroBack ? (
                    <img src={product.media.heroBack} alt="Hero back" className="max-w-full h-32 object-contain border border-gray-200 rounded" />
                  ) : (
                    <p className="text-sm text-gray-500">Not set. Use Assets tab to set as hero back.</p>
                  )}
                </div>
              </div>
              {(!product.media?.heroFront || !product.media?.heroBack) && (
                <p className="text-xs text-gray-500 mt-2">Blank + design mockup can be used as hero; assign in the Assets tab when available.</p>
              )}
            </div>

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
            onSetHeroSlot={
              product?.id && db
                ? (() => {
                    const firestore = db;
                    const productId = product.id;
                    return async (assetId: string, url: string, slot: "hero_front" | "hero_back") => {
                      const productRef = doc(firestore, "rp_products", productId);
                      const key = slot === "hero_front" ? "heroFront" : "heroBack";
                      await updateDoc(productRef, {
                        media: {
                          ...product.media,
                          [key]: url,
                        },
                        updatedAt: new Date(),
                        updatedBy: product.updatedBy ?? "",
                      });
                      await refetchProduct();
                      const assetRef = doc(firestore, "rp_product_assets", assetId);
                      await updateDoc(assetRef, { heroSlot: slot, updatedAt: new Date() });
                      refetchAssets();
                    };
                  })()
                : undefined
            }
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
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Generate Assets</h2>
              <p className="text-sm text-gray-500 mb-4">
                Two-stage pipeline: create product images first (Stage 1), then model images (Stage 2).
              </p>

              {/* Product Images vs Model Images tabs */}
              <div className="flex border-b border-gray-200 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setGenerateMode("product");
                    setSelectedPresetId("");
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    generateMode === "product"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Product Images
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGenerateMode("model");
                    setSelectedPresetId("");
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    generateMode === "model"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Model Images
                </button>
              </div>

              {generateError && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm mb-4">
                  {generateError}
                </div>
              )}

              {/* Stage 1: Product Images */}
              {generateMode === "product" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Stage 1: Generate product-only images (no model). Uses blank + design + placement + realism. Best for catalog, Shopify, Etsy.
                  </p>
                  {(!(designIdForFront || product?.designId) || !product?.blankId) && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm">
                      This product was not created from Design + Blank. Use <strong>Products → Create from Design + Blank</strong> first so it has a design and blank.
                    </div>
                  )}

                  {/* Render Setup: choose view to generate; config comes from product.renderSetup.front/back */}
                  {(designIdForFront || product?.designId) && product?.blankId && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">Render Setup</h3>
                      <p className="text-xs text-gray-500">Choose which view to generate. Config is from Overview → Render Setup (front/back).</p>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Generate for view</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="generateView"
                              checked={generateView === "front"}
                              onChange={() => setGenerateView("front")}
                              className="rounded border-gray-300"
                            />
                            <span>Front</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="generateView"
                              checked={generateView === "back"}
                              onChange={() => setGenerateView("back")}
                              className="rounded border-gray-300"
                            />
                            <span>Back</span>
                          </label>
                        </div>
                      </div>

                      {(() => {
                        const config = generateView === "front" ? effectiveFrontConfig : effectiveBackConfig;
                        const blankUrl = config.blankImageUrl;
                        const designUrl = config.designAssetUrl;
                        const designForView = generateView === "front" ? designFront : designBack;
                        return (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="border border-gray-200 rounded-lg p-3">
                                <div className="text-sm font-medium text-gray-700 mb-2">Blank — {generateView}</div>
                                {blankLoading ? (
                                  <p className="text-xs text-gray-500">Loading…</p>
                                ) : blankUrl ? (
                                  <>
                                    <div className="flex gap-3 items-start">
                                      <img src={blankUrl} alt="Blank" className="w-16 h-16 object-contain bg-gray-100 rounded" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-gray-900 truncate">{(blankForFallback || currentBlank)?.styleName ?? (blankForFallback || currentBlank)?.slug ?? "Blank"}</p>
                                        <p className="text-xs text-gray-500">{(blankForFallback || currentBlank)?.garmentCategory ?? ""}</p>
                                      </div>
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setRenderSetupModal(generateView === "front" ? "blank_front" : "blank_back")}
                                        disabled={savingRenderSetup}
                                        className="text-xs font-medium px-3 py-1.5 text-gray-700 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300"
                                      >
                                        Change Blank
                                      </button>
                                      <a href={blankUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium px-3 py-1.5 text-gray-700 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300">
                                        View Full Image
                                      </a>
                                    </div>
                                  </>
                                ) : (
                                  <p className="text-xs text-amber-600">Set blank for {generateView} in Overview → Render Setup.</p>
                                )}
                              </div>

                              <div className="border border-gray-200 rounded-lg p-3">
                                <div className="text-sm font-medium text-gray-700 mb-2">Design — {generateView}</div>
                                {(generateView === "front" ? designFrontLoading : designBackLoading) ? (
                                  <p className="text-xs text-gray-500">Loading…</p>
                                ) : designUrl ? (
                                  <>
                                    <div className="flex gap-3 items-start">
                                      <img src={designUrl} alt="Design" className="w-16 h-16 object-contain bg-gray-100 rounded" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-gray-900 truncate">{designForView?.name ?? "Design"}</p>
                                      </div>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setRenderSetupModal(generateView === "front" ? "design_front" : "design_back")}
                                        disabled={savingRenderSetup}
                                        className="text-xs font-medium px-3 py-1.5 text-gray-700 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300"
                                      >
                                        Change design
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => clearDesignForSide(generateView)}
                                        disabled={savingRenderSetup}
                                        className="text-xs font-medium px-3 py-1.5 text-amber-700 border border-amber-400 rounded hover:bg-amber-50"
                                      >
                                        Remove design
                                      </button>
                                      <a href={designUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium px-3 py-1.5 text-gray-700 bg-gray-200 border border-gray-400 rounded hover:bg-gray-300 inline-block">
                                        View Full Image
                                      </a>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <p className="text-xs text-amber-600">No design for {generateView}.</p>
                                    <button
                                      type="button"
                                      onClick={() => setRenderSetupModal(generateView === "front" ? "design_front" : "design_back")}
                                      disabled={savingRenderSetup}
                                      className="text-sm font-medium px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                      Set design
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {blankUrl && designUrl && (
                              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                <div className="text-sm font-medium text-gray-700 mb-1">Placement — {generateView}</div>
                                <p className="text-xs text-gray-500 mb-2">
                                  Adjust in Overview → Render Setup, or here:
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPlacementEdit({
                                      x: config.placementOverride?.x ?? 0.5,
                                      y: config.placementOverride?.y ?? 0.5,
                                      scale: config.placementOverride?.scale ?? 0.6,
                                    });
                                    setPlacementEditSide(generateView);
                                    setRenderSetupModal(generateView === "front" ? "placement_front" : "placement_back");
                                  }}
                                  className="text-sm font-medium px-3 py-1.5 text-gray-700 bg-gray-200 border border-gray-400 rounded-lg hover:bg-gray-300"
                                >
                                  Edit placement
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {(designIdForFront || product?.designId) && product?.blankId && !product?.mockupUrl && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm space-y-2">
                      <p>Generate a mockup first — this is your <strong>master composite</strong> (blank + design). You can review it here, then use it for product scene images (hangar, flat lay, etc.).</p>
                      <p className="text-amber-700 font-medium">Uses <strong>{generateView}</strong> view from Render Setup above.</p>
                      {lastMockJobId && mockJob?.status === "processing" && (
                        <p className="text-amber-800 font-medium">Creating mockup… (usually 30–60 seconds). Check Firebase Console → Functions logs if it takes longer.</p>
                      )}
                      {lastMockJobId && mockJob?.status === "failed" && (
                        <p className="text-red-700 font-medium">Mockup job failed. See error above. Fix the issue (e.g. blank/design URLs, Storage permissions) and try again.</p>
                      )}
                      <button
                        type="button"
                        onClick={handleGenerateMockup}
                        disabled={mockupGenerating || !(generateView === "front" ? effectiveFrontConfig.blankImageUrl : effectiveBackConfig.blankImageUrl) || !(generateView === "front" ? effectiveFrontConfig.designAssetUrl : effectiveBackConfig.designAssetUrl)}
                        className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50"
                      >
                        {mockupGenerating ? "Starting…" : "Generate mockup"}
                      </button>
                    </div>
                  )}
                  {(designIdForFront || product?.designId) && product?.blankId && product?.mockupUrl && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <p className="text-gray-600">
                        Using <strong>{generateView}</strong> view for new mockups. Switch view above if needed, then regenerate.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateMockup}
                        disabled={mockupGenerating || !(generateView === "front" ? effectiveFrontConfig.blankImageUrl : effectiveBackConfig.blankImageUrl) || !(generateView === "front" ? effectiveFrontConfig.designAssetUrl : effectiveBackConfig.designAssetUrl)}
                        className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 border border-gray-400 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                      >
                        {mockupGenerating ? "Regenerating…" : "Regenerate mockup"}
                      </button>
                    </div>
                  )}

                  {/* Master composite: show mockup so user can review before generating product images */}
                  {product?.mockupUrl && (() => {
                    // Cache-bust so regenerated mockup (same URL, new file) loads instead of browser cache
                    const u = product.updatedAt as { toMillis?: () => number; seconds?: number; _seconds?: number } | undefined;
                    const t = u?.toMillis?.() ?? u?.seconds ?? (u as { _seconds?: number })?._seconds ?? (typeof u === "number" ? u : "");
                    const mockupDisplayUrl = `${product.mockupUrl}${t ? `?t=${t}` : ""}`;
                    const imgKey = `mockup-${product.id}-${t || ""}`;
                    return (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Master composite — review before generating</h3>
                      <p className="text-xs text-gray-600 mb-3">
                        This is the mockup (blank + design) that product images are based on. If the side or placement is wrong, use Render Setup and &quot;Regenerate mockup&quot; above, then generate product images again.
                      </p>
                      <div className="flex flex-wrap items-start gap-4">
                        <button
                          type="button"
                          onClick={() => setLightboxImage(mockupDisplayUrl)}
                          className="rounded-lg overflow-hidden border-2 border-gray-300 hover:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <img
                            key={imgKey}
                            src={mockupDisplayUrl}
                            alt="Master composite mockup"
                            className="w-48 h-48 object-contain bg-gray-50"
                          />
                        </button>
                        <div className="flex flex-col gap-2">
                          <a
                            href={mockupDisplayUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline"
                          >
                            Open full size
                          </a>
                          <p className="text-xs text-gray-500">Click the thumbnail to open in lightbox.</p>
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {product?.mockupUrl && (
                    <form onSubmit={handleGenerate} className="space-y-4">
                      <input type="hidden" name="generationType" value="product_only" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Scene Preset *</label>
                        <select
                          value={selectedPresetId}
                          onChange={(e) => setSelectedPresetId(e.target.value)}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value="">Select preset...</option>
                          {allPresets
                            .filter((p) => {
                              const mode = ("mode" in p && p.mode) || (p.supportedModes?.includes("product_only") ? "productOnly" : "onModel");
                              return mode === "productOnly";
                            })
                            .map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.name}</option>
                            ))}
                        </select>
                        {allPresets.filter((p) => ("mode" in p && p.mode === "productOnly") || p.supportedModes?.includes("product_only")).length === 0 && (
                          <p className="text-xs text-amber-600 mt-1">No product-only presets. Add one in Firestore (e.g. Ecommerce Flat) with mode: &quot;productOnly&quot;.</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Image Count</label>
                          <input
                            type="number"
                            min={1}
                            max={8}
                            value={imageCount}
                            onChange={(e) => setImageCount(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Image Size</label>
                          <select
                            value={imageSize}
                            onChange={(e) => setImageSize(e.target.value as "square" | "portrait" | "landscape")}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                          >
                            <option value="square">Square</option>
                            <option value="portrait">Portrait</option>
                            <option value="landscape">Landscape</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        Product images will match the master composite above (same view and design). Confirm it looks correct before generating.
                      </p>
                      <button
                        type="submit"
                        disabled={generating || !selectedPresetId || allPresets.filter((p) => ("mode" in p && p.mode === "productOnly") || p.supportedModes?.includes("product_only")).length === 0}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                      >
                        {generating ? "Generating…" : `Generate ${imageCount} product image${imageCount > 1 ? "s" : ""}`}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Stage 2: Model Images */}
              {generateMode === "model" && (
                <>
                  {!product?.mockupUrl && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm mb-4">
                      <strong>Generate product images first.</strong> This product has no mockup — model images use the mockup as the product reference. Switch to <strong>Product Images</strong> and generate a mockup, or run &quot;Generate mockup&quot; if the product has a design + blank.
                    </div>
                  )}
                  <form onSubmit={handleGenerate} className="space-y-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Scene Preset *
                        </label>
                        <select
                          value={selectedPresetId}
                          onChange={(e) => setSelectedPresetId(e.target.value)}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">Select preset...</option>
                          {allPresets
                            .filter((p) => {
                              const mode = ("mode" in p && p.mode) || (p.supportedModes?.includes("product_only") ? "productOnly" : "onModel");
                              return mode === "onModel";
                            })
                            .map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.name}</option>
                            ))}
                        </select>
                        {selectedPreset && (
                          <p className="text-xs text-gray-500 mt-1">
                            Generates images of a selected identity wearing the product in the chosen scene.
                          </p>
                        )}
                      </div>

                      {/* Identity selector - only for model */}
                  {selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && (
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

                {/* Artifact selectors - model mode always uses on-model presets */}
                {selectedPreset && ("allowFaceArtifact" in selectedPreset ? selectedPreset.allowFaceArtifact !== false : true) && (
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
                  disabled={
                    generating ||
                    !product?.mockupUrl ||
                    !selectedPresetId ||
                    (selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && !selectedIdentityId)
                  }
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {generating ? "Generating..." : `Generate ${imageCount} Image${imageCount > 1 ? "s" : ""}`}
                </button>
              </form>
                </>
              )}

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

        {/* Render Setup modals — shared so they work from Overview or Generate tab */}
        {(renderSetupModal === "placement_front" || renderSetupModal === "placement_back") && (
          <Modal
            isOpen
            onClose={() => setRenderSetupModal(null)}
            title={`Edit placement — ${placementEditSide}`}
            size="large"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Adjust where and how large the design appears on the blank. This placement is used as the default for all renders (mockup, hangar, model).
              </p>
              <div className="relative w-full max-w-lg aspect-square mx-auto bg-gray-200 rounded overflow-hidden" style={{ maxHeight: 360 }}>
                <img
                  src={(placementEditSide === "front" ? effectiveFrontConfig : effectiveBackConfig).blankImageUrl ?? ""}
                  alt="Blank"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/20 flex items-center justify-center"
                  style={{
                    left: `${(placementEdit.x * 100) - (placementEdit.scale * 25)}%`,
                    top: `${(placementEdit.y * 100) - (placementEdit.scale * 25)}%`,
                    width: `${placementEdit.scale * 50}%`,
                    height: `${placementEdit.scale * 50}%`,
                    minWidth: 24,
                    minHeight: 24,
                  }}
                >
                  <img
                    src={(placementEditSide === "front" ? effectiveFrontConfig : effectiveBackConfig).designAssetUrl ?? ""}
                    alt="Design"
                    className="max-w-full max-h-full object-contain pointer-events-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Design size (scale) — {(placementEdit.scale * 100).toFixed(0)}%</label>
                  <input
                    type="range"
                    min={0.3}
                    max={1.2}
                    step={0.05}
                    value={placementEdit.scale}
                    onChange={(e) => setPlacementEdit((p) => ({ ...p, scale: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded accent-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Horizontal position — {(placementEdit.x * 100).toFixed(0)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={placementEdit.x}
                    onChange={(e) => setPlacementEdit((p) => ({ ...p, x: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded accent-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Vertical position — {(placementEdit.y * 100).toFixed(0)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={placementEdit.y}
                    onChange={(e) => setPlacementEdit((p) => ({ ...p, y: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded accent-blue-600"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setRenderSetupModal(null)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await persistRenderSetupSide(placementEditSide, {
                      placementOverride: { x: placementEdit.x, y: placementEdit.y, scale: placementEdit.scale },
                      placementKey: placementEditSide === "front" ? "front_center" : "back_center",
                    });
                    setRenderSetupModal(null);
                  }}
                  disabled={savingRenderSetup}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingRenderSetup ? "Saving…" : "Save placement"}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {(renderSetupModal === "blank_front" || renderSetupModal === "blank_back") && (() => {
          const side = renderSetupModal === "blank_front" ? "front" : "back";
          return (
            <Modal
              isOpen
              onClose={() => setRenderSetupModal(null)}
              title={`Change blank — ${side}`}
            >
              <div className="space-y-2 max-h-96 overflow-y-auto">
                <p className="text-sm text-gray-600">Blanks with a <strong>{side}</strong> image:</p>
                {allBlanks
                  .filter((b) => (b.images?.[side] as { downloadUrl?: string } | null)?.downloadUrl)
                  .map((b) => {
                    const url = (b.images?.[side] as { downloadUrl?: string })?.downloadUrl;
                    const bid = (b as { blankId: string }).blankId;
                    const isSelected = (side === "front" ? effectiveFrontConfig.blankImageUrl : effectiveBackConfig.blankImageUrl) === url && blankIdForFallback === bid;
                    return (
                      <button
                        key={bid}
                        type="button"
                        onClick={async () => {
                          if (!url) return;
                          await persistBlankForSide(side, bid, url);
                          setRenderSetupModal(null);
                        }}
                        disabled={savingRenderSetup}
                        className={`w-full flex gap-3 items-center p-2 rounded border text-left ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}
                      >
                        {url && <img src={url} alt="" className="w-12 h-12 object-contain bg-gray-100 rounded" />}
                        <div>
                          <p className="text-sm font-medium">{(b as { styleName?: string }).styleName ?? (b as { slug?: string }).slug}</p>
                          <p className="text-xs text-gray-500">{(b as { garmentCategory?: string }).garmentCategory} · View: {side}</p>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </Modal>
          );
        })()}

        {(renderSetupModal === "design_front" || renderSetupModal === "design_back") && (
          <Modal
            isOpen
            onClose={() => setRenderSetupModal(null)}
            title={renderSetupModal === "design_front" ? "Set design — Front" : "Set design — Back"}
          >
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <p className="text-sm text-gray-600">Choose a design for the <strong>{renderSetupModal === "design_front" ? "front" : "back"}</strong>.</p>
              {(allDesigns ?? []).map((d) => {
                const pngUrl = (d.files as { png?: { downloadUrl?: string } } | undefined)?.png?.downloadUrl;
                const side = renderSetupModal === "design_front" ? "front" : "back";
                const isSelected = (side === "front" ? designIdForFront : designIdForBack) === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={async () => {
                      if (!pngUrl) return;
                      await persistDesignForSide(side, d.id, pngUrl);
                      setRenderSetupModal(null);
                    }}
                    disabled={savingRenderSetup || !pngUrl}
                    className={`w-full flex gap-3 items-center p-2 rounded border text-left ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}
                  >
                    {pngUrl && <img src={pngUrl} alt="" className="w-12 h-12 object-contain bg-gray-100 rounded" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.name ?? d.id}</p>
                      {!pngUrl && <p className="text-xs text-amber-600">No PNG</p>}
                    </div>
                  </button>
                );
              })}
              {(allDesigns ?? []).length === 0 && <p className="text-sm text-gray-500">No designs. Add designs in Design Library.</p>}
            </div>
          </Modal>
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
