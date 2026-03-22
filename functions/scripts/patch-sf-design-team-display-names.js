#!/usr/bin/env node
/**
 * One-time (or idempotent) patch: set official display names on San Francisco design_teams docs.
 * Does NOT change id, teamCode, slug, or leagueCode.
 *
 * Usage (from functions/):
 *   node scripts/patch-sf-design-team-display-names.js
 *   node scripts/patch-sf-design-team-display-names.js --dry-run
 *
 * Requires Firebase admin credentials (same as seed-design-teams-phase1.js).
 */

"use strict";

const admin = require("firebase-admin");
const path = require("path");

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const firebasercPath = path.resolve(__dirname, "../../.firebaserc");
    const firebaserc = JSON.parse(require("fs").readFileSync(firebasercPath, "utf8"));
    if (firebaserc?.projects?.default) return firebaserc.projects.default;
  } catch (_) {}
  return undefined;
}

if (!admin.apps.length) {
  const projectId = getProjectId();
  admin.initializeApp(projectId ? { projectId } : {});
}

const db = admin.firestore();
const dryRun = process.argv.includes("--dry-run");

const PATCHES = {
  sf_giants: {
    name: "San Francisco Giants",
    city: "San Francisco",
    teamName: "Giants",
  },
  sf_49ers: {
    name: "San Francisco 49ers",
    city: "San Francisco",
    teamName: "49ers",
  },
};

async function main() {
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const [docId, fields] of Object.entries(PATCHES)) {
    const ref = db.collection("design_teams").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[skip] ${docId}: document does not exist`);
      continue;
    }
    const before = snap.data();
    console.log(`[patch] ${docId}:`, {
      before: { name: before.name, city: before.city, teamName: before.teamName },
      after: fields,
    });
    if (dryRun) continue;
    await ref.update({
      ...fields,
      updatedAt: now,
    });
  }
  console.log(dryRun ? "[dry-run] no writes performed" : "[done]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
