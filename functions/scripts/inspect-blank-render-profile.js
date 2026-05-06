#!/usr/bin/env node
/**
 * Read-only diagnostic: dump RPBlank.renderProfile (renderTargets + renderTargetsByColor)
 * plus the legacy variant.renderTargetOverrides slice for one variant. Used to debug
 * "Fabric Feel / Print Strength save but revert" symptom on the blank render profile editor.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=rally-dash node scripts/inspect-blank-render-profile.js \
 *     --blank-id=<id> [--color-name=Pink|Black] [--variant-id=<vid>] [--target=flat_back]
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
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

async function main() {
  const blankId = parseFlag("blank-id", null);
  if (!blankId) {
    console.error("Missing --blank-id");
    process.exit(1);
  }
  const variantIdArg = parseFlag("variant-id", null);
  const colorName = parseFlag("color-name", null);
  const targetFilter = parseFlag("target", null);

  const ref = db.collection("rp_blanks").doc(blankId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`rp_blanks/${blankId} does not exist`);
    process.exit(1);
  }
  const b = snap.data() ?? {};

  console.log("=".repeat(80));
  console.log(`Blank: ${blankId} (${b.styleCode ?? "?"} ${b.styleName ?? ""})`);
  console.log(`updatedAt: ${b.updatedAt?.toDate?.()?.toISOString?.() ?? b.updatedAt ?? "?"}`);

  const rp = b.renderProfile ?? {};
  console.log("\n[renderProfile.renderTargets]");
  console.log(JSON.stringify(rp.renderTargets ?? {}, null, 2));

  console.log("\n[renderProfile.renderTargetsByColor — variant ids]");
  const byColor = rp.renderTargetsByColor ?? {};
  console.log(Object.keys(byColor));

  const variants = Array.isArray(b.variants) ? b.variants : [];
  let targetVariant = null;
  if (variantIdArg) {
    targetVariant = variants.find((v) => v?.variantId === variantIdArg) ?? null;
  } else if (colorName) {
    const norm = String(colorName).toLowerCase().trim();
    targetVariant = variants.find((v) => String(v?.colorName ?? "").toLowerCase().trim() === norm) ?? null;
  }

  if (targetVariant) {
    const vid = targetVariant.variantId;
    console.log(`\n=== Variant: ${targetVariant.colorName} (${vid}) ===`);
    console.log("colorFamily:", targetVariant.colorFamily ?? null);
    console.log("preferredArtworkTone:", targetVariant.preferredArtworkTone ?? null);

    console.log(`\n[renderTargetsByColor[${vid}]]`);
    const cell = byColor[vid] ?? null;
    if (!cell) {
      console.log("(NO MATRIX CELL FOR THIS VARIANT)");
    } else {
      const keys = targetFilter ? [targetFilter] : Object.keys(cell);
      for (const k of keys) {
        console.log(`  ${k}:`, JSON.stringify(cell[k] ?? null, null, 2));
      }
    }

    console.log("\n[variant.renderTargetOverrides] (legacy)");
    console.log(JSON.stringify(targetVariant.renderTargetOverrides ?? null, null, 2));

    console.log("\n[variant.renderOverrides] (legacy global)");
    console.log(JSON.stringify(targetVariant.renderOverrides ?? null, null, 2));
  } else {
    console.log("\n(No variant selected. Listing all variant ids + names:)");
    for (const v of variants) {
      console.log(
        `  ${v?.variantId} | ${v?.colorName} | colorFamily=${v?.colorFamily ?? "?"} | preferredArtworkTone=${v?.preferredArtworkTone ?? "(none)"}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
