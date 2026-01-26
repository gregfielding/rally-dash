"use client";

import { useState, useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import { useAllAssets } from "@/lib/hooks/useAllAssets";
import { useAssetReview } from "@/lib/hooks/useAssetReview";
import { useProducts } from "@/lib/hooks/useRPProducts";
import Modal from "@/components/Modal";
import { RpProductAsset } from "@/lib/types/firestore";

function ReviewQueueContent() {
  const [selectedProductId, setSelectedProductId] = useState<string | "all">("all");
  const [reviewFilter, setReviewFilter] = useState<"pending" | "needs_revision" | "all">("pending");
  const [selectedAsset, setSelectedAsset] = useState<RpProductAsset | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewNotes, setReviewNotes] = useState("");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const { products } = useProducts({});
  const { approveAsset, rejectAsset, requestRevision } = useAssetReview();

  // Fetch assets for selected product or all products
  const productIds = useMemo(() => {
    if (selectedProductId === "all") {
      return products.map((p) => p.id).filter(Boolean) as string[];
    }
    return [selectedProductId];
  }, [selectedProductId, products]);

  // Fetch assets with review status filter
  const reviewStatusFilter = reviewFilter === "all" ? undefined : reviewFilter;
  const { assets: filteredAssets, loading: assetsLoading, refetch: refetchAssets } = useAllAssets(
    productIds.length > 0 ? productIds : undefined,
    reviewStatusFilter
  );

  const handleOpenReview = (asset: RpProductAsset) => {
    setSelectedAsset(asset);
    setReviewRating(asset.review?.rating || 5);
    setReviewNotes(asset.review?.notes || "");
    setRevisionNotes(asset.review?.revisionNotes || "");
    setIsReviewModalOpen(true);
  };

  const handleApprove = async () => {
    if (!selectedAsset?.id) return;
    try {
      setReviewing(true);
      await approveAsset(selectedAsset.id, reviewRating, reviewNotes);
      setIsReviewModalOpen(false);
      setSelectedAsset(null);
      refetchAssets();
    } catch (error) {
      console.error("[ReviewQueue] Failed to approve asset:", error);
      alert("Failed to approve asset. Please try again.");
    } finally {
      setReviewing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedAsset?.id) return;
    try {
      setReviewing(true);
      await rejectAsset(selectedAsset.id, reviewNotes);
      setIsReviewModalOpen(false);
      setSelectedAsset(null);
      refetchAssets();
    } catch (error) {
      console.error("[ReviewQueue] Failed to reject asset:", error);
      alert("Failed to reject asset. Please try again.");
    } finally {
      setReviewing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!selectedAsset?.id || !revisionNotes.trim()) {
      alert("Please provide revision notes.");
      return;
    }
    try {
      setReviewing(true);
      await requestRevision(selectedAsset.id, revisionNotes);
      setIsReviewModalOpen(false);
      setSelectedAsset(null);
      refetchAssets();
    } catch (error) {
      console.error("[ReviewQueue] Failed to request revision:", error);
      alert("Failed to request revision. Please try again.");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-sm text-gray-600 mt-1">
            Review and approve generated assets
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Product
            </label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="all">All Products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Review Status
            </label>
            <select
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="pending">Pending Review</option>
              <option value="needs_revision">Needs Revision</option>
              <option value="all">All Statuses</option>
            </select>
          </div>
        </div>
      </div>

      {/* Assets Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {assetsLoading ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">Loading assets...</p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">No assets found for review.</p>
            <p className="text-sm text-gray-400 mt-2">
              {reviewFilter === "pending"
                ? "All assets have been reviewed."
                : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4">
            {filteredAssets.map((asset) => {
              const reviewStatus = asset.review?.status || "pending";
              const statusColors = {
                pending: "bg-yellow-100 text-yellow-800",
                approved: "bg-green-100 text-green-800",
                rejected: "bg-red-100 text-red-800",
                needs_revision: "bg-orange-100 text-orange-800",
              };

              return (
                <div
                  key={asset.id}
                  className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleOpenReview(asset)}
                >
                  {asset.downloadUrl ? (
                    <img
                      src={asset.downloadUrl}
                      alt="Asset"
                      className="w-full h-48 object-cover"
                    />
                  ) : (
                    <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                      <span className="text-gray-400 text-sm">No image</span>
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded ${statusColors[reviewStatus]}`}
                      >
                        {reviewStatus}
                      </span>
                      {asset.review?.rating && (
                        <span className="text-xs text-gray-600">
                          ⭐ {asset.review.rating}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {asset.assetType || "image"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Review Modal */}
      <Modal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        title="Review Asset"
      >
        {selectedAsset && (
          <div className="space-y-4">
            <div>
              {selectedAsset.downloadUrl ? (
                <img
                  src={selectedAsset.downloadUrl}
                  alt="Asset"
                  className="w-full rounded-lg border border-gray-200"
                />
              ) : (
                <div className="w-full h-64 bg-gray-100 flex items-center justify-center rounded-lg">
                  <span className="text-gray-400">No image available</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rating (1-5 stars)
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => setReviewRating(rating)}
                    className={`text-2xl ${
                      rating <= reviewRating
                        ? "text-yellow-400"
                        : "text-gray-300"
                    }`}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Optional notes about this asset..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Revision Notes (if requesting revision)
              </label>
              <textarea
                value={revisionNotes}
                onChange={(e) => setRevisionNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="What needs to be changed?"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              {revisionNotes.trim() && (
                <button
                  type="button"
                  onClick={handleRequestRevision}
                  disabled={reviewing}
                  className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  {reviewing ? "Requesting..." : "Request Revision"}
                </button>
              )}
              <button
                type="button"
                onClick={handleReject}
                disabled={reviewing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {reviewing ? "Rejecting..." : "Reject"}
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={reviewing}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {reviewing ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ReviewQueueContent />
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
