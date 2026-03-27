"use strict";

/**
 * Global SKU uniqueness across all `rp_products/*/variants/*` docs.
 * Uses collection group query on `sku` (requires index).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} skus
 * @param {{ allowPaths?: Set<string> }} [opts] — doc paths that may already hold this SKU (e.g. legacy upgrade)
 */
async function assertSkusUnusedInDatastore(db, skus, opts) {
  const allow = opts && opts.allowPaths ? opts.allowPaths : new Set();
  const uniq = [...new Set((skus || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (uniq.length === 0) return;

  for (let i = 0; i < uniq.length; i += 10) {
    const chunk = uniq.slice(i, i + 10);
    const snap = await db.collectionGroup("variants").where("sku", "in", chunk).get();
    for (const doc of snap.docs) {
      if (allow.has(doc.ref.path)) continue;
      const found = doc.data() && doc.data().sku;
      throw new Error(`SKU already in use: ${found} → ${doc.ref.path}`);
    }
  }
}

module.exports = { assertSkusUnusedInDatastore };
