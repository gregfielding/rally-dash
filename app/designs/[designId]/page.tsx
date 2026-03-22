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
  useDeleteDesign,
} from "@/lib/hooks/useDesignAssets";
import {
  useTaxonomySports,
  useTaxonomyLeagues,
  useTaxonomyEntities,
  useTaxonomyThemes,
  useTaxonomyDesignFamilies,
} from "@/lib/hooks/useTaxonomy";
import { validateTaxonomyClassification } from "@/lib/taxonomy/validateTaxonomy";
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
import {
  DesignColor,
  DesignStatus,
  HEX_COLOR_REGEX,
  RpMockAsset,
  RPBlank,
  type DesignThemeValue,
} from "@/lib/types/firestore";
import { DESIGN_THEME_OPTIONS, designThemeLabel, isCanonicalDesignTheme } from "@/lib/designs/designThemes";
import {
  computeDesignCompleteness,
  designHasUsablePng,
  resolveDesignAssets,
  designGarmentAssetBadges,
  getDesignPrintSidesMode,
  type DesignPrintSidesMode,
} from "@/lib/designs/designHelpers";
import { isMasterBlank, countActiveVariants } from "@/lib/blanks";
import { useProductsByDesignIndex } from "@/lib/hooks/useProductsByDesign";
import { formatCmyk, resolveDesignInkPaletteForDisplay } from "@/lib/print/standardPrintInks";
import { normalizeDesignSeriesInput } from "@/lib/designs/normalizeDesignSeries";

