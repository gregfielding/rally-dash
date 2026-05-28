#!/usr/bin/env node

/**
 * One-off patch for the SF Giants Pillows design + spawned panty product whose
 * themeCode/designFamily/themeName ended up as "GIANTS" / "giants" / "Giants"
 * instead of "PILLOWS" / "pillows" / "Pillows". Root cause: the old engine's
 * themeCode picker preferred inferred.themeSlugCandidate (positional, wrong
 * for LEAGUE_THEME_TEAM filenames) over parsed.designFamily (registry-aware,
 * correct). Code fix in the same commit; this script repairs the in-flight data.
 *
 * Usage (from functions/):
 *   GCLOUD_PROJECT=rally-dash node scripts/patch-sf-giants-pillows-theme.js --dry-run
 *   GCLOUD_PROJECT=rally-dash node scripts/patch-sf-giants-pillows-theme.js
 */

"use strict";

const admin = require("firebase-admin");

const DESIGN_ID = "0PrHjyUSVE7a390HDb4U";
const PRODUCT_ID = "LeUEBchNvyvKyCBAds46";

const DESIGN_PATCH = {
  themeCode: "PILLOWS",
  designFamily: "pillows",
  themeName: "Pillows",
};
const PRODUCT_PATCH = {
  themeCode: "PILLOWS",
  designFamily: "PILLOWS",
  themeName: "Pillows",
  name: "San Francisco Giants Pillows Panty",
  title: "San Francisco Giants Pillows Panty",
};

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE WRITES"}\n`);

  const designRef = db.collection("designs").doc(DESIGN_ID);
  const dsnap = await designRef.get();
  if (!dsnap.exists) {
    console.log(`design ${DESIGN_ID}: NOT FOUND`);
  } else {
    const d = dsnap.data() || {};
    console.log(`design ${DESIGN_ID}:`);
    console.log("  before:", JSON.stringify({ themeCode: d.themeCode, designFamily: d.designFamily, themeName: d.themeName, name: d.name }));
    console.log("  after :", JSON.stringify({ ...DESIGN_PATCH, name: d.name /* unchanged */ }));
    if (!dryRun) {
      await designRef.update({
        ...DESIGN_PATCH,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("  ✓ updated");
    }
  }

  console.log("");

  const prodRef = db.collection("rp_products").doc(PRODUCT_ID);
  const psnap = await prodRef.get();
  if (!psnap.exists) {
    console.log(`product ${PRODUCT_ID}: NOT FOUND`);
  } else {
    const p = psnap.data() || {};
    console.log(`product ${PRODUCT_ID}:`);
    console.log("  before:", JSON.stringify({ themeCode: p.themeCode, designFamily: p.designFamily, themeName: p.themeName, name: p.name }));
    console.log("  after :", JSON.stringify(PRODUCT_PATCH));
    if (!dryRun) {
      await prodRef.update({
        ...PRODUCT_PATCH,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("  ✓ updated");
    }
  }

  console.log(`\n${dryRun ? "Dry-run done." : "Patch complete."}`);
  console.log("Note: slug stays 'san-francisco-giants-custom-panty' to avoid breaking existing links.");
  console.log("If you want to rename the slug to 'san-francisco-giants-pillows-panty', that's a separate migration (Shopify handles need to be re-pushed).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
