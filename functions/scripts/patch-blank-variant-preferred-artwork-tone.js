#!/usr/bin/env node
/**
 * One-off (idempotent) data fix: set `preferredArtworkTone` on a single color variant
 * inside an `rp_blanks/{blankId}.variants[]` array.
 *
 * Defaults below patch the 8394 Bikini Panty (`fAHbUEeLBWiou0qS9RAW`) so that the
 * Pink variant uses the design's `whitePng` raster (instead of the default `lightPng`
 * that the light-family fallback chain would otherwise pick).
 *
 * Usage (from functions/):
 *   node scripts/patch-blank-variant-preferred-artwork-tone.js
 *   node scripts/patch-blank-variant-preferred-artwork-tone.js --dry-run
 *   node scripts/patch-blank-variant-preferred-artwork-tone.js \
 *     --blank-id=fAHbUEeLBWiou0qS9RAW --color-name=Pink --tone=white
 *
 * Requires Firebase admin credentials (same as the other scripts in this folder).
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

function parseFlag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const blankId = parseFlag("blank-id", "fAHbUEeLBWiou0qS9RAW");
const targetColorRaw = parseFlag("color-name", "Pink");
const tone = parseFlag("tone", "white");

const ALLOWED_TONES = new Set(["light", "dark", "white"]);
if (!ALLOWED_TONES.has(tone)) {
  console.error(`[fatal] invalid --tone="${tone}" (must be light | dark | white)`);
  process.exit(2);
}

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

async function main() {
  const ref = db.collection("rp_blanks").doc(blankId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`[fatal] rp_blanks/${blankId} does not exist`);
    process.exit(1);
  }
  const data = snap.data() || {};
  const variants = Array.isArray(data.variants) ? data.variants.slice() : [];
  if (!variants.length) {
    console.error(`[fatal] rp_blanks/${blankId} has no variants[] (schemaVersion ${data.schemaVersion ?? "?"})`);
    process.exit(1);
  }

  const idx = variants.findIndex((v) => norm(v?.colorName) === norm(targetColorRaw));
  if (idx < 0) {
    console.error(
      `[fatal] no variant with colorName="${targetColorRaw}" found on rp_blanks/${blankId}.\n` +
        `available: ${variants.map((v) => v?.colorName ?? "?").join(", ")}`
    );
    process.exit(1);
  }

  const before = variants[idx];
  const beforeTone = before?.preferredArtworkTone ?? null;
  if (beforeTone === tone) {
    console.log(
      `[noop] rp_blanks/${blankId}.variants[${idx}] (${before.colorName}) already has preferredArtworkTone="${tone}" — nothing to do.`
    );
    return;
  }

  const after = { ...before, preferredArtworkTone: tone };
  const nextVariants = variants.slice();
  nextVariants[idx] = after;

  console.log(`[patch] rp_blanks/${blankId}.variants[${idx}] (${before.colorName}):`, {
    blankVariantId: before.variantId ?? null,
    preferredArtworkTone: { before: beforeTone, after: tone },
  });

  if (dryRun) {
    console.log("[dry-run] no writes performed");
    return;
  }

  await ref.update({
    variants: nextVariants,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`[done] rp_blanks/${blankId} updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
