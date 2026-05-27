#!/usr/bin/env node

/**
 * Diagnostic: find recently created Giants designs + show their identity,
 * teamId, league, importKey, etc. Also list design_teams matching "Giants".
 *
 * Usage (from functions/):
 *   node scripts/inspect-giants-design.js
 */

"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function main() {
  console.log("=== design_teams matching 'giants' ===");
  const teamsSnap = await db.collection("design_teams").get();
  const giants = teamsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => {
      const blob = `${t.id} ${t.name || ""} ${t.teamName || ""} ${t.slug || ""} ${t.teamCode || ""}`.toLowerCase();
      return blob.includes("giant");
    });
  for (const t of giants) {
    console.log(JSON.stringify({
      id: t.id,
      name: t.name,
      teamName: t.teamName,
      slug: t.slug,
      teamCode: t.teamCode,
      leagueCode: t.leagueCode || t.leagueId || t.league,
    }, null, 2));
  }

  console.log("\n=== designs where teamId contains 'giants' OR importKey contains 'giants' ===");
  const desSnap = await db.collection("designs").get();
  const matches = desSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => {
      const t = String(d.teamId || "").toLowerCase();
      const k = String(d.importKey || "").toLowerCase();
      const s = String(d.slug || "").toLowerCase();
      const n = String(d.name || "").toLowerCase();
      return t.includes("giant") || k.includes("giant") || s.includes("giant") || n.includes("giant");
    });
  for (const d of matches) {
    console.log(JSON.stringify({
      id: d.id,
      name: d.name,
      slug: d.slug,
      importKey: d.importKey,
      teamId: d.teamId,
      teamNameCache: d.teamNameCache,
      teamCode: d.teamCode,
      leagueCode: d.leagueCode,
      designFamily: d.designFamily,
      themeCode: d.themeCode,
      designType: d.designType,
      designSeries: d.designSeries,
      createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
    }, null, 2));
  }

  console.log("\n=== rp_products where teamId contains 'giants' ===");
  const prodSnap = await db.collection("rp_products").get();
  const pmatches = prodSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => String(p.teamId || "").toLowerCase().includes("giant"));
  for (const p of pmatches) {
    console.log(JSON.stringify({
      id: p.id,
      name: p.name,
      title: p.title,
      teamId: p.teamId,
      teamCode: p.teamCode,
      teamNameCache: p.teamNameCache,
      blankId: p.blankId,
      designId: p.designId,
      productIdentityKey: p.productIdentityKey,
      createdAt: p.createdAt && p.createdAt.toDate ? p.createdAt.toDate().toISOString() : null,
    }, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
