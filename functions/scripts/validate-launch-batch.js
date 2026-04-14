#!/usr/bin/env node
/**
 * Read-only validation for launch smoke tests + strict Firestore environment proof.
 *
 * IMPORTANT — Product detail page (`app/products/[slug]/page.tsx`) loads the document via:
 *   `useProductBySlug(slug)` → `fetchRPProductBySlug(slug)` in `lib/hooks/useRPProducts.ts`
 * which queries **collection `rp_products`** with `where("slug" | "handle", "==", urlSegment)`.
 * The URL **does not** pass Firestore document IDs; `--ids` must be the **parent** doc id under `rp_products`.
 *
 * Proof commands (run from `functions/`):
 *   node scripts/validate-launch-batch.js --ids=YOUR_PARENT_ID
 *   node scripts/validate-launch-batch.js --ids=YOUR_PARENT_ID --quiet
 *
 * Compare project with the Next app: `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in `.env.local` must match
 * `app.options.projectId` printed below (or use the same service account / gcloud project).
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { DEFAULT_ASSET_PLAN } = require("../lib/defaultAssetPlan");

/**
 * Without an explicit projectId, `app.options.projectId` is often missing under user ADC,
 * and Firestore may attach to the wrong project → empty `rp_products`.
 * Order: env → service account JSON `project_id` → repo `.firebaserc` default.
 */
function tryProjectIdFromServiceAccountJson() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p || typeof p !== "string") return null;
  try {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) return null;
    const j = JSON.parse(fs.readFileSync(abs, "utf8"));
    return j.project_id ? String(j.project_id) : null;
  } catch {
    return null;
  }
}

function resolveProjectIdForInit() {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    null;
  if (fromEnv) return { projectId: fromEnv.trim(), source: "env (GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|GCP_PROJECT|FIREBASE_PROJECT_ID)" };

  const fromJson = tryProjectIdFromServiceAccountJson();
  if (fromJson) return { projectId: fromJson, source: "GOOGLE_APPLICATION_CREDENTIALS JSON project_id" };

  const fromFirebaserc = tryReadFirebasercDefaultProject();
  if (fromFirebaserc) return { projectId: fromFirebaserc, source: "repo .firebaserc projects.default" };

  return { projectId: null, source: null };
}

function tryReadFirebasercDefaultProject() {
  try {
    const p = path.join(__dirname, "..", "..", ".firebaserc");
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.projects && j.projects.default ? String(j.projects.default) : null;
  } catch {
    return null;
  }
}

const _resolvedProject = resolveProjectIdForInit();

