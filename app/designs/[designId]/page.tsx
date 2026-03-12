"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  useDesign,
  useDesignTeams,
  useUpdateDesign,
  useUpdateDesignFile,
} from "@/lib/hooks/useDesignAssets";
import { useBlanks } from "@/lib/hooks/useBlanks";
import {
  useMockAssets,
  useMockJobs,
  useCreateMockJob,
  useApproveMockAsset,
  useWatchMockJob,
} from "@/lib/hooks/useMockAssets";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { DesignColor, DesignStatus, HEX_COLOR_REGEX, RpMockAsset, RPBlank } from "@/lib/types/firestore";

function DesignDetailContent() {
  const params = useParams();
  const router = useRouter();
  const designId = params.designId as string;

  // Fetch design
  const { design, isLoading, error, mutate } = useDesign(designId);
  const { teams } = useDesignTeams();

  // Mutations
  const { updateDesign } = useUpdateDesign();
  const { updateFile } = useUpdateDesignFile();

  // Tab state: Overview, Files, Mockups, Print Pack
  const [activeTab, setActiveTab] = useState<"overview" | "files" | "mockups" | "printpack">("overview");

  // Mockups tab state
  const [selectedBlankId, setSelectedBlankId] = useState<string>("");
  const [mockView, setMockView] = useState<"front" | "back">("front");
  const [mockPlacementId, setMockPlacementId] = useState<"front_center" | "back_center" | "front_left" | "front_right" | "back_left" | "back_right">("front_center");
  const [mockQuality, setMockQuality] = useState<"draft" | "final">("draft");
  const [blankSearch, setBlankSearch] = useState("");
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  // Blanks for Mocks tab
  const { blanks, loading: blanksLoading } = useBlanks({ status: "active" });

  // Mock data
  const { createJob, isCreating: isCreatingMock, error: createMockError } = useCreateMockJob();
  const { assets: mockAssets, mutate: mutateMockAssets } = useMockAssets({ designId });
  const { jobs: mockJobs, mutate: mutateMockJobs } = useMockJobs({ designId });
  const { approveAsset, isApproving } = useApproveMockAsset();
  const { job: watchedJob } = useWatchMockJob(pendingJobId);

  // Sync placement when view changes (front -> front_center, back -> back_center)
  useEffect(() => {
    setMockPlacementId(mockView === "front" ? "front_center" : "back_center");
  }, [mockView]);

  // Filter blanks based on search
  const filteredBlanks = blanks.filter((b) => {
    if (!blankSearch) return true;
    const search = blankSearch.toLowerCase();
    return (
      b.styleName?.toLowerCase().includes(search) ||
      b.colorName?.toLowerCase().includes(search) ||
      b.styleCode?.toLowerCase().includes(search) ||
      b.slug?.toLowerCase().includes(search)
    );
  });

  // Get selected blank (used below for placements and view image)
  const selectedBlank = blanks.find((b) => b.blankId === selectedBlankId);

  // Get placements for selected blank+view (front_* or back_*)
  const mockPlacementOptions = (selectedBlank?.placements || design?.placementDefaults || [])
    .filter((p: { placementId: string }) => (p as { placementId: string }).placementId.startsWith(mockView === "front" ? "front_" : "back_"))
    .map((p: { placementId: string; label?: string }) => ({ id: (p as { placementId: string }).placementId, label: (p as { label?: string }).label || (p as { placementId: string }).placementId.replace(/_/g, " ") }));
  const defaultPlacementId = mockView === "front" ? "front_center" : "back_center";
  const effectivePlacementId = mockPlacementOptions.length > 0
    ? (mockPlacementOptions.some((o: { id: string }) => o.id === mockPlacementId) ? mockPlacementId : mockPlacementOptions[0]!.id)
    : defaultPlacementId;

  // Clear pending job when it completes
  useEffect(() => {
    if (watchedJob && (watchedJob.status === "succeeded" || watchedJob.status === "failed")) {
      setPendingJobId(null);
      mutateMockAssets();
      mutateMockJobs();
      if (watchedJob.status === "succeeded") {
        showToast("Mock generated successfully!", "success");
      } else if (watchedJob.status === "failed") {
        showToast(`Mock generation failed: ${watchedJob.error?.message || "Unknown error"}`, "error");
      }
    }
  }, [watchedJob]);

  // Check if selected blank has the selected view image
  const hasViewImage = selectedBlank?.images?.[mockView]?.downloadUrl;

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Upload state
  const [uploadingKind, setUploadingKind] = useState<"png" | "pdf" | "svg" | null>(null);
  const pngInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [isEditingColors, setIsEditingColors] = useState(false);
  const [editedColors, setEditedColors] = useState<DesignColor[]>([]);
  const [colorError, setColorError] = useState<string | null>(null);
  const [isSavingColors, setIsSavingColors] = useState(false);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleStatusChange = async (newStatus: DesignStatus) => {
    if (!design?.id) return;

    try {
      await updateDesign({
        designId: design.id,
        status: newStatus,
      });
      showToast(`Status updated to ${newStatus}`, "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to update status:", err);
      showToast("Failed to update status", "error");
    }
  };

  const handlePngUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;

    if (!file.type.startsWith("image/png") && !file.type.startsWith("image/")) {
      showToast("Please upload a PNG image", "error");
      return;
    }
    const PNG_MAX_BYTES = 25 * 1024 * 1024; // 25MB
    if (file.size > PNG_MAX_BYTES) {
      showToast("PNG must be under 25MB", "error");
      return;
    }

    setUploadingKind("png");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      // Generate storage path
      const ext = file.name.split(".").pop() || "png";
      const storagePath = `designs/${design.id}/png/${file.name}`;

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

      // Update design with file metadata
      await updateFile({
        designId: design.id,
        kind: "png",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        widthPx: img.width,
        heightPx: img.height,
      });

      showToast("PNG uploaded successfully!", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload PNG:", err);
      showToast("Failed to upload PNG", "error");
    } finally {
      setUploadingKind(null);
      if (pngInputRef.current) {
        pngInputRef.current.value = "";
      }
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;

    if (file.type !== "application/pdf") {
      showToast("Please upload a PDF file", "error");
      return;
    }
    const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50MB
    if (file.size > PDF_MAX_BYTES) {
      showToast("PDF must be under 50MB", "error");
      return;
    }

    setUploadingKind("pdf");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      // Generate storage path
      const storagePath = `designs/${design.id}/pdf/${file.name}`;

      // Upload to Firebase Storage
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // Update design with file metadata
      await updateFile({
        designId: design.id,
        kind: "pdf",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      showToast("PDF uploaded successfully!", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload PDF:", err);
      showToast("Failed to upload PDF", "error");
    } finally {
      setUploadingKind(null);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
    }
  };

  const handleSvgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;

    if (file.type !== "image/svg+xml" && !file.name.toLowerCase().endsWith(".svg")) {
      showToast("Please upload an SVG file", "error");
      return;
    }
    const SVG_MAX_BYTES = 5 * 1024 * 1024; // 5MB
    if (file.size > SVG_MAX_BYTES) {
      showToast("SVG must be under 5MB", "error");
      return;
    }

    setUploadingKind("svg");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      const storagePath = `designs/${design.id}/svg/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateFile({
        designId: design.id,
        kind: "svg",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type || "image/svg+xml",
        sizeBytes: file.size,
      });

      showToast("SVG uploaded successfully!", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload SVG:", err);
      showToast("Failed to upload SVG", "error");
    } finally {
      setUploadingKind(null);
      if (svgInputRef.current) {
        svgInputRef.current.value = "";
      }
    }
  };

  const startEditingColors = () => {
    setEditedColors([...design!.colors]);
    setIsEditingColors(true);
    setColorError(null);
  };

  const handleAddColor = () => {
    setEditedColors([...editedColors, { hex: "#000000", name: "", role: "ink" }]);
  };

  const handleRemoveColor = (index: number) => {
    if (editedColors.length <= 1) return;
    setEditedColors(editedColors.filter((_, i) => i !== index));
  };

  const handleColorChange = (index: number, field: keyof DesignColor, value: string) => {
    const updated = [...editedColors];
    updated[index] = { ...updated[index], [field]: value };
    setEditedColors(updated);
  };

  const handleSaveColors = async () => {
    setColorError(null);

    // Validate colors
    for (const color of editedColors) {
      if (!HEX_COLOR_REGEX.test(color.hex)) {
        setColorError(`Invalid hex color: ${color.hex}`);
        return;
      }
    }

    if (editedColors.length === 0) {
      setColorError("At least one color is required");
      return;
    }

    setIsSavingColors(true);

    try {
      await updateDesign({
        designId: design!.id,
        colors: editedColors,
      });
      showToast("Colors updated successfully!", "success");
      setIsEditingColors(false);
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to update colors:", err);
      showToast("Failed to update colors", "error");
    } finally {
      setIsSavingColors(false);
    }
  };

  // Mock generation handler
  const handleGenerateMock = async () => {
    if (!design?.id || !selectedBlankId) {
      showToast("Please select a blank", "error");
      return;
    }

    if (!design.files?.png?.downloadUrl) {
      showToast("Design must have a PNG file uploaded", "error");
      return;
    }

    if (!hasViewImage) {
      showToast(`Selected blank does not have a ${mockView} image`, "error");
      return;
    }

    const jobId = await createJob({
      designId: design.id,
      blankId: selectedBlankId,
      view: mockView,
      placementId: effectivePlacementId as "front_center" | "back_center" | "front_left" | "front_right" | "back_left" | "back_right",
      quality: mockQuality,
    });

    if (jobId) {
      setPendingJobId(jobId);
      showToast("Mock generation started...", "success");
    } else if (createMockError) {
      showToast(createMockError, "error");
    }
  };

  // Approve handler
  const handleApprove = async (asset: RpMockAsset) => {
    const success = await approveAsset(asset.id, !asset.approved, design?.id);
    if (success) {
      showToast(asset.approved ? "Approval removed" : "Mock approved!", "success");
      mutateMockAssets();
    }
  };

  // Copy URL handler
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    showToast("URL copied to clipboard", "success");
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading design...</p>
      </div>
    );
  }

  if (error || !design) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Design not found"}</p>
          <Link href="/designs" className="text-blue-600 hover:underline">
            ← Back to Designs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hidden file inputs */}
      <input
        ref={pngInputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={handlePngUpload}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handlePdfUpload}
      />
      <input
        ref={svgInputRef}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        onChange={handleSvgUpload}
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
          <Link href="/designs" className="text-blue-600 hover:underline text-sm">
            ← Back to Designs
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">
                  {design.teamNameCache} — {design.name}
                </h1>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    design.status === "active"
                      ? "bg-green-100 text-green-700"
                      : design.status === "draft"
                      ? "bg-gray-100 text-gray-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {design.status}
                </span>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    design.isComplete
                      ? "bg-green-100 text-green-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {design.isComplete ? "Complete" : "Incomplete"}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{design.slug}</p>
              {design.tags && design.tags.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {design.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Status dropdown */}
              <select
                value={design.status}
                onChange={(e) => handleStatusChange(e.target.value as DesignStatus)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200">
            <div>
              <div className="text-sm text-gray-500">Team</div>
              <div className="font-medium">{design.teamNameCache || design.teamId}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Colors</div>
              <div className="flex items-center gap-1 mt-1">
                {design.colors.slice(0, 4).map((color, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 rounded-full border border-gray-300"
                    style={{ backgroundColor: color.hex }}
                    title={color.name || color.hex}
                  />
                ))}
                {design.colors.length > 4 && (
                  <span className="text-xs text-gray-500">+{design.colors.length - 4}</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Files</div>
              <div className="text-sm">
                SVG: {design.files?.svg ? "✓" : "✗"} | PNG: {design.hasPng ? "✓" : "✗"} | PDF: {design.hasPdf ? "✓" : "✗"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Linked</div>
              <div className="text-sm">
                {design.linkedBlankVariantCount} blanks, {design.linkedProductCount} products
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {(["overview", "files", "mockups", "printpack"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 ${
                    activeTab === tab
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "printpack" ? "Print Pack" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  {/* Preview */}
                  <div className="bg-gray-100 rounded-lg p-4 flex items-center justify-center min-h-[300px]">
                    {design.files?.png?.downloadUrl ? (
                      <img
                        src={design.files.png.downloadUrl}
                        alt={design.name}
                        className="max-w-full max-h-[280px] object-contain"
                      />
                    ) : (
                      <div className="text-center text-gray-500">
                        <svg className="w-16 h-16 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p>No PNG uploaded</p>
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium text-gray-700 mb-2">Design Info</h3>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Name</dt>
                          <dd className="font-medium">{design.name}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Team</dt>
                          <dd>{design.teamNameCache}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Color Count</dt>
                          <dd>{design.colorCount}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Status</dt>
                          <dd className="capitalize">{design.status}</dd>
                        </div>
                      </dl>
                    </div>

                    {design.description && (
                      <div>
                        <h3 className="font-medium text-gray-700 mb-2">Description</h3>
                        <p className="text-sm text-gray-600">{design.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Files Tab: SVG + PNG + PDF + colors + validations */}
            {activeTab === "files" && (
              <div className="space-y-6">
                <p className="text-sm text-gray-600">
                  SVG (master vector), PNG (rendering/AI), PDF (print vendor). Max: SVG 5MB, PNG 25MB, PDF 50MB.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* SVG Upload */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-3">SVG (Master Vector)</h3>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.svg?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.svg.downloadUrl}
                            alt="SVG preview"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.svg.fileName}</p>
                            <p>{formatBytes(design.files.svg.sizeBytes)}</p>
                          </div>
                          <a
                            href={design.files.svg.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-sm text-blue-600 hover:underline"
                          >
                            Download SVG
                          </a>
                        </>
                      ) : (
                        <div className="text-center text-gray-400">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <p>No SVG uploaded</p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => svgInputRef.current?.click()}
                      disabled={uploadingKind === "svg"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "svg"
                        ? "Uploading..."
                        : design.files?.svg
                        ? "Replace SVG"
                        : "Upload SVG"}
                    </button>
                  </div>

                  {/* PNG Upload */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-3">PNG (Rendering / AI)</h3>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.png?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.png.downloadUrl}
                            alt="PNG preview"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.png.fileName}</p>
                            <p>{formatBytes(design.files.png.sizeBytes)}</p>
                            {design.files.png.widthPx && design.files.png.heightPx && (
                              <p>{design.files.png.widthPx} × {design.files.png.heightPx}px</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-gray-400">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p>No PNG uploaded</p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => pngInputRef.current?.click()}
                      disabled={uploadingKind === "png"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "png"
                        ? "Uploading..."
                        : design.files?.png
                        ? "Replace PNG"
                        : "Upload PNG"}
                    </button>
                  </div>

                  {/* PDF Upload */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-3">PDF (Print-Ready)</h3>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.pdf?.downloadUrl ? (
                        <>
                          <svg className="w-16 h-16 text-red-500 mb-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                            <path d="M8 12h8v2H8zm0 4h5v2H8z"/>
                          </svg>
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.pdf.fileName}</p>
                            <p>{formatBytes(design.files.pdf.sizeBytes)}</p>
                          </div>
                          <a
                            href={design.files.pdf.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-sm text-blue-600 hover:underline"
                          >
                            View PDF
                          </a>
                        </>
                      ) : (
                        <div className="text-center text-gray-400">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p>No PDF uploaded</p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => pdfInputRef.current?.click()}
                      disabled={uploadingKind === "pdf"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "pdf"
                        ? "Uploading..."
                        : design.files?.pdf
                        ? "Replace PDF"
                        : "Upload PDF"}
                    </button>
                  </div>
                </div>

                {/* Colors section (inline in Files tab) */}
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium">Print Colors ({design.colorCount})</h3>
                    {!isEditingColors && (
                      <button
                        onClick={startEditingColors}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Edit Colors
                      </button>
                    )}
                  </div>
                  {colorError && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                      {colorError}
                    </div>
                  )}
                  {isEditingColors ? (
                    <div className="space-y-3">
                      {editedColors.map((color, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          <input
                            type="color"
                            value={color.hex}
                            onChange={(e) => handleColorChange(index, "hex", e.target.value)}
                            className="w-10 h-10 border border-gray-300 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={color.hex}
                            onChange={(e) => handleColorChange(index, "hex", e.target.value)}
                            placeholder="#000000"
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                          />
                          <input
                            type="text"
                            value={color.name || ""}
                            onChange={(e) => handleColorChange(index, "name", e.target.value)}
                            placeholder="Color name"
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <select
                            value={color.role || "ink"}
                            onChange={(e) => handleColorChange(index, "role", e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          >
                            <option value="ink">Ink</option>
                            <option value="accent">Accent</option>
                            <option value="underbase">Underbase</option>
                          </select>
                          {editedColors.length > 1 && (
                            <button
                              onClick={() => handleRemoveColor(index)}
                              className="text-red-500 hover:text-red-700"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={handleAddColor}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        + Add Color
                      </button>
                      <div className="flex justify-end gap-2 pt-4">
                        <button
                          onClick={() => setIsEditingColors(false)}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveColors}
                          disabled={isSavingColors}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isSavingColors ? "Saving..." : "Save Colors"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {design.colors.map((color, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          <div
                            className="w-8 h-8 rounded-full border border-gray-300"
                            style={{ backgroundColor: color.hex }}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">
                              {color.name || "Unnamed"}
                            </div>
                            <div className="text-xs text-gray-500">{color.hex}</div>
                          </div>
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs capitalize">
                            {color.role || "ink"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Mockups Tab */}
            {activeTab === "mockups" && (
              <div className="space-y-6">
                {/* Generator Section */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium mb-4">Generate Mock</h3>
                  
                  {!design.files?.png?.downloadUrl && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                      This design needs a PNG file uploaded before generating mocks.
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {/* Blank Selector */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Blank
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={blankSearch}
                          onChange={(e) => setBlankSearch(e.target.value)}
                          placeholder="Search blanks..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                        />
                        <select
                          value={selectedBlankId}
                          onChange={(e) => setSelectedBlankId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select a blank...</option>
                          {filteredBlanks.map((blank) => (
                            <option key={blank.blankId} value={blank.blankId}>
                              {blank.styleCode} {blank.styleName} — {blank.colorName}
                            </option>
                          ))}
                        </select>
                      </div>
                      {blanksLoading && (
                        <p className="text-xs text-gray-500 mt-1">Loading blanks...</p>
                      )}
                    </div>

                    {/* View Toggle */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        View
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setMockView("front")}
                          className={`flex-1 px-4 py-2 rounded-lg border ${
                            mockView === "front"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          Front
                        </button>
                        <button
                          onClick={() => setMockView("back")}
                          className={`flex-1 px-4 py-2 rounded-lg border ${
                            mockView === "back"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          Back
                        </button>
                      </div>
                      {selectedBlank && !hasViewImage && (
                        <p className="text-xs text-red-500 mt-1">
                          This blank does not have a {mockView} image
                        </p>
                      )}
                    </div>

                    {/* Placement Selector */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Placement
                      </label>
                      <select
                        value={effectivePlacementId}
                        onChange={(e) => setMockPlacementId(e.target.value as typeof mockPlacementId)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {mockPlacementOptions.length > 0 ? (
                          mockPlacementOptions.map((opt: { id: string; label: string }) => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                          ))
                        ) : (
                          <>
                            <option value="front_center">Front Center</option>
                            <option value="back_center">Back Center</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Quality Toggle */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Quality
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMockQuality("draft")}
                        className={`px-4 py-2 rounded-lg border ${
                          mockQuality === "draft"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        Draft (Fast)
                      </button>
                      <button
                        onClick={() => setMockQuality("final")}
                        className={`px-4 py-2 rounded-lg border ${
                          mockQuality === "final"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        Final (AI Realism)
                      </button>
                    </div>
                    {mockQuality === "final" && (
                      <p className="text-xs text-gray-500 mt-1">
                        Note: AI realism pass is coming in Phase 2
                      </p>
                    )}
                  </div>

                  {/* Generate Button */}
                  <button
                    onClick={handleGenerateMock}
                    disabled={
                      isCreatingMock ||
                      pendingJobId !== null ||
                      !selectedBlankId ||
                      !design.files?.png?.downloadUrl ||
                      !hasViewImage
                    }
                    className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {isCreatingMock
                      ? "Creating Job..."
                      : pendingJobId
                      ? "Generating..."
                      : "Generate Mock"}
                  </button>

                  {/* Processing Indicator */}
                  {pendingJobId && watchedJob && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                        <span className="text-sm text-blue-800">
                          Processing: {watchedJob.status}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Results Grid */}
                <div>
                  <h3 className="font-medium mb-4">
                    Generated Mocks ({mockAssets.length})
                  </h3>

                  {mockAssets.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <svg
                        className="w-16 h-16 mx-auto mb-4 text-gray-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p>No mocks generated yet</p>
                      <p className="text-sm">Select a blank and click Generate Mock</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {mockAssets.map((asset) => {
                        // Find the blank info for this asset
                        const assetBlank = blanks.find(
                          (b) => b.blankId === asset.blankId
                        );
                        return (
                          <div
                            key={asset.id}
                            className={`bg-white border rounded-lg overflow-hidden ${
                              asset.approved
                                ? "border-green-500 ring-2 ring-green-200"
                                : "border-gray-200"
                            }`}
                          >
                            {/* Preview */}
                            <div className="aspect-square bg-gray-100 relative">
                              <img
                                src={asset.image.downloadUrl}
                                alt="Mock preview"
                                className="w-full h-full object-contain"
                              />
                              {asset.approved && (
                                <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs font-medium">
                                  Approved
                                </div>
                              )}
                              <div className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs">
                                {asset.kind === "draft_composite"
                                  ? "Draft"
                                  : "Final"}
                              </div>
                            </div>

                            {/* Info */}
                            <div className="p-3">
                              <div className="text-sm font-medium truncate">
                                {assetBlank
                                  ? `${assetBlank.styleCode} ${assetBlank.colorName}`
                                  : asset.blankId}
                              </div>
                              <div className="text-xs text-gray-500">
                                {asset.view} view •{" "}
                                {asset.createdAt
                                  ? new Date(
                                      asset.createdAt.seconds * 1000
                                    ).toLocaleDateString()
                                  : ""}
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 mt-3">
                                <button
                                  onClick={() => handleApprove(asset)}
                                  disabled={isApproving}
                                  className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${
                                    asset.approved
                                      ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                      : "bg-green-100 text-green-700 hover:bg-green-200"
                                  }`}
                                >
                                  {asset.approved ? "Unapprove" : "Approve"}
                                </button>
                                <button
                                  onClick={() =>
                                    handleCopyUrl(asset.image.downloadUrl)
                                  }
                                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
                                  title="Copy URL"
                                >
                                  <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DesignDetailPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <DesignDetailContent />
    </ProtectedRoute>
  );
}
