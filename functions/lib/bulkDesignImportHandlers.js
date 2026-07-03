"use strict";

/**
 * Callable handlers: parseBulkDesignUploadPreview, commitBulkDesignUpload.
 * Temp storage: rp_design_imports/{uid}/{jobId}/raw/{filename}
 * TODO: lifecycle cleanup for stale rp_design_imports objects (scheduled delete or TTL policy).
 */

const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { normalizeColorsForFirestore } = require("./standardPrintInks");
const {
  mergeDesignFiles,
  buildAssetsFromFiles,
  resolveDesignAssetUrls,
  computeDesignPngFlags,
  computeDesignIsComplete,
  isRasterPngKind,
  isSvgFamilyKind,
  DESIGN_FILE_KINDS,
} = require("./designFileMergeCore");
const {
  buildPreviewItems,
  coverageFromKind,
  hasAnyPng,
  filterServerDescriptor,
} = require("./bulkDesignImportPreviewEngine");

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;
const BATCH_IMPORT_TEAM_ID = "batch_import";
const IMPORT_VERSION = "1";

const DEFAULT_DESIGN_PLACEMENTS = [
  {
    placementId: "front_center",
    x: 0.5,
    y: 0.5,
    scale: 0.6,
    safeArea: { padX: 0.2, padY: 0.2 },
    rotationDeg: 0,
  },
  {
    placementId: "back_center",
    x: 0.5,
    y: 0.5,
    scale: 0.6,
    safeArea: { padX: 0.2, padY: 0.2 },
    rotationDeg: 0,
  },
];

const DESIGN_THEME_CANONICAL = new Set([
  "city_69",
  "slogan",
  "stadium",
  "rivalry",
  "number",
  "wordplay",
  "badge_crest",
  "pillows",
  "custom_one_off",
]);
const DESIGN_THEME_LEGACY = new Set(["wordmark", "script", "other", "badge"]);

function isAllowedDesignTheme(v) {
  return typeof v === "string" && (DESIGN_THEME_CANONICAL.has(v) || DESIGN_THEME_LEGACY.has(v));
}

function normalizeDesignSeriesInput(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  const out = s
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return out || null;
}

/** Mirrors lib/designs/designAssetKinds.ts designUploadStorageFolder */
function designUploadStorageFolder(kind) {
  const m = {
    frontLightPng: "png/front/light",
    frontDarkPng: "png/front/dark",
    frontWhitePng: "png/front/white",
    backLightPng: "png/back/light",
    backDarkPng: "png/back/dark",
    backWhitePng: "png/back/white",
    frontLightSvg: "svg/front/light",
    frontDarkSvg: "svg/front/dark",
    frontWhiteSvg: "svg/front/white",
    backLightSvg: "svg/back/light",
    backDarkSvg: "svg/back/dark",
    backWhiteSvg: "svg/back/white",
    frontLightPdf: "pdf/front/light",
    frontDarkPdf: "pdf/front/dark",
    frontWhitePdf: "pdf/front/white",
    backLightPdf: "pdf/back/light",
    backDarkPdf: "pdf/back/dark",
    backWhitePdf: "pdf/back/white",
    png: "png/legacy",
    lightPng: "png/light",
    darkPng: "png/dark",
    whitePng: "png/white",
    svg: "svg/legacy",
    lightSvg: "svg/light",
    darkSvg: "svg/dark",
    whiteSvg: "svg/white",
    pdf: "pdf/legacy",
    lightPdf: "pdf/light",
    darkPdf: "pdf/dark",
    whitePdf: "pdf/white",
  };
  return m[kind] || "png/legacy";
}

function designUploadStoragePath(designId, kind, fileName) {
  return `designs/${designId}/${designUploadStorageFolder(kind)}/${fileName}`;
}

const COV_TO_URLKEY = {
  hasLightPng: "lightPng",
  hasDarkPng: "darkPng",
  hasWhitePng: "whitePng",
  hasLightSvg: "lightSvg",
  hasDarkSvg: "darkSvg",
  hasWhiteSvg: "whiteSvg",
  hasLightPdf: "lightPdf",
  hasDarkPdf: "darkPdf",
  hasWhitePdf: "whitePdf",
};

