"use strict";

/**
 * Phase L — save/clear the model print quad on a blank variant.
 *
 * The operator sets a 4-corner chest quad on the model photo in the render-
 * profile editor; this callable persists it to
 * rp_blanks/{blankId}.variants[].modelPrintQuad.{front|back}. The renderer
 * (composeStageA, Phase L3) reads it to perspective-warp every design onto
 * that quad deterministically.
 *
 * Validation mirrors functions/lib/perspectiveWarp.js isValidNormalizedQuad:
 * 4 named corners, each x/y a finite number in [-0.1, 1.1] (slight overscan
 * allowed so a print can bleed past the photo edge).
 */

const VALID_SIDES = new Set(["front", "back"]);
const CORNER_NAMES = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

function assertAdmin(db, functions, uid) {
  return db
    .collection("admins")
    .doc(uid)
    .get()
    .then((snap) => {
      if (!snap.exists) {
        throw new functions.https.HttpsError("permission-denied", "Admins only");
      }
    });
}

function normalizeCorner(c) {
  if (!c || typeof c !== "object") return null;
  const x = Number(c.x);
  const y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null;
  return { x, y };
}

function buildSaveModelPrintQuad({ db, admin, functions }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
    await assertAdmin(db, functions, uid);

    const { blankId, variantId, side, quad, clear } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (!variantId || typeof variantId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "variantId is required");
    }
    if (!side || !VALID_SIDES.has(side)) {
      throw new functions.https.HttpsError("invalid-argument", "side must be 'front' or 'back'");
    }

    /** Build the normalized quad (or null when clearing). */
    let normalizedQuad = null;
    if (!clear) {
      if (!quad || typeof quad !== "object") {
        throw new functions.https.HttpsError("invalid-argument", "quad is required (or pass clear:true)");
      }
      normalizedQuad = {};
      for (const name of CORNER_NAMES) {
        const c = normalizeCorner(quad[name]);
        if (!c) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            `quad.${name} must be {x,y} numbers within [-0.1, 1.1]`
          );
        }
        normalizedQuad[name] = c;
      }
      normalizedQuad.updatedAt = admin.firestore.Timestamp.now();
      normalizedQuad.updatedByUid = uid;
    }

    /** Read-modify-write the blank's variants array (the quad lives on the row). */
    const blankRef = db.collection("rp_blanks").doc(blankId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(blankRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
      }
      const blank = snap.data() || {};
      const variants = Array.isArray(blank.variants) ? blank.variants : [];
      const idx = variants.findIndex((v) => v && v.variantId === variantId);
      if (idx === -1) {
        throw new functions.https.HttpsError("not-found", `Variant ${variantId} not found on blank ${blankId}`);
      }
      const variant = { ...variants[idx] };
      const existing = variant.modelPrintQuad && typeof variant.modelPrintQuad === "object"
        ? { ...variant.modelPrintQuad }
        : {};
      if (clear) {
        existing[side] = null;
      } else {
        existing[side] = normalizedQuad;
      }
      variant.modelPrintQuad = existing;
      const nextVariants = [...variants];
      nextVariants[idx] = variant;
      tx.update(blankRef, {
        variants: nextVariants,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true, blankId, variantId, side, cleared: !!clear };
  };
}

module.exports = { buildSaveModelPrintQuad };
