#!/usr/bin/env node
"use strict";

/**
 * One-time migration: rename design_teams document ids to the canonical team slug
 * (slugify(full official team name)), e.g. sf_giants → san_francisco_giants.
 *
 * Updates: designs.teamId, rp_products.teamId where they match the old id.
 *
 * Usage:
 *   node scripts/migrate-design-team-ids.js --dry-run
 *   node scripts/migrate-design-team-ids.js
 *
 * Requires Firebase credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default).
 */

const admin = require("firebase-admin");
const { canonicalTeamSlugFromDesignTeam } = require("../lib/canonicalTeamSlug");

function buildTeamDisplayName(team, design) {
  if (team && team.name && String(team.name).trim()) return String(team.name).trim();
  if (design && design.teamNameCache && String(design.teamNameCache).trim()) return String(design.teamNameCache).trim();
  if (design && design.name && String(design.name).trim()) return String(design.name).trim();
  return "";
}

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function updateQueryRefs(collectionName, field, oldId, newId, dryRun) {
  const snap = await db.collection(collectionName).where(field, "==", oldId).get();
  let n = 0;
  for (const d of snap.docs) {
    if (dryRun) {
      console.log(`  [dry-run] ${collectionName}/${d.id} ${field}: ${oldId} → ${newId}`);
    } else {
      await d.ref.update({ [field]: newId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    n++;
  }
  return n;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const teamsSnap = await db.collection("design_teams").get();
  const moves = [];

  for (const doc of teamsSnap.docs) {
    const data = doc.data();
    const oldId = doc.id;
    const newId = canonicalTeamSlugFromDesignTeam(
      { id: oldId, ...data },
      buildTeamDisplayName(data, {})
    );
    if (!newId) {
      console.warn(`Skip (no canonical slug): ${oldId}`);
      continue;
    }
    if (newId === oldId) continue;
    moves.push({ oldId, newId, data });
  }

  console.log(`Planned moves: ${moves.length}`);
  for (const m of moves) {
    const exists = await db.collection("design_teams").doc(m.newId).get();
    if (exists.exists) {
      console.error(`Target already exists; resolve manually: ${m.oldId} → ${m.newId}`);
      process.exit(1);
    }
  }

  let designsUpdated = 0;
  let productsUpdated = 0;

  for (const m of moves) {
    console.log(`${m.oldId} → ${m.newId}`);
    if (!dryRun) {
      await db
        .collection("design_teams")
        .doc(m.newId)
        .set({ ...m.data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    designsUpdated += await updateQueryRefs("designs", "teamId", m.oldId, m.newId, dryRun);
    productsUpdated += await updateQueryRefs("rp_products", "teamId", m.oldId, m.newId, dryRun);
    if (!dryRun) {
      await db.collection("design_teams").doc(m.oldId).delete();
    }
  }

  console.log(
    dryRun
      ? `Dry run complete. Would update designs: ${designsUpdated}, products: ${productsUpdated}`
      : `Done. Updated designs: ${designsUpdated}, products: ${productsUpdated}. Run: npm run migrate:product-tags`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