function existingUrlForFileKind(designData, kind) {
  const u = resolveDesignAssetUrls({
    files: designData.files || {},
    assets: designData.assets || {},
    supportedSides: designData.supportedSides,
  });
  const cov = coverageFromKind(kind);
  if (!cov) return null;
  const key = COV_TO_URLKEY[cov];
  return key ? u[key] : null;
}

const DEFAULT_COLORS = [
  { hex: "#111111", name: "Off Black", role: "standard_off_black" },
  { hex: "#F5F5F5", name: "Off White", role: "standard_off_white" },
];

async function assertAdminOrOps(uid) {
  const adminSnap = await admin.firestore().collection("admins").doc(uid).get();
  const role = adminSnap.data()?.role;
  if (!adminSnap.exists || (role !== "admin" && role !== "ops")) {
    throw new functions.https.HttpsError("permission-denied", "Only admins and ops can run bulk design import");
  }
}

function expectedRawPrefix(uid, jobId) {
  return `rp_design_imports/${uid}/${jobId}/raw/`;
}

async function deleteAllItems(jobRef) {
  const snap = await jobRef.collection("items").get();
  if (snap.empty) return;
  const db = admin.firestore();
  const chunks = [];
  let batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    n++;
    if (n >= 400) {
      chunks.push(batch.commit());
      batch = db.batch();
      n = 0;
    }
  }
  chunks.push(batch.commit());
  await Promise.all(chunks);
}

async function writeItems(jobRef, items) {
  const db = admin.firestore();
  let batch = db.batch();
  let n = 0;
  const commits = [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const it of items) {
    const ref = jobRef.collection("items").doc(it.itemId);
    const plain = JSON.parse(JSON.stringify({ ...it, id: it.itemId }));
    const doc = { ...plain, updatedAt: now, createdAt: now };
    batch.set(ref, doc, { merge: true });
    n++;
    if (n >= 400) {
      commits.push(batch.commit());
      batch = db.batch();
      n = 0;
    }
  }
  commits.push(batch.commit());
  await Promise.all(commits);
}

async function finalizeDownloadUrl(bucket, destFile, contentType) {
  const token = crypto.randomUUID();
  await destFile.setMetadata({
    contentType: contentType || "application/octet-stream",
    metadata: {
      firebaseStorageDownloadTokens: token,
    },
  });
  const path = destFile.name;
  const encoded = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
}

async function copyTempToDesignAsset(
  bucket,
  srcPath,
  designId,
  kind,
  originalFilename,
  sizeBytes,
  contentTypeHint,
  uploadedByUid
) {
  const destPath = designUploadStoragePath(designId, kind, originalFilename);
  const srcFile = bucket.file(srcPath);
  const destFile = bucket.file(destPath);
  await srcFile.copy(destFile);
  const isRasterPng = isRasterPngKind(kind);
  const isSvgFamily = isSvgFamilyKind(kind);
  const contentType =
    contentTypeHint ||
    (isRasterPng ? "image/png" : isSvgFamily ? "image/svg+xml" : "application/pdf");
  const downloadUrl = await finalizeDownloadUrl(bucket, destFile, contentType);
  const fileKindForDoc = isRasterPng ? "png" : isSvgFamily ? "svg" : "pdf";
  const now = admin.firestore.FieldValue.serverTimestamp();
  const fileData = {
    kind: fileKindForDoc,
    storagePath: destPath,
    downloadUrl,
    fileName: originalFilename,
    contentType,
    sizeBytes: sizeBytes || 0,
    widthPx: isRasterPng ? 0 : null,
    heightPx: isRasterPng ? 0 : null,
    sha256: null,
    uploadedAt: now,
    uploadedByUid,
  };
  const fileEntry = { ...fileData, downloadUrl };
  return { destPath, downloadUrl, fileEntry, storagePath: destPath };
}

