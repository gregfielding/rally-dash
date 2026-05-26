#!/usr/bin/env node
/**
 * One-off (idempotent) data fix: backfill Shopify-push-required fields on the
 * HF07 crewneck blank doc. Per the HF07 vs 8394 audit (2026-05-25):
 *
 *   - `descriptionTemplate` was missing → product description fell back to a
 *     hardcoded "Soft, breathable low-rise panty featuring …" string in
 *     `merchandisingAtCreate.buildStorefrontSeoDescription()`. Every HF07
 *     product would have shipped to Shopify with a description claiming it
 *     was a panty.
 *   - `shopifyDefaults` (productType, brand) was missing → Shopify product
 *     type rendered as undefined / empty.
 *   - `defaultPricing` + `defaultShipping` either missing or carried 8394
 *     panty defaults (~$24.99 / 100g) instead of crewneck-realistic values
 *     (heavyweight cotton fleece ≈ 650g, retail ≈ $58).
 *
 * Script behavior:
 *   - Looks up the HF07 blank by `styleCode === "8394"` style style match…
 *     Actually: by `styleCode === "HF07"`. The Firestore doc id ≠ "HF07"
 *     necessarily, so we query the collection.
 *   - Logs the current values for each field.
 *   - Sets each field ONLY if currently null / unset / empty. Operator-set
 *     non-empty values are preserved.
 *   - `--dry-run` prints the diff without writing.
 *   - `--force` overwrites existing values (use with care).
 *
 * Usage (from functions/):
 *   node scripts/patch-hf07-shopify-defaults.js --dry-run
 *   node scripts/patch-hf07-shopify-defaults.js
 *   node scripts/patch-hf07-shopify-defaults.js --force
 *   node scripts/patch-hf07-shopify-defaults.js --style-code=HF07
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
const styleCode = parseFlag("style-code", "HF07");

/**
 * Crewneck description template — Greg's approved copy (2026-05-25).
 * Tokens resolved at product-creation time by `resolveBlankTemplates.js`:
 *   {teamNameFull}    → e.g. "Kansas City Chiefs"
 *   {designShortName} → e.g. "City 69"
 *   {colorName}       → e.g. "Off-White"
 *
 * Structure mirrors the sample Greg pasted: hero pitch → garment-dye explainer
 * → color/design line → bulleted features → Made-in-LA close. Tokens drive the
 * per-product specifics; everything else is shared boilerplate.
 */
const HF07_DESCRIPTION_TEMPLATE =
  "<p>Meet your new favorite crewneck sweatshirt. Made from a luxurious 14oz fleece, this crewneck is incredibly soft and warm, yet still breathable and moisture-wicking. The loose fit allows for a full range of motion, making it perfect for everything from running errands to lounging around the house. The ribbed cuffs and hem keep the cold out.</p>" +
  "<p>This sweatshirt is garment dyed. Our garment-dyed crewneck sweatshirts are dyed after they're sewn, which gives them a more durable and even color, including in the stitching and ribbing. This also means they'll have less shrinkage and colors will stay true after repeated washings.</p>" +
  "<p>{colorName} crewneck featuring the <strong>{teamNameFull}</strong> {designShortName} design.</p>" +
  "<p><strong>Features:</strong></p>" +
  "<ul>" +
  "<li>Made from our premium 14oz heavyweight fleece to keep you warm</li>" +
  "<li>Essential crewneck styling perfect for all occasions</li>" +
  "<li>Loose fit for a full range of motion</li>" +
  "<li>Ribbed cuffs and hem to keep the cold out</li>" +
  "</ul>" +
  "<p><em>Knitted, cut, sewn, and dyed in Los Angeles, California.</em></p>";

/**
 * Shopify defaults for HF07. `productType` is what Shopify uses to categorize
 * the product (visible in admin + drives smart-collection rules). `brand`
 * surfaces in storefront templates as "vendor"; we use the merchandising
 * brand "Rally Panties" consistently across all garments for now.
 */
