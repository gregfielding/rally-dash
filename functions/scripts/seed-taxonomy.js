#!/usr/bin/env node

/**
 * Taxonomy seeder for Rally (per RALLY_TAXONOMY_SEEDER_SPEC.md).
 * Seeds: rp_taxonomy_sports, rp_taxonomy_leagues, rp_taxonomy_entities,
 *        rp_taxonomy_themes, rp_taxonomy_design_families.
 *
 * Idempotent: upsert by deterministic doc id (e.g. SPORT_BASEBALL, LEAGUE_MLB).
 *
 * Usage (from functions directory):
 *   npm run seed:taxonomy
 *   node scripts/seed-taxonomy.js
 *   node scripts/seed-taxonomy.js --dry-run
 *   node scripts/seed-taxonomy.js --only=sports
 *   node scripts/seed-taxonomy.js --only=leagues --dry-run
 *
 * Requires Firebase project (e.g. firebase use <projectId> or GOOGLE_APPLICATION_CREDENTIALS).
 * --dry-run still reads Firestore to report accurate would-create/update/skip counts; no writes.
 *
 * Options:
 *   --dry-run       No writes; report created/updated/skipped as if run.
 *   --only=COLL     Run only one collection: sports | leagues | entities | themes | design_families
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const { NCAA_D1_COLLEGES } = require("./data/ncaa-d1-colleges.js");

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

// --- CLI ---
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlyArg = argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.replace("--only=", "").trim().toLowerCase() : null;
const validOnly = ["sports", "leagues", "entities", "themes", "design_families"];
if (only && !validOnly.includes(only)) {
  console.error("Invalid --only. Use one of:", validOnly.join(" | "));
  process.exit(1);
}

function codeToSlug(code) {
  return String(code).toLowerCase().replace(/_/g, "-");
}

function codeToName(code) {
  return String(code)
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// --- Seed data ---

const SPORTS = [
  "BASEBALL",
  "FOOTBALL",
  "BASKETBALL",
  "HOCKEY",
  "SOCCER",
  "RACING",
  "GOLF",
  "TENNIS",
  "COLLEGE_SPORTS",
  "OLYMPIC_SPORTS",
  "GENERIC_SPORTS",
  "LIFESTYLE",
].map((code, i) => ({ code, name: codeToName(code), slug: codeToSlug(code), sortOrder: i }));

const LEAGUES = [
  { code: "MLB", sportCode: "BASEBALL", name: "Major League Baseball" },
  { code: "NFL", sportCode: "FOOTBALL", name: "National Football League" },
  { code: "NBA", sportCode: "BASKETBALL", name: "National Basketball Association" },
  { code: "NHL", sportCode: "HOCKEY", name: "National Hockey League" },
  { code: "MLS", sportCode: "SOCCER", name: "Major League Soccer" },
  { code: "PREMIER_LEAGUE", sportCode: "SOCCER", name: "Premier League" },
  { code: "NCAA", sportCode: "COLLEGE_SPORTS", name: "NCAA" },
  { code: "NASCAR", sportCode: "RACING", name: "NASCAR" },
  { code: "INDYCAR", sportCode: "RACING", name: "IndyCar" },
  { code: "F1", sportCode: "RACING", name: "Formula 1" },
  { code: "OLYMPICS", sportCode: "OLYMPIC_SPORTS", name: "Olympics" },
].map((row, i) => ({
  code: row.code,
  name: row.name,
  slug: codeToSlug(row.code),
  sportCode: row.sportCode,
  sortOrder: i,
}));

const ENTITIES = [
  // MLB
  { code: "GIANTS", name: "San Francisco Giants", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  { code: "DODGERS", name: "Los Angeles Dodgers", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  { code: "YANKEES", name: "New York Yankees", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  { code: "RED_SOX", name: "Boston Red Sox", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team", aliases: ["REDSOX"] },
  { code: "CUBS", name: "Chicago Cubs", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  { code: "PADRES", name: "San Diego Padres", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  { code: "METS", name: "New York Mets", leagueCode: "MLB", sportCode: "BASEBALL", entityType: "team" },
  // NBA
  { code: "LAKERS", name: "Los Angeles Lakers", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "CELTICS", name: "Boston Celtics", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "WARRIORS", name: "Golden State Warriors", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "BULLS", name: "Chicago Bulls", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "HEAT", name: "Miami Heat", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "KNICKS", name: "New York Knicks", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "SUNS", name: "Phoenix Suns", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "BUCKS", name: "Milwaukee Bucks", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "NUGGETS", name: "Denver Nuggets", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  { code: "MAVERICKS", name: "Dallas Mavericks", leagueCode: "NBA", sportCode: "BASKETBALL", entityType: "team" },
  // NFL
  { code: "COWBOYS", name: "Dallas Cowboys", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team" },
  { code: "FORTY_NINERS", name: "San Francisco 49ers", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team", aliases: ["49ERS", "NINERS"] },
  { code: "PACKERS", name: "Green Bay Packers", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team" },
  { code: "RAIDERS", name: "Las Vegas Raiders", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team" },
  { code: "CHIEFS", name: "Kansas City Chiefs", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team" },
  { code: "EAGLES", name: "Philadelphia Eagles", leagueCode: "NFL", sportCode: "FOOTBALL", entityType: "team" },
  // NCAA Division I colleges (all full members)
  ...NCAA_D1_COLLEGES.map(({ code, name }) => ({
    code,
    name,
    leagueCode: "NCAA",
    sportCode: "COLLEGE_SPORTS",
    entityType: "college",
  })),
  // Racing
  { code: "FERRARI", name: "Ferrari", leagueCode: "F1", sportCode: "RACING", entityType: "motorsport_team" },
  { code: "MCLAREN", name: "McLaren", leagueCode: "F1", sportCode: "RACING", entityType: "motorsport_team" },
  { code: "RED_BULL", name: "Red Bull Racing", leagueCode: "F1", sportCode: "RACING", entityType: "motorsport_team" },
  { code: "MERCEDES", name: "Mercedes-AMG", leagueCode: "F1", sportCode: "RACING", entityType: "motorsport_team" },
  // Soccer
  { code: "ARSENAL", name: "Arsenal", leagueCode: "PREMIER_LEAGUE", sportCode: "SOCCER", entityType: "club" },
  { code: "MANCHESTER_CITY", name: "Manchester City", leagueCode: "PREMIER_LEAGUE", sportCode: "SOCCER", entityType: "club" },
  { code: "LIVERPOOL", name: "Liverpool", leagueCode: "PREMIER_LEAGUE", sportCode: "SOCCER", entityType: "club" },
  { code: "LAFC", name: "LAFC", leagueCode: "MLS", sportCode: "SOCCER", entityType: "club" },
  { code: "INTER_MIAMI", name: "Inter Miami CF", leagueCode: "MLS", sportCode: "SOCCER", entityType: "club" },
].map((row, i) => ({
  code: row.code,
  name: row.name,
  slug: codeToSlug(row.code),
  sportCode: row.sportCode || null,
  leagueCode: row.leagueCode || null,
  entityType: row.entityType || "team",
  aliases: row.aliases || [],
  sortOrder: i,
}));

const THEMES = [
  { code: "GENERIC_BASEBALL", name: "Generic Baseball", sportCode: "BASEBALL", themeType: "generic_sport" },
  { code: "GENERIC_SOFTBALL", name: "Generic Softball", sportCode: "BASEBALL", themeType: "generic_sport" },
  { code: "FUNNY_BASEBALL", name: "Funny Baseball", sportCode: "BASEBALL", themeType: "humor" },
  { code: "FUNNY_FOOTBALL", name: "Funny Football", sportCode: "FOOTBALL", themeType: "humor" },
  { code: "GOLF_GIRL", name: "Golf Girl", sportCode: "GOLF", themeType: "lifestyle" },
  { code: "TAILGATE", name: "Tailgate", sportCode: null, leagueCode: null, themeType: "topical" },
  { code: "GAME_DAY", name: "Game Day", sportCode: null, leagueCode: null, themeType: "topical" },
  { code: "CHECKERED_FLAG", name: "Checkered Flag", sportCode: "RACING", themeType: "topical" },
  { code: "SPORTS_MOM", name: "Sports Mom", sportCode: "GENERIC_SPORTS", themeType: "lifestyle" },
  { code: "BEER_LEAGUE", name: "Beer League", sportCode: "GENERIC_SPORTS", themeType: "humor" },
  { code: "TRASH_TALK", name: "Trash Talk", sportCode: "GENERIC_SPORTS", themeType: "humor" },
  { code: "COUNTRY_CLUB", name: "Country Club", sportCode: "GOLF", themeType: "lifestyle" },
  { code: "BACHELORETTE", name: "Bachelorette", sportCode: "LIFESTYLE", themeType: "lifestyle" },
  { code: "RACE_DAY", name: "Race Day", sportCode: "RACING", themeType: "topical" },
  { code: "OPENING_DAY", name: "Opening Day", sportCode: "BASEBALL", themeType: "topical" },
  { code: "PLAYOFFS", name: "Playoffs", sportCode: null, leagueCode: null, themeType: "topical" },
  // Olympic (popular disciplines)
  { code: "OLYMPIC_SWIMMING", name: "Olympic Swimming", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_GYMNASTICS", name: "Olympic Gymnastics", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_ATHLETICS", name: "Olympic Track & Field", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_FIGURE_SKATING", name: "Olympic Figure Skating", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_SKIING", name: "Olympic Skiing", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_SNOWBOARDING", name: "Olympic Snowboarding", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_BASKETBALL", name: "Olympic Basketball", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_VOLLEYBALL", name: "Olympic Volleyball", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_CYCLING", name: "Olympic Cycling", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_TENNIS", name: "Olympic Tennis", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_DIVING", name: "Olympic Diving", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_SKATEBOARDING", name: "Olympic Skateboarding", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_SOCCER", name: "Olympic Soccer", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
  { code: "OLYMPIC_CURLING", name: "Olympic Curling", sportCode: "OLYMPIC_SPORTS", themeType: "topical" },
].map((row, i) => ({
  code: row.code,
  name: row.name,
  slug: codeToSlug(row.code),
  sportCode: row.sportCode || null,
  leagueCode: row.leagueCode || null,
  themeType: row.themeType || null,
  sortOrder: i,
}));

const DESIGN_FAMILIES = [
  "WILL_DROP_FOR",
  "HOME_RUN",
  "TEE_TIME",
  "FULL_THROTTLE",
  "GAME_DAY_GIRL",
  "PITCH_SLAP",
  "CHECKERED_FLAG_SERIES",
].map((code, i) => ({
  code,
  name: codeToName(code),
  slug: codeToSlug(code),
  sortOrder: i,
}));

// Deterministic doc ids (spec prefers these)
const PREFIX = {
  sports: "SPORT_",
  leagues: "LEAGUE_",
  entities: "ENTITY_",
  themes: "THEME_",
  design_families: "FAMILY_",
};

function docId(collection, code) {
  return PREFIX[collection] + code;
}

// --- Upsert helpers ---

function fieldsEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "createdAt" || k === "updatedAt") continue;
    if (!fieldsEqual(a[k], b[k])) return false;
  }
  return true;
}

async function upsertSport(colRef, row, now, stats, dryRun) {
  const id = docId("sports", row.code);
  const docRef = colRef.doc(id);
  const payload = {
    code: row.code,
    name: row.name,
    slug: row.slug,
    active: true,
    sortOrder: row.sortOrder,
    updatedAt: now,
  };

  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data();
    const updateData = { ...payload, createdAt: existing.createdAt };
    if (fieldsEqual(updateData, { ...existing, updatedAt: updateData.updatedAt })) {
      stats.skipped++;
      return;
    }
    if (!dryRun) await docRef.update(updateData);
    stats.updated++;
  } else {
    if (!dryRun) await docRef.set({ ...payload, createdAt: now });
    stats.created++;
  }
}

async function upsertLeague(colRef, row, now, stats, dryRun) {
  const id = docId("leagues", row.code);
  const docRef = colRef.doc(id);
  const payload = {
    code: row.code,
    name: row.name,
    slug: row.slug,
    sportCode: row.sportCode || null,
    active: true,
    sortOrder: row.sortOrder,
    updatedAt: now,
  };

  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data();
    const updateData = { ...payload, createdAt: existing.createdAt };
    if (fieldsEqual(updateData, { ...existing, updatedAt: updateData.updatedAt })) {
      stats.skipped++;
      return;
    }
    if (!dryRun) await docRef.update(updateData);
    stats.updated++;
  } else {
    if (!dryRun) await docRef.set({ ...payload, createdAt: now });
    stats.created++;
  }
}

async function upsertEntity(colRef, row, now, stats, dryRun) {
  const id = docId("entities", row.code);
  const docRef = colRef.doc(id);
  const payload = {
    code: row.code,
    name: row.name,
    slug: row.slug,
    sportCode: row.sportCode || null,
    leagueCode: row.leagueCode || null,
    entityType: row.entityType || "team",
    active: true,
    aliases: row.aliases && row.aliases.length ? row.aliases : null,
    sortOrder: row.sortOrder,
    updatedAt: now,
  };

  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data();
    const updateData = { ...payload, createdAt: existing.createdAt };
    if (fieldsEqual(updateData, { ...existing, updatedAt: updateData.updatedAt })) {
      stats.skipped++;
      return;
    }
    if (!dryRun) await docRef.update(updateData);
    stats.updated++;
  } else {
    if (!dryRun) await docRef.set({ ...payload, createdAt: now });
    stats.created++;
  }
}

async function upsertTheme(colRef, row, now, stats, dryRun) {
  const id = docId("themes", row.code);
  const docRef = colRef.doc(id);
  const payload = {
    code: row.code,
    name: row.name,
    slug: row.slug,
    sportCode: row.sportCode || null,
    leagueCode: row.leagueCode || null,
    active: true,
    themeType: row.themeType || null,
    sortOrder: row.sortOrder,
    updatedAt: now,
  };

  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data();
    const updateData = { ...payload, createdAt: existing.createdAt };
    if (fieldsEqual(updateData, { ...existing, updatedAt: updateData.updatedAt })) {
      stats.skipped++;
      return;
    }
    if (!dryRun) await docRef.update(updateData);
    stats.updated++;
  } else {
    if (!dryRun) await docRef.set({ ...payload, createdAt: now });
    stats.created++;
  }
}

async function upsertDesignFamily(colRef, row, now, stats, dryRun) {
  const id = docId("design_families", row.code);
  const docRef = colRef.doc(id);
  const payload = {
    code: row.code,
    name: row.name,
    slug: row.slug,
    active: true,
    sortOrder: row.sortOrder,
    updatedAt: now,
  };

  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data();
    const updateData = { ...payload, createdAt: existing.createdAt };
    if (fieldsEqual(updateData, { ...existing, updatedAt: updateData.updatedAt })) {
      stats.skipped++;
      return;
    }
    if (!dryRun) await docRef.update(updateData);
    stats.updated++;
  } else {
    if (!dryRun) await docRef.set({ ...payload, createdAt: now });
    stats.created++;
  }
}

// --- Run ---

async function run() {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const summary = {
    sports: { created: 0, updated: 0, skipped: 0 },
    leagues: { created: 0, updated: 0, skipped: 0 },
    entities: { created: 0, updated: 0, skipped: 0 },
    themes: { created: 0, updated: 0, skipped: 0 },
    design_families: { created: 0, updated: 0, skipped: 0 },
  };
  const collections = only ? [only] : ["sports", "leagues", "entities", "themes", "design_families"];

  console.log("\n🌱 Rally taxonomy seeder");
  if (dryRun) console.log("   (dry-run: no writes)\n");
  else console.log("");

  if (collections.includes("sports")) {
    console.log("Sports...");
    const colRef = db.collection("rp_taxonomy_sports");
    for (const row of SPORTS) {
      await upsertSport(colRef, row, now, summary.sports, dryRun);
    }
  }

  if (collections.includes("leagues")) {
    console.log("Leagues...");
    const colRef = db.collection("rp_taxonomy_leagues");
    for (const row of LEAGUES) {
      await upsertLeague(colRef, row, now, summary.leagues, dryRun);
    }
  }

  if (collections.includes("entities")) {
    console.log("Entities...");
    const colRef = db.collection("rp_taxonomy_entities");
    for (const row of ENTITIES) {
      await upsertEntity(colRef, row, now, summary.entities, dryRun);
    }
  }

  if (collections.includes("themes")) {
    console.log("Themes...");
    const colRef = db.collection("rp_taxonomy_themes");
    for (const row of THEMES) {
      await upsertTheme(colRef, row, now, summary.themes, dryRun);
    }
  }

  if (collections.includes("design_families")) {
    console.log("Design families...");
    const colRef = db.collection("rp_taxonomy_design_families");
    for (const row of DESIGN_FAMILIES) {
      await upsertDesignFamily(colRef, row, now, summary.design_families, dryRun);
    }
  }

  console.log("\n--- Summary ---");
  for (const coll of collections) {
    const s = summary[coll];
    console.log(`${coll}: created ${s.created}, updated ${s.updated}, skipped ${s.skipped}`);
  }
  console.log("");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  });
