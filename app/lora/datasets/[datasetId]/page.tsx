"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  useRPDataset,
} from "@/lib/hooks/useRPDatasets";
import {
  useRPDatasetImages,
  useUploadDatasetImage,
  useDeleteDatasetImage,
  useBuildDatasetZip,
  useAvailableImagesForIdentity,
  useImportDatasetImage,
  useRemoveDuplicateImages,
  AvailableImage,
} from "@/lib/hooks/useRPDatasetImages";
import { RPDatasetImage } from "@/lib/types/firestore";

function kindLabel(kind: string | undefined) {
  if (kind === "face") return "Face";
  if (kind === "upper_body") return "Upper body";
  if (kind === "full_body") return "Body";
  return kind || "Unknown";
}

function DatasetDetailContent() {
  const params = useParams();
  const datasetId = (params?.datasetId as string) || "";

  const { dataset, loading: datasetLoading } = useRPDataset(datasetId);
  const {
    images,
    loading: imagesLoading,
    refetch: refetchImages,
  } = useRPDatasetImages(datasetId);

  const { uploadDatasetImage } = useUploadDatasetImage();
  const { deleteDatasetImage } = useDeleteDatasetImage();
  const { buildDatasetZip } = useBuildDatasetZip();
  const { importDatasetImage } = useImportDatasetImage();
  const { removeDuplicateImages } = useRemoveDuplicateImages();
  
  // Fetch available images from other datasets for this identity
  // Note: packId needs to be fetched from the identity document
  const { availableImages, loading: availableLoading } = useAvailableImagesForIdentity(
    dataset?.identityId,
    datasetId,
    undefined // packId - we'll need to fetch this from identity if needed
  );

  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [importing, setImporting] = useState<string | null>(null); // imageId being imported
  const [removingDuplicates, setRemovingDuplicates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPage, setImportPage] = useState(1);
  const imagesPerPage = 12;

  // Filter out duplicates: images already in current dataset and duplicates within available images
  const uniqueAvailableImages = useMemo(() => {
    if (!images.length && !availableImages.length) return [];
    
    // Get set of storage paths and download URLs from current dataset
    const currentStoragePaths = new Set(
      images
        .map((img) => img.storagePath)
        .filter((path): path is string => !!path)
    );
    const currentDownloadUrls = new Set(
      images
        .map((img) => img.downloadUrl)
        .filter((url): url is string => !!url)
    );
    
    // Track seen URLs to deduplicate within available images
    const seenUrls = new Set<string>();
    
    return availableImages.filter((img) => {
      // Skip if already in current dataset (by storage path or download URL)
      if (img.storagePath && currentStoragePaths.has(img.storagePath)) {
        return false;
      }
      if (img.downloadUrl && currentDownloadUrls.has(img.downloadUrl)) {
        return false;
      }
      
      // Skip if duplicate within available images (by download URL)
      if (img.downloadUrl) {
        if (seenUrls.has(img.downloadUrl)) {
          return false;
        }
        seenUrls.add(img.downloadUrl);
      }
      
      return true;
    });
  }, [images, availableImages]);

  // Reset to page 1 when available images change
  useEffect(() => {
    setImportPage(1);
  }, [uniqueAvailableImages.length, dataset?.identityId]);

  const imageCount = images.length;
  const hasZip =
    dataset &&
    ((dataset as any).lastZipSignedUrl || (dataset as any).lastZipStoragePath);

  const readinessNotes = useMemo(() => {
    if (!dataset) return [];
    const notes: { ok: boolean; label: string }[] = [];

    if (dataset.type === "face") {
      notes.push({
        ok: imageCount >= 15 && imageCount <= 30,
        label: "15–30 face images",
      });
    } else {
      notes.push({
        ok: imageCount >= 20,
        label: "20+ images",
      });
    }

    notes.push({
      ok: !!hasZip,
      label: hasZip ? "ZIP built" : "ZIP not built yet",
    });

    return notes;
  }, [dataset, imageCount, hasZip]);

  const handleFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    console.log("[DatasetDetail] handleFilesSelected called");
    const files = event.target.files;
    if (!files || files.length === 0) {
      console.log("[DatasetDetail] No files selected");
      return;
    }
    console.log("[DatasetDetail] Files selected:", files.length);

    if (!dataset) {
      console.error("[DatasetDetail] No dataset loaded");
      setError("Dataset not loaded. Please refresh the page.");
      return;
    }

    if (!dataset.identityId) {
      console.error("[DatasetDetail] Dataset missing identityId:", dataset);
      setError("Dataset is missing identityId. Please edit the dataset and assign an identity.");
      return;
    }

    console.log("[DatasetDetail] Starting uploads:", {
      datasetId,
      identityId: dataset.identityId,
      fileCount: files.length,
      datasetType: dataset.type,
    });

    setError(null);
    setUploading(true);
    try {
      const all = Array.from(files).map((file, idx) => {
        console.log(`[DatasetDetail] Uploading file ${idx + 1}/${files.length}:`, file.name);
        return uploadDatasetImage({
          datasetId: datasetId,
          identityId: dataset.identityId,
          file,
          // Map dataset.type to a dataset image kind; treat mixed as face by default.
          kind:
            dataset.type === "upper_body"
              ? "upper_body"
              : dataset.type === "full_body"
              ? "full_body"
              : "face",
        });
      });
      console.log("[DatasetDetail] Waiting for all uploads to complete...");
      await Promise.all(all);
      console.log("[DatasetDetail] All uploads completed, refetching images...");
      console.log("[DatasetDetail] Current image count before refetch:", imageCount);
      // Small delay to ensure Firestore has propagated the write
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Force revalidation - this now calls fetchRPDatasetImages directly
      const refetchResult = await refetchImages();
      console.log("[DatasetDetail] Refetch result:", refetchResult?.length || 0, "images");
      console.log("[DatasetDetail] Upload flow complete");
    } catch (err: any) {
      console.error("[DatasetDetail] Failed to upload images:", err);
      console.error("[DatasetDetail] Error details:", {
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
      });
      setError(err?.message || "Failed to upload images.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleDeleteImage = async (image: RPDatasetImage) => {
    const ok = window.confirm("Remove this image from the dataset?");
    if (!ok) return;
    try {
      await deleteDatasetImage(image);
      await refetchImages();
    } catch (err: any) {
      console.error("[DatasetDetail] Failed to delete image:", err);
      setError(err?.message || "Failed to delete image.");
    }
  };

  const handleBuildZip = async () => {
    if (!datasetId) return;
    setError(null);
    setBuilding(true);
    try {
      await buildDatasetZip(datasetId);
    } catch (err: any) {
      console.error("[DatasetDetail] Failed to build ZIP:", err);
      setError(err?.message || "Failed to build dataset ZIP.");
    } finally {
      setBuilding(false);
    }
  };

  const handleImportImage = async (sourceImage: AvailableImage) => {
    if (!dataset || !dataset.identityId || !datasetId) return;
    setError(null);
    setImporting(sourceImage.id);
    try {
      await importDatasetImage(sourceImage, datasetId, dataset.identityId);
      await refetchImages();
    } catch (err: any) {
      console.error("[DatasetDetail] Failed to import image:", err);
      setError(err?.message || "Failed to import image.");
    } finally {
      setImporting(null);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (!datasetId) return;
    const confirmed = window.confirm(
      "This will remove duplicate images from this dataset. Duplicates are identified by:\n" +
      "- Same storage path\n" +
      "- Same download URL\n\n" +
      "The oldest image in each duplicate group will be kept. Continue?"
    );
    if (!confirmed) return;

    setError(null);
    setRemovingDuplicates(true);
    try {
      const result = await removeDuplicateImages(datasetId);
      await refetchImages();
      if (result.removed > 0) {
        alert(`✅ Removed ${result.removed} duplicate image(s)!\n\nTotal images: ${result.totalImages}\nDuplicates found: ${result.duplicatesFound}\nRemoved: ${result.removed}`);
      } else {
        alert(`✅ No duplicates found! All ${result.totalImages} images are unique.`);
      }
    } catch (err: any) {
      console.error("[DatasetDetail] Failed to remove duplicates:", err);
      setError(err?.message || "Failed to remove duplicates.");
    } finally {
      setRemovingDuplicates(false);
    }
  };

  if (!datasetId) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">No dataset selected.</p>
      </div>
    );
  }

  if (datasetLoading && !dataset) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading dataset…</p>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">Dataset not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold mb-1 text-gray-900">
          {dataset.name}
        </h2>
        <p className="text-sm text-gray-600">
          Type: <span className="font-medium">{dataset.type}</span> · Images:{" "}
          <span className="font-medium">{imageCount}</span>
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Summary + readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Dataset Summary
          </h3>
          <dl className="space-y-1 text-sm text-gray-700">
            <div className="flex justify-between">
              <dt>Type</dt>
              <dd className="font-medium">{dataset.type}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Target images</dt>
              <dd className="font-medium">{dataset.targetImageCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Status</dt>
              <dd className="font-medium">{dataset.status}</dd>
            </div>
            <div className="flex justify-between">
              <dt>ZIP path</dt>
              <dd className="text-xs text-gray-600 max-w-xs text-right truncate">
                {(dataset as any).lastZipStoragePath ||
                  (dataset as any).lastZipSignedUrl ||
                  "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Readiness Checklist
          </h3>
          <ul className="space-y-1 text-sm">
            {readinessNotes.map((item, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span
                  className={
                    item.ok ? "text-green-600 font-semibold" : "text-red-600 font-semibold"
                  }
                >
                  {item.ok ? "✓" : "✕"}
                </span>
                <span className="text-gray-800">{item.label}</span>
              </li>
            ))}
            <li className="text-xs text-gray-500 mt-2">
              Training jobs should use datasets that are ready and have a built ZIP.
            </li>
          </ul>
        </div>
      </div>

      {/* Available Images from Other Datasets */}
      {dataset?.identityId && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Import from Other Datasets ({uniqueAvailableImages.length} available)
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            Images from other datasets for this identity. Click &quot;Import&quot; to copy them into this dataset.
          </p>
          {availableLoading ? (
            <p className="text-xs text-gray-500">Loading available images…</p>
          ) : uniqueAvailableImages.length === 0 ? (
            <p className="text-xs text-gray-500">
              No images found in other datasets for this identity. Upload new images above or promote generations from the training console.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {uniqueAvailableImages
                  .slice((importPage - 1) * imagesPerPage, importPage * imagesPerPage)
                  .map((img: AvailableImage) => (
                  <div
                    key={img.id}
                    className="border border-gray-200 rounded-lg overflow-hidden flex flex-col"
                  >
                    <div className="aspect-square bg-gray-50">
                      <img
                        src={img.downloadUrl}
                        alt={img.storagePath}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => handleImportImage(img)}
                        disabled={importing === img.id || uploading}
                        className="w-full text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {importing === img.id ? "Importing…" : "Import"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {uniqueAvailableImages.length > imagesPerPage && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Showing {Math.min((importPage - 1) * imagesPerPage + 1, uniqueAvailableImages.length)}-
                    {Math.min(importPage * imagesPerPage, uniqueAvailableImages.length)} of {uniqueAvailableImages.length} available images
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportPage((p) => Math.max(1, p - 1))}
                      disabled={importPage === 1}
                      className="px-3 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-600">
                      Page {importPage} of {Math.ceil(uniqueAvailableImages.length / imagesPerPage)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setImportPage((p) => Math.min(Math.ceil(uniqueAvailableImages.length / imagesPerPage), p + 1))}
                      disabled={importPage >= Math.ceil(uniqueAvailableImages.length / imagesPerPage)}
                      className="px-3 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Uploader + build ZIP */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Images ({imageCount})
            </h3>
            <p className="text-xs text-gray-600">
              Upload curated reference images for this dataset. Images are stored in
              Firebase Storage and tracked as rp_dataset_images.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center px-3 py-2 text-xs font-medium rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleFilesSelected}
                disabled={uploading}
              />
              {uploading ? "Uploading…" : "Upload Images"}
            </label>
            <button
              type="button"
              onClick={handleBuildZip}
              disabled={building || imageCount === 0}
              className="px-3 py-2 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {building ? "Building ZIP…" : "Build Dataset ZIP"}
            </button>
          </div>
        </div>
      </div>

      {/* Image grid */}
      <div className="bg-white rounded-lg shadow p-4">
        {imagesLoading && imageCount === 0 ? (
          <p className="text-sm text-gray-500">Loading images…</p>
        ) : imageCount === 0 ? (
          <p className="text-sm text-gray-500">
            No images yet. Upload images above or promote generations from the
            training console.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img: any) => (
              <div
                key={img.id}
                className="border border-gray-200 rounded-lg overflow-hidden flex flex-col"
              >
                <div className="aspect-square bg-gray-50">
                  <img
                    src={img.downloadUrl}
                    alt={img.storagePath}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="inline-flex px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-800">
                      {kindLabel(img.kind)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(img)}
                      className="text-[10px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate">
                    {img.storagePath}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DatasetDetailPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <div className="space-y-6">
        <DatasetDetailContent />
      </div>
    </ProtectedRoute>
  );
}


