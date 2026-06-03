"use client";

import { useState, useEffect, useRef, useMemo, useCallback, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import ProtectedRoute from "@/components/ProtectedRoute";
import SceneGallerySection from "@/components/scenes/SceneGallerySection";
import type { RPSceneSourceSlot, RPVariantSceneRender } from "@/lib/types/firestore";
import { useAuth } from "@/lib/providers/AuthProvider";
import { useProductBySlug, useProducts } from "@/lib/hooks/useRPProducts";
import { getRelatedProducts } from "@/lib/products/relatedProducts";
import { useProductDesigns } from "@/lib/hooks/useRPProductDesigns";
import { useProductAssets } from "@/lib/hooks/useRPProductAssets";
import { useGenerationJobs } from "@/lib/hooks/useRPGenerationJobs";
import { useScenePresets } from "@/lib/hooks/useRPScenePresets";
import {
  useEnqueueProductModelRealism,
  useEnqueueProductModelRealismBatch,
  useGenerateProductAssets,
  useGenerateProductFlatRenders,
  useGenerateProductSceneRender,
  useCreateSceneRenderJob,
  useUpdateSceneAssetApproval,
  useRefreshProductMerchandisingFromSources,
  useRetryVariant8394Assets,
  useBulkProductOps,
} from "@/lib/hooks/useRPProductMutations";
import { useCreateMockJob, useWatchMockJob } from "@/lib/hooks/useMockAssets";
import { useProductFailedMockJobsByVariant } from "@/lib/hooks/useProductMockJobFailures";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useLoraArtifacts } from "@/lib/hooks/useLoraArtifacts";
import { useDesignBriefs } from "@/lib/hooks/useDesignBriefs";
import { useDesignConcepts } from "@/lib/hooks/useDesignConcepts";
import { useCreateProductDesign, useCreateDesignFromConcept, useCreateDesignBrief } from "@/lib/hooks/useDesignMutations";
import { useDesign, useDesigns } from "@/lib/hooks/useDesignAssets";
import { useBlank, useBlanks } from "@/lib/hooks/useBlanks";
import {
  get8394EngineQaMetrics,
  get8394PreviewVsOfficialBlendParity,
  getEffectiveColorFamily,
  getVariantById,
  inferDefaultPrintSides,
} from "@/lib/blanks";
import { designSupportsGarmentSide, getDesignPreviewUrl } from "@/lib/designs/designHelpers";
import {
  computeProductFlatRenderFingerprintAsync,
  getBackBlendForFlatRender,
  getBackPlacementRowForFlatRender,
  getVariantBackImageUrl,
  isFlatRenderSlotStale,
  isProductInFlatRenderMvpScope,
  pickDesignPngUrlForVariant,
} from "@/lib/products/flatRenderFingerprint";
import { useInspirations } from "@/lib/hooks/useInspirations";
import { useAttachInspirationToProduct, useAttachInspirationToBrief } from "@/lib/hooks/useInspirationMutations";
import { useAssetCollections } from "@/lib/hooks/useAssetCollections";
import {
  useTaxonomySports,
  useTaxonomyLeagues,
  useTaxonomyEntities,
  useTaxonomyThemes,
  useTaxonomyDesignFamilies,
} from "@/lib/hooks/useTaxonomy";
import { validateTaxonomyClassification } from "@/lib/taxonomy/validateTaxonomy";
import { resolveTaxonomyEntity } from "@/lib/taxonomy/resolveTaxonomyEntity";
import { enrichTaxonomyAndTagsForSave } from "@/lib/taxonomy/enrichProductTaxonomyForTags";
import { buildProductTagsFromRpProduct, tagsNormalizedFromTags } from "@/lib/products/buildProductTags";
import Modal from "@/components/Modal";
import {
  FlatRender8394LastRunQaPanel,
  type FlatRender8394VariantQaSnapshot,
  type LastFlatRender8394Payload,
} from "@/components/products/FlatRender8394LastRunQaPanel";
import { RenderTargetTuningQaSummary } from "@/components/products/RenderTargetTuningQaSummary";
import {
  RpPrintMethod,
  RpDesignPlacement,
  RpInkColor,
  RpProduct,
  RpDesignConcept,
  RpDesignBrief,
  RpConceptStatus,
  type DesignDoc,
  type RPBlank,
  type RPBlankGarmentSizeCode,
  type RpGenerationType,
  type RpScenePreset,
  type RpProductFlatRendersMvp,
  type RpProductAsset,
  type RpProductAssetBatch,
  type RpProductVariantFulfillmentPackage,
  type RpRenderTarget,
} from "@/lib/types/firestore";

function formatFirestoreTimestamp(ts: unknown): string {
  if (!ts || typeof ts !== "object") return "—";
  const t = ts as { toDate?: () => Date };
  if (typeof t.toDate === "function") {
    try {
      return t.toDate().toLocaleString();
    } catch {
      return "—";
    }
  }
  return "—";
}
import {
  getPlacementFingerprintSliceForRenderTarget,
  hasProductPlacementOverride,
  resolveEffectivePlacement,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
} from "@/lib/products/resolveProductRenderProfile";
import { HANGER_CREWNECK_SCENE_TEMPLATE } from "@/lib/scenes/sceneTemplates";
import { pickFlatBlendedUrlForScene } from "@/lib/scenes/sceneRenderHelpers";
import { isProductReadyForShopify } from "@/lib/shopify/isProductReadyForShopify";
import {
  checkBackOnly8394OfficialFlatInvariants,
  explainStorefrontPrimarySelection8394,
  mergeInheritedMediaForReadiness8394,
  resolvePrimaryVariantImage8394ForShopify,
  trimMediaUrl,
  type ProductPrintSidesForCommerce,
} from "@/lib/shopify/variantShopifyMedia";
import { build8394StorefrontOfficialDriftProof } from "@/lib/products/proof8394StorefrontOfficial";
import {
  filterBackOnly8394StorefrontGalleryUrls,
  isBackOnlyPrintSides8394,
} from "@/lib/shopify/backOnly8394Storefront";
import {
  orderedGalleryAssetUrlsForVariant,
  sortRpProductAssetsForGallery,
} from "@/lib/shopify/galleryAssetOrdering";
import { buildShopifyTags } from "@/lib/shopify/buildShopifyTags";
import { formatCmyk, resolveRpInkColorsWithStandard } from "@/lib/print/standardPrintInks";
import {
  FALLBACK_SCENE_PRESET_IDS,
  DEFAULT_SCENE_RENDER_KEY,
  IMPLEMENTED_SCENE_RENDER_KEYS,
} from "@/lib/generation/generationDefaultsConfig";
import {
  getVariant8394ReadinessState,
  isProductFullyCatalogReady8394,
  isProductStorefrontReady8394,
  isVariantBaseComplete8394,
  type ProductPrintSidesLike,
} from "@/lib/products/variantReadiness";
import { buildProductReadinessRecipe } from "@/lib/products/productReadinessRecipe";
import {
  buildResolvedSavedBlankProfileDebugRow,
  compareResolvedProfileToRecipeProvenance,
  applyOfficialComposeGuardsToDebugRow,
} from "@/lib/products/resolveSavedBlankProfileDebug";
import {
  build8394PreviewStillUrlsFromPlan,
  generationKeyForOfficialRole,
  resolveBlankProductImagePlan,
  variantHasGenerationKeyOutput8394,
} from "@/lib/products/blankProductImagePlan";
import { Variant8394ReadinessBadge } from "@/components/products/Variant8394ReadinessBadge";
import {
  resolveProductGeneration,
  inferGenerationTypeFromPreset,
} from "@/lib/generation/resolveProductGeneration";
import { useDesignTeam } from "@/lib/hooks/useDesignTeam";
import ResolvedGenerationSummary from "@/components/products/ResolvedGenerationSummary";
import Official8394EnqueuePresetReadout from "@/components/products/Official8394EnqueuePresetReadout";

/**
 * Parent row for multi-color products. Some docs omit `productKind` but have variantCount / variantSummary.
 */
