#!/usr/bin/env node
/**
 * One-off (idempotent) data fix: backfill Shopify-push-required fields on the
 * TR3008 Tri-Blend Racerback Tank blank doc. Sibling to the other patch-*-
 * shopify-defaults scripts in this folder — same shape, tank-specific voice +
 * pricing + weight.
 *
 * Usage (from functions/):
 *   node scripts/patch-tank-shopify-defaults.js --dry-run
 *   node scripts/patch-tank-shopify-defaults.js
 *   node scripts/patch-tank-shopify-defaults.js --force
 *   node scripts/patch-tank-shopify-defaults.js --style-code=TR3008
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
const force = process.argv.includes("--force");
const styleCode = parseFlag("style-code", "TR3008");

/**
 * TR3008 Tri-Blend Racerback Tank description template (2026-05-25). Matches
 * Greg's sample copy exactly, with the team-specific hype line templated via
 * `{teamSaying}` (e.g. "Let's Geaux!" for LSU) so each team's voice carries
 * through. Other tokens via resolveBlankTemplates.js:
 *   {teamSaying} → e.g. "Let's Geaux!" (optional; resolves to "" if not set)
 *   {teamName}   → e.g. "LSU Tigers"
 *
 * Note: the original sample also said "Rock your Tiger support" — that
 * mascot-specific phrasing would need a {teamMascot} token (not in the
 * resolver today). Using "{teamName} support" works for any team without
 * hardcoding example mascots; LSU products will read "Rock your LSU Tigers
 * support" which is still natural.
 */
const TANK_DESCRIPTION_TEMPLATE =
  "<p>{teamSaying} Rock your <strong>{teamName}</strong> support in your new favorite tank.</p>" +
  "<p>This nostalgic tank top is made of our original Tri-Blend yarn and features low cut armholes, a narrow racerback design and overlock-finished edges for a barely-there feeling on. Perfect for lounging and jogging.</p>" +
  "<p>Our Tri-Blend is composed of 50% Polyester / 25% Cotton / 25% Rayon. The polyester gives the garment shape and elasticity; the cotton adds comfort and durability; the rayon makes for a soft texture and fitted look.</p>" +
  "<ul>" +
  "<li>Machine Washable</li>" +
  "<li>Made in USA</li>" +
  "<li>All sales final. No returns or exchanges allowed.</li>" +
  "</ul>";

/**
 * Shopify defaults — `Tank Top` productType gives Shopify smart collections
 * a clean way to group tanks separately from sweatshirts (Sweatshirt) and
 * intimates (Underwear).
 */
const TANK_SHOPIFY_DEFAULTS = {
  productType: "Tank Top",
  brand: "Rally Panties",
  productCategory: null,
  collectionHandles: null,
  sizeOptionName: "Size",
};

/** Tank pricing per Greg (2026-05-25): $25 USD retail. */
const TANK_DEFAULT_PRICING = {
  retailPrice: 25,
  cost: null,
  currencyCode: "USD",
};

/**
 * TR3008 shipping weight (placeholder — Greg to confirm). 120g is typical for
 * a tri-blend racerback tank (LA Apparel TR3008 is ~3.8 oz garment-weight
 * fabric, ≈108g; rounded up to account for tagging/finishing). Verify against
 * LA Apparel spec sheet before relying on this for shipping rate calculation.
 */
const TANK_DEFAULT_SHIPPING = {
  defaultWeightGrams: 120,
  requiresShipping: true,
};

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

