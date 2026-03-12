#!/usr/bin/env node

/**
 * Verify taxonomy data in Firestore after seeding.
 * Uses same projectId resolution as seed-taxonomy.js; requires Firebase credentials.
 *
 * Usage (from functions directory):
 *   node scripts/verify-taxonomy.js
 *
 * Checks:
 *   - Counts per collection
 *   - NCAA D1 colleges: count 361, sample codes (USC, ALABAMA, NOTRE_DAME)
 *   - Olympic themes: include OLYMPIC_CURLING and other OLYMPIC_* themes
 *   - Leagues filter by sportCode (e.g. COLLEGE_SPORTS -> NCAA)
 *   - Entities filter by leagueCode / sportCode (same logic as useTaxonomy hooks)
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

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

const COLLECTIONS = {
  sports: "rp_taxonomy_sports",
  leagues: "rp_taxonomy_leagues",
  entities: "rp_taxonomy_entities",
  themes: "rp_taxonomy_themes",
  design_families: "rp_taxonomy_design_families",
};

async function getAll(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function activeOnly(items) {
  return items.filter((x) => x.active !== false);
}

function sortByOrder(items) {
  return [...items].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
}

async function run() {
  console.log("\n🔍 Taxonomy verification (Firestore)\n");

  const sports = activeOnly(await getAll(COLLECTIONS.sports));
  const leagues = activeOnly(await getAll(COLLECTIONS.leagues));
  const entities = activeOnly(await getAll(COLLECTIONS.entities));
  const themes = activeOnly(await getAll(COLLECTIONS.themes));
  const designFamilies = activeOnly(await getAll(COLLECTIONS.design_families));

  console.log("--- Counts ---");
  console.log("  sports:         ", sports.length);
  console.log("  leagues:        ", leagues.length);
  console.log("  entities:       ", entities.length);
  console.log("  themes:         ", themes.length);
  console.log("  design_families:", designFamilies.length);

  const collegeEntities = entities.filter(
    (e) => e.leagueCode === "NCAA" && e.entityType === "college"
  );
  const expectedColleges = 361;
  const ncaaOk = collegeEntities.length === expectedColleges;
  console.log("\n--- NCAA D1 colleges ---");
  console.log("  expected:", expectedColleges, "  actual:", collegeEntities.length, ncaaOk ? "✅" : "❌");
  const sampleCodes = ["USC", "ALABAMA", "NOTRE_DAME", "OHIO_STATE", "TEXAS", "MICHIGAN", "LSU", "COLORADO"];
  const found = sampleCodes.filter((c) => collegeEntities.some((e) => e.code === c));
  const missing = sampleCodes.filter((c) => !collegeEntities.some((e) => e.code === c));
  console.log("  sample codes found:", found.join(", ") || "(none)");
  if (missing.length) console.log("  sample codes missing:", missing.join(", "));

  const olympicThemes = themes.filter((t) => t.sportCode === "OLYMPIC_SPORTS");
  const hasCurling = olympicThemes.some((t) => t.code === "OLYMPIC_CURLING");
  const olympicCodes = olympicThemes.map((t) => t.code).sort();
  console.log("\n--- Olympic themes (sportCode OLYMPIC_SPORTS) ---");
  console.log("  count:", olympicThemes.length, "  OLYMPIC_CURLING present:", hasCurling ? "✅" : "❌");
  console.log("  codes:", olympicCodes.join(", "));

  const leaguesCollege = sortByOrder(leagues.filter((l) => l.sportCode === "COLLEGE_SPORTS"));
  const leaguesOlympic = sortByOrder(leagues.filter((l) => l.sportCode === "OLYMPIC_SPORTS"));
  console.log("\n--- Leagues filter by sportCode (read-path check) ---");
  console.log("  sportCode=COLLEGE_SPORTS:", leaguesCollege.length, "→", leaguesCollege.map((l) => l.code).join(", "));
  console.log("  sportCode=OLYMPIC_SPORTS:", leaguesOlympic.length, "→", leaguesOlympic.map((l) => l.code).join(", "));

  const entitiesNCAA = sortByOrder(entities.filter((e) => e.leagueCode === "NCAA"));
  const entitiesMLB = sortByOrder(entities.filter((e) => e.leagueCode === "MLB"));
  console.log("\n--- Entities filter by leagueCode (read-path check) ---");
  console.log("  leagueCode=NCAA:", entitiesNCAA.length);
  console.log("  leagueCode=MLB:", entitiesMLB.length, "→", entitiesMLB.map((e) => e.code).join(", "));

  const themesOlympicFilter = sortByOrder(themes.filter((t) => t.sportCode === "OLYMPIC_SPORTS"));
  console.log("\n--- Themes filter by sportCode=OLYMPIC_SPORTS ---");
  console.log("  count:", themesOlympicFilter.length);

  const duplicateCodes = (coll, key = "code") => {
    const codes = coll.map((x) => x[key]).filter(Boolean);
    return codes.filter((c, i) => codes.indexOf(c) !== i);
  };
  const dupSports = duplicateCodes(sports);
  const dupLeagues = duplicateCodes(leagues);
  const dupEntities = duplicateCodes(entities);
  const dupThemes = duplicateCodes(themes);
  const dupDf = duplicateCodes(designFamilies);
  console.log("\n--- Duplicate codes ---");
  console.log("  sports:", dupSports.length ? dupSports.join(", ") : "none");
  console.log("  leagues:", dupLeagues.length ? dupLeagues.join(", ") : "none");
  console.log("  entities:", dupEntities.length ? [...new Set(dupEntities)].slice(0, 20).join(", ") + (dupEntities.length > 20 ? "..." : "") : "none");
  console.log("  themes:", dupThemes.length ? dupThemes.join(", ") : "none");
  console.log("  design_families:", dupDf.length ? dupDf.join(", ") : "none");

  const ok = ncaaOk && hasCurling && dupEntities.length === 0;
  console.log(ok ? "\n✅ Verification passed.\n" : "\n⚠️  Some checks failed (see above).\n");
  process.exit(ok ? 0 : 1);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
