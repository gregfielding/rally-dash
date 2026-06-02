#!/usr/bin/env node
"use strict";

/**
 * Phase F migration: merge the legacy `teams` collection into `design_teams`.
 *
 * Context (per RALLY_CORE_OBJECT_MODEL_AUDIT + Phase F audit 2026-06-01):
 *   - `teams`: legacy collection used only by /teams admin UI + useTeams hook.
 *     No cloud functions read it. No designs / products reference its doc ids.
 *   - `design_teams`: canonical source-of-truth. Used by every team picker in
 *     the design / blank / product pipelines. designs.teamId + rp_products.teamId
 *     both reference design_teams doc ids.
 *
 * Approach:
 *   - For each `teams` row, compute its canonical slug (matches design_teams id pattern).
 *   - If `design_teams/{slug}` exists: MERGE only the fields that don't already
 *     exist on the canonical doc. Never overwrite curated colors / catalog /
 *     generation defaults — those are operator-set on design_teams.
 *   - If absent: create a new design_teams doc with the legacy fields back-
 *     filled. Operator can add missing required fields (teamCode, leagueCode,
 *     teamColors) later via the /design-teams editor.
 *   - Stamp `migratedFrom: 'teams/{oldId}'` on the design_teams doc + a
 *     parallel `migratedTo: 'design_teams/{slug}'` on the legacy `teams` doc
 *     so the merge is auditable + idempotent (re-running won't double-write).
 *
 * Safety:
 *   - --dry-run: prints the plan, writes nothing.
 *   - The migration is idempotent: re-running after a partial failure
 *     resumes from where it left off (skips docs already stamped with migratedTo).
 *   - `teams` docs are NOT deleted by this script. After verification, delete
 *     them manually via Firestore admin or a separate --delete-legacy run.
 *
 * Usage:
 *   node scripts/migrate-teams-into-design-teams.js --dry-run
 *   node scripts/migrate-teams-into-design-teams.js
 *   node scripts/migrate-teams-into-design-teams.js --delete-legacy   # after verifying
 *
 * Requires Firebase credentials (GOOGLE_APPLICATION_CREDENTIALS env var, or
 * `firebase login` + `gcloud auth application-default login`).
 */

const admin = require("firebase-admin");
const {
  canonicalTeamSlugFromFullTeamName,
  canonicalTeamSlugFromCityAndNickname,
} = require("../lib/canonicalTeamSlug");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const DELETE_LEGACY = ARGS.includes("--delete-legacy");

/**
 * Derive the target design_teams slug from a legacy teams doc. Tries the
 * canonical full-name path first, then city+name fallback. Returns null if
 * we can't form a slug — those rows get reported in the summary so the
 * operator can fix them manually.
 */
function deriveCanonicalSlug(team) {
  const fromName = canonicalTeamSlugFromFullTeamName(team.name);
  if (fromName) return fromName;
  if (team.city && team.name) {
    /** Some legacy teams stored just the nickname in `name` (e.g. "Giants"). */
    return canonicalTeamSlugFromCityAndNickname(team.city, team.name);
  }
  return null;
}

/**
 * Field-by-field merge: write only the keys that don't already exist on the
 * target (so we never clobber curated design_teams data). Returns the
 * partial update object + a list of which fields would be added.
 */
function buildMergePatch(legacyTeam, existingDesignTeam) {
  const patch = {};
  const added = [];

  /**
   * The fields we attempt to carry over from `teams`. Many are speculative —
   * legacy teams docs are sparse — but the merge is conservative: empty/null
   * legacy values are skipped.
   */
  const candidates = [
    { src: "name", dst: "name" },
    { src: "city", dst: "city" },
    { src: "slug", dst: "slug" },
    { src: "leagueId", dst: "leagueId" },
    { src: "active", dst: "active" },
    { src: "keywords", dst: "keywords" },
    { src: "bannedTerms", dst: "bannedTerms" },
    { src: "notes", dst: "notes" },
  ];
  for (const { src, dst } of candidates) {
    const legacyVal = legacyTeam[src];
    if (legacyVal == null) continue;
    if (Array.isArray(legacyVal) && legacyVal.length === 0) continue;
    if (typeof legacyVal === "string" && legacyVal.trim().length === 0) continue;
    /** Already set on target — don't overwrite curated values. */
    if (existingDesignTeam && existingDesignTeam[dst] != null) {
      if (Array.isArray(existingDesignTeam[dst]) && existingDesignTeam[dst].length === 0) {
        /** Treat empty array on target as absence. */
      } else {
        continue;
      }
    }
    patch[dst] = legacyVal;
    added.push(dst);
  }

  /**
   * `teams.colors` (simple {primary, secondary, accent}) → fill into the
   * convenience fields if design_teams doesn't already have them. Don't
   * populate the rich teamColors array — that needs CMYK / Pantone values
   * the operator owns.
   */
  if (legacyTeam.colors && typeof legacyTeam.colors === "object") {
    if (legacyTeam.colors.primary && !(existingDesignTeam && existingDesignTeam.primaryColorHex)) {
      patch.primaryColorHex = legacyTeam.colors.primary;
      added.push("primaryColorHex");
    }
    if (legacyTeam.colors.secondary && !(existingDesignTeam && existingDesignTeam.secondaryColorHex)) {
      patch.secondaryColorHex = legacyTeam.colors.secondary;
      added.push("secondaryColorHex");
    }
  }

  return { patch, added };
}

