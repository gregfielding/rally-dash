"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useBlank, useUpdateBlank, useDeleteBlank, COLOR_REGISTRY, type UpdateBlankInput } from "@/lib/hooks/useBlanks";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, db, functions as firebaseFunctions } from "@/lib/firebase/config";
import { collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  RPBlank,
  RPImageRef,
  RPBlankMask,
  RPBlankColorFamily,
  RpProduct,
  RPBlankRenderDefaults,
  type RPBlankGarmentSizeCode,
  type RPBlankDefaultPrintSides,
  type ShopifyVariantMode,
} from "@/lib/types/firestore";
import { useAuth } from "@/lib/providers/AuthProvider";
import {
  getEffectiveColorFamily,
  isMasterBlank,
  getEffectiveCategory,
  countActiveVariants,
  GARMENT_SIZE_CODES_ORDER,
  normalizeGarmentSizes,
  inferDefaultPrintSides,
} from "@/lib/blanks";
import { BlankVariantsManager } from "./BlankVariantsManager";
import { BlankRenderProfileEditor } from "./BlankRenderProfileEditor";
import { BlankEligibilityTab } from "./BlankEligibilityTab";

/** Readable on white inputs when OS dark theme sets a light inherited `color` on the page. */
const BLANK_FIELD =
  "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-[#999999] shadow-sm";
const BLANK_FIELD_SELECT = `${BLANK_FIELD} appearance-none`;
const BLANK_FIELD_COMPACT =
  "rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm";

function ColorFamilyField({
  blank,
  onSave,
}: {
  blank: { colorFamily?: RPBlankColorFamily | null; colorName?: string };
  onSave: (value: RPBlankColorFamily | null) => Promise<void>;
}) {
  const effective = getEffectiveColorFamily(blank.colorFamily, blank.colorName);
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<RPBlankColorFamily | "">(blank.colorFamily ?? "");
  useEffect(() => {
    setLocal(blank.colorFamily ?? "");
  }, [blank.colorFamily]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">
        {blank.colorFamily ? "Set: " : "Derived: "}
        <strong>{effective}</strong>
      </span>
      <select
        value={local}
        onChange={(e) => setLocal(e.target.value as RPBlankColorFamily | "")}
        className={BLANK_FIELD_COMPACT}
      >
        <option value="">—</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <button
        type="button"
        disabled={saving || (local === "" && blank.colorFamily == null) || (local !== "" && local === blank.colorFamily)}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(local === "" ? null : local);
          } finally {
            setSaving(false);
          }
        }}
        className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

const BLEND_MODES = ["normal", "multiply", "overlay", "soft-light"] as const;