async function applyFileToDesign(db, designId, userId, kind, fileEntry) {
  const designRef = db.collection("designs").doc(designId);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Design not found");
  }
  const currentData = designSnap.data();
  const mergedFiles = mergeDesignFiles(currentData.files || {}, kind, fileEntry);
  const mergedAssets = buildAssetsFromFiles(mergedFiles);
  const hasSvg = !!(
    mergedFiles.svg ||
    mergedFiles.lightSvg ||
    mergedFiles.darkSvg ||
    mergedFiles.whiteSvg ||
    mergedFiles.front?.lightSvg ||
    mergedFiles.front?.darkSvg ||
    mergedFiles.front?.whiteSvg ||
    mergedFiles.back?.lightSvg ||
    mergedFiles.back?.darkSvg ||
    mergedFiles.back?.whiteSvg
  );
  const hasPdf = !!(
    mergedFiles.pdf ||
    mergedFiles.lightPdf ||
    mergedFiles.darkPdf ||
    mergedFiles.whitePdf ||
    mergedFiles.front?.lightPdf ||
    mergedFiles.front?.darkPdf ||
    mergedFiles.front?.whitePdf ||
    mergedFiles.back?.lightPdf ||
    mergedFiles.back?.darkPdf ||
    mergedFiles.back?.whitePdf
  );
  const { hasLightPng, hasDarkPng, hasWhitePng, hasPng } = computeDesignPngFlags(mergedFiles, mergedAssets);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nextForComplete = {
    ...currentData,
    files: mergedFiles,
    assets: mergedAssets,
    colorCount: currentData.colorCount,
  };
  await designRef.update({
    files: mergedFiles,
    assets: mergedAssets,
    updatedAt: now,
    updatedByUid: userId,
    hasSvg,
    hasPdf,
    hasLightPng,
    hasDarkPng,
    hasWhitePng,
    hasPng,
    isComplete: computeDesignIsComplete(nextForComplete),
  });
}

async function createDesignDocument(db, userId, payload) {
  const {
    name,
    teamId,
    designType,
    designSeries,
    slugOverride,
    importKey,
    leagueCode,
    teamCode,
    themeCode,
    designFamily,
    importSource,
    importBatchId,
    importVersion,
    targetBlankIds,
    skipAutoLaunch,
    productLabel,
    accentColor,
  } = payload;

  const teamSnap = await db.collection("design_teams").doc(teamId).get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Team not found: ${teamId}`);
  }
  const teamData = teamSnap.data();
  const teamName = teamData.name || teamId;
  const leagueId = teamData.leagueId || teamData.league || null;
  const teamCity = teamData.city || null;
  const teamState = teamData.state || null;
  const teamNickname = teamData.teamName || null;

  let slug;
  if (slugOverride && typeof slugOverride === "string" && slugOverride.trim()) {
    const base = slugOverride
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
    let candidate = base;
    const dup = await db.collection("designs").where("slug", "==", candidate).limit(1).get();
    slug = dup.empty ? candidate : `${candidate}-${Date.now().toString(36)}`;
  } else {
    const slugBase = `${teamName}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    slug = `${slugBase}-${Date.now().toString(36)}`;
  }

  const normalizedColors = normalizeColorsForFirestore(payload.colors || DEFAULT_COLORS);
  const seriesNorm = normalizeDesignSeriesInput(designSeries);

  const searchKeywords = [
    name.toLowerCase(),
    teamName.toLowerCase(),
    teamId.toLowerCase(),
    designType,
    seriesNorm,
    leagueId && String(leagueId).toLowerCase(),
    teamCity && String(teamCity).toLowerCase(),
    teamState && String(teamState).toLowerCase(),
    teamNickname && String(teamNickname).toLowerCase(),
    ...normalizedColors.map(c => c.name?.toLowerCase()).filter(Boolean),
    ...normalizedColors.map(c => c.hex.toLowerCase()),
    ...normalizedColors.map(c => (c.role && String(c.role).toLowerCase())),
  ].filter(Boolean);

  const teamCodeDenorm = teamData.teamCode || teamCode || null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const files = {
    lightPng: null,
    darkPng: null,
    png: null,
    lightSvg: null,
    darkSvg: null,
    svg: null,
    lightPdf: null,
    darkPdf: null,
    pdf: null,
  };
  const assets = {
    lightPng: null,
    darkPng: null,
    lightSvg: null,
    darkSvg: null,
    svg: null,
    lightPdf: null,
    darkPdf: null,
    pdf: null,
  };

  const designData = {
    name: name.trim(),
    slug,
    teamId,
    teamNameCache: teamName,
    teamCode: teamCodeDenorm,
    leagueId,
    teamCityCache: teamCity,
    teamStateCache: teamState,
    teamNicknameCache: teamNickname,
    designType,
    designSeries: seriesNorm,
    status: "draft",
    tags: [],
    description: null,
    internalNotes: null,
    files,
    assets,
    colors: normalizedColors,
    colorCount: normalizedColors.length,
    placementDefaults: DEFAULT_DESIGN_PLACEMENTS,
    linkedBlankVariantCount: 0,
    linkedProductCount: 0,
    hasSvg: false,
    hasLightPng: false,
    hasDarkPng: false,
    hasWhitePng: false,
    hasPng: false,
    hasPdf: false,
    isComplete: false,
    searchKeywords,
    createdAt: now,
    updatedAt: now,
    createdByUid: userId,
    updatedByUid: userId,
  };

  if (importKey !== undefined) designData.importKey = importKey || null;
  if (leagueCode !== undefined) designData.leagueCode = leagueCode || null;
  if (themeCode !== undefined) designData.themeCode = themeCode || null;
  if (designFamily !== undefined) designData.designFamily = designFamily || null;
  if (importSource !== undefined) designData.importSource = importSource || null;
  if (importBatchId !== undefined) designData.importBatchId = importBatchId || null;
  if (importVersion !== undefined) designData.importVersion = importVersion || null;
  /** Read by onDesignCreated to gate which master blanks get auto-launched. Null = 8394-only fallback. */
  if (Array.isArray(targetBlankIds) && targetBlankIds.length > 0) {
    designData.targetBlankIds = targetBlankIds;
  }
  /** Library-only commit mode → trigger no-ops. Only stamped on create. */
  if (skipAutoLaunch === true) {
    designData.skipAutoLaunch = true;
  }
  /**
   * Operator-set storefront label. Trim + omit when empty so an empty input
   * doesn't stomp the merchandising fallback chain in production.
   */
  if (typeof productLabel === "string" && productLabel.trim()) {
    designData.productLabel = productLabel.trim();
  }
  /**
   * Ink/brand accent color (e.g. "ORANGE") — flows to product.accentColor and the
   * `color:` Shopify tag / smart collection. Uppercased for code convention; omitted
   * when empty so no null stomps downstream merges.
   */
  if (typeof accentColor === "string" && accentColor.trim()) {
    designData.accentColor = accentColor.trim().toUpperCase();
  }

  const designRef = await db.collection("designs").add(designData);
  await designRef.update({ id: designRef.id });
  return { designId: designRef.id, slug };
}

