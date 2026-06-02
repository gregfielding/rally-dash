"use client";

/**
 * Phase I — per-identity reference-image admin.
 *
 * Operator flow:
 *   1. Land on /lora/identities/{id}/references.
 *   2. Upload a photo (drag-and-drop or file picker). Pick a role
 *      (face_front / face_3q / face_profile / body_full / body_3q /
 *      body_side / detail_hands / detail_hair). Optionally label it.
 *   3. Image uploads to Cloud Storage at
 *      `rp/identity_references/{identityId}/{role}_{ts}.png`, then the
 *      `addIdentityReferenceImage` callable registers it on the identity
 *      doc.
 *   4. The grid below shows all current references grouped by role.
 *      Click ✕ to remove (best-effort Storage delete + remove from doc).
 *   5. Switch identity mode (lora / reference_images / hybrid) and pick
 *      a preferred provider (e.g. flux_2_multireference). Saving these
 *      validates server-side that the prerequisites are met (need ≥1 ref
 *      for reference_images mode; need active LoRA for lora mode).
 *   6. Click "Test render" to jump to a blank-preview page that will use
 *      this identity end-to-end.
 *
 * Source of truth: `rp_identities/{id}.referenceImages[]`. This page
 * subscribes via onSnapshot so multi-tab updates and concurrent uploads
 * stay consistent.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  doc as firestoreDoc,
  onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  db as firebaseDb,
  functions as firebaseFunctions,
  storage as firebaseStorage,
} from "@/lib/firebase/config";
import ProtectedRoute from "@/components/ProtectedRoute";
import type {
  RPIdentity,
  RPIdentityMode,
  RPIdentityReferenceImage,
  RPIdentityReferenceRole,
} from "@/lib/types/firestore";

const ROLES: Array<{ id: RPIdentityReferenceRole; label: string; tip: string }> = [
  { id: "face_front", label: "Face — front", tip: "Eye level, looking at camera, even soft light." },
  { id: "face_3q", label: "Face — 3/4", tip: "Head turned ~45°, both eyes visible." },
  { id: "face_profile", label: "Face — profile", tip: "Side view, ear visible, jawline clear." },
  { id: "body_full", label: "Body — full", tip: "Head to feet, plain background, neutral pose." },
  { id: "body_3q", label: "Body — 3/4", tip: "Knees up, light hip rotation." },
  { id: "body_side", label: "Body — side", tip: "Profile body shot showing posture." },
  { id: "detail_hands", label: "Detail — hands", tip: "Optional. Helps with body proportions." },
  { id: "detail_hair", label: "Detail — hair", tip: "Optional. Useful when hair texture matters." },
];

const PROVIDER_OPTIONS: Array<{ id: string; label: string; requiresRefs: boolean }> = [
  { id: "flux_2_multireference", label: "Flux 2 multi-reference (recommended)", requiresRefs: true },
  { id: "kolors_vto", label: "Kolors VTO v1.5 (garment swap, no identity refs used)", requiresRefs: false },
  { id: "flux_fill", label: "Flux Fill (mask-based, no identity refs used)", requiresRefs: false },
];

function IdentityReferencesContent() {
  const params = useParams();
  const identityId = String(params?.id || "");
  const [identity, setIdentity] = useState<(RPIdentity & { id: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RPIdentityReferenceRole>("face_front");
  const [pendingLabel, setPendingLabel] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Live subscription to the identity doc. */
  useEffect(() => {
    if (!firebaseDb || !identityId) return;
    const unsub = onSnapshot(
      firestoreDoc(firebaseDb, "rp_identities", identityId),
      (snap) => {
        if (!snap.exists()) {
          setIdentity(null);
          setError(`Identity ${identityId} not found.`);
          return;
        }
        setIdentity({ id: snap.id, ...(snap.data() as RPIdentity) });
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, [identityId]);

  const referenceImages = identity?.referenceImages || [];
  const byRole = useMemo(() => {
    const m = new Map<string, RPIdentityReferenceImage[]>();
    for (const r of referenceImages) {
      if (!m.has(r.role)) m.set(r.role, []);
      m.get(r.role)!.push(r);
    }
    return m;
  }, [referenceImages]);
  const totalCount = referenceImages.length;
  const distinctRoles = byRole.size;

  const handleUpload = async (file: File) => {
    if (!firebaseStorage || !firebaseFunctions) {
      setError("Firebase not initialized");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      /** Storage path matches what the callable validates (must start with
       *  rp/identity_references/{identityId}/). */
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const storagePath = `rp/identity_references/${identityId}/${selectedRole}_${Date.now()}.${ext}`;
      const ref = storageRef(firebaseStorage, storagePath);
      await uploadBytes(ref, file, { contentType: file.type || "image/png" });
      const downloadUrl = await getDownloadURL(ref);

      /** Optional: read image dimensions client-side so the grid layout is correct. */
      const dims = await readImageDims(file).catch(() => ({ width: null, height: null }));

      const fn = httpsCallable<
        {
          identityId: string;
          storagePath: string;
          downloadUrl: string;
          role: RPIdentityReferenceRole;
          label?: string;
          width?: number | null;
          height?: number | null;
          bytes?: number;
        },
        { refId: string }
      >(firebaseFunctions, "addIdentityReferenceImage");
      await fn({
        identityId,
        storagePath,
        downloadUrl,
        role: selectedRole,
        label: pendingLabel || undefined,
        width: dims.width,
        height: dims.height,
        bytes: file.size,
      });
      setPendingLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (refId: string) => {
    if (!firebaseFunctions) return;
    if (!confirm("Remove this reference photo? (Storage file will be deleted too.)")) return;
    try {
      const fn = httpsCallable<{ identityId: string; refId: string }, { ok: boolean }>(
        firebaseFunctions,
        "removeIdentityReferenceImage"
      );
      await fn({ identityId, refId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleSaveMode = async (mode: RPIdentityMode, preferredProviderId: string | null) => {
    if (!firebaseFunctions) return;
    setError(null);
    try {
      const fn = httpsCallable<
        { identityId: string; mode: RPIdentityMode; preferredProviderId?: string | null },
        { ok: boolean; mode: RPIdentityMode }
      >(firebaseFunctions, "setIdentityMode");
      await fn({ identityId, mode, preferredProviderId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  if (!identityId) return <div className="p-6">Missing identity id</div>;

  return (
    <div className="space-y-8 max-w-5xl mx-auto p-6">
      <header>
        <Link href="/lora/identities" className="text-sm text-blue-600 hover:underline">
          ← Identities
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">
          {identity?.name || identityId} · reference photos
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload 4-9 photos of this person across distinct angles. Flux 2 multi-reference
          uses them at inference time to keep the same identity across thousands of generations
          — no training step.
        </p>
      </header>

      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      ) : null}

      {/* Identity mode + preferred provider */}
      {identity ? (
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Identity mode
          </h2>
          <ModePicker
            identity={identity}
            totalCount={totalCount}
            onSave={handleSaveMode}
          />
        </section>
      ) : null}

      {/* Upload */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Upload reference photo
          </h2>
          <span className="text-xs text-gray-500">
            {totalCount} / 15 uploaded · {distinctRoles} distinct roles
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Role</span>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as RPIdentityReferenceRole)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              {ROLES.find((r) => r.id === selectedRole)?.tip}
            </p>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Label (optional)</span>
            <input
              type="text"
              value={pendingLabel}
              onChange={(e) => setPendingLabel(e.target.value)}
              placeholder="hero shot, casual smile, …"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">File</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
              className="block w-full text-sm text-gray-700 file:mr-2 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
            />
          </label>
        </div>
        {uploading ? (
          <p className="text-xs text-blue-700 mt-2">Uploading + registering…</p>
        ) : null}
      </section>

      {/* Reference grid by role */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Current references
        </h2>
        {totalCount === 0 ? (
          <p className="text-sm text-gray-500">
            No references yet. Aim for at least one face_front + one body_full as the minimum
            usable set; 4-9 photos covering varied angles is the Flux 2 sweet spot.
          </p>
        ) : (
          <div className="space-y-5">
            {ROLES.map((role) => {
              const photos = byRole.get(role.id) || [];
              if (photos.length === 0) return null;
              return (
                <div key={role.id}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-800">
                      {role.label}{" "}
                      <span className="text-xs text-gray-400">({photos.length})</span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {photos.map((p) => (
                      <ReferenceTile key={p.refId} photo={p} onRemove={() => handleRemove(p.refId)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ModePicker({
  identity,
  totalCount,
  onSave,
}: {
  identity: RPIdentity & { id: string };
  totalCount: number;
  onSave: (mode: RPIdentityMode, preferredProviderId: string | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<RPIdentityMode>(identity.mode || "reference_images");
  const [provider, setProvider] = useState<string>(
    identity.preferredProviderId || "flux_2_multireference"
  );
  const [saving, setSaving] = useState(false);

  const refReady = totalCount > 0;
  const loraReady = !!identity.activeLoraArtifactId;
  const canSwitchTo = (m: RPIdentityMode) => {
    if (m === "reference_images") return refReady;
    if (m === "lora") return loraReady;
    if (m === "hybrid") return refReady || loraReady;
    return false;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["reference_images", "lora", "hybrid"] as RPIdentityMode[]).map((m) => {
          const enabled = canSwitchTo(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={!enabled}
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : enabled
                  ? "border border-gray-300 hover:bg-gray-50"
                  : "border border-gray-200 text-gray-400 cursor-not-allowed"
              }`}
              title={
                enabled
                  ? `Switch identity to ${m} mode`
                  : m === "reference_images"
                  ? "Upload at least one reference photo first"
                  : m === "lora"
                  ? "Train a LoRA first (no activeLoraArtifactId)"
                  : ""
              }
            >
              {m}
            </button>
          );
        })}
      </div>
      <label className="block max-w-md">
        <span className="text-xs text-gray-500 mb-1 block">Preferred provider</span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500 mt-1">
          flux_2_multireference uses the reference photos above. The other providers ignore them
          (this picker affects which provider Stage B routes through for THIS identity).
        </p>
      </label>
      <div>
        <button
          type="button"
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(mode, provider);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || !canSwitchTo(mode)}
          className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {saving ? "Saving…" : "Save mode + provider"}
        </button>
        {identity.mode ? (
          <span className="ml-3 text-xs text-gray-500">
            Current: <strong>{identity.mode}</strong>
            {identity.preferredProviderId ? ` · ${identity.preferredProviderId}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ReferenceTile({
  photo,
  onRemove,
}: {
  photo: RPIdentityReferenceImage;
  onRemove: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded overflow-hidden group relative">
      <div className="aspect-square bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.label || photo.role} className="w-full h-full object-cover" />
      </div>
      {photo.label ? (
        <div className="px-2 py-1 text-xs text-gray-700 truncate">{photo.label}</div>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-white/80 hover:bg-white text-red-700 text-xs rounded px-1.5 py-0.5 shadow opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove reference"
      >
        ✕
      </button>
    </div>
  );
}

async function readImageDims(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: null, height: null });
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve({ width: null, height: null });
    reader.readAsDataURL(file);
  });
}

export default function IdentityReferencesPage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <IdentityReferencesContent />
    </ProtectedRoute>
  );
}
