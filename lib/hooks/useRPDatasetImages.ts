"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  getDownloadURL,
  getBlob,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, storage, functions } from "@/lib/firebase/config";
import {
  RPDatasetImage,
  RPDatasetImageKind,
  RPDatasetImageSource,
} from "@/lib/types/firestore";
import { useSWRConfig } from "swr";

async function fetchRPDatasetImages(
  datasetId?: string
): Promise<RPDatasetImage[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_dataset_images");
  const q = datasetId
    ? query(
        base,
        where("datasetId", "==", datasetId),
        orderBy("createdAt", "desc")
      )
    : query(base, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPDatasetImage) }));
}

export function useRPDatasetImages(datasetId?: string) {
  const cacheKey = "rp_dataset_images" + (datasetId ? `:${datasetId}` : "");
  const { data, error, isLoading, mutate } = useSWR<RPDatasetImage[]>(
    cacheKey,
    () => fetchRPDatasetImages(datasetId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 1000, // Reduce deduping interval to allow faster refetches
      keepPreviousData: true,
    }
  );

  const refetch = useCallback(async () => {
    console.log("[useRPDatasetImages] Refetching with key:", cacheKey);
    console.log("[useRPDatasetImages] Current data before refetch:", data?.length || 0, "images");
    
    // Force a fresh fetch by calling the fetcher directly and updating cache
    try {
      const freshData = await fetchRPDatasetImages(datasetId);
      console.log("[useRPDatasetImages] Fresh data fetched:", freshData.length, "images");
      // Update the cache with fresh data
      mutate(freshData, false); // false = don't revalidate again
      console.log("[useRPDatasetImages] Cache updated with fresh data");
      return freshData;
    } catch (err) {
      console.error("[useRPDatasetImages] Refetch failed:", err);
      // Fallback to mutate revalidation
      mutate(undefined, { revalidate: true });
      return undefined;
    }
  }, [mutate, cacheKey, datasetId, data]);

  return {
    images: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}

export interface UploadDatasetImageInput {
  datasetId: string;
  identityId: string;
  file: File;
  kind: RPDatasetImageKind;
}

export function useUploadDatasetImage() {
  const { mutate } = useSWRConfig();

  const uploadDatasetImage = useCallback(
    async (input: UploadDatasetImageInput) => {
      console.log("[useUploadDatasetImage] Starting upload:", {
        datasetId: input.datasetId,
        identityId: input.identityId,
        fileName: input.file.name,
        fileSize: input.file.size,
        kind: input.kind,
      });

      if (!db || !storage) {
        const err = new Error("Firebase is not initialized");
        console.error("[useUploadDatasetImage] Firebase not initialized");
        throw err;
      }

      const { datasetId, identityId, file, kind } = input;

      if (!datasetId || !identityId) {
        const err = new Error("datasetId and identityId are required");
        console.error("[useUploadDatasetImage] Missing required fields:", { datasetId, identityId });
        throw err;
      }

      const safeName = file.name.replace(/\s+/g, "_");
      const path = `datasets/${datasetId}/${Date.now()}-${safeName}`;
      console.log("[useUploadDatasetImage] Storage path:", path);
      const fileRef = storageRef(storage, path);

      try {
        console.log("[useUploadDatasetImage] Uploading bytes to Storage...");
        await uploadBytes(fileRef, file);
        console.log("[useUploadDatasetImage] Upload complete, getting download URL...");
        const downloadUrl = await getDownloadURL(fileRef);
        console.log("[useUploadDatasetImage] Download URL:", downloadUrl);

        const colRef = collection(db, "rp_dataset_images");
        console.log("[useUploadDatasetImage] Creating Firestore doc...");
        await addDoc(colRef, {
          datasetId,
          identityId,
          storagePath: path,
          downloadUrl,
          kind,
          source: "manual_upload",
          isApproved: true,
          createdAt: serverTimestamp(),
        } as any);
        console.log("[useUploadDatasetImage] Firestore doc created, invalidating cache...");
        console.log("[useUploadDatasetImage] Invalidating cache for datasetId:", datasetId);

        // Force revalidation by passing undefined as data and revalidate: true
        // Invalidate both the general cache and the dataset-specific cache
        const generalKey = "rp_dataset_images";
        const datasetKey = "rp_dataset_images" + `:${datasetId}`;
        console.log("[useUploadDatasetImage] Invalidating keys:", { generalKey, datasetKey });
        
        await mutate(generalKey, undefined, { revalidate: true });
        await mutate(datasetKey, undefined, { revalidate: true });
        
        console.log("[useUploadDatasetImage] Cache invalidation complete");
        console.log("[useUploadDatasetImage] Upload flow complete");
      } catch (err: any) {
        console.error("[useUploadDatasetImage] Upload failed:", {
          message: err?.message,
          code: err?.code,
          storagePath: path,
        });
        throw err;
      }
    },
    [mutate]
  );

  return { uploadDatasetImage };
}

export function useDeleteDatasetImage() {
  const { mutate } = useSWRConfig();

  const deleteDatasetImage = useCallback(
    async (image: RPDatasetImage) => {
      if (!db) throw new Error("Database not initialized");
      if (!image.id) throw new Error("Image id is required");

      const ref = doc(db, "rp_dataset_images", image.id);
      await deleteDoc(ref);

      await mutate("rp_dataset_images");
      if (image.datasetId) {
        await mutate("rp_dataset_images" + `:${image.datasetId}`);
      }
    },
    [mutate]
  );

  return { deleteDatasetImage };
}

export function useBuildDatasetZip() {
  const { mutate } = useSWRConfig();

  const buildDatasetZip = useCallback(
    async (datasetId: string) => {
      if (!functions) throw new Error("Cloud Functions not initialized");
      if (!datasetId) throw new Error("datasetId is required");

      const createDatasetZipFn = httpsCallable(functions, "createDatasetZip");
      await createDatasetZipFn({ datasetId });

      await mutate("rp_datasets");
    },
    [mutate]
  );

  return { buildDatasetZip };
}

/**
 * Available image source - can be from rp_dataset_images or legacy identity faceImages
 */
export interface AvailableImage {
  id: string;
  downloadUrl: string;
  storagePath?: string;
  kind: RPDatasetImageKind;
  source: "dataset" | "legacy_identity";
  // For legacy images, we'll need to download and re-upload
  legacyUrl?: string;
}

/**
 * Fetch images from other datasets AND legacy identity faceImages for the same identity.
 * Useful for importing existing images into a new dataset.
 */
export function useAvailableImagesForIdentity(
  identityId?: string,
  excludeDatasetId?: string,
  packId?: string
) {
  console.log("[useAvailableImagesForIdentity] Hook called with:", { identityId, excludeDatasetId, packId });
  
  const { data, error, isLoading } = useSWR<AvailableImage[]>(
    identityId ? `available_images:${identityId}:${excludeDatasetId || ""}:${packId || ""}` : null,
    async () => {
      console.log("[useAvailableImagesForIdentity] Fetcher called with identityId:", identityId);
      if (!db || !identityId) {
        console.log("[useAvailableImagesForIdentity] Early return - no db or identityId");
        return [];
      }
      
      const available: AvailableImage[] = [];
      
      // 1. Fetch all rp_dataset_images for this identity, excluding the current dataset
      const q = query(
        collection(db, "rp_dataset_images"),
        where("identityId", "==", identityId),
        orderBy("createdAt", "desc")
      );
      const snapshot = await getDocs(q);
      const datasetImages = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as RPDatasetImage) }))
        .filter((img) => !excludeDatasetId || img.datasetId !== excludeDatasetId)
        .map((img) => ({
          id: img.id || `dataset-${img.datasetId}-${Date.now()}`,
          downloadUrl: img.downloadUrl,
          storagePath: img.storagePath,
          kind: img.kind || "face",
          source: "dataset" as const,
        }));
      
      available.push(...datasetImages);
      
      // 2. Fetch legacy identity faceImages
      // Since identities are subcollections, we need to search through packs
      console.log("[useAvailableImagesForIdentity] Starting legacy image search for identityId:", identityId, "packId:", packId);
      
      if (!packId) {
        // Try to find the identity by searching through all packs
        // This is inefficient but works if packId isn't stored on dataset
        console.log("[useAvailableImagesForIdentity] No packId provided, searching through all packs...");
        try {
          const packsRef = collection(db, "modelPacks");
          const packsSnapshot = await getDocs(packsRef);
          console.log("[useAvailableImagesForIdentity] Found", packsSnapshot.docs.length, "packs to search");
          
          for (const packDoc of packsSnapshot.docs) {
            const currentPackId = packDoc.id;
            console.log("[useAvailableImagesForIdentity] Checking pack:", currentPackId);
            const identityRef = doc(db, "modelPacks", currentPackId, "identities", identityId);
            const identityDoc = await getDoc(identityRef);
            
            if (identityDoc.exists()) {
              packId = currentPackId;
              console.log("[useAvailableImagesForIdentity] Found identity in pack:", packId);
              break;
            }
          }
          
          if (!packId) {
            console.warn("[useAvailableImagesForIdentity] Identity not found in any pack for identityId:", identityId);
          }
        } catch (err) {
          console.error("[useAvailableImagesForIdentity] Failed to find packId:", err);
        }
      }
      
      if (packId) {
        console.log("[useAvailableImagesForIdentity] Fetching identity from pack:", packId);
        try {
          const identityRef = doc(db, "modelPacks", packId, "identities", identityId);
          const identityDoc = await getDoc(identityRef);
          
          if (identityDoc.exists()) {
            const identityData = identityDoc.data();
            console.log("[useAvailableImagesForIdentity] Identity data keys:", Object.keys(identityData));
            console.log("[useAvailableImagesForIdentity] faceImages array length:", identityData.faceImages?.length || 0);
            console.log("[useAvailableImagesForIdentity] faceImageCount:", identityData.faceImageCount);
            
            const faceImages = identityData.faceImages || [];
            
            if (faceImages.length === 0) {
              console.warn("[useAvailableImagesForIdentity] faceImages array is empty for identity:", identityId);
            }
            
            // Convert FaceImageMetadata to AvailableImage format
            const legacyImages: AvailableImage[] = faceImages.map((img: any, idx: number) => {
              console.log("[useAvailableImagesForIdentity] Processing legacy image", idx, ":", img.url || "no url");
              return {
                id: `legacy-${identityId}-${idx}`,
                downloadUrl: img.url,
                legacyUrl: img.url, // Keep original URL for import
                kind: "face" as RPDatasetImageKind, // Legacy images are always face
                source: "legacy_identity" as const,
              };
            });
            
            available.push(...legacyImages);
            console.log("[useAvailableImagesForIdentity] Added", legacyImages.length, "legacy face images from pack", packId);
          } else {
            console.warn("[useAvailableImagesForIdentity] Identity document does not exist at path:", `modelPacks/${packId}/identities/${identityId}`);
          }
        } catch (err) {
          console.error("[useAvailableImagesForIdentity] Failed to fetch legacy images:", err);
        }
      } else {
        console.warn("[useAvailableImagesForIdentity] No packId available, skipping legacy image fetch");
      }
      
      console.log("[useAvailableImagesForIdentity] Total available images:", available.length, "(dataset:", datasetImages.length, "legacy:", available.length - datasetImages.length, ")");
      
      return available;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  console.log("[useAvailableImagesForIdentity] SWR state:", { 
    dataLength: data?.length || 0, 
    isLoading, 
    error: error?.message,
    hasData: !!data 
  });

  return {
    availableImages: data || [],
    loading: isLoading,
    error: error?.message || null,
  };
}

