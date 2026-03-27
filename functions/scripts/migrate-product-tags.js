#!/usr/bin/env node
"use strict";

/**
 * One-time migration: dual-layer tags + full taxonomy row (rally_tag_system_spec.md).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/migrate-product-tags.js --dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/migrate-product-tags.js
 */

const admin = require("firebase-admin");
const { rebuildProductTagsSnapshotFromSources } = require("../lib/merchandisingAtCreate");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const snap = await db.collection("rp_products").get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const product = doc.data();
    const designId = product.designId;
    const blankId = product.blankId;
    if (!designId || !blankId) {
      skipped++;
      continue;
    }

    const designSnap = await db.collection("designs").doc(designId).get();
    const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (!designSnap.exists || !blankSnap.exists) {
      skipped++;
      continue;
    }
    const design = designSnap.data();
    const blank = blankSnap.data();

    let team = null;
    if (design.teamId) {
      const teamSnap = await db.collection("design_teams").doc(design.teamId).get();
      if (teamSnap.exists) {
        const t = teamSnap.data();
        team = {
          id: teamSnap.id,
          name: t.name ?? null,
          teamCode: t.teamCode ?? null,
          city: t.city ?? null,
          teamName: t.teamName ?? null,
          league: t.league ?? null,
          leagueId: t.leagueId ?? null,
          leagueCode: t.leagueCode ?? null,
        };
      }
    }

    const { tags, tagsNormalized, tax } = rebuildProductTagsSnapshotFromSources(team, design, blank);

    const payload = {
      tags,
      tagsNormalized,
      taxonomy: tax.taxonomy,
      sportCode: tax.sportCode ?? null,
      leagueCode: tax.leagueCode ?? null,
      teamCode: tax.teamCode ?? null,
      themeCode: tax.themeCode ?? null,
      designFamily: tax.designFamily ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (dryRun) {
      console.log("[dry-run]", doc.id, tags.join(" | "));
    } else {
      await doc.ref.update(payload);
    }
    updated++;
  }

  console.log(
    dryRun ? `Dry run: would update ${updated} products (skipped ${skipped}).` : `Updated ${updated} products (skipped ${skipped}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
