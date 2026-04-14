#!/usr/bin/env node

/**
 * Backfill design_teams docs for San Francisco Giants + New York Yankees from
 * canonical Phase-1 data (mlbVerifiedBrandColors + mlbCanonicalMeta + MLB_DESIGN_TEAMS).
 *
 * Usage (from functions/):
 *   node scripts/backfill-design-teams-giants-yankees.js --dry-run
 *   node scripts/backfill-design-teams-giants-yankees.js
 *
 * Requires Firebase credentials (firebase use <id> or GOOGLE_APPLICATION_CREDENTIALS).
 */

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { getCanonicalDesignTeamsPhase1 } = require("../data/canonicalDesignTeamsPhase1");

const TARGET_IDS = new Set(["ny_yankees", "sf_giants"]);

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const firebasercPath = path.resolve(__dirname, "../../.firebaserc");
    const firebaserc = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));
    if (firebaserc?.projects?.default) return firebaserc.projects.default;
  } catch (_) {}
  return undefined;
}

function teamToFirestore(team, now) {
  return {
    id: team.id,
    name: team.name,
    league: team.league ?? null,
    leagueId: team.leagueId ?? team.leagueCode ?? null,
    leagueCode: team.leagueCode ?? team.leagueId ?? null,
    city: team.city ?? null,
    state: team.state ?? null,
    teamName: team.teamName ?? null,
    teamCode: team.teamCode,
    slug: team.slug,
    teamColors: team.teamColors,
    primaryColorHex: team.primaryColorHex ?? null,
    secondaryColorHex: team.secondaryColorHex ?? null,
    colorFamilies: team.colorFamilies,
    colorVerificationStatus: team.colorVerificationStatus ?? null,
    printVerificationStatus: team.printVerificationStatus ?? null,
    stadiumName: team.stadiumName ?? null,
    teamSaying: team.teamSaying ?? null,
    fanPhrase: team.fanPhrase ?? null,
    tags: Array.isArray(team.tags) ? team.tags : [],
    region: Array.isArray(team.region) ? team.region : [],
    rivals: Array.isArray(team.rivals) ? team.rivals : [],
    mascot: team.mascot ?? null,
    hashtags: Array.isArray(team.hashtags) ? team.hashtags : [],
    fanPhrases: Array.isArray(team.fanPhrases) ? team.fanPhrases : [],
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const { teams } = getCanonicalDesignTeamsPhase1();
  const selected = teams.filter((t) => TARGET_IDS.has(t.id));
  if (selected.length !== TARGET_IDS.size) {
    const got = selected.map((t) => t.id);
    throw new Error(`Expected ${TARGET_IDS.size} teams, got ${selected.length}: ${got.join(", ")}`);
  }

  if (dryRun) {
    for (const team of selected) {
      const payload = teamToFirestore(team, "[serverTimestamp]");
      console.log(JSON.stringify({ id: team.id, mergePayload: payload }, null, 2));
    }
    console.log("[dry-run] No Firestore writes. Run without --dry-run to merge into design_teams.");
    return;
  }

  if (!admin.apps.length) {
    const projectId = getProjectId();
    admin.initializeApp(projectId ? { projectId } : {});
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;
  const now = FieldValue.serverTimestamp();

  for (const team of selected) {
    const ref = db.collection("design_teams").doc(team.id);
    const snap = await ref.get();
    const payload = teamToFirestore(team, now);
    const existing = snap.exists ? snap.data() || {} : {};
    await ref.set(
      {
        ...payload,
        createdAt: existing.createdAt || now,
        updatedAt: now,
      },
      { merge: true }
    );
    console.log("Merged design_teams/", team.id, snap.exists ? "(existed)" : "(created fields)");
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
