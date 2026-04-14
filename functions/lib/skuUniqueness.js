"use strict";

/**
 * Global SKU uniqueness across all variant docs (rp_products → variants subcollection).
 * Uses collection group equality on `sku` (requires a COLLECTION_GROUP index on variants.sku).
 *
 * Note: `where('sku','in', [...])` on collection groups has been flaky with some index states;
 * we use parallel `==` queries (one per SKU) which match the standard single-field CG index.
 *
 * If Firestore returns FAILED_PRECONDITION (missing index / not finished building), we log and
 * **skip** the global check so product creation can proceed; deploy `firestore:indexes` to enforce.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} skus
 * @param {{ allowPaths?: Set<string> }} [opts] — doc paths that may already hold this SKU (e.g. legacy upgrade)
 */
function isFirestoreIndexOrInfraError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  const code = err && err.code;
  if (/FAILED_PRECONDITION|index(es)? required|create_composite|collection group/i.test(msg)) {
    return true;
  }
  if (code === 9 || code === "FAILED_PRECONDITION") return true;
  return false;
}

async function assertSkusUnusedInDatastore(db, skus, opts) {
  const allow = opts && opts.allowPaths ? opts.allowPaths : new Set();
  const uniq = [...new Set((skus || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (uniq.length === 0) return;

  let snaps;
  try {
    snaps = await Promise.all(
      uniq.map((sku) => db.collectionGroup("variants").where("sku", "==", sku).limit(3).get())
    );
  } catch (err) {
    if (isFirestoreIndexOrInfraError(err)) {
      console.error(
        JSON.stringify({
          tag: "[SKU_CHECK_SKIPPED_GLOBAL]",
          reason: "firestore_query_failed",
          message: err && err.message ? String(err.message) : String(err),
          code: err && err.code != null ? err.code : null,
          hint: "Deploy and wait for firestore indexes: firebase deploy --only firestore:indexes",
        })
      );
      return;
    }
    throw err;
  }

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    for (const doc of snap.docs) {
      if (allow.has(doc.ref.path)) continue;
      const found = doc.data() && doc.data().sku;
      throw new Error(`SKU already in use: ${found} → ${doc.ref.path}`);
    }
  }
}

module.exports = { assertSkusUnusedInDatastore };