function isParentProductRow(
  p: Pick<RpProduct, "productKind" | "variantCount" | "variantSummary"> | null | undefined
): boolean {
  if (!p) return false;
  if (p.productKind === "parent") return true;
  const pk = String(p.productKind ?? "")
    .trim()
    .toLowerCase();
  if (pk === "parent") return true;
  if ((p.variantCount ?? 0) > 0) return true;
  if (p.variantSummary && p.variantSummary.length > 0) return true;
  return false;
}

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
                <div className="flex flex-wrap gap-1.5">
                  {resolveRpInkColorsWithStandard(design.inkColors).map((ink: RpInkColor, idx: number) => (
                    <span
                      key={idx}
                      className="inline-flex flex-col gap-0.5 px-2 py-1 text-xs rounded border border-gray-200 bg-white max-w-[9.5rem]"
                    >
                      <span className="inline-flex items-center gap-1 font-medium text-gray-800">
                        {ink.hex ? (
                          <span
                            className="w-3 h-3 rounded-full border border-gray-300 shrink-0"
                            style={{ backgroundColor: ink.hex }}
                          />
                        ) : null}
                        <span className="truncate">{ink.name}</span>
                      </span>
                      {ink.hex ? <span className="font-mono text-[10px] text-gray-600">{ink.hex}</span> : null}
                      {ink.cmyk ? (
                        <span className="font-mono text-[9px] text-gray-500 leading-tight">{formatCmyk(ink.cmyk)}</span>
                      ) : null}
                    </span>
                  ))}
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
  type ProductVariantRow = {
    id: string;
    colorName?: string | null;
    blankVariantId?: string | null;
    mockupUrl?: string | null;
    sku?: string | null;
    status?: string | null;
    renderSetup?: RpProduct["renderSetup"];
    optionValues?: { color?: string | null; size?: string | null } | null;
    media?: { heroFront?: string | null; heroBack?: string | null } | null;
    flatRenders?: RpProductFlatRendersMvp | null;
    sceneTemplateRenders?: Record<string, import("@/lib/types/firestore").RpProductVariantSceneRender> | null;
    assetPipeline?: import("@/lib/types/firestore").RpVariantAssetPipeline8394 | null;
    variant8394NextRetryAt?: unknown;
    fulfillmentPackage?: RpProductVariantFulfillmentPackage | null;
    inheritsMediaFromVariantId?: string | null;
    generatedRenderOutputs?: import("@/lib/types/firestore").RpVariantGeneratedRenderOutput[] | null;
  };

  const params = useParams();
  const router = useRouter();
  const slug = (params?.slug as string) || "";
  const [activeTab, setActiveTab] = useState<
    "product" | "images" | "generate" | "shopifyPreview" | "order" | "metrics"
  >("product");
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mockupPollCancelledRef = useRef(false);
  const [experimentId, setExperimentId] = useState("");
  const [variantId, setVariantId] = useState("");
  /** Images tab: which color variant we’re focused on (parent products). */
  const [imagesTabVariantId, setImagesTabVariantId] = useState<string>("");
  /** Bumps to re-run variant subcollection fetch after mock/flat writes (parent products). */
  const [variantReloadTick, setVariantReloadTick] = useState(0);
  /** Ops/dev: which render target to show in Saved blank profile debug panel. */
  const [savedProfileDebugTarget, setSavedProfileDebugTarget] = useState<RpRenderTarget>("flat_back");
  /** Ops/dev: official render target for persisted recipeProvenance compare (Images tab variant = color). */
  const [officialRecipeCompareTarget, setOfficialRecipeCompareTarget] = useState<RpRenderTarget>("flat_back");
  // Two-stage pipeline: Product Images (Stage 1) vs Model Images (Stage 2)
  const [generateMode, setGenerateMode] = useState<"product" | "model">("product");

  const { product, loading: productLoading, error: productError, refetch: refetchProduct } = useProductBySlug(slug);
  const productRef = useRef(product);
  productRef.current = product;
  const imagesTabVariantIdRef = useRef(imagesTabVariantId);
  imagesTabVariantIdRef.current = imagesTabVariantId;

  const [productVariants, setProductVariants] = useState<ProductVariantRow[]>([]);
  const [productVariantsLoading, setProductVariantsLoading] = useState(false);
  /** Raw `variants` subcollection doc count from `getDocs` (before variantSummary fallback merge). */
  const [variantSubcollectionDocCount, setVariantSubcollectionDocCount] = useState<number | null>(null);
  const [variantSubdocSampleIds, setVariantSubdocSampleIds] = useState<string[]>([]);
  /** Live `rp_product_asset_batches/{assetsBatchId}` for ops proof (plan vs batch vs variant outputs). */
  const [assetBatchLive, setAssetBatchLive] = useState<RpProductAssetBatch | null>(null);

  const { adminUser } = useAuth();
  const showProductVariantDebugPanel =
    process.env.NODE_ENV === "development" ||
    adminUser?.role === "admin" ||
    adminUser?.role === "ops";

  const treatsAsParentProduct = useMemo(() => isParentProductRow(product), [
    product?.id,
    product?.productKind,
    product?.variantCount,
    product?.variantSummary,
  ]);

  useEffect(() => {
    if (productError) {
      console.error("[ProductDetailContent] Error loading product:", productError);
    }
  }, [productError]);

  useEffect(() => {
    if (!db || !product?.assetsBatchId) {
      setAssetBatchLive(null);
      return;
    }
    const batchId = String(product.assetsBatchId).trim();
    if (!batchId) {
      setAssetBatchLive(null);
      return;
    }
    const ref = doc(db, "rp_product_asset_batches", batchId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setAssetBatchLive(null);
          return;
        }
        setAssetBatchLive({ id: snap.id, ...(snap.data() as RpProductAssetBatch) });
      },
      () => setAssetBatchLive(null)
    );
    return () => unsub();
  }, [product?.assetsBatchId]);

  useEffect(() => {
    if (!product) return;
    console.info("[ProductDetail][variants-debug] render snapshot", {
      routeSlug: slug,
      parentDocId: product.id,
      productKind: product.productKind,
      treatsAsParentProduct,
      variantCountField: product.variantCount,
      variantSummaryLen: product.variantSummary?.length ?? 0,
      productVariantsLoading,
      effectiveVariantsUiLen: productVariants.length,
      imagesTabVariantId: imagesTabVariantId || null,
    });
  }, [
    slug,
    product?.id,
    product?.productKind,
    product?.variantCount,
    product?.variantSummary,
    treatsAsParentProduct,
    productVariantsLoading,
    productVariants.length,
    imagesTabVariantId,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db || !product?.id || !treatsAsParentProduct) {
        if (!cancelled) {
          setProductVariants([]);
          setVariantSubcollectionDocCount(null);
          setVariantSubdocSampleIds([]);
          setProductVariantsLoading(false);
        }
        if (product?.id && !treatsAsParentProduct) {
          console.info("[ProductDetail][variants-debug] skip subcollection load", {
            parentDocId: product.id,
            productKind: product.productKind,
            variantCount: product.variantCount,
            variantSummaryLen: product.variantSummary?.length ?? 0,
            reason: "not classified as parent (check productKind vs variantCount/variantSummary)",
          });
        }
        return;
      }
      const parentId = product.id;
      const variantsPath = `rp_products/${parentId}/variants`;
      setProductVariantsLoading(true);
      try {
        const snap = await getDocs(collection(db, "rp_products", parentId, "variants"));
        let rows: ProductVariantRow[] = snap.docs
          .map((d) => {
            const v = d.data() as {
              colorName?: string | null;
              blankVariantId?: string | null;
              mockupUrl?: string | null;
              sku?: string | null;
              status?: string | null;
              optionValues?: { color?: string | null; size?: string | null } | null;
              media?: { heroFront?: string | null; heroBack?: string | null } | null;
              flatRenders?: RpProductFlatRendersMvp | null;
              sceneTemplateRenders?: Record<string, import("@/lib/types/firestore").RpProductVariantSceneRender> | null;
              assetPipeline?: import("@/lib/types/firestore").RpVariantAssetPipeline8394 | null;
              variant8394NextRetryAt?: unknown;
              fulfillmentPackage?: RpProductVariantFulfillmentPackage | null;
            };
            return {
              id: d.id,
              colorName: v.colorName ?? null,
              blankVariantId: v.blankVariantId ?? null,
              mockupUrl: v.mockupUrl ?? null,
              sku: v.sku ?? null,
              status: v.status ?? null,
              optionValues: v.optionValues ?? null,
              media: v.media ?? null,
              flatRenders: v.flatRenders ?? null,
              sceneTemplateRenders: v.sceneTemplateRenders ?? null,
              assetPipeline: v.assetPipeline ?? null,
              variant8394NextRetryAt: v.variant8394NextRetryAt,
              fulfillmentPackage: v.fulfillmentPackage ?? null,
            } as ProductVariantRow;
          })
          .sort((a, b) =>
            String(a.colorName || "").localeCompare(String(b.colorName || ""), undefined, { sensitivity: "base" })
          );

        if (rows.length === 0 && product.variantSummary && product.variantSummary.length > 0) {
          rows = product.variantSummary.map((s) => ({
            id: s.variantId,
            colorName: s.colorName ?? null,
            blankVariantId: s.blankVariantId ?? null,
            mockupUrl: null,
            media: null,
            sku: null,
            status: "active",
            optionValues: {
              color: s.colorName ?? null,
              size: s.sizeCode ?? product.availableSizes?.[0] ?? null,
            },
          }));
        }

        const distinctBv = [...new Set(rows.map((r) => r.blankVariantId).filter(Boolean))];
        console.info("[ProductDetail][variants-debug] subcollection result", {
          parentDocId: parentId,
          queriedPath: variantsPath,
          subcollectionDocCount: snap.docs.length,
          variantCountField: product.variantCount,
          variantSummaryLen: product.variantSummary?.length ?? 0,
          effectiveRowCountAfterMerge: rows.length,
        });
        console.info(
          "[PRODUCT_IMAGES:READ]",
          JSON.stringify({
            productId: parentId,
            routeSlug: slug,
            treatsAsParentProduct,
            variantDocsFound: snap.docs.length,
            distinctBlankVariantIds: distinctBv,
            firstFewVariantDocs: snap.docs.slice(0, 8).map((d) => {
              const v = d.data() as { blankVariantId?: string | null; optionValues?: { size?: string | null } };
              return {
                docId: d.id,
                blankVariantId: v.blankVariantId ?? null,
                size: v.optionValues?.size ?? null,
              };
            }),
          })
        );

        if (!cancelled) {
          setVariantSubcollectionDocCount(snap.docs.length);
          setVariantSubdocSampleIds(snap.docs.slice(0, 5).map((d) => d.id));
          setProductVariants(rows);
        }
      } catch (err) {
        console.error("[ProductDetail] Failed to load variants:", err);
        const fallback =
          product.variantSummary?.map((s) => ({
            id: s.variantId,
            colorName: s.colorName ?? null,
            blankVariantId: s.blankVariantId ?? null,
            mockupUrl: null,
            media: null,
            sku: null,
            status: "active",
            optionValues: {
              color: s.colorName ?? null,
              size: s.sizeCode ?? product.availableSizes?.[0] ?? null,
            },
          })) ?? [];
        if (!cancelled) {
          setVariantSubcollectionDocCount(null);
          setVariantSubdocSampleIds([]);
          setProductVariants(fallback);
        }
      } finally {
        if (!cancelled) setProductVariantsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product?.id, treatsAsParentProduct, product?.variantCount, product?.variantSummary, variantReloadTick]);

  useEffect(() => {
    if (!treatsAsParentProduct || !product) {
      setImagesTabVariantId("");
      return;
    }
    const def = product.defaultVariantId || "";
    setImagesTabVariantId((prev) => {
      if (prev && productVariants.some((v) => v.id === prev)) return prev;
      if (def && productVariants.some((v) => v.id === def)) return def;
      return productVariants[0]?.id || "";
    });
  }, [product?.id, treatsAsParentProduct, product?.defaultVariantId, productVariants]);

  const shopifyPreviewVariantDoc = useMemo(
    () => productVariants.find((v) => v.id === imagesTabVariantId),
    [productVariants, imagesTabVariantId]
  );

  /**
   * Variant has any storefront-relevant image (mockup, heroes, or 8394 flat package).
   * Must align with `shopifyPreviewGalleryUrls` so we do not show “no images” when flats exist but heroes are unset.
   */
  const hasMockupForGenerateUi = useMemo(() => {
    if (!product) return false;
    if (treatsAsParentProduct) {
      const v = shopifyPreviewVariantDoc;
      return !!(
        v?.mockupUrl ||
        v?.media?.heroFront ||
        v?.media?.heroBack ||
        v?.flatRenders?.flat_blended?.back?.url ||
        v?.flatRenders?.flat_clean?.front?.url
      );
    }
    return !!(
      product.mockupUrl ||
      product.flatRenders?.flat_blended?.back?.url ||
      product.flatRenders?.flat_clean?.front?.url
    );
  }, [product, shopifyPreviewVariantDoc, treatsAsParentProduct]);

  /** URL for “master composite” preview: variant row for parents, else parent.mockupUrl. */
  const masterCompositeMockupUrl = useMemo(() => {
    if (!product) return null;
    if (treatsAsParentProduct && shopifyPreviewVariantDoc) {
      const v = shopifyPreviewVariantDoc;
      return (
        v.mockupUrl ||
        v.media?.heroBack ||
        v.media?.heroFront ||
        v.flatRenders?.flat_blended?.back?.url ||
        v.flatRenders?.flat_clean?.front?.url ||
        null
      );
    }
    return (
      product.mockupUrl ||
      product.flatRenders?.flat_blended?.back?.url ||
      product.flatRenders?.flat_clean?.front?.url ||
      null
    );
  }, [product, shopifyPreviewVariantDoc, treatsAsParentProduct]);

  /** Default/hero variant row: Shopify readiness checks parent.media, but mocks write heroes to the variant doc */
  const shopifyReadinessVariantDoc = useMemo(() => {
    if (!treatsAsParentProduct || productVariants.length === 0) return null;
    const hid = product?.heroVariantId || product?.defaultVariantId;
    if (hid) return productVariants.find((v) => v.id === hid) ?? null;
    return productVariants[0] ?? null;
  }, [treatsAsParentProduct, product?.heroVariantId, product?.defaultVariantId, productVariants]);

  const shopifyReadinessMediaFallback = useMemo(() => {
    if (!shopifyReadinessVariantDoc) return undefined;
    return {
      heroFront: shopifyReadinessVariantDoc.media?.heroFront ?? null,
      heroBack: shopifyReadinessVariantDoc.media?.heroBack ?? null,
      mockupUrl: shopifyReadinessVariantDoc.mockupUrl ?? null,
    };
  }, [shopifyReadinessVariantDoc]);

  /** Strict matrix checks for parent products (aligned with `onShopifySyncJobCreated`). */
  const shopifyActiveVariantsInput = useMemo(() => {
    if (!treatsAsParentProduct) return undefined;
    return productVariants.map((v) => ({
      id: v.id,
      sku: v.sku,
      status: v.status,
      optionValues: {
        color: v.optionValues?.color ?? v.colorName,
        size: v.optionValues?.size,
      },
      media: v.media,
      mockupUrl: v.mockupUrl,
      flatRenders: v.flatRenders,
      inheritsMediaFromVariantId: v.inheritsMediaFromVariantId ?? null,
      generatedRenderOutputs: v.generatedRenderOutputs ?? null,
    }));
  }, [treatsAsParentProduct, productVariants]);

  const { assets, loading: assetsLoading, refetch: refetchAssets } = useProductAssets(
    product?.id ? { productId: product.id, productSlug: product.slug } : null
  );
  const { blank: currentBlank, loading: blankLoading } = useBlank(product?.blankId);
  const sortedGalleryAssets = useMemo(
    () => sortRpProductAssetsForGallery(assets as RpProductAsset[]),
    [assets]
  );

  const shopifyPreviewGalleryUrls = useMemo(() => {
    if (!product) return [] as string[];
    const backFirst = String(product.blankStyleCode || "").trim() === "8394";
    const printSides = (product.fulfillmentSummary?.printSides ?? undefined) as ProductPrintSidesForCommerce | undefined;
    const out: string[] = [];
    const add = (u?: string | null) => {
      if (u && typeof u === "string" && u.trim() && !out.includes(u.trim())) out.push(u.trim());
    };

    const appendSceneExtras = () => {
      const sceneExtras = orderedGalleryAssetUrlsForVariant(
        assets as RpProductAsset[],
        imagesTabVariantId || undefined,
        treatsAsParentProduct,
        "storefront"
      );
      for (const u of sceneExtras) add(u);
    };

    const urlsFromVariant = (row: ProductVariantRow | null | undefined): string[] => {
      if (!row) return [];
      const acc: string[] = [];
      const push = (u?: string | null) => {
        if (u && typeof u === "string" && u.trim() && !acc.includes(u.trim())) acc.push(u.trim());
      };
      const m = row.media || {};
      const fr = row.flatRenders;
      const hasHeroSlot = !!(m.heroBack || m.heroFront);
      if (backFirst) {
        push(m.heroBack);
        push(m.heroFront);
      } else {
        push(m.heroFront);
        push(m.heroBack);
      }
      // mockupUrl is usually the same back composite as heroBack; including it adds a duplicate third thumbnail.
      if (!hasHeroSlot) {
        push(row.mockupUrl);
      }
      // Same source as 8394 readiness / scene pipeline: variant-native flats (deduped with heroes).
      if (backFirst) {
        push(fr?.flat_blended?.back?.url);
        push(fr?.flat_clean?.front?.url);
      } else {
        push(fr?.flat_clean?.front?.url);
        push(fr?.flat_blended?.back?.url);
      }
      return acc;
    };

    const appendParentFallback = () => {
      add(product.displayMedia?.heroUrl);
      add(product.displayMedia?.thumbUrl);
      add(product.media?.heroFront);
      add(product.media?.heroBack);
      add(product.mockupUrl);
    };

    if (treatsAsParentProduct && productVariants.length > 0) {
      // Only the selected variant row — never substitute hero/default/first variant images or parent
      // displayMedia when the selection has no URLs yet (that showed another color’s mock in Shopify preview).
      const row = shopifyPreviewVariantDoc;
      if (row) {
        const planStills =
          backFirst && currentBlank && row.blankVariantId
            ? build8394PreviewStillUrlsFromPlan({
                backFirst,
                row,
                blank: currentBlank,
                blankVariant: getVariantById(currentBlank, row.blankVariantId) ?? null,
              })
            : null;
        if (planStills && planStills.length) {
          for (const u of planStills) add(u);
        } else {
          for (const u of urlsFromVariant(row)) add(u);
        }
      }
      appendSceneExtras();
      if (out.length === 0 && !imagesTabVariantId) {
        appendParentFallback();
      }
      if (backFirst && isBackOnlyPrintSides8394(printSides)) {
        return filterBackOnly8394StorefrontGalleryUrls(shopifyPreviewVariantDoc ?? null, printSides, out);
      }
      return out;
    }

    appendParentFallback();
    appendSceneExtras();
    if (backFirst && isBackOnlyPrintSides8394(printSides)) {
      return filterBackOnly8394StorefrontGalleryUrls(null, printSides, out);
    }
    return out;
  }, [
    product,
    treatsAsParentProduct,
    productVariants,
    shopifyPreviewVariantDoc,
    product?.heroVariantId,
    product?.defaultVariantId,
    product?.fulfillmentSummary,
    assets,
    imagesTabVariantId,
    currentBlank,
  ]);

  const { designs, loading: designsLoading, refetch: refetchDesigns } = useProductDesigns(
    product?.id ? { productId: product.id } : null
  );
  const { jobs, loading: jobsLoading, refetch: refetchJobs } = useGenerationJobs(
    product?.id ? { productId: product.id, limit: 10 } : undefined
  );
  const { products: candidateProducts } = useProducts({ status: "active", limit: 100 });
  const relatedProducts = useMemo(() => {
    if (!product || !candidateProducts.length) return [];
    return getRelatedProducts(product, candidateProducts, 8);
  }, [product, candidateProducts]);

  /** Bootstrap presets when Firestore query fails — IDs from `lib/generation/generationDefaultsConfig`. */
  const hardcodedPresets = [
    {
      id: FALLBACK_SCENE_PRESET_IDS.productOnly,
      name: "Ecommerce White (fallback)",
      sceneType: "ecommerce",
      mode: "productOnly" as const,
      supportedModes: ["product_only", "on_model"] as RpGenerationType[],
    },
    {
      id: FALLBACK_SCENE_PRESET_IDS.onModel,
      name: "Studio Editorial (fallback)",
      sceneType: "studio",
      mode: "onModel" as const,
      supportedModes: ["on_model"] as RpGenerationType[],
    },
    {
      id: FALLBACK_SCENE_PRESET_IDS.lifestyleOnModel,
      name: "Lifestyle Outdoor (fallback)",
      sceneType: "lifestyle",
      mode: "onModel" as const,
      supportedModes: ["on_model"] as RpGenerationType[],
    },
  ] as unknown as RpScenePreset[];
  const { presets: fetchedPresets, loading: presetsLoading } = useScenePresets({ isActive: true });
  
  // Generate form state
  const [generating, setGenerating] = useState(false);
  const [generatingFlatRenders, setGeneratingFlatRenders] = useState(false);
  /** Last `renderSelectionLog` from `generateProductFlatRenders` (8394 QA). */
  const [lastFlatRenderSelectionLog, setLastFlatRenderSelectionLog] = useState<string[] | null>(null);
  /** Last callable `urls` + `renderTypes` for 8394 ordered-output QA. */
  const [lastFlatRender8394Payload, setLastFlatRender8394Payload] = useState<LastFlatRender8394Payload | null>(null);
  const [generatingSceneRender, setGeneratingSceneRender] = useState(false);
  const [flatRenderFingerprint, setFlatRenderFingerprint] = useState<string | null>(null);
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
  const allPresets: RpScenePreset[] = fetchedPresets.length > 0 ? fetchedPresets : hardcodedPresets;
  
  // Get selected preset to determine mode
  const selectedPreset = allPresets.find(p => p.id === selectedPresetId);
  const supportedModes = selectedPreset?.supportedModes as RpGenerationType[] | undefined;
  const presetMode =
    (selectedPreset && "mode" in selectedPreset && selectedPreset.mode) ||
    (supportedModes?.includes("product_only") ? "productOnly" : "onModel");
  const isProductOnly = presetMode === "productOnly";
  const isOnModel = presetMode === "onModel";
  
  // Derive generationType from preset mode (for backward compatibility with function)
  const generationType = isProductOnly ? "product_only" : "on_model";
  const { generateProductAssets } = useGenerateProductAssets();
  const { generateProductFlatRenders } = useGenerateProductFlatRenders();
  const { enqueueProductModelRealism } = useEnqueueProductModelRealism();
  const { enqueueProductModelRealismBatch } = useEnqueueProductModelRealismBatch();
  /**
   * Phase 3e fan-out state. Tracks all jobs spawned by the batch button so we
   * can show aggregate progress (X / Y rendered) and a per-job status grid.
   * Job ids are also pushed into `modelRealismJobs` so the per-color buttons
   * stay in sync (avoid double-firing).
   */
  const [batchState, setBatchState] = useState<{
    inFlight: boolean;
    jobs: { jobId: string; productVariantId: string; view: "front" | "back"; status: string; error?: string | null }[];
    skipped: { productVariantId: string; view: "front" | "back"; reason: string }[];
    error: string | null;
  }>({ inFlight: false, jobs: [], skipped: [], error: null });
  const batchUnsubsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    return () => {
      for (const u of Object.values(batchUnsubsRef.current)) {
        try { u(); } catch { /* ignore */ }
      }
      batchUnsubsRef.current = {};
    };
  }, []);
  const handleEnqueueModelRealismBatch = useCallback(
    async (sides: ("front" | "back")[] = ["front", "back"]) => {
      if (!product?.id) return;
      setBatchState((s) => ({ ...s, inFlight: true, error: null }));
      try {
        const out = await enqueueProductModelRealismBatch({ productId: product.id, sides });
        setBatchState({
          inFlight: false,
          jobs: out.jobs.map((j) => ({
            jobId: j.jobId,
            productVariantId: j.productVariantId,
            view: j.view,
            status: "queued",
          })),
          skipped: out.skipped,
          error: null,
        });
        /** Mirror into per-color state so per-color buttons reflect in-flight jobs. */
        setModelRealismJobs((prev) => {
          const next = { ...prev };
          for (const j of out.jobs) {
            next[j.productVariantId] = {
              ...next[j.productVariantId],
              [j.view]: { jobId: j.jobId, status: "queued", error: null },
            };
          }
          return next;
        });
        /** Subscribe to every job doc; aggregate counters update as they complete. */
        if (db) {
          for (const j of out.jobs) {
            const subKey = `batch:${j.jobId}`;
            const prev = batchUnsubsRef.current[subKey];
            if (prev) { try { prev(); } catch { /* ignore */ } }
            const unsub = onSnapshot(
              doc(db, "rp_blank_preview_jobs", j.jobId),
              (snap) => {
                if (!snap.exists()) return;
                const jd = snap.data() as { status?: string; error?: string | null };
                setBatchState((cur) => ({
                  ...cur,
                  jobs: cur.jobs.map((x) =>
                    x.jobId === j.jobId
                      ? { ...x, status: jd.status || x.status, error: jd.error ?? null }
                      : x
                  ),
                }));
                setModelRealismJobs((prev) => ({
                  ...prev,
                  [j.productVariantId]: {
                    ...prev[j.productVariantId],
                    [j.view]: { jobId: j.jobId, status: jd.status || "queued", error: jd.error ?? null },
                  },
                }));
                if (jd.status === "completed" || jd.status === "failed") {
                  const u = batchUnsubsRef.current[subKey];
                  if (u) { try { u(); } catch { /* ignore */ } delete batchUnsubsRef.current[subKey]; }
                }
              }
            );
            batchUnsubsRef.current[subKey] = unsub;
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setBatchState({ inFlight: false, jobs: [], skipped: [], error: msg });
      }
    },
    [product?.id, enqueueProductModelRealismBatch]
  );
  /**
   * Per-color model-realism state: which job is in flight for which side, and
   * the latest doc snapshot for progress display. Map key is the product
   * variant id (so a Heather Grey job doesn't show progress on Pink).
   */
  const [modelRealismJobs, setModelRealismJobs] = useState<
    Record<string, { front?: { jobId: string; status: string; error?: string | null }; back?: { jobId: string; status: string; error?: string | null } }>
  >({});
  const modelRealismJobUnsubsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    return () => {
      /** Tear down any active subscriptions on unmount. */
      for (const unsub of Object.values(modelRealismJobUnsubsRef.current)) {
        try { unsub(); } catch { /* ignore */ }
      }
      modelRealismJobUnsubsRef.current = {};
    };
  }, []);
  /**
   * Kick off a model-realism render. Phase 3 callable creates a job doc, the
   * Phase 2 trigger drains it, and on Stage B completion the Phase 3b binding
   * branch writes the URL onto `variant.flatRenders[model_<view>_designed]`.
   */
  const handleEnqueueModelRealism = useCallback(
    async (productVariantId: string, blankVariantId: string, view: "front" | "back") => {
      if (!product?.id) return;
      try {
        const out = await enqueueProductModelRealism({
          productId: product.id,
          blankVariantId,
          view,
        });
        setModelRealismJobs((prev) => ({
          ...prev,
          [productVariantId]: {
            ...prev[productVariantId],
            [view]: { jobId: out.jobId, status: "queued", error: null },
          },
        }));
        /** Subscribe to the job doc and surface status as it progresses. */
        if (db) {
          const subKey = `${productVariantId}:${view}`;
          const prev = modelRealismJobUnsubsRef.current[subKey];
          if (prev) { try { prev(); } catch { /* ignore */ } }
          const unsub = onSnapshot(
            doc(db, "rp_blank_preview_jobs", out.jobId),
            (snap) => {
              if (!snap.exists()) return;
              const job = snap.data() as { status?: string; error?: string | null };
              setModelRealismJobs((cur) => ({
                ...cur,
                [productVariantId]: {
                  ...cur[productVariantId],
                  [view]: { jobId: out.jobId, status: job.status || "queued", error: job.error ?? null },
                },
              }));
              if (job.status === "completed" || job.status === "failed") {
                /** Done; release the listener so React Firestore doesn't keep one open per render. */
                const u = modelRealismJobUnsubsRef.current[subKey];
                if (u) { try { u(); } catch { /* ignore */ } delete modelRealismJobUnsubsRef.current[subKey]; }
              }
            }
          );
          modelRealismJobUnsubsRef.current[subKey] = unsub;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setModelRealismJobs((prev) => ({
          ...prev,
          [productVariantId]: {
            ...prev[productVariantId],
            [view]: { jobId: "", status: "failed", error: msg },
          },
        }));
      }
    },
    [product?.id, enqueueProductModelRealism]
  );
  useEffect(() => {
    setLastFlatRenderSelectionLog(null);
    setLastFlatRender8394Payload(null);
  }, [product?.id]);
  const { retryVariant8394Assets } = useRetryVariant8394Assets();
  const { retryOfficialProductAssets } = useBulkProductOps();
  const [retrying8394Assets, setRetrying8394Assets] = useState(false);
  const [retryingOfficialAssets, setRetryingOfficialAssets] = useState(false);
  const [queueingNeutralHangerScene, setQueueingNeutralHangerScene] = useState(false);
  const [queueingBackdropNeutralScene, setQueueingBackdropNeutralScene] = useState(false);
  const [queueingFlatlayWoodScene, setQueueingFlatlayWoodScene] = useState(false);
  const [queueingFlatlayBoutiqueScene, setQueueingFlatlayBoutiqueScene] = useState(false);
  const [queueingBodyModelScene, setQueueingBodyModelScene] = useState(false);
  const sceneQueueBusy =
    queueingNeutralHangerScene ||
    queueingBackdropNeutralScene ||
    queueingFlatlayWoodScene ||
    queueingFlatlayBoutiqueScene ||
    queueingBodyModelScene;
  const { generateProductSceneRender } = useGenerateProductSceneRender();
  const { createSceneRenderJob } = useCreateSceneRenderJob();
  const { updateSceneAssetApproval } = useUpdateSceneAssetApproval();
  const { refreshProductMerchandisingFromSources } = useRefreshProductMerchandisingFromSources();
  const { createJob: createMockJob } = useCreateMockJob();
  const [lastMockJobId, setLastMockJobId] = useState<string | null>(null);
  const { job: mockJob } = useWatchMockJob(lastMockJobId);
  const failedMockByVariant = useProductFailedMockJobsByVariant(
    treatsAsParentProduct ? product?.id ?? null : null
  );
  const { packs } = useModelPacks();

  // Render Setup: explicit blank/design/side (part of product definition)
  const designIdForFront = product?.designIdFront ?? product?.designId ?? null;
  /** Same design doc as front when product only has `designId` (e.g. Design + Blank). */
  const designIdForBack = product?.designIdBack ?? product?.designId ?? null;
  const { design: designFront, isLoading: designFrontLoading } = useDesign(designIdForFront);
  const { design: designBack, isLoading: designBackLoading } = useDesign(designIdForBack);
  const flatRenderDesignId =
    (product?.designIdBack && product.designIdBack.trim()) || product?.designId || null;
  const { design: designForFlatRender, isLoading: designFlatLoading } = useDesign(flatRenderDesignId);

  const { team: designTeam, loading: designTeamLoading } = useDesignTeam(product?.teamId ?? undefined);
  const resolved = useMemo(
    () => resolveProductGeneration({ blank: currentBlank ?? null, team: designTeam, design: designFront ?? null }),
    [currentBlank, designTeam, designFront]
  );

  const resolvedSceneRenderKey = useMemo(
    () => resolved.sceneRenderKey.value ?? DEFAULT_SCENE_RENDER_KEY,
    [resolved.sceneRenderKey.value]
  );
  const sceneCompositeImplemented = IMPLEMENTED_SCENE_RENDER_KEYS.has(resolvedSceneRenderKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!product || !currentBlank || !product.blankVariantId || !designForFlatRender) {
        if (!cancelled) setFlatRenderFingerprint(null);
        return;
      }
      const v = getVariantById(currentBlank, product.blankVariantId);
      if (!v) {
        if (!cancelled) setFlatRenderFingerprint(null);
        return;
      }
      try {
        const fp = await computeProductFlatRenderFingerprintAsync({
          blank: currentBlank,
          variant: v,
          design: designForFlatRender,
          product,
        });
        if (!cancelled) setFlatRenderFingerprint(fp);
      } catch {
        if (!cancelled) setFlatRenderFingerprint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product, currentBlank, designForFlatRender]);

  /** Step 10 tuning: only show flat-render tooling when this product uses the 8394 master blank. */
  const is8394ProductContext = useMemo(
    () =>
      !blankLoading &&
      !!product?.blankId &&
      !!currentBlank &&
      String(currentBlank.styleCode || "").trim() === "8394",
    [blankLoading, product?.blankId, currentBlank]
  );

  const show8394VariantReadinessUi =
    treatsAsParentProduct && is8394ProductContext && productVariants.length > 0;

  const heroOrDefaultVariantId = product?.heroVariantId || product?.defaultVariantId || null;

  const readinessRecipe = useMemo(() => {
    if (!is8394ProductContext || !currentBlank || !designForFlatRender) return null;
    return buildProductReadinessRecipe(currentBlank, designForFlatRender);
  }, [is8394ProductContext, currentBlank, designForFlatRender]);

  const fulfillmentPrintSides =
    (readinessRecipe?.printSides as ProductPrintSidesLike | undefined) ??
    (product?.fulfillmentSummary?.printSides as ProductPrintSidesLike | undefined);

  const resolvedColorLineCountFor8394Ui = useMemo(() => {
    return (
      product?.colorVariantCount ??
      (product?.variantSummary?.length
        ? new Set(product.variantSummary.map((s) => s.blankVariantId).filter(Boolean)).size
        : treatsAsParentProduct
          ? new Set(productVariants.map((v) => v.blankVariantId).filter(Boolean)).size
          : null)
    );
  }, [product?.colorVariantCount, product?.variantSummary, treatsAsParentProduct, productVariants]);

  const storefrontReady8394 = useMemo(
    () => isProductStorefrontReady8394(heroOrDefaultVariantId, productVariants, fulfillmentPrintSides),
    [heroOrDefaultVariantId, productVariants, fulfillmentPrintSides]
  );
  const catalogReady8394 = useMemo(
    () => isProductFullyCatalogReady8394(productVariants, fulfillmentPrintSides),
    [productVariants, fulfillmentPrintSides]
  );

  const readinessStateForVariant = useCallback(
    (v: ProductVariantRow) => {
      const matrixOpts = {
        variantMatrix: productVariants,
        blankVariantRowForPlan:
          currentBlank && v.blankVariantId ? getVariantById(currentBlank, v.blankVariantId) ?? null : null,
      };
      const failedMsg =
        failedMockByVariant[v.id] && !isVariantBaseComplete8394(v, fulfillmentPrintSides, matrixOpts)
          ? failedMockByVariant[v.id]
          : null;
      return getVariant8394ReadinessState(v, {
        failedMessage: failedMsg,
        printSides: fulfillmentPrintSides,
        variantMatrix: productVariants,
        blankVariantRowForPlan: matrixOpts.blankVariantRowForPlan,
      });
    },
    [failedMockByVariant, fulfillmentPrintSides, productVariants, currentBlank]
  );

  const savedBlankProfileDebugRow = useMemo(() => {
    if (!showProductVariantDebugPanel || !is8394ProductContext || !currentBlank || !designForFlatRender || !product) {
      return null;
    }
    const bv =
      (treatsAsParentProduct && shopifyPreviewVariantDoc?.blankVariantId) || product.blankVariantId || null;
    if (!bv) return null;
    return buildResolvedSavedBlankProfileDebugRow({
      blank: currentBlank,
      blankVariantId: bv,
      design: designForFlatRender,
      product,
      renderTarget: savedProfileDebugTarget,
    });
  }, [
    showProductVariantDebugPanel,
    is8394ProductContext,
    currentBlank,
    designForFlatRender,
    product,
    treatsAsParentProduct,
    shopifyPreviewVariantDoc?.blankVariantId,
    product?.blankVariantId,
    savedProfileDebugTarget,
  ]);

  /** Variant row for recipe provenance panel: Images tab color for parent products; first variant otherwise. */
  const recipeDebugVariantRow = useMemo(() => {
    if (treatsAsParentProduct) return shopifyPreviewVariantDoc ?? null;
    return productVariants[0] ?? null;
  }, [treatsAsParentProduct, shopifyPreviewVariantDoc, productVariants]);

  /** Blank row + batch doc: same plan as preview / official enqueue / readiness gates. */
  const blankDrivenImagePlanOpsProof = useMemo(() => {
    if (!showProductVariantDebugPanel || !is8394ProductContext || !currentBlank || !recipeDebugVariantRow?.blankVariantId) {
      return null;
    }
    const bvId = String(recipeDebugVariantRow.blankVariantId).trim();
    if (!bvId) return null;
    const blankRow = getVariantById(currentBlank, bvId);
    if (!blankRow) return null;
    const resolved = resolveBlankProductImagePlan(currentBlank, blankRow);
    const vRow = recipeDebugVariantRow;
    const missingLaunch = resolved.requiredLaunchOfficialRoles.filter((r) => {
      const k = generationKeyForOfficialRole(r);
      return !!(k && !variantHasGenerationKeyOutput8394(vRow, k));
    });
    const missingShopify = (resolved.requiredShopifyOfficialRoles ?? []).filter((r) => {
      const k = generationKeyForOfficialRole(r);
      return !!(k && !variantHasGenerationKeyOutput8394(vRow, k));
    });
    const batch = assetBatchLive;
    const colorBlock = batch?.colors?.[bvId];
    const batchRoleKeys = colorBlock?.roles ? Object.keys(colorBlock.roles).sort() : [];
    const snap = colorBlock?.officialPlan;

    const eqStrArr = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    const sameRoleKeySet = (keys: string[], ordered: readonly string[]) =>
      keys.length === ordered.length && [...keys].sort().join("\0") === [...ordered].sort().join("\0");
    const shopSnapVsResolved = (): boolean => {
      if (snap?.requiredShopifyOfficialRoles == null && resolved.requiredShopifyOfficialRoles == null) return true;
      if (snap?.requiredShopifyOfficialRoles == null || resolved.requiredShopifyOfficialRoles == null) return false;
      return eqStrArr(snap.requiredShopifyOfficialRoles, resolved.requiredShopifyOfficialRoles);
    };

    let planParityStatus: "match" | "fallback" | "mismatch" = "fallback";
    if (!batch || !colorBlock || !snap) {
      planParityStatus = "fallback";
    } else if (
      eqStrArr(snap.enabledOfficialRolesOrdered, resolved.enabledOfficialRolesOrdered) &&
      eqStrArr(snap.requiredLaunchOfficialRoles, resolved.requiredLaunchOfficialRoles) &&
      eqStrArr(snap.galleryOrderOfficialRoles, resolved.galleryOrderOfficialRoles) &&
      shopSnapVsResolved() &&
      sameRoleKeySet(Object.keys(colorBlock.roles || {}), resolved.enabledOfficialRolesOrdered)
    ) {
      planParityStatus = "match";
    } else {
      planParityStatus = "mismatch";
    }

    return {
      blankVariantId: bvId,
      planParityStatus,
      resolvedBlankProductImagePlan: resolved,
      officialAssetBatchPlannedTargets: batchRoleKeys,
      batchOfficialPlanSnapshot: colorBlock?.officialPlan ?? null,
      missingRequiredForLaunch: missingLaunch,
      missingRequiredForShopify: missingShopify,
      finalGalleryOrder: resolved.galleryOrderOfficialRoles,
      assetsBatchId: product?.assetsBatchId ?? null,
      batchStatus: batch?.status ?? null,
      previewStillUrlsOrder: build8394PreviewStillUrlsFromPlan({
        backFirst: true,
        row: vRow,
        blank: currentBlank,
        blankVariant: blankRow,
      }),
      storefrontPrimaryExplain: explainStorefrontPrimarySelection8394(
        recipeDebugVariantRow,
        fulfillmentPrintSides as ProductPrintSidesForCommerce | undefined
      ),
      flatBackComposeBytesProof:
        (
          vRow.flatRenders?.flat_blended?.back?.recipeProvenance as
            | { composeBytesProof?: unknown }
            | null
            | undefined
        )?.composeBytesProof ?? null,
    };
  }, [
    showProductVariantDebugPanel,
    is8394ProductContext,
    currentBlank,
    recipeDebugVariantRow,
    assetBatchLive,
    product?.assetsBatchId,
    fulfillmentPrintSides,
  ]);

  const recipeProvenanceResolvedRow = useMemo(() => {
    if (!showProductVariantDebugPanel || !is8394ProductContext || !currentBlank || !designForFlatRender || !product) {
      return null;
    }
    const bv =
      (recipeDebugVariantRow?.blankVariantId && String(recipeDebugVariantRow.blankVariantId).trim()) ||
      product.blankVariantId ||
      null;
    if (!bv) return null;
    const row = buildResolvedSavedBlankProfileDebugRow({
      blank: currentBlank,
      blankVariantId: bv,
      design: designForFlatRender,
      product,
      renderTarget: officialRecipeCompareTarget,
    });
    return applyOfficialComposeGuardsToDebugRow(row, officialRecipeCompareTarget);
  }, [
    showProductVariantDebugPanel,
    is8394ProductContext,
    currentBlank,
    designForFlatRender,
    product,
    recipeDebugVariantRow?.blankVariantId,
    product?.blankVariantId,
    officialRecipeCompareTarget,
  ]);

  const recipeProvenancePersisted = useMemo(() => {
    const v = recipeDebugVariantRow;
    if (!v) return { genProvenance: null, flatProvenance: null };
    const rt = officialRecipeCompareTarget;
    const role =
      rt === "flat_front"
        ? "flat_front"
        : rt === "flat_back"
          ? "flat_back"
          : rt === "model_front"
            ? "model_front"
            : "model_back";
    const genEntry = v.generatedRenderOutputs?.find((o) => o.role === role) ?? null;
    const flatSlot =
      rt === "flat_back"
        ? (v.flatRenders?.flat_blended?.back ?? null)
        : rt === "flat_front"
          ? (v.flatRenders?.flat_clean?.front ?? null)
          : rt === "model_back"
            ? (v.flatRenders?.model_blended?.back ?? null)
            : (v.flatRenders?.model_clean?.front ?? null);
    return {
      genProvenance: genEntry?.recipeProvenance ?? null,
      flatProvenance: flatSlot?.recipeProvenance ?? null,
    };
  }, [recipeDebugVariantRow, officialRecipeCompareTarget]);

  const recipeProvenanceMatch = useMemo(() => {
    const resolved = recipeProvenanceResolvedRow;
    const { genProvenance, flatProvenance } = recipeProvenancePersisted;
    if (!resolved) return null;
    const mGen = compareResolvedProfileToRecipeProvenance(resolved, genProvenance);
    const mFlat = compareResolvedProfileToRecipeProvenance(resolved, flatProvenance);
    const hasG = !!genProvenance;
    const hasF = !!flatProvenance;
    let match = false;
    if (hasG && hasF) match = mGen.match && mFlat.match;
    else if (hasG) match = mGen.match;
    else if (hasF) match = mFlat.match;
    return { match, mGen, mFlat, hasG, hasF };
  }, [recipeProvenanceResolvedRow, recipeProvenancePersisted]);

  /** Single-row proof: merged inheritance view + storefront resolver + fulfillment refs vs parent displayMedia. */
  const canonicalReadinessProof = useMemo(() => {
    if (!showProductVariantDebugPanel || !is8394ProductContext || !product || !recipeDebugVariantRow?.id) {
      return null;
    }
    const byId = new Map(productVariants.filter((x) => x.id).map((x) => [x.id, x]));
    const merged = mergeInheritedMediaForReadiness8394(
      { ...recipeDebugVariantRow, id: recipeDebugVariantRow.id },
      byId
    );
    const printSides = (fulfillmentPrintSides ?? undefined) as ProductPrintSidesForCommerce | undefined;
    const storefront = resolvePrimaryVariantImage8394ForShopify(merged, printSides);
    const backOnlyRegression = checkBackOnly8394OfficialFlatInvariants(merged, printSides);
    const fp = recipeDebugVariantRow.id
      ? productVariants.find((x) => x.id === recipeDebugVariantRow.id)?.fulfillmentPackage
      : undefined;
    return {
      variantId: recipeDebugVariantRow.id,
      canonicalFlatBlendedBack: merged.flatRenders?.flat_blended?.back?.url ?? null,
      canonicalHeroBack: merged.media?.heroBack ?? null,
      mockupUrl: merged.mockupUrl ?? null,
      storefrontPrimary: storefront,
      backOnly8394OfficialRegression: backOnlyRegression,
      fulfillmentPrintFileRefs: fp?.printFileRefs ?? null,
      fulfillmentMissing: fp?.fulfillmentMissing ?? null,
      parentDisplayMedia: product.displayMedia ?? null,
      baseComplete: isVariantBaseComplete8394(recipeDebugVariantRow, fulfillmentPrintSides, {
        variantMatrix: productVariants,
        blankVariantRowForPlan:
          currentBlank && recipeDebugVariantRow.blankVariantId
            ? getVariantById(currentBlank, recipeDebugVariantRow.blankVariantId) ?? null
            : null,
      }),
    };
  }, [
    showProductVariantDebugPanel,
    is8394ProductContext,
    product,
    recipeDebugVariantRow,
    productVariants,
    currentBlank,
    fulfillmentPrintSides,
  ]);

  /** Canonical back placement + effective blend + inputs the server would use (8394 back MVP). */
  const mvp8394VerifyPanel = useMemo(() => {
    if (!is8394ProductContext || !currentBlank || !designForFlatRender || !product?.blankVariantId) return null;
    const backRow = getBackPlacementRowForFlatRender(currentBlank);
    const v = getVariantById(currentBlank, product.blankVariantId);
    if (!backRow || !v) return null;
    const blend = getBackBlendForFlatRender(currentBlank, v, backRow);
    const designPick = pickDesignPngUrlForVariant(designForFlatRender, v);
    const variantBackUrl = getVariantBackImageUrl(currentBlank, v);
    const simple8394 = backRow.simpleRenderControls8394;
    const sizePresetLabel =
      simple8394?.sizePreset === "fill_safe"
        ? "Fill safe area"
        : simple8394?.sizePreset === "small"
          ? "Small"
          : simple8394?.sizePreset === "large"
            ? "Large"
            : simple8394?.sizePreset === "medium"
              ? "Medium"
              : "—";
    return {
      backRow,
      blend,
      designPick,
      variantBackUrl,
      variantLabel: `${v.colorName} · ${v.variantId}`,
      simple8394,
      sizePresetLabel,
    };
  }, [is8394ProductContext, currentBlank, designForFlatRender, product?.blankVariantId]);

  /** QA: same 8394 realism / ink curves as compositor for resolved flat_back (blank + variant + product). */
  const mvp8394FlatBackEngineQa = useMemo(() => {
    if (!is8394ProductContext || !currentBlank || !product?.blankVariantId) return null;
    const v = getVariantById(currentBlank, product.blankVariantId);
    if (!v) return null;
    const eff = resolveEffectiveRenderTargetSettings(product, currentBlank, v, "flat_back");
    const ff = eff.settings.blend.fabricFeel;
    const ps = eff.settings.blend.printStrength;
    if (typeof ff !== "number" || typeof ps !== "number") return null;
    return get8394EngineQaMetrics(ff, ps);
  }, [is8394ProductContext, currentBlank, product, product?.blankVariantId]);

  /** Ops: preview curve vs engine curve after garment×tone blend (flat_back + model_back). */
  const mvp8394PreviewOfficialBlendParity = useMemo(() => {
    if (!is8394ProductContext || !currentBlank || !product?.blankVariantId || !mvp8394VerifyPanel?.designPick?.ref) {
      return null;
    }
    const v = getVariantById(currentBlank, product.blankVariantId);
    if (!v) return null;
    const garmentFamily = getEffectiveColorFamily(v.colorFamily, v.colorName);
    const tone = mvp8394VerifyPanel.designPick.ref;
    const effFlat = resolveEffectiveRenderTargetSettings(product, currentBlank, v, "flat_back");
    const effModel = resolveEffectiveRenderTargetSettings(product, currentBlank, v, "model_back");
    const ffF = effFlat.settings.blend.fabricFeel;
    const psF = effFlat.settings.blend.printStrength;
    const ffM = effModel.settings.blend.fabricFeel;
    const psM = effModel.settings.blend.printStrength;
    if (typeof ffF !== "number" || typeof psF !== "number" || typeof ffM !== "number" || typeof psM !== "number") {
      return null;
    }
    return {
      flat_back: get8394PreviewVsOfficialBlendParity(ffF, psF, garmentFamily, tone),
      model_back: get8394PreviewVsOfficialBlendParity(ffM, psM, garmentFamily, tone),
    };
  }, [is8394ProductContext, currentBlank, product, product?.blankVariantId, mvp8394VerifyPanel?.designPick?.ref]);

  /** Ops: storefront gallery vs newest official PNG URLs (read-only; does not change render math). */
  const mvp8394StorefrontOfficialDriftProof = useMemo(() => {
    if (!is8394ProductContext || !shopifyPreviewVariantDoc) return null;
    return build8394StorefrontOfficialDriftProof({
      variant: shopifyPreviewVariantDoc,
      printSides: fulfillmentPrintSides as ProductPrintSidesForCommerce | undefined,
      storefrontGalleryUrlsOrdered: shopifyPreviewGalleryUrls,
      blendParityByTarget: mvp8394PreviewOfficialBlendParity,
    });
  }, [
    is8394ProductContext,
    shopifyPreviewVariantDoc,
    fulfillmentPrintSides,
    shopifyPreviewGalleryUrls,
    mvp8394PreviewOfficialBlendParity,
  ]);

  useEffect(() => {
    if (!showProductVariantDebugPanel || !mvp8394StorefrontOfficialDriftProof) return;
    console.log("[8394 drift proof — Images tab variant] object", mvp8394StorefrontOfficialDriftProof);
    console.log(mvp8394StorefrontOfficialDriftProof.opsPrintBlock);
  }, [showProductVariantDebugPanel, mvp8394StorefrontOfficialDriftProof]);

  /** Same blank → quick jump while tuning 8394 across colorways. */
  const [linked8394Nav, setLinked8394Nav] = useState<{ id: string; slug: string; name: string }[]>([]);

  useEffect(() => {
    if (!is8394ProductContext || !product?.blankId || !db) {
      setLinked8394Nav([]);
      return;
    }
    let cancelled = false;
    getDocs(query(collection(db, "rp_products"), where("blankId", "==", product.blankId)))
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs
          .map((d) => {
            const x = d.data() as RpProduct;
            return { id: d.id, slug: x.slug, name: (x.title || x.name || x.slug) as string };
          })
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        setLinked8394Nav(rows);
      })
      .catch(() => {
        if (!cancelled) setLinked8394Nav([]);
      });
    return () => {
      cancelled = true;
    };
  }, [is8394ProductContext, product?.blankId, product?.id]);

  const linkedNavMeta = useMemo(() => {
    if (!product?.id || linked8394Nav.length === 0) {
      return { prev: null as { id: string; slug: string; name: string } | null, next: null as { id: string; slug: string; name: string } | null, index: -1 };
    }
    const idx = linked8394Nav.findIndex((p) => p.id === product.id);
    if (idx < 0) return { prev: null, next: null, index: -1 };
    return {
      prev: idx > 0 ? linked8394Nav[idx - 1] : null,
      next: idx < linked8394Nav.length - 1 ? linked8394Nav[idx + 1] : null,
      index: idx,
    };
  }, [linked8394Nav, product?.id]);

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
    /** Editable plain text — not `descriptionHtml`. */
    descriptionText: "",
    seoTitle: "",
    seoDescription: "",
    tagsStr: "",
    collectionKeysStr: "",
  });
  const [savingMerchandising, setSavingMerchandising] = useState(false);
  const [refreshingFromSources, setRefreshingFromSources] = useState(false);
  useEffect(() => {
    if (!product) return;
    setMerchandising({
      title: product.title ?? product.name ?? "",
      handle: product.handle ?? product.slug ?? "",
      descriptionText: product.descriptionText != null ? String(product.descriptionText) : "",
      seoTitle: product.seo?.title ?? "",
      seoDescription: product.seo?.description ?? "",
      tagsStr: (product.tags ?? []).join(", "),
      collectionKeysStr: (product.collectionKeys ?? []).join(", "),
    });
  }, [
    product?.id,
    product?.title,
    product?.name,
    product?.handle,
    product?.slug,
    product?.descriptionText,
    product?.seo?.title,
    product?.seo?.description,
    product?.tags,
    product?.collectionKeys,
  ]);

  const handleRefreshFromSources = async () => {
    if (!product?.id || !treatsAsParentProduct) return;
    setRefreshingFromSources(true);
    try {
      await refreshProductMerchandisingFromSources({ productId: product.id });
      await refetchProduct();
      showToast("Refreshed from sources", "success");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Failed to refresh from sources";
      showToast(msg, "error");
    } finally {
      setRefreshingFromSources(false);
    }
  };

  // Taxonomy form state (product-level)
  const [taxSportCode, setTaxSportCode] = useState<string | null>(null);
  const [taxLeagueCode, setTaxLeagueCode] = useState<string | null>(null);
  const [taxTeamId, setTaxTeamId] = useState<string | null>(null);
  const [taxThemeCode, setTaxThemeCode] = useState<string | null>(null);
  const [taxDesignFamily, setTaxDesignFamily] = useState<string | null>(null);
  const [isSavingTaxonomy, setIsSavingTaxonomy] = useState(false);
  const { sports: taxonomySports } = useTaxonomySports();
  const { leagues: taxonomyLeagues } = useTaxonomyLeagues(taxSportCode ?? undefined);
  const { entities: taxonomyEntities } = useTaxonomyEntities({
    sportCode: taxSportCode ?? undefined,
    leagueCode: taxLeagueCode ?? undefined,
  });
  const { themes: taxonomyThemes } = useTaxonomyThemes(taxSportCode ?? undefined);
  const { designFamilies: taxonomyDesignFamilies } = useTaxonomyDesignFamilies();

  useEffect(() => {
    if (!product) return;
    const tx = product.taxonomy;
    setTaxSportCode(product.sportCode ?? null);
    setTaxLeagueCode(product.leagueCode ?? null);
    const storedTeamKey = tx?.teamId ?? product.teamId ?? null;
    if (!storedTeamKey?.trim()) {
      setTaxTeamId(null);
    } else if (taxonomyEntities?.length) {
      const ent = resolveTaxonomyEntity(storedTeamKey, taxonomyEntities);
      setTaxTeamId(ent?.code ?? null);
    } else {
      setTaxTeamId(null);
    }
    setTaxThemeCode(tx?.themeCode ?? product.themeCode ?? null);
    setTaxDesignFamily(product.designFamily ?? tx?.designFamily ?? null);
  }, [
    product?.id,
    product?.sportCode,
    product?.leagueCode,
    product?.teamId,
    product?.themeCode,
    product?.designFamily,
    product?.taxonomy,
    taxonomyEntities,
  ]);

  const handleSaveProductTaxonomy = async () => {
    if (!product?.id || !db) return;
    const validation = validateTaxonomyClassification({
      sportCode: taxSportCode ?? null,
      leagueCode: taxLeagueCode ?? null,
      teamId: taxTeamId ?? null,
    });
    if (!validation.valid) {
      showToast(validation.message ?? "Invalid taxonomy", "error");
      return;
    }
    setIsSavingTaxonomy(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const prevTx = product.taxonomy ?? {};
      const ent = resolveTaxonomyEntity(taxTeamId, taxonomyEntities);
      const internalTeamCode = ent?.code ?? prevTx.teamCode ?? product.teamCode ?? null;
      const { taxonomy: fullTx, tags, tagsNormalized } = enrichTaxonomyAndTagsForSave(
        product,
        {
          taxSportCode,
          taxLeagueCode,
          taxTeamId,
          taxThemeCode,
          taxDesignFamily,
        },
        taxonomySports ?? [],
        taxonomyLeagues ?? [],
        taxonomyEntities ?? [],
        taxonomyThemes ?? [],
        currentBlank ?? null
      );
      const canonicalTeamKey = fullTx.teamSlug ?? fullTx.teamId ?? null;
      await updateDoc(productRef, {
        sportCode: taxSportCode ?? null,
        leagueCode: taxLeagueCode ?? null,
        teamId: canonicalTeamKey,
        teamName: fullTx.teamName ?? ent?.name ?? product.teamName ?? null,
        teamCode: internalTeamCode,
        themeCode: taxThemeCode ?? null,
        designFamily: taxDesignFamily ?? null,
        taxonomy: {
          ...fullTx,
          teamId: canonicalTeamKey ?? fullTx.teamId ?? null,
          teamName: fullTx.teamName ?? ent?.name ?? null,
          teamCity: ent?.metadata?.city ?? fullTx.teamCity ?? null,
          teamNickname: ent?.metadata?.nickname ?? fullTx.teamNickname ?? null,
          teamCode: internalTeamCode,
        },
        tags,
        tagsNormalized,
        updatedAt: new Date(),
        updatedBy: product.updatedBy ?? "",
      });
      await refetchProduct();
      showToast("Taxonomy updated", "success");
    } catch (err) {
      console.error("[ProductDetail] Failed to update taxonomy:", err);
      showToast("Failed to update taxonomy", "error");
    } finally {
      setIsSavingTaxonomy(false);
    }
  };

  // Production form state
  const [production, setProduction] = useState({
    printPdfFront: "",
    printPdfBack: "",
    printColorsStr: "",
    productionNotes: "",
  });
  const [savingProduction, setSavingProduction] = useState(false);
  const [syncingToShopify, setSyncingToShopify] = useState(false);
  const [shopifyPreviewImageIdx, setShopifyPreviewImageIdx] = useState(0);
  /** Shopify preview: size control only; not persisted (no size variants yet). */
  const [previewSelectedSize, setPreviewSelectedSize] = useState<RPBlankGarmentSizeCode | "">("");
  useEffect(() => {
    const sizes = product?.availableSizes;
    if (sizes && sizes.length > 0) setPreviewSelectedSize(sizes[0]);
    else setPreviewSelectedSize("");
  }, [product?.id, product?.availableSizes]);

  useEffect(() => {
    setShopifyPreviewImageIdx(0);
  }, [product?.id, imagesTabVariantId, shopifyPreviewGalleryUrls.join("|")]);

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

  // When mock job succeeds, refetch parent + variant rows (mockup writes to variant doc for parent products)
  useEffect(() => {
    if (mockJob?.status === "succeeded") {
      console.info("[ProductDetail] mock job succeeded (watch)", {
        jobId: lastMockJobId,
        parentId: product?.id,
        variantId: imagesTabVariantIdRef.current,
      });
      setLastMockJobId(null);
      void refetchProduct();
      setVariantReloadTick((t) => t + 1);
      const t = setTimeout(() => {
        void refetchProduct();
        setVariantReloadTick((x) => x + 1);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [mockJob?.status, mockJob, refetchProduct, lastMockJobId, product?.id]);

  // Clear mock job id once parent or selected variant shows a mockup (poll + other tabs)
  useEffect(() => {
    if (!lastMockJobId) return;
    if (treatsAsParentProduct && imagesTabVariantId) {
      const v = productVariants.find((x) => x.id === imagesTabVariantId);
      if (v?.mockupUrl || v?.media?.heroFront || v?.media?.heroBack) {
        setLastMockJobId(null);
      }
    } else if (product?.mockupUrl) {
      setLastMockJobId(null);
    }
  }, [lastMockJobId, product?.mockupUrl, treatsAsParentProduct, imagesTabVariantId, productVariants]);

  // Resolve blank for a side (for fallback when renderSetup is missing)
  const blankIdForFallback = product?.renderConfig?.selectedBlankId || product?.blankId;
  const blankForFallback =
    blankIdForFallback === product?.blankId ? currentBlank : allBlanks.find((b) => (b as { blankId?: string }).blankId === blankIdForFallback) || currentBlank;
  /** Blank-level default for print side (8394 / panties → back_only when unset). */
  const blankForPrintDefaults = (blankForFallback || currentBlank) as RPBlank | null | undefined;
  const blankDefaultIsBackOnly =
    blankForPrintDefaults != null ? inferDefaultPrintSides(blankForPrintDefaults) === "back_only" : false;
  /** Master blanks store front/back URLs on the variant row, not on blank.images.
   * Parent products: use the Images-tab color’s blankVariantId so light/dark design PNGs match the selected garment. */
  const variantForRenderSetup =
    currentBlank && product
      ? treatsAsParentProduct && shopifyPreviewVariantDoc?.blankVariantId
        ? getVariantById(currentBlank, shopifyPreviewVariantDoc.blankVariantId) ??
          (product.blankVariantId ? getVariantById(currentBlank, product.blankVariantId) : null)
        : product.blankVariantId
          ? getVariantById(currentBlank, product.blankVariantId)
          : null
      : null;
  const fallbackFrontBlankUrl =
    (variantForRenderSetup?.images?.front as { downloadUrl?: string } | null)?.downloadUrl ??
    (blankForFallback?.images?.front as { downloadUrl?: string } | null)?.downloadUrl ??
    product?.renderConfig?.selectedBlankImageUrl;
  const fallbackBackBlankUrl =
    (variantForRenderSetup?.images?.back as { downloadUrl?: string } | null)?.downloadUrl ??
    (blankForFallback?.images?.back as { downloadUrl?: string } | null)?.downloadUrl ??
    product?.renderConfig?.selectedBlankImageUrl;

  const resolveDesignPngForRenderPreview = (d: DesignDoc | null | undefined): string | null => {
    if (!d) return null;
    if (variantForRenderSetup) {
      const picked = pickDesignPngUrlForVariant(d, variantForRenderSetup);
      if (picked.url) return picked.url;
    }
    return getDesignPreviewUrl(d) ?? null;
  };

  const explicitFrontDesignOnProduct =
    !!product?.designIdFront ||
    !!product?.renderSetup?.front?.designAssetId ||
    !!product?.renderSetup?.front?.designAssetUrl;
  const allowImplicitFrontDesignFromProductId =
    !blankDefaultIsBackOnly || explicitFrontDesignOnProduct;

  const designFrontUrlResolved =
    product?.renderConfig?.selectedDesignImageUrlFront ||
    (allowImplicitFrontDesignFromProductId &&
    designFront &&
    designSupportsGarmentSide(designFront, "front")
      ? resolveDesignPngForRenderPreview(designFront)
      : null);
  const designBackUrlResolved =
    product?.renderConfig?.selectedDesignImageUrlBack ||
    (designBack && designSupportsGarmentSide(designBack, "back")
      ? resolveDesignPngForRenderPreview(designBack)
      : null);

  const implicitFrontDesignId =
    allowImplicitFrontDesignFromProductId &&
    designFront &&
    designSupportsGarmentSide(designFront, "front")
      ? designIdForFront
      : null;
  const implicitBackDesignId =
    designBack && designSupportsGarmentSide(designBack, "back") ? designIdForBack : null;

  /** PNG URL for design picker modal (light/dark/legacy; matches garment variant when possible). */
  const resolveDesignPngForPicker = (d: DesignDoc) => resolveDesignPngForRenderPreview(d);

  const blankAsRp = currentBlank as RPBlank | null | undefined;
  const effPlacementFront = useMemo(
    () =>
      blankAsRp && product
        ? resolveEffectivePlacement(product, blankAsRp, "front", variantForRenderSetup ?? undefined)
        : null,
    [
      blankAsRp,
      product,
      variantForRenderSetup,
      variantForRenderSetup?.renderProfileOverrides,
      product?.placementOverrides,
      product?.renderSetup?.front?.placementOverride,
    ]
  );
  const effPlacementBack = useMemo(
    () =>
      blankAsRp && product
        ? resolveEffectivePlacement(product, blankAsRp, "back", variantForRenderSetup ?? undefined)
        : null,
    [
      blankAsRp,
      product,
      variantForRenderSetup,
      variantForRenderSetup?.renderProfileOverrides,
      product?.placementOverrides,
      product?.renderSetup?.back?.placementOverride,
    ]
  );

  /** Effective config per side: prefer renderSetup, fallback to renderConfig + product (backward compat). */
  type SideConfig = { blankAssetId?: string | null; blankImageUrl?: string | null; designAssetId?: string | null; designAssetUrl?: string | null; placementKey?: string | null; placementOverride?: { x?: number; y?: number; scale?: number } | null };
  /**
   * Parent + master blank: light/dark PNG must follow the **blank variant’s** Family (rp_blanks.variants[].colorFamily),
   * not a single cached URL on the product. Previously renderSetup.*.designAssetUrl won and pinned one asset for all colors.
   */
  const useVariantAwareDesignAssetUrl = treatsAsParentProduct && !!variantForRenderSetup;
  const effectiveFrontConfig: SideConfig = {
    blankAssetId: product?.renderSetup?.front?.blankAssetId ?? blankIdForFallback ?? null,
    blankImageUrl: product?.renderSetup?.front?.blankImageUrl ?? fallbackFrontBlankUrl ?? null,
    designAssetId: product?.renderSetup?.front?.designAssetId ?? implicitFrontDesignId ?? null,
    designAssetUrl: useVariantAwareDesignAssetUrl
      ? designFrontUrlResolved ?? product?.renderSetup?.front?.designAssetUrl ?? null
      : product?.renderSetup?.front?.designAssetUrl ?? designFrontUrlResolved ?? null,
    placementKey: product?.renderSetup?.front?.placementKey ?? "front_center",
    placementOverride: effPlacementFront
      ? { x: effPlacementFront.defaultX, y: effPlacementFront.defaultY, scale: effPlacementFront.defaultScale }
      : product?.renderSetup?.front?.placementOverride ?? product?.renderConfig?.placementOverride ?? undefined,
  };
  const effectiveBackConfig: SideConfig = {
    blankAssetId: product?.renderSetup?.back?.blankAssetId ?? blankIdForFallback ?? null,
    blankImageUrl: product?.renderSetup?.back?.blankImageUrl ?? fallbackBackBlankUrl ?? null,
    designAssetId: product?.renderSetup?.back?.designAssetId ?? implicitBackDesignId ?? null,
    designAssetUrl: useVariantAwareDesignAssetUrl
      ? designBackUrlResolved ?? product?.renderSetup?.back?.designAssetUrl ?? null
      : product?.renderSetup?.back?.designAssetUrl ?? designBackUrlResolved ?? null,
    placementKey: product?.renderSetup?.back?.placementKey ?? "back_center",
    placementOverride: effPlacementBack
      ? { x: effPlacementBack.defaultX, y: effPlacementBack.defaultY, scale: effPlacementBack.defaultScale }
      : product?.renderSetup?.back?.placementOverride ?? product?.renderConfig?.placementOverride ?? undefined,
  };

  const designFrontUrl = effectiveFrontConfig.designAssetUrl ?? designFrontUrlResolved;
  const designBackUrl = effectiveBackConfig.designAssetUrl ?? designBackUrlResolved;

  /**
   * Compare blank-editor / fingerprint tuning (preview) vs official compose inputs for flat_back.
   * Server logs `OFFICIAL_FLAT_COMPOSE_TELEMETRY` when running official flat; set `OFFICIAL_FLAT_DEBUG_ARTIFACTS=1` for PNG artifacts.
   */
  const flatBackOfficialVsPreviewDiffReport = useMemo(() => {
    if (!showProductVariantDebugPanel || !is8394ProductContext || !currentBlank || !product || !recipeDebugVariantRow) {
      return null;
    }
    if (officialRecipeCompareTarget !== "flat_back") return null;
    const bvId = recipeDebugVariantRow.blankVariantId && String(recipeDebugVariantRow.blankVariantId).trim();
    if (!bvId) return null;
    const blankV = getVariantById(currentBlank, bvId);
    if (!blankV) return null;
    const resolved = recipeProvenanceResolvedRow;
    const tuning = resolveEffectiveRenderTargetSettings(product, currentBlank, blankV, "flat_back");
    const engineBlend = resolveEngineBlendForRenderTarget(product, currentBlank, blankV, "flat_back", tuning.settings.blend);
    const fp = getPlacementFingerprintSliceForRenderTarget(currentBlank, product, "flat_back", blankV);
    const byId = new Map(productVariants.filter((x) => x.id).map((x) => [x.id, x]));
    const merged = mergeInheritedMediaForReadiness8394(
      { ...recipeDebugVariantRow, id: recipeDebugVariantRow.id },
      byId
    );
    const printSides = fulfillmentPrintSides as ProductPrintSidesForCommerce | undefined;
    const storefront = resolvePrimaryVariantImage8394ForShopify(merged, printSides);
    const flatBackUrl = trimMediaUrl(merged.flatRenders?.flat_blended?.back?.url);
    const prov = merged.flatRenders?.flat_blended?.back?.recipeProvenance;
    const staleRs = trimMediaUrl(recipeDebugVariantRow.renderSetup?.back?.designAssetUrl);
    const resolvedRaster = trimMediaUrl(resolved?.resolvedDesignUrl);
    return {
      blankVariantId: bvId,
      selectedTone: resolved?.resolvedTone ?? null,
      selectedRasterUrl: resolvedRaster || null,
      sourcePathUsed: resolved?.sourcePathUsed ?? null,
      renderSetupBackDesignAssetUrl: staleRs || null,
      renderSetupMatchesResolvedRaster: !!resolvedRaster && staleRs === resolvedRaster,
      previewPlacementFingerprint8394: fp,
      previewEngineBlend8394: engineBlend,
      previewTargetTuningQa: tuning.qa,
      shopifyPrimaryResolution: storefront,
      flatBlendedBackUrl: flatBackUrl || null,
      flatBlendedBackHasOfficialRecipeProvenance: !!(prov && typeof prov === "object"),
      primaryUrlMatchesFlatBlendedBack:
        !!(storefront.url && flatBackUrl) && storefront.url === flatBackUrl,
      note:
        "Compare to Cloud Function logs OFFICIAL_FLAT_COMPOSE_TELEMETRY (treatment) and OFFICIAL_FLAT_DESIGN_SOURCE_PROOF. Artifacts: OFFICIAL_FLAT_DEBUG_ARTIFACTS=1.",
    };
  }, [
    showProductVariantDebugPanel,
    is8394ProductContext,
    currentBlank,
    product,
    recipeDebugVariantRow,
    recipeProvenanceResolvedRow,
    productVariants,
    fulfillmentPrintSides,
    officialRecipeCompareTarget,
  ]);

  /** Back-only blanks: default Generate mockup to Back when no front artwork is configured. */
  useEffect(() => {
    if (!resolved) return;
    if (blankDefaultIsBackOnly && !effectiveFrontConfig.designAssetUrl) {
      setGenerateView("back");
      return;
    }
    setGenerateView(resolved.primaryView.value);
  }, [
    product?.id,
    resolved?.primaryView.value,
    blankDefaultIsBackOnly,
    effectiveFrontConfig.designAssetUrl,
  ]);

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

  /** Product-only placement override (advanced). Canonical geometry stays on the blank. */
  const persistProductPlacementOverride = async (side: "front" | "back", x: number, y: number, scale: number) => {
    if (!product?.id || !db) return;
    setSavingRenderSetup(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const prevPo = product.placementOverrides ?? {};
      const nextPo = {
        ...prevPo,
        [side]: { defaultX: x, defaultY: y, defaultScale: scale },
      };
      const rs = { ...product.renderSetup };
      const cur = side === "front" ? { ...(rs.front ?? {}) } : { ...(rs.back ?? {}) };
      const cleared = { ...cur, placementOverride: null };
      if (side === "front") rs.front = cleared;
      else rs.back = cleared;
      await updateDoc(productRef, {
        placementOverrides: nextPo,
        renderSetup: rs,
        updatedAt: new Date(),
        updatedBy: product.updatedBy || "",
      });
      await refetchProduct();
      showToast("Product placement override saved", "success");
    } finally {
      setSavingRenderSetup(false);
    }
  };

  /** Clear product placement override for one side → inherit blank default again. */
  const resetProductPlacementToBlankDefault = async (side: "front" | "back") => {
    if (!product?.id || !db) return;
    setSavingRenderSetup(true);
    try {
      const productRef = doc(db, "rp_products", product.id);
      const prevPo = { ...(product.placementOverrides ?? {}) };
      delete prevPo[side];
      const rs = { ...product.renderSetup };
      const cur = side === "front" ? { ...(rs.front ?? {}) } : { ...(rs.back ?? {}) };
      const cleared = { ...cur, placementOverride: null };
      if (side === "front") rs.front = cleared;
      else rs.back = cleared;
      await updateDoc(productRef, {
        placementOverrides: Object.keys(prevPo).length ? prevPo : null,
        renderSetup: rs,
        updatedAt: new Date(),
        updatedBy: product.updatedBy || "",
      });
      await refetchProduct();
      showToast("Reset to blank default", "success");
    } finally {
      setSavingRenderSetup(false);
    }
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

  const handleRetry8394MissingAssets = async () => {
    if (!product?.id || !imagesTabVariantId) return;
    setRetrying8394Assets(true);
    try {
      await retryVariant8394Assets({ productId: product.id, variantId: imagesTabVariantId });
      showToast("Retry started — mock/flat jobs will update this color variant shortly.", "success");
      setVariantReloadTick((t) => t + 1);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Retry failed";
      showToast(msg, "error");
    } finally {
      setRetrying8394Assets(false);
    }
  };

  const handleRetryOfficialAssets = async () => {
    if (!product?.id) return;
    if (
      !window.confirm(
        "Re-run the initial official asset batch for this product? This forces a new batch (same as bulk retry) and clears the last pipeline error fields."
      )
    ) {
      return;
    }
    setRetryingOfficialAssets(true);
    try {
      const data = await retryOfficialProductAssets({ productId: product.id });
      const row = data.results?.find((r) => r.productId === product.id);
      const detail = row?.detail as {
        assetsBatchId?: string;
        enqueueErrors?: number;
        skipped?: boolean;
        reason?: string;
      } | undefined;
      if (row?.ok && detail?.skipped && detail.reason === "not_8394") {
        showToast("Skipped — product is not 8394.", "error");
      } else if (row?.ok && detail?.assetsBatchId) {
        const n = detail.enqueueErrors ?? 0;
        if (n > 0) {
          showToast(
            `Batch ${detail.assetsBatchId} created but official enqueue reported ${n} error(s). Check Last pipeline error.`,
            "error"
          );
        } else {
          showToast(`Official batch started — assetsBatchId ${detail.assetsBatchId}`, "success");
        }
      } else if (row?.ok) {
        showToast("Official asset retry completed — check Ops summary for batch id.", "success");
      } else {
        showToast(row?.error ?? "Official asset retry failed", "error");
      }
      await refetchProduct();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Retry failed";
      showToast(msg, "error");
    } finally {
      setRetryingOfficialAssets(false);
    }
  };

  const handleGenerateFlatRenders = async () => {
    if (!product?.id) return;
    if (treatsAsParentProduct && !imagesTabVariantId) {
      showToast("Select a color variant on the Images tab to generate flats for that variant.", "error");
      return;
    }

    const runVariantSnapshot: FlatRender8394VariantQaSnapshot = (() => {
        if (treatsAsParentProduct && imagesTabVariantId) {
          const row = productVariants.find((v) => v.id === imagesTabVariantId);
          return {
            variantId: row?.id ?? imagesTabVariantId,
            blankVariantId: row?.blankVariantId ?? null,
            colorName: row?.colorName ?? row?.optionValues?.color ?? null,
          };
        }
        return {
          variantId: product.id,
          blankVariantId: product.blankVariantId ?? null,
          colorName:
            ("colorName" in product && typeof (product as { colorName?: string }).colorName === "string"
              ? (product as { colorName?: string }).colorName
              : null) ??
            product.colorway?.name ??
            null,
        };
      })();

    setGeneratingFlatRenders(true);
    try {
      const data = await generateProductFlatRenders({
        productId: product.id,
        productVariantId: treatsAsParentProduct ? imagesTabVariantId : undefined,
      });
      setLastFlatRenderSelectionLog(
        Array.isArray(data?.renderSelectionLog) ? data.renderSelectionLog : null
      );
      setLastFlatRender8394Payload({
        urls: data?.urls ?? null,
        renderTypes: Array.isArray(data?.renderTypes) ? data.renderTypes : null,
        runVariantSnapshot,
      });
      showToast(
        "Renders saved on the variant (8394 auto targets: flat/model back + front when sources exist).",
        "success"
      );
      await refetchProduct();
      setVariantReloadTick((t) => t + 1);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Failed to generate flat renders";
      showToast(msg, "error");
    } finally {
      setGeneratingFlatRenders(false);
    }
  };

  const flatBlendedForScene = useMemo(() => {
    if (!product) return null;
    if (treatsAsParentProduct && shopifyPreviewVariantDoc?.flatRenders) {
      return pickFlatBlendedUrlForScene(shopifyPreviewVariantDoc.flatRenders);
    }
    return pickFlatBlendedUrlForScene(product.flatRenders);
  }, [product, treatsAsParentProduct, shopifyPreviewVariantDoc]);

  const handleGenerateSceneRender = async () => {
    if (!product?.id) return;
    setGeneratingSceneRender(true);
    try {
      await generateProductSceneRender({
        productId: product.id,
        sceneKey: resolvedSceneRenderKey,
      });
      showToast(
        resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY
          ? "Hanger scene render saved on product (non-AI composite)."
          : `Scene render (${resolvedSceneRenderKey}) saved on product (non-AI composite).`,
        "success"
      );
      await refetchProduct();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Failed to generate scene render";
      showToast(msg, "error");
    } finally {
      setGeneratingSceneRender(false);
    }
  };

  // Lightbox state (optional caption for 8394 flat zoom, etc.)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState<string | null>(null);

  const closeLightbox = useCallback(() => {
    setLightboxImage(null);
    setLightboxCaption(null);
  }, []);

  const openLightbox = useCallback((src: string, caption?: string | null) => {
    setLightboxImage(src);
    setLightboxCaption(caption ?? null);
  }, []);

  const setLightboxImageCompat = useCallback(
    (url: string | null) => {
      if (!url) closeLightbox();
      else openLightbox(url);
    },
    [closeLightbox, openLightbox]
  );

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
        closeLightbox();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [lightboxImage, closeLightbox]);

  const runGenerateFlow = async (
    payload: {
      presetId: string;
      generationType: "product_only" | "on_model";
      identityId?: string;
      faceScale: number;
      bodyScale: number;
      productScale: number;
      imageCount: number;
      imageSize: "square" | "portrait" | "landscape";
      experimentId?: string;
      faceArtifactId?: string;
      bodyArtifactId?: string;
    },
    options?: { resetAdvancedForm?: boolean }
  ) => {
    if (!product?.id) return;
    const preset = allPresets.find((p) => p.id === payload.presetId);
    const isOnModelRun = payload.generationType === "on_model";
    const variantIdForJob =
      isParentProductRow(product) && imagesTabVariantId
        ? imagesTabVariantId
        : variantId.trim() || undefined;

    await generateProductAssets({
      productId: product.id,
      generationType: payload.generationType,
      identityId: isOnModelRun ? payload.identityId : undefined,
      presetId: payload.presetId,
      artifacts: isOnModelRun
        ? {
            faceArtifactId:
              preset && "allowFaceArtifact" in preset && preset.allowFaceArtifact !== false
                ? payload.faceArtifactId
                : undefined,
            faceScale: payload.faceScale,
            bodyArtifactId:
              preset && "allowBodyArtifact" in preset && preset.allowBodyArtifact !== false
                ? payload.bodyArtifactId
                : undefined,
            bodyScale: payload.bodyScale,
            productArtifactId:
              preset && "allowProductArtifact" in preset && preset.allowProductArtifact !== false
                ? product.ai?.productArtifactId || undefined
                : undefined,
            productScale: payload.productScale,
          }
        : {
            productArtifactId:
              preset && "allowProductArtifact" in preset && preset.allowProductArtifact !== false
                ? product.ai?.productArtifactId || undefined
                : undefined,
            productScale: payload.productScale,
          },
      imageCount: payload.imageCount,
      imageSize: payload.imageSize,
      experimentId: payload.experimentId,
      variantId: variantIdForJob,
    });

    showToast(
      `✅ Generation started! Assets will appear in the Images tab when ready (usually 20-30 seconds).`,
      "success"
    );

    if (options?.resetAdvancedForm !== false) {
      setSelectedPresetId("");
      if (payload.generationType === "on_model") {
        setSelectedIdentityId("");
        setSelectedFaceArtifactId("");
        setSelectedBodyArtifactId("");
      }
    }

    await refetchJobs();
    setActiveTab("images");
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    let pollAttempts = 0;
    const maxPollAttempts = 24;
    const pollMs = 5000;
    pollIntervalRef.current = setInterval(async () => {
      pollAttempts++;
      await refetchJobs();
      await refetchAssets();
      if (pollAttempts >= maxPollAttempts && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        showToast(`✅ Generation completed! Check the Images tab.`, "success");
      }
    }, pollMs);
  };

  const handleGenerateWithDefaults = async () => {
    if (!product?.id || !resolved) {
      setGenerateError("Missing product or resolved defaults.");
      return;
    }
    if (!hasMockupForGenerateUi) {
      setGenerateError("Generate a mockup first (Product Images stage). For parent products, pick a color variant on the Images tab.");
      return;
    }
    const presetId =
      generateMode === "product" ? resolved.productOnlyPresetId.value : resolved.onModelPresetId.value;
    if (!presetId) {
      setGenerateError("No resolved preset id.");
      return;
    }
    const preset = allPresets.find((p) => p.id === presetId) as RpScenePreset | undefined;
    const genType = inferGenerationTypeFromPreset(preset);
    if (
      genType === "on_model" &&
      preset &&
      ("requireIdentity" in preset ? preset.requireIdentity !== false : true) &&
      !resolved.defaultIdentityId.value
    ) {
      setGenerateError(
        "No default identity — set team.generationDefaults.defaultIdentityId or use Advanced overrides."
      );
      return;
    }

    setGenerateError(null);
    setGenerating(true);
    try {
      await runGenerateFlow(
        {
          presetId,
          generationType: genType,
          identityId: genType === "on_model" ? resolved.defaultIdentityId.value || undefined : undefined,
          faceScale: preset?.defaultFaceScale ?? 0.8,
          bodyScale: preset?.defaultBodyScale ?? 0.6,
          productScale: preset?.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.9,
          imageCount: preset?.defaultImageCount ?? preset?.defaults?.imageCount ?? 4,
          imageSize: preset?.defaults?.imageSize ?? "square",
          experimentId: undefined,
          faceArtifactId: undefined,
          bodyArtifactId: undefined,
        },
        { resetAdvancedForm: false }
      );
    } catch (err: unknown) {
      console.error("[ProductDetail] Failed to generate (defaults):", err);
      setGenerateError(err instanceof Error ? err.message : "Failed to generate assets");
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!product?.id || !selectedPresetId) {
      setGenerateError("Preset is required");
      return;
    }
    if (!hasMockupForGenerateUi) {
      setGenerateError(
        "Generate a mockup first (Images tab → Generate mockup). For parent products, pick a color variant so the mockup attaches to that variant."
      );
      return;
    }

    if (
      isOnModel &&
      selectedPreset &&
      ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) &&
      !selectedIdentityId
    ) {
      setGenerateError("Identity is required for this preset");
      return;
    }

    setGenerateError(null);
    setGenerating(true);

    try {
      const genType = inferGenerationTypeFromPreset(selectedPreset);
      await runGenerateFlow({
        presetId: selectedPresetId,
        generationType: genType,
        identityId: genType === "on_model" ? selectedIdentityId : undefined,
        faceScale,
        bodyScale,
        productScale,
        imageCount,
        imageSize,
        experimentId: experimentId.trim() || undefined,
        faceArtifactId: selectedFaceArtifactId || undefined,
        bodyArtifactId: selectedBodyArtifactId || undefined,
      });
    } catch (err: unknown) {
      console.error("[ProductDetail] Failed to generate:", err);
      setGenerateError(err instanceof Error ? err.message : "Failed to generate assets");
    } finally {
      setGenerating(false);
    }
  };

  const [mockupGenerating, setMockupGenerating] = useState(false);
  const handleGenerateMockup = async () => {
    const view = generateView;
    const p = productRef.current;
    const variantIdForJob = isParentProductRow(p) ? imagesTabVariantIdRef.current : "";
    const config = view === "front" ? effectiveFrontConfig : effectiveBackConfig;
    if (!p?.id || !p.blankId) {
      setGenerateError("Product must have a blank (create from Design + Blank first).");
      return;
    }
    if (isParentProductRow(p) && !variantIdForJob) {
      setGenerateError(
        "Select a color variant on the Images tab (or wait for variants to load). Parent mockups are saved on the variant document."
      );
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
      const payload = {
        designId: config.designAssetId,
        blankId: p.blankId,
        view,
        quality: "final" as const,
        productId: p.id,
        productVariantId: isParentProductRow(p) ? variantIdForJob : undefined,
        blankImageUrl: config.blankImageUrl,
        designPngUrl: config.designAssetUrl,
        placementId: (config.placementKey as "front_center" | "back_center") || (view === "front" ? "front_center" : "back_center"),
        placementOverride: {
          x: config.placementOverride?.x ?? 0.5,
          y: config.placementOverride?.y ?? 0.5,
          scale: config.placementOverride?.scale ?? 0.6,
        },
      };
      console.info("[ProductDetail] createMockJob (callable)", {
        parentId: p.id,
        productVariantId: payload.productVariantId ?? null,
        view,
        designId: payload.designId,
        blankId: payload.blankId,
      });
      const jobId = await createMockJob(payload);
      if (jobId) {
        console.info("[ProductDetail] createMockJob queued", { jobId, parentId: p.id, productVariantId: payload.productVariantId ?? null, view });
        setLastMockJobId(jobId);
        setGenerateError(null);
        showToast("Mockup generation started. It will appear when ready (usually 30–60 seconds).", "success");
        refetchJobs();
        mockupPollCancelledRef.current = false;
        const pollMockup = async (attempt = 0) => {
          if (mockupPollCancelledRef.current) return;
          if (attempt >= 24) {
            console.warn("[ProductDetail] mockup poll: max attempts (24), stop");
            return;
          }
          await new Promise((r) => setTimeout(r, 5000));
          if (mockupPollCancelledRef.current) return;
          const freshParent = await refetchProduct();
          const cur = productRef.current;
          const vid = isParentProductRow(cur) ? imagesTabVariantIdRef.current : null;
          if (cur && isParentProductRow(cur) && vid && db && cur.id) {
            const vref = doc(db, "rp_products", cur.id, "variants", vid);
            const vsnap = await getDoc(vref);
            const vd = vsnap.data() as
              | { mockupUrl?: string | null; media?: { heroFront?: string | null; heroBack?: string | null } }
              | undefined;
            const hasVariantAsset = !!(vd?.mockupUrl || vd?.media?.heroFront || vd?.media?.heroBack);
            if (hasVariantAsset) {
              console.info("[ProductDetail] mockup poll: variant doc has mockup/media", {
                firestorePath: vref.path,
                mockupUrl: !!vd?.mockupUrl,
                heroFront: !!vd?.media?.heroFront,
                heroBack: !!vd?.media?.heroBack,
              });
              setVariantReloadTick((t) => t + 1);
              setLastMockJobId(null);
              return;
            }
          } else {
            const parent = (freshParent ?? cur) as RpProduct | null | undefined;
            if (parent?.mockupUrl) {
              console.info("[ProductDetail] mockup poll: parent mockupUrl set", { parentId: cur?.id });
              setVariantReloadTick((t) => t + 1);
              setLastMockJobId(null);
              return;
            }
          }
          pollMockup(attempt + 1);
        };
        pollMockup();
      }
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : "Failed to start mockup generation");
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
    { id: "product", label: "Product" },
    { id: "images", label: "Images" },
    { id: "generate", label: "Generate" },
    { id: "shopifyPreview", label: "Shopify preview" },
    { id: "order", label: "Order / production" },
    { id: "metrics", label: "Metrics" },
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
              closeLightbox();
            }
          }}
        >
          <div className="relative max-w-7xl max-h-full">
            {/* Close button */}
            <button
              onClick={() => closeLightbox()}
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
              alt="Enlarged preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            {lightboxCaption ? (
              <p className="mt-3 text-center text-white text-sm font-medium px-2">{lightboxCaption}</p>
            ) : null}
            {/* ESC hint */}
            <div className="absolute -bottom-10 left-0 right-0 text-center text-white text-sm opacity-75">
              Press ESC or click outside to close
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
          {product.baseProductKey} · {product.colorway?.name ?? "—"}
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <section
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            aria-labelledby="ops-summary-heading"
          >
            <h2 id="ops-summary-heading" className="text-sm font-semibold text-slate-900">
              Ops summary
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Launch status</dt>
                <dd className="font-mono text-slate-900 text-right">{product.launchStatus ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Assets status</dt>
                <dd className="font-mono text-slate-900 text-right">{product.assetsStatus ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 items-start">
                <dt className="text-slate-500 shrink-0 pt-0.5">Optional model assets</dt>
                <dd className="text-slate-800 text-right text-xs max-w-[min(100%,14rem)]">
                  {product.officialAssetsNote?.trim() ? product.officialAssetsNote : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 items-start">
                <dt className="text-slate-500 shrink-0 pt-0.5">Assets batch</dt>
                <dd className="font-mono text-slate-900 text-right text-xs break-all max-w-[min(100%,14rem)]">
                  {product.assetsBatchId ?? "—"}
                </dd>
              </div>
              {treatsAsParentProduct && is8394ProductContext ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => void handleRetryOfficialAssets()}
                    disabled={retryingOfficialAssets || !product.id}
                    className="w-full sm:w-auto px-3 py-1.5 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {retryingOfficialAssets ? "Starting official batch…" : "Retry official assets"}
                  </button>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Same as Products list → bulk retry: new initial batch with <code className="text-[10px]">force</code>,
                    clears pipeline error fields.
                  </p>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Shopify ready</dt>
                <dd className="text-slate-900 text-right">{product.shopifyReady === true ? "Yes" : product.shopifyReady === false ? "No" : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Fulfillment ready</dt>
                <dd className="text-slate-900 text-right">
                  {product.fulfillmentSummary?.fulfillmentReady === true
                    ? "Yes"
                    : product.fulfillmentSummary?.fulfillmentReady === false
                      ? "No"
                      : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Ops review</dt>
                <dd className="font-mono text-slate-900 text-right">{product.opsReviewStatus ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Colors / SKUs</dt>
                <dd className="text-slate-900 text-right">
                  {(() => {
                    const colors =
                      product.colorVariantCount ??
                      (product.variantSummary?.length
                        ? new Set(product.variantSummary.map((s) => s.blankVariantId).filter(Boolean)).size
                        : treatsAsParentProduct
                          ? new Set(productVariants.map((v) => v.blankVariantId).filter(Boolean)).size
                          : null);
                    const skus = product.variantCount ?? (treatsAsParentProduct ? productVariants.length : null);
                    const c = colors != null ? `${colors} color${colors === 1 ? "" : "s"}` : "—";
                    const s = skus != null ? `${skus} SKU${skus === 1 ? "" : "s"}` : "—";
                    return `${c} · ${s}`;
                  })()}
                </dd>
              </div>
              {(product.lastPipelineError || product.lastPipelineStage || product.lastPipelineAt) && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  {product.lastPipelineError ? (
                    <p className="text-red-700 text-sm">
                      <span className="font-medium text-slate-700">Last pipeline error: </span>
                      {product.lastPipelineError}
                    </p>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    {product.lastPipelineStage ? (
                      <span className="mr-2">
                        Stage: <span className="font-mono text-slate-700">{product.lastPipelineStage}</span>
                      </span>
                    ) : null}
                    {product.lastPipelineAt ? (
                      <span>· {formatFirestoreTimestamp(product.lastPipelineAt)}</span>
                    ) : null}
                  </p>
                </div>
              )}
            </dl>
          </section>

          {/* FULFILLMENT PACKAGE (QA) PANEL HIDDEN — flip `false` to `true` below to re-enable. */}
          {false && (
          <section
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            aria-labelledby="fulfillment-qa-heading"
          >
            <h2 id="fulfillment-qa-heading" className="text-sm font-semibold text-slate-900">
              Fulfillment package (QA)
            </h2>
            {product.fulfillmentSummary ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <span className="text-slate-500">Print sides</span>
                  <pre className="mt-1 text-xs font-mono text-slate-900 bg-slate-50 border border-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(product.fulfillmentSummary.printSides ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-slate-500">Sizes offered</span>
                  <span className="text-slate-900">
                    {product.fulfillmentSummary.sizesOffered?.length
                      ? product.fulfillmentSummary.sizesOffered.join(", ")
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">Color lines</span>
                  <ul className="list-disc list-inside text-slate-800 text-sm space-y-0.5">
                    {(product.fulfillmentSummary.colorLines ?? []).slice(0, 12).map((line) => (
                      <li key={line.blankVariantId}>
                        {line.colorName || line.blankVariantId}
                        {line.variantDocCount != null ? (
                          <span className="text-slate-500"> ({line.variantDocCount} variant docs)</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {(product.fulfillmentSummary.colorLines?.length ?? 0) > 12 ? (
                    <p className="text-xs text-slate-500 mt-1">Showing first 12 color lines.</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500">Package ready</span>
                  <span
                    className={
                      product.fulfillmentSummary.fulfillmentReady
                        ? "text-emerald-800 font-medium"
                        : "text-amber-800 font-medium"
                    }
                  >
                    {product.fulfillmentSummary.fulfillmentReady ? "Yes" : "No"}
                  </span>
                </div>
                {(product.fulfillmentSummary.fulfillmentMissing?.length ?? 0) > 0 ? (
                  <div>
                    <span className="text-slate-500">Missing</span>
                    <p className="mt-1 text-amber-900 text-sm font-mono">
                      {(product.fulfillmentSummary.fulfillmentMissing ?? []).join(", ")}
                    </p>
                  </div>
                ) : null}
                <div>
                  <span className="text-slate-500 block mb-1">Sample print file refs (variants)</span>
                  {(() => {
                    const samples = productVariants
                      .filter((v) => v.fulfillmentPackage?.printFileRefs)
                      .slice(0, 2);
                    const rows = samples.length > 0 ? samples : productVariants.slice(0, 2);
                    if (rows.length === 0) {
                      return <p className="text-xs text-slate-500">Load variants to see sample refs.</p>;
                    }
                    return (
                      <ul className="space-y-2">
                        {rows.map((v) => (
                          <li key={v.id} className="text-xs">
                            <span className="font-medium text-slate-800">{v.colorName || v.id}</span>
                            <pre className="mt-1 font-mono text-slate-900 bg-slate-50 border border-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(v.fulfillmentPackage?.printFileRefs ?? {}, null, 2)}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                No fulfillment snapshot yet. It is written when the launch pipeline completes the asset batch (server-side).
              </p>
            )}
          </section>
          )}
        </div>

        {/* DEBUG PANEL HIDDEN — flip `false` to `true` below to re-enable. */}
        {false && showProductVariantDebugPanel && product?.id && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-mono text-amber-950 space-y-3">
            <div className="font-semibold text-amber-900">Variant load debug (ops / dev)</div>
            <div>productId: {product.id}</div>
            <div className="pt-1 border-t border-amber-200/70 space-y-1">
              <div className="font-medium text-amber-900">Shopify variant mode (inheritance)</div>
              <div>
                <span className="text-amber-950">product.shopifyVariantMode:</span>{" "}
                {product.shopifyVariantMode != null && String(product.shopifyVariantMode).trim() !== "" ? (
                  <code className="bg-white/80 px-1 rounded text-amber-950">{String(product.shopifyVariantMode)}</code>
                ) : (
                  <span className="text-slate-600">
                    — unset{" "}
                    <span className="text-slate-500">
                      (older docs: sync uses legacy Color×Size; new products from blank usually{" "}
                      <code className="font-mono bg-white/80 px-0.5 rounded">color</code>)
                    </span>
                  </span>
                )}
              </div>
              {currentBlank && product.blankId ? (
                <div>
                  <span className="text-amber-950">blank.shopifyVariantMode (linked {product.blankId}):</span>{" "}
                  {currentBlank.shopifyVariantMode != null && String(currentBlank.shopifyVariantMode).trim() !== "" ? (
                    <code className="bg-white/80 px-1 rounded text-amber-950">{String(currentBlank.shopifyVariantMode)}</code>
                  ) : (
                    <span className="text-slate-600">— unset (effective default: color)</span>
                  )}
                </div>
              ) : null}
            </div>
            <div>isParentProductRow: {String(treatsAsParentProduct)}</div>
            <div>variantSummary.length: {product.variantSummary?.length ?? 0}</div>
            <div>colorVariantCount: {product.colorVariantCount ?? "—"}</div>
            <div>queried variant subdoc count: {variantSubcollectionDocCount ?? "—"}</div>
            <div>first 5 variant subdoc IDs: {variantSubdocSampleIds.length ? variantSubdocSampleIds.join(", ") : "—"}</div>

            {is8394ProductContext && currentBlank && designForFlatRender ? (
              <div className="pt-2 border-t border-amber-200/80 space-y-2">
                <div className="font-semibold text-amber-950">Readiness recipe (client = buildProductReadinessRecipe(blank, design))</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-40 overflow-auto">
                  {JSON.stringify(readinessRecipe ?? null, null, 2)}
                </pre>
                <div className="text-[11px] text-amber-950">
                  Storefront/catalog/Shopify checks use <code className="bg-white/80 px-0.5 rounded">fulfillmentPrintSides</code>{" "}
                  = recipe above when blank+design load, else <code className="bg-white/80 px-0.5 rounded">fulfillmentSummary.printSides</code>.
                </div>
              </div>
            ) : null}

            {blankDrivenImagePlanOpsProof ? (
              <div className="pt-2 border-t border-amber-200/80 space-y-2">
                <div className="font-semibold text-amber-950">Blank-driven image plan proof (preview = launch batch = readiness)</div>
                <p className="text-[11px] font-mono text-amber-950">
                  planParityStatus:{" "}
                  <span
                    className={
                      blankDrivenImagePlanOpsProof.planParityStatus === "match"
                        ? "text-emerald-800 font-semibold"
                        : blankDrivenImagePlanOpsProof.planParityStatus === "mismatch"
                          ? "text-rose-800 font-semibold"
                          : "text-amber-950"
                    }
                  >
                    {blankDrivenImagePlanOpsProof.planParityStatus}
                  </span>{" "}
                  (preview resolve vs batch <code className="bg-white/80 px-0.5 rounded">officialPlan</code> vs
                  launch-required roles)
                </p>
                <p className="text-[11px] text-amber-950">
                  Color = Images tab selection (parent) or first variant. Compare{" "}
                  <code className="bg-white/80 px-0.5 rounded">resolveBlankProductImagePlan(blank, blankVariantRow)</code> to{" "}
                  <code className="bg-white/80 px-0.5 rounded">rp_product_asset_batches · colors[blankVariantId]</code> and
                  variant outputs (missing lists).
                </p>
                <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
                  <div>
                    <div className="font-medium text-amber-950 mb-0.5">assetsBatchId / batch status</div>
                    <div className="font-mono text-amber-950 break-all">
                      {blankDrivenImagePlanOpsProof.assetsBatchId ?? "—"} · {blankDrivenImagePlanOpsProof.batchStatus ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-amber-950 mb-0.5">Official batch planned targets (role keys)</div>
                    <div className="font-mono text-amber-950 break-all">
                      {blankDrivenImagePlanOpsProof.officialAssetBatchPlannedTargets.length
                        ? blankDrivenImagePlanOpsProof.officialAssetBatchPlannedTargets.join(", ")
                        : "— (no batch doc or no color block)"}
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
                  <div>
                    <div className="font-medium text-amber-950 mb-0.5">Missing required-for-launch (official roles)</div>
                    <div className="font-mono text-amber-950 break-all">
                      {blankDrivenImagePlanOpsProof.missingRequiredForLaunch.length
                        ? blankDrivenImagePlanOpsProof.missingRequiredForLaunch.join(", ")
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-amber-950 mb-0.5">Missing required-for-Shopify (official roles)</div>
                    <div className="font-mono text-amber-950 break-all">
                      {blankDrivenImagePlanOpsProof.missingRequiredForShopify.length
                        ? blankDrivenImagePlanOpsProof.missingRequiredForShopify.join(", ")
                        : "— (no explicit Shopify flags on blank row)"}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="font-medium text-amber-950 mb-0.5 text-[11px]">Final gallery order (blank plan, official role ids)</div>
                  <div className="font-mono text-[11px] text-amber-950 break-all">
                    {blankDrivenImagePlanOpsProof.finalGalleryOrder.join(", ")}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-amber-950 mb-0.5 text-[11px]">Preview still URL order (heroes + plan slots)</div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-32 overflow-auto">
                    {JSON.stringify(blankDrivenImagePlanOpsProof.previewStillUrlsOrder ?? [], null, 0)}
                  </pre>
                </div>
                <div>
                  <div className="font-medium text-amber-950 mb-0.5 text-[11px]">Batch snapshot: officialPlan (if present)</div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-36 overflow-auto">
                    {JSON.stringify(blankDrivenImagePlanOpsProof.batchOfficialPlanSnapshot ?? null, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="font-medium text-amber-950 mb-0.5 text-[11px]">Resolved blank product image plan (full)</div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-64 overflow-auto">
                    {JSON.stringify(blankDrivenImagePlanOpsProof.resolvedBlankProductImagePlan ?? null, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}

            {is8394ProductContext && currentBlank && designForFlatRender ? (
              <div className="pt-2 border-t border-amber-200/80 space-y-2">
                <div className="font-semibold text-amber-950">Saved blank render profile (selected color + target)</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <label className="text-amber-900">renderTarget</label>
                  <select
                    className="border border-amber-300 rounded px-1 py-0.5 bg-white text-amber-950"
                    value={savedProfileDebugTarget}
                    onChange={(e) => setSavedProfileDebugTarget(e.target.value as RpRenderTarget)}
                  >
                    <option value="flat_front">flat_front</option>
                    <option value="flat_back">flat_back</option>
                    <option value="model_front">model_front</option>
                    <option value="model_back">model_back</option>
                  </select>
                </div>
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-64 overflow-auto">
                  {JSON.stringify(savedBlankProfileDebugRow ?? { error: "missing blankVariantId or variant row" }, null, 2)}
                </pre>
                <p className="text-[10px] text-amber-950">
                  Doc: <code className="bg-white/80 px-0.5 rounded">{savedBlankProfileDebugRow?.blankDocPath ?? "—"}</code> · row{" "}
                  <code className="bg-white/80 px-0.5 rounded">variants[]</code> where{" "}
                  <code className="bg-white/80 px-0.5 rounded">variantId</code> = blank color key. Tuning from{" "}
                  <code className="bg-white/80 px-0.5 rounded">renderProfile.renderTargets</code> +{" "}
                  <code className="bg-white/80 px-0.5 rounded">renderTargetsByColor</code>.
                </p>
              </div>
            ) : null}

            {is8394ProductContext && currentBlank && designForFlatRender && recipeDebugVariantRow ? (
              <div className="pt-2 border-t border-amber-200/80 space-y-2">
                <div className="font-semibold text-amber-950">Persisted recipe provenance (official deterministic)</div>
                <p className="text-[11px] text-amber-950">
                  Color = Images tab selection (parent) or primary variant (
                  <code className="bg-white/80 px-0.5 rounded">{recipeDebugVariantRow.id ?? "—"}</code>
                  {recipeDebugVariantRow.colorName ? ` · ${recipeDebugVariantRow.colorName}` : ""}). Compare to{" "}
                  <code className="bg-white/80 px-0.5 rounded">recipeProvenance</code> on{" "}
                  <code className="bg-white/80 px-0.5 rounded">generatedRenderOutputs</code> and{" "}
                  <code className="bg-white/80 px-0.5 rounded">flatRenders</code>. Official{" "}
                  <code className="bg-white/80 px-0.5 rounded">flat_front_clean</code> is garment-only: expect{" "}
                  <code className="bg-white/80 px-0.5 rounded">garmentOnly: true</code> /{" "}
                  <code className="bg-white/80 px-0.5 rounded">garmentOnlyCleanFront: true</code>,{" "}
                  <code className="bg-white/80 px-0.5 rounded">resolvedDesignUrl: null</code> (not the designed PDP face
                  for back-only blanks).
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <label className="text-amber-900">Official render target</label>
                  <select
                    className="border border-amber-300 rounded px-1 py-0.5 bg-white text-amber-950"
                    value={officialRecipeCompareTarget}
                    onChange={(e) => setOfficialRecipeCompareTarget(e.target.value as RpRenderTarget)}
                  >
                    <option value="flat_back">flat_back (flat_blended.back)</option>
                    <option value="flat_front">flat_front (flat_clean.front)</option>
                    <option value="model_back">model_back (model_blended.back)</option>
                    <option value="model_front">model_front (model_clean.front)</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-amber-900">Resolved profile (same resolver as compose)</span>
                  <pre className="flex-1 min-w-[12rem] whitespace-pre-wrap break-all text-[11px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-40 overflow-auto">
                    {JSON.stringify(recipeProvenanceResolvedRow ?? { error: "missing blankVariantId or variant row" }, null, 2)}
                  </pre>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-amber-950">Recipe match</span>
                  {recipeProvenanceMatch == null ? (
                    <span className="text-[11px] text-amber-800">—</span>
                  ) : !recipeProvenanceMatch.hasG && !recipeProvenanceMatch.hasF ? (
                    <span className="text-[11px] font-medium text-slate-600">No persisted provenance (run official flat)</span>
                  ) : recipeProvenanceMatch.match ? (
                    <span className="text-[11px] font-semibold text-emerald-800">Match</span>
                  ) : (
                    <span className="text-[11px] font-semibold text-rose-800">Mismatch</span>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] font-medium text-amber-950 mb-0.5">generatedRenderOutputs[].recipeProvenance</div>
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-36 overflow-auto">
                      {JSON.stringify(recipeProvenancePersisted.genProvenance ?? null, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-amber-950 mb-0.5">flatRenders slot recipeProvenance</div>
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-36 overflow-auto">
                      {JSON.stringify(recipeProvenancePersisted.flatProvenance ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
                {recipeProvenanceMatch && (recipeProvenanceMatch.hasG || recipeProvenanceMatch.hasF) && !recipeProvenanceMatch.match ? (
                  <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-rose-50/80 rounded p-2 border border-rose-200/90 max-h-32 overflow-auto text-rose-950">
                    {JSON.stringify(
                      {
                        vs_generatedRenderOutputs: recipeProvenanceMatch.hasG ? recipeProvenanceMatch.mGen.fields : null,
                        vs_flatRenders: recipeProvenanceMatch.hasF ? recipeProvenanceMatch.mFlat.fields : null,
                      },
                      null,
                      2
                    )}
                  </pre>
                ) : null}
                {officialRecipeCompareTarget === "flat_back" && flatBackOfficialVsPreviewDiffReport ? (
                  <div className="pt-2 border-t border-amber-200/80 space-y-1">
                    <div className="font-semibold text-amber-950">flat_back: preview tuning vs official compose (investigation)</div>
                    <p className="text-[10px] text-amber-950">
                      Client uses <code className="bg-white/80 px-0.5 rounded">getPlacementFingerprintSliceForRenderTarget</code> +{" "}
                      <code className="bg-white/80 px-0.5 rounded">resolveEngineBlendForRenderTarget</code> (same family as blank editor).
                      Official compose logs <code className="bg-white/80 px-0.5 rounded">OFFICIAL_FLAT_COMPOSE_TELEMETRY</code> in Cloud Functions;
                      set <code className="bg-white/80 px-0.5 rounded">OFFICIAL_FLAT_DEBUG_ARTIFACTS=1</code> for three PNG artifacts per run.
                    </p>
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-56 overflow-auto">
                      {JSON.stringify(flatBackOfficialVsPreviewDiffReport, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {canonicalReadinessProof ? (
                  <div className="pt-2 border-t border-amber-200/80 space-y-1">
                    <div className="font-semibold text-amber-950">Canonical readiness / fulfillment alignment</div>
                    <p className="text-[10px] text-amber-950">
                      Merged primary→sibling view, storefront resolver, variant fulfillmentPackage, parent displayMedia,
                      and isVariantBaseComplete8394 (matrix-aware).
                    </p>
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug bg-white/70 rounded p-2 border border-amber-200/90 max-h-48 overflow-auto">
                      {JSON.stringify(canonicalReadinessProof, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {/* 8394 VARIANT ASSETS PANEL HIDDEN — flip `false` to `true` below to re-enable. */}
        {false && show8394VariantReadinessUi && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-800">
            <p className="font-semibold text-slate-900">8394 variant assets</p>
            <p className="mt-1 text-xs text-slate-600">
              {fulfillmentPrintSides?.effectiveBack === true && fulfillmentPrintSides?.effectiveFront === false
                ? `Base complete = back fabric blend + back display (hero or mockup). flat_front_clean policy: ${
                    readinessRecipe?.flatFrontCleanPolicy ?? "optional"
                  } (not required for readiness). Catalog needs every color line.`
                : "Base complete = back mock/hero, back fabric blend, front clean/hero. Storefront uses the hero or default color; catalog needs every color."}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="text-slate-500">Storefront ready</span>{" "}
                <span className={storefrontReady8394 ? "font-semibold text-emerald-800" : "font-semibold text-amber-800"}>
                  {storefrontReady8394 ? "Yes" : "No"}
                </span>
                {heroOrDefaultVariantId ? (
                  <span className="text-slate-500 text-xs ml-1">
                    (hero/default:{" "}
                    {productVariants.find((x) => x.id === heroOrDefaultVariantId)?.colorName ||
                      heroOrDefaultVariantId}
                    )
                  </span>
                ) : null}
              </span>
              <span>
                <span className="text-slate-500">Catalog complete</span>{" "}
                <span className={catalogReady8394 ? "font-semibold text-emerald-800" : "font-semibold text-amber-800"}>
                  {catalogReady8394 ? "Yes" : "No"}
                </span>
                <span className="text-slate-500 text-xs ml-1">
                  (
                  {resolvedColorLineCountFor8394Ui != null
                    ? `${resolvedColorLineCountFor8394Ui} color${resolvedColorLineCountFor8394Ui === 1 ? "" : "s"}`
                    : `${productVariants.length} variant row${productVariants.length === 1 ? "" : "s"}`}
                  )
                </span>
              </span>
            </div>
          </div>
        )}
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
      <div className="bg-white rounded-lg shadow p-6 text-gray-900">
        {activeTab === "product" && (
          <div className="space-y-6">
            <p className="text-sm text-gray-500">
              Descriptions, SEO, tags, collections, and taxonomy classification.
            </p>

            {treatsAsParentProduct && (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Sizes (from blank)</h2>
                <p className="text-xs text-gray-500 mb-3">
                  Derived from the linked blank for UI and preview. The blank is the source of truth — use{" "}
                  <span className="font-medium">Refresh from sources</span> below after changing sizes on the blank.
                  {product.blankId ? (
                    <>
                      {" "}
                      <Link
                        href={`/blanks/${encodeURIComponent(product.blankId)}?tab=shopify`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        Edit blank sizes
                      </Link>
                    </>
                  ) : null}
                </p>
                {product.availableSizes && product.availableSizes.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {product.availableSizes.map((s) => (
                      <span
                        key={s}
                        className="inline-flex px-2.5 py-1 rounded-md bg-white border border-gray-200 text-sm font-medium text-gray-800"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No sizes copied yet — configure garment sizes on the blank, then refresh merchandising.
                  </p>
                )}
              </div>
            )}

            {treatsAsParentProduct && show8394VariantReadinessUi && (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Color variants (8394 assets)</h2>
                <p className="text-xs text-gray-600 mb-3">
                  Back mock/hero, back fabric blend, front clean/hero — per color. Storefront ready when the hero/default row is
                  base complete; catalog when every row is.
                </p>
                <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                        <th className="py-2 px-3 font-medium">Color</th>
                        <th className="py-2 px-3 font-medium">Blank variant</th>
                        <th className="py-2 px-3 font-medium">Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productVariants.map((v) => {
                        const st = readinessStateForVariant(v);
                        const isHero = v.id === heroOrDefaultVariantId;
                        return (
                          <tr key={v.id} className="border-b border-gray-100 last:border-b-0">
                            <td className="py-2 px-3 text-gray-900">
                              <span className="font-medium">{v.colorName || v.blankVariantId || v.id}</span>
                              {isHero ? (
                                <span className="ml-2 inline-block text-[10px] font-semibold uppercase text-blue-700">
                                  hero/default
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2 px-3 text-xs text-gray-600 font-mono">{v.blankVariantId || "—"}</td>
                            <td className="py-2 px-3">
                              <Variant8394ReadinessBadge
                                state={st}
                                title={st === "error" ? failedMockByVariant[v.id] : undefined}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Merchandising */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Merchandising</h2>
                {treatsAsParentProduct && (
                  <button
                    type="button"
                    onClick={() => void handleRefreshFromSources()}
                    disabled={refreshingFromSources}
                    className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    {refreshingFromSources ? "Refreshing…" : "Refresh from sources"}
                  </button>
                )}
              </div>
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description (plain text)</label>
                  <textarea
                    value={merchandising.descriptionText}
                    onChange={(e) => setMerchandising((m) => ({ ...m, descriptionText: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Short plain-text description for internal editing and listings"
                  />
                  {product.descriptionHtml && (
                    <p className="text-xs text-gray-500 mt-1">
                      Storefront HTML is stored separately in <span className="font-mono">descriptionHtml</span> (see Shopify
                      preview). This field does not edit that HTML.
                    </p>
                  )}
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tags (derived from taxonomy)</label>
                  <input
                    type="text"
                    readOnly
                    value={merchandising.tagsStr}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-800"
                    placeholder="Save taxonomy to generate tags"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Tags are rebuilt from taxonomy + blank (dual-layer spec). Save taxonomy or merchandising to refresh.
                  </p>
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
                      const tagList = buildProductTagsFromRpProduct(product, currentBlank ?? null);
                      const tagNorm = tagsNormalizedFromTags(tagList);
                      await updateDoc(productRef, {
                        title: merchandising.title || null,
                        handle: merchandising.handle || null,
                        descriptionText: merchandising.descriptionText.trim() || null,
                        seo: {
                          title: merchandising.seoTitle || null,
                          description: merchandising.seoDescription || null,
                        },
                        tags: tagList,
                        tagsNormalized: tagNorm,
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

            {/* Taxonomy */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Taxonomy</h2>
              <p className="text-xs text-gray-500 mb-3">
                Entity requires League; League requires Sport. Sport can be left empty only for purely thematic/lifestyle products (e.g. PANTY_DROP, PEPTIDES, COUNTRY_CLUB). College: use Sport = COLLEGE_SPORTS, League = NCAA, Entity = school code (e.g. COLORADO).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sport</label>
                  <select
                    value={taxSportCode ?? ""}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setTaxSportCode(v);
                      if (!v) setTaxLeagueCode(null);
                      setTaxTeamId(null);
                      setTaxThemeCode(null);
                    }}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white text-sm"
                  >
                    <option value="">—</option>
                    {(taxonomySports ?? []).map((s) => (
                      <option key={s.id} value={s.code}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">League</label>
                  <select
                    value={taxLeagueCode ?? ""}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setTaxLeagueCode(v);
                      setTaxTeamId(null);
                    }}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white text-sm"
                  >
                    <option value="">—</option>
                    {(taxonomyLeagues ?? []).map((l) => (
                      <option key={l.id} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Entity</label>
                  <select
                    value={taxTeamId ?? ""}
                    onChange={(e) => setTaxTeamId(e.target.value || null)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white text-sm"
                  >
                    <option value="">—</option>
                    {taxTeamId && !resolveTaxonomyEntity(taxTeamId, taxonomyEntities) ? (
                      <option value={taxTeamId}>Legacy entity — choose canonical team from list</option>
                    ) : null}
                    {(taxonomyEntities ?? []).map((ent) => (
                      <option key={ent.id} value={ent.code}>{ent.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Theme</label>
                  <select
                    value={taxThemeCode ?? ""}
                    onChange={(e) => setTaxThemeCode(e.target.value || null)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white text-sm"
                  >
                    <option value="">—</option>
                    {taxThemeCode && !taxonomyThemes.some((t) => t.code === taxThemeCode) ? (
                      <option value={taxThemeCode}>{taxThemeCode} (on product)</option>
                    ) : null}
                    {(taxonomyThemes ?? []).map((t) => (
                      <option key={t.id} value={t.code}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Design Family</label>
                  <select
                    value={taxDesignFamily ?? ""}
                    onChange={(e) => setTaxDesignFamily(e.target.value || null)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white text-sm"
                  >
                    <option value="">—</option>
                    {taxDesignFamily && !taxonomyDesignFamilies.some((f) => f.code === taxDesignFamily) ? (
                      <option value={taxDesignFamily}>{taxDesignFamily} (on product)</option>
                    ) : null}
                    {(taxonomyDesignFamilies ?? []).map((f) => (
                      <option key={f.id} value={f.code}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleSaveProductTaxonomy}
                  disabled={isSavingTaxonomy}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingTaxonomy ? "Saving…" : "Save taxonomy"}
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Product overview</h2>
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
                  <dd className="mt-1 text-sm text-gray-900">{product.colorway?.name ?? "—"}</dd>
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

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Asset statistics</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-gray-900">{product.counters?.assetsTotal || 0}</div>
                  <div className="text-xs text-gray-500 mt-1">Total assets</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">{product.counters?.assetsApproved || 0}</div>
                  <div className="text-xs text-gray-500 mt-1">Approved</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-600">{product.counters?.assetsPublished || 0}</div>
                  <div className="text-xs text-gray-500 mt-1">Published</div>
                </div>
              </div>
            </div>

            {relatedProducts.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Related products</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {relatedProducts.map(({ product: p, reasons }) => {
                    const thumb = p.media?.heroFront ?? p.media?.heroBack ?? p.mockupUrl ?? p.heroAssetPath;
                    const title = p.title ?? p.name;
                    const descriptor = [p.colorway?.name, p.category, p.baseProductKey].filter(Boolean).join(" · ");
                    return (
                      <Link
                        key={p.id ?? p.slug}
                        href={`/products/${encodeURIComponent(p.slug)}`}
                        className="block rounded-lg border border-gray-200 bg-gray-50/50 p-3 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                      >
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full aspect-square object-cover rounded mb-2 bg-white" />
                        ) : (
                          <div className="w-full aspect-square rounded mb-2 bg-gray-200 flex items-center justify-center text-gray-400 text-xs">
                            No image
                          </div>
                        )}
                        <div className="text-sm font-medium text-gray-900 truncate" title={title}>
                          {title}
                        </div>
                        {descriptor && (
                          <div className="text-xs text-gray-500 truncate mt-0.5" title={descriptor}>
                            {descriptor}
                          </div>
                        )}
                        {reasons.length > 0 && (
                          <div className="text-xs text-blue-600 mt-1 flex flex-wrap gap-x-1 gap-y-0.5" title={reasons.join(", ")}>
                            {reasons.map((r) => (
                              <span key={r}>· {r}</span>
                            ))}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {product?.id && (
              <div className="border-t border-gray-200 pt-6">
                <p className="text-sm text-gray-600 mb-4">
                  Inspiration references (full library: <span className="font-medium">More → Inspirations</span>).
                </p>
                <InspirationTab product={product} productId={product.id} />
              </div>
            )}
          </div>
        )}

        {activeTab === "images" && (
          <div className="space-y-6">
            <p className="text-xs text-gray-600 rounded-md border border-gray-200 bg-slate-50/90 px-3 py-2 leading-snug">
              <span className="font-medium text-gray-800">Images</span> — color selection, source assets, and gallery.{" "}
              <button
                type="button"
                className="text-blue-600 font-semibold hover:underline"
                onClick={() => setActiveTab("generate")}
              >
                Generate tab
              </button>{" "}
              has mockups, flat/model batches, and advanced overrides.
            </p>
            {treatsAsParentProduct && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-1">Color variant</h2>
                <p className="text-xs text-gray-500 mb-3">
                  Pick which color you’re working on. Per-variant assets and mockups live on the variant document; gallery below is still product-level until variant-scoped assets are fully wired.
                </p>
                {show8394VariantReadinessUi && (
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                    <span>
                      Storefront:{" "}
                      <strong className={storefrontReady8394 ? "text-emerald-800" : "text-amber-800"}>
                        {storefrontReady8394 ? "ready" : "not ready"}
                      </strong>
                    </span>
                    <span className="text-gray-300">|</span>
                    <span>
                      Catalog:{" "}
                      <strong className={catalogReady8394 ? "text-emerald-800" : "text-amber-800"}>
                        {catalogReady8394 ? "complete" : "incomplete"}
                      </strong>
                    </span>
                  </div>
                )}
                {productVariantsLoading ? (
                  <p className="text-sm text-gray-500">Loading variants…</p>
                ) : productVariants.length > 0 ? (
                  <div className="space-y-3 max-w-xl">
                    {/**
                     * Phase 3e: batch fan-out for model realism. Single button
                     * enqueues every (color, side) with a model photo via the
                     * `enqueueProductModelRealismBatch` callable. Aggregate
                     * progress (X / Y rendered) updates live via the per-job
                     * onSnapshot subscriptions.
                     */}
                    {(() => {
                      const total = batchState.jobs.length;
                      const completed = batchState.jobs.filter((j) => j.status === "completed").length;
                      const failed = batchState.jobs.filter((j) => j.status === "failed").length;
                      const running = batchState.jobs.filter(
                        (j) => j.status === "queued" || j.status === "processing"
                      ).length;
                      const allDone = total > 0 && completed + failed === total;
                      return (
                        <div className="rounded-md border border-purple-200 bg-purple-50/60 px-3 py-2 text-xs text-purple-950">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium text-purple-900">Model realism — all colors</p>
                              <p className="text-purple-800/90 mt-0.5">
                                One click runs Flux Fill for every color × side with a model photo.
                                Each render takes ~30s and costs $ per call.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={batchState.inFlight || running > 0}
                                onClick={() => void handleEnqueueModelRealismBatch(["front", "back"])}
                                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50"
                                title="Enqueue model_front + model_back renders for every variant with a model photo"
                              >
                                {batchState.inFlight ? "Enqueueing…" : running > 0 ? `Running ${running}…` : "✨ Generate all"}
                              </button>
                              <button
                                type="button"
                                disabled={batchState.inFlight || running > 0}
                                onClick={() => void handleEnqueueModelRealismBatch(["back"])}
                                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white border border-purple-300 text-purple-900 hover:bg-purple-100 disabled:opacity-50"
                                title="Back-only: enqueue model_back renders for every variant with a model_back photo"
                              >
                                Back only
                              </button>
                            </div>
                          </div>
                          {total > 0 ? (
                            <div className="mt-2">
                              <div className="h-1.5 w-full rounded-full bg-purple-200 overflow-hidden">
                                <div
                                  className="h-full bg-purple-700 transition-all"
                                  style={{ width: `${total > 0 ? Math.round((completed / total) * 100) : 0}%` }}
                                />
                              </div>
                              <p className="text-[11px] text-purple-800 mt-1">
                                {completed} / {total} rendered
                                {failed > 0 ? ` · ${failed} failed` : ""}
                                {running > 0 ? ` · ${running} running` : ""}
                                {allDone && failed === 0 ? " · all done ✓" : ""}
                              </p>
                            </div>
                          ) : null}
                          {batchState.skipped.length > 0 ? (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-[10px] text-purple-800/80">
                                {batchState.skipped.length} skipped (click to view)
                              </summary>
                              <ul className="text-[10px] text-purple-800/80 mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                                {batchState.skipped.map((s, i) => (
                                  <li key={i} className="font-mono">
                                    {s.productVariantId.slice(0, 6)}… {s.view} — {s.reason}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                          {batchState.error ? (
                            <p className="text-[10px] text-red-700 mt-1 font-mono break-all">
                              {batchState.error}
                            </p>
                          ) : null}
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="block flex-1 min-w-[12rem]">
                        <span className="sr-only">Variant</span>
                        <select
                          value={imagesTabVariantId}
                          onChange={(e) => setImagesTabVariantId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                        >
                          {productVariants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.colorName || v.blankVariantId || v.id}
                              {v.blankVariantId ? ` · ${v.blankVariantId}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {is8394ProductContext && shopifyPreviewVariantDoc ? (
                        <Variant8394ReadinessBadge
                          state={readinessStateForVariant(shopifyPreviewVariantDoc)}
                          title={
                            readinessStateForVariant(shopifyPreviewVariantDoc) === "error" &&
                            failedMockByVariant[shopifyPreviewVariantDoc.id]
                              ? failedMockByVariant[shopifyPreviewVariantDoc.id]
                              : undefined
                          }
                        />
                      ) : null}
                    </div>
                    {is8394ProductContext && (
                      <div className="rounded-md border border-gray-100 bg-gray-50/80 p-2">
                        <p className="text-[11px] font-medium text-gray-600 mb-1.5">All colors</p>
                        <ul className="flex flex-wrap gap-1.5">
                          {productVariants.map((v) => {
                            const st = readinessStateForVariant(v);
                            const isHero =
                              v.id === (product?.heroVariantId || product?.defaultVariantId);
                            return (
                              <li key={v.id}>
                                <button
                                  type="button"
                                  onClick={() => setImagesTabVariantId(v.id)}
                                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                                    imagesTabVariantId === v.id
                                      ? "border-blue-400 bg-blue-50/90 text-gray-900"
                                      : "border-gray-200 bg-white text-gray-800 hover:border-gray-300"
                                  }`}
                                >
                                  <span className="truncate max-w-[8rem]">
                                    {v.colorName || v.blankVariantId || v.id}
                                  </span>
                                  {isHero ? (
                                    <span className="text-[10px] font-semibold uppercase text-blue-700">hero</span>
                                  ) : null}
                                  <Variant8394ReadinessBadge state={st} compact title={st === "error" ? failedMockByVariant[v.id] : undefined} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {/*
                      Phase C: scene gallery section. Renders below the variant
                      picker so the operator sees AI-generated lifestyle / studio
                      / gameday shots for the currently-selected variant. Only
                      mounted when there's a variant doc + a product id; without
                      either, generation can't run.
                    */}
                    {product?.id && shopifyPreviewVariantDoc ? (() => {
                      const flatRenders = (shopifyPreviewVariantDoc.flatRenders || {}) as Record<
                        string,
                        unknown
                      >;
                      /** Map current flatRenders keys → the canonical sourceSlot enum. */
                      const candidateSlots: RPSceneSourceSlot[] = [
                        "model_front_designed",
                        "model_back_designed",
                        "flat_front_designed",
                        "flat_back_designed",
                      ];
                      const availableSourceSlots = candidateSlots.filter((slot) => {
                        const entry = flatRenders[slot] as { url?: string } | undefined;
                        return entry && typeof entry.url === "string" && entry.url.length > 0;
                      });
                      const sceneRenders = ((shopifyPreviewVariantDoc as unknown as {
                        sceneRenders?: Record<string, RPVariantSceneRender>;
                      }).sceneRenders ?? {}) as Record<string, RPVariantSceneRender>;
                      return (
                        <SceneGallerySection
                          productId={product.id}
                          variantId={shopifyPreviewVariantDoc.id}
                          variantLabel={
                            shopifyPreviewVariantDoc.colorName ||
                            shopifyPreviewVariantDoc.blankVariantId ||
                            shopifyPreviewVariantDoc.id
                          }
                          availableSourceSlots={availableSourceSlots}
                          sceneRenders={sceneRenders}
                        />
                      );
                    })() : null}
                    {is8394ProductContext &&
                    shopifyPreviewVariantDoc &&
                    !isVariantBaseComplete8394(shopifyPreviewVariantDoc, fulfillmentPrintSides, {
                      variantMatrix: productVariants,
                      blankVariantRowForPlan:
                        currentBlank && shopifyPreviewVariantDoc.blankVariantId
                          ? getVariantById(currentBlank, shopifyPreviewVariantDoc.blankVariantId) ?? null
                          : null,
                    }) ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
                        <p className="font-medium text-amber-900 mb-1">Asset pipeline</p>
                        <p className="text-amber-800/90 mb-2">
                          Back mock:{" "}
                          <span className="font-mono text-[11px]">
                            {shopifyPreviewVariantDoc.assetPipeline?.mock_back?.status ?? "—"}
                          </span>
                          {" · "}
                          Flat render:{" "}
                          <span className="font-mono text-[11px]">
                            {shopifyPreviewVariantDoc.assetPipeline?.flat_render?.status ?? "—"}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleRetry8394MissingAssets()}
                          disabled={retrying8394Assets || !imagesTabVariantId}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                        >
                          {retrying8394Assets ? "Retrying…" : "Retry missing assets"}
                        </button>
                        <p className="text-[10px] text-amber-800/80 mt-1.5">
                          Incomplete variants are also retried automatically on a schedule.
                        </p>
                      </div>
                    ) : null}
                    {/**
                     * Phase 3 — Model realism per (color, side).
                     *
                     * Buttons enqueue an `rp_blank_preview_jobs` doc with a
                     * product binding; on Stage B completion the trigger writes
                     * the realism URL to `variant.flatRenders.model_<view>_designed`
                     * which the Shopify push reads from. Disabled when no
                     * variant is picked.
                     */}
                    {shopifyPreviewVariantDoc ? (() => {
                      const productVariantId = shopifyPreviewVariantDoc.id;
                      const blankVariantId = (shopifyPreviewVariantDoc as { blankVariantId?: string }).blankVariantId || "";
                      const jobs = modelRealismJobs[productVariantId] || {};
                      const frontJob = jobs.front;
                      const backJob = jobs.back;
                      const renderButton = (view: "front" | "back", state?: { status: string; error?: string | null }) => {
                        const running = state && (state.status === "queued" || state.status === "processing");
                        const completed = state && state.status === "completed";
                        const failed = state && state.status === "failed";
                        const label =
                          running ? `Generating ${view}… (~30s)` :
                          completed ? `✓ ${view === "front" ? "Model front" : "Model back"} rendered` :
                          failed ? `Retry ${view}` :
                          `✨ Generate model ${view}`;
                        return (
                          <button
                            key={view}
                            type="button"
                            disabled={!blankVariantId || running}
                            onClick={() => void handleEnqueueModelRealism(productVariantId, blankVariantId, view)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md disabled:opacity-50 ${
                              completed
                                ? "bg-emerald-700 text-white hover:bg-emerald-800"
                                : failed
                                  ? "bg-red-700 text-white hover:bg-red-800"
                                  : "bg-purple-700 text-white hover:bg-purple-800"
                            }`}
                            title={
                              !blankVariantId
                                ? "Variant has no blankVariantId yet"
                                : `Run Phase 2 Flux Fill on the ${view === "front" ? "model_front" : "model_back"} photo and save to variant.flatRenders.model_${view}_designed. Costs $ per call.`
                            }
                          >
                            {label}
                          </button>
                        );
                      };
                      const anyError = frontJob?.error || backJob?.error;
                      return (
                        <div className="mt-3 rounded-md border border-purple-200 bg-purple-50/60 px-3 py-2 text-xs text-purple-950">
                          <p className="font-medium text-purple-900 mb-1">
                            Model realism — {(shopifyPreviewVariantDoc as { colorName?: string }).colorName || "this color"}
                          </p>
                          <p className="text-purple-800/90 mb-2">
                            One Flux Fill render per side. Result lands on this variant&apos;s{" "}
                            <code className="font-mono text-[11px]">flatRenders.model_*_designed.url</code>{" "}
                            and is picked up by the Shopify push.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {renderButton("front", frontJob)}
                            {renderButton("back", backJob)}
                          </div>
                          {anyError ? (
                            <p className="text-[10px] text-red-700 mt-1.5 font-mono break-all">
                              {anyError}
                            </p>
                          ) : null}
                          <p className="text-[10px] text-purple-800/80 mt-1.5">
                            Server rejects if the variant has no model photo for the requested side, or if no mask exists and the design overflows.
                          </p>
                        </div>
                      );
                    })() : null}
                  </div>
                ) : (
                  <p className="text-sm text-amber-800">No variants under this product yet.</p>
                )}
              </div>
            )}
            {/* Advanced: Render Setup (product.renderSetup: front and back configs; no renderSide) */}
            <details className="border border-gray-200 rounded-lg bg-gray-50/50 group">
              <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-gray-900 flex items-center justify-between">
                <span>Advanced render setup</span>
                <span className="text-xs font-normal text-gray-500 group-open:hidden">Blank, placement, front/back — expand to edit</span>
              </summary>
              <div className="px-4 pb-4 pt-0 border-t border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 sr-only">Render Setup</h2>
              {product?.blankId ? (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-2.5 text-sm text-gray-800">
                  <p className="font-semibold text-gray-900">Blank render profile (canonical)</p>
                  <p className="text-xs mt-1 leading-snug">
                    Position, scale, safe area, and zone blend defaults live on the blank. Products{" "}
                    <strong>inherit</strong> those settings unless you add a{" "}
                    <strong className="text-amber-900">product override</strong> (advanced).
                  </p>
                  <Link
                    href={`/blanks/${encodeURIComponent(product.blankId)}`}
                    className="inline-block mt-2 text-xs font-semibold text-blue-700 hover:text-blue-900 underline"
                  >
                    Open blank render profile →
                  </Link>
                </div>
              ) : null}
              <p className="text-xs text-gray-600 mb-3">
                Link blank + design per side. Placement numbers below follow the blank unless overridden.
                {blankDefaultIsBackOnly ? (
                  <span className="block mt-1 text-gray-700">
                    <strong>8394 bikini:</strong> default layout is <strong>back print only</strong> (no front graphic from the linked design).
                  </span>
                ) : null}
              </p>

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
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {(blankForFallback || currentBlank)?.styleName ?? (blankForFallback || currentBlank)?.slug ?? "Blank"}
                            </p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setRenderSetupModal("blank_front")}
                              disabled={savingRenderSetup}
                              className="text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                            >
                              Change
                            </button>
                            <a href={effectiveFrontConfig.blankImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium">
                              View full
                            </a>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-amber-600">No blank. <button type="button" onClick={() => setRenderSetupModal("blank_front")} className="text-blue-600 underline">Pick blank</button></p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Design</label>
                      {blankDefaultIsBackOnly && !explicitFrontDesignOnProduct ? (
                        <p className="text-sm text-gray-800 leading-snug">
                          <span className="font-mono text-gray-900">8394</span> uses a <strong>back-only</strong> print. Use{" "}
                          <strong>Back → Set design</strong> to attach artwork. The front stays blank unless you add an optional
                          front design in Firestore.
                        </p>
                      ) : designFrontUrl ? (
                        <>
                          <div className="flex gap-2 items-center">
                            <img src={designFrontUrl} alt="Front design" className="w-12 h-12 object-contain bg-gray-100 rounded" />
                            <p className="text-sm font-medium text-gray-900 truncate">{designFront?.name ?? "Design"}</p>
                          </div>
                          <div className="mt-1 flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setRenderSetupModal("design_front")}
                              disabled={savingRenderSetup}
                              className="text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                            >
                              Change
                            </button>
                            <button type="button" onClick={() => clearDesignForSide("front")} disabled={savingRenderSetup} className="text-xs px-2 py-1 text-amber-900 border border-amber-500 rounded hover:bg-amber-50">Remove design</button>
                            <a href={designFrontUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium">View full</a>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <p className="text-xs text-amber-700 font-medium">No design.</p>
                          <button type="button" onClick={() => setRenderSetupModal("design_front")} disabled={savingRenderSetup} className="text-xs px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Set design</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Placement</label>
                      <p className="text-sm font-mono text-gray-700">{effectiveFrontConfig.placementKey ?? "front_center"}</p>
                      {product?.blankId ? (
                        <p className="text-[11px] text-gray-700 mt-1">
                          {hasProductPlacementOverride(product, "front") ? (
                            <span className="font-medium text-amber-800">Product override</span>
                          ) : (
                            <span>
                              <span className="font-medium text-green-800">Inherited from blank</span>
                              <span className="text-gray-600"> (blank default)</span>
                            </span>
                          )}
                        </p>
                      ) : null}
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
                          className="mt-1 text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                        >
                          Override placement (advanced)
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
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {(blankForFallback || currentBlank)?.styleName ?? (blankForFallback || currentBlank)?.slug ?? "Blank"}
                            </p>
                          </div>
                          <div className="mt-1 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setRenderSetupModal("blank_back")}
                              disabled={savingRenderSetup}
                              className="text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                            >
                              Change
                            </button>
                            <a href={effectiveBackConfig.blankImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium">
                              View full
                            </a>
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
                            <p className="text-sm font-medium text-gray-900 truncate">{designBack?.name ?? "Design"}</p>
                          </div>
                          <div className="mt-1 flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setRenderSetupModal("design_back")}
                              disabled={savingRenderSetup}
                              className="text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                            >
                              Change
                            </button>
                            <button type="button" onClick={() => clearDesignForSide("back")} disabled={savingRenderSetup} className="text-xs px-2 py-1 text-amber-900 border border-amber-500 rounded hover:bg-amber-50">Remove design</button>
                            <a href={designBackUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium">View full</a>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <p className="text-xs text-amber-700 font-medium">No design.</p>
                          <button type="button" onClick={() => setRenderSetupModal("design_back")} disabled={savingRenderSetup} className="text-xs px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Set design</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Placement</label>
                      <p className="text-sm font-mono text-gray-700">{effectiveBackConfig.placementKey ?? "back_center"}</p>
                      {product?.blankId ? (
                        <p className="text-[11px] text-gray-700 mt-1">
                          {hasProductPlacementOverride(product, "back") ? (
                            <span className="font-medium text-amber-800">Product override</span>
                          ) : (
                            <span>
                              <span className="font-medium text-green-800">Inherited from blank</span>
                              <span className="text-gray-600"> (blank default)</span>
                            </span>
                          )}
                        </p>
                      ) : null}
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
                          className="mt-1 text-xs px-2 py-1 bg-gray-100 border border-gray-500 text-gray-800 rounded hover:bg-gray-200"
                        >
                          Override placement (advanced)
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
            </details>

            {/* Section C — Media (hero slots; assign under Gallery & heroes on Images tab) */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Media</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">Hero front</div>
                  {product.media?.heroFront ? (
                    <img src={product.media.heroFront} alt="Hero front" className="max-w-full h-32 object-contain border border-gray-200 rounded" />
                  ) : (
                    <p className="text-sm text-gray-500">Not set. Use Images → Gallery & heroes to set as hero front.</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">Hero back</div>
                  {product.media?.heroBack ? (
                    <img src={product.media.heroBack} alt="Hero back" className="max-w-full h-32 object-contain border border-gray-200 rounded" />
                  ) : (
                    <p className="text-sm text-gray-500">Not set. Use Images → Gallery & heroes to set as hero back.</p>
                  )}
                </div>
              </div>
              {(!product.media?.heroFront || !product.media?.heroBack) && (
                <p className="text-xs text-gray-500 mt-2">Blank + design mockup can be used as hero; assign under Images → Gallery & heroes when available.</p>
              )}
            </div>

            {/* 8394 back print tuning — same blank, product-level previews */}
            {is8394ProductContext && product.blankId && (
              <div className="border-2 border-indigo-200 rounded-xl p-5 bg-gradient-to-b from-indigo-50/90 to-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-indigo-950">8394 — back print previews</h2>
                    <p className="text-sm text-indigo-900/80 mt-1 max-w-2xl">
                      <strong>Natural preview</strong> shows the print on the garment as-is. <strong>Fabric blend</strong> uses
                      the same <strong>Position</strong> and <strong>Size</strong> from the blank, plus <strong>Realism</strong>{" "}
                      and <strong>Ink strength</strong> from the blank profile. After you change the blank, tap{" "}
                      <strong>Generate</strong> here to refresh.
                    </p>
                    {currentBlank?.preferredFlatLook8394 ? (
                      <p className="text-xs text-indigo-900/90 mt-2 rounded-lg bg-white/80 border border-indigo-200/80 px-2.5 py-1.5 inline-block">
                        Blank <strong>preferred reference</strong>:{" "}
                        {currentBlank.preferredFlatLook8394 === "flat_clean" ? (
                          <>Natural preview</>
                        ) : (
                          <>Fabric blend</>
                        )}
                      </p>
                    ) : null}
                    <p className="text-xs text-indigo-800/75 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/blanks/${product.blankId}?tab=renderProfile`}
                        className="font-semibold text-indigo-700 underline hover:text-indigo-900"
                      >
                        Edit blank (Position, Size, Realism, Ink strength)
                      </Link>
                      <span className="text-indigo-400">→</span>
                      <span>Save on blank</span>
                      <span className="text-indigo-400">→</span>
                      <span className="font-medium">Generate here</span>
                      <span className="text-indigo-400">→</span>
                      <span>Click a preview to zoom in</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      generatingFlatRenders ||
                      !product.id ||
                      !isProductInFlatRenderMvpScope(product, currentBlank) ||
                      !designForFlatRender ||
                      designFlatLoading ||
                      blankLoading
                    }
                    onClick={handleGenerateFlatRenders}
                    className="px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0 shadow"
                  >
                    {generatingFlatRenders ? "Generating…" : "Generate previews"}
                  </button>
                </div>

                <FlatRender8394LastRunQaPanel
                  lines={lastFlatRenderSelectionLog}
                  lastPayload={lastFlatRender8394Payload}
                  variant={shopifyPreviewVariantDoc}
                />

                <RenderTargetTuningQaSummary lines={lastFlatRenderSelectionLog} />

                {lastFlatRenderSelectionLog && lastFlatRenderSelectionLog.length > 0 ? (
                  <details className="mb-4 rounded-lg border border-indigo-200 bg-white/95 text-xs text-indigo-950 shadow-sm">
                    <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-indigo-900 hover:bg-indigo-50/80 rounded-lg">
                      Flat render target debug (raw log)
                    </summary>
                    <ul className="list-none border-t border-indigo-100 px-3 py-2 space-y-0.5 font-mono text-[11px] text-gray-800 max-h-48 overflow-y-auto">
                      {lastFlatRenderSelectionLog.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {linked8394Nav.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 text-sm text-indigo-950 bg-white/70 border border-indigo-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide shrink-0">Same blank</span>
                    {linkedNavMeta.prev ? (
                      <Link
                        href={`/products/${linkedNavMeta.prev.slug}`}
                        className="font-medium text-indigo-700 hover:text-indigo-900 underline shrink-0"
                      >
                        ← Previous
                      </Link>
                    ) : (
                      <span className="text-gray-400 shrink-0">← Previous</span>
                    )}
                    <label className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial">
                      <span className="sr-only">Jump to linked product</span>
                      <select
                        className="border border-indigo-200 rounded-lg px-2 py-1.5 text-sm bg-white max-w-[min(100%,280px)] truncate"
                        value={product.slug}
                        onChange={(e) => router.push(`/products/${e.target.value}`)}
                      >
                        {linked8394Nav.map((p) => (
                          <option key={p.id} value={p.slug}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {linkedNavMeta.next ? (
                      <Link
                        href={`/products/${linkedNavMeta.next.slug}`}
                        className="font-medium text-indigo-700 hover:text-indigo-900 underline shrink-0"
                      >
                        Next →
                      </Link>
                    ) : (
                      <span className="text-gray-400 shrink-0">Next →</span>
                    )}
                  </div>
                )}

                {!isProductInFlatRenderMvpScope(product, currentBlank) && (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                    To generate here you need this product on master blank <strong>8394</strong>, a chosen color variant, a{" "}
                    <strong>back</strong> garment photo for that variant, and a design with PNG artwork.
                  </p>
                )}

                {mvp8394VerifyPanel && (
                  <div className="mb-4 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs text-gray-700 space-y-3">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                      <div>
                        <span className="font-semibold text-gray-500 uppercase tracking-wide">Position</span>
                        <p className="mt-0.5 text-gray-700">
                          Set on the blank (drag the print in Render profile). This product uses the saved placement for the back
                          zone.
                        </p>
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 uppercase tracking-wide">Realism · Ink strength · Size</span>
                        <p className="mt-0.5">
                          {mvp8394VerifyPanel.simple8394 ? (
                            <>
                              Realism <strong>{mvp8394VerifyPanel.simple8394.realism}</strong> · Ink strength{" "}
                              <strong>{mvp8394VerifyPanel.simple8394.inkStrength}</strong> · Size{" "}
                              <strong>{mvp8394VerifyPanel.sizePresetLabel}</strong>
                            </>
                          ) : (
                            <span className="text-amber-800">Not set on blank — open Render profile and save.</span>
                          )}
                        </p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-1">
                        <span className="font-semibold text-gray-500 uppercase tracking-wide">This product</span>
                        <p className="mt-0.5 break-all">
                          Color: <strong>{mvp8394VerifyPanel.variantLabel}</strong>
                          <br />
                          Garment photo (back):{" "}
                          {mvp8394VerifyPanel.variantBackUrl ? (
                            <a href={mvp8394VerifyPanel.variantBackUrl} className="text-indigo-600 underline" target="_blank" rel="noreferrer">
                              View
                            </a>
                          ) : (
                            <span className="text-red-600">Missing</span>
                          )}
                          <br />
                          Design PNG ({mvp8394VerifyPanel.designPick.ref}):{" "}
                          {mvp8394VerifyPanel.designPick.url ? (
                            <a href={mvp8394VerifyPanel.designPick.url} className="text-indigo-600 underline" target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            <span className="text-red-600">Missing</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {mvp8394FlatBackEngineQa ? (
                      <div className="pt-2 border-t border-indigo-100">
                        <span className="font-semibold text-gray-500 uppercase tracking-wide">
                          Resolved 8394 engine (flat_back)
                        </span>
                        <p className="text-[10px] text-gray-500 mt-0.5 mb-1.5 font-sans leading-snug">
                          From <code className="bg-indigo-50/80 px-1 rounded">renderProfile.renderTargets.flat_back</code> merge
                          (QA — same curves as compositor).
                        </p>
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 font-mono text-[10px] text-gray-900">
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-600 font-sans">Realism (0–100)</dt>
                            <dd>{mvp8394FlatBackEngineQa.realism0to100}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-600 font-sans">Ink (0–100)</dt>
                            <dd>{mvp8394FlatBackEngineQa.inkStrength0to100}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-600 font-sans">Blend opacity</dt>
                            <dd>{mvp8394FlatBackEngineQa.effectiveBlendOpacity.toFixed(3)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-600 font-sans">Ink multiplier</dt>
                            <dd>{mvp8394FlatBackEngineQa.effectiveInkMultiplier.toFixed(3)}</dd>
                          </div>
                        </dl>
                        <p className="text-[9px] text-gray-500 mt-1 font-sans">
                          Layer mode <span className="font-mono">{mvp8394FlatBackEngineQa.blendMode}</span>
                        </p>
                      </div>
                    ) : null}
                    {mvp8394PreviewOfficialBlendParity ? (
                      <div className="pt-2 border-t border-amber-200/80 bg-amber-50/40 rounded px-2 py-1.5">
                        <span className="font-semibold text-amber-900 uppercase tracking-wide text-[10px]">
                          Preview vs official effective blend parity
                        </span>
                        <p className="text-[9px] text-amber-900/80 mt-0.5 mb-1.5 font-sans leading-snug">
                          Base zone: <code className="bg-white/80 px-0.5 rounded">mapRealismToBlendPreview</code> vs{" "}
                          <code className="bg-white/80 px-0.5 rounded">mapRealismToBlend</code>, then{" "}
                          <code className="bg-white/80 px-0.5 rounded">resolveBlendedPreviewBlend8394</code> (same as Sharp
                          when blended).
                        </p>
                        {(["flat_back", "model_back"] as const).map((target) => {
                          const row = mvp8394PreviewOfficialBlendParity[target];
                          return (
                            <div key={target} className="mb-2 last:mb-0">
                              <div className="text-[10px] font-medium text-gray-700 font-mono">{target}</div>
                              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[9px] text-gray-900 mt-0.5">
                                <div>
                                  <dt className="text-gray-600 font-sans inline mr-1">previewBlendResolved</dt>
                                  <dd className="inline">
                                    {row.previewBlendResolved.blendMode} · {row.previewBlendResolved.blendOpacity.toFixed(3)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-gray-600 font-sans inline mr-1">officialBlendResolved</dt>
                                  <dd className="inline">
                                    {row.officialBlendResolved.blendMode} · {row.officialBlendResolved.blendOpacity.toFixed(3)}
                                  </dd>
                                </div>
                                <div className="sm:col-span-2">
                                  <dt className="text-gray-600 font-sans inline mr-1">parityStatus</dt>
                                  <dd
                                    className={`inline font-semibold ${
                                      row.parityStatus === "match" ? "text-emerald-700" : "text-red-700"
                                    }`}
                                  >
                                    {row.parityStatus}
                                  </dd>
                                  {row.fieldDiffs.length > 0 ? (
                                    <span className="block text-red-700 mt-0.5">fieldDiffs: {row.fieldDiffs.join("; ")}</span>
                                  ) : null}
                                </div>
                              </dl>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {mvp8394StorefrontOfficialDriftProof ? (
                      <div className="pt-2 border-t border-slate-200 bg-slate-50/80 rounded px-2 py-1.5 space-y-2">
                        <span className="font-semibold text-slate-800 uppercase tracking-wide text-[10px]">
                          Storefront URL vs newest official (Giants 8394 black: pick that color on Images tab)
                        </span>
                        <p className="text-[9px] text-slate-600 font-sans leading-snug">
                          Open browser DevTools → Console for a full{" "}
                          <code className="bg-white/90 px-0.5 rounded">[8394 drift proof]</code> object when variant debug
                          is on. Compares <code className="bg-white/90 px-0.5 rounded">flatRenders</code> slots to newest
                          official <code className="bg-white/90 px-0.5 rounded">generatedRenderOutputs</code> rows.
                        </p>
                        {(["flat_back", "model_back"] as const).map((target) => {
                          const bp = mvp8394StorefrontOfficialDriftProof.blendParity[target];
                          return (
                            <div key={`bp-${target}`} className="text-[9px] font-mono text-slate-900 border border-slate-200/80 rounded p-1.5 bg-white/90">
                              <div className="font-sans font-semibold text-slate-600 mb-0.5">{target} blend parity</div>
                              {bp ? (
                                <>
                                  <div>previewBlendResolved: {bp.previewBlendResolved.blendMode} · {bp.previewBlendResolved.blendOpacity.toFixed(3)}</div>
                                  <div>officialBlendResolved: {bp.officialBlendResolved.blendMode} · {bp.officialBlendResolved.blendOpacity.toFixed(3)}</div>
                                  <div>parityStatus: {bp.parityStatus}</div>
                                  <div>fieldDiffs: {bp.fieldDiffs.length ? bp.fieldDiffs.join("; ") : "[]"}</div>
                                </>
                              ) : (
                                <div className="text-slate-500">— (need design tone pick)</div>
                              )}
                            </div>
                          );
                        })}
                        <div className="text-[9px] font-mono text-slate-900 space-y-0.5 break-all">
                          <div>
                            displayed storefront gallery[0]:{" "}
                            <span className="text-indigo-800">
                              {mvp8394StorefrontOfficialDriftProof.displayed.storefrontGalleryFirstUrl || "—"}
                            </span>
                          </div>
                          <div>
                            primary resolver (commerce): {mvp8394StorefrontOfficialDriftProof.displayed.primaryResolvedSource} →{" "}
                            <span className="text-indigo-800">{mvp8394StorefrontOfficialDriftProof.displayed.primaryResolvedUrl || "—"}</span>
                          </div>
                          <div>
                            displayed flat_blended.back:{" "}
                            <span className="text-indigo-800">
                              {mvp8394StorefrontOfficialDriftProof.displayed.flatBlendedBackUrl || "—"}
                            </span>
                          </div>
                          <div>
                            newest official flat_back:{" "}
                            <span className="text-indigo-800">
                              {mvp8394StorefrontOfficialDriftProof.newestOfficial.flat_back.url || "—"}
                            </span>
                          </div>
                          <div>
                            flat URL identical:{" "}
                            <span
                              className={
                                mvp8394StorefrontOfficialDriftProof.identity.flatBlendedBackUrl_equals_newestOfficialFlatBack
                                  ? "text-emerald-700"
                                  : "text-red-700"
                              }
                            >
                              {String(mvp8394StorefrontOfficialDriftProof.identity.flatBlendedBackUrl_equals_newestOfficialFlatBack)}
                            </span>
                          </div>
                          <div>
                            displayed model_blended.back:{" "}
                            <span className="text-indigo-800">
                              {mvp8394StorefrontOfficialDriftProof.displayed.modelBlendedBackUrl || "—"}
                            </span>
                          </div>
                          <div>
                            newest official model_back:{" "}
                            <span className="text-indigo-800">
                              {mvp8394StorefrontOfficialDriftProof.newestOfficial.model_back.url || "—"}
                            </span>
                          </div>
                          <div>
                            model URL identical:{" "}
                            <span
                              className={
                                mvp8394StorefrontOfficialDriftProof.identity.modelBlendedBackUrl_equals_newestOfficialModelBack
                                  ? "text-emerald-700"
                                  : "text-red-700"
                              }
                            >
                              {String(mvp8394StorefrontOfficialDriftProof.identity.modelBlendedBackUrl_equals_newestOfficialModelBack)}
                            </span>
                          </div>
                          <div className="text-[8px] text-slate-600 font-sans pt-1 border-t border-slate-200 mt-1">
                            media.heroBack: {mvp8394StorefrontOfficialDriftProof.displayed.mediaHeroBackUrl || "—"} (last official
                            job wins)
                          </div>
                          {mvp8394StorefrontOfficialDriftProof.firstDriftHintIfUrlsAligned ? (
                            <div className="text-[9px] text-slate-700 font-sans pt-1 leading-snug">
                              {mvp8394StorefrontOfficialDriftProof.firstDriftHintIfUrlsAligned}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {(() => {
                  const slotClean = product.flatRenders?.flat_clean?.back;
                  const slotBlended = product.flatRenders?.flat_blended?.back;
                  const staleClean =
                    flatRenderFingerprint != null && isFlatRenderSlotStale(slotClean, flatRenderFingerprint);
                  const staleBlended =
                    flatRenderFingerprint != null && isFlatRenderSlotStale(slotBlended, flatRenderFingerprint);
                  const fmtTs = (ts: unknown) => {
                    if (ts && typeof (ts as { toDate?: () => Date }).toDate === "function") {
                      return (ts as { toDate: () => Date }).toDate().toLocaleString();
                    }
                    return "—";
                  };

                  const panel = (
                    kind: "clean" | "blended",
                    title: string,
                    subtitle: string,
                    zoomCaption: string,
                    slot: typeof slotClean,
                    stale: boolean
                  ) => {
                    const missing = !slot?.url;
                    return (
                      <div
                        className={`flex flex-col rounded-xl border-2 overflow-hidden bg-white ${
                          kind === "clean" ? "border-emerald-300/90 shadow-emerald-100/50" : "border-violet-300/90 shadow-violet-100/50"
                        } shadow-md`}
                      >
                        <div
                          className={`px-3 py-2 text-white text-center ${
                            kind === "clean" ? "bg-emerald-600" : "bg-violet-600"
                          }`}
                        >
                          <div className="text-sm font-bold tracking-wide">{title}</div>
                          <div className="text-[11px] opacity-90 font-normal">{subtitle}</div>
                        </div>
                        <div className="p-3 flex flex-col flex-1 min-h-[220px]">
                          {missing ? (
                            <div className="flex-1 flex items-center justify-center rounded-lg bg-gray-50 border border-dashed border-gray-300 text-gray-500 text-sm font-medium px-4 text-center">
                              No preview yet — tap Generate previews
                            </div>
                          ) : stale ? (
                            <p className="text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1.5 mb-2 text-center">
                              Out of date — blank or design changed. Generate again to match the blank.
                            </p>
                          ) : (
                            <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 mb-2 text-center">
                              Matches blank + design
                            </p>
                          )}
                          {!missing && (
                            <button
                              type="button"
                              onClick={() => openLightbox(slot.url, zoomCaption)}
                              className="flex-1 flex flex-col items-stretch rounded-lg border border-gray-100 bg-gray-50 min-h-[200px] group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              <span className="sr-only">Enlarge {title}</span>
                              <span className="flex-1 flex items-center justify-center p-1">
                                <img
                                  src={slot.url}
                                  alt={title}
                                  className="max-w-full max-h-[min(52vh,420px)] w-auto object-contain group-hover:opacity-95 transition-opacity"
                                />
                              </span>
                              <span className="text-[11px] text-center text-indigo-700 font-medium py-1.5 group-hover:underline">
                                Click to enlarge
                              </span>
                            </button>
                          )}
                          {!missing && (
                            <p className="text-[10px] text-gray-500 mt-2 text-center">
                              {fmtTs(slot.generatedAt)} · variant {slot.sourceBlankVariantId} · {slot.sourceDesignAssetRef} PNG
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                      {panel(
                        "clean",
                        "NATURAL PREVIEW",
                        "Print on garment (no fabric blending)",
                        "Natural preview — back print (flat_clean)",
                        slotClean,
                        staleClean
                      )}
                      {panel(
                        "blended",
                        "FABRIC BLEND",
                        "Realism + ink strength from blank profile",
                        "Fabric blend — back print (flat_blended)",
                        slotBlended,
                        staleBlended
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Scene render: deterministic template (non-AI) — below flat mocks */}
            {product?.id && (
              <div className="border-2 border-teal-200/90 rounded-xl p-5 bg-gradient-to-b from-teal-50/90 to-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-teal-950">
                      Scene render ·{" "}
                      {resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY ? (
                        <>Hanger (lifestyle)</>
                      ) : (
                        <span className="font-mono text-base">{resolvedSceneRenderKey}</span>
                      )}
                    </h2>
                    <p className="text-sm text-teal-900/85 mt-1 max-w-2xl">
                      <strong>Non-AI</strong> composite: your <strong>Flat blended</strong> mockup is placed into a fixed scene
                      template. Uses <strong>front</strong> flat when present, otherwise <strong>back</strong>. Resolved key:{" "}
                      <span className="font-mono">{resolvedSceneRenderKey}</span> (from blank.generationDefaults.defaultSceneRenderKey
                      or default).
                    </p>
                    {resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY ? (
                      <p className="text-sm text-teal-900/85 mt-2 max-w-2xl">
                        Hanger uses the {HANGER_CREWNECK_SCENE_TEMPLATE.garmentType} crewneck layout.
                      </p>
                    ) : null}
                    {resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY ? (
                      <p className="text-xs text-teal-800/75 mt-2">
                        Ops: set <code className="bg-teal-100/80 px-1 rounded">SCENE_HANGER_CREWNECK_BACKGROUND_URL</code> on Cloud
                        Functions. Optional: <code className="bg-teal-100/80 px-1 rounded">SCENE_HANGER_CREWNECK_SHADOW_URL</code>.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={!flatBlendedForScene || generatingSceneRender || !sceneCompositeImplemented}
                    title={
                      !sceneCompositeImplemented
                        ? `Scene key "${resolvedSceneRenderKey}" is not implemented yet (${[...IMPLEMENTED_SCENE_RENDER_KEYS].join(", ")})`
                        : undefined
                    }
                    onClick={handleGenerateSceneRender}
                    className="px-4 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 shrink-0 shadow"
                  >
                    {generatingSceneRender
                      ? "Compositing…"
                      : resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY
                        ? "Generate hanger scene"
                        : `Generate ${resolvedSceneRenderKey} scene`}
                  </button>
                </div>
                {flatBlendedForScene && !sceneCompositeImplemented && (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                    Scene key <span className="font-mono">{resolvedSceneRenderKey}</span> is not implemented in Cloud Functions yet.
                    Supported keys: <span className="font-mono">{[...IMPLEMENTED_SCENE_RENDER_KEYS].join(", ")}</span>. Adjust{" "}
                    <span className="font-mono">rp_blanks.generationDefaults.defaultSceneRenderKey</span> or wait for a template
                    for this key.
                  </p>
                )}
                {!flatBlendedForScene && (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                    Generate a <strong>fabric blend</strong> preview first (8394 section above), then run the scene composite.
                  </p>
                )}
                {flatBlendedForScene && (
                  <p className="text-xs text-teal-800 mb-3">
                    Source flat: <strong>{flatBlendedForScene.view}</strong> ·{" "}
                    <a
                      href={flatBlendedForScene.url}
                      className="text-teal-700 underline font-medium"
                      target="_blank"
                      rel="noreferrer"
                    >
                      open PNG
                    </a>
                  </p>
                )}
                {(() => {
                  const sceneSlot = product.sceneRenders?.[resolvedSceneRenderKey];
                  const fmtTs = (ts: unknown) => {
                    if (ts && typeof (ts as { toDate?: () => Date }).toDate === "function") {
                      return (ts as { toDate: () => Date }).toDate().toLocaleString();
                    }
                    return "—";
                  };
                  const genLabel =
                    resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY ? "Generate hanger scene" : `Generate ${resolvedSceneRenderKey} scene`;
                  return (
                    <div className="rounded-xl border-2 border-teal-300/80 overflow-hidden bg-white shadow-md">
                      <div className="px-3 py-2 bg-teal-700 text-white text-center">
                        <div className="text-sm font-bold tracking-wide">
                          {resolvedSceneRenderKey === DEFAULT_SCENE_RENDER_KEY
                            ? "HANGER · LIFESTYLE (TEMPLATE)"
                            : `${resolvedSceneRenderKey.toUpperCase()} · SCENE (TEMPLATE)`}
                        </div>
                        <div className="text-[11px] opacity-90 font-normal">Deterministic composite — not AI</div>
                      </div>
                      <div className="p-3">
                        {!sceneSlot?.url ? (
                          <div className="flex items-center justify-center min-h-[200px] rounded-lg bg-gray-50 border border-dashed border-gray-300 text-gray-600 text-sm font-medium text-center px-4">
                            No scene render yet — {sceneCompositeImplemented ? `click ${genLabel}` : "implement this scene key or switch blank default"}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-center bg-gray-50 rounded-lg border border-gray-100 min-h-[220px]">
                              <img
                                src={sceneSlot.url}
                                alt={`Scene render (${resolvedSceneRenderKey})`}
                                className="max-w-full max-h-[min(56vh,480px)] w-auto object-contain"
                              />
                            </div>
                            <p className="text-[10px] text-gray-500 mt-2 text-center">
                              {fmtTs(sceneSlot.generatedAt)} · scene <span className="font-mono">{sceneSlot.sceneId}</span> · from{" "}
                              {sceneSlot.sourceFlatView} flat
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

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

        {activeTab === "shopifyPreview" && product && (
          <div className="space-y-6">
            {(() => {
              const gallery = shopifyPreviewGalleryUrls;
              const price = product.pricing?.basePrice;
              const currency = product.pricing?.currencyCode ?? "USD";
              const title = product.title ?? product.name ?? "Product";
              const safeIdx = gallery.length ? Math.min(shopifyPreviewImageIdx, gallery.length - 1) : 0;
              return (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 bg-gradient-to-b from-slate-50 to-white">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Storefront preview (simulated)</h2>
                  <p className="text-xs text-gray-500 mb-4 max-w-xl">
                    Read-only mock of a Shopify product page. This does not connect to your live storefront.
                    {treatsAsParentProduct && productVariants.length > 0 ? (
                      <span className="block mt-2">
                        Images prefer the <strong>color variant</strong> selected on the Images tab (same as below).
                      </span>
                    ) : null}
                  </p>
                  {treatsAsParentProduct && productVariants.length > 0 && (
                    <div className="max-w-lg mx-auto mb-4">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Color (preview)</label>
                      <select
                        value={imagesTabVariantId}
                        onChange={(e) => setImagesTabVariantId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                      >
                        {productVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.colorName || v.blankVariantId || v.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="max-w-lg mx-auto bg-white rounded-lg shadow-md overflow-hidden border border-gray-200">
                    <div className="aspect-square bg-gray-100 flex items-center justify-center">
                      {gallery.length > 0 ? (
                        <img src={gallery[safeIdx]} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-sm text-gray-400 text-center px-4">
                          {treatsAsParentProduct && productVariants.length > 0
                            ? "No images for this color/size yet — run Generate on the Images tab for this variant, or wait for assets to finish."
                            : "No images yet — add heroes or a mockup on the Images tab"}
                        </span>
                      )}
                    </div>
                    {gallery.length > 1 && (
                      <div className="flex gap-1 px-2 py-2 overflow-x-auto border-t border-gray-100">
                        {gallery.map((u, i) => (
                          <button
                            key={u + i}
                            type="button"
                            onClick={() => setShopifyPreviewImageIdx(i)}
                            className={`shrink-0 w-14 h-14 rounded border overflow-hidden ${
                              i === safeIdx ? "ring-2 ring-blue-500" : "border-gray-200"
                            }`}
                          >
                            <img src={u} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="p-4 space-y-3">
                      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                      <p className="text-xl font-medium text-gray-900">
                        {price != null && Number.isFinite(price)
                          ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price)
                          : "—"}
                      </p>
                      {product.availableSizes && product.availableSizes.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
                          <select
                            value={previewSelectedSize || product.availableSizes[0]}
                            onChange={(e) => setPreviewSelectedSize(e.target.value as RPBlankGarmentSizeCode)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            {product.availableSizes.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Preview only — does not create inventory variants yet. Future: Color × Size.
                          </p>
                        </div>
                      )}
                      {product.descriptionHtml ? (
                        <div
                          className="prose prose-sm max-w-none text-gray-700 border-t border-gray-100 pt-3"
                          dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
                        />
                      ) : product.description ? (
                        <p className="text-sm text-gray-700 border-t border-gray-100 pt-3 whitespace-pre-wrap">
                          {product.description}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled
                        className="w-full py-3 rounded-lg bg-gray-900 text-white text-sm font-medium opacity-60 cursor-not-allowed"
                      >
                        Add to cart (preview only)
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
            {(() => {
              const { ready, missing, warnings } = isProductReadyForShopify(product, {
                mediaFallback: shopifyReadinessMediaFallback,
                activeVariants: shopifyActiveVariantsInput,
                printSides: (fulfillmentPrintSides ?? undefined) as ProductPrintSidesForCommerce | undefined,
              });
              return (
                <div className={`border rounded-lg p-4 ${ready ? "border-green-300 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Product readiness</h2>
                  <p className="text-xs text-gray-500 mb-3">Checks required for Shopify sync. Fix missing items before syncing.</p>
                  {missing.length > 0 && (
                    <ul className="space-y-1.5 mb-2">
                      {missing.map((label) => (
                        <li key={label} className="flex items-center gap-2 text-sm">
                          <span className="text-amber-700">✗</span>
                          <span className="text-amber-800">{label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {warnings.length > 0 && (
                    <p className="text-xs text-gray-500 mb-1">Recommended: {warnings.join(", ")}</p>
                  )}
                  <p className={`mt-3 text-sm font-medium ${ready ? "text-green-700" : "text-amber-700"}`}>
                    {ready ? "Ready for Shopify sync" : "Not ready — fix missing items above"}
                  </p>
                </div>
              );
            })()}
            {(() => {
              const shopifyReady = isProductReadyForShopify(product, {
                mediaFallback: shopifyReadinessMediaFallback,
                activeVariants: shopifyActiveVariantsInput,
                printSides: (fulfillmentPrintSides ?? undefined) as ProductPrintSidesForCommerce | undefined,
              });
              const shopifyTags =
                product.tags && product.tags.length > 0 ? product.tags : buildShopifyTags(product);
              return (
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
                    <div className="md:col-span-2">
                      <dt className="text-gray-500 mb-1">Tags (preview for sync)</dt>
                      <dd className="text-gray-700">
                        {shopifyTags.length > 0 ? (
                          <span className="flex flex-wrap gap-1.5">
                            {shopifyTags.map((tag) => (
                              <span key={tag} className="inline-flex px-2 py-0.5 rounded bg-blue-50 text-blue-800 text-xs font-mono">
                                {tag}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">
                            No product tags yet. Save taxonomy on the Product tab to generate dual-layer tags (human + structured).
                          </span>
                        )}
                      </dd>
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
                        <dd className="text-red-600 text-xs mt-1 flex items-start justify-between gap-3">
                          <span className="flex-1">{product.shopify.lastSyncError}</span>
                          {/* Phase K4: one-click retry next to the error. A previous
                              sync means the product was ready, so a transient Shopify
                              hiccup (rate limit, timeout) just needs a re-queue — no
                              need to scroll to the main button or re-check readiness.
                              Re-uses the existing onShopifySyncJobCreated trigger. */}
                          <button
                            type="button"
                            disabled={syncingToShopify}
                            onClick={async () => {
                              if (!db || !product?.id) return;
                              setSyncingToShopify(true);
                              try {
                                await addDoc(collection(db, "shopifySyncJobs"), {
                                  entityType: "product",
                                  entityId: product.id,
                                  action: "create_or_update",
                                  status: "queued",
                                  createdAt: serverTimestamp(),
                                });
                                showToast("Retry queued. The worker will re-attempt the sync shortly.", "success");
                              } catch (err) {
                                console.error("[Shopify retry] Failed to queue job:", err);
                                showToast("Failed to queue retry", "error");
                              } finally {
                                setSyncingToShopify(false);
                              }
                            }}
                            className="shrink-0 px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            {syncingToShopify ? "Queuing…" : "Retry sync"}
                          </button>
                        </dd>
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
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={
                        !shopifyReady.ready ||
                        syncingToShopify ||
                        (treatsAsParentProduct && productVariantsLoading)
                      }
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        treatsAsParentProduct && productVariantsLoading
                          ? "Loading variants…"
                          : !shopifyReady.ready
                          ? `Missing: ${shopifyReady.missing.join(", ")}`
                          : undefined
                      }
                      onClick={async () => {
                        if (!db || !product?.id || !shopifyReady.ready) return;
                        setSyncingToShopify(true);
                        try {
                          await addDoc(collection(db, "shopifySyncJobs"), {
                            entityType: "product",
                            entityId: product.id,
                            action: "create_or_update",
                            status: "queued",
                            createdAt: serverTimestamp(),
                          });
                          showToast("Sync job queued. The worker will process it shortly.", "success");
                        } catch (err) {
                          console.error("[Shopify sync] Failed to queue job:", err);
                          showToast("Failed to queue sync job", "error");
                        } finally {
                          setSyncingToShopify(false);
                        }
                      }}
                    >
                      {syncingToShopify ? "Queuing…" : "Sync to Shopify"}
                    </button>
                    {!shopifyReady.ready && (
                      <p className="text-xs text-amber-700 mt-2">Not ready for Shopify sync. Missing: {shopifyReady.missing.join(", ")}</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "images" && (
          <>
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Designs</h2>
                <p className="text-sm text-gray-500 mb-4">Designs linked to this product.</p>
                <DesignsTabContent
                  product={product}
                  designs={designs}
                  designsLoading={designsLoading}
                  onRefetchDesigns={refetchDesigns}
                />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Gallery & heroes</h2>
                <p className="text-sm text-gray-500 mb-4">Generated assets and hero slots for storefront.</p>
                <AssetsTab
                  product={product}
                  assets={sortedGalleryAssets}
                  assetsLoading={assetsLoading}
                  refetchAssets={refetchAssets}
                  showToast={showToast}
                  lightboxImage={lightboxImage}
                  setLightboxImage={setLightboxImageCompat}
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
              </div>

              {treatsAsParentProduct && product?.id && imagesTabVariantId ? (
                <div className="border border-indigo-100 rounded-lg p-4 bg-indigo-50/30 space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Alt scenes (v1)</h3>
                    <p className="text-xs text-gray-600 mt-1">
                      Uses the selected color variant&apos;s flat blends / heroes. Deterministic composites only; failures do
                      not block product readiness.
                    </p>
                  </div>

                  {(() => {
                    const vRow = productVariants.find((x) => x.id === imagesTabVariantId);
                    const slotHanger = vRow?.sceneTemplateRenders?.neutral_hanger;
                    return (
                      <div className="space-y-3 border-t border-indigo-100/80 pt-4">
                        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Neutral hanger</h4>
                        <p className="text-xs text-gray-600">Tees, tanks, crewnecks (not panties).</p>
                        <button
                          type="button"
                          disabled={sceneQueueBusy || !product.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                          onClick={async () => {
                            if (!product.id || !imagesTabVariantId) return;
                            setQueueingNeutralHangerScene(true);
                            try {
                              await createSceneRenderJob({
                                productId: product.id,
                                productVariantId: imagesTabVariantId,
                                sceneKey: "neutral_hanger",
                              });
                              showToast("Neutral hanger job queued. Variant list refreshes shortly.", "success");
                              setTimeout(() => setVariantReloadTick((t) => t + 1), 6000);
                            } catch (err) {
                              console.error(err);
                              showToast(err instanceof Error ? err.message : "Failed to queue scene job", "error");
                            } finally {
                              setQueueingNeutralHangerScene(false);
                            }
                          }}
                        >
                          {queueingNeutralHangerScene ? "Queuing…" : "Queue neutral hanger scene"}
                        </button>
                        {slotHanger?.assetUrl ? (
                          <div className="flex flex-wrap gap-4 items-start">
                            <a
                              href={slotHanger.assetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slotHanger.assetUrl}
                                alt="Neutral hanger"
                                className="max-h-40 rounded border border-gray-200"
                              />
                            </a>
                            <div className="text-xs text-gray-700 space-y-1 min-w-0">
                              <p>
                                Status: <span className="font-mono">{slotHanger.status}</span> · Approval:{" "}
                                <span className="font-mono">{slotHanger.approvalState}</span>
                              </p>
                              {slotHanger.assetId ? (
                                <p className="font-mono text-[10px] break-all">asset: {slotHanger.assetId}</p>
                              ) : null}
                              {slotHanger.sourceAssetRef ? (
                                <p className="text-gray-500">Source: {slotHanger.sourceAssetRef}</p>
                              ) : null}
                              {slotHanger.assetId ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotHanger.assetId!,
                                          approvalState: "approved",
                                        });
                                        showToast("Marked approved", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotHanger.assetId!,
                                          approvalState: "rejected",
                                        });
                                        showToast("Marked rejected", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No neutral_hanger output for this color yet.</p>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const vRow = productVariants.find((x) => x.id === imagesTabVariantId);
                    const slotBackdrop = vRow?.sceneTemplateRenders?.backdrop_neutral;
                    return (
                      <div className="space-y-3 border-t border-indigo-100/80 pt-4">
                        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Backdrop neutral</h4>
                        <p className="text-xs text-gray-600">Plain studio backdrop; works for panties and tops.</p>
                        <button
                          type="button"
                          disabled={sceneQueueBusy || !product.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50"
                          onClick={async () => {
                            if (!product.id || !imagesTabVariantId) return;
                            setQueueingBackdropNeutralScene(true);
                            try {
                              await createSceneRenderJob({
                                productId: product.id,
                                productVariantId: imagesTabVariantId,
                                sceneKey: "backdrop_neutral",
                              });
                              showToast("Backdrop neutral job queued. Variant list refreshes shortly.", "success");
                              setTimeout(() => setVariantReloadTick((t) => t + 1), 6000);
                            } catch (err) {
                              console.error(err);
                              showToast(err instanceof Error ? err.message : "Failed to queue scene job", "error");
                            } finally {
                              setQueueingBackdropNeutralScene(false);
                            }
                          }}
                        >
                          {queueingBackdropNeutralScene ? "Queuing…" : "Queue backdrop neutral scene"}
                        </button>
                        {slotBackdrop?.assetUrl ? (
                          <div className="flex flex-wrap gap-4 items-start">
                            <a
                              href={slotBackdrop.assetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slotBackdrop.assetUrl}
                                alt="Backdrop neutral"
                                className="max-h-40 rounded border border-gray-200"
                              />
                            </a>
                            <div className="text-xs text-gray-700 space-y-1 min-w-0">
                              <p>
                                Status: <span className="font-mono">{slotBackdrop.status}</span> · Approval:{" "}
                                <span className="font-mono">{slotBackdrop.approvalState}</span>
                              </p>
                              {slotBackdrop.assetId ? (
                                <p className="font-mono text-[10px] break-all">asset: {slotBackdrop.assetId}</p>
                              ) : null}
                              {slotBackdrop.sourceAssetRef ? (
                                <p className="text-gray-500">Source: {slotBackdrop.sourceAssetRef}</p>
                              ) : null}
                              {slotBackdrop.assetId ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBackdrop.assetId!,
                                          approvalState: "approved",
                                        });
                                        showToast("Marked approved", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBackdrop.assetId!,
                                          approvalState: "rejected",
                                        });
                                        showToast("Marked rejected", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No backdrop_neutral output for this color yet.</p>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const vRow = productVariants.find((x) => x.id === imagesTabVariantId);
                    const slotBody = vRow?.sceneTemplateRenders?.body_model;
                    return (
                      <div className="space-y-3 border-t border-indigo-100/80 pt-4">
                        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Body model (back)</h4>
                        <p className="text-xs text-gray-600">
                          Panties: worn look from body + mask + <span className="font-mono">flat_clean.back</span> (no AI).
                          Requires template art in Firestore / env.
                        </p>
                        <button
                          type="button"
                          disabled={sceneQueueBusy || !product.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-rose-900 text-white hover:bg-rose-950 disabled:opacity-50"
                          onClick={async () => {
                            if (!product.id || !imagesTabVariantId) return;
                            setQueueingBodyModelScene(true);
                            try {
                              await createSceneRenderJob({
                                productId: product.id,
                                productVariantId: imagesTabVariantId,
                                sceneKey: "body_model",
                              });
                              showToast("Body model job queued. Variant list refreshes shortly.", "success");
                              setTimeout(() => setVariantReloadTick((t) => t + 1), 6000);
                            } catch (err) {
                              console.error(err);
                              showToast(err instanceof Error ? err.message : "Failed to queue scene job", "error");
                            } finally {
                              setQueueingBodyModelScene(false);
                            }
                          }}
                        >
                          {queueingBodyModelScene ? "Queuing…" : "Queue body model (back) scene"}
                        </button>
                        {slotBody?.assetUrl ? (
                          <div className="flex flex-wrap gap-4 items-start">
                            <a
                              href={slotBody.assetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slotBody.assetUrl}
                                alt="Body model back"
                                className="max-h-40 rounded border border-gray-200"
                              />
                            </a>
                            <div className="text-xs text-gray-700 space-y-1 min-w-0">
                              <p>
                                Status: <span className="font-mono">{slotBody.status}</span> · Approval:{" "}
                                <span className="font-mono">{slotBody.approvalState}</span>
                              </p>
                              {slotBody.assetId ? (
                                <p className="font-mono text-[10px] break-all">asset: {slotBody.assetId}</p>
                              ) : null}
                              {slotBody.sourceAssetRef ? (
                                <p className="text-gray-500">Source: {slotBody.sourceAssetRef}</p>
                              ) : null}
                              {slotBody.assetId ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBody.assetId!,
                                          approvalState: "approved",
                                        });
                                        showToast("Marked approved", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBody.assetId!,
                                          approvalState: "rejected",
                                        });
                                        showToast("Marked rejected", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No body_model output for this color yet.</p>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const vRow = productVariants.find((x) => x.id === imagesTabVariantId);
                    const slotWood = vRow?.sceneTemplateRenders?.flatlay_wood;
                    return (
                      <div className="space-y-3 border-t border-indigo-100/80 pt-4">
                        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Flatlay wood</h4>
                        <p className="text-xs text-gray-600">Wood-surface flat lay (panties, tops, bralettes).</p>
                        <button
                          type="button"
                          disabled={sceneQueueBusy || !product.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-800 text-white hover:bg-amber-900 disabled:opacity-50"
                          onClick={async () => {
                            if (!product.id || !imagesTabVariantId) return;
                            setQueueingFlatlayWoodScene(true);
                            try {
                              await createSceneRenderJob({
                                productId: product.id,
                                productVariantId: imagesTabVariantId,
                                sceneKey: "flatlay_wood",
                              });
                              showToast("Flatlay wood job queued. Variant list refreshes shortly.", "success");
                              setTimeout(() => setVariantReloadTick((t) => t + 1), 6000);
                            } catch (err) {
                              console.error(err);
                              showToast(err instanceof Error ? err.message : "Failed to queue scene job", "error");
                            } finally {
                              setQueueingFlatlayWoodScene(false);
                            }
                          }}
                        >
                          {queueingFlatlayWoodScene ? "Queuing…" : "Queue flatlay wood scene"}
                        </button>
                        {slotWood?.assetUrl ? (
                          <div className="flex flex-wrap gap-4 items-start">
                            <a
                              href={slotWood.assetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slotWood.assetUrl}
                                alt="Flatlay wood"
                                className="max-h-40 rounded border border-gray-200"
                              />
                            </a>
                            <div className="text-xs text-gray-700 space-y-1 min-w-0">
                              <p>
                                Status: <span className="font-mono">{slotWood.status}</span> · Approval:{" "}
                                <span className="font-mono">{slotWood.approvalState}</span>
                              </p>
                              {slotWood.assetId ? (
                                <p className="font-mono text-[10px] break-all">asset: {slotWood.assetId}</p>
                              ) : null}
                              {slotWood.sourceAssetRef ? (
                                <p className="text-gray-500">Source: {slotWood.sourceAssetRef}</p>
                              ) : null}
                              {slotWood.assetId ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotWood.assetId!,
                                          approvalState: "approved",
                                        });
                                        showToast("Marked approved", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotWood.assetId!,
                                          approvalState: "rejected",
                                        });
                                        showToast("Marked rejected", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No flatlay_wood output for this color yet.</p>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const vRow = productVariants.find((x) => x.id === imagesTabVariantId);
                    const slotBoutique = vRow?.sceneTemplateRenders?.flatlay_boutique;
                    return (
                      <div className="space-y-3 border-t border-indigo-100/80 pt-4">
                        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Flatlay boutique</h4>
                        <p className="text-xs text-gray-600">Boutique-style flat lay (panties, bralettes, women’s tees).</p>
                        <button
                          type="button"
                          disabled={sceneQueueBusy || !product.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-800 text-white hover:bg-emerald-900 disabled:opacity-50"
                          onClick={async () => {
                            if (!product.id || !imagesTabVariantId) return;
                            setQueueingFlatlayBoutiqueScene(true);
                            try {
                              await createSceneRenderJob({
                                productId: product.id,
                                productVariantId: imagesTabVariantId,
                                sceneKey: "flatlay_boutique",
                              });
                              showToast("Flatlay boutique job queued. Variant list refreshes shortly.", "success");
                              setTimeout(() => setVariantReloadTick((t) => t + 1), 6000);
                            } catch (err) {
                              console.error(err);
                              showToast(err instanceof Error ? err.message : "Failed to queue scene job", "error");
                            } finally {
                              setQueueingFlatlayBoutiqueScene(false);
                            }
                          }}
                        >
                          {queueingFlatlayBoutiqueScene ? "Queuing…" : "Queue flatlay boutique scene"}
                        </button>
                        {slotBoutique?.assetUrl ? (
                          <div className="flex flex-wrap gap-4 items-start">
                            <a
                              href={slotBoutique.assetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slotBoutique.assetUrl}
                                alt="Flatlay boutique"
                                className="max-h-40 rounded border border-gray-200"
                              />
                            </a>
                            <div className="text-xs text-gray-700 space-y-1 min-w-0">
                              <p>
                                Status: <span className="font-mono">{slotBoutique.status}</span> · Approval:{" "}
                                <span className="font-mono">{slotBoutique.approvalState}</span>
                              </p>
                              {slotBoutique.assetId ? (
                                <p className="font-mono text-[10px] break-all">asset: {slotBoutique.assetId}</p>
                              ) : null}
                              {slotBoutique.sourceAssetRef ? (
                                <p className="text-gray-500">Source: {slotBoutique.sourceAssetRef}</p>
                              ) : null}
                              {slotBoutique.assetId ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBoutique.assetId!,
                                          approvalState: "approved",
                                        });
                                        showToast("Marked approved", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded bg-white border border-gray-300 hover:bg-gray-50"
                                    onClick={async () => {
                                      try {
                                        await updateSceneAssetApproval({
                                          assetId: slotBoutique.assetId!,
                                          approvalState: "rejected",
                                        });
                                        showToast("Marked rejected", "success");
                                        setVariantReloadTick((t) => t + 1);
                                      } catch (e) {
                                        showToast(e instanceof Error ? e.message : "Update failed", "error");
                                      }
                                    }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No flatlay_boutique output for this color yet.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : null}

            </div>
          </>
        )}

        {activeTab === "generate" && (
          <>
            <div className="space-y-6 pt-1">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Generate</h2>
              <p className="text-sm text-gray-500 mb-4">
                Run mockups, flat renders, and on-model batches. Defaults follow Blank → Team → Design → preset. Use{" "}
                <strong className="text-gray-700">Advanced overrides</strong> for one-off runs.
              </p>

              <div className="space-y-3 mb-6">
                <ResolvedGenerationSummary
                  resolved={resolved}
                  presets={allPresets}
                  loading={blankLoading || designTeamLoading}
                  defaultGenerateMode={generateMode}
                />
                {is8394ProductContext ? <Official8394EnqueuePresetReadout product={product} /> : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleGenerateWithDefaults()}
                    disabled={
                      generating ||
                      !hasMockupForGenerateUi ||
                      !resolved ||
                      (generateMode === "product"
                        ? !resolved.productOnlyPresetId.value
                        : !resolved.onModelPresetId.value)
                    }
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating
                      ? "Starting…"
                      : `Generate using defaults (${generateMode === "product" ? "product images" : "model images"})`}
                  </button>
                  <span className="text-xs text-gray-500 max-w-md">
                    Uses resolved preset and scales from the preset document. On-model also uses team/design default
                    identity when set.
                  </span>
                </div>
              </div>

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
                      <p className="text-xs text-gray-500">Choose which view to generate. Config is from Images → Render Setup (front/back).</p>

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
                                  <p className="text-xs text-amber-600">Set blank for {generateView} in Images → Render Setup.</p>
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
                                  Adjust in Images → Render Setup, or here:
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
                                  Override placement (advanced)
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {(designIdForFront || product?.designId) && product?.blankId && !hasMockupForGenerateUi && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm space-y-2">
                      <p>Generate a mockup first — this is your <strong>master composite</strong> (blank + design). You can review it here, then use it for product scene images (hangar, flat lay, etc.).</p>
                      <p className="text-amber-700 font-medium">Uses <strong>{generateView}</strong> view from Render Setup above.</p>
                      {treatsAsParentProduct && productVariants.length > 0 && !imagesTabVariantId ? (
                        <p className="text-amber-900 font-medium">Select a color variant at the top of the Images tab so the mockup saves to that variant.</p>
                      ) : null}
                      {lastMockJobId && mockJob?.status === "processing" && (
                        <p className="text-amber-800 font-medium">Creating mockup… (usually 30–60 seconds). Check Firebase Console → Functions logs if it takes longer.</p>
                      )}
                      {lastMockJobId && mockJob?.status === "failed" && (
                        <p className="text-red-700 font-medium">Mockup job failed. See error above. Fix the issue (e.g. blank/design URLs, Storage permissions) and try again.</p>
                      )}
                      <button
                        type="button"
                        onClick={handleGenerateMockup}
                        disabled={
                          mockupGenerating ||
                          !(generateView === "front" ? effectiveFrontConfig.blankImageUrl : effectiveBackConfig.blankImageUrl) ||
                          !(generateView === "front" ? effectiveFrontConfig.designAssetUrl : effectiveBackConfig.designAssetUrl) ||
                          (treatsAsParentProduct && productVariants.length > 0 && !imagesTabVariantId)
                        }
                        className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50"
                      >
                        {mockupGenerating ? "Starting…" : "Generate mockup"}
                      </button>
                    </div>
                  )}
                  {(designIdForFront || product?.designId) && product?.blankId && hasMockupForGenerateUi && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <p className="text-gray-600">
                        Using <strong>{generateView}</strong> view for new mockups. Switch view above if needed, then regenerate.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateMockup}
                        disabled={
                          mockupGenerating ||
                          !(generateView === "front" ? effectiveFrontConfig.blankImageUrl : effectiveBackConfig.blankImageUrl) ||
                          !(generateView === "front" ? effectiveFrontConfig.designAssetUrl : effectiveBackConfig.designAssetUrl) ||
                          (treatsAsParentProduct && productVariants.length > 0 && !imagesTabVariantId)
                        }
                        className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 border border-gray-400 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                      >
                        {mockupGenerating ? "Regenerating…" : "Regenerate mockup"}
                      </button>
                    </div>
                  )}

                  {/* Master composite: show mockup so user can review before generating product images */}
                  {masterCompositeMockupUrl && (() => {
                    const u = product.updatedAt as { toMillis?: () => number; seconds?: number; _seconds?: number } | undefined;
                    const ts =
                      variantReloadTick ||
                      u?.toMillis?.() ??
                      u?.seconds ??
                      (u as { _seconds?: number })?._seconds ??
                      (typeof u === "number" ? u : "");
                    const sep = masterCompositeMockupUrl.includes("?") ? "&" : "?";
                    const mockupDisplayUrl = `${masterCompositeMockupUrl}${sep}t=${ts}`;
                    const imgKey = `mockup-${product.id}-${imagesTabVariantId || "root"}-${ts}`;
                    return (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Master composite — review before generating</h3>
                      <p className="text-xs text-gray-600 mb-3">
                        This is the mockup (blank + design) that product images are based on. If the side or placement is wrong, use Render Setup and &quot;Regenerate mockup&quot; above, then generate product images again.
                      </p>
                      <div className="flex flex-wrap items-start gap-4">
                        <button
                          type="button"
                          onClick={() => openLightbox(mockupDisplayUrl)}
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

                  {hasMockupForGenerateUi && (
                    <details className="rounded-lg border border-gray-200 bg-gray-50/80">
                      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-900 list-none [&::-webkit-details-marker]:hidden">
                        Advanced overrides — product scene (preset, count, size)
                      </summary>
                      <div className="px-4 pb-4 pt-2 border-t border-gray-100">
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
                              const modes = p.supportedModes as RpGenerationType[] | undefined;
                              const mode =
                                ("mode" in p && p.mode) || (modes?.includes("product_only") ? "productOnly" : "onModel");
                              return mode === "productOnly";
                            })
                            .map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.name}</option>
                            ))}
                        </select>
                        {allPresets.filter(
                          (p) =>
                            ("mode" in p && p.mode === "productOnly") ||
                            (p.supportedModes as RpGenerationType[] | undefined)?.includes("product_only")
                        ).length === 0 && (
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
                        disabled={
                          generating ||
                          !selectedPresetId ||
                          allPresets.filter(
                            (p) =>
                              ("mode" in p && p.mode === "productOnly") ||
                              (p.supportedModes as RpGenerationType[] | undefined)?.includes("product_only")
                          ).length === 0
                        }
                        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                      >
                        {generating ? "Generating…" : `Generate ${imageCount} product image${imageCount > 1 ? "s" : ""} (overrides)`}
                      </button>
                    </form>
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Stage 2: Model Images */}
              {generateMode === "model" && (
                <>
                  {!hasMockupForGenerateUi && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm mb-4">
                      <strong>Generate product images first.</strong> This product has no mockup — model images use the mockup as the product reference. Switch to <strong>Product Images</strong>, pick a color variant if applicable, and generate a mockup.
                    </div>
                  )}
                  <details className="rounded-lg border border-gray-200 bg-gray-50/80 mb-6">
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-900 list-none [&::-webkit-details-marker]:hidden">
                      Advanced overrides — on-model (preset, identity, scales, A/B)
                    </summary>
                    <div className="px-4 pb-4 pt-2 border-t border-gray-100">
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
                              const modes = p.supportedModes as RpGenerationType[] | undefined;
                              const mode =
                                ("mode" in p && p.mode) || (modes?.includes("product_only") ? "productOnly" : "onModel");
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
                    !hasMockupForGenerateUi ||
                    !selectedPresetId ||
                    (selectedPreset && ("requireIdentity" in selectedPreset ? selectedPreset.requireIdentity !== false : true) && !selectedIdentityId)
                  }
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {generating ? "Generating..." : `Generate ${imageCount} image${imageCount > 1 ? "s" : ""} (overrides)`}
                </button>
              </form>
                    </div>
                  </details>
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
          </div>
          </>
        )}

        {/* Render Setup modals — shared across Images / Generate */}
        {(renderSetupModal === "placement_front" || renderSetupModal === "placement_back") && (
          <Modal
            isOpen
            onClose={() => setRenderSetupModal(null)}
            title={`Override blank placement (${placementEditSide}) — advanced`}
            size="large"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                <strong>Blank default:</strong> placement comes from the blank render profile. Use this only when this{" "}
                <strong>SKU</strong> needs different position/scale. Saves as a <strong>product override</strong>; mockups
                and flat renders use the effective (merged) values.
              </p>
              {product?.blankId ? (
                <p className="text-xs text-gray-600">
                  Prefer editing shared defaults:{" "}
                  <Link href={`/blanks/${encodeURIComponent(product.blankId)}`} className="text-blue-600 font-medium underline">
                    Blank render profile
                  </Link>
                </p>
              ) : null}
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
              <div className="flex flex-wrap gap-2 justify-end items-center">
                {product && hasProductPlacementOverride(product, placementEditSide) ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await resetProductPlacementToBlankDefault(placementEditSide);
                      setRenderSetupModal(null);
                    }}
                    disabled={savingRenderSetup}
                    className="px-3 py-1.5 text-sm border border-amber-500 text-amber-900 rounded-lg hover:bg-amber-50 mr-auto"
                  >
                    Reset to blank default
                  </button>
                ) : null}
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
                    await persistProductPlacementOverride(
                      placementEditSide,
                      placementEdit.x,
                      placementEdit.y,
                      placementEdit.scale
                    );
                    setRenderSetupModal(null);
                  }}
                  disabled={savingRenderSetup}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingRenderSetup ? "Saving…" : "Save product override"}
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
                const pngUrl = resolveDesignPngForPicker(d as DesignDoc);
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
                    {pngUrl ? (
                      <img src={pngUrl} alt="" className="w-12 h-12 object-contain bg-gray-100 rounded shrink-0" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-100 rounded shrink-0 flex items-center justify-center text-[10px] text-gray-500 text-center px-0.5">
                        No art
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{d.name ?? d.id}</p>
                      {!pngUrl && (
                        <p className="text-xs text-amber-700">No PNG (upload light/dark or legacy PNG in Design Detail → Files).</p>
                      )}
                    </div>
                  </button>
                );
              })}
              {(allDesigns ?? []).length === 0 && <p className="text-sm text-gray-500">No designs. Add designs in Design Library.</p>}
            </div>
          </Modal>
        )}

        {activeTab === "order" && (
          <div className="space-y-8">
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
          </div>
        )}

        {activeTab === "metrics" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Views", value: "—", hint: "Placeholder" },
                { label: "Orders", value: "—", hint: "Placeholder" },
                { label: "Conversion", value: "—", hint: "Placeholder" },
                { label: "Variant performance", value: "—", hint: "Placeholder" },
              ].map((row) => (
                <div key={row.label} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                  <h3 className="text-sm font-semibold text-gray-900">{row.label}</h3>
                  <p className="text-2xl font-bold text-gray-800 mt-2">{row.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{row.hint}</p>
                </div>
              ))}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent generation jobs</h2>
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

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Data maintenance</h2>
              <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Data Maintenance</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Recalculate asset counters if they appear out of sync with actual assets.
                </p>
                <button
                  onClick={async () => {
                    if (!db || !product?.id) return;

                    try {
                      const assetsRef = collection(db, "rp_product_assets");
                      const q = query(assetsRef, where("productId", "==", product.id));
                      const snapshot = await getDocs(q);
                      const actualCount = snapshot.docs.length;

                      const approvedQuery = query(assetsRef, where("productId", "==", product.id), where("status", "==", "approved"));
                      const approvedSnapshot = await getDocs(approvedQuery);
                      const approvedCount = approvedSnapshot.docs.length;

                      const publishedQuery = query(assetsRef, where("productId", "==", product.id), where("status", "==", "published"));
                      const publishedSnapshot = await getDocs(publishedQuery);
                      const publishedCount = publishedSnapshot.docs.length;

                      const productRef = doc(db, "rp_products", product.id);
                      await updateDoc(productRef, {
                        "counters.assetsTotal": actualCount,
                        "counters.assetsApproved": approvedCount,
                        "counters.assetsPublished": publishedCount,
                        updatedAt: new Date(),
                      });

                      showToast(`Counters updated: ${actualCount} total, ${approvedCount} approved, ${publishedCount} published`, "success");

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