function parseBulkDesignUploadPreviewImpl(db, storage) {
  return async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication required");
    }
    const uid = context.auth.uid;
    await assertAdminOrOps(uid);

    const jobId = data.jobId;
    if (!jobId || typeof jobId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "jobId is required");
    }
    const filesIn = Array.isArray(data.files) ? data.files : [];
    const options = data.options || {};
    const requirePng = options.requirePng !== false;

    const jobRef = db.collection("rp_design_import_jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Import job not found");
    }
    const jobData = jobSnap.data();
    if (jobData.createdByUid !== uid) {
      throw new functions.https.HttpsError("permission-denied", "This import job belongs to another user");
    }

    const prefix = expectedRawPrefix(uid, jobId);
    const bucket = storage.bucket();
    const ignoredExtra = [];
    const sanitizedFiles = [];

    for (const f of filesIn) {
      if (!f || typeof f.storagePath !== "string" || typeof f.originalFilename !== "string") {
        ignoredExtra.push({ name: f?.originalFilename || "?", reason: "invalid_descriptor" });
        continue;
      }
      if (!f.storagePath.startsWith(prefix)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `storagePath must be under ${prefix}`
        );
      }
      const [exists] = await bucket.file(f.storagePath).exists();
      if (!exists) {
        ignoredExtra.push({ name: f.originalFilename, reason: "temp_file_missing" });
        continue;
      }
      const desc = {
        originalFilename: f.originalFilename,
        storagePath: f.storagePath,
        ext: (f.ext || "").toLowerCase().replace(/^\./, ""),
        size: typeof f.size === "number" ? f.size : 0,
        contentType: f.contentType,
      };
      const filt = filterServerDescriptor(desc);
      if (!filt.ok) {
        ignoredExtra.push(filt.ignored);
        continue;
      }
      sanitizedFiles.push(desc);
    }

    const [designsSnap, teamsSnap, blanksSnap] = await Promise.all([
      db.collection("designs").get(),
      db.collection("design_teams").get(),
      db.collection("rp_blanks").where("status", "==", "active").get(),
    ]);
    const designRows = designsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamRows = teamsSnap.docs.map(d => ({
      id: d.id,
      slug: d.data().slug,
      name: d.data().name,
      teamName: d.data().teamName,
      teamCode: d.data().teamCode,
      league: d.data().league,
      leagueCode: d.data().leagueCode || d.data().leagueId,
      leagueId: d.data().leagueId,
      /**
       * The team's approved-blank catalog. Needed so the preview can default the
       * blank picker to each team's matrix (e.g. thong only for teams that allow
       * it) instead of always pre-checking all pipeline-ready blanks. Mirrors the
       * server spawn precedence (resolveSpawnBlankIds).
       */
      productCatalogMatrix: d.data().productCatalogMatrix || null,
    }));
    /** Active **master** blanks only (schemaVersion=2); the picker shouldn't expose drafts. */
    const masterBlanks = blanksSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => Number(b.schemaVersion) === 2)
      .map((b) => ({
        id: b.id,
        styleCode: b.styleCode || null,
        name: b.name || b.productName || null,
        category: b.category || null,
        schemaVersion: b.schemaVersion,
        status: b.status,
      }));

    const { items, parseFailures, ignored } = buildPreviewItems(
      sanitizedFiles,
      designRows,
      teamRows,
      masterBlanks,
      { requirePng }
    );
    const allIgnored = [...(ignored || []), ...ignoredExtra.map(x => ({ name: x.name, reason: x.reason }))];

    const now = admin.firestore.FieldValue.serverTimestamp();
    await jobRef.update({
      status: "parsing",
      updatedAt: now,
      importVersion: IMPORT_VERSION,
    });

    await deleteAllItems(jobRef);
    await writeItems(jobRef, items);

    const acceptedFiles = sanitizedFiles.length;
    const totalFiles = filesIn.length;
    await jobRef.update({
      status: "ready",
      updatedAt: now,
      totalFiles,
      acceptedFiles,
      ignoredFiles: allIgnored.length,
      groupedDesignCount: items.length,
      ignoredList: allIgnored,
      parseFailures,
      summary: null,
    });

    return {
      ok: true,
      jobId,
      items,
      parseFailures,
      ignored: allIgnored,
      job: {
        status: "ready",
        totalFiles,
        acceptedFiles,
        ignoredFiles: allIgnored.length,
        groupedDesignCount: items.length,
      },
    };
  };
}

