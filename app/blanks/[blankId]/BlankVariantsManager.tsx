"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import type {
  RPBlank,
  RPBlankVariant,
  RPImageRef,
  RPBlankArtworkTone,
  RPBlankColorFamily,
  RPBlankVariantEligibilityOverride,
  RPBlankVariantMarketingImage,
  RPBlankVariantMarketingImageRole,
  RPBlankVariantRenderProfileSideOverride,
} from "@/lib/types/firestore";
import { getPlacementRowForSide } from "@/lib/products/resolveProductRenderProfile";
import type { UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { useDesignTeams } from "@/lib/hooks/useDesignAssets";
import { useSampleGeneratedOutputsForBlankVariant } from "@/lib/hooks/useSampleGeneratedOutputsForBlankVariant";
import {
  getBlankVariants,
  getVariantRenderReady8394,
  isMasterBlank,
  newVariantId,
  TEAM_COLOR_FAMILY_OPTIONS,
  getEffectiveEligibilityForVariant,
  computeEligibleTeams,
} from "@/lib/blanks";
import type { RpVariantGeneratedRenderOutput } from "@/lib/types/firestore";
import { resolvePrimaryVariantImage8394ForShopify } from "@/lib/shopify/variantShopifyMedia";
import { TeamTokenPicker } from "./TeamTokenPicker";

function emptyVariantEligibilityOverride(): RPBlankVariantEligibilityOverride {
  return {
    enabled: true,
    allowedLeagues: [],
    allowAllTeamsInAllowedLeagues: true,
    matchTeamColorFamilies: false,
    allowedTeamColorFamilies: [],
    includedTeamIds: [],
    excludedTeamIds: [],
  };
}

export function BlankVariantsManager({
  blank,
  updateBlank,
  refetchBlank,
  showToast,
}: {
  blank: RPBlank;
  updateBlank: (i: UpdateBlankInput) => Promise<unknown>;
  refetchBlank: () => void;
  showToast: (m: string, t: "success" | "error") => void;
}) {
  const [variants, setVariants] = useState<RPBlankVariant[]>(() => getBlankVariants(blank));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<RPBlankVariant | null>(null);
  const [adding, setAdding] = useState(false);
  const { teams } = useDesignTeams();

  const leagueOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      const id = t.leagueId?.trim() || t.league?.trim();
      if (!id) continue;
      const k = id.toUpperCase();
      if (!map.has(k)) map.set(k, id);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }, [teams]);

  useEffect(() => {
    setVariants(getBlankVariants(blank));
  }, [blank.blankId, blank.variants, blank.colorName, blank.images]);

  const is8394Master = String(blank.styleCode || "").trim() === "8394";

  if (!isMasterBlank(blank)) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <strong>Legacy blank</strong> (single color on document). Use the <strong>Images / Views</strong> tab for photos. For the variant
          model, create a <strong>master blank</strong> (schema v2) from the Blanks Library.
        </p>
      </div>
    );
  }

  /** `successToast: false` skips success toast (caller may show a specific message). */
  const persist = async (next: RPBlankVariant[], successToast: string | false = "Variants saved") => {
    setSaving(true);
    try {
      await updateBlank({ blankId: blank.blankId, variants: next, schemaVersion: 2 });
      refetchBlank();
      if (successToast !== false) showToast(successToast, "success");
    } catch (e: unknown) {
      showToast((e as Error)?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = () => persist(variants);

  const removeVariant = (variantId: string) => {
    if (!confirm("Remove this variant? If products reference it, prefer deactivating instead.")) return;
    persist(variants.filter((v) => v.variantId !== variantId));
  };

  const openAdd = () => {
    const v: RPBlankVariant = {
      variantId: newVariantId(),
      colorName: "New color",
      colorHex: null,
      colorFamily: "light",
      isActive: true,
      sortOrder: variants.length,
      images: {
        front: null,
        back: null,
        detail: null,
        flatFront: null,
        flatBack: null,
        modelFront: null,
        modelBack: null,
      },
      marketingImages: [],
      renderOverrides: null,
      renderProfileOverrides: null,
      renderTargetOverrides: null,
      eligibilityOverride: null,
      preferredArtworkTone: null,
    };
    setEditing(v);
    setAdding(true);
  };

  const saveEditor = () => {
    if (!editing) return;
    let next: RPBlankVariant[];
    if (adding) {
      next = [...variants, editing];
    } else {
      next = variants.map((v) => (v.variantId === editing.variantId ? editing : v));
    }
    setVariants(next);
    setEditing(null);
    setAdding(false);
    persist(next);
  };

  /** Merge new images for a variant, persist to Firestore, keep modal in sync */
  const persistVariantImages = async (variantId: string, images: RPBlankVariant["images"]) => {
    const next = variants.map((v) => (v.variantId === variantId ? { ...v, images } : v));
    setVariants(next);
    setEditing((prev) =>
      prev && prev.variantId === variantId ? { ...prev, images: { ...images } } : prev
    );
    await persist(next, false);
  };

  const persistVariantPatch = async (variantId: string, patch: Partial<RPBlankVariant>) => {
    const next = variants.map((v) => (v.variantId === variantId ? { ...v, ...patch } : v));
    setVariants(next);
    setEditing((prev) => (prev && prev.variantId === variantId ? { ...prev, ...patch } : prev));
    await persist(next, false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-950">
        <strong>Source of truth for garment colors:</strong> each row is one sellable color/SKU line. Product generation only uses
        colors you define here — not eligibility rules. Count: <strong>{variants.length}</strong> variant(s) on this master blank.
      </div>
      <p className="text-sm text-gray-600">
        Variants hold <strong>colorName</strong>, <strong>light/dark family</strong> (for artwork), supplier fields, optional{" "}
        <strong>eligibility override</strong>, and <strong>mockup images per color</strong> (front / back / detail). Upload and manage
        images in <strong>Edit variant</strong>. Style-level tabs are for defaults, not per-color photos.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={openAdd}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Add variant
        </button>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={saving}
          className="px-3 py-1.5 text-sm text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 disabled:text-gray-600"
        >
          {saving ? "Saving…" : "Save order / refresh"}
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-x-auto bg-white">
        <table className="min-w-full text-sm text-gray-900">
          <thead className="bg-gray-50 text-left text-xs uppercase font-semibold text-gray-700">
            <tr>
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Images</th>
              {is8394Master ? <th className="px-3 py-2 whitespace-nowrap">8394 render QA</th> : null}
              <th className="px-3 py-2">Eligibility</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-900">
            {variants
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((v) => {
                const mf = !!(v.images?.flatFront?.downloadUrl || v.images?.front?.downloadUrl);
                const mb = !!(v.images?.flatBack?.downloadUrl || v.images?.back?.downloadUrl);
                const mmf = !!v.images?.modelFront?.downloadUrl;
                const mmb = !!v.images?.modelBack?.downloadUrl;
                const qa8394 = is8394Master ? getVariantRenderReady8394(blank, v) : null;
                return (
                  <tr key={v.variantId}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded border border-gray-300 shrink-0"
                          style={{ backgroundColor: v.colorHex || "#ccc" }}
                        />
                        <span className="font-semibold text-gray-900">{v.colorName}</span>
                      </div>
                      <div className="text-xs text-gray-600 font-mono mt-0.5">{v.variantId}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-900 font-medium capitalize">{v.colorFamily ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{v.isActive === false ? "No" : "Yes"}</td>
                    <td className="px-3 py-2 text-xs text-gray-900">
                      Ff:{mf ? "✓" : "—"} Fb:{mb ? "✓" : "—"} Mf:{mmf ? "✓" : "—"} Mb:{mmb ? "✓" : "—"} D:
                      {v.images?.detail?.downloadUrl ? "✓" : "—"}
                      <div className="text-[10px] text-gray-600 mt-0.5">Edit variant → sources</div>
                    </td>
                    {is8394Master && qa8394 ? (
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={
                              qa8394.ready
                                ? "inline-flex items-center rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200 px-2 py-0.5 font-medium"
                                : "inline-flex items-center rounded-full bg-amber-50 text-amber-950 border border-amber-200 px-2 py-0.5 font-medium"
                            }
                            title={qa8394.issues.join(" · ")}
                          >
                            {qa8394.label}
                          </span>
                          <div
                            className="flex gap-1.5 font-mono text-[10px] tracking-tight"
                            title="Flat front / flat back / model back sources"
                          >
                            {(
                              [
                                ["flat_front", "FF"],
                                ["flat_back", "FB"],
                                ["model_back", "MB"],
                              ] as const
                            ).map(([id, abbr]) => {
                              const ok = qa8394.checklist.find((c) => c.id === id)?.ok ?? false;
                              return (
                                <span
                                  key={id}
                                  className={ok ? "font-semibold text-emerald-700" : "text-gray-400"}
                                >
                                  {abbr}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-xs text-gray-900">
                      {v.eligibilityOverride?.enabled === true ? (
                        <span className="text-violet-700 font-medium">Override</span>
                      ) : (
                        <span className="text-gray-900 font-medium">Master</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      <button type="button" className="text-blue-600 mr-2" onClick={() => { setEditing(v); setAdding(false); }}>
                        Edit
                      </button>
                      <button type="button" className="text-red-600" onClick={() => removeVariant(v.variantId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {editing && (
        <VariantEditorModal
          blank={blank}
          editing={editing}
          setEditing={setEditing}
          adding={adding}
          variantIsPersisted={variants.some((v) => v.variantId === editing.variantId)}
          persistVariantImages={persistVariantImages}
          persistVariantPatch={persistVariantPatch}
          showToast={showToast}
          teams={teams}
          leagueOptions={leagueOptions}
          onCancel={() => {
            setEditing(null);
            setAdding(false);
          }}
          onSave={saveEditor}
          TeamTokenPicker={TeamTokenPicker}
        />
      )}
    </div>
  );
}

type RenderSourceSlot = "flatFront" | "flatBack" | "modelFront" | "modelBack" | "detail";

function renderSourceRef(
  images: RPBlankVariant["images"] | undefined,
  slot: RenderSourceSlot
): RPImageRef | null | undefined {
  if (!images) return null;
  if (slot === "flatFront") return images.flatFront ?? images.front;
  if (slot === "flatBack") return images.flatBack ?? images.back;
  return images[slot];
}

const MARKETING_ROLES: RPBlankVariantMarketingImageRole[] = [
  "lifestyle",
  "flatlay",
  "bed",
  "wood",
  "promo",
  "detail",
];

const QA_OUTPUT_ROLE_ORDER = ["model_back", "flat_front", "flat_back", "model_front"] as const;

function formatFirestoreTime(v: unknown): string {
  if (v == null) return "—";
  const o = v as { toDate?: () => Date };
  if (typeof o.toDate === "function") {
    try {
      return o.toDate().toISOString().replace("T", " ").slice(0, 19);
    } catch {
      /* ignore */
    }
  }
  return String(v);
}

function orderQaGeneratedOutputs(list: RpVariantGeneratedRenderOutput[]): RpVariantGeneratedRenderOutput[] {
  const want = new Set<string>(QA_OUTPUT_ROLE_ORDER);
  const filtered = list.filter((o) => want.has(o.role));
  return QA_OUTPUT_ROLE_ORDER.flatMap((role) => filtered.filter((o) => o.role === role));
}

function VariantEditorModal({
  blank,
  editing,
  setEditing,
  adding,
  variantIsPersisted,
  persistVariantImages,
  persistVariantPatch,
  showToast,
  teams,
  leagueOptions,
  onCancel,
  onSave,
  TeamTokenPicker: TeamPicker,
}: {
  blank: RPBlank;
  editing: RPBlankVariant;
  setEditing: (v: RPBlankVariant) => void;
  adding: boolean;
  variantIsPersisted: boolean;
  persistVariantImages: (variantId: string, images: RPBlankVariant["images"]) => Promise<void>;
  persistVariantPatch: (variantId: string, patch: Partial<RPBlankVariant>) => Promise<void>;
  showToast: (m: string, t: "success" | "error") => void;
  teams: import("@/lib/types/firestore").DesignTeam[];
  leagueOptions: string[];
  onCancel: () => void;
  onSave: () => void;
  TeamTokenPicker: typeof import("./TeamTokenPicker").TeamTokenPicker;
}) {
  const ov = editing.eligibilityOverride;
  const overrideOn = ov?.enabled === true;
  const eff = getEffectiveEligibilityForVariant(blank, editing);
  const preview = computeEligibleTeams(teams, eff);

  const setOv = (patch: Partial<RPBlankVariantEligibilityOverride>) => {
    const base = overrideOn
      ? { ...emptyVariantEligibilityOverride(), ...ov, enabled: true as const }
      : emptyVariantEligibilityOverride();
    setEditing({ ...editing, eligibilityOverride: { ...base, ...patch, enabled: true } });
  };

  const toggleLeague = (lg: string) => {
    const u = lg.toUpperCase();
    const list = ov?.allowedLeagues ?? [];
    const has = list.some((x) => x.toUpperCase() === u);
    setOv({ allowedLeagues: has ? list.filter((x) => x.toUpperCase() !== u) : [...list, lg] });
  };

  const toggleColor = (c: string) => {
    const cl = c.toLowerCase();
    const list = ov?.allowedTeamColorFamilies ?? [];
    const has = list.some((x) => x.toLowerCase() === cl);
    setOv({ allowedTeamColorFamilies: has ? list.filter((x) => x.toLowerCase() !== cl) : [...list, c] });
  };

  const excludedSet = useMemo(() => new Set(ov?.excludedTeamIds ?? []), [ov?.excludedTeamIds]);
  const includedSet = useMemo(() => new Set(ov?.includedTeamIds ?? []), [ov?.includedTeamIds]);

  const imageFileRef = useRef<HTMLInputElement>(null);
  const marketingFileRef = useRef<HTMLInputElement>(null);
  const [pendingView, setPendingView] = useState<RenderSourceSlot | "marketing" | null>(null);
  const [uploadingView, setUploadingView] = useState<RenderSourceSlot | "marketing" | null>(null);
  const [deletingView, setDeletingView] = useState<RenderSourceSlot | null>(null);

  const backPlacementIds = useMemo(
    () =>
      (blank.placements ?? [])
        .filter((p) => String(p.placementId).startsWith("back_"))
        .map((p) => p.placementId),
    [blank.placements]
  );
  const backDefaultRow = useMemo(() => getPlacementRowForSide(blank, "back", null), [blank]);
  const is8394 = String(blank.styleCode || "").trim() === "8394";
  const renderQa = useMemo(
    () => (is8394 ? getVariantRenderReady8394(blank, editing) : null),
    [blank, editing, is8394]
  );
  const { loading: genSampleLoading, error: genSampleError, sample: genSample } =
    useSampleGeneratedOutputsForBlankVariant(
      is8394 ? blank.blankId : undefined,
      is8394 ? editing.variantId : undefined
    );
  const qaGeneratedRows = useMemo(
    () => (genSample?.outputs ? orderQaGeneratedOutputs(genSample.outputs) : []),
    [genSample?.outputs]
  );
  const shopifyFeatured8394 = useMemo(() => {
    if (!is8394 || !genSample?.variantMediaForShopify8394) return null;
    return resolvePrimaryVariantImage8394ForShopify(genSample.variantMediaForShopify8394);
  }, [is8394, genSample]);
  const customizeRenderProfile = editing.renderProfileOverrides != null;
  const backOv = editing.renderProfileOverrides?.back;

  const setBackPatch = (patch: Partial<RPBlankVariantRenderProfileSideOverride>) => {
    const prev = editing.renderProfileOverrides ?? {};
    setEditing({
      ...editing,
      renderProfileOverrides: {
        ...prev,
        back: { ...(prev.back ?? {}), ...patch },
      },
    });
  };

  const clearBackField = (key: keyof RPBlankVariantRenderProfileSideOverride) => {
    const prev = editing.renderProfileOverrides;
    if (!prev?.back) return;
    const b = { ...prev.back };
    delete (b as Record<string, unknown>)[key];
    const next: NonNullable<RPBlankVariant["renderProfileOverrides"]> = { ...prev };
    if (Object.keys(b).length === 0) {
      delete next.back;
    } else {
      next.back = b;
    }
    if (!next.front && !next.back) {
      setEditing({ ...editing, renderProfileOverrides: null });
    } else {
      setEditing({ ...editing, renderProfileOverrides: next });
    }
  };

  const customizeModelBack = editing.renderTargetOverrides?.model_back != null;
  const modelBackOv = editing.renderTargetOverrides?.model_back;

  const setModelBackPatch = (patch: Partial<RPBlankVariantRenderProfileSideOverride>) => {
    const prev = editing.renderTargetOverrides ?? {};
    setEditing({
      ...editing,
      renderTargetOverrides: {
        ...prev,
        model_back: { ...(prev.model_back ?? {}), ...patch },
      },
    });
  };

  const clearModelBackField = (key: keyof RPBlankVariantRenderProfileSideOverride) => {
    const prev = editing.renderTargetOverrides;
    if (!prev?.model_back) return;
    const b = { ...prev.model_back };
    delete (b as Record<string, unknown>)[key];
    const nextRt: NonNullable<RPBlankVariant["renderTargetOverrides"]> = { ...prev };
    if (Object.keys(b).length === 0) {
      delete nextRt.model_back;
    } else {
      nextRt.model_back = b;
    }
    const hasAny = Object.keys(nextRt).length > 0;
    setEditing({
      ...editing,
      renderTargetOverrides: hasAny ? nextRt : null,
    });
  };

  const mergeImages = (patch: Partial<NonNullable<RPBlankVariant["images"]>>): NonNullable<RPBlankVariant["images"]> => ({
    front: editing.images?.front ?? null,
    back: editing.images?.back ?? null,
    detail: editing.images?.detail ?? null,
    flatFront: editing.images?.flatFront ?? null,
    flatBack: editing.images?.flatBack ?? null,
    modelFront: editing.images?.modelFront ?? null,
    modelBack: editing.images?.modelBack ?? null,
    ...patch,
  });

  const openImagePicker = (view: RenderSourceSlot) => {
    setPendingView(view);
    imageFileRef.current?.click();
  };

  const onVariantImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const view = pendingView;
    e.target.value = "";
    setPendingView(null);
    if (!file || !view || view === "marketing") return;
    if (!storage) {
      showToast("Storage not available", "error");
      return;
    }
    setUploadingView(view);
    try {
      const variantId = editing.variantId;
      const ext = file.name.split(".").pop() || "png";
      const path = `rp/blanks/${blank.blankId}/variants/${variantId}/${view}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Could not read image"));
        img.src = URL.createObjectURL(file);
      });
      const imageRef: RPImageRef = {
        storagePath: path,
        downloadUrl,
        width: img.width,
        height: img.height,
        contentType: file.type,
        bytes: file.size,
      };
      let newImages: NonNullable<RPBlankVariant["images"]>;
      if (view === "flatFront") {
        newImages = mergeImages({ flatFront: imageRef, front: imageRef });
      } else if (view === "flatBack") {
        newImages = mergeImages({ flatBack: imageRef, back: imageRef });
      } else {
        newImages = mergeImages({ [view]: imageRef } as Partial<NonNullable<RPBlankVariant["images"]>>);
      }
      setEditing({ ...editing, images: newImages });
      if (variantIsPersisted) {
        await persistVariantImages(variantId, newImages);
      }
      showToast("Image saved", "success");
    } catch (err: unknown) {
      showToast((err as Error)?.message || "Upload failed", "error");
    } finally {
      setUploadingView(null);
    }
  };

  const removeVariantImage = async (view: RenderSourceSlot) => {
    if (!confirm(`Remove this image for this color variant?`)) return;
    let newImages: NonNullable<RPBlankVariant["images"]>;
    if (view === "flatFront") {
      newImages = mergeImages({ flatFront: null, front: null });
    } else if (view === "flatBack") {
      newImages = mergeImages({ flatBack: null, back: null });
    } else {
      newImages = mergeImages({ [view]: null } as Partial<NonNullable<RPBlankVariant["images"]>>);
    }
    setEditing({ ...editing, images: newImages });
    if (variantIsPersisted) {
      setDeletingView(view);
      try {
        await persistVariantImages(editing.variantId, newImages);
        showToast("Image removed", "success");
      } catch (err: unknown) {
        showToast((err as Error)?.message || "Remove failed", "error");
      } finally {
        setDeletingView(null);
      }
    }
  };

  const imageSlot = (view: RenderSourceSlot, label: string, hint?: string) => {
    const refImg = renderSourceRef(editing.images, view);
    const busy = uploadingView === view || deletingView === view;
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
          <h4 className="text-sm font-medium text-gray-900">{label}</h4>
          {hint ? <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p> : null}
        </div>
        <div className="p-3">
          {refImg?.downloadUrl ? (
            <div className="space-y-2">
              <img
                src={refImg.downloadUrl}
                alt={label}
                className="w-full max-h-40 object-contain bg-white rounded border border-gray-100"
              />
              <div className="text-xs text-gray-600">
                {refImg.width} × {refImg.height}px
                {refImg.bytes != null ? ` • ${Math.round(refImg.bytes / 1024)}KB` : ""}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openImagePicker(view)}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {busy ? "…" : "Replace"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeVariantImage(view)}
                  className="px-2 py-1.5 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-gray-600 mb-2">No {label.toLowerCase()} image</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => openImagePicker(view)}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <input
        ref={imageFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onVariantImageFile}
      />
      <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h3 className="font-semibold text-lg text-gray-900">
          {adding ? "Add variant" : "Edit variant"}
        </h3>
        {is8394 && renderQa ? (
          <div className="text-xs border border-gray-200 rounded-md px-3 py-2 bg-gray-50/80 space-y-2">
            <div>
              <span className={renderQa.ready ? "text-emerald-900 font-medium" : "text-amber-950 font-medium"}>
                8394 render sources: {renderQa.label}
              </span>
              {!renderQa.ready ? (
                <p className="text-[11px] text-gray-700 mt-1">{renderQa.issues.join(" · ")}</p>
              ) : null}
            </div>
            <div className="border-t border-gray-200 pt-2">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Render source checklist
              </p>
              <ul className="grid gap-0.5 sm:grid-cols-2">
                {renderQa.checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={item.ok ? "text-emerald-600 shrink-0" : "text-red-600 shrink-0"}
                      aria-hidden
                    >
                      {item.ok ? "✓" : "✗"}
                    </span>
                    <span className={item.ok ? "text-gray-800" : "text-gray-600"}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="space-y-2 border-b border-gray-100 pb-4">
          <label className="block text-xs font-medium text-gray-700">Color name</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={editing.colorName}
            onChange={(e) => setEditing({ ...editing, colorName: e.target.value })}
          />
          <label className="block text-xs font-medium text-gray-700">Light / dark (artwork)</label>
          <select
            className="w-full border rounded px-2 py-1"
            value={editing.colorFamily}
            onChange={(e) => setEditing({ ...editing, colorFamily: e.target.value as RPBlankColorFamily })}
          >
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
          <label className="block text-xs font-medium text-gray-700">Preferred artwork tone (optional)</label>
          <p className="text-[11px] text-gray-600">
            Overrides default light/dark garment artwork mapping when the design includes that tone (e.g. white ink on pink).
            Leave as default to use color family only.
          </p>
          <select
            className="w-full border rounded px-2 py-1"
            value={editing.preferredArtworkTone ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const next: RPBlankArtworkTone | null =
                v === "light" || v === "dark" || v === "white" ? v : null;
              setEditing({ ...editing, preferredArtworkTone: next });
            }}
          >
            <option value="">Default (from color family)</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
            <option value="white">white</option>
          </select>
          <label className="block text-xs font-medium text-gray-700">Vendor color name</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={editing.vendorColorName ?? ""}
            onChange={(e) => setEditing({ ...editing, vendorColorName: e.target.value || null })}
          />
          <label className="block text-xs font-medium text-gray-700">Vendor SKU</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={editing.vendorSku ?? ""}
            onChange={(e) => setEditing({ ...editing, vendorSku: e.target.value || null })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={editing.isActive !== false}
              onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Active
          </label>
        </div>

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Render source images</h4>
          <p className="text-xs text-gray-700">
            Master blank inputs for compositing. Legacy <code className="text-[10px] bg-gray-100 px-1 rounded">front</code> /{" "}
            <code className="text-[10px] bg-gray-100 px-1 rounded">back</code> still apply when flat slots are empty.
            {!variantIsPersisted && (
              <span className="block mt-1 text-amber-800">
                Save this variant once to write images to Firestore; uploads are stored immediately either way.
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {imageSlot("flatFront", "Flat Front")}
            {imageSlot("flatBack", "Flat Back")}
            {imageSlot("modelFront", "Model Front")}
            {imageSlot("modelBack", "Model Back")}
            {imageSlot("detail", "Detail")}
          </div>
        </div>

        {is8394 && renderQa ? (
          <div className="space-y-3 border-b border-gray-100 pb-4">
            <h4 className="text-sm font-semibold text-gray-900">Generated outputs (this color)</h4>
            <p className="text-xs text-gray-700">
              Read-only QA from a sample <code className="text-[10px] bg-gray-100 px-1 rounded">rp_products/*/variants/*</code> row
              with <code className="text-[10px] bg-gray-100 px-1 rounded">generatedRenderOutputs</code> for this{" "}
              <code className="text-[10px] bg-gray-100 px-1 rounded">blankVariantId</code>. Not exhaustive if many products share this
              color.
            </p>
            {genSampleLoading ? (
              <p className="text-xs text-gray-600">Loading sample…</p>
            ) : genSampleError ? (
              <p className="text-xs text-red-700">{genSampleError}</p>
            ) : !genSample ? (
              <p className="text-xs text-amber-800">
                No sample found yet — generate an 8394 product that uses this color to populate outputs here.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-600 font-mono">
                  Sample: product <span className="text-gray-900">{genSample.productId}</span> · variant{" "}
                  <span className="text-gray-900">{genSample.variantId}</span>
                </p>
                {shopifyFeatured8394 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/90 px-2.5 py-2 text-[11px] text-gray-800 space-y-0.5">
                    <div className="font-semibold text-gray-900">Shopify featured image candidate</div>
                    <div>
                      <span className="text-gray-500">role:</span> {shopifyFeatured8394.role ?? "—"}
                    </div>
                    <div>
                      <span className="text-gray-500">lookType:</span> {shopifyFeatured8394.lookType ?? "—"}
                    </div>
                    <div className="truncate" title={shopifyFeatured8394.url || undefined}>
                      <span className="text-gray-500">url:</span>{" "}
                      {shopifyFeatured8394.url ? (
                        <span className="font-mono text-[10px] break-all">{shopifyFeatured8394.url}</span>
                      ) : (
                        "—"
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">filename:</span>{" "}
                      <span className="font-mono text-[10px]">{shopifyFeatured8394.filename ?? "—"}</span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      <span className="text-gray-500">resolution source:</span> {shopifyFeatured8394.source}
                    </div>
                  </div>
                ) : null}
                {qaGeneratedRows.length === 0 ? (
                  <p className="text-xs text-gray-600">Sample variant has no matching roles (model_back, flat_front, flat_back, model_front).</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {qaGeneratedRows.map((row) => (
                      <div
                        key={`${row.role}-${row.sort}-${row.url}`}
                        className="border border-gray-200 rounded-lg overflow-hidden bg-white text-xs"
                      >
                        <div className="bg-slate-50 px-2 py-1.5 border-b border-gray-200 font-medium text-gray-900">
                          {row.role}
                          {row.lookType ? (
                            <span className="text-gray-600 font-normal"> · {row.lookType}</span>
                          ) : null}
                        </div>
                        <div className="p-2 flex gap-2">
                          {row.url ? (
                            <img
                              src={row.url}
                              alt=""
                              className="w-20 h-20 object-contain rounded border border-gray-100 bg-white shrink-0"
                            />
                          ) : null}
                          <div className="min-w-0 space-y-0.5 text-[11px] text-gray-700">
                            <div>
                              <span className="text-gray-500">createdAt:</span> {formatFirestoreTime(row.createdAt)}
                            </div>
                            <div className="truncate" title={row.url}>
                              <span className="text-gray-500">url:</span> {row.url || "—"}
                            </div>
                            <div className="truncate font-mono text-[10px] text-gray-600" title={row.storagePath ?? ""}>
                              {row.storagePath || ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Manual marketing images</h4>
          <p className="text-xs text-gray-700">
            Lifestyle or promo shots only — not used by the compositor. Append as many as you need; sort order is the list order.
          </p>
          <input
            ref={marketingFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || pendingView !== "marketing" || !storage) return;
              setUploadingView("marketing");
              try {
                const id =
                  typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `m_${Date.now().toString(36)}`;
                const ext = file.name.split(".").pop() || "png";
                const path = `rp/blanks/${blank.blankId}/variants/${editing.variantId}/marketing/${id}.${ext}`;
                const storageRef = ref(storage, path);
                await uploadBytes(storageRef, file);
                const downloadUrl = await getDownloadURL(storageRef);
                const img = new Image();
                await new Promise<void>((res, rej) => {
                  img.onload = () => res();
                  img.onerror = () => rej(new Error("Could not read image"));
                  img.src = URL.createObjectURL(file);
                });
                const row: RPBlankVariantMarketingImage = {
                  id,
                  role: "lifestyle",
                  storagePath: path,
                  downloadUrl,
                  width: img.width,
                  height: img.height,
                  sort: (editing.marketingImages?.length ?? 0) + 1,
                };
                const nextList = [...(editing.marketingImages ?? []), row];
                const nextVariant = { ...editing, marketingImages: nextList };
                setEditing(nextVariant);
                if (variantIsPersisted) {
                  await persistVariantPatch(editing.variantId, { marketingImages: nextList });
                }
                showToast("Marketing image added", "success");
              } catch (err: unknown) {
                showToast((err as Error)?.message || "Upload failed", "error");
              } finally {
                setUploadingView(null);
                setPendingView(null);
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={uploadingView === "marketing"}
              onClick={() => {
                setPendingView("marketing");
                marketingFileRef.current?.click();
              }}
              className="px-3 py-1.5 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              {uploadingView === "marketing" ? "Uploading…" : "Add marketing image"}
            </button>
          </div>
          <ul className="space-y-2">
            {(editing.marketingImages ?? []).map((m, idx) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-2 border border-gray-200 rounded-lg p-2 bg-white text-xs"
              >
                <img
                  src={m.downloadUrl}
                  alt=""
                  className="w-14 h-14 object-contain rounded border border-gray-100 bg-gray-50"
                />
                <select
                  className="border rounded px-1 py-0.5"
                  value={m.role}
                  onChange={(e) => {
                    const role = e.target.value as RPBlankVariantMarketingImageRole;
                    const nextList = (editing.marketingImages ?? []).map((x) =>
                      x.id === m.id ? { ...x, role } : x
                    );
                    setEditing({ ...editing, marketingImages: nextList });
                    if (variantIsPersisted) {
                      void persistVariantPatch(editing.variantId, { marketingImages: nextList });
                    }
                  }}
                >
                  {MARKETING_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-red-600 ml-auto"
                  onClick={() => {
                    if (!confirm("Remove this marketing image?")) return;
                    const nextList = (editing.marketingImages ?? []).filter((x) => x.id !== m.id);
                    setEditing({ ...editing, marketingImages: nextList });
                    if (variantIsPersisted) {
                      void persistVariantPatch(editing.variantId, {
                        marketingImages: nextList.length ? nextList : null,
                      });
                    }
                  }}
                >
                  Remove
                </button>
                <div className="w-full text-[10px] text-gray-600">
                  {m.width}×{m.height}px · order {idx + 1}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Flat back placement &amp; render (this color)</h4>
          <p className="text-xs text-gray-700">
            Applies to <strong>flat_back</strong> outputs (vendor flat). Resolution: blank default → variant (here) → product.
            Merges with explicit <code className="text-[10px] bg-gray-100 px-1 rounded">renderTargetOverrides.flat_back</code> when set.
          </p>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={customizeRenderProfile}
              onChange={(e) => {
                if (!e.target.checked) {
                  setEditing({ ...editing, renderProfileOverrides: null });
                } else {
                  setEditing({ ...editing, renderProfileOverrides: editing.renderProfileOverrides ?? { back: {} } });
                }
              }}
            />
            Customize placement &amp; blend for this color (override blank default)
          </label>

          {!customizeRenderProfile && (
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-800">
              <div className="font-medium text-slate-900 mb-1">Inherited from blank (read-only)</div>
              {backDefaultRow ? (
                <p>
                  Zone <span className="font-mono">{backDefaultRow.placementId}</span> · horizontal{" "}
                  {backDefaultRow.defaultX ?? 0.5} · vertical {backDefaultRow.defaultY ?? 0.5} · scale{" "}
                  {backDefaultRow.defaultScale ?? 0.6}
                  {backDefaultRow.simpleRenderControls8394 != null && (
                    <>
                      {" "}
                      · realism {backDefaultRow.simpleRenderControls8394.realism ?? "—"} · ink{" "}
                      {backDefaultRow.simpleRenderControls8394.inkStrength ?? "—"} · size{" "}
                      {backDefaultRow.simpleRenderControls8394.sizePreset ?? "—"}
                    </>
                  )}
                </p>
              ) : (
                <p className="text-amber-800">No back placement row on this blank — configure placements on the blank first.</p>
              )}
            </div>
          )}

          {customizeRenderProfile && (
            <div className="space-y-3 pl-1 border-l-2 border-sky-200">
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block text-xs text-gray-700">
                  Back placement key (optional)
                  <select
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={backOv?.placementKey ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) clearBackField("placementKey");
                      else setBackPatch({ placementKey: v });
                    }}
                  >
                    <option value="">Inherit blank default zone</option>
                    {backPlacementIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {(
                  [
                    ["defaultX", "Horizontal (0–1)"],
                    ["defaultY", "Vertical (0–1)"],
                    ["defaultScale", "Scale"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-xs text-gray-700">
                    {label}
                    <input
                      type="number"
                      step="0.001"
                      className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                      value={
                        backOv?.[key] != null && typeof backOv[key] === "number" ? String(backOv[key]) : ""
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") clearBackField(key);
                        else setBackPatch({ [key]: Number(raw) } as Partial<RPBlankVariantRenderProfileSideOverride>);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-600">8394 simple controls (blank when inheriting that field)</p>
              <div className="grid sm:grid-cols-3 gap-2">
                {(
                  [
                    ["realism", "Fabric feel (realism)"],
                    ["inkStrength", "Ink strength"],
                  ] as const
                ).map(([sk, label]) => (
                  <label key={sk} className="block text-xs text-gray-700">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                      value={
                        backOv?.simpleRenderControls8394?.[sk] != null
                          ? String(backOv.simpleRenderControls8394[sk])
                          : ""
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const prevS = backOv?.simpleRenderControls8394 ?? {};
                        if (raw === "") {
                          const nextS = { ...prevS };
                          delete (nextS as Record<string, unknown>)[sk];
                          if (Object.keys(nextS).length === 0) {
                            clearBackField("simpleRenderControls8394");
                          } else {
                            setBackPatch({ simpleRenderControls8394: nextS });
                          }
                        } else {
                          setBackPatch({
                            simpleRenderControls8394: { ...prevS, [sk]: Number(raw) },
                          });
                        }
                      }}
                    />
                  </label>
                ))}
                <label className="block text-xs text-gray-700">
                  Size preset
                  <select
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={backOv?.simpleRenderControls8394?.sizePreset ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const prevS = backOv?.simpleRenderControls8394 ?? {};
                      if (!v) {
                        const nextS = { ...prevS };
                        delete nextS.sizePreset;
                        if (Object.keys(nextS).length === 0) {
                          clearBackField("simpleRenderControls8394");
                        } else {
                          setBackPatch({ simpleRenderControls8394: nextS });
                        }
                      } else {
                        setBackPatch({
                          simpleRenderControls8394: { ...prevS, sizePreset: v as "small" | "medium" | "large" | "fill_safe" },
                        });
                      }
                    }}
                  >
                    <option value="">Inherit</option>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
                    <option value="fill_safe">fill_safe</option>
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-gray-600">Zone blend (optional; merged with simple-derived blend)</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block text-xs text-gray-700">
                  Blend mode
                  <input
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    placeholder="e.g. multiply"
                    value={backOv?.renderZoneDefaults?.blendMode ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      const z = backOv?.renderZoneDefaults ?? {};
                      if (!v) {
                        const nz = { ...z };
                        delete nz.blendMode;
                        if (!nz.blendMode && !nz.blendOpacity) {
                          clearBackField("renderZoneDefaults");
                        } else {
                          setBackPatch({ renderZoneDefaults: nz });
                        }
                      } else {
                        setBackPatch({ renderZoneDefaults: { ...z, blendMode: v } });
                      }
                    }}
                  />
                </label>
                <label className="block text-xs text-gray-700">
                  Blend opacity (0–1)
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={
                      backOv?.renderZoneDefaults?.blendOpacity != null
                        ? String(backOv.renderZoneDefaults.blendOpacity)
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const z = backOv?.renderZoneDefaults ?? {};
                      if (raw === "") {
                        const nz = { ...z };
                        delete nz.blendOpacity;
                        if (!nz.blendMode && !nz.blendOpacity) {
                          clearBackField("renderZoneDefaults");
                        } else {
                          setBackPatch({ renderZoneDefaults: nz });
                        }
                      } else {
                        setBackPatch({ renderZoneDefaults: { ...z, blendOpacity: Number(raw) } });
                      }
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] text-gray-600">
                Optional global blend hint for this color (applies after side fields; product still wins).
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block text-xs text-gray-700">
                  Global blend mode
                  <input
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    placeholder="inherit"
                    value={editing.renderOverrides?.blendMode ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setEditing({
                        ...editing,
                        renderOverrides: v
                          ? { ...editing.renderOverrides, blendMode: v }
                          : { ...editing.renderOverrides, blendMode: null },
                      });
                    }}
                  />
                </label>
                <label className="block text-xs text-gray-700">
                  Global blend opacity
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={
                      editing.renderOverrides?.blendOpacity != null
                        ? String(editing.renderOverrides.blendOpacity)
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setEditing({
                        ...editing,
                        renderOverrides:
                          raw === ""
                            ? { ...editing.renderOverrides, blendOpacity: null }
                            : { ...editing.renderOverrides, blendOpacity: Number(raw) },
                      });
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Model back placement &amp; render (this color)</h4>
          <p className="text-xs text-gray-700">
            Overrides for <strong>model_back</strong> only (on-body / butt template). Independent from flat back overrides
            unless you mirror values here.
          </p>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={customizeModelBack}
              onChange={(e) => {
                if (e.target.checked) {
                  setEditing({
                    ...editing,
                    renderTargetOverrides: { ...(editing.renderTargetOverrides ?? {}), model_back: {} },
                  });
                } else {
                  const p = { ...(editing.renderTargetOverrides ?? {}) };
                  delete p.model_back;
                  setEditing({
                    ...editing,
                    renderTargetOverrides: Object.keys(p).length ? p : null,
                  });
                }
              }}
            />
            Customize placement &amp; blend for model back
          </label>
          {!customizeModelBack && (
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-800">
              <div className="font-medium text-slate-900 mb-1">Blank default (read-only)</div>
              {backDefaultRow ? (
                <p>
                  Zone <span className="font-mono">{backDefaultRow.placementId}</span> · horizontal{" "}
                  {backDefaultRow.defaultX ?? 0.5} · vertical {backDefaultRow.defaultY ?? 0.5} · scale{" "}
                  {backDefaultRow.defaultScale ?? 0.6}
                </p>
              ) : (
                <p className="text-amber-800">No back placement row on this blank.</p>
              )}
            </div>
          )}
          {customizeModelBack && (
            <div className="space-y-3 pl-1 border-l-2 border-amber-200">
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block text-xs text-gray-700">
                  Back placement key (optional)
                  <select
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={modelBackOv?.placementKey ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) clearModelBackField("placementKey");
                      else setModelBackPatch({ placementKey: v });
                    }}
                  >
                    <option value="">Inherit blank default zone</option>
                    {backPlacementIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {(
                  [
                    ["defaultX", "Horizontal (0–1)"],
                    ["defaultY", "Vertical (0–1)"],
                    ["defaultScale", "Scale"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-xs text-gray-700">
                    {label}
                    <input
                      type="number"
                      step="0.001"
                      className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                      value={
                        modelBackOv?.[key] != null && typeof modelBackOv[key] === "number"
                          ? String(modelBackOv[key])
                          : ""
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") clearModelBackField(key);
                        else setModelBackPatch({ [key]: Number(raw) } as Partial<RPBlankVariantRenderProfileSideOverride>);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-600">8394 simple controls</p>
              <div className="grid sm:grid-cols-3 gap-2">
                {(
                  [
                    ["realism", "Fabric feel (realism)"],
                    ["inkStrength", "Ink strength"],
                  ] as const
                ).map(([sk, label]) => (
                  <label key={sk} className="block text-xs text-gray-700">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                      value={
                        modelBackOv?.simpleRenderControls8394?.[sk] != null
                          ? String(modelBackOv.simpleRenderControls8394[sk])
                          : ""
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const prevS = modelBackOv?.simpleRenderControls8394 ?? {};
                        if (raw === "") {
                          const nextS = { ...prevS };
                          delete (nextS as Record<string, unknown>)[sk];
                          if (Object.keys(nextS).length === 0) {
                            clearModelBackField("simpleRenderControls8394");
                          } else {
                            setModelBackPatch({ simpleRenderControls8394: nextS });
                          }
                        } else {
                          setModelBackPatch({
                            simpleRenderControls8394: { ...prevS, [sk]: Number(raw) },
                          });
                        }
                      }}
                    />
                  </label>
                ))}
                <label className="block text-xs text-gray-700">
                  Size preset
                  <select
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={modelBackOv?.simpleRenderControls8394?.sizePreset ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const prevS = modelBackOv?.simpleRenderControls8394 ?? {};
                      if (!v) {
                        const nextS = { ...prevS };
                        delete nextS.sizePreset;
                        if (Object.keys(nextS).length === 0) {
                          clearModelBackField("simpleRenderControls8394");
                        } else {
                          setModelBackPatch({ simpleRenderControls8394: nextS });
                        }
                      } else {
                        setModelBackPatch({
                          simpleRenderControls8394: {
                            ...prevS,
                            sizePreset: v as "small" | "medium" | "large" | "fill_safe",
                          },
                        });
                      }
                    }}
                  >
                    <option value="">Inherit</option>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
                    <option value="fill_safe">fill_safe</option>
                  </select>
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block text-xs text-gray-700">
                  Blend mode
                  <input
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    placeholder="e.g. multiply"
                    value={modelBackOv?.renderZoneDefaults?.blendMode ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      const z = modelBackOv?.renderZoneDefaults ?? {};
                      if (!v) {
                        const nz = { ...z };
                        delete nz.blendMode;
                        if (!nz.blendMode && !nz.blendOpacity) {
                          clearModelBackField("renderZoneDefaults");
                        } else {
                          setModelBackPatch({ renderZoneDefaults: nz });
                        }
                      } else {
                        setModelBackPatch({ renderZoneDefaults: { ...z, blendMode: v } });
                      }
                    }}
                  />
                </label>
                <label className="block text-xs text-gray-700">
                  Blend opacity (0–1)
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                    value={
                      modelBackOv?.renderZoneDefaults?.blendOpacity != null
                        ? String(modelBackOv.renderZoneDefaults.blendOpacity)
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const z = modelBackOv?.renderZoneDefaults ?? {};
                      if (raw === "") {
                        const nz = { ...z };
                        delete nz.blendOpacity;
                        if (!nz.blendMode && !nz.blendOpacity) {
                          clearModelBackField("renderZoneDefaults");
                        } else {
                          setModelBackPatch({ renderZoneDefaults: nz });
                        }
                      } else {
                        setModelBackPatch({ renderZoneDefaults: { ...z, blendOpacity: Number(raw) } });
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Eligibility (this variant)</h4>
          <p className="text-xs text-gray-700">
            Override master blank rules for team matching only — garment color stays defined above.
          </p>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={overrideOn}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  eligibilityOverride: e.target.checked ? emptyVariantEligibilityOverride() : null,
                })
              }
            />
            Override master eligibility for this variant
          </label>

          {overrideOn && ov && (
            <div className="space-y-3 pl-1 border-l-2 border-violet-200">
              <div className="flex flex-wrap gap-1">
                {leagueOptions.map((lg) => {
                  const on = (ov.allowedLeagues ?? []).some((x) => x.toUpperCase() === lg.toUpperCase());
                  return (
                    <button
                      key={lg}
                      type="button"
                      onClick={() => toggleLeague(lg)}
                      className={`px-2 py-0.5 rounded-full text-xs border ${
                        on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-gray-300"
                      }`}
                    >
                      {lg}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-900">
                <input
                  type="checkbox"
                  checked={ov.allowAllTeamsInAllowedLeagues !== false}
                  onChange={(e) => setOv({ allowAllTeamsInAllowedLeagues: e.target.checked })}
                />
                Allow all teams in selected leagues
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-900">
                <input
                  type="checkbox"
                  checked={ov.matchTeamColorFamilies === true}
                  onChange={(e) => setOv({ matchTeamColorFamilies: e.target.checked })}
                />
                Match team color families
              </label>
              <div className="flex flex-wrap gap-1">
                {TEAM_COLOR_FAMILY_OPTIONS.map((c) => {
                  const on = (ov.allowedTeamColorFamilies ?? []).some((x) => x.toLowerCase() === c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleColor(c)}
                      className={`px-2 py-0.5 rounded text-xs capitalize border ${
                        on ? "bg-amber-100 border-amber-400" : "bg-white border-gray-200"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <TeamPicker
                  label="Included teams"
                  teams={teams}
                  selectedIds={ov.includedTeamIds ?? []}
                  onChange={(ids) => setOv({ includedTeamIds: ids })}
                  otherSelected={excludedSet}
                  placeholder="Search…"
                />
                <TeamPicker
                  label="Excluded teams"
                  teams={teams}
                  selectedIds={ov.excludedTeamIds ?? []}
                  onChange={(ids) => setOv({ excludedTeamIds: ids })}
                  otherSelected={includedSet}
                  placeholder="Search…"
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md bg-emerald-50/80 border border-emerald-100 p-3 text-sm">
          <div className="font-medium text-emerald-900">Preview: {preview.teams.length} team(s) for this variant</div>
          <ul className="mt-1 text-xs text-gray-700 max-h-24 overflow-y-auto">
            {preview.teams.slice(0, 8).map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
            {preview.teams.length > 8 && <li className="text-gray-500">…and {preview.teams.length - 8} more</li>}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="px-3 py-1.5 text-gray-600" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="px-3 py-1.5 bg-blue-600 text-white rounded" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
