"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useBlank, useUpdateBlank, useDeleteBlank, COLOR_REGISTRY } from "@/lib/hooks/useBlanks";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { RPImageRef, RPBlankMask } from "@/lib/types/firestore";
import { useAuth } from "@/lib/providers/AuthProvider";

function BlankDetailContent() {
  const params = useParams();
  const router = useRouter();
  const blankId = params.blankId as string;
  const { user } = useAuth();

  // Fetch blank
  const { blank, loading: blankLoading, error: blankError, refetch: refetchBlank } = useBlank(blankId);

  // Mutations
  const { updateBlank } = useUpdateBlank();
  const { deleteBlank } = useDeleteBlank();

  // Tab state
  const [activeTab, setActiveTab] = useState<"overview" | "images" | "placements" | "masks">("overview");

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Upload state
  const [uploadingView, setUploadingView] = useState<"front" | "back" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUploadView, setCurrentUploadView] = useState<"front" | "back">("front");

  // Mask state
  const [masks, setMasks] = useState<{ front: RPBlankMask | null; back: RPBlankMask | null }>({ front: null, back: null });
  const [masksLoading, setMasksLoading] = useState(true);
  const [maskUploadingView, setMaskUploadingView] = useState<"front" | "back" | null>(null);
  const [maskView, setMaskView] = useState<"front" | "back">("front");
  const maskFileInputRef = useRef<HTMLInputElement>(null);
  const [currentMaskUploadView, setCurrentMaskUploadView] = useState<"front" | "back">("front");
  const [autoGenerating, setAutoGenerating] = useState<"front" | "back" | null>(null);

  // Fetch masks
  useEffect(() => {
    if (!blankId || !db) return;

    const fetchMasks = async () => {
      setMasksLoading(true);
      try {
        const [frontDoc, backDoc] = await Promise.all([
          getDoc(doc(db!, "rp_blank_masks", `${blankId}_front`)),
          getDoc(doc(db!, "rp_blank_masks", `${blankId}_back`)),
        ]);

        setMasks({
          front: frontDoc.exists() ? (frontDoc.data() as RPBlankMask) : null,
          back: backDoc.exists() ? (backDoc.data() as RPBlankMask) : null,
        });
      } catch (err) {
        console.error("[BlankDetail] Failed to fetch masks:", err);
      } finally {
        setMasksLoading(false);
      }
    };

    fetchMasks();
  }, [blankId]);

  // Mask upload handler
  const handleMaskFileSelect = (view: "front" | "back") => {
    setCurrentMaskUploadView(view);
    maskFileInputRef.current?.click();
  };

  const handleMaskFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !blankId || !storage || !db || !user) return;

    // Validate file type
    if (!file.type.includes("png")) {
      showToast("Masks must be PNG files", "error");
      return;
    }

    setMaskUploadingView(currentMaskUploadView);

    try {
      // Storage path: rp/blank_masks/{blankId}/{view}/mask.png
      const storagePath = `rp/blank_masks/${blankId}/${currentMaskUploadView}/mask.png`;
      const storageRef = ref(storage, storagePath);
      
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // Get image dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });

      // Build mask document
      const maskDocId = `${blankId}_${currentMaskUploadView}`;
      const maskData: Partial<RPBlankMask> = {
        id: maskDocId,
        blankId,
        view: currentMaskUploadView,
        mask: {
          storagePath,
          downloadUrl,
          width: img.width,
          height: img.height,
          contentType: "image/png",
          bytes: file.size,
        },
        mode: "inpaint",
        updatedAt: serverTimestamp() as any,
        updatedByUid: user.uid,
      };

      // Check if document exists for create vs update
      const existingDoc = await getDoc(doc(db!, "rp_blank_masks", maskDocId));
      if (!existingDoc.exists()) {
        maskData.createdAt = serverTimestamp() as any;
        maskData.createdByUid = user.uid;
      }

      await setDoc(doc(db!, "rp_blank_masks", maskDocId), maskData, { merge: true });

      // Update local state
      setMasks((prev) => ({
        ...prev,
        [currentMaskUploadView]: { ...maskData, mask: maskData.mask } as RPBlankMask,
      }));

      showToast(`${currentMaskUploadView} mask uploaded successfully!`, "success");
    } catch (err: any) {
      console.error("[BlankDetail] Failed to upload mask:", err);
      showToast("Failed to upload mask", "error");
    } finally {
      setMaskUploadingView(null);
      if (maskFileInputRef.current) {
        maskFileInputRef.current.value = "";
      }
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Auto-generate mask from safeArea placement
  const handleAutoGenerateMask = async (view: "front" | "back") => {
    if (!blankId || !storage || !db || !user || !blank) return;

    // Find the placement for this view
    const placementId = view === "front" ? "front_center" : "back_center";
    const placement = blank.placements?.find((p: any) => p.placementId === placementId);
    
    if (!placement?.safeArea) {
      showToast(`No safeArea defined for ${view} placement`, "error");
      return;
    }

    // Get blank image dimensions
    const blankImage = blank.images?.[view];
    if (!blankImage?.downloadUrl || !blankImage.width || !blankImage.height) {
      showToast(`No ${view} image with dimensions available`, "error");
      return;
    }

    setAutoGenerating(view);

    try {
      const { width: imgWidth, height: imgHeight } = blankImage;
      const { x, y, w, h } = placement.safeArea;

      // Create canvas - black background with white rectangle at safeArea
      const canvas = document.createElement("canvas");
      canvas.width = imgWidth;
      canvas.height = imgHeight;
      const ctx = canvas.getContext("2d");
      
      if (!ctx) {
        showToast("Failed to create canvas context", "error");
        return;
      }

      // Fill black (protected area)
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, imgWidth, imgHeight);

      // safeArea is in normalized coordinates (0..1)
      // x, y are top-left corner; w, h are width/height
      const rectX = Math.round(x * imgWidth);
      const rectY = Math.round(y * imgHeight);
      const rectW = Math.round(w * imgWidth);
      const rectH = Math.round(h * imgHeight);

      // Fill white (editable print area)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(rectX, rectY, rectW, rectH);

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create blob from canvas"));
        }, "image/png");
      });

      // Upload to Storage
      const storagePath = `rp/blank_masks/${blankId}/${view}/mask.png`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);

      // Build mask document
      const maskDocId = `${blankId}_${view}`;
      const maskData: Partial<RPBlankMask> = {
        id: maskDocId,
        blankId,
        view,
        mask: {
          storagePath,
          downloadUrl,
          width: imgWidth,
          height: imgHeight,
          contentType: "image/png",
          bytes: blob.size,
        },
        mode: "inpaint",
        updatedAt: serverTimestamp() as any,
        updatedByUid: user.uid,
      };

      // Check if document exists for create vs update
      const existingDoc = await getDoc(doc(db!, "rp_blank_masks", maskDocId));
      if (!existingDoc.exists()) {
        maskData.createdAt = serverTimestamp() as any;
        maskData.createdByUid = user.uid;
      }

      await setDoc(doc(db!, "rp_blank_masks", maskDocId), maskData, { merge: true });

      // Update local state
      setMasks((prev) => ({
        ...prev,
        [view]: { ...maskData, mask: maskData.mask } as RPBlankMask,
      }));

      showToast(`${view} mask auto-generated from safeArea!`, "success");
    } catch (err: any) {
      console.error("[BlankDetail] Failed to auto-generate mask:", err);
      showToast("Failed to auto-generate mask", "error");
    } finally {
      setAutoGenerating(null);
    }
  };

  const handleStatusChange = async (newStatus: "draft" | "active" | "archived") => {
    if (!blank?.blankId) return;

    try {
      await updateBlank({
        blankId: blank.blankId,
        status: newStatus,
      });
      showToast(`Status updated to ${newStatus}`, "success");
      refetchBlank();
    } catch (err: any) {
      console.error("[BlankDetail] Failed to update status:", err);
      showToast("Failed to update status", "error");
    }
  };

  const handleDelete = async () => {
    if (!blank?.blankId) return;
    if (!confirm("Are you sure you want to delete this blank? It will be archived if referenced by products.")) return;

    try {
      const result = await deleteBlank(blank.blankId);
      if (result.action === "deleted") {
        showToast("Blank deleted", "success");
        router.push("/blanks");
      } else {
        showToast(`Blank archived (${result.reason})`, "success");
        refetchBlank();
      }
    } catch (err: any) {
      console.error("[BlankDetail] Failed to delete blank:", err);
      showToast("Failed to delete blank", "error");
    }
  };

  const handleFileSelect = (view: "front" | "back") => {
    setCurrentUploadView(view);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !blank?.blankId) return;

    setUploadingView(currentUploadView);

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      // Generate storage path per Section 4
      const ext = file.name.split('.').pop() || 'png';
      const storagePath = `rp/blanks/${blank.blankId}/${currentUploadView}.${ext}`;
      
      // Upload to Firebase Storage
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // Get image dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });

      // Build RPImageRef
      const imageRef: RPImageRef = {
        storagePath,
        downloadUrl,
        width: img.width,
        height: img.height,
        contentType: file.type,
        bytes: file.size,
      };

      // Update blank with new image
      await updateBlank({
        blankId: blank.blankId,
        [currentUploadView === "front" ? "frontImage" : "backImage"]: imageRef,
      });

      showToast(`${currentUploadView} image uploaded successfully!`, "success");
      refetchBlank();
    } catch (err: any) {
      console.error("[BlankDetail] Failed to upload image:", err);
      showToast("Failed to upload image", "error");
    } finally {
      setUploadingView(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (blankLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading blank...</p>
      </div>
    );
  }

  if (blankError || !blank) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{blankError || "Blank not found"}</p>
          <Link href="/blanks" className="text-blue-600 hover:underline">
            ← Back to Blanks
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={maskFileInputRef}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={handleMaskFileUpload}
      />

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="mb-4">
          <Link href="/blanks" className="text-blue-600 hover:underline text-sm">
            ← Back to Blanks
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">
                  {blank.styleCode} - {blank.styleName}
                </h1>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    blank.status === "active"
                      ? "bg-green-100 text-green-700"
                      : blank.status === "draft"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {blank.status}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {blank.supplier} • {blank.garmentCategory} • {blank.colorName}
              </p>
              <p className="text-xs text-gray-400 mt-1 font-mono">{blank.slug}</p>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-10 h-10 rounded-lg border border-gray-300"
                style={{ backgroundColor: blank.colorHex || COLOR_REGISTRY[blank.colorName] || "#ccc" }}
                title={blank.colorName}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab("overview")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "overview"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab("images")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "images"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Images
              </button>
              <button
                onClick={() => setActiveTab("placements")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "placements"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Placements
              </button>
              <button
                onClick={() => setActiveTab("masks")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "masks"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Masks
                {(masks.front || masks.back) && (
                  <span className="ml-2 inline-flex items-center justify-center w-2 h-2 bg-green-500 rounded-full" />
                )}
              </button>
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Style Information
                    </h3>
                    <dl className="space-y-2">
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Supplier</dt>
                        <dd className="text-sm text-gray-900">{blank.supplier}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Style Code</dt>
                        <dd className="text-sm text-gray-900 font-mono">{blank.styleCode}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Style Name</dt>
                        <dd className="text-sm text-gray-900">{blank.styleName}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Category</dt>
                        <dd className="text-sm text-gray-900 capitalize">{blank.garmentCategory}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Supplier URL</dt>
                        <dd className="text-sm">
                          <a 
                            href={blank.supplierUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View on LA Apparel
                          </a>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Colorway
                    </h3>
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-16 h-16 rounded-lg border border-gray-300"
                        style={{ backgroundColor: blank.colorHex || COLOR_REGISTRY[blank.colorName] || "#ccc" }}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {blank.colorName}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          {blank.colorHex || COLOR_REGISTRY[blank.colorName]}
                        </p>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-gray-900 mb-3 mt-6">
                      Tags
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {blank.tags?.map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Status
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatusChange("draft")}
                      disabled={blank.status === "draft"}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        blank.status === "draft"
                          ? "bg-yellow-600 text-white"
                          : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                      }`}
                    >
                      Draft
                    </button>
                    <button
                      onClick={() => handleStatusChange("active")}
                      disabled={blank.status === "active"}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        blank.status === "active"
                          ? "bg-green-600 text-white"
                          : "bg-green-100 text-green-700 hover:bg-green-200"
                      }`}
                    >
                      Active
                    </button>
                    <button
                      onClick={() => handleStatusChange("archived")}
                      disabled={blank.status === "archived"}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        blank.status === "archived"
                          ? "bg-gray-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      Archived
                    </button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Danger Zone
                  </h3>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200"
                  >
                    Delete Blank
                  </button>
                </div>
              </div>
            )}

            {/* Images Tab */}
            {activeTab === "images" && (
              <div>
                <p className="text-sm text-gray-500 mb-4">
                  Upload clean flat-lay images. White or transparent background preferred.
                </p>

                <div className="grid grid-cols-2 gap-6">
                  {/* Front Image */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900">Front</h4>
                    </div>
                    <div className="p-4">
                      {blank.images?.front?.downloadUrl ? (
                        <div className="space-y-3">
                          <img
                            src={blank.images.front.downloadUrl}
                            alt="Front view"
                            className="w-full h-64 object-contain bg-white rounded border"
                          />
                          <div className="text-xs text-gray-500">
                            {blank.images.front.width} × {blank.images.front.height}px
                            {blank.images.front.bytes && ` • ${Math.round(blank.images.front.bytes / 1024)}KB`}
                          </div>
                          <button
                            onClick={() => handleFileSelect("front")}
                            disabled={uploadingView === "front"}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            {uploadingView === "front" ? "Uploading..." : "Replace Image"}
                          </button>
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <p className="text-sm text-gray-500 mb-3">No front image</p>
                          <button
                            onClick={() => handleFileSelect("front")}
                            disabled={uploadingView === "front"}
                            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {uploadingView === "front" ? "Uploading..." : "Upload Image"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Back Image */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900">Back</h4>
                    </div>
                    <div className="p-4">
                      {blank.images?.back?.downloadUrl ? (
                        <div className="space-y-3">
                          <img
                            src={blank.images.back.downloadUrl}
                            alt="Back view"
                            className="w-full h-64 object-contain bg-white rounded border"
                          />
                          <div className="text-xs text-gray-500">
                            {blank.images.back.width} × {blank.images.back.height}px
                            {blank.images.back.bytes && ` • ${Math.round(blank.images.back.bytes / 1024)}KB`}
                          </div>
                          <button
                            onClick={() => handleFileSelect("back")}
                            disabled={uploadingView === "back"}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            {uploadingView === "back" ? "Uploading..." : "Replace Image"}
                          </button>
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <p className="text-sm text-gray-500 mb-3">No back image</p>
                          <button
                            onClick={() => handleFileSelect("back")}
                            disabled={uploadingView === "back"}
                            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {uploadingView === "back" ? "Uploading..." : "Upload Image"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Placements Tab */}
            {activeTab === "placements" && (
              <div>
                <p className="text-sm text-gray-500 mb-4">
                  Default print placement configurations for this blank.
                </p>

                {blank.placements && blank.placements.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Placement
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Position (X, Y)
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Scale
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Safe Area
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {blank.placements.map((placement: any, i: number) => (
                          <tr key={i}>
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-gray-900">{placement.label}</span>
                              <span className="text-xs text-gray-500 ml-2">({placement.placementId})</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                              {placement.defaultX?.toFixed(2)}, {placement.defaultY?.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                              {placement.defaultScale?.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                              {placement.safeArea ? 
                                `${placement.safeArea.x?.toFixed(2)}, ${placement.safeArea.y?.toFixed(2)} (${placement.safeArea.w?.toFixed(2)} × ${placement.safeArea.h?.toFixed(2)})` 
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                    No placements configured
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-4">
                  Note: Placement editing is not available in MVP. Contact admin to modify.
                </p>
              </div>
            )}

            {/* Masks Tab */}
            {activeTab === "masks" && (
              <div>
                <div className="mb-4">
                  <p className="text-sm text-gray-500">
                    Print region masks control which areas the AI can modify during the realism pass.
                    White = editable (print area), Black = protected (garment + background).
                  </p>
                </div>

                {/* View Toggle */}
                <div className="flex gap-2 mb-6">
                  <button
                    onClick={() => setMaskView("front")}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      maskView === "front"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Front
                    {masks.front && <span className="ml-2 text-xs opacity-75">(uploaded)</span>}
                  </button>
                  <button
                    onClick={() => setMaskView("back")}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      maskView === "back"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Back
                    {masks.back && <span className="ml-2 text-xs opacity-75">(uploaded)</span>}
                  </button>
                </div>

                {masksLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-gray-500">Loading masks...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6">
                    {/* Blank Image (Reference) */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900">
                          Blank ({maskView})
                        </h4>
                      </div>
                      <div className="p-4">
                        {blank.images?.[maskView]?.downloadUrl ? (
                          <img
                            src={blank.images[maskView]!.downloadUrl}
                            alt={`${maskView} view`}
                            className="w-full h-64 object-contain bg-white rounded border"
                          />
                        ) : (
                          <div className="w-full h-64 bg-gray-100 rounded border flex items-center justify-center">
                            <p className="text-sm text-gray-500">No {maskView} image</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Mask Upload/Preview */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-900">
                          Print Mask ({maskView})
                        </h4>
                        {masks[maskView] && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        {masks[maskView]?.mask?.downloadUrl ? (
                          <div className="space-y-3">
                            <div className="relative">
                              <img
                                src={masks[maskView]!.mask.downloadUrl}
                                alt={`${maskView} mask`}
                                className="w-full h-64 object-contain bg-gray-800 rounded border"
                              />
                              {/* Overlay preview toggle could go here */}
                            </div>
                            <div className="text-xs text-gray-500">
                              {masks[maskView]!.mask.width} × {masks[maskView]!.mask.height}px
                              {masks[maskView]!.mask.bytes && ` • ${Math.round(masks[maskView]!.mask.bytes! / 1024)}KB`}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleMaskFileSelect(maskView)}
                                disabled={maskUploadingView === maskView || autoGenerating === maskView}
                                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                              >
                                {maskUploadingView === maskView ? "Uploading..." : "Replace Mask"}
                              </button>
                              <button
                                onClick={() => handleAutoGenerateMask(maskView)}
                                disabled={autoGenerating === maskView || maskUploadingView === maskView}
                                className="px-3 py-1.5 text-sm border border-purple-300 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-50"
                                title="Regenerate mask from safeArea placement"
                              >
                                {autoGenerating === maskView ? "Generating..." : "Regen from SafeArea"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-lg flex items-center justify-center">
                              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <p className="text-sm text-gray-500 mb-1">No {maskView} mask</p>
                            <p className="text-xs text-gray-400 mb-3">
                              PNG only. White = print area, Black = protected.
                            </p>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleMaskFileSelect(maskView)}
                                disabled={maskUploadingView === maskView || autoGenerating === maskView}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                              >
                                {maskUploadingView === maskView ? "Uploading..." : "Upload Mask"}
                              </button>
                              <button
                                onClick={() => handleAutoGenerateMask(maskView)}
                                disabled={autoGenerating === maskView || maskUploadingView === maskView}
                                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                              >
                                {autoGenerating === maskView ? "Generating..." : "Auto-generate from SafeArea"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Mask Status Summary */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Mask Status</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${masks.front ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className="text-gray-600">Front:</span>
                      <span className={masks.front ? "text-green-700 font-medium" : "text-gray-400"}>
                        {masks.front ? "Present" : "Missing"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${masks.back ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className="text-gray-600">Back:</span>
                      <span className={masks.back ? "text-green-700 font-medium" : "text-gray-400"}>
                        {masks.back ? "Present" : "Missing"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    When masks are present, the AI realism pass uses inpainting to only modify the print region.
                    Without masks, img2img is used on the full image.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BlankDetailPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <BlankDetailContent />
    </ProtectedRoute>
  );
}