async function main() {
  console.log(`[patch-tank] Looking up blank with styleCode="${styleCode}"…`);
  /**
   * v2 (2026-05-25): filter to the ACTIVE MASTER (schemaVersion=2, status=active).
   * Earlier version used just `.where("styleCode", "==", styleCode).limit(1)`
   * which grabbed whichever doc Firestore returned first — often a draft
   * duplicate, not the master. Result: the patches wrote to non-master docs
   * and the real master never got the description template.
   */
  const snapshot = await db
    .collection("rp_blanks")
    .where("styleCode", "==", styleCode)
    .where("status", "==", "active")
    .where("schemaVersion", "==", 2)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(`[fatal] No blank found with styleCode="${styleCode}"`);
    process.exit(1);
  }

  const blankDoc = snapshot.docs[0];
  const blankData = blankDoc.data();
  console.log(`[patch-tank] Found blank id=${blankDoc.id} styleName="${blankData.styleName}"`);
  console.log("");

  const patch = {};
  const beforeAfter = [];

  const currentDesc = blankData.descriptionTemplate;
  if (isEmpty(currentDesc) || force) {
    patch.descriptionTemplate = TANK_DESCRIPTION_TEMPLATE;
    beforeAfter.push({
      field: "descriptionTemplate",
      before: currentDesc ?? "(unset)",
      after: TANK_DESCRIPTION_TEMPLATE.slice(0, 100) + "…",
    });
  } else {
    beforeAfter.push({
      field: "descriptionTemplate",
      before: (currentDesc || "").slice(0, 100) + "…",
      after: "(unchanged — already set; use --force to overwrite)",
    });
  }

  const currentShopify = blankData.shopifyDefaults;
  if (isEmpty(currentShopify) || force) {
    patch.shopifyDefaults = TANK_SHOPIFY_DEFAULTS;
    beforeAfter.push({
      field: "shopifyDefaults",
      before: JSON.stringify(currentShopify ?? null),
      after: JSON.stringify(TANK_SHOPIFY_DEFAULTS),
    });
  } else {
    const merged = { ...TANK_SHOPIFY_DEFAULTS, ...currentShopify };
    const mergedChanged = JSON.stringify(merged) !== JSON.stringify(currentShopify);
    if (mergedChanged) {
      patch.shopifyDefaults = merged;
      beforeAfter.push({
        field: "shopifyDefaults (merge)",
        before: JSON.stringify(currentShopify),
        after: JSON.stringify(merged),
      });
    } else {
      beforeAfter.push({
        field: "shopifyDefaults",
        before: JSON.stringify(currentShopify),
        after: "(unchanged — all keys present)",
      });
    }
  }

  const currentPricing = blankData.defaultPricing;
  if (isEmpty(currentPricing) || force) {
    patch.defaultPricing = TANK_DEFAULT_PRICING;
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing ?? null),
      after: JSON.stringify(TANK_DEFAULT_PRICING),
    });
  } else {
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  const currentShipping = blankData.defaultShipping;
  if (isEmpty(currentShipping) || force) {
    patch.defaultShipping = TANK_DEFAULT_SHIPPING;
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping ?? null),
      after: JSON.stringify(TANK_DEFAULT_SHIPPING),
    });
  } else {
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  console.log("┌─────────────────────────────────────────────────────────────────");
  console.log("│ TR3008 Tri-Blend Tank blank patch — diff summary");
  console.log("└─────────────────────────────────────────────────────────────────");
  for (const ba of beforeAfter) {
    console.log(`\n  ${ba.field}:`);
    console.log(`    before: ${ba.before}`);
    console.log(`    after:  ${ba.after}`);
  }
  console.log("");

  if (Object.keys(patch).length === 0) {
    console.log("[patch-tank] No changes needed (all fields already set). Run with --force to overwrite.");
    return;
  }

  if (dryRun) {
    console.log(`[patch-tank] DRY-RUN — would write ${Object.keys(patch).length} field(s) to rp_blanks/${blankDoc.id}`);
    console.log("[patch-tank] Re-run without --dry-run to apply.");
    return;
  }

  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await blankDoc.ref.update(patch);
  console.log(`[patch-tank] ✓ Wrote ${Object.keys(patch).length - 1} field(s) to rp_blanks/${blankDoc.id}`);
  console.log("[patch-tank] Verify in the editor / Firestore console.");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