function RenderDefaultsForm({
  blank,
  onSave,
}: {
  blank: { renderDefaults?: { blendMode?: string | null; blendOpacity?: number | null; front?: { blendMode?: string | null; blendOpacity?: number | null } | null; back?: { blendMode?: string | null; blendOpacity?: number | null } | null } | null };
  onSave: (renderDefaults: NonNullable<typeof blank.renderDefaults>) => Promise<void>;
}) {
  const rd = blank.renderDefaults;
  const [blendMode, setBlendMode] = useState(rd?.blendMode ?? "soft-light");
  const [blendOpacity, setBlendOpacity] = useState(rd?.blendOpacity ?? 1);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-4 max-w-md">
      <div>
        <label className="block text-sm text-gray-600 mb-1">Blend mode</label>
        <select value={blendMode} onChange={(e) => setBlendMode(e.target.value)} className={BLANK_FIELD_SELECT}>
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Blend opacity (0–1)</label>
        <input type="number" min={0} max={1} step={0.1} value={blendOpacity} onChange={(e) => setBlendOpacity(Number(e.target.value))} className={BLANK_FIELD} />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave({ blendMode, blendOpacity, front: rd?.front ?? null, back: rd?.back ?? null });
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function GarmentSizesSection({ blank, updateBlank, refetchBlank, showToast }: { blank: RPBlank; updateBlank: (i: UpdateBlankInput) => Promise<unknown>; refetchBlank: () => void; showToast: (m: string, t: "success" | "error") => void }) {
  const initial = normalizeGarmentSizes(blank.garmentSizes) ?? [];
  const [selected, setSelected] = useState<Set<RPBlankGarmentSizeCode>>(() => new Set(initial));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(new Set(normalizeGarmentSizes(blank.garmentSizes) ?? []));
  }, [blank.blankId, blank.garmentSizes]);

  const toggle = (code: RPBlankGarmentSizeCode) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="space-y-4 max-w-2xl border border-gray-200 rounded-lg p-4 bg-gray-50/50">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Garment sizes (style)</h3>
        <p className="text-sm text-gray-600 mt-1">
          Sizes belong to the blank, not individual generated products. Phase 1: choose which of XS–XL this style offers.
          Products still use color-only variants for now; later, Shopify can list <strong className="font-medium">Color</strong> ×{" "}
          <strong className="font-medium">Size</strong> using this list for the size axis.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {GARMENT_SIZE_CODES_ORDER.map((code) => (
          <label
            key={code}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
              selected.has(code) ? "border-blue-500 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-700"
            }`}
          >
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={selected.has(code)}
              onChange={() => toggle(code)}
            />
            {code}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            const payload = normalizeGarmentSizes(Array.from(selected));
            await updateBlank({ blankId: blank.blankId, garmentSizes: payload });
            refetchBlank();
            showToast("Garment sizes saved", "success");
          } catch {
            showToast("Failed to save sizes", "error");
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save sizes"}
      </button>
    </div>
  );
}

function ShopifyDefaultsSection({ blank, updateBlank, refetchBlank, showToast }: { blank: RPBlank; updateBlank: (i: UpdateBlankInput) => Promise<unknown>; refetchBlank: () => void; showToast: (m: string, t: "success" | "error") => void }) {
  const sd = blank.shopifyDefaults;
  const is8394Blank = String(blank.styleCode || "").trim() === "8394";
  const storedVariantMode = blank.shopifyVariantMode;
  const effectiveVariantMode: ShopifyVariantMode = storedVariantMode ?? "color";

  const [productType, setProductType] = useState(sd?.productType ?? "");
  const [brand, setBrand] = useState(sd?.brand ?? sd?.vendor ?? "");
  const [productCategory, setProductCategory] = useState(sd?.productCategory ?? "");
  const [collectionHandles, setCollectionHandles] = useState((sd?.collectionHandles ?? []).join(", "));
  const [sizeOptionName, setSizeOptionName] = useState(sd?.sizeOptionName ?? "");
  const [variantStructure, setVariantStructure] = useState<ShopifyVariantMode>(() => blank.shopifyVariantMode ?? "color");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSizeOptionName(blank.shopifyDefaults?.sizeOptionName ?? "");
  }, [blank.blankId, blank.shopifyDefaults?.sizeOptionName]);
  useEffect(() => {
    setVariantStructure(blank.shopifyVariantMode ?? "color");
  }, [blank.blankId, blank.shopifyVariantMode]);
  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-gray-700">Shopify merchandising defaults (style-level). Supplier/sourcing is not duplicated here—use Sourcing.</p>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Variant structure</label>
        <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900">Effective mode (read):</span>
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-900 border border-slate-200">{effectiveVariantMode}</code>
            {storedVariantMode == null ? (
              <span className="text-amber-800">
                — field not set on blank; treated as <code className="font-mono">color</code> until you save
              </span>
            ) : (
              <span className="text-emerald-800">— stored on <code className="font-mono">rp_blanks</code></span>
            )}
          </div>
          <div className="text-slate-600">
            {effectiveVariantMode === "color" ? (
              <>
                <strong>color</strong>: one Shopify variant per color (all sizes for that color share the same Shopify variant id at sync).
              </>
            ) : (
              <>
                <strong>color_size</strong>: Color × Size options; one Shopify variant row per Rally variant (full matrix).
              </>
            )}
          </div>
          {is8394Blank && storedVariantMode == null ? (
            <p className="text-amber-900 border-t border-amber-200/80 pt-1.5 mt-1">
              <strong>8394:</strong> Click <strong>Save</strong> to write <code className="font-mono">shopifyVariantMode: &quot;color&quot;</code> on this blank so
              inheritance is explicit for new products (recommended).
            </p>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 mb-1">
          How Shopify builds variants at sync. <strong>Color only</strong> = one Shopify variant per color (all sizes share the same Shopify variant id).{" "}
          <strong>Color + Size</strong> = Color × Size matrix with one Shopify row per Rally variant (recommended when every size has its own SKU).
        </p>
        <select
          value={variantStructure}
          onChange={(e) => setVariantStructure(e.target.value as ShopifyVariantMode)}
          className={BLANK_FIELD_SELECT}
        >
          <option value="color">Color only (default)</option>
          <option value="color_size">Color + Size (recommended)</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Size option name (Shopify)</label>
        <p className="text-xs text-gray-500 mb-1">
          When variants become Color × Size, this is the Shopify option label for the size dimension (default at sync: <span className="font-mono">Size</span>).
        </p>
        <input
          value={sizeOptionName}
          onChange={(e) => setSizeOptionName(e.target.value)}
          className={BLANK_FIELD}
          placeholder="Size"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Product type</label>
        <input value={productType} onChange={(e) => setProductType(e.target.value)} className={BLANK_FIELD} placeholder="e.g. Panties" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Brand</label>
        <input value={brand} onChange={(e) => setBrand(e.target.value)} className={BLANK_FIELD} placeholder="e.g. Rally" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Product category</label>
        <input value={productCategory} onChange={(e) => setProductCategory(e.target.value)} className={BLANK_FIELD} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Collection handles (comma-separated)</label>
        <input value={collectionHandles} onChange={(e) => setCollectionHandles(e.target.value)} className={BLANK_FIELD} placeholder="panties, cotton" />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await updateBlank({
              blankId: blank.blankId,
              shopifyVariantMode: variantStructure,
              shopifyDefaults: {
                productType: productType.trim() || null,
                brand: brand.trim() || null,
                vendor: brand.trim() || null,
                productCategory: productCategory.trim() || null,
                collectionHandles: collectionHandles.trim() ? collectionHandles.split(",").map((h) => h.trim()).filter(Boolean) : null,
                sizeOptionName: sizeOptionName.trim() || null,
              },
            });
            refetchBlank();
            showToast("Shopify defaults updated", "success");
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

const TEMPLATE_TOKEN_HINT =
  "Tokens: {teamName}, {designName}, {colorName} (from variant at product creation), {garmentStyle}, {category}, {brand}, {vendor} (alias of brand), {league}, {city}, {stadiumName}, {teamSaying}, {fanPhrase}.";

function TemplatesSection({ blank, updateBlank, refetchBlank, showToast }: { blank: RPBlank; updateBlank: (i: UpdateBlankInput) => Promise<unknown>; refetchBlank: () => void; showToast: (m: string, t: "success" | "error") => void }) {
  const [titleTemplate, setTitleTemplate] = useState(blank.titleTemplate ?? "");
  const [descriptionTemplate, setDescriptionTemplate] = useState(blank.descriptionTemplate ?? "");
  const [tagTemplates, setTagTemplates] = useState((blank.tagTemplates ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">{TEMPLATE_TOKEN_HINT}</p>
      <p className="text-xs text-gray-500">
        Tags are generated from these templates and source data at product creation, not manually typed on each product.
      </p>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Title template</label>
        <p className="text-xs text-gray-500 mb-1">Product title pattern. Resolved at product creation with team, design, and blank context.</p>
        <input value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} className={BLANK_FIELD} placeholder="{teamName} {designName} – {colorName}" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Description template</label>
        <p className="text-xs text-gray-500 mb-1">Reusable body copy pattern. Plain text or HTML; resolved at product creation.</p>
        <textarea value={descriptionTemplate} onChange={(e) => setDescriptionTemplate(e.target.value)} rows={3} className={BLANK_FIELD} />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Tag templates (one per line)</label>
        <p className="text-xs text-gray-500 mb-1">One tag per line; each line can contain tokens. Generated automatically into final product tags at creation.</p>
        <textarea value={tagTemplates} onChange={(e) => setTagTemplates(e.target.value)} rows={4} className={BLANK_FIELD} placeholder={`{teamName}\n{league}\npanties\n{colorName}`} />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            const tags = tagTemplates.trim() ? tagTemplates.split("\n").map((t) => t.trim()).filter(Boolean) : [];
            await updateBlank({ blankId: blank.blankId, titleTemplate: titleTemplate.trim() || null, descriptionTemplate: descriptionTemplate.trim() || null, tagTemplates: tags.length ? tags : null });
            refetchBlank();
            showToast("Templates updated", "success");
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function PricingWeightSection({ blank, updateBlank, refetchBlank, showToast }: { blank: RPBlank; updateBlank: (i: UpdateBlankInput) => Promise<unknown>; refetchBlank: () => void; showToast: (m: string, t: "success" | "error") => void }) {
  const dp = blank.defaultPricing;
  const ds = blank.defaultShipping;
  const [retailPrice, setRetailPrice] = useState(dp?.retailPrice ?? dp?.basePrice ?? "");
  const [cost, setCost] = useState(dp?.cost ?? blank.blankCost ?? "");
  const [currencyCode] = useState("USD");
  const [defaultWeightGrams, setDefaultWeightGrams] = useState(ds?.defaultWeightGrams ?? "");
  const [requiresShipping, setRequiresShipping] = useState(ds?.requiresShipping ?? true);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-4 max-w-md">
      <p className="text-sm text-gray-500">Style-level retail and garment cost. Inherited at product creation.</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Retail price</label>
          <input type="number" value={retailPrice} onChange={(e) => setRetailPrice(e.target.value)} className={BLANK_FIELD} />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Cost (garment)</label>
          <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={BLANK_FIELD} />
        </div>
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Currency</label>
        <input value={currencyCode} readOnly className="border border-gray-200 rounded px-2 py-1.5 text-sm w-full bg-gray-50 text-gray-600" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Default weight (grams)</label>
        <input type="number" value={defaultWeightGrams} onChange={(e) => setDefaultWeightGrams(e.target.value)} className={BLANK_FIELD} />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={requiresShipping} onChange={(e) => setRequiresShipping(e.target.checked)} />
        <span className="text-sm text-gray-700">Requires shipping</span>
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await updateBlank({
              blankId: blank.blankId,
              defaultPricing: {
                retailPrice: retailPrice === "" ? null : Number(retailPrice),
                cost: cost === "" ? null : Number(cost),
                currencyCode: "USD",
                basePrice: retailPrice === "" ? null : Number(retailPrice),
              },
              defaultShipping: { defaultWeightGrams: defaultWeightGrams === "" ? null : Number(defaultWeightGrams), requiresShipping },
              blankCost: cost === "" ? null : Number(cost),
              costCurrency: "USD",
            });
            refetchBlank();
            showToast("Pricing / weight updated", "success");
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function SourcingCostSection({ blank, updateBlank, refetchBlank, showToast }: { blank: RPBlank; updateBlank: (i: UpdateBlankInput) => Promise<unknown>; refetchBlank: () => void; showToast: (m: string, t: "success" | "error") => void }) {
  const src = blank.sourcing;
  const [supplier, setSupplier] = useState(src?.supplier ?? src?.vendor ?? blank.supplier ?? "");
  const [supplierStyleCode, setSupplierStyleCode] = useState(src?.supplierStyleCode ?? "");
  const [supplierProductUrl, setSupplierProductUrl] = useState(src?.supplierProductUrl ?? src?.vendorProductUrl ?? "");
  const [notes, setNotes] = useState(src?.notes ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const s = blank.sourcing;
    setSupplier(s?.supplier ?? s?.vendor ?? blank.supplier ?? "");
    setSupplierStyleCode(s?.supplierStyleCode ?? "");
    setSupplierProductUrl(s?.supplierProductUrl ?? s?.vendorProductUrl ?? "");
    setNotes(s?.notes ?? "");
  }, [blank.blankId, blank.supplier, blank.sourcing]);
  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-gray-500">
        Style-level supplier sourcing only. <strong>Retail price and garment cost</strong> are edited on <strong>Pricing / Weight</strong>. Per-color vendor SKUs belong on each <strong>variant</strong>.
      </p>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Supplier</label>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={BLANK_FIELD} />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Supplier style code</label>
        <input value={supplierStyleCode} onChange={(e) => setSupplierStyleCode(e.target.value)} className={BLANK_FIELD} />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Supplier product URL</label>
        <input value={supplierProductUrl} onChange={(e) => setSupplierProductUrl(e.target.value)} className={BLANK_FIELD} placeholder="https://" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">Sourcing notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={BLANK_FIELD} />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await updateBlank({
              blankId: blank.blankId,
              sourcing: {
                supplier: supplier.trim() || null,
                supplierStyleCode: supplierStyleCode.trim() || null,
                supplierProductUrl: supplierProductUrl.trim() || null,
                notes: notes.trim() || null,
              },
            });
            refetchBlank();
            showToast("Sourcing updated", "success");
          } finally {
            setSaving(false);
          }
        }}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function PlacementEditorSection({
  blank,
  updateBlank,
  refetchBlank,
  showToast,
  masks,
  onManageMasks,
  onGenerateAiMask,
  aiMaskGeneratingForView,
}: {
  blank: RPBlank;
  updateBlank: (i: UpdateBlankInput) => Promise<unknown>;
  refetchBlank: () => void;
  showToast: (m: string, t: "success" | "error") => void;
  masks?: { front: RPBlankMask | null; back: RPBlankMask | null };
  onManageMasks?: (view: "front" | "back") => void;
  onGenerateAiMask?: (
    view: "front" | "back",
    opts?: {
      /** "flat_<view>" (default for legacy callers) or "model_<view>" for per-pose masks. */
      renderTarget?: "flat_front" | "flat_back" | "model_front" | "model_back";
      /** Required when renderTarget is model_*; the variant whose model photo to segment. */
      variantId?: string | null;
    }
  ) => void;
  aiMaskGeneratingForView?: "front" | "back" | null;
}) {
  const is8394 = String(blank.styleCode || "").trim() === "8394";
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        <strong>Blank render profile</strong> — canonical zones stored on this style (<code className="text-xs">placements[]</code>
        ). Tune position, scale, safe area, and per-zone blend for <code className="text-xs">flat_blended</code>. Not
        product-level: generated products consume this + variant images + designs.
      </p>
      {is8394 && (
        <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-4">
          <strong>8394 workflow:</strong> Save here → open a product from{" "}
          <Link href={`/blanks/${blank.blankId}?tab=linked`} className="underline font-medium">
            Linked products
          </Link>{" "}
          → <strong>Generate flat renders</strong> on the product Overview to compare Flat Clean vs Flat Blended.
        </p>
      )}
      <BlankRenderProfileEditor
        blank={blank}
        updateBlank={updateBlank}
        refetchBlank={refetchBlank}
        showToast={showToast}
        masks={masks}
        onManageMasks={onManageMasks}
        onGenerateAiMask={onGenerateAiMask}
        aiMaskGeneratingForView={aiMaskGeneratingForView}
      />
    </div>
  );
}

function LinkedProductsSection({ blankId }: { blankId: string }) {
  const [products, setProducts] = useState<(RpProduct & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!db || !blankId) return;
    const q = collection(db, "rp_products");
    const w = where("blankId", "==", blankId);
    getDocs(query(q, w))
      .then((snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RpProduct & { id: string }))))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [blankId]);
  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Products generated from this blank. Color comes from the selected <strong>variant</strong> (per product), not from the master blank itself.
      </p>
      {products.length === 0 ? (
        <p className="text-sm text-gray-500">No linked products.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Design</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Color (variant)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Shopify</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <Link href={`/products/${p.slug ?? p.id}`} className="text-blue-600 hover:underline font-medium">
                      {p.title ?? p.name ?? p.slug ?? p.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{p.teamCode ?? "—"}</td>
                  <td className="px-3 py-2">
                    {p.designId ? (
                      <Link href={`/designs/${p.designId}`} className="text-blue-600 hover:underline">
                        {p.designId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-900">{p.colorway?.name ?? "—"}</span>
                    {p.blankVariantId && (
                      <span className="block font-mono text-xs text-gray-500 mt-0.5">{p.blankVariantId}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-800">{p.status ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{p.shopify?.status ?? "not_synced"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BlankDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blankId = params.blankId as string;
  const { user } = useAuth();

  // Fetch blank
  const { blank, loading: blankLoading, error: blankError, refetch: refetchBlank } = useBlank(blankId);

  // Mutations
  const { updateBlank } = useUpdateBlank();
  const { deleteBlank } = useDeleteBlank();

  type BlankTab =
    | "overview"
    | "variants"
    | "images"
    | "renderProfile"
    | "rendering"
    | "shopify"
    | "templates"
    | "pricing"
    | "sourcing"
    | "eligibility"
    | "linked";
  const [activeTab, setActiveTab] = useState<BlankTab>("overview");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (!t) return;
    if (t === "renderProfile" || t === "placement") setActiveTab("renderProfile");
    else if (t === "linked") setActiveTab("linked");
    else if (t === "variants") setActiveTab("variants");
    else if (t === "images") {
      if (blank && isMasterBlank(blank)) setActiveTab("variants");
      else setActiveTab("images");
    } else if (t === "rendering") setActiveTab("rendering");
  }, [searchParams, blank]);

  // Master blanks use per-variant images only — never stay on Images / Views tab
  useEffect(() => {
    if (!blank || !isMasterBlank(blank) || activeTab !== "images") return;
    setActiveTab("variants");
  }, [blank, activeTab]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Upload state
  const [uploadingView, setUploadingView] = useState<"front" | "back" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUploadView, setCurrentUploadView] = useState<"front" | "back">("front");

  // Linked products (for delete/archive behavior)
  const [linkedProductCount, setLinkedProductCount] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Mask state
  const [masks, setMasks] = useState<{ front: RPBlankMask | null; back: RPBlankMask | null }>({ front: null, back: null });
  const [masksLoading, setMasksLoading] = useState(true);
  const [maskUploadingView, setMaskUploadingView] = useState<"front" | "back" | null>(null);
  const [maskView, setMaskView] = useState<"front" | "back">("front");
  const maskFileInputRef = useRef<HTMLInputElement>(null);
  const [currentMaskUploadView, setCurrentMaskUploadView] = useState<"front" | "back">("front");
  const [autoGenerating, setAutoGenerating] = useState<"front" | "back" | null>(null);
  // AI mask generation state — preview-only until the user clicks Save (see RALLY_BLANK_MASK_AI_AUTOGEN.md §3)
  type MaskRenderTarget = "flat_front" | "flat_back" | "model_front" | "model_back";
  type AiMaskPreview = {
    view: "front" | "back";
    /** Surface this preview is for; defaults to flat_<view> for legacy callers. */
    renderTarget: MaskRenderTarget;
    /** Required when renderTarget is model_*; null for flat targets. */
    variantId: string | null;
    previewMaskUrl: string;
    previewMaskStoragePath: string;
    width: number;
    height: number;
    bytes: number;
    prompt: string;
    seed: number;
    meanGrayscale: number;
    endpoint: string;
  };
  const [aiGenerating, setAiGenerating] = useState<"front" | "back" | null>(null);
  const [aiCommitting, setAiCommitting] = useState<"front" | "back" | null>(null);
  const [aiPreview, setAiPreview] = useState<AiMaskPreview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPromptInput, setAiPromptInput] = useState<string>("");

  // Fetch linked products count
  useEffect(() => {
    if (!db || !blankId) return;
    getDocs(query(collection(db, "rp_products"), where("blankId", "==", blankId)))
      .then((snap) => setLinkedProductCount(snap.size))
      .catch(() => setLinkedProductCount(0));
  }, [blankId]);

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
        source: "manual_upload",
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
        source: "auto_safearea",
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

  /**
   * Run SAM (fal.ai) to propose a print-zone mask for {blankId, view}. Does not commit;
   * stores into `aiPreview` so the user can Refresh or Save. See RALLY_BLANK_MASK_AI_AUTOGEN.md.
   */
  const handleAiGenerate = async (
    view: "front" | "back",
    opts?: {
      reroll?: boolean;
      /** Optional target surface — defaults to flat_<view> for backward compat. */
      renderTarget?: MaskRenderTarget;
      /** Required when renderTarget is model_*. */
      variantId?: string | null;
    }
  ) => {
    if (!blankId || !firebaseFunctions) {
      showToast("Firebase functions not available", "error");
      return;
    }
    setAiError(null);
    setAiGenerating(view);
    try {
      const fn = httpsCallable<
        {
          blankId: string;
          view: "front" | "back";
          renderTarget?: MaskRenderTarget;
          variantId?: string | null;
          prompt?: string;
          seed?: number;
        },
        AiMaskPreview & { previewMaskUrl: string; previewMaskStoragePath: string }
      >(firebaseFunctions, "generateBlankMaskViaSam");
      const prompt = aiPromptInput.trim();
      /** Reroll = new random seed; non-reroll respects user-supplied seed if we ever add a seed input. */
      const seed = opts?.reroll ? Math.floor(Math.random() * 1e9) : undefined;
      const renderTarget: MaskRenderTarget = opts?.renderTarget || `flat_${view}`;
      const variantId = opts?.variantId ?? null;
      const result = await fn({
        blankId,
        view,
        renderTarget,
        variantId,
        prompt: prompt.length > 0 ? prompt : undefined,
        seed,
      });
      /** Server echoes renderTarget + variantId so we trust those when committing. */
      setAiPreview({
        ...result.data,
        view,
        renderTarget: (result.data as { renderTarget?: MaskRenderTarget }).renderTarget || renderTarget,
        variantId:
          (result.data as { variantId?: string | null }).variantId !== undefined
            ? (result.data as { variantId?: string | null }).variantId ?? null
            : variantId,
      });
    } catch (err: any) {
      console.error("[BlankDetail] AI mask generate failed:", err);
      setAiError(err?.message || "AI mask generation failed");
    } finally {
      setAiGenerating(null);
    }
  };

  /** Commit the active preview to `rp_blank_masks/{blankId}_{view}` via the server callable. */
  const handleAiSave = async () => {
    if (!aiPreview || !blankId || !firebaseFunctions) return;
    setAiError(null);
    setAiCommitting(aiPreview.view);
    try {
      const fn = httpsCallable<
        {
          blankId: string;
          view: "front" | "back";
          renderTarget?: MaskRenderTarget;
          variantId?: string | null;
          previewMaskStoragePath: string;
          prompt: string;
          seed: number;
        },
        { ok: boolean; maskDocId: string }
      >(firebaseFunctions, "commitBlankMaskFromPreview");
      const result = await fn({
        blankId,
        view: aiPreview.view,
        renderTarget: aiPreview.renderTarget,
        variantId: aiPreview.variantId,
        previewMaskStoragePath: aiPreview.previewMaskStoragePath,
        prompt: aiPreview.prompt,
        seed: aiPreview.seed,
      });
      /**
       * Doc id depends on (blankId, view, renderTarget, variantId). Use the
       * id the server returns so client + server stay in lockstep without
       * duplicating the keying logic.
       */
      const maskDocId = result.data.maskDocId;
      /**
       * For flat masks, refresh the legacy `masks[view]` slot so the existing
       * Front/Back status pills and overlays light up. Model masks live at a
       * different doc id and don't drive the legacy UI today — no refresh
       * needed; the editor reads them lazily when render target is a model_*.
       */
      const isFlatMask =
        aiPreview.renderTarget === "flat_front" || aiPreview.renderTarget === "flat_back";
      if (isFlatMask) {
        const refreshed = await getDoc(doc(db!, "rp_blank_masks", maskDocId));
        setMasks((prev) => ({
          ...prev,
          [aiPreview.view]: refreshed.exists() ? (refreshed.data() as RPBlankMask) : prev[aiPreview.view],
        }));
      }
      setAiPreview(null);
      setAiPromptInput("");
      const targetLabel = aiPreview.renderTarget.replace("_", " ");
      showToast(`${targetLabel} mask saved (AI)`, "success");
    } catch (err: any) {
      console.error("[BlankDetail] AI mask commit failed:", err);
      setAiError(err?.message || "Saving AI mask failed");
    } finally {
      setAiCommitting(null);
    }
  };

  const handleAiCancel = () => {
    setAiPreview(null);
    setAiError(null);
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

  const handleDeleteClick = () => {
    if (linkedProductCount > 0) return;
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!blank?.blankId) return;
    setDeleting(true);
    try {
      const result = await deleteBlank(blank.blankId);
      if (result.action === "deleted") {
        showToast("Blank deleted", "success");
        setDeleteConfirmOpen(false);
        router.push("/blanks");
      }
    } catch (err: any) {
      console.error("[BlankDetail] Failed to delete blank:", err);
      showToast(err?.message || "Failed to delete blank", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleFileSelect = (view: "front" | "back") => {
    setCurrentUploadView(view);
    fileInputRef.current?.click();
  };

  const [deletingView, setDeletingView] = useState<"front" | "back" | null>(null);
  const handleDeleteImage = async (view: "front" | "back") => {
    if (!blank?.blankId) return;
    if (!confirm(`Remove the ${view} image? You can upload a new one afterward.`)) return;

    setDeletingView(view);
    try {
      await updateBlank({
        blankId: blank.blankId,
        ...(view === "front" ? { clearFrontImage: true } : { clearBackImage: true }),
      });
      showToast(`${view} image removed`, "success");
      refetchBlank();
    } catch (err: any) {
      console.error("[BlankDetail] Failed to delete image:", err);
      showToast("Failed to remove image", "error");
    } finally {
      setDeletingView(null);
    }
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

      {/* Delete confirmation modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h2 id="delete-modal-title" className="text-lg font-semibold text-gray-900 mb-2">Delete blank permanently?</h2>
            <p className="text-sm text-gray-600 mb-4">
              This cannot be undone. The blank will be removed from the system.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
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
                {blank.supplier} • {getEffectiveCategory(blank) || blank.garmentCategory}
                {isMasterBlank(blank) ? ` • ${countActiveVariants(blank)} variant(s)` : blank.colorName ? ` • ${blank.colorName}` : ""}
              </p>
              {isMasterBlank(blank) && (
                <p className="text-xs text-gray-500 mt-1">Colors are defined per variant.</p>
              )}
              <p className="text-xs text-gray-400 mt-1 font-mono">{blank.slug}</p>
            </div>
            {!isMasterBlank(blank) && blank.colorName && (
              <div className="flex items-center gap-2">
                <div
                  className="w-10 h-10 rounded-lg border border-gray-300"
                  style={{ backgroundColor: blank.colorHex || COLOR_REGISTRY[blank.colorName as keyof typeof COLOR_REGISTRY] || "#ccc" }}
                  title={String(blank.colorName)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="flex -mb-px min-w-max">
              {(
                [
                  ["overview", "Overview"],
                  ["variants", "Variants"],
                  ["images", "Images / Views"],
                  ["renderProfile", "Render profile"],
                  ["rendering", "Rendering"],
                  ["shopify", "Shopify Defaults"],
                  ["templates", "Templates"],
                  ["pricing", "Pricing / Weight"],
                  ["sourcing", "Sourcing"],
                  ["eligibility", "Eligibility"],
                  ["linked", "Linked Products"],
                ] as const
              )
                .filter(([key]) => key !== "images" || !isMasterBlank(blank))
                .map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                    activeTab === key
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {label}
                  {key === "rendering" && (masks.front || masks.back) && (
                    <span className="ml-1.5 inline-flex items-center justify-center w-2 h-2 bg-green-500 rounded-full" />
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <p className="text-sm text-gray-500">
                  This blank is the base for products. Set defaults and templates in the tabs below so new products inherit them.
                  {isMasterBlank(blank) && " Master blank = style level; colors and variant images are set per variant."}
                </p>
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
                        <dd className="text-sm text-gray-900 capitalize">{getEffectiveCategory(blank) || blank.garmentCategory || "—"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Variants</dt>
                        <dd className="text-sm text-gray-900">{countActiveVariants(blank)} active</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-gray-500">Linked products</dt>
                        <dd className="text-sm text-gray-900">{linkedProductCount}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-sm text-gray-500 shrink-0">Default print sides</dt>
                        <dd className="text-sm text-gray-900 text-right min-w-0">
                          <select
                            className={BLANK_FIELD_COMPACT + " max-w-[11rem]"}
                            value={blank.defaultPrintSides ?? ""}
                            onChange={async (e) => {
                              const v = e.target.value;
                              const next: RPBlankDefaultPrintSides | null =
                                v === "front_only" || v === "back_only" || v === "both" ? v : null;
                              try {
                                await updateBlank({ blankId: blank.blankId, defaultPrintSides: next });
                                refetchBlank();
                                showToast("Default print sides saved", "success");
                              } catch {
                                showToast("Save failed", "error");
                              }
                            }}
                          >
                            <option value="">Inferred ({inferDefaultPrintSides(blank)})</option>
                            <option value="front_only">Front only</option>
                            <option value="back_only">Back only</option>
                            <option value="both">Both</option>
                          </select>
                          <p className="text-[10px] text-gray-500 mt-1">
                            Garment default for new products; must overlap design artwork sides.
                          </p>
                        </dd>
                      </div>
                      {blank.supplierUrl && (
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Supplier URL</dt>
                          <dd className="text-sm">
                            <a href={blank.supplierUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              Open supplier
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <div>
                    {isMasterBlank(blank) ? (
                      <div className="mb-4">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Master blank</h3>
                        <p className="text-sm text-gray-600">
                          Colors and color families are defined per <strong>variant</strong> on the Variants tab. Product images for each color
                          live on variants, not here.
                        </p>
                        {blank.schemaVersion === 2 && (
                          <p className="text-xs text-gray-400 mt-2">schemaVersion: 2</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Legacy colorway</h3>
                        <div className="flex items-center gap-3 mb-4">
                          <div
                            className="w-16 h-16 rounded-lg border border-gray-300"
                            style={{
                              backgroundColor:
                                blank.colorHex || COLOR_REGISTRY[blank.colorName as keyof typeof COLOR_REGISTRY] || "#ccc",
                            }}
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{blank.colorName || "—"}</p>
                            <p className="text-xs text-gray-500 font-mono">
                              {blank.colorHex || (blank.colorName && COLOR_REGISTRY[blank.colorName as keyof typeof COLOR_REGISTRY])}
                            </p>
                          </div>
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-4">Color family</h3>
                        <p className="text-xs text-gray-500 mb-2">Legacy: single color on document.</p>
                        <ColorFamilyField
                          blank={blank}
                          onSave={async (colorFamily: RPBlankColorFamily | null) => {
                            await updateBlank({ blankId: blank.blankId, colorFamily });
                            refetchBlank();
                            showToast("Color family updated", "success");
                          }}
                        />
                      </>
                    )}

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
                  <p className="text-xs text-gray-500 mb-2">
                    Draft = still being configured; Active = available for product generation; Archived = no new generation, existing products unchanged.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatusChange("draft")}
                      disabled={blank.status === "draft"}
                      title="Not ready for product generation yet."
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
                      title="Available for new product generation."
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
                      title="Stops future product generation. Existing products remain unchanged."
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
                  <p className="text-xs text-gray-500 mb-2">
                    Delete permanently removes this blank. Deletion is disabled once products use this blank.
                  </p>
                  {linkedProductCount > 0 && (
                    <p className="text-sm text-amber-700 mb-2">
                      This blank is used by {linkedProductCount} existing product{linkedProductCount !== 1 ? "s" : ""} and cannot be deleted. Archive it instead.
                    </p>
                  )}
                  <button
                    onClick={handleDeleteClick}
                    disabled={linkedProductCount > 0}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Blank
                  </button>
                </div>
              </div>
            )}

            {activeTab === "variants" && (
              <BlankVariantsManager
                blank={blank}
                updateBlank={updateBlank}
                refetchBlank={refetchBlank}
                showToast={showToast}
              />
            )}

            {/* Images Tab — legacy blanks only (master blanks: Images / Views tab hidden; use Variants → Edit) */}
            {activeTab === "images" && !isMasterBlank(blank) && (
              <div>
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-900">
                  <strong>Legacy blank:</strong> one color per document — front/back images apply to this blank only.
                </div>
                <p className="text-sm text-gray-600 mb-4">
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
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleFileSelect("front")}
                              disabled={uploadingView === "front"}
                              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                            >
                              {uploadingView === "front" ? "Uploading..." : "Replace Image"}
                            </button>
                            <button
                              onClick={() => handleDeleteImage("front")}
                              disabled={deletingView === "front"}
                              className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingView === "front" ? "Removing..." : "Delete"}
                            </button>
                          </div>
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
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleFileSelect("back")}
                              disabled={uploadingView === "back"}
                              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                            >
                              {uploadingView === "back" ? "Uploading..." : "Replace Image"}
                            </button>
                            <button
                              onClick={() => handleDeleteImage("back")}
                              disabled={deletingView === "back"}
                              className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingView === "back" ? "Removing..." : "Delete"}
                            </button>
                          </div>
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

            {/* Render profile tab — canonical blank-level zones (placements[]) */}
            {activeTab === "renderProfile" && (
              <PlacementEditorSection
                blank={blank}
                updateBlank={updateBlank}
                refetchBlank={refetchBlank}
                showToast={showToast}
                masks={masks}
                onManageMasks={(view) => {
                  setMaskView(view);
                  setActiveTab("rendering");
                }}
                onGenerateAiMask={(view, opts) => {
                  /** Hop to the Rendering tab so the AI preview / Save / Refresh card is visible,
                      then kick off the same handler the in-tab button uses. handleAiGenerate
                      sets aiGenerating + populates aiPreview on success. Threads through the
                      optional renderTarget + variantId for per-pose model masks. */
                  setMaskView(view);
                  setActiveTab("rendering");
                  void handleAiGenerate(view, {
                    renderTarget: opts?.renderTarget,
                    variantId: opts?.variantId ?? null,
                  });
                }}
                aiMaskGeneratingForView={aiGenerating}
              />
            )}

            {/* Rendering Tab (render defaults + masks) */}
            {activeTab === "rendering" && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Render defaults</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Style-wide blend fallbacks when a zone does not set its own{" "}
                    <code className="text-xs">renderZoneDefaults</code>. Tune per-zone blend on the{" "}
                    <strong>Render profile</strong> tab. Variant <code className="text-xs">renderOverrides</code> still win
                    at product time.
                  </p>
                  <RenderDefaultsForm
                    blank={blank}
                    onSave={async (renderDefaults) => {
                      await updateBlank({
                        blankId: blank.blankId,
                        renderDefaults: renderDefaults as RPBlankRenderDefaults,
                      });
                      refetchBlank();
                      showToast("Render defaults updated", "success");
                    }}
                  />
                </div>
                <div className="border-t pt-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Masks</h3>
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

                {aiError ? (
                  <div className="mb-4 p-3 border border-red-200 bg-red-50 rounded-lg text-sm text-red-800">
                    <strong>AI mask error:</strong> {aiError}
                    <button
                      onClick={() => setAiError(null)}
                      className="ml-3 text-red-700 underline text-xs hover:no-underline"
                    >
                      dismiss
                    </button>
                  </div>
                ) : null}

                {aiPreview && aiPreview.view === maskView ? (
                  <div className="mb-4 border border-pink-300 bg-pink-50 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 border-b border-pink-200 bg-pink-100 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-pink-900">
                        🪄 AI preview — not saved yet
                      </h4>
                      <span className="text-xs text-pink-800 font-mono">
                        prompt: &quot;{aiPreview.prompt}&quot; · seed: {aiPreview.seed} · mean: {aiPreview.meanGrayscale}
                      </span>
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-4 items-start">
                      <img
                        src={aiPreview.previewMaskUrl}
                        alt="AI mask preview"
                        className="w-full h-64 object-contain bg-gray-800 rounded border"
                      />
                      <div className="flex flex-col gap-3">
                        <div className="text-xs text-gray-600 space-y-1">
                          <div>{aiPreview.width} × {aiPreview.height}px · {Math.round(aiPreview.bytes / 1024)}KB</div>
                          <div className="text-gray-500 font-mono text-[10px]">{aiPreview.endpoint}</div>
                          <div className="pt-1">
                            Saving will overwrite the existing {aiPreview.view} mask and lock it (production
                            renders read this version going forward).
                          </div>
                        </div>
                        <label className="text-xs text-gray-700 font-medium">
                          Prompt (optional override for refresh)
                          <input
                            type="text"
                            value={aiPromptInput}
                            onChange={(e) => setAiPromptInput(e.target.value)}
                            placeholder={aiPreview.prompt}
                            className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={handleAiSave}
                            disabled={aiCommitting !== null || aiGenerating !== null}
                            className="flex-1 px-4 py-2 bg-pink-600 text-white text-sm font-semibold rounded-lg hover:bg-pink-700 disabled:opacity-50"
                          >
                            {aiCommitting === aiPreview.view ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => handleAiGenerate(aiPreview.view, { reroll: true })}
                            disabled={aiCommitting !== null || aiGenerating !== null}
                            className="px-4 py-2 border border-pink-300 text-pink-700 text-sm font-medium rounded-lg hover:bg-pink-100 disabled:opacity-50"
                            title="Re-run with a new seed (or the prompt above)"
                          >
                            {aiGenerating === aiPreview.view ? "Refreshing…" : "Refresh ↻"}
                          </button>
                          <button
                            onClick={handleAiCancel}
                            disabled={aiCommitting !== null || aiGenerating !== null}
                            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

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
                        {(() => {
                          /**
                           * Mirror the backend's `pickRefImageUrl` (functions/lib/blankMaskGeneration.js):
                           * top-level blank image first, then first variant's flat photo for the view.
                           * This is what SAM will see when "Generate with AI" runs — show it here so
                           * "No front image" doesn't mislead when variants are present.
                           */
                          const direct = blank.images?.[maskView]?.downloadUrl;
                          if (direct) {
                            return (
                              <img
                                src={direct}
                                alt={`${maskView} view`}
                                className="w-full h-64 object-contain bg-white rounded border"
                              />
                            );
                          }
                          const variantFallback = (blank.variants ?? []).find((v: any) => {
                            const im = v?.images;
                            return im && (maskView === "front" ? im.flatFront?.downloadUrl || im.front?.downloadUrl : im.flatBack?.downloadUrl || im.back?.downloadUrl);
                          });
                          if (variantFallback) {
                            const im = (variantFallback as any).images;
                            const ref = maskView === "front" ? im.flatFront || im.front : im.flatBack || im.back;
                            return (
                              <>
                                <img
                                  src={ref.downloadUrl}
                                  alt={`${maskView} view (variant fallback)`}
                                  className="w-full h-64 object-contain bg-white rounded border"
                                />
                                <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                  Using <strong>{(variantFallback as any).colorName || "first variant"}</strong> flat as reference. SAM will use this image. Upload a master {maskView} image on the Identity tab to override.
                                </p>
                              </>
                            );
                          }
                          return (
                            <div className="w-full h-64 bg-gray-100 rounded border flex items-center justify-center">
                              <p className="text-sm text-gray-500">No {maskView} image — upload one on the Identity tab or add a variant photo</p>
                            </div>
                          );
                        })()}
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
                            <div className="flex flex-col gap-2">
                              <label className="text-[11px] text-gray-700 font-medium">
                                Prompt for SAM
                                <input
                                  type="text"
                                  value={aiPromptInput}
                                  onChange={(e) => setAiPromptInput(e.target.value)}
                                  placeholder={maskView === "front" ? "chest" : "upper back"}
                                  className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white font-normal"
                                />
                              </label>
                              <button
                                onClick={() => handleAiGenerate(maskView)}
                                disabled={aiGenerating !== null || aiCommitting !== null || maskUploadingView === maskView || autoGenerating === maskView}
                                className="px-3 py-1.5 text-sm bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-50 font-semibold"
                                title="Ask SAM to find the print zone (preview before saving)"
                              >
                                {aiGenerating === maskView ? "Asking SAM…" : "🪄 Generate with AI"}
                              </button>
                              <p className="text-[11px] text-gray-500 -mt-1">
                                Uses the blank&apos;s reference photo above. <strong>No design needed</strong>. Use simple nouns SAM understands (e.g. <code>chest</code>, <code>torso</code>, <code>sweatshirt body</code>).
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleMaskFileSelect(maskView)}
                                  disabled={maskUploadingView === maskView || autoGenerating === maskView || aiGenerating !== null}
                                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                >
                                  {maskUploadingView === maskView ? "Uploading..." : "Replace Mask"}
                                </button>
                                <button
                                  onClick={() => handleAutoGenerateMask(maskView)}
                                  disabled={autoGenerating === maskView || maskUploadingView === maskView || aiGenerating !== null}
                                  className="px-3 py-1.5 text-sm border border-purple-300 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-50"
                                  title="Regenerate rectangular mask from safeArea placement (fallback)"
                                >
                                  {autoGenerating === maskView ? "Generating..." : "From SafeArea (fallback)"}
                                </button>
                              </div>
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
                              <label className="text-[11px] text-gray-700 font-medium text-left">
                                Prompt for SAM
                                <input
                                  type="text"
                                  value={aiPromptInput}
                                  onChange={(e) => setAiPromptInput(e.target.value)}
                                  placeholder={maskView === "front" ? "chest" : "upper back"}
                                  className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white font-normal"
                                />
                              </label>
                              <button
                                onClick={() => handleAiGenerate(maskView)}
                                disabled={aiGenerating !== null || aiCommitting !== null || maskUploadingView === maskView || autoGenerating === maskView}
                                className="px-4 py-2 bg-pink-600 text-white text-sm font-semibold rounded-lg hover:bg-pink-700 disabled:opacity-50"
                                title="Ask SAM to find the print zone (preview before saving)"
                              >
                                {aiGenerating === maskView ? "Asking SAM…" : "🪄 Generate with AI"}
                              </button>
                              <p className="text-[11px] text-gray-500 -mt-1 px-1 text-left">
                                Uses the blank&apos;s reference photo. <strong>No design needed</strong>. Use simple nouns SAM understands (e.g. <code>chest</code>, <code>torso</code>, <code>sweatshirt body</code>).
                              </p>
                              <button
                                onClick={() => handleMaskFileSelect(maskView)}
                                disabled={maskUploadingView === maskView || autoGenerating === maskView || aiGenerating !== null}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                              >
                                {maskUploadingView === maskView ? "Uploading..." : "Upload Mask (manual)"}
                              </button>
                              <button
                                onClick={() => handleAutoGenerateMask(maskView)}
                                disabled={autoGenerating === maskView || maskUploadingView === maskView || aiGenerating !== null}
                                className="px-4 py-2 border border-purple-300 text-purple-700 text-sm rounded-lg hover:bg-purple-50 disabled:opacity-50"
                              >
                                {autoGenerating === maskView ? "Generating..." : "From SafeArea (fallback)"}
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
              </div>
            )}

            {/* Shopify Defaults Tab (sizes + storefront defaults) */}
            {activeTab === "shopify" && (
              <div className="space-y-8">
                <GarmentSizesSection blank={blank} updateBlank={updateBlank} refetchBlank={refetchBlank} showToast={showToast} />
                <ShopifyDefaultsSection blank={blank} updateBlank={updateBlank} refetchBlank={refetchBlank} showToast={showToast} />
              </div>
            )}
            {/* Templates Tab */}
            {activeTab === "templates" && (
              <TemplatesSection blank={blank} updateBlank={updateBlank} refetchBlank={refetchBlank} showToast={showToast} />
            )}
            {/* Pricing / Weight Tab */}
            {activeTab === "pricing" && (
              <PricingWeightSection blank={blank} updateBlank={updateBlank} refetchBlank={refetchBlank} showToast={showToast} />
            )}
            {/* Sourcing Tab */}
            {activeTab === "sourcing" && (
              <SourcingCostSection blank={blank} updateBlank={updateBlank} refetchBlank={refetchBlank} showToast={showToast} />
            )}
            {activeTab === "eligibility" && (
              <BlankEligibilityTab
                blank={blank}
                updateBlank={updateBlank}
                refetchBlank={refetchBlank}
                showToast={showToast}
              />
            )}
            {/* Linked Products Tab */}
            {activeTab === "linked" && (
              <LinkedProductsSection blankId={blankId} />
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