async function migrate() {
  console.log(
    `[migrate-teams-into-design-teams] mode=${DRY_RUN ? "dry-run" : DELETE_LEGACY ? "delete-legacy" : "live"}`
  );

  if (DELETE_LEGACY) {
    /** Separate path: deletes only `teams` docs already stamped migratedTo. */
    return deleteLegacyTeams();
  }

  const teamsSnap = await db.collection("teams").get();
  console.log(`[migrate-teams-into-design-teams] Found ${teamsSnap.size} rows in teams/`);

  const summary = {
    total: teamsSnap.size,
    alreadyMigrated: 0,
    mergedIntoExisting: 0,
    createdNew: 0,
    unresolved: [],
    skipped: [],
    errors: [],
  };

  for (const doc of teamsSnap.docs) {
    const team = doc.data() || {};
    const legacyId = doc.id;

    /** Skip if previously migrated successfully (idempotent re-run). */
    if (team.migratedTo) {
      summary.alreadyMigrated++;
      console.log(`  [skip] ${legacyId}: already migrated to ${team.migratedTo}`);
      continue;
    }

    const slug = deriveCanonicalSlug(team);
    if (!slug) {
      summary.unresolved.push({
        legacyId,
        reason: "could not derive canonical slug (name too short, city missing, etc.)",
        teamData: { name: team.name, city: team.city, leagueId: team.leagueId },
      });
      console.log(`  [unresolved] ${legacyId}: name='${team.name || ""}' city='${team.city || ""}'`);
      continue;
    }

    const targetRef = db.collection("design_teams").doc(slug);
    const targetSnap = await targetRef.get();
    const existing = targetSnap.exists ? targetSnap.data() : null;

    const { patch, added } = buildMergePatch(team, existing);
    const migrationStamp = {
      migratedFrom: `teams/${legacyId}`,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (existing) {
      if (added.length === 0) {
        console.log(`  [merge-noop] ${legacyId} → design_teams/${slug} (nothing to add)`);
      } else {
        console.log(
          `  [merge] ${legacyId} → design_teams/${slug} adds: ${added.join(", ")}`
        );
      }
      if (!DRY_RUN) {
        await targetRef.set(
          { ...patch, ...migrationStamp, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await doc.ref.update({
          migratedTo: `design_teams/${slug}`,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      summary.mergedIntoExisting++;
    } else {
      /** New row: ALL legacy fields land. Operator fills in required fields (teamCode, etc.) later. */
      const newDoc = {
        id: slug,
        name: team.name,
        ...patch,
        ...migrationStamp,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      console.log(`  [create] ${legacyId} → design_teams/${slug} (new doc, fields: ${Object.keys(newDoc).join(", ")})`);
      if (!DRY_RUN) {
        await targetRef.set(newDoc, { merge: true });
        await doc.ref.update({
          migratedTo: `design_teams/${slug}`,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      summary.createdNew++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total teams rows: ${summary.total}`);
  console.log(`Already migrated (skipped):     ${summary.alreadyMigrated}`);
  console.log(`Merged into existing design_teams: ${summary.mergedIntoExisting}`);
  console.log(`Created new design_teams docs:  ${summary.createdNew}`);
  console.log(`Unresolved (manual review):     ${summary.unresolved.length}`);
  if (summary.unresolved.length > 0) {
    console.log("\nUnresolved rows:");
    for (const u of summary.unresolved) {
      console.log(`  - teams/${u.legacyId}: ${u.reason}`);
      console.log(`    data: ${JSON.stringify(u.teamData)}`);
    }
  }
  if (DRY_RUN) {
    console.log("\n(dry-run — no writes performed)");
  } else {
    console.log("\nNext: verify via /design-teams UI, then run with --delete-legacy to remove migrated `teams` rows.");
  }
}

async function deleteLegacyTeams() {
  const snap = await db
    .collection("teams")
    .where("migratedTo", "!=", null)
    .get();
  console.log(`Found ${snap.size} migrated teams rows ready for deletion`);
  let deleted = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!data.migratedTo) continue;
    console.log(`  [delete] teams/${doc.id} (migrated to ${data.migratedTo})`);
    if (!DRY_RUN) {
      await doc.ref.delete();
      deleted++;
    }
  }
  console.log(`\nDeleted ${deleted} legacy teams rows.`);
  if (DRY_RUN) console.log("(dry-run — no deletes performed)");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
