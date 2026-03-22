#!/usr/bin/env node

/**
 * Seed canonical design_teams (Phase 1: MLB, NFL, NBA, NHL, MLS).
 *
 * IMPORTANT: Writes to collection "design_teams" — NOT "teams".
 * The /teams page in the dashboard reads the legacy "teams" collection; it will not show these rows.
 *
 * Usage (from functions/):
 *   npm run seed:design-teams
 *   node scripts/seed-design-teams-phase1.js
 *   node scripts/seed-design-teams-phase1.js --dry-run
 *   node scripts/seed-design-teams-phase1.js --merge   # upsert / refresh fields on existing docs
 *   node scripts/seed-design-teams-phase1.js --export-json   # write data/designTeams.phase1.json only
 *
 * Requires Firebase project (firebase use <id> or GOOGLE_APPLICATION_CREDENTIALS).
 */

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const {
  buildCanonicalDesignTeamsPhase1,
  getCanonicalDesignTeamsPhase1,
} = require("../data/canonicalDesignTeamsPhase1");

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

if (!admin.apps.length) {
  const projectId = getProjectId();
  admin.initializeApp(projectId ? { projectId } : {});
}

const db = admin.firestore();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const merge = argv.includes("--merge");
const exportJson = argv.includes("--export-json");

function teamToFirestore(team, now, FieldValue) {
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
  const { teams, countsByLeague } = getCanonicalDesignTeamsPhase1();

  const outPath = path.join(__dirname, "../data/designTeams.phase1.json");
  if (exportJson) {
    const exportPayload = {
      version: "2",
      description: "Canonical design_teams Phase 1 — MLB, NFL, NBA, NHL, MLS (teamColors hex+CMYK)",
      allowedColorFamilies: buildCanonicalDesignTeamsPhase1().allowedColorFamilies,
      countsByLeague,
      teams: teams.map((t) => ({
        id: t.id,
        fullName: t.fullName || t.name,
        name: t.name,
        league: t.league,
        leagueCode: t.leagueCode,
        leagueId: t.leagueId,
        city: t.city,
        state: t.state,
        teamName: t.teamName,
        teamCode: t.teamCode,
        slug: t.slug,
        teamColors: t.teamColors,
        primaryColorHex: t.primaryColorHex,
        secondaryColorHex: t.secondaryColorHex ?? null,
        colorFamilies: t.colorFamilies,
        colorVerificationStatus: t.colorVerificationStatus ?? null,
        printVerificationStatus: t.printVerificationStatus ?? null,
        stadiumName: t.stadiumName,
        teamSaying: t.teamSaying,
        fanPhrase: t.fanPhrase,
        tags: t.tags,
        region: t.region,
        rivals: t.rivals,
        mascot: t.mascot,
        hashtags: t.hashtags,
        fanPhrases: t.fanPhrases,
      })),
    };
    fs.writeFileSync(outPath, JSON.stringify(exportPayload, null, 2), "utf8");
    console.log("Wrote", outPath, `(${teams.length} teams)`);
    const onlyExport = argv.length === 1 && argv[0] === "--export-json";
    if (onlyExport) {
      process.exit(0);
    }
  }

  const FieldValue = admin.firestore.FieldValue;
  const now = FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const team of teams) {
    const ref = db.collection("design_teams").doc(team.id);
    const snap = await ref.get();
    const payload = teamToFirestore(team, now, FieldValue);

    if (!snap.exists) {
      if (dryRun) {
        console.log("[dry-run] would create", team.id);
        created++;
        continue;
      }
      await ref.set(payload);
      created++;
      continue;
    }

    if (merge) {
      const existing = snap.data() || {};
      const merged = {
        ...payload,
        createdAt: existing.createdAt || now,
      };
      if (dryRun) {
        console.log("[dry-run] would merge", team.id);
        updated++;
        continue;
      }
      await ref.set(merged, { merge: true });
      updated++;
    } else {
      if (dryRun) skipped++;
      else skipped++;
    }
  }

  console.log(JSON.stringify({ countsByLeague, total: teams.length, created, updated, skipped, dryRun, merge }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