if (!admin.apps.length) {
  if (_resolvedProject.projectId) {
    admin.initializeApp({ projectId: _resolvedProject.projectId });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

const DEFAULT_LABELS = ["Giants 69 Panty", "Dodgers 69 Panty", "Yankees Custom Panty"];

/** Optional alternate top-level collections to probe when `rp_products/{id}` is missing (codebase audit). */
const FALLBACK_COLLECTIONS = ["products", "designs", "rp_blanks"];

function pickSlugLikeFields(data) {
  if (!data || typeof data !== "object") return {};
  const s = data.shopify && typeof data.shopify === "object" ? data.shopify : {};
  return {
    slug: data.slug ?? null,
    handle: data.handle ?? null,
    "shopify.handle": s.handle != null ? s.handle : null,
    "shopify.slug": s.slug != null ? s.slug : null,
    name: data.name ?? null,
    title: data.title ?? null,
    productKind: data.productKind ?? null,
  };
}

/**
 * Concrete proof: which project and endpoint the Admin SDK is using.
 */
function printFirestoreDiagnostics() {
  const app = admin.app();
  const opts = app.options || {};
  const projectId = opts.projectId != null ? String(opts.projectId) : "(missing)";

  console.log("\n========== PROOF: Admin SDK + environment ==========");
  console.log("[1] Firebase App name:", app.name);
  console.log("[1] app.options.projectId (active project for this process):", projectId);
  console.log(
    "[1] projectId source used at init:",
    _resolvedProject.source ?? "(none — default credentials only; Firestore project may be implicit/wrong)"
  );
  if (!_resolvedProject.projectId && projectId === "(missing)") {
    console.log(
      "[1] ⚠ Fix: export GCLOUD_PROJECT=<same as NEXT_PUBLIC_FIREBASE_PROJECT_ID>  OR  pass explicit JSON key with project_id  OR  rely on .firebaserc (script now auto-uses .firebaserc default when env unset)"
    );
  }

  console.log("[1] process.env.GCLOUD_PROJECT:", process.env.GCLOUD_PROJECT ?? "(unset)");
  console.log("[1] process.env.GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT ?? "(unset)");
  console.log("[1] process.env.GCP_PROJECT:", process.env.GCP_PROJECT ?? "(unset)");

  const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (cred) {
    console.log("[1] GOOGLE_APPLICATION_CREDENTIALS: set →", cred);
  } else {
    console.log(
      "[1] GOOGLE_APPLICATION_CREDENTIALS: (unset) — using gcloud ADC / metadata credentials; project comes from gcloud quota project / JSON if any"
    );
  }

  const firestoreEmu = process.env.FIRESTORE_EMULATOR_HOST;
  console.log("[2] FIRESTORE_EMULATOR_HOST:", firestoreEmu ?? "(unset)");
  console.log(
    "[2] Inference:",
    firestoreEmu ? "Admin SDK will talk to the **Firestore emulator** at " + firestoreEmu : "Admin SDK uses **production** Firestore (no emulator host)"
  );
  console.log("[2] FIREBASE_AUTH_EMULATOR_HOST:", process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "(unset)");

  let databaseId = "(default)";
  try {
    if (typeof db.databaseId === "string" && db.databaseId) databaseId = db.databaseId;
  } catch {
    /* ignore */
  }
  console.log("[1] Firestore databaseId (Admin instance):", databaseId);

  const fbRc = tryReadFirebasercDefaultProject();
  if (fbRc) {
    console.log("[hint] Repo `.firebaserc` default project (CLI deploy target, may differ from runtime):", fbRc);
    if (fbRc !== projectId) {
      console.log("[hint] ⚠ `.firebaserc` default !== app.options.projectId — confirm you intend this project for this script.");
    }
  }

  console.log("====================================================\n");
}

/**
 * [3] Direct read: first 5 docs in `rp_products` (arbitrary order).
 */
async function printSampleRpProducts() {
  const snap = await db.collection("rp_products").limit(5).get();
  console.log("========== PROOF: sample `rp_products` (limit 5) ==========");
  console.log("[3] Query: db.collection(\"rp_products\").limit(5)");
  console.log("[3] Returned count:", snap.size);
  if (snap.empty) {
    console.log("[3] EMPTY — most often **wrong Firestore project** (see [1] projectId). Rules do not apply to Admin SDK.");
    console.log("[3] Align with the app: `grep NEXT_PUBLIC_FIREBASE_PROJECT_ID ../.env.local` should match app.options.projectId above.");
  }
  snap.docs.forEach((d, i) => {
    const data = d.data() || {};
    console.log(`[3] #${i + 1} doc id=${d.id}`);
    console.log(
      "     title=%s name=%s slug=%s handle=%s",
      data.title ?? "—",
      data.name ?? "—",
      data.slug ?? "—",
      data.handle ?? "—"
    );
  });
  console.log("===========================================================\n");
}

/**
 * [4] When `rp_products/{id}` is missing, check other top-level collections + variant subdocs.
 */
async function probeIdWhenRpProductMissing(id) {
  console.log("========== PROOF: fallback paths for id ==========");
  console.log(`[4] Looking up id=${JSON.stringify(id)} in other collections (read-only)\n`);

  for (const col of FALLBACK_COLLECTIONS) {
    const ref = db.collection(col).doc(id);
    const snap = await ref.get();
    console.log(`[4] ${col}/${id} exists:`, snap.exists);
  }

  try {
    const byParent = await db.collectionGroup("variants").where("parentProductId", "==", id).limit(5).get();
    console.log('[4] collectionGroup("variants").where(parentProductId==id).size:', byParent.size);
    if (!byParent.empty) {
      console.log("[4] (If id is a **parent** id, these are its variant rows — parent doc should be rp_products/{id})");
      byParent.docs.forEach((d, i) => {
        console.log(`[4]   #${i + 1} path:`, d.ref.path);
      });
    }
  } catch (e) {
    console.log('[4] collectionGroup("variants").where(parentProductId==id) failed:', e && e.message ? e.message : e);
  }

  console.log(
    "[4] Note: Firestore **collectionGroup** + `FieldPath.documentId() == \"<id>\"` requires the **full** path, e.g. `rp_products/{parentId}/variants/{variantDocId}`, not a bare variant id — skipped here."
  );

  console.log("[4] Interpretation:");
  console.log("    • Parent PDP doc:     rp_products/{parentId}");
  console.log("    • Color/SKU row:      rp_products/{parentId}/variants/{variantDocId}");
  console.log("    • Blank template:     rp_blanks/{blankId}");
  console.log("    • Design:             designs/{designId}");
  console.log("    • Legacy `products`:  products/{id}  (see lib/hooks/useProducts.ts — not the PDP path)");
  console.log("===========================================================\n");
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { ids: null, slugs: null, debug: false, quiet: false };
  for (const a of argv) {
    if (a === "--debug") out.debug = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a.startsWith("--ids=")) out.ids = a.slice(6).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--slugs=")) out.slugs = a.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

function tokensMatchName(label, name) {
  const n = String(name || "").toLowerCase();
  const tokens = String(label)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.every((t) => n.includes(t));
}

function isParentRow(data) {
  if (data.productKind === "parent") return true;
  if ((data.variantCount ?? 0) > 0) return true;
  if (data.variantSummary && data.variantSummary.length > 0) return true;
  return false;
}

function pickProductDoc(docs) {
  if (docs.length === 1) return docs[0];
  const parents = docs.filter((d) => (d.data() || {}).productKind === "parent");
  return parents[0] || docs[0];
}

async function findProductDocByRouteKey(routeSegment) {
  const raw = String(routeSegment || "").trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const keys = [...new Set([decoded, raw].filter((k) => k.length > 0))];

  const fieldNames = [
    ["slug", "slug"],
    ["handle", "handle"],
    ["shopify.handle", "shopify.handle"],
    ["shopify.slug", "shopify.slug"],
  ];

  const tried = [];
  for (const key of keys) {
    for (const [, fieldPath] of fieldNames) {
      tried.push(`${fieldPath}==${JSON.stringify(key)}`);
      const snap = await db.collection("rp_products").where(fieldPath, "==", key).limit(5).get();
      if (!snap.empty) {
        const picked = pickProductDoc(snap.docs);
        return { doc: picked, matchedField: `${fieldPath} (value=${key})`, tried };
      }
    }
  }
  return { doc: null, matchedField: null, tried };
}

async function logFirstFiveRawSamples(label) {
  const snap = await db.collection("rp_products").limit(5).get();
  console.log(`\n[${label}] First ${snap.size} document(s) — slug-like fields (subset):\n`);
  snap.docs.forEach((d, i) => {
    const data = d.data() || {};
    console.log(`  --- #${i + 1} id=${d.id}`);
    console.log(JSON.stringify(pickSlugLikeFields(data), null, 2));
  });
  console.log("");
}

async function logSlugDebugWhenNoMatch(routeSegment, triedQueries) {
  console.log(`\n[debug] No document matched route key ${JSON.stringify(routeSegment)}`);
  console.log("[debug] Queries attempted:", triedQueries.join(" | "));
  const snap = await db.collection("rp_products").limit(5).get();
  console.log("[debug] Slug-like fields from first 5 `rp_products` docs (arbitrary order):\n");
  snap.docs.forEach((d, i) => {
    const data = d.data() || {};
    console.log(`  #${i + 1} id=${d.id}`);
    console.log(JSON.stringify(pickSlugLikeFields(data), null, 2));
  });
  console.log("");
}

function aggregateOfficialRolesFromBatch(b) {
  const colors = (b && b.colors) || {};
  const o = { done: 0, failed: 0, running: 0, queued: 0 };
  for (const ck of Object.keys(colors)) {
    const roles = (colors[ck] && colors[ck].roles) || {};
    for (const r of DEFAULT_ASSET_PLAN) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "done") o.done += 1;
      else if (st === "failed") o.failed += 1;
      else if (st === "running") o.running += 1;
      else o.queued += 1;
    }
  }
  return o;
}

async function countJobsLinkedToAssetBatch(batchId) {
  const out = { rp_generation_jobs: null, rp_mock_jobs: null };
  try {
    const g = await db.collection("rp_generation_jobs").where("productAssetBatchId", "==", batchId).limit(400).get();
    out.rp_generation_jobs = g.size;
  } catch (e) {
    out.rp_generation_jobs = `query_error: ${e.message}`;
  }
  try {
    const m = await db.collection("rp_mock_jobs").where("productAssetBatchId", "==", batchId).limit(120).get();
    out.rp_mock_jobs = m.size;
  } catch (e) {
    out.rp_mock_jobs = `query_error: ${e.message}`;
  }
  return out;
}

async function findJobsForProduct(productId) {
  const snap = await db.collection("shopifySyncJobs").where("entityId", "==", productId).limit(25).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() ?? a.createdAt?._seconds ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? b.createdAt?._seconds ?? 0;
    return tb - ta;
  });
  return rows.slice(0, 5);
}

