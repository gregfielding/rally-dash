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
  RPBlankVariantRenderProfileSideOverride,
} from "@/lib/types/firestore";
import { getPlacementRowForSide } from "@/lib/products/resolveProductRenderProfile";
import type { UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { useDesignTeams } from "@/lib/hooks/useDesignAssets";
import {
  getBlankVariants,
  isMasterBlank,
  newVariantId,
  variantHasFrontBack,
  TEAM_COLOR_FAMILY_OPTIONS,
  getEffectiveEligibilityForVariant,
  computeEligibleTeams,
} from "@/lib/blanks";
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
      images: { front: null, back: null, detail: null },
      renderOverrides: null,
      renderProfileOverrides: null,
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
              <th className="px-3 py-2">Eligibility</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-900">
            {variants
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((v) => {
                const im = variantHasFrontBack(v);
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
                      F:{im.front ? "✓" : "—"} B:{im.back ? "✓" : "—"} D:{v.images?.detail?.downloadUrl ? "✓" : "—"}
                      <div className="text-[10px] text-gray-600 mt-0.5">Edit variant → Images</div>
                    </td>
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

function VariantEditorModal({
  blank,
  editing,
  setEditing,
  adding,
  variantIsPersisted,
  persistVariantImages,
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
  const [pendingView, setPendingView] = useState<"front" | "back" | "detail" | null>(null);
  const [uploadingView, setUploadingView] = useState<"front" | "back" | "detail" | null>(null);
  const [deletingView, setDeletingView] = useState<"front" | "back" | "detail" | null>(null);

  const backPlacementIds = useMemo(
    () =>
      (blank.placements ?? [])
        .filter((p) => String(p.placementId).startsWith("back_"))
        .map((p) => p.placementId),
    [blank.placements]
  );
  const backDefaultRow = useMemo(() => getPlacementRowForSide(blank, "back", null), [blank]);
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

  const mergeImages = (patch: Partial<NonNullable<RPBlankVariant["images"]>>): NonNullable<RPBlankVariant["images"]> => ({
    front: editing.images?.front ?? null,
    back: editing.images?.back ?? null,
    detail: editing.images?.detail ?? null,
    ...patch,
  });

  const openImagePicker = (view: "front" | "back" | "detail") => {
    setPendingView(view);
    imageFileRef.current?.click();
  };

  const onVariantImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const view = pendingView;
    e.target.value = "";
    setPendingView(null);
    if (!file || !view) return;
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
      const newImages =
        view === "front"
          ? mergeImages({ front: imageRef })
          : view === "back"
            ? mergeImages({ back: imageRef })
            : mergeImages({ detail: imageRef });
      setEditing({ ...editing, images: newImages });
      if (variantIsPersisted) {
        await persistVariantImages(variantId, newImages);
      }
      showToast(`${view === "front" ? "Front" : view === "back" ? "Back" : "Detail"} image saved`, "success");
    } catch (err: unknown) {
      showToast((err as Error)?.message || "Upload failed", "error");
    } finally {
      setUploadingView(null);
    }
  };

  const removeVariantImage = async (view: "front" | "back" | "detail") => {
    if (!confirm(`Remove the ${view} image for this color variant?`)) return;
    const newImages =
      view === "front"
        ? mergeImages({ front: null })
        : view === "back"
          ? mergeImages({ back: null })
          : mergeImages({ detail: null });
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

  const imageSlot = (view: "front" | "back" | "detail", label: string) => {
    const refImg =
      view === "front" ? editing.images?.front : view === "back" ? editing.images?.back : editing.images?.detail;
    const busy = uploadingView === view || deletingView === view;
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
          <h4 className="text-sm font-medium text-gray-900">{label}</h4>
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
          <h4 className="text-sm font-semibold text-gray-900">Images (this color)</h4>
          <p className="text-xs text-gray-700">
            Front/back mockups for <strong>{editing.colorName || "this variant"}</strong>. Products generated with this
            variant use these as the blank side of renders; Shopify should ultimately show the{" "}
            <strong>generated product images</strong> for each SKU/color that points at this variant (
            <code className="text-[10px] bg-gray-100 px-1 rounded">blankVariantId</code>
            ). Style-level Images tab is not used for per-color storefront galleries on master blanks.
            {!variantIsPersisted && (
              <span className="block mt-1 text-amber-800">
                Save this variant once to write images to Firestore; uploads are stored immediately either way.
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {imageSlot("front", "Front")}
            {imageSlot("back", "Back")}
            {imageSlot("detail", "Detail")}
          </div>
        </div>

        <div className="space-y-3 border-b border-gray-100 pb-4">
          <h4 className="text-sm font-semibold text-gray-900">Back placement &amp; render (this color)</h4>
          <p className="text-xs text-gray-700">
            Overrides apply only to this variant. Resolution order: blank default → variant (here) → product. Leave inherited to use
            the blank&apos;s back zone as-is.
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
