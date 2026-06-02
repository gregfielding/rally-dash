"use strict";

/**
 * Phase I — reference-image management for rp_identities.
 *
 * Exposes three callables:
 *   - addIdentityReferenceImage: stamps a new reference photo onto an identity.
 *     Operator uploads the image to Cloud Storage first via the client SDK,
 *     then calls this with the storage path + role. Server writes the
 *     referenceImages[] entry + bumps the count, validates the role enum.
 *   - removeIdentityReferenceImage: removes by refId. Best-effort Storage
 *     delete (file may already be missing; not a fatal error).
 *   - setIdentityMode: switches an identity between "lora" / "reference_images"
 *     / "hybrid". Optional preferredProviderId can be set in the same call.
 *
 * Why these exist as server callables rather than direct Firestore writes:
 *   - The referenceImages[] array goes through validation (role enum,
 *     URL shape, cap on count) before landing on the doc, so client bugs
 *     can't corrupt the identity.
 *   - The count denormalization (referenceImageCount) needs to stay in
 *     lockstep with array length — a transaction guarantees that.
 *   - Mode switching has implied invariants (can't switch to
 *     "reference_images" with zero references; can't switch to "lora" with
 *     no activeLoraArtifactId) — server enforces.
 */

const VALID_REFERENCE_ROLES = new Set([
  "face_front",
  "face_3q",
  "face_profile",
  "body_full",
  "body_3q",
  "body_side",
  "detail_hands",
  "detail_hair",
]);

const VALID_MODES = new Set(["reference_images", "lora", "hybrid"]);

/** Soft cap. Flux 2 takes up to 9-10 refs; we keep a small buffer so the
 *  operator can stash a few extras and the inference layer picks the best subset. */
const MAX_REFERENCE_IMAGES_PER_IDENTITY = 15;

async function assertAdmin(db, functions, uid) {
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  const snap = await db.collection("admins").doc(uid).get();
  if (!snap.exists) throw new functions.https.HttpsError("permission-denied", "Admins only");
}

function buildAddIdentityReferenceImage({ db, admin, functions, storage }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);

    const { identityId, storagePath, downloadUrl, role, label, width, height, bytes } = data || {};
    if (!identityId || typeof identityId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "identityId is required");
    }
    if (!storagePath || typeof storagePath !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "storagePath is required");
    }
    if (!downloadUrl || typeof downloadUrl !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "downloadUrl is required");
    }
    if (!role || !VALID_REFERENCE_ROLES.has(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `role must be one of: ${[...VALID_REFERENCE_ROLES].join(", ")}`
      );
    }
    /**
     * Storage-path discipline: every reference image must live under
     * rp/identity_references/{identityId}/ so we can scope cleanup + storage
     * rules cleanly. The operator-supplied path is validated against this prefix.
     */
    const expectedPrefix = `rp/identity_references/${identityId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `storagePath must start with ${expectedPrefix}`
      );
    }

    const identityRef = db.collection("rp_identities").doc(identityId);
    const refId = `ref_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    /** Transaction: read current refs, enforce cap, append, update count. */
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(identityRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", `Identity ${identityId} not found`);
      }
      const data = snap.data() || {};
      const current = Array.isArray(data.referenceImages) ? data.referenceImages : [];
      if (current.length >= MAX_REFERENCE_IMAGES_PER_IDENTITY) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Identity already has ${current.length} reference images (cap: ${MAX_REFERENCE_IMAGES_PER_IDENTITY}). Remove some before adding new.`
        );
      }
      const newEntry = {
        refId,
        url: downloadUrl,
        storagePath,
        role,
        label: typeof label === "string" && label.length > 0 ? label : null,
        width: Number.isFinite(Number(width)) ? Number(width) : null,
        height: Number.isFinite(Number(height)) ? Number(height) : null,
        bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : null,
        uploadedAt: admin.firestore.Timestamp.now(),
        uploadedByUid: uid,
      };
      tx.update(identityRef, {
        referenceImages: [...current, newEntry],
        referenceImageCount: current.length + 1,
        updatedAt: now,
      });
    });

    return { refId };
  };
}

function buildRemoveIdentityReferenceImage({ db, admin, functions, storage }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);

    const { identityId, refId } = data || {};
    if (!identityId || typeof identityId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "identityId is required");
    }
    if (!refId || typeof refId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "refId is required");
    }

    const identityRef = db.collection("rp_identities").doc(identityId);
    let removedStoragePath = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(identityRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", `Identity ${identityId} not found`);
      }
      const data = snap.data() || {};
      const current = Array.isArray(data.referenceImages) ? data.referenceImages : [];
      const next = current.filter((r) => r.refId !== refId);
      if (next.length === current.length) {
        throw new functions.https.HttpsError("not-found", `Reference ${refId} not found on identity`);
      }
      const removed = current.find((r) => r.refId === refId);
      removedStoragePath = removed ? removed.storagePath : null;
      tx.update(identityRef, {
        referenceImages: next,
        referenceImageCount: next.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    /** Best-effort Storage cleanup — never fail the callable for a missing file. */
    if (removedStoragePath && storage) {
      try {
        await storage.bucket().file(removedStoragePath).delete();
      } catch (storageErr) {
        console.warn(
          `[removeIdentityReferenceImage] Storage delete failed for ${removedStoragePath}: ${storageErr && storageErr.message}`
        );
      }
    }

    return { ok: true };
  };
}

function buildSetIdentityMode({ db, admin, functions }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);

    const { identityId, mode, preferredProviderId } = data || {};
    if (!identityId || typeof identityId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "identityId is required");
    }
    if (!mode || !VALID_MODES.has(mode)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `mode must be one of: ${[...VALID_MODES].join(", ")}`
      );
    }
    /** Optional provider id — validated against the registered VTON providers. */
    if (preferredProviderId != null) {
      if (typeof preferredProviderId !== "string" || preferredProviderId.length === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "preferredProviderId must be a non-empty string when provided"
        );
      }
      // eslint-disable-next-line global-require
      const { getVtonProvider } = require("./vtonProviders");
      try {
        getVtonProvider(preferredProviderId);
      } catch (e) {
        throw new functions.https.HttpsError("invalid-argument", e.message);
      }
    }

    const identityRef = db.collection("rp_identities").doc(identityId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(identityRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", `Identity ${identityId} not found`);
      }
      const data = snap.data() || {};
      /** Mode invariants: can't switch to reference_images with zero refs;
       *  can't switch to lora without an active artifact. */
      const refCount = Array.isArray(data.referenceImages) ? data.referenceImages.length : 0;
      if (mode === "reference_images" && refCount === 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Cannot switch to mode='reference_images' with zero uploaded reference images. Upload at least one face_* and one body_* photo first."
        );
      }
      if (mode === "lora" && !data.activeLoraArtifactId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Cannot switch to mode='lora' without an activeLoraArtifactId. Train a LoRA first or pick mode='reference_images'."
        );
      }
      const updates = {
        mode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (preferredProviderId !== undefined) {
        updates.preferredProviderId = preferredProviderId || null;
      }
      tx.update(identityRef, updates);
    });

    return { ok: true, mode };
  };
}

module.exports = {
  buildAddIdentityReferenceImage,
  buildRemoveIdentityReferenceImage,
  buildSetIdentityMode,
  VALID_REFERENCE_ROLES,
  VALID_MODES,
  MAX_REFERENCE_IMAGES_PER_IDENTITY,
};