async function validateProduct(doc) {
  const id = doc.id;
  const p = doc.data();
  const name = p.name || p.title || "";
  const vSnap = await db.collection("rp_products").doc(id).collection("variants").get();
  const variants = vSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const distinctColors = new Set(variants.map((v) => v.blankVariantId).filter(Boolean)).size;
  const skuCount = variants.length;

  const withFulfillmentPkg = variants.filter((v) => v.fulfillmentPackage && typeof v.fulfillmentPackage === "object");

  const fs = p.fulfillmentSummary || {};
  const sampleVariants = variants.slice(0, 2).map((v) => ({
    id: v.id,
    colorName: v.colorName,
    fulfillmentReady: v.fulfillmentPackage?.fulfillmentReady,
    printFileRefsKeys: v.fulfillmentPackage?.printFileRefs ? Object.keys(v.fulfillmentPackage.printFileRefs) : [],
  }));

  const jobs = await findJobsForProduct(id).catch(() => []);

  const batchId = p.assetsBatchId && String(p.assetsBatchId).trim() ? String(p.assetsBatchId).trim() : null;
  let batchDiag = {
    assetsBatchId: batchId,
    batchDocExists: false,
    batchStatus: null,
    batchAssetsProgress: null,
    launchPipeline: null,
    officialRolesExpected: [...DEFAULT_ASSET_PLAN],
    officialRoleSlotsExpected: null,
    officialRoleProgress: null,
    batchJobCounts: null,
  };
  if (batchId) {
    const bSnap = await db.collection("rp_product_asset_batches").doc(batchId).get();
    batchDiag.batchDocExists = bSnap.exists;
    if (bSnap.exists) {
      const b = bSnap.data() || {};
      batchDiag.batchStatus = b.status ?? null;
      batchDiag.batchAssetsProgress = b.assetsProgress ?? null;
      batchDiag.launchPipeline = b.launchPipeline === true;
      const colorKeys = Object.keys(b.colors || {});
      batchDiag.officialRoleSlotsExpected = colorKeys.length * DEFAULT_ASSET_PLAN.length;
      batchDiag.officialRoleProgress = aggregateOfficialRolesFromBatch(b);
      batchDiag.batchJobCounts = await countJobsLinkedToAssetBatch(batchId);
    }
  }

  const checks = {
    parentRow: isParentRow(p) ? "ok" : "fail",
    colorCount_parent: p.colorVariantCount ?? null,
    colorCount_derived: distinctColors,
    skuCount_parent: p.variantCount ?? null,
    skuCount_derived: skuCount,
    assetsStatus: p.assetsStatus ?? null,
    launchStatus: p.launchStatus ?? null,
    shopifyReady: p.shopifyReady ?? null,
    fulfillmentReady: fs.fulfillmentReady ?? null,
    fulfillmentMissing: fs.fulfillmentMissing ?? [],
    opsReviewStatus: p.opsReviewStatus ?? null,
    lastPipelineError: p.lastPipelineError ?? null,
    lastPipelineStage: p.lastPipelineStage ?? null,
    shopify_parent: p.shopify?.status ?? null,
    shopify_productId: p.shopify?.productId ?? null,
    recentSyncJobs: jobs.map((j) => ({ status: j.status, error: j.error || null, source: j.source || null })),
    variantFulfillmentPackageCount: withFulfillmentPkg.length,
  };

  return {
    id,
    name,
    slugField: p.slug ?? null,
    handleField: p.handle ?? null,
    checks,
    sampleVariants,
    batchDiag,
    fulfillmentSummaryPresent: !!p.fulfillmentSummary,
  };
}