function commitBulkDesignUploadImpl(db, storage) {
  return async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication required");
    }
    const uid = context.auth.uid;
    await assertAdminOrOps(uid);

    const jobId = data.jobId;
    if (!jobId || typeof jobId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "jobId is required");
    }
    const decisions = Array.isArray(data.items) ? data.items : [];
    if (decisions.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "items array is required");
    }
    /**
     * `commitMode`: "with_products" (default) auto-launches products via
     * `onDesignCreated`; "library" creates the design docs only, stamping
     * `skipAutoLaunch:true` so the trigger no-ops. The stored `targetBlankIds`
     * stay valid in either case so a later manual launch can use them.
     */
    const commitMode = data && data.commitMode === "library" ? "library" : "with_products";
    const skipAutoLaunchForNewDesigns = commitMode === "library";

    const jobRef = db.collection("rp_design_import_jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Import job not found");
    }
    const jobData = jobSnap.data();
    if (jobData.createdByUid !== uid) {
      throw new functions.https.HttpsError("permission-denied", "This import job belongs to another user");
    }
    if (jobData.status === "completed") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This import job is already completed; create a new job to import again."
      );
    }
    const committable = ["ready", "partial", "failed", "importing"];
    if (!committable.includes(jobData.status)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Job is not ready to commit (status: ${jobData.status})`
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await jobRef.update({ status: "importing", updatedAt: now });

    const bucket = storage.bucket();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let blocked = 0;
    let failed = 0;

    const results = [];

    for (const dec of decisions) {
      const itemId = dec.itemId;
      if (!itemId || typeof itemId !== "string") {
        failed++;
        results.push({ itemId: itemId || "?", resultStatus: "failed", resultError: "missing itemId" });
        continue;
      }

      const itemRef = jobRef.collection("items").doc(itemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        failed++;
        results.push({ itemId, resultStatus: "failed", resultError: "item not found" });
        continue;
      }
      const item = itemSnap.data();
      const prevStatus = item.resultStatus;

      if (prevStatus === "ok" || prevStatus === "skipped") {
        results.push({
          itemId,
          resultStatus: prevStatus,
          resultDesignId: item.resultDesignId || null,
          resultError: null,
          note: "unchanged (idempotent)",
        });
        if (prevStatus === "skipped") skipped++;
        continue;
      }

      const action = (dec.action || item.confirmedAction || item.defaultAction || "").toLowerCase();
      const overwriteAllowed = !!dec.overwriteAllowed;

      const nameOverride = dec.name != null ? String(dec.name).trim() : null;
      const teamIdOverride = dec.teamId != null ? String(dec.teamId).trim() : null;
      const themeCodeOverride = dec.themeCode != null ? String(dec.themeCode).trim() : null;
      const designSeriesOverride =
        dec.designSeries !== undefined ? normalizeDesignSeriesInput(dec.designSeries) : undefined;
      const slugOverride = dec.slug != null ? String(dec.slug).trim() : null;
      /**
       * Operator-selected blanks for auto-launch. Trimmed + deduped; empty array
       * falls through to the trigger's default 8394-only behavior. Stored on the
       * design doc so onDesignCreated can filter master blanks accordingly.
       */
      const targetBlankIdsOverride = Array.isArray(dec.targetBlankIds)
        ? [...new Set(dec.targetBlankIds.map((x) => String(x || "").trim()).filter(Boolean))]
        : null;
      /** Operator-set storefront short label. Empty/whitespace = leave unset → fallback chain wins. */
      const productLabelOverride = typeof dec.productLabel === "string" ? dec.productLabel.trim() : null;
      /** Operator-set ink/brand accent color (e.g. "orange"). Empty = no color tag. */
      const accentColorOverride = typeof dec.accentColor === "string" ? dec.accentColor.trim() : null;

      let designName = nameOverride || item.designName;
      let teamId = teamIdOverride || item.teamId || BATCH_IMPORT_TEAM_ID;
      let themeCode = themeCodeOverride !== null && themeCodeOverride !== "" ? themeCodeOverride : item.themeCode;
      let designSeries =
        designSeriesOverride !== undefined ? designSeriesOverride : item.designSeries;
      let slug = slugOverride || item.slug;

      if (action === "skip") {
        skipped++;
        await itemRef.update({
          confirmedAction: "skip",
          resultStatus: "skipped",
          resultError: null,
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "skipped", resultDesignId: null });
        continue;
      }

      if (action === "blocked") {
        blocked++;
        await itemRef.update({
          confirmedAction: "blocked",
          resultStatus: "blocked",
          resultError: (item.errors && item.errors[0]) || "blocked",
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "blocked", resultError: "blocked" });
        continue;
      }

      const errs = item.errors || [];
      const hasDuplicateError = errs.some(e => /duplicate/i.test(String(e)));
      if (hasDuplicateError) {
        blocked++;
        await itemRef.update({
          resultStatus: "blocked",
          resultError: errs.join("; "),
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "blocked", resultError: errs.join("; ") });
        continue;
      }
      if (errs.length > 0) {
        blocked++;
        await itemRef.update({
          resultStatus: "blocked",
          resultError: errs.join("; "),
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "blocked", resultError: errs.join("; ") });
        continue;
      }

      if (!hasAnyPng(item.assetCoverage)) {
        blocked++;
        await itemRef.update({
          resultStatus: "blocked",
          resultError: "No PNG — not render-ready",
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "blocked", resultError: "No PNG" });
        continue;
      }

      if (action === "create" && item.existingDesignId) {
        failed++;
        await itemRef.update({
          resultStatus: "failed",
          resultError: "Cannot create: design already matched",
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "failed", resultError: "Cannot create: design already matched" });
        continue;
      }

      if (action === "update" && !item.existingDesignId) {
        failed++;
        await itemRef.update({
          resultStatus: "failed",
          resultError: "Cannot update: no existing design",
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "failed", resultError: "Cannot update: no existing design" });
        continue;
      }

      const designType = item.designType || "custom_one_off";
      if (!isAllowedDesignTheme(designType)) {
        failed++;
        await itemRef.update({
          resultStatus: "failed",
          resultError: "Invalid designType",
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "failed", resultError: "Invalid designType" });
        continue;
      }

      let designId = item.existingDesignId || null;

      try {
        if (!designId && action === "create") {
          const createdRes = await createDesignDocument(db, uid, {
            name: designName,
            teamId,
            designType,
            designSeries,
            colors: DEFAULT_COLORS,
            slugOverride: slug,
            importKey: item.groupKey,
            leagueCode: item.leagueCode,
            teamCode: item.teamCode,
            themeCode,
            designFamily:
              designType === "city_69" ? "city_69" : themeCode ? String(themeCode).toLowerCase() : null,
            importSource: "bulk_upload",
            importBatchId: jobId,
            importVersion: IMPORT_VERSION,
            /** Operator's blank-picker selection; null = trigger uses 8394 fallback. */
            targetBlankIds: targetBlankIdsOverride && targetBlankIdsOverride.length > 0
              ? targetBlankIdsOverride
              : (Array.isArray(item.defaultTargetBlankIds) && item.defaultTargetBlankIds.length > 0
                  ? item.defaultTargetBlankIds
                  : null),
            /**
             * Library-only commit: stamp skipAutoLaunch so onDesignCreated
             * no-ops. Only applies to newly-created designs; existing designs
             * being updated keep their prior skipAutoLaunch value untouched.
             */
            skipAutoLaunch: skipAutoLaunchForNewDesigns,
            /** Storefront label override (empty = use designType fallback). */
            productLabel: productLabelOverride,
            /** Ink/brand accent color → color: tag on spawned products. */
            accentColor: accentColorOverride,
          });
          designId = createdRes.designId;
          created++;
        } else if (designId && action === "update") {
          const dRef = db.collection("designs").doc(designId);
          const dSnap = await dRef.get();
          if (!dSnap.exists) {
            throw new Error("Existing design doc missing");
          }
          const patch = { updatedAt: now, updatedByUid: uid };
          if (designName) patch.name = designName;
          if (themeCode !== undefined) patch.themeCode = themeCode || null;
          if (designSeries !== undefined) patch.designSeries = designSeries;
          if (slug) patch.slug = slug;
          await dRef.update(patch);
          updated++;
        } else {
          throw new Error("Invalid action / design state");
        }

        const designSnap = await db.collection("designs").doc(designId).get();
        let designData = designSnap.data();

        for (const fileRow of item.files || []) {
          const kind = fileRow.kind;
          if (!DESIGN_FILE_KINDS.has(kind)) continue;

          const existingUrl = existingUrlForFileKind(designData, kind);
          if (existingUrl && !overwriteAllowed) {
            continue;
          }

          const { fileEntry } = await copyTempToDesignAsset(
            bucket,
            fileRow.storagePath,
            designId,
            kind,
            fileRow.originalFilename,
            fileRow.size,
            fileRow.contentType,
            uid
          );
          await applyFileToDesign(db, designId, uid, kind, fileEntry);
          const refreshed = await db.collection("designs").doc(designId).get();
          designData = refreshed.data();
        }

        await itemRef.update({
          confirmedAction: action,
          overwriteAllowed,
          resultStatus: "ok",
          resultDesignId: designId,
          resultError: null,
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "ok", resultDesignId: designId });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await itemRef.update({
          resultStatus: "failed",
          resultError: msg,
          updatedAt: now,
        });
        results.push({ itemId, resultStatus: "failed", resultError: msg });
      }
    }

    let jobStatus = "completed";
    if (failed > 0 && (created > 0 || updated > 0)) jobStatus = "partial";
    else if (failed > 0 && created === 0 && updated === 0) jobStatus = "failed";

    const summaryObj = {
      created,
      updated,
      skipped,
      blocked,
      failed,
    };

    await jobRef.update({
      status: jobStatus,
      updatedAt: now,
      createdDesignCount: created,
      updatedDesignCount: updated,
      skippedCount: skipped,
      blockedDesignCount: blocked,
      failedCount: failed,
      summary: JSON.stringify(summaryObj),
    });

    return {
      ok: true,
      jobId,
      status: jobStatus,
      results,
      summary: summaryObj,
    };
  };
}

function registerBulkDesignImportHandlers(exportsObj, functionsObj, adminApp) {
  const db = adminApp.firestore();
  const storage = adminApp.storage();
  exportsObj.parseBulkDesignUploadPreview = functionsObj.https.onCall(
    parseBulkDesignUploadPreviewImpl(db, storage)
  );
  exportsObj.commitBulkDesignUpload = functionsObj.https.onCall(
    commitBulkDesignUploadImpl(db, storage)
  );
}

module.exports = {
  registerBulkDesignImportHandlers,
  parseBulkDesignUploadPreviewImpl,
  commitBulkDesignUploadImpl,
};
