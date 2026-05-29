#!/usr/bin/env node

/**
 * Per-blank pipeline-readiness audit. For each registered blank (per
 * pipelineReadiness.js), reports what's already in Firestore and what's still
 * missing before it can be flipped to `pipelineReady: true` and successfully
 * render mockups.
 *
 * Things it checks:
 *   - Master blank doc exists at status=active + schemaVersion=2
 *   - Variants have non-zero `front` / `back` photo URLs
 *   - Per-variant masks exist in rp_blank_masks
 *   - Placements are configured
 *   - Scene presets reference this styleCode (best-effort heuristic)
 *
 * Usage (from functions/):
 *   GCLOUD_PROJECT=rally-dash node scripts/blank-pipeline-readiness-audit.js
 */

"use strict";

const admin = require("firebase-admin");
const { PIPELINE_CONFIG_BY_STYLE_CODE } = require("../lib/pipelineReadiness");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function pass(label) {
  return `  ✓ ${label}`;
}
function fail(label, note) {
  return `  ✗ ${label}${note ? ` — ${note}` : ""}`;
}
function warn(label, note) {
  return `  ! ${label}${note ? ` — ${note}` : ""}`;
}

async function auditOne(styleCode, cfg) {
  console.log(`\n=== ${styleCode}  (${cfg.displayName})  ${cfg.pipelineReady ? "[READY]" : "[NOT READY]"} ===`);

  /** Find the active master blank for this style code. */
  const snap = await db
    .collection("rp_blanks")
    .where("status", "==", "active")
    .get();
  const masters = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter(
      (b) =>
        Number(b.data.schemaVersion) === 2 &&
        String(b.data.styleCode || "").trim() === styleCode
    );

  if (masters.length === 0) {
    console.log(fail("master blank doc (status=active + schemaVersion=2)"));
    return;
  }
  if (masters.length > 1) {
    console.log(warn(`multiple master docs (${masters.length})`, "expected exactly 1"));
  }
  const blank = masters[0];
  console.log(pass(`master blank rp_blanks/${blank.id}`));

  /** Variants + photo coverage. */
  const variants = Array.isArray(blank.data.variants) ? blank.data.variants : [];
  const activeVariants = variants.filter((v) => v && v.isActive !== false);
  if (activeVariants.length === 0) {
    console.log(fail("at least 1 active variant"));
  } else {
    console.log(pass(`${activeVariants.length} active variants`));
  }

  /** Front + back photo URLs (loose check: any non-empty in the variant blob). */
  let withFront = 0;
  let withBack = 0;
  for (const v of activeVariants) {
    const blob = JSON.stringify(v).toLowerCase();
    if (blob.includes("front") && blob.includes("downloadurl")) withFront++;
    if (blob.includes("back") && blob.includes("downloadurl")) withBack++;
  }
  if (cfg.supportedSides.includes("front")) {
    console.log(
      withFront === activeVariants.length
        ? pass(`front photos on all ${activeVariants.length} variants`)
        : warn(
            `front photos on ${withFront}/${activeVariants.length} variants`,
            "renderer needs front photo per color"
          )
    );
  }
  if (cfg.supportedSides.includes("back")) {
    console.log(
      withBack === activeVariants.length
        ? pass(`back photos on all ${activeVariants.length} variants`)
        : warn(
            `back photos on ${withBack}/${activeVariants.length} variants`,
            "renderer needs back photo per color"
          )
    );
  }

  /** Placements configured on the blank? */
  const placements = Array.isArray(blank.data.placements) ? blank.data.placements : [];
  if (placements.length === 0) {
    console.log(fail("placements[] on blank doc", "renderer needs at least one placement zone"));
  } else {
    console.log(pass(`${placements.length} placement(s) configured`));
  }

  /** Masks in rp_blank_masks subcollection? */
  if (cfg.requiresMask) {
    const masksSnap = await db.collection("rp_blanks").doc(blank.id).collection("rp_blank_masks").get();
    if (masksSnap.empty) {
      console.log(fail("any mask in rp_blank_masks", "generate via the Blanks editor (AI mask button)"));
    } else {
      console.log(pass(`${masksSnap.size} mask(s) in rp_blank_masks`));
    }
  }

  /** Scene presets referencing this style — heuristic. */
  const presetsSnap = await db.collection("rp_scene_presets").get();
  const matchingPresets = presetsSnap.docs.filter((d) => {
    const blob = JSON.stringify(d.data() || {}).toLowerCase();
    return blob.includes(styleCode.toLowerCase());
  });
  console.log(
    matchingPresets.length > 0
      ? pass(`${matchingPresets.length} rp_scene_preset(s) reference styleCode "${styleCode}"`)
      : warn(`no rp_scene_preset references styleCode "${styleCode}"`, "scene composites will fall back / fail")
  );

  /** Per-blank code gaps documented in the registry. */
  if (cfg.blockingGaps) {
    console.log(`  ! code/data gaps: ${cfg.blockingGaps}`);
  }

  /** Render flags. */
  console.log(
    `  · requiresWarp=${cfg.requiresWarp}  requiresMask=${cfg.requiresMask}  supportedSides=[${cfg.supportedSides.join(",")}]`
  );
}

async function main() {
  console.log("Blank pipeline-readiness audit (functions/lib/pipelineReadiness.js)\n");
  for (const styleCode of Object.keys(PIPELINE_CONFIG_BY_STYLE_CODE)) {
    await auditOne(styleCode, PIPELINE_CONFIG_BY_STYLE_CODE[styleCode]);
  }
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