/**
 * Import an existing dataset image into the current dataset.
 * Uses a Cloud Function to copy the file server-side, avoiding CORS issues.
 */
export function useImportDatasetImage() {
  const { mutate } = useSWRConfig();

  const importDatasetImage = useCallback(
    async (sourceImage: AvailableImage, targetDatasetId: string, targetIdentityId: string) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      if (!sourceImage.downloadUrl) {
        throw new Error("Source image missing downloadUrl");
      }

      console.log("[useImportDatasetImage] Importing image via Cloud Function:", {
        sourceImageId: sourceImage.id,
        targetDatasetId,
        sourceStoragePath: sourceImage.storagePath,
        source: sourceImage.source,
        downloadUrl: sourceImage.downloadUrl,
      });

      // Use Cloud Function to copy the file server-side (no CORS issues)
      const copyDatasetImageFn = httpsCallable(functions, "copyDatasetImage");
      const result = await copyDatasetImageFn({
        sourceImageId: sourceImage.id,
        sourceStoragePath: sourceImage.storagePath,
        sourceDownloadUrl: sourceImage.downloadUrl || sourceImage.legacyUrl,
        targetDatasetId,
        targetIdentityId,
        kind: sourceImage.kind,
      });

      console.log("[useImportDatasetImage] Cloud Function result:", result.data);

      // Invalidate caches
      await mutate("rp_dataset_images", undefined, { revalidate: true });
      await mutate("rp_dataset_images" + `:${targetDatasetId}`, undefined, { revalidate: true });
      await mutate(`available_images:${targetIdentityId}:${targetDatasetId}`, undefined, { revalidate: true });

      console.log("[useImportDatasetImage] Import complete");
    },
    [mutate]
  );

  return { importDatasetImage };
}

/**
 * Remove duplicate images from a dataset.
 * Duplicates are identified by storagePath and downloadUrl.
 */
export function useRemoveDuplicateImages() {
  const { mutate } = useSWRConfig();

  const removeDuplicateImages = useCallback(
    async (datasetId: string) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useRemoveDuplicateImages] Removing duplicates for dataset:", datasetId);

      const removeDuplicatesFn = httpsCallable(functions, "removeDuplicateImages");
      const result = await removeDuplicatesFn({ datasetId });

      console.log("[useRemoveDuplicateImages] Result:", result.data);

      // Invalidate caches
      await mutate("rp_dataset_images", undefined, { revalidate: true });
      await mutate("rp_dataset_images" + `:${datasetId}`, undefined, { revalidate: true });

      return result.data as {
        success: boolean;
        message: string;
        totalImages: number;
        duplicatesFound: number;
        removed: number;
        errors?: Array<{ id: string; error: string }>;
      };
    },
    [mutate]
  );

  return { removeDuplicateImages };
}