function DesignDetailContent() {
  const params = useParams();
  const router = useRouter();
  const designId = params.designId as string;

  // Fetch design
  const { design, isLoading, error, mutate } = useDesign(designId);
  const { teams } = useDesignTeams();
  const { getProductsForDesign } = useProductsByDesignIndex();
  const linkedProducts = getProductsForDesign(designId);

  // Taxonomy form state (for dropdowns; must be before taxonomy hooks that filter by it)
  const [taxSportCode, setTaxSportCode] = useState<string | null>(null);
  const [taxLeagueCode, setTaxLeagueCode] = useState<string | null>(null);
  const [taxTeamCode, setTaxTeamCode] = useState<string | null>(null);
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

  // Mutations
  const { updateDesign } = useUpdateDesign();
  const { updateFile } = useUpdateDesignFile();
  const { deleteDesign } = useDeleteDesign();

  const [deletingDesign, setDeletingDesign] = useState(false);
  const [deleteDesignError, setDeleteDesignError] = useState<string | null>(null);

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
  const [uploadingKind, setUploadingKind] = useState<
    | "lightPng"
    | "darkPng"
    | "png"
    | "lightPdf"
    | "darkPdf"
    | "lightSvg"
    | "darkSvg"
    | null
  >(null);
  const lightPngInputRef = useRef<HTMLInputElement>(null);
  const darkPngInputRef = useRef<HTMLInputElement>(null);
  const pngInputRef = useRef<HTMLInputElement>(null);
  const lightPdfInputRef = useRef<HTMLInputElement>(null);
  const darkPdfInputRef = useRef<HTMLInputElement>(null);
  const lightSvgInputRef = useRef<HTMLInputElement>(null);
  const darkSvgInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [isEditingColors, setIsEditingColors] = useState(false);
  const [editedColors, setEditedColors] = useState<DesignColor[]>([]);
  const [colorError, setColorError] = useState<string | null>(null);
  const [isSavingColors, setIsSavingColors] = useState(false);
  const [editDesignType, setEditDesignType] = useState<DesignThemeValue>("city_69");
  const [editDesignSeries, setEditDesignSeries] = useState("");
  const [internalNotesEdit, setInternalNotesEdit] = useState("");
  /** Controls product Render Setup: which sides show this artwork when only `designId` is set. */
  const [editPrintSides, setEditPrintSides] = useState<DesignPrintSidesMode>("both");
  const [savingMeta, setSavingMeta] = useState(false);

  // Sync taxonomy form state from design when design loads/updates
  useEffect(() => {
    if (design) {
      setTaxSportCode(design.sportCode ?? null);
      setTaxLeagueCode(design.leagueCode ?? null);
      setTaxTeamCode(design.teamCode ?? null);
      setTaxThemeCode(design.themeCode ?? null);
      setTaxDesignFamily(design.designFamily ?? null);
      setEditDesignType(design.designType ?? "city_69");
      setEditDesignSeries(design.designSeries ?? "");
      setInternalNotesEdit(design.internalNotes || design.description || "");
      setEditPrintSides(getDesignPrintSidesMode(design));
    }
  }, [
    design?.id,
    design?.sportCode,
    design?.leagueCode,
    design?.teamCode,
    design?.themeCode,
    design?.designFamily,
    design?.designType,
    design?.designSeries,
    design?.internalNotes,
    design?.description,
    design?.supportedSides,
  ]);

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

  const handleSaveTaxonomy = async () => {
    if (!design?.id) return;
    const validation = validateTaxonomyClassification({
      sportCode: taxSportCode ?? null,
      leagueCode: taxLeagueCode ?? null,
      teamCode: taxTeamCode ?? null,
    });
    if (!validation.valid) {
      showToast(validation.message ?? "Invalid taxonomy", "error");
      return;
    }
    setIsSavingTaxonomy(true);
    try {
      await updateDesign({
        designId: design.id,
        sportCode: taxSportCode ?? null,
        leagueCode: taxLeagueCode ?? null,
        teamCode: taxTeamCode ?? null,
        themeCode: taxThemeCode ?? null,
        designFamily: taxDesignFamily ?? null,
      });
      showToast("Taxonomy updated", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to update taxonomy:", err);
      showToast("Failed to update taxonomy", "error");
    } finally {
      setIsSavingTaxonomy(false);
    }
  };

  const uploadRasterOverlay = async (
    file: File,
    kind: "lightPng" | "darkPng" | "png",
    subPath: string | null
  ) => {
    if (!design?.id) return;
    if (!file.type.startsWith("image/png") && !file.type.startsWith("image/")) {
      showToast("Please upload a PNG image", "error");
      return;
    }
    const PNG_MAX_BYTES = 25 * 1024 * 1024;
    if (file.size > PNG_MAX_BYTES) {
      showToast("PNG must be under 25MB", "error");
      return;
    }
    if (!storage) throw new Error("Firebase Storage not initialized");

    const storagePath = subPath
      ? `designs/${design.id}/png/${subPath}/${file.name}`
      : `designs/${design.id}/png/${file.name}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

    await updateFile({
      designId: design.id,
      kind,
      storagePath,
      downloadUrl,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      widthPx: img.width,
      heightPx: img.height,
    });
  };

  const handleLightPngUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;
    setUploadingKind("lightPng");
    try {
      await uploadRasterOverlay(file, "lightPng", "light");
      showToast("Light PNG uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Light PNG upload failed:", err);
      showToast("Failed to upload light PNG", "error");
    } finally {
      setUploadingKind(null);
      if (lightPngInputRef.current) lightPngInputRef.current.value = "";
    }
  };

  const handleDarkPngUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;
    setUploadingKind("darkPng");
    try {
      await uploadRasterOverlay(file, "darkPng", "dark");
      showToast("Dark PNG uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Dark PNG upload failed:", err);
      showToast("Failed to upload dark PNG", "error");
    } finally {
      setUploadingKind(null);
      if (darkPngInputRef.current) darkPngInputRef.current.value = "";
    }
  };

  /** Legacy single-PNG slot (older records) */
  const handleLegacyPngUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !design?.id) return;
    setUploadingKind("png");
    try {
      await uploadRasterOverlay(file, "png", null);
      showToast("Legacy PNG slot updated", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload PNG:", err);
      showToast("Failed to upload PNG", "error");
    } finally {
      setUploadingKind(null);
      if (pngInputRef.current) pngInputRef.current.value = "";
    }
  };

  const handleLightPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingKind("lightPdf");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      const storagePath = `designs/${design.id}/pdf/light/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateFile({
        designId: design.id,
        kind: "lightPdf",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      showToast("Light garment PDF uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload light PDF:", err);
      showToast("Failed to upload PDF", "error");
    } finally {
      setUploadingKind(null);
      if (lightPdfInputRef.current) {
        lightPdfInputRef.current.value = "";
      }
    }
  };

  const handleDarkPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingKind("darkPdf");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      const storagePath = `designs/${design.id}/pdf/dark/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateFile({
        designId: design.id,
        kind: "darkPdf",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      showToast("Dark garment PDF uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload dark PDF:", err);
      showToast("Failed to upload PDF", "error");
    } finally {
      setUploadingKind(null);
      if (darkPdfInputRef.current) {
        darkPdfInputRef.current.value = "";
      }
    }
  };

  const handleLightSvgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingKind("lightSvg");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      const storagePath = `designs/${design.id}/svg/light/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateFile({
        designId: design.id,
        kind: "lightSvg",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type || "image/svg+xml",
        sizeBytes: file.size,
      });

      showToast("Light garment SVG uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload light SVG:", err);
      showToast("Failed to upload SVG", "error");
    } finally {
      setUploadingKind(null);
      if (lightSvgInputRef.current) {
        lightSvgInputRef.current.value = "";
      }
    }
  };

  const handleDarkSvgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingKind("darkSvg");

    try {
      if (!storage) {
        throw new Error("Firebase Storage not initialized");
      }

      const storagePath = `designs/${design.id}/svg/dark/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateFile({
        designId: design.id,
        kind: "darkSvg",
        storagePath,
        downloadUrl,
        fileName: file.name,
        contentType: file.type || "image/svg+xml",
        sizeBytes: file.size,
      });

      showToast("Dark garment SVG uploaded", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Failed to upload dark SVG:", err);
      showToast("Failed to upload SVG", "error");
    } finally {
      setUploadingKind(null);
      if (darkSvgInputRef.current) {
        darkSvgInputRef.current.value = "";
      }
    }
  };

  const startEditingColors = () => {
    setEditedColors([...design!.colors]);
    setIsEditingColors(true);
    setColorError(null);
  };

  const handleAddColor = () => {
    setEditedColors([...editedColors, { hex: "#000000", name: "", role: "accent" }]);
  };

  const handleSaveDesignMeta = async () => {
    if (!design?.id) return;
    setSavingMeta(true);
    try {
      await updateDesign({
        designId: design.id,
        designType: editDesignType,
        designSeries: normalizeDesignSeriesInput(editDesignSeries),
        internalNotes: internalNotesEdit.trim() || null,
        supportedSides:
          editPrintSides === "both"
            ? null
            : editPrintSides === "front"
              ? ["front"]
              : ["back"],
      });
      showToast("Design metadata saved", "success");
      mutate();
    } catch (err: any) {
      console.error("[DesignDetail] Save meta failed:", err);
      showToast("Failed to save", "error");
    } finally {
      setSavingMeta(false);
    }
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

    if (!designHasUsablePng(design)) {
      showToast("Design must have light + dark PNGs (or a legacy PNG) uploaded", "error");
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

  const handleDeleteDesign = async () => {
    if (!design?.id || linkedProducts.length > 0) return;
    const confirmed = window.confirm(
      `Permanently delete design "${design.name}"?\n\nThis cannot be undone. Files in Firebase Storage are not removed automatically.`
    );
    if (!confirmed) return;
    setDeletingDesign(true);
    setDeleteDesignError(null);
    try {
      await deleteDesign(design.id);
      router.push("/designs");
    } catch (err: unknown) {
      console.error("[DesignDetail] Delete failed:", err);
      const message =
        err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "permission-denied"
          ? "You don’t have permission to delete this design."
          : err instanceof Error
            ? err.message
            : "Failed to delete design";
      setDeleteDesignError(message);
    } finally {
      setDeletingDesign(false);
    }
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

  const completeness = computeDesignCompleteness(design);
  const assetUrls = resolveDesignAssets(design);
  const garmentBadges = designGarmentAssetBadges(design);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hidden file inputs */}
      <input
        ref={lightPngInputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={handleLightPngUpload}
      />
      <input
        ref={darkPngInputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={handleDarkPngUpload}
      />
      <input
        ref={pngInputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={handleLegacyPngUpload}
      />
      <input
        ref={lightPdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleLightPdfUpload}
      />
      <input
        ref={darkPdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleDarkPdfUpload}
      />
      <input
        ref={lightSvgInputRef}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        onChange={handleLightSvgUpload}
      />
      <input
        ref={darkSvgInputRef}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        onChange={handleDarkSvgUpload}
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
            ← Design Library
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{design.name}</h1>
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
                  title={completeness.detail}
                  className={`px-2 py-1 text-xs rounded-full ${
                    completeness.level === "complete"
                      ? "bg-green-100 text-green-700"
                      : completeness.level === "partial"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {completeness.label}
                </span>
                {design.designType && (
                  <span className="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-800">
                    {designThemeLabel(design.designType)}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-medium text-gray-800">
                  {design.leagueId?.trim() ||
                    teams.find((t) => t.id === design.teamId)?.league ||
                    "—"}
                </span>
                {" · "}
                {design.teamNameCache || design.teamId}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-medium text-gray-700">Series:</span>{" "}
                <span className="font-mono text-gray-800">{design.designSeries || "—"}</span>
              </p>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200">
            <div>
              <div className="text-sm text-gray-500">League</div>
              <div className="font-medium">
                {design.leagueId?.trim() ||
                  teams.find((t) => t.id === design.teamId)?.league ||
                  "—"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Team</div>
              <div className="font-medium">{design.teamNameCache || design.teamId}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Garment assets</div>
              <div className="flex flex-wrap gap-1 mt-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    garmentBadges.light ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  Light Garment {garmentBadges.light ? "✓" : "missing"}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    garmentBadges.dark ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  Dark Garment {garmentBadges.dark ? "✓" : "missing"}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Used on products</div>
              <div className="text-sm font-medium">
                {linkedProducts.length} live link{linkedProducts.length !== 1 ? "s" : ""}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Blank links: {design.linkedBlankVariantCount} (separate from products)
              </p>
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
            {/* Overview Tab — artwork inventory (not product/Shopify content) */}
            {activeTab === "overview" && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Assets</h3>
                  <p className="text-xs text-gray-500 mb-4">
                    Two garment variants: use <strong>Light Garment</strong> on light blanks (white, grey, …) and{" "}
                    <strong>Dark Garment</strong> on dark blanks (black, navy, …). The renderer picks by garment color
                    family — not a design-level light/dark mode.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-3">
                      <h4 className="text-sm font-medium text-amber-900 mb-2">Light Garment PNG</h4>
                      <p className="text-xs text-amber-800 mb-3">Overlay for light-colored garments.</p>
                      <div className="bg-white rounded-lg p-4 flex items-center justify-center min-h-[200px] border border-amber-100">
                        {assetUrls.lightPng ? (
                          <img
                            src={assetUrls.lightPng}
                            alt="Light garment"
                            className="max-w-full max-h-[220px] object-contain"
                          />
                        ) : (
                          <p className="text-gray-500 text-sm">Not uploaded</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border-2 border-slate-700 bg-slate-900/5 p-3">
                      <h4 className="text-sm font-medium text-slate-900 mb-2">Dark Garment PNG</h4>
                      <p className="text-xs text-slate-600 mb-3">Overlay for dark-colored garments.</p>
                      <div className="bg-slate-100 rounded-lg p-4 flex items-center justify-center min-h-[200px] border border-slate-200">
                        {assetUrls.darkPng ? (
                          <img
                            src={assetUrls.darkPng}
                            alt="Dark garment"
                            className="max-w-full max-h-[220px] object-contain"
                          />
                        ) : (
                          <p className="text-gray-500 text-sm">Not uploaded</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-sm">
                  {assetUrls.lightSvg && (
                    <a
                      href={assetUrls.lightSvg}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Light garment SVG
                    </a>
                  )}
                  {assetUrls.darkSvg && (
                    <a
                      href={assetUrls.darkSvg}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Dark garment SVG
                    </a>
                  )}
                  {assetUrls.lightPdf && (
                    <a
                      href={assetUrls.lightPdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Light garment PDF
                    </a>
                  )}
                  {assetUrls.darkPdf && (
                    <a
                      href={assetUrls.darkPdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Dark garment PDF
                    </a>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Print colors (hex + CMYK)</h3>
                  <p className="text-xs text-gray-500 mb-2">
                    Off Black <span className="font-mono">#111111</span> and Off White{" "}
                    <span className="font-mono">#F5F5F5</span> are included on every design for production; CMYK is derived
                    from hex (sRGB reference).
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {resolveDesignInkPaletteForDisplay(design.colors).map((c, i) => (
                      <li
                        key={i}
                        className="inline-flex flex-col gap-0.5 px-2 py-1.5 rounded border border-gray-200 bg-white text-xs min-w-[8rem]"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                            style={{ backgroundColor: c.hex }}
                          />
                          <span className="text-gray-700 font-medium">{c.name || c.role || "Ink"}</span>
                        </span>
                        <span className="font-mono text-gray-800 pl-6">{c.hex}</span>
                        <span className="text-[10px] text-gray-500 pl-6 font-mono">{formatCmyk(c.cmyk)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Products using this design</h3>
                  {linkedProducts.length === 0 ? (
                    <p className="text-sm text-gray-500">No products reference this design yet.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
                      {linkedProducts.map((p) => (
                        <li key={p.id} className="px-3 py-2 flex justify-between gap-2 text-sm">
                          <Link
                            href={`/products/${encodeURIComponent(p.slug)}`}
                            className="text-blue-600 hover:underline truncate font-medium"
                          >
                            {p.name}
                          </Link>
                          <span className="text-xs text-gray-400 font-mono shrink-0">{p.id.slice(0, 8)}…</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
                  <h3 className="text-sm font-medium text-gray-800 mb-1">Sales & performance</h3>
                  <p className="text-sm text-gray-500">
                    Reserved for units sold, revenue, and conversion. Connect analytics here later.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-gray-700">Edit</h3>
                  <label className="block text-xs text-gray-600">Design theme</label>
                  <p className="text-[11px] text-[#737373] mb-1">
                    Concept / campaign (library, filters, batch). Not visual style — a separate Style field may come later.
                  </p>
                  <select
                    value={editDesignType}
                    onChange={(e) => setEditDesignType(e.target.value as DesignThemeValue)}
                    className="w-full max-w-md border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-gray-900"
                  >
                    {editDesignType && !isCanonicalDesignTheme(editDesignType) ? (
                      <option value={editDesignType}>
                        {designThemeLabel(editDesignType)} (legacy — pick a new theme below)
                      </option>
                    ) : null}
                    {DESIGN_THEME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="block text-xs text-gray-600 mt-3">Design series (optional)</label>
                  <p className="text-[11px] text-[#737373] mb-1">
                    Campaign / grouping slug (snake_case). Complements theme; leave empty for one-offs.
                  </p>
                  <input
                    type="text"
                    value={editDesignSeries}
                    onChange={(e) => setEditDesignSeries(e.target.value)}
                    onBlur={() => setEditDesignSeries((v) => normalizeDesignSeriesInput(v) ?? "")}
                    placeholder="e.g. will_drop_for"
                    className="w-full max-w-md border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-gray-900 font-mono"
                  />
                  <label className="block text-xs text-gray-600 mt-3">Print sides (garment)</label>
                  <p className="text-[11px] text-[#737373] mb-1">
                    Back-only art stays off the front on the product page and in mockups. Batch imports set this automatically;
                    use <strong>Back only</strong> for city-number backs, etc.
                  </p>
                  <select
                    value={editPrintSides}
                    onChange={(e) => setEditPrintSides(e.target.value as DesignPrintSidesMode)}
                    className="w-full max-w-md border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-gray-900"
                  >
                    <option value="both">Both front and back</option>
                    <option value="front">Front only</option>
                    <option value="back">Back only</option>
                  </select>
                  <label className="block text-xs text-gray-500 mt-2">Internal notes</label>
                  <textarea
                    value={internalNotesEdit}
                    onChange={(e) => setInternalNotesEdit(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="Operator notes only — not product copy"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDesignMeta}
                    disabled={savingMeta}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingMeta ? "Saving…" : "Save"}
                  </button>
                </div>

                <details className="group border border-gray-200 rounded-lg p-4 bg-gray-50/80">
                  <summary className="text-sm font-medium text-gray-700 cursor-pointer list-none flex justify-between items-center">
                    <span>Advanced: taxonomy &amp; legacy fields</span>
                    <span className="text-gray-400 text-xs group-open:rotate-180 transition">▼</span>
                  </summary>
                  <div className="mt-4 space-y-4 text-sm">
                    {design.description && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Legacy description (deprecated)</p>
                        <p className="text-gray-600">{design.description}</p>
                      </div>
                    )}
                    {design.tags && design.tags.length > 0 && (
                      <p className="text-xs text-gray-500">Legacy tags: {design.tags.join(", ")}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      Batch import / catalog taxonomy. Prefer league + team on the design for the library; use this when
                      you need rp_taxonomy codes.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-gray-500 mb-0.5">Sport</label>
                        <select
                          value={taxSportCode ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setTaxSportCode(v);
                            if (!v) setTaxLeagueCode(null);
                            setTaxTeamCode(null);
                            setTaxThemeCode(null);
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">—</option>
                          {(taxonomySports ?? []).map((s) => (
                            <option key={s.id} value={s.code}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-500 mb-0.5">League</label>
                        <select
                          value={taxLeagueCode ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setTaxLeagueCode(v);
                            setTaxTeamCode(null);
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">—</option>
                          {(taxonomyLeagues ?? []).map((l) => (
                            <option key={l.id} value={l.code}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-500 mb-0.5">Entity</label>
                        <select
                          value={taxTeamCode ?? ""}
                          onChange={(e) => setTaxTeamCode(e.target.value || null)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">—</option>
                          {(taxonomyEntities ?? []).map((e) => (
                            <option key={e.id} value={e.code}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-500 mb-0.5">Theme</label>
                        <select
                          value={taxThemeCode ?? ""}
                          onChange={(e) => setTaxThemeCode(e.target.value || null)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">—</option>
                          {(taxonomyThemes ?? []).map((t) => (
                            <option key={t.id} value={t.code}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-500 mb-0.5">Design Family</label>
                        <select
                          value={taxDesignFamily ?? ""}
                          onChange={(e) => setTaxDesignFamily(e.target.value || null)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">—</option>
                          {(taxonomyDesignFamilies ?? []).map((f) => (
                            <option key={f.id} value={f.code}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveTaxonomy}
                        disabled={isSavingTaxonomy}
                        className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-900 disabled:opacity-50"
                      >
                        {isSavingTaxonomy ? "Saving…" : "Save taxonomy"}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* Files Tab: SVG + PNG + PDF + colors + validations */}
            {activeTab === "files" && (
              <div className="space-y-6">
                <p className="text-sm text-gray-600">
                  <strong>Light Garment</strong> and <strong>Dark Garment</strong> PNG overlays (transparent) for rendering by
                  blank color family. Optional vector/PDF masters mirror the same split (legacy single{" "}
                  <code className="text-xs bg-gray-100 px-1 rounded">files.svg</code> /{" "}
                  <code className="text-xs bg-gray-100 px-1 rounded">files.pdf</code> show under light garment until you
                  replace). Max: SVG 5MB, PNG 25MB, PDF 50MB.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Light garment SVG */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Light garment SVG</h3>
                    <p className="text-xs text-gray-500 mb-3">Vector for light blanks (includes legacy single SVG).</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {(design.files?.lightSvg?.downloadUrl || design.files?.svg?.downloadUrl) ? (
                        <>
                          <img
                            src={design.files.lightSvg?.downloadUrl ?? design.files.svg!.downloadUrl}
                            alt="Light SVG preview"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.lightSvg?.fileName ?? design.files.svg?.fileName}</p>
                            <p>{formatBytes(design.files.lightSvg?.sizeBytes ?? design.files.svg?.sizeBytes ?? 0)}</p>
                          </div>
                          <a
                            href={design.files.lightSvg?.downloadUrl ?? design.files.svg!.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-sm text-blue-600 hover:underline"
                          >
                            Download
                          </a>
                        </>
                      ) : (
                        <div className="text-center text-gray-400">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <p>No light SVG</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => lightSvgInputRef.current?.click()}
                      disabled={uploadingKind === "lightSvg"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "lightSvg"
                        ? "Uploading..."
                        : design.files?.lightSvg || design.files?.svg
                          ? "Replace light SVG"
                          : "Upload light SVG"}
                    </button>
                  </div>

                  {/* Dark garment SVG */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Dark garment SVG</h3>
                    <p className="text-xs text-gray-500 mb-3">Vector for dark blanks.</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.darkSvg?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.darkSvg.downloadUrl}
                            alt="Dark SVG preview"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.darkSvg.fileName}</p>
                            <p>{formatBytes(design.files.darkSvg.sizeBytes)}</p>
                          </div>
                          <a
                            href={design.files.darkSvg.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-sm text-blue-600 hover:underline"
                          >
                            Download
                          </a>
                        </>
                      ) : (
                        <div className="text-center text-gray-400">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <p>No dark SVG</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => darkSvgInputRef.current?.click()}
                      disabled={uploadingKind === "darkSvg"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "darkSvg"
                        ? "Uploading..."
                        : design.files?.darkSvg
                          ? "Replace dark SVG"
                          : "Upload dark SVG"}
                    </button>
                  </div>

                  {/* Light Garment PNG */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Light Garment PNG</h3>
                    <p className="text-xs text-gray-500 mb-3">For light-colored garments (white, grey, etc.)</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.lightPng?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.lightPng.downloadUrl}
                            alt="Light PNG"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.lightPng.fileName}</p>
                            <p>{formatBytes(design.files.lightPng.sizeBytes)}</p>
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-gray-400 text-sm">No light PNG</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => lightPngInputRef.current?.click()}
                      disabled={uploadingKind === "lightPng"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "lightPng"
                        ? "Uploading..."
                        : design.files?.lightPng
                          ? "Replace"
                          : "Upload Light Garment PNG"}
                    </button>
                  </div>

                  {/* Dark Garment PNG */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Dark Garment PNG</h3>
                    <p className="text-xs text-gray-500 mb-3">For dark-colored garments (black, navy, etc.)</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.darkPng?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.darkPng.downloadUrl}
                            alt="Dark PNG"
                            className="max-w-full max-h-[150px] object-contain mb-3"
                          />
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.darkPng.fileName}</p>
                            <p>{formatBytes(design.files.darkPng.sizeBytes)}</p>
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-gray-400 text-sm">No dark PNG</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => darkPngInputRef.current?.click()}
                      disabled={uploadingKind === "darkPng"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "darkPng"
                        ? "Uploading..."
                        : design.files?.darkPng
                          ? "Replace"
                          : "Upload Dark Garment PNG"}
                    </button>
                  </div>

                  {/* Legacy single PNG (older records) */}
                  <div className="border border-dashed border-amber-300 rounded-lg p-4 bg-amber-50/50">
                    <h3 className="font-medium mb-3 text-amber-900">Legacy PNG (optional)</h3>
                    <p className="text-xs text-amber-800 mb-2">
                      Older designs used a single <code className="font-mono">files.png</code> — mapped to{" "}
                      <strong>Light Garment</strong> only until you add a Dark Garment PNG.
                    </p>
                    <div className="bg-white rounded-lg p-4 flex flex-col items-center justify-center min-h-[120px]">
                      {design.files?.png?.downloadUrl ? (
                        <>
                          <img
                            src={design.files.png.downloadUrl}
                            alt="Legacy"
                            className="max-w-full max-h-[100px] object-contain mb-2"
                          />
                          <p className="text-xs text-gray-500">{design.files.png.fileName}</p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">None</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => pngInputRef.current?.click()}
                      disabled={uploadingKind === "png"}
                      className="mt-3 w-full px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:opacity-50 text-sm"
                    >
                      {uploadingKind === "png" ? "Uploading..." : design.files?.png ? "Replace legacy PNG" : "Set legacy PNG"}
                    </button>
                  </div>

                  {/* Light garment PDF */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Light garment PDF</h3>
                    <p className="text-xs text-gray-500 mb-3">Print-ready for light blanks (includes legacy single PDF).</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {(design.files?.lightPdf?.downloadUrl || design.files?.pdf?.downloadUrl) ? (
                        <>
                          <svg className="w-16 h-16 text-red-500 mb-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                            <path d="M8 12h8v2H8zm0 4h5v2H8z"/>
                          </svg>
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.lightPdf?.fileName ?? design.files.pdf?.fileName}</p>
                            <p>{formatBytes(design.files.lightPdf?.sizeBytes ?? design.files.pdf?.sizeBytes ?? 0)}</p>
                          </div>
                          <a
                            href={design.files.lightPdf?.downloadUrl ?? design.files.pdf!.downloadUrl}
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
                          <p>No light PDF</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => lightPdfInputRef.current?.click()}
                      disabled={uploadingKind === "lightPdf"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "lightPdf"
                        ? "Uploading..."
                        : design.files?.lightPdf || design.files?.pdf
                          ? "Replace light PDF"
                          : "Upload light PDF"}
                    </button>
                  </div>

                  {/* Dark garment PDF */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-medium mb-1">Dark garment PDF</h3>
                    <p className="text-xs text-gray-500 mb-3">Print-ready for dark blanks.</p>
                    <div className="bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px]">
                      {design.files?.darkPdf?.downloadUrl ? (
                        <>
                          <svg className="w-16 h-16 text-red-500 mb-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                            <path d="M8 12h8v2H8zm0 4h5v2H8z"/>
                          </svg>
                          <div className="text-xs text-gray-500 text-center">
                            <p>{design.files.darkPdf.fileName}</p>
                            <p>{formatBytes(design.files.darkPdf.sizeBytes)}</p>
                          </div>
                          <a
                            href={design.files.darkPdf.downloadUrl}
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
                          <p>No dark PDF</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => darkPdfInputRef.current?.click()}
                      disabled={uploadingKind === "darkPdf"}
                      className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadingKind === "darkPdf"
                        ? "Uploading..."
                        : design.files?.darkPdf
                          ? "Replace dark PDF"
                          : "Upload dark PDF"}
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
                      {resolveDesignInkPaletteForDisplay(design.colors).map((color, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          <div
                            className="w-8 h-8 rounded-full border border-gray-300 shrink-0"
                            style={{ backgroundColor: color.hex }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {color.name || "Unnamed"}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">{color.hex}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{formatCmyk(color.cmyk)}</div>
                          </div>
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs capitalize shrink-0">
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
                  
                  {!designHasUsablePng(design) && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                      Upload light + dark PNG overlays (or legacy PNG) before generating mocks.
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
                              {blank.styleCode} {blank.styleName}
                              {isMasterBlank(blank)
                                ? ` (${countActiveVariants(blank)} variant(s))`
                                : blank.colorName
                                  ? ` — ${blank.colorName}`
                                  : ""}
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
                      !designHasUsablePng(design) ||
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

        <div className="mt-6 border border-red-200 rounded-lg p-4 bg-red-50/90 space-y-3">
          <h3 className="text-sm font-semibold text-red-900">Delete design</h3>
          <p className="text-sm text-red-900/90">
            Permanently remove this design from the library. This does not delete files in Storage.
          </p>
          {linkedProducts.length > 0 ? (
            <p className="text-sm text-red-800">
              This design is referenced by{" "}
              <strong>
                {linkedProducts.length} product{linkedProducts.length === 1 ? "" : "s"}
              </strong>
              . Remove or change those products first, then you can delete here.
            </p>
          ) : null}
          {deleteDesignError ? <p className="text-sm text-red-800 font-medium">{deleteDesignError}</p> : null}
          <button
            type="button"
            disabled={deletingDesign || linkedProducts.length > 0}
            onClick={handleDeleteDesign}
            className="px-3 py-2 bg-red-700 text-white rounded-lg text-sm font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deletingDesign ? "Deleting…" : "Delete design…"}
          </button>
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
