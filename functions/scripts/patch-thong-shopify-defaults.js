#!/usr/bin/env node
/**
 * One-off (idempotent) data fix: backfill Shopify-push-required fields on the
 * 8390 Thong Panty blank doc. Same shape as patch-hf07-shopify-defaults.js
 * but with thong-appropriate copy + pricing + weight.
 *
 * Per the HF07 audit + the 8390 live-doc check (2026-05-25), every panty /
 * thong product was hitting the hardcoded "Soft, breathable low-rise panty…"
 * fallback in `merchandisingAtCreate.buildStorefrontSeoDescription()` because
 * the blank doc had no `descriptionTemplate`. This script writes the missing
 * fields so launched products get real per-garment copy + pricing + weight.
 *
 * Usage (from functions/):
 *   node scripts/patch-thong-shopify-defaults.js --dry-run
 *   node scripts/patch-thong-shopify-defaults.js
 *   node scripts/patch-thong-shopify-defaults.js --force
 *   node scripts/patch-thong-shopify-defaults.js --style-code=8390
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
const styleCode = parseFlag("style-code", "8390");

/**
 * Thong description template (2026-05-25) — matches Greg's actual sample
 * copy verbatim, just templated. Structure: team-specific tagline → product
 * description (LA Apparel-derived) → care/origin bullets → material breakdown
 * with Heather Grey variant note.
 *
 * `{teamName}` resolves to the short team name (e.g. "Michigan") — the resolver
 * (`functions/lib/resolveBlankTemplates.js:10-11`) supports both `teamName`
 * (short) and `teamNameFull` (long form). Short reads more naturally in the
 * "Show off your support for ___" lead.
 */
const THONG_DESCRIPTION_TEMPLATE =
  "<p>Show off your support for <strong>{teamName}</strong> with these fun and flirty thong panties.</p>" +
  "<p>Our Thong Panty is made of our cotton spandex jersey for ultimate comfort and stretch. This is a foundational basic for any wardrobe and can be worn high or low on the hips.</p>" +
  "<ul>" +
  "<li>Machine Washable</li>" +
  "<li>Made in USA</li>" +
  "<li>All sales final. No returns or exchanges allowed.</li>" +
  "</ul>" +
  "<p>Cotton Spandex: 95% Cotton / 5% Elastane<br/>" +
  "Heather Grey: 87% Cotton / 8% Poly / 5% Elastane</p>";

/**
 * Shopify defaults — same brand as the rest of the catalog. `productType` is
 * "Underwear" so Shopify smart collections grouping by product type can scoop
 * thongs into intimates collections distinct from sweatshirts.
 */
const THONG_SHOPIFY_DEFAULTS = {
  productType: "Underwear",
  brand: "Rally Panties",
  productCategory: null,
  collectionHandles: null,
  sizeOptionName: "Size",
};

/**
 * Thong pricing per Greg (2026-05-25): $20 USD retail. Cost left null
 * until supplier sheet feeds in.
 */
const THONG_DEFAULT_PRICING = {
  retailPrice: 20,
  cost: null,
  currencyCode: "USD",
};

/**
 * Thong shipping weight (placeholder — Greg to confirm). ~30g is typical for
 * a cotton-spandex thong; lighter than the 8394 bikini panty (100g) due to
 * smaller fabric footprint. Verify against LA Apparel spec sheet before
 * relying on this for shipping rate calculation.
 */
const THONG_DEFAULT_SHIPPING = {
  defaultWeightGrams: 30,
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
  console.log(`[patch-thong] Looking up blank with styleCode="${styleCode}"…`);
  const snapshot = await db
    .collection("rp_blanks")
    .where("styleCode", "==", styleCode)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(`[fatal] No blank found with styleCode="${styleCode}"`);
    process.exit(1);
  }

  const blankDoc = snapshot.docs[0];
  const blankData = blankDoc.data();
  console.log(`[patch-thong] Found blank id=${blankDoc.id} styleName="${blankData.styleName}"`);
  console.log("");

  const patch = {};
  const beforeAfter = [];

  /** descriptionTemplate */
  const currentDesc = blankData.descriptionTemplate;
  if (isEmpty(currentDesc) || force) {
    patch.descriptionTemplate = THONG_DESCRIPTION_TEMPLATE;
    beforeAfter.push({
      field: "descriptionTemplate",
      before: currentDesc ?? "(unset)",
      after: THONG_DESCRIPTION_TEMPLATE.slice(0, 100) + "…",
    });
  } else {
    beforeAfter.push({
      field: "descriptionTemplate",
      before: (currentDesc || "").slice(0, 100) + "…",
      after: "(unchanged — already set; use --force to overwrite)",
    });
  }

  /** shopifyDefaults — patch the whole object if missing/empty; merge if partial. */
  const currentShopify = blankData.shopifyDefaults;
  if (isEmpty(currentShopify) || force) {
    patch.shopifyDefaults = THONG_SHOPIFY_DEFAULTS;
    beforeAfter.push({
      field: "shopifyDefaults",
      before: JSON.stringify(currentShopify ?? null),
      after: JSON.stringify(THONG_SHOPIFY_DEFAULTS),
    });
  } else {
    const merged = { ...THONG_SHOPIFY_DEFAULTS, ...currentShopify };
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

  /** defaultPricing */
  const currentPricing = blankData.defaultPricing;
  if (isEmpty(currentPricing) || force) {
    patch.defaultPricing = THONG_DEFAULT_PRICING;
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing ?? null),
      after: JSON.stringify(THONG_DEFAULT_PRICING),
    });
  } else {
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  /** defaultShipping */
  const currentShipping = blankData.defaultShipping;
  if (isEmpty(currentShipping) || force) {
    patch.defaultShipping = THONG_DEFAULT_SHIPPING;
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping ?? null),
      after: JSON.stringify(THONG_DEFAULT_SHIPPING),
    });
  } else {
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  console.log("┌─────────────────────────────────────────────────────────────────");
  console.log("│ 8390 Thong blank patch — diff summary");
  console.log("└─────────────────────────────────────────────────────────────────");
  for (const ba of beforeAfter) {
    console.log(`\n  ${ba.field}:`);
    console.log(`    before: ${ba.before}`);
    console.log(`    after:  ${ba.after}`);
  }
  console.log("");

  if (Object.keys(patch).length === 0) {
    console.log("[patch-thong] No changes needed (all fields already set). Run with --force to overwrite.");
    return;
  }

  if (dryRun) {
    console.log(`[patch-thong] DRY-RUN — would write ${Object.keys(patch).length} field(s) to rp_blanks/${blankDoc.id}`);
    console.log("[patch-thong] Re-run without --dry-run to apply.");
    return;
  }

  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await blankDoc.ref.update(patch);
  console.log(`[patch-thong] ✓ Wrote ${Object.keys(patch).length - 1} field(s) to rp_blanks/${blankDoc.id}`);
  console.log("[patch-thong] Verify in the editor / Firestore console.");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
