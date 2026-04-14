#!/usr/bin/env node
/**
 * One-off migration: City 69 designs that were saved as custom_one_off / duplicate titles.
 *
 * Matches ANY of:
 * 1) importKey like `mlb_baltimore_orioles_69` (trailing `69`, not `…_city_69`)
 * 2) Duplicate title: "Baltimore Orioles Baltimore Orioles"
 * 3) Name already contains "City 69" but designType !== city_69 (e.g. Yankees row)
 * 4) slug ends with `-69` and designType !== city_69
 *
 * Usage (Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/migrate-city69-theme.js
 *   node scripts/migrate-city69-theme.js --verbose --sample
 *   node scripts/migrate-city69-theme.js --apply
 *
 * npm: npm run migrate:city69 -- --apply
 *      npm run migrate:city69 -- --sample
 * (Do not paste shell comments after the command; zsh may error on `#`.)
 *
 * Requires: firebase-admin from functions/node_modules.
 */

const fs = require("fs");
const path = require("path");

/** Load `.env.local` so `NEXT_PUBLIC_*` matches what Next.js uses (Node does not load it by default). */
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvLocal();

let admin;
try {
  admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));
} catch {
  console.error("Install dependencies in functions/ first: cd functions && npm install");
  process.exit(1);
}

const defaultProjectFromFirebaserc = (() => {
  try {
    const rc = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", ".firebaserc"), "utf8")
    );
    return rc?.projects?.default || null;
  } catch {
    return null;
  }
})();

const firestoreProjectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  defaultProjectFromFirebaserc;

if (!admin.apps.length) {
  if (!firestoreProjectId) {
    console.error(
      "Set NEXT_PUBLIC_FIREBASE_PROJECT_ID (e.g. in .env.local) or GOOGLE_CLOUD_PROJECT so this script hits the same Firestore as the app."
    );
    process.exit(1);
  }
  admin.initializeApp({ projectId: firestoreProjectId });
}

const db = admin.firestore();

function needsCity69Migration(data) {
  if (data.designType === "city_69") return false;

  const ik = data.importKey;
  if (ik && typeof ik === "string") {
    const t = ik.split("_").filter(Boolean);
    if (t.length >= 3 && t[t.length - 1] === "69") {
      if (!(t.length >= 2 && t[t.length - 2].toLowerCase() === "city")) {
        return true;
      }
    }
  }

  const name = (data.name && String(data.name).trim()) || "";
  // "Team Name Team Name" (full phrase duplicated once)
  if (name && /^(.+)\s+\1$/i.test(name)) {
    return true;
  }
  if (name && /city\s*69/i.test(name)) {
    return true;
  }

  const slug = (data.slug && String(data.slug).toLowerCase()) || "";
  if (slug && /-69$/.test(slug)) {
    return true;
  }

  return false;
}

function suggestedName(data) {
  const name = (data.name && String(data.name).trim()) || "";
  const dup = /^(.+)\s+\1$/i.exec(name);
  if (dup) {
    return `${dup[1].trim()} City 69`.trim();
  }
  if (name && /city\s*69/i.test(name)) {
    return name;
  }
  const team = (data.teamNameCache && String(data.teamNameCache).trim()) || "";
  if (team) return `${team} City 69`.trim();
  if (name && !/city\s*69/i.test(name)) return `${name} City 69`.trim();
  return name || null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verbose = process.argv.includes("--verbose");
  const sample = process.argv.includes("--sample");

  console.log(
    `[info] Firestore projectId: ${firestoreProjectId} (same source as Next: NEXT_PUBLIC_FIREBASE_PROJECT_ID / .firebaserc default)`
  );

  const snap = await db.collection("designs").get();
  let would = 0;
  let updated = 0;

  let noImportKey = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.importKey) noImportKey += 1;
  }
  console.log(
    `[info] Total designs in collection "designs": ${snap.size}, without importKey: ${noImportKey}`
  );

  if (sample && snap.docs.length) {
    const n = Math.min(12, snap.docs.length);
    console.log(`[sample] First ${n} document(s) (id, designType, name, importKey, slug):`);
    for (let i = 0; i < n; i++) {
      const doc = snap.docs[i];
      const d = doc.data();
      console.log(
        " ",
        doc.id,
        "|",
        d.designType ?? "(no designType)",
        "|",
        JSON.stringify(d.name ?? ""),
        "|",
        d.importKey ?? "(none)",
        "|",
        d.slug ?? "(none)"
      );
    }
  }

  if (snap.size === 0) {
    console.log(
      "[hint] Collection is empty. Wrong project/credentials, or designs live elsewhere."
    );
  }

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!needsCity69Migration(data)) continue;

    would += 1;
    const patch = {
      designType: "city_69",
      designSeries: "69",
      themeCode: "CITY_69",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const name = suggestedName(data);
    if (name) patch.name = name;

    console.log(
      apply ? "[APPLY]" : "[DRY]",
      doc.id,
      "name=",
      JSON.stringify(data.name),
      "importKey=",
      data.importKey ?? "(none)",
      "slug=",
      data.slug ?? "(none)",
      "→",
      JSON.stringify({ ...patch, updatedAt: "(serverTimestamp)" })
    );

    if (apply) {
      await doc.ref.update(patch);
      updated += 1;
    }
  }

  console.log(
    apply
      ? `Done. Updated ${updated} design(s).`
      : `Dry-run complete. ${would} design(s) would be updated. Run: npm run migrate:city69 -- --apply`
  );

  if (!apply && would === 0 && snap.size > 0) {
    console.log(
      "[hint] Nothing matched. Often: designType is already city_69, or names/slugs differ from migration rules. Use --sample to inspect stored fields."
    );
  }
  if (apply && updated === 0 && snap.size > 0) {
    console.log(
      "[hint] 0 updates with a non-empty collection: matchers may not fit your data, or themes are already city_69. Try dry-run without --apply and add --sample."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
