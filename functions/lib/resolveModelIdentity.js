"use strict";

/**
 * Resolve on-model identity for generation jobs.
 * Fallback: team.defaultModelId → blank.defaultModelId → global default (env / config).
 *
 * @param {object} ctx
 * @param {FirebaseFirestore.Firestore} ctx.db
 * @param {string} [ctx.teamId]
 * @param {string} ctx.blankId
 * @param {string} [ctx.designId]
 * @returns {Promise<string|null>}
 */
async function resolveModelIdentity(ctx) {
  const { db, teamId, blankId } = ctx;
  const tryTeam = async () => {
    if (!teamId || typeof teamId !== "string") return null;
    const snap = await db.collection("design_teams").doc(teamId).get();
    if (!snap.exists) return null;
    const t = snap.data() || {};
    const id =
      (t.defaultModelId && String(t.defaultModelId).trim()) ||
      (t.generationDefaults && t.generationDefaults.defaultIdentityId && String(t.generationDefaults.defaultIdentityId).trim()) ||
      null;
    return id ? String(id).trim() : null;
  };
  const tryBlank = async () => {
    if (!blankId || typeof blankId !== "string") return null;
    const snap = await db.collection("rp_blanks").doc(blankId).get();
    if (!snap.exists) return null;
    const b = snap.data() || {};
    const id =
      (b.defaultModelId && String(b.defaultModelId).trim()) ||
      (b.generationDefaults && b.generationDefaults.defaultIdentityId && String(b.generationDefaults.defaultIdentityId).trim()) ||
      null;
    return id ? String(id).trim() : null;
  };
  const globalDefault = () => {
    try {
      const cfg =
        typeof process !== "undefined" && process.env && process.env.RP_DEFAULT_MODEL_IDENTITY_ID
          ? String(process.env.RP_DEFAULT_MODEL_IDENTITY_ID).trim()
          : "";
      if (cfg) return cfg;
    } catch (e) {
      /* ignore */
    }
    return null;
  };

  const a = await tryTeam();
  if (a) return a;
  const b = await tryBlank();
  if (b) return b;
  return globalDefault();
}

module.exports = { resolveModelIdentity };