const HF07_SHOPIFY_DEFAULTS = {
  productType: "Sweatshirt",
  brand: "Rally Panties",
  productCategory: null,
  collectionHandles: null,
  sizeOptionName: "Size",
};

/**
 * Crewneck pricing per Greg (2026-05-25): $69 USD retail. Cost left null —
 * populated per-variant if the supplier sheet feeds in later.
 */
const HF07_DEFAULT_PRICING = {
  retailPrice: 69,
  cost: null,
  currencyCode: "USD",
};

/**
 * Crewneck weight per Greg (2026-05-25): 1.5 lbs → 680g (1.5 × 453.592 = 680.39,
 * rounded to whole grams for Shopify). `requiresShipping` true — physical product.
 */
const HF07_DEFAULT_SHIPPING = {
  defaultWeightGrams: 680,
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
  console.log(`[patch-hf07] Looking up blank with styleCode="${styleCode}"…`);
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
  console.log(`[patch-hf07] Found blank id=${blankDoc.id} styleName="${blankData.styleName}"`);
  console.log("");

  /** Build the patch object — only include keys we actually want to change. */
  const patch = {};
  const beforeAfter = [];

  /** descriptionTemplate */
  const currentDesc = blankData.descriptionTemplate;
  if (isEmpty(currentDesc) || force) {
    patch.descriptionTemplate = HF07_DESCRIPTION_TEMPLATE;
    beforeAfter.push({
      field: "descriptionTemplate",
      before: currentDesc ?? "(unset)",
      after: HF07_DESCRIPTION_TEMPLATE.slice(0, 100) + "…",
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
    patch.shopifyDefaults = HF07_SHOPIFY_DEFAULTS;
    beforeAfter.push({
      field: "shopifyDefaults",
      before: JSON.stringify(currentShopify ?? null),
      after: JSON.stringify(HF07_SHOPIFY_DEFAULTS),
    });
  } else {
    /** Merge: fill in only missing keys */
    const merged = { ...HF07_SHOPIFY_DEFAULTS, ...currentShopify };
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
    patch.defaultPricing = HF07_DEFAULT_PRICING;
    beforeAfter.push({
      field: "defaultPricing",
      before: JSON.stringify(currentPricing ?? null),
      after: JSON.stringify(HF07_DEFAULT_PRICING),
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
    patch.defaultShipping = HF07_DEFAULT_SHIPPING;
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping ?? null),
      after: JSON.stringify(HF07_DEFAULT_SHIPPING),
    });
  } else {
    beforeAfter.push({
      field: "defaultShipping",
      before: JSON.stringify(currentShipping),
      after: "(unchanged — use --force to overwrite)",
    });
  }

  /** Pretty-print the diff */
  console.log("┌─────────────────────────────────────────────────────────────────");
  console.log("│ HF07 blank patch — diff summary");
  console.log("└─────────────────────────────────────────────────────────────────");
  for (const ba of beforeAfter) {
    console.log(`\n  ${ba.field}:`);
    console.log(`    before: ${ba.before}`);
    console.log(`    after:  ${ba.after}`);
  }
  console.log("");

  if (Object.keys(patch).length === 0) {
    console.log("[patch-hf07] No changes needed (all fields already set). Run with --force to overwrite.");
    return;
  }

  if (dryRun) {
    console.log(`[patch-hf07] DRY-RUN — would write ${Object.keys(patch).length} field(s) to rp_blanks/${blankDoc.id}`);
    console.log("[patch-hf07] Re-run without --dry-run to apply.");
    return;
  }

  /** Apply the patch + bump updatedAt */
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await blankDoc.ref.update(patch);
  console.log(`[patch-hf07] ✓ Wrote ${Object.keys(patch).length - 1} field(s) to rp_blanks/${blankDoc.id}`);
  console.log("[patch-hf07] Verify in the editor / Firestore console.");
}

main().catch((err) => {
  console.error("[fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