async function main() {
  const { ids, slugs, debug, quiet } = parseArgs();

  if (!quiet) {
    printFirestoreDiagnostics();
    await printSampleRpProducts();
  }

  let docs = [];

  if (ids && ids.length) {
    for (const pid of ids) {
      const ref = await db.collection("rp_products").doc(pid).get();
      if (ref.exists) {
        docs.push(ref);
      } else {
        console.error(`\n❌ Missing rp_products/${pid} (in project ${admin.app().options.projectId})`);
        await probeIdWhenRpProductMissing(pid);
      }
    }
  } else if (slugs && slugs.length) {
    if (debug && !quiet) {
      await logFirstFiveRawSamples("debug");
    }
    for (const segment of slugs) {
      const { doc, matchedField, tried } = await findProductDocByRouteKey(segment);
      if (doc) {
        console.log(`\nResolved ${JSON.stringify(segment)} → id=${doc.id} via ${matchedField}`);
        docs.push(doc);
      } else {
        console.error(`\n❌ No product matched route segment: ${JSON.stringify(segment)}`);
        await logSlugDebugWhenNoMatch(segment, tried);
      }
    }
  } else {
    const snap = await db.collection("rp_products").get();
    const all = snap.docs.map((d) => ({ ref: d, data: d.data() }));
    for (const label of DEFAULT_LABELS) {
      const hits = all.filter(
        ({ data }) => isParentRow(data) && tokensMatchName(label, data.name || data.title || "")
      );
      if (hits.length === 0) {
        console.error(`\n❌ No parent match for label: "${label}"`);
        continue;
      }
      if (hits.length > 1) {
        console.warn(`\n⚠️ Multiple (${hits.length}) matches for "${label}" — using first:`);
        hits.forEach((h, i) => console.warn(`   ${i + 1}. ${h.data.name || h.data.title} (${h.ref.id})`));
      }
      if (debug) {
        console.log(`\n[debug] Raw match for "${label}" (first doc):`);
        console.log(JSON.stringify(pickSlugLikeFields(hits[0].data), null, 2));
      }
      docs.push(hits[0].ref);
    }
  }

  if (docs.length === 0) {
    console.log("\nNo documents to validate (see errors above). Exiting.\n");
    return;
  }

  console.log("\n=== Launch batch validation (read-only) ===\n");

  for (const doc of docs) {
    const row = await validateProduct(doc);
    console.log(`— ${row.name}`);
    console.log(`  id=${row.id}`);
    console.log(`  slug field=${row.slugField ?? "—"}  handle field=${row.handleField ?? "—"}`);
    console.log(`  parent row: ${row.checks.parentRow}`);
    console.log(
      `  colors: parent=${row.checks.colorCount_parent ?? "—"} derived=${row.checks.colorCount_derived} (expect match)`
    );
    console.log(`  SKUs: parent=${row.checks.skuCount_parent ?? "—"} derived=${row.checks.skuCount_derived}`);
    console.log(`  assetsStatus: ${row.checks.assetsStatus}`);
    console.log(`  launchStatus: ${row.checks.launchStatus}`);
    console.log(`  shopifyReady: ${row.checks.shopifyReady}`);
    console.log(`  fulfillmentSummary: ${row.fulfillmentSummaryPresent ? "present" : "MISSING"}`);
    console.log(`  fulfillmentReady: ${row.checks.fulfillmentReady}`);
    if (row.checks.fulfillmentMissing?.length) console.log(`  fulfillmentMissing: ${row.checks.fulfillmentMissing.join(", ")}`);
    console.log(`  opsReviewStatus: ${row.checks.opsReviewStatus}`);
    console.log(`  lastPipelineError: ${row.checks.lastPipelineError ?? "—"}`);
    console.log(`  lastPipelineStage: ${row.checks.lastPipelineStage ?? "—"}`);
    console.log(`  active assetsBatchId: ${row.batchDiag.assetsBatchId ?? "—"}`);
    console.log(
      `  batch doc exists: ${row.batchDiag.batchDocExists} | batch status: ${row.batchDiag.batchStatus ?? "—"} | batch progress: ${JSON.stringify(row.batchDiag.batchAssetsProgress)} | launchPipeline on batch: ${row.batchDiag.launchPipeline}`
    );
    console.log(`  official roles expected (per color): ${JSON.stringify(row.batchDiag.officialRolesExpected)}`);
    console.log(
      `  official role slots expected: ${row.batchDiag.officialRoleSlotsExpected ?? "—"} | progress: ${JSON.stringify(row.batchDiag.officialRoleProgress)}`
    );
    if (row.batchDiag.batchJobCounts) {
      console.log(
        `  jobs linked to batch: rp_generation_jobs=${row.batchDiag.batchJobCounts.rp_generation_jobs} (official primary) | rp_mock_jobs=${row.batchDiag.batchJobCounts.rp_mock_jobs} (8394 secondary, if any)`
      );
    }
    console.log(`  variants with fulfillmentPackage: ${row.checks.variantFulfillmentPackageCount}/${row.checks.skuCount_derived}`);
    console.log(`  shopify.status: ${row.checks.shopify_parent} productId=${row.checks.shopify_productId ?? "—"}`);
    console.log(`  recent shopifySyncJobs: ${JSON.stringify(row.checks.recentSyncJobs)}`);
    row.sampleVariants.forEach((v, i) => {
      console.log(
        `  variant sample ${i + 1}: ${v.colorName || v.id} fulfill=${v.fulfillmentReady} refs=${v.printFileRefsKeys.join(",") || "—"}`
      );
    });
    console.log("");
  }

  console.log("Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
