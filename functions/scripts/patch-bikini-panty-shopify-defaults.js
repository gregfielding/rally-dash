#!/usr/bin/env node
/**
 * One-off (idempotent) data fix: backfill Shopify-push-required fields on the
 * 8394 Bikini Panty blank doc. Sibling to patch-thong-shopify-defaults.js
 * (8390) and patch-hf07-shopify-defaults.js (HF07) — same shape, bikini-panty
 * voice and pricing.
 *
 * Per the audit (2026-05-25), 8394's blank doc had no descriptionTemplate,
 * shopifyDefaults, defaultPricing, or defaultShipping. Every panty product
 * would have rendered into Shopify using the hardcoded "Soft, breathable
 * low-rise panty…" string in `merchandisingAtCreate.buildStorefrontSeoDescription()`.
 *
 * Usage (from functions/):
 *   node scripts/patch-bikini-panty-shopify-defaults.js --dry-run
 *   node scripts/patch-bikini-panty-shopify-defaults.js
 *   node scripts/patch-bikini-panty-shopify-defaults.js --force
 *   node scripts/patch-bikini-panty-shopify-defaults.js --style-code=8394
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
const styleCode = parseFlag("style-code", "8394");

/**
 * 8394 Bikini Panty description template — matches Greg's actual sample copy
 * structure (2026-05-25). Title-style opening with team + design name → product
 * pitch → spec bullets → material breakdown with Heather Grey variant note.
 *
 * Tokens resolved at product-creation time by `resolveBlankTemplates.js`:
 *   {teamName}        → short team name (e.g. "Denver Broncos")
 *   {designShortName} → e.g. "Pillows"
 *   {colorName}       → e.g. "Navy"
 *
 * Note on ink colors: Greg's sample reads "Navy with orange and white artwork" —
 * the ink-color portion can't be templated without a new token (resolver doesn't
 * expose `inkColors[]`). We use the simpler "{colorName} panty with custom team
 * artwork" form so we don't hardcode example ink colors. Adding a {inkColors}
 * token later is a separate small change to resolveBlankTemplates.js.
 */
const PANTY_DESCRIPTION_TEMPLATE =
  "<p><strong>{teamName} {designShortName} Panties.</strong> {colorName} panty with custom team artwork.</p>" +
  "<p>This low rise panty is made with our ultra soft and breathable cotton spandex. It's comfortable with a minimal look, meaning it looks great even if your bottoms are completely see thru.</p>" +
  "<ul>" +
  "<li>Medium Coverage</li>" +
  "<li>Low Rise Fit</li>" +
  "<li>Machine Washable</li>" +
  "<li>Made in USA</li>" +
  "<li>All sales final. No returns or exchanges allowed.</li>" +
  "</ul>" +
  "<p>Cotton Spandex: 95% Cotton / 5% Elastane<br/>" +
  "Heather Grey: 87% Cotton / 8% Poly / 5% Elastane</p>";

/**
 * Shopify defaults — same Underwear productType as 8390 thong so Shopify
 * smart collections group intimates separately from sweatshirts.
 */
const PANTY_SHOPIFY_DEFAULTS = {
  productType: "Underwear",
  brand: "Rally Panties",
  productCategory: null,
  collectionHandles: null,
  sizeOptionName: "Size",
};

/** Bikini panty pricing per Greg (2026-05-25): $25 USD retail. */
const PANTY_DEFAULT_PRICING = {
  retailPrice: 25,
  cost: null,
  currencyCode: "USD",
};

/**
 * Bikini panty shipping weight (placeholder — Greg to confirm). 50g is a
 * reasonable estimate: bikini cut has more fabric than the 30g thong, less
 * than the legacy 100g hardcoded fallback. Verify against LA Apparel spec
 * sheet before relying on this for shipping rate calculation.
 */
const PANTY_DEFAULT_SHIPPING = {
  defaultWeightGrams: 50,
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
  console.log(`[patch-bikini-panty] Looking up blank with styleCode="${styleCode}"…`);
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
  console.log(`[patch-bikini-panty] Found blank id=${blankDoc.id} styleName="${blankData.styleName}"`);
  console.log("");

  const patch = {};
  const beforeAfter = [];

  const currentDesc = blankData.descriptionTemplate;
  if (isEmpty(currentDesc) || force) {
    patch.descriptionTemplate = PANTY_DESCRIPTION_TEMPLATE;
    beforeAfter.push({
      field: "descriptionTemplate",
      before: currentDesc ?? "(unset)",
      after: PANTY_DESCRIPTION_TEMPLATE.slice(0, 100) + "…",
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
    patch.shopifyDefaults = PANTY_SHOPIFY_DEFAULTS;
    beforeAfter.push({
      field: "shopifyDefaults",
      before: JSON.stringify(currentShopify ?? null),
      after: JSON.stringify(PANTY_SHOPIFY_DEFAULTS),
    });
  } else {
    const merged = { ...PANTY_SHOPIFY_DEFAULTS, ...currentShopify };
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
    patch.defaultPricing = PANTY_DEFAULT_PRICING;
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing ?? null),
      after: JSON.stringify(PANTY_DEFAULT_PRICING),
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
    patch.defaultShipping = PANTY_DEFAULT_SHIPPING;
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping ?? null),
      after: JSON.stringify(PANTY_DEFAULT_SHIPPING),
    });
  } else {
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  console.log("┌─────────────────────────────────────────────────────────────────");
  console.log("│ 8394 Bikini Panty blank patch — diff summary");
  console.log("└─────────────────────────────────────────────────────────────────");
  for (const ba of beforeAfter) {
    console.log(`\n  ${ba.field}:`);
    console.log(`    before: ${ba.before}`);
    console.log(`    after:  ${ba.after}`);
  }
  console.log("");

  if (Object.keys(patch).length === 0) {
    console.log("[patch-bikini-panty] No changes needed (all fields already set). Run with --force to overwrite.");
    return;
  }

  if (dryRun) {
    console.log(`[patch-bikini-panty] DRY-RUN — would write ${Object.keys(patch).length} field(s) to rp_blanks/${blankDoc.id}`);
    console.log("[patch-bikini-panty] Re-run without --dry-run to apply.");
    return;
  }

  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await blankDoc.ref.update(patch);
  console.log(`[patch-bikini-panty] ✓ Wrote ${Object.keys(patch).length - 1} field(s) to rp_blanks/${blankDoc.id}`);
  console.log("[patch-bikini-panty] Verify in the editor / Firestore console.");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
