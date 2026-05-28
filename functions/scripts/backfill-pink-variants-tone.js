#!/usr/bin/env node

/**
 * Backfill: set `preferredArtworkTone="white"` on every blank variant whose
 * colorName matches the pink-family rule. Companion to the global
 * color-name → tone map in lib/blanks/colorTonePreferences.ts. Idempotent.
 *
 * Why both code rule + data backfill:
 *   - The code rule covers callers that pass `colorName` into the resolver
 *     (current + future).
 *   - The backfill covers callers that pass only the variant's explicit
 *     `preferredArtworkTone` without colorName, AND makes the intent visible
 *     in Firestore (operators see why pink variants prefer white).
 *
 * Usage (from functions/):
 *   GCLOUD_PROJECT=rally-dash node scripts/backfill-pink-variants-tone.js --dry-run
 *   GCLOUD_PROJECT=rally-dash node scripts/backfill-pink-variants-tone.js
 */

"use strict";

const admin = require("firebase-admin");
const { colorNameToPreferredTone } = require("../lib/colorTonePreferences");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE WRITES"}\n`);

  const snap = await db.collection("rp_blanks").get();
  console.log(`Scanning ${snap.size} blanks for variants matching the color-name rule…\n`);

  let blanksTouched = 0;
  let variantsPatched = 0;
  let variantsAlreadyCorrect = 0;
  let variantsWithExplicitOverride = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const variants = Array.isArray(data.variants) ? data.variants : [];
    if (variants.length === 0) continue;

    const nextVariants = variants.slice();
    let mutated = false;

    for (let i = 0; i < nextVariants.length; i++) {
      const v = nextVariants[i] || {};
      const colorName = v.colorName || null;
      const ruleTone = colorNameToPreferredTone(colorName);
      if (!ruleTone) continue;

      const existing = v.preferredArtworkTone;
      if (existing === ruleTone) {
        variantsAlreadyCorrect++;
        continue;
      }
      if (existing === "light" || existing === "dark" || existing === "white") {
        // Operator already chose a different tone. Respect it; the rule is a
        // default, not a force.
        variantsWithExplicitOverride++;
        console.log(
          `[skip-override] blanks/${doc.id} variants[${i}] colorName="${colorName}" already has explicit preferredArtworkTone="${existing}" — leaving as-is`
        );
        continue;
      }

      console.log(
        `[patch] blanks/${doc.id} (style ${data.styleCode}) variants[${i}] colorName="${colorName}" → preferredArtworkTone="${ruleTone}"`
      );
      nextVariants[i] = { ...v, preferredArtworkTone: ruleTone };
      mutated = true;
      variantsPatched++;
    }

    if (mutated) {
      blanksTouched++;
      if (!dryRun) {
        await doc.ref.update({
          variants: nextVariants,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  console.log("");
  console.log("Summary:");
  console.log(`  blanks touched:               ${blanksTouched}`);
  console.log(`  variants patched:             ${variantsPatched}`);
  console.log(`  variants already correct:     ${variantsAlreadyCorrect}`);
  console.log(`  variants with operator override (skipped): ${variantsWithExplicitOverride}`);
  console.log("");
  console.log(dryRun ? "Dry-run complete." : "Backfill complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
