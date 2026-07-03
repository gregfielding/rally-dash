"use strict";

/**
 * Shared implementation: parent rp_products doc + Color × Size variant subdocs (sizes from blank or XS–XL).
 * Used by createProductFromDesignBlank callable and bulk find-or-create.
 *
 * Product materialization depends only on **blank** (matrix, render, placement) + **design** (artwork, metadata);
 * model identity / LoRA are not required here.
 *
 * @param {object} ctx
 * @param {FirebaseFirestore.Firestore} ctx.db
 * @param {typeof import("firebase-admin")} ctx.admin
 * @param {typeof import("firebase-functions")} ctx.functions
 * @param {function} ctx.designPngUrlForProcessing
 * @param {function} ctx.buildInitialRenderSetupForProduct
 * @param {function} ctx.resolveBlankVariantForProduct
 * @param {function} ctx.buildProductIdentityKey
 * @param {function} ctx.buildParentProductIdentityKey
 * @param {number} ctx.MASTER_BLANK_SCHEMA_VERSION
 * @param {function} ctx.sanitizeForFirestore
 * @param {function} ctx.deriveAvailableSizesFromBlank
 * @param {function} ctx.deriveSizesForProductMatrix
 * @param {object} ctx.merchandisingAtCreate
 * @param {object} ctx.resolveBlankTemplates
 * @param {string} ctx.designId
 * @param {string} ctx.blankId
 * @param {string} [ctx.blankVariantId]
 * @param {string} ctx.userId
 */
const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
const {
  buildSku,
  buildDesignCodeForSku,
  resolveColorCodeForSku,
  assertDistinctSkuCandidates,
} = require("./buildSku");
const { assertSkusUnusedInDatastore } = require("./skuUniqueness");
const { parentProductDocId, variantProductDocId } = require("./parentProductDocId");
const { slugifyUnderscore: tagsSlugifyUnderscore } = require("./buildProductTags");

function deriveColorFamilyFromName(colorName) {
  const dark = new Set(["black", "midnight navy", "navy", "indigo"]);
  const n = String(colorName || "")
    .trim()
    .toLowerCase();
  return dark.has(n) ? "dark" : "light";
}

async function runCreateProductFromDesignBlankCore(ctx) {
  const {
    db,
    admin,
    functions,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
    designId,
    blankId,
    blankVariantId,
    userId,
  } = ctx;

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
  }
  const design = designSnap.data();

  if (!designPngUrlForProcessing(design)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Design missing PNG overlay. Upload light/dark PNGs (or legacy PNG) in Design Detail → Files before creating a product."
    );
  }

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  }
  const blank = blankSnap.data();

  if (blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION && (!blank.variants || blank.variants.length === 0)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Master blank has no variants; add at least one color variant before creating a product."
    );
  }

  const sideRes = resolvePrintSidesForProductBuild(blank, design);
  if (!sideRes.canGenerate) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      sideRes.blockMessage || "Design and blank print sides are incompatible."
    );
  }

  const variantRow = resolveBlankVariantForProduct(blank, blankVariantId);

  let team = null;
  if (design.teamId) {
    const teamSnap = await db.collection("design_teams").doc(design.teamId).get();
    if (teamSnap.exists) {
      const teamData = teamSnap.data();
      team = {
        id: teamSnap.id,
        name: teamData.name ?? null,
        teamCode: teamData.teamCode ?? null,
        city: teamData.city ?? null,
        teamName: teamData.teamName ?? null,
        league: teamData.league ?? null,
        leagueId: teamData.leagueId ?? null,
        leagueCode: teamData.leagueCode ?? null,
        stadiumName: teamData.stadiumName ?? null,
        teamSaying: teamData.teamSaying ?? null,
        fanPhrase: teamData.fanPhrase ?? null,
        slug: teamData.slug ?? null,
      };
    }
  }

  const leagueCodeRaw = design.leagueCode || (team && (team.leagueId || team.league)) || "";
  const teamCodeRaw = design.teamCode || (team && (team.teamCode || team.id)) || design.teamId || "";
  const variantIdOrLegacy =
    blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION && variantRow.variantId
      ? variantRow.variantId
      : "legacy";
  const parentProductIdentityKey = buildParentProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId,
    blankId,
  });

  const parentSnap = await db
    .collection("rp_products")
    .where("parentProductIdentityKey", "==", parentProductIdentityKey)
    .limit(8)
    .get();
  const parentDocExisting = parentSnap.docs.find((doc) => doc.data().productKind === "parent");

  const blankVersionUsed =
    blank.version != null
      ? blank.version
      : blank.updatedAt && typeof blank.updatedAt.toMillis === "function"
        ? blank.updatedAt.toMillis()
        : null;
  const designVersionUsed =
    design.updatedAt && typeof design.updatedAt.toMillis === "function"
      ? design.updatedAt.toMillis()
      : null;

  const colorNameForProduct = variantRow.colorName || "";
  const colorTitle =
    String(colorNameForProduct || "")
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(" ") || "Default";

  const teamNameFull = merchandisingAtCreate.buildTeamDisplayName(team, design);
  const designShortName = merchandisingAtCreate.designTypeToStorefrontShort(design.designType);
  const designName = merchandisingAtCreate.buildDesignNameForTemplates(design, teamNameFull, designShortName);
  /**
   * Template token semantics:
   * - teamName = nickname/short token (e.g. "Giants")
   * - teamNameFull = full display name (e.g. "San Francisco Giants")
   * This avoids duplicate city/team phrases when templates use "{city} {teamName}".
   */
  const teamName =
    (team && team.teamName && String(team.teamName).trim()) ||
    teamNameFull ||
    "Design";
  const designThemeLabel = merchandisingAtCreate.designTypeToLabel(design.designType);
  const designThemeSlug = merchandisingAtCreate.designTypeToThemeSlug(design.designType);
  const designSeriesStr =
    design.designSeries != null && String(design.designSeries).trim()
      ? String(design.designSeries).trim()
      : "";
  const templateContext = {
    teamName,
    teamNameFull,
    designName,
    designShortName,
    designSeries: designSeriesStr,
    colorName: colorNameForProduct,
    garmentStyle: blank.garmentStyle || blank.styleName || blank.styleCode || "",
    category: blank.shopifyDefaults?.productType ?? blank.category ?? blank.garmentCategory ?? "",
    brand: blank.shopifyDefaults?.brand ?? blank.shopifyDefaults?.vendor ?? "",
    vendor: blank.shopifyDefaults?.brand ?? blank.shopifyDefaults?.vendor ?? "",
    league: team?.league ?? "",
    city: team?.city ?? "",
    stadiumName: team?.stadiumName ?? "",
    teamSaying: team?.teamSaying ?? "",
    fanPhrase: team?.fanPhrase ?? "",
    designThemeLabel,
    designTheme: design.designType ?? "",
    designThemeSlug,
    designStyle: designThemeLabel,
    teamCity: team?.city ?? "",
  };
  const templateContextParent = { ...templateContext, colorName: "" };
  const resolvedParent = resolveBlankTemplates(blank, templateContextParent);
  const parentBundle = merchandisingAtCreate.buildResolvedMerchandisingBundleForParent({
    team,
    design,
    blank,
    resolvedBlankDescription: resolvedParent.description,
  });

  const now = admin.firestore.FieldValue.serverTimestamp();

  const FALLBACK_PRICE_8394 = 24.99;
  const FALLBACK_WEIGHT_G_8394 = Math.round(0.1 * 453.592);

  const dp = blank.defaultPricing || {};
  let retail = dp.retailPrice != null ? dp.retailPrice : dp.basePrice;
  if ((retail == null || !Number.isFinite(Number(retail))) && String(blank.styleCode || "").trim() === "8394") {
    retail = FALLBACK_PRICE_8394;
  }

  let defaultWeightGrams =
    blank.defaultShipping && blank.defaultShipping.defaultWeightGrams != null
      ? Number(blank.defaultShipping.defaultWeightGrams)
      : null;
  if (defaultWeightGrams == null || !Number.isFinite(defaultWeightGrams)) {
    defaultWeightGrams =
      String(blank.styleCode || "").trim() === "8394" ? FALLBACK_WEIGHT_G_8394 : 0;
  }
  const requiresShippingDefault =
    blank.defaultShipping && blank.defaultShipping.requiresShipping === false ? false : true;

  const pricingBlock =
    retail != null && Number.isFinite(Number(retail))
      ? {
          basePrice: Number(retail),
          compareAtPrice: dp.compareAtPrice != null ? Number(dp.compareAtPrice) : undefined,
          currencyCode: (dp.currencyCode && String(dp.currencyCode).trim()) || "USD",
        }
      : undefined;

  const shippingBlock = {
    defaultWeightGrams,
    requiresShipping: requiresShippingDefault,
  };

  const designCode = buildDesignCodeForSku({
    designFamily: parentBundle.tax.designFamily,
    designSeries: design.designSeries,
    themeCode: parentBundle.tax.themeCode,
    designType: design.designType,
    designId,
  });
  const colorCode = resolveColorCodeForSku(colorNameForProduct);

  const leagueSku = leagueCodeRaw || "XX";
  const teamSku = teamCodeRaw || "XX";
  /**
   * Phase A0 (2026-06-01): inject blank styleCode into the SKU so the same
   * design on different blanks for the same team doesn't collide on the
   * duplicate-SKU precheck. Falls back to "XX" if the blank somehow has no
   * styleCode (would only happen on a non-master blank used for tests).
   */
  const blankSku = String(blank.styleCode || "").trim() || "XX";

  const isV2Master = blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION;
  const initialRender = buildInitialRenderSetupForProduct({
    design,
    blank,
    variantRow,
    designId,
  });

  /** Parent row (existing or created after SKU precheck). New parents must not be written until SKU checks pass — otherwise a duplicate SKU error leaves an orphan parent with zero variant subdocs. */
  let parentRef = null;
  let parentSlug = null;
  let parentId = null;
  /** Firestore payload for a brand-new parent; the create runs only after assertSkusUnusedInDatastore succeeds. */
  let pendingNewParentPayload = null;
  /** True when our deterministic-id `.create()` lost the race to a concurrent launch and we reused its parent. */
  let parentCreateRaceLost = false;

  if (parentDocExisting) {
    parentRef = parentDocExisting.ref;
    parentId = parentDocExisting.id;
    parentSlug = parentDocExisting.data().slug;
  } else {
    let slug = parentBundle.handleSlug;
    const existing = await db.collection("rp_products").where("slug", "==", slug).get();
    if (!existing.empty) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    const handle = slug;
    parentSlug = slug;

    pendingNewParentPayload = {
      productKind: "parent",
      schemaVersion: 1,
      parentProductIdentityKey,
      teamId:
        parentBundle.tax.taxonomy?.teamId ??
        parentBundle.tax.taxonomy?.teamSlug ??
        design.teamId ??
        null,
      teamCode:
        parentBundle.tax.teamCode ??
        (team && team.teamCode && String(team.teamCode).trim() ? String(team.teamCode).trim().toUpperCase() : null) ??
        (design.teamCode && String(design.teamCode).trim() ? String(design.teamCode).trim().toUpperCase() : null),
      teamName: team?.name ?? design.teamNameCache ?? null,
      designName: design.name ?? null,
      blankStyleCode: blank.styleCode ?? null,
      blankStyleName: blank.styleName || blank.garmentStyle || null,
      slug,
      handle,
      name: parentBundle.displayTitle,
      title: parentBundle.displayTitle,
      description: parentBundle.descriptionText || null,
      descriptionHtml: parentBundle.descriptionHtml || null,
      descriptionText: parentBundle.descriptionText || null,
      shortDescription: parentBundle.shortDescription || null,
      category: "panties",
      productType: blank.shopifyDefaults?.productType ?? undefined,
      brand: blank.shopifyDefaults?.brand ?? blank.shopifyDefaults?.vendor ?? undefined,
      collectionKeys: parentBundle.collectionKeys?.length ? parentBundle.collectionKeys : undefined,
      seo: parentBundle.seo
        ? {
            title: parentBundle.seo.title ?? null,
            description: parentBundle.seo.description ?? null,
          }
        : undefined,
      sportCode: parentBundle.tax.sportCode ?? null,
      leagueCode: parentBundle.tax.leagueCode ?? null,
      themeCode: parentBundle.tax.themeCode ?? null,
      accentColor: parentBundle.tax.accentColor ?? null,
      designFamily: parentBundle.tax.designFamily ?? null,
      taxonomy: parentBundle.tax.taxonomy ?? null,
      baseProductKey: `DESIGN_${designId}_BLANK_${blankId}`,
      blankVersionUsed,
      designVersionUsed,
      blankId,
      shopifyVariantMode: blank.shopifyVariantMode != null && blank.shopifyVariantMode !== "" ? blank.shopifyVariantMode : "color",
      blankVariantId: null,
      designId,
      designSeries: design.designSeries ?? null,
      variantSummary: [],
      variantCount: 0,
      defaultVariantId: null,
      heroVariantId: null,
      displayMedia: null,
      availableSizes: deriveSizesForProductMatrix(blank),
      ai: {
        productArtifactId: null,
        productTrigger: null,
        productRecommendedScale: null,
        blankTemplateId: null,
      },
      status: "draft",
      tags: parentBundle.tags,
      tagsNormalized: parentBundle.tagsNormalized,
      pricing: pricingBlock,
      shipping: shippingBlock,
      counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };
  }

  const blankVariantFk = isV2Master ? variantRow.variantId : blankVariantId || "legacy";
  const sizesList = deriveSizesForProductMatrix(blank);

  const existingForColorSnap = parentRef
    ? await parentRef.collection("variants").where("blankVariantId", "==", blankVariantFk).get()
    : { docs: [], empty: true };

  const existingBySize = new Map();
  let legacyNoSizeDoc = null;
  for (const d of existingForColorSnap.docs) {
    const data = d.data();
    const sz = data.optionValues && data.optionValues.size;
    if (sz) {
      existingBySize.set(String(sz), d);
    } else {
      legacyNoSizeDoc = d;
    }
  }

  let sizesToCreate = sizesList.filter((s) => !existingBySize.has(s));
  const skusToRegister = [];
  let wroteAnyVariant = false;

  let legacyLeadPatch = null;
  if (legacyNoSizeDoc && existingBySize.size === 0 && sizesList.length > 0) {
    const leadSize = sizesList[0];
    const leadKey = buildProductIdentityKey({
      leagueCode: leagueCodeRaw,
      teamCode: teamCodeRaw,
      designId,
      blankId,
      blankVariantIdOrLegacy: variantIdOrLegacy,
      garmentSizeCode: leadSize,
    });
    const legacyDupLead = await db
      .collection("rp_products")
      .where("productIdentityKey", "==", leadKey)
      .limit(1)
      .get();
    if (!legacyDupLead.empty) {
      const d = legacyDupLead.docs[0];
      throw new functions.https.HttpsError(
        "already-exists",
        `A product already exists for this design + blank + variant + size (identity key). slug: ${d.data().slug || d.id}`,
        { productId: d.id, slug: d.data().slug }
      );
    }
    const existingSku = legacyNoSizeDoc.data().sku;
    const newSku =
      existingSku && String(existingSku).trim()
        ? String(existingSku).trim()
        : buildSku({
            leagueCode: leagueSku,
            teamCode: teamSku,
            designCode,
            blankCode: blankSku,
            colorCode,
            size: leadSize,
          });
    if (!existingSku || !String(existingSku).trim()) {
      skusToRegister.push(newSku);
    }
    legacyLeadPatch = {
      ref: legacyNoSizeDoc.ref,
      payload: sanitizeForFirestore({
        variantIdentityKey: leadKey,
        optionValues: { color: colorTitle, size: leadSize },
        sku: newSku,
        inventory: { quantity: 999, management: null },
        taxable: true,
        pricing: pricingBlock,
        shipping: shippingBlock,
        updatedAt: now,
        updatedBy: userId,
      }),
    };
    existingBySize.set(leadSize, legacyNoSizeDoc);
    sizesToCreate = sizesList.slice(1);
  }

  for (const sizeCode of sizesToCreate) {
    skusToRegister.push(
      buildSku({ leagueCode: leagueSku, teamCode: teamSku, designCode, blankCode: blankSku, colorCode, size: sizeCode })
    );
  }
  if (skusToRegister.length > 0) {
    assertDistinctSkuCandidates(skusToRegister);
    try {
      await assertSkusUnusedInDatastore(db, skusToRegister);
    } catch (skuErr) {
      const msg = skuErr && skuErr.message ? String(skuErr.message) : "SKU check failed";
      /** Only our explicit duplicate message should map to already-exists. Firestore index/query errors often look like `9 FAILED_PRECONDITION:` and were wrongly classified as duplicate SKU skips. */
      const isKnownDuplicate = /SKU already in use/i.test(msg);
      if (!isKnownDuplicate) {
        console.error(
          JSON.stringify({
            tag: "[TEAM_PRODUCT_GEN:SERVER:SKU_CHECK_FIRESTORE_ERROR]",
            blankVariantId: blankVariantFk,
            message: msg,
            code: skuErr && skuErr.code != null ? skuErr.code : null,
          })
        );
        throw new functions.https.HttpsError(
          "failed-precondition",
          `SKU uniqueness check failed (Firestore). Deploy indexes if you have not: firebase deploy --only firestore:indexes. Detail: ${msg}`
        );
      }
      console.log(
        JSON.stringify({
          tag: "[TEAM_PRODUCT_GEN:SERVER:SKIP_REASON]",
          reason: "duplicate_sku_precheck",
          blankVariantId: blankVariantFk,
          productId: parentId,
          slug: parentSlug || null,
          message: msg,
        })
      );
      throw new functions.https.HttpsError("already-exists", msg, {
        productId: parentId,
        slug: parentSlug || null,
        reason: "duplicate_sku",
      });
    }
  }

  if (pendingNewParentPayload && !parentRef) {
    /**
     * Concurrency-safe parent create. Derive a DETERMINISTIC doc id from
     * parentProductIdentityKey and `.create()` it (atomic; fails if the doc exists)
     * instead of `.add()`-ing a random id. Two auto-launches racing on the same
     * (league, team, design, blank) — e.g. two at-least-once `onDesignCreated`
     * deliveries — compute the SAME id, so the loser's create fails with
     * ALREADY_EXISTS and reuses the winner's parent rather than writing a duplicate.
     * This closes the read-then-write window in the parentProductIdentityKey query
     * above (which can't see a parent a concurrent run hasn't committed yet).
     */
    const deterministicParentRef = db
      .collection("rp_products")
      .doc(parentProductDocId(parentProductIdentityKey));
    try {
      await deterministicParentRef.create(sanitizeForFirestore(pendingNewParentPayload));
      parentRef = deterministicParentRef;
      parentId = parentRef.id;
      console.log("[createProductFromDesignBlank] Created parent product:", parentId, parentSlug);
    } catch (createErr) {
      const code = createErr && createErr.code;
      const msg = createErr && createErr.message ? String(createErr.message) : "";
      // gRPC ALREADY_EXISTS is code 6; admin SDK may surface the string code too.
      const alreadyExists = code === 6 || code === "already-exists" || /ALREADY_EXISTS/i.test(msg);
      if (!alreadyExists) throw createErr;
      // Lost the create race — a concurrent launch already created this parent. Reuse it.
      parentCreateRaceLost = true;
      parentRef = deterministicParentRef;
      parentId = parentRef.id;
      const winnerSnap = await deterministicParentRef.get();
      const winnerData = winnerSnap.exists ? winnerSnap.data() : null;
      if (winnerData && winnerData.slug) parentSlug = winnerData.slug;
      console.log(
        JSON.stringify({
          tag: "[TEAM_PRODUCT_GEN:SERVER:PARENT_CREATE_RACE]",
          note: "create_lost_reusing_existing_parent",
          parentProductId: parentId,
          parentProductIdentityKey,
          parentSlug: parentSlug || null,
        })
      );
    }
  }

  if (legacyLeadPatch) {
    await legacyLeadPatch.ref.set(legacyLeadPatch.payload, { merge: true });
    wroteAnyVariant = true;
  }

  if (sizesToCreate.length > 0) {
    for (const sizeCode of sizesToCreate) {
      const variantIdentityKey = buildProductIdentityKey({
        leagueCode: leagueCodeRaw,
        teamCode: teamCodeRaw,
        designId,
        blankId,
        blankVariantIdOrLegacy: variantIdOrLegacy,
        garmentSizeCode: sizeCode,
      });

      const legacyDup = await db
        .collection("rp_products")
        .where("productIdentityKey", "==", variantIdentityKey)
        .limit(1)
        .get();
      if (!legacyDup.empty) {
        const d = legacyDup.docs[0];
        throw new functions.https.HttpsError(
          "already-exists",
          `A product already exists for this design + blank + variant + size (identity key). slug: ${d.data().slug || d.id}`,
          { productId: d.id, slug: d.data().slug }
        );
      }

      const sku = buildSku({
        leagueCode: leagueSku,
        teamCode: teamSku,
        designCode,
        blankCode: blankSku,
        colorCode,
        size: sizeCode,
      });

      const vRef = parentRef.collection("variants").doc(variantProductDocId(variantIdentityKey));
      const variantData = {
        productKind: "variant",
        schemaVersion: 1,
        parentProductId: parentId,
        variantIdentityKey,
        blankVariantId: blankVariantFk,
        designId,
        blankId,
        optionValues: { color: colorTitle, size: sizeCode },
        colorName: variantRow.colorName || "",
        colorHex: variantRow.colorHex ?? null,
        colorFamily:
          variantRow.colorFamily === "light" || variantRow.colorFamily === "dark"
            ? variantRow.colorFamily
            : deriveColorFamilyFromName(variantRow.colorName || ""),
        preferredArtworkTone: variantRow.preferredArtworkTone ?? null,
        sku,
        inventory: { quantity: 999, management: null },
        taxable: true,
        status: "active",
        shopify: { variantId: null, status: "not_synced" },
        designIdFront: initialRender.designIdFront,
        designIdBack: initialRender.designIdBack,
        renderSetup: initialRender.renderSetup || undefined,
        renderConfig: initialRender.renderConfig || undefined,
        mockupUrl: null,
        media: {},
        flatRenders: null,
        sceneRenders: null,
        ai: {
          productArtifactId: null,
          productTrigger: null,
          productRecommendedScale: null,
          blankTemplateId: null,
        },
        blankVersionUsed,
        designVersionUsed,
        pricing: pricingBlock,
        shipping: shippingBlock,
        counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
      };

      /**
       * Deterministic id + atomic create: racing at-least-once auto-launch deliveries
       * collide on ALREADY_EXISTS instead of duplicating per-(color,size). On collision
       * we skip — the existing doc (and any renders already written to it) wins.
       */
      try {
        await vRef.create(sanitizeForFirestore(variantData));
        wroteAnyVariant = true;
      } catch (e) {
        if (e && e.code === 6 /* ALREADY_EXISTS */) {
          console.log(
            `[runCreateProductFromDesignBlankCore] variant ${vRef.id} already exists (identityKey=${variantIdentityKey}); skipping duplicate create`
          );
        } else {
          throw e;
        }
      }
    }
  } else if (existingBySize.size === 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No garment sizes configured for this blank and no legacy variant to upgrade."
    );
  }

  const postSnap = await parentRef.collection("variants").where("blankVariantId", "==", blankVariantFk).get();
  const allVariantsSnap = await parentRef.collection("variants").get();
  const sizeOrder = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };
  const sortRows = allVariantsSnap.docs.map((d) => {
    const v = d.data();
    const sz = (v.optionValues && v.optionValues.size) || "";
    return {
      variantId: d.id,
      blankVariantId: v.blankVariantId,
      colorName: v.colorName || "",
      colorHex: v.colorHex ?? null,
      sizeCode: sz || null,
      sortSize: sizeOrder[sz] != null ? sizeOrder[sz] : 99,
    };
  });
  sortRows.sort((a, b) => {
    const c = String(a.colorName).localeCompare(String(b.colorName));
    if (c !== 0) return c;
    return a.sortSize - b.sortSize;
  });
  const variantSummary = sortRows.map((r, i) => ({
    variantId: r.variantId,
    blankVariantId: r.blankVariantId,
    colorName: r.colorName,
    colorHex: r.colorHex,
    sizeCode: r.sizeCode,
    isDefault: i === 0,
  }));

  const uniqueBlankVariantKeys = [...new Set(sortRows.map((r) => r.blankVariantId).filter(Boolean))];
  const colorVariantCount = uniqueBlankVariantKeys.length;

  const parentAfter = (await parentRef.get()).data() || {};
  const prevDefaultId = parentAfter.defaultVariantId;
  const stillExists = prevDefaultId && allVariantsSnap.docs.some((d) => d.id === prevDefaultId);
  const nextDefaultId = stillExists ? prevDefaultId : variantSummary[0] ? variantSummary[0].variantId : null;

  /**
   * Garment-color rollup: unique fabric colorNames across ALL variants (this runs after
   * every color lands, so it converges as colors accumulate). Persisted as
   * `garmentColors` and reflected into structured `garment:` tags for color-pair
   * merchandising ("blue garment + white ink"). We rewrite ONLY the garment: entries in
   * the tag list — operator-added and taxonomy tags are preserved untouched.
   */
  const garmentColors = [...new Set(sortRows.map((r) => String(r.colorName || "").trim()).filter(Boolean))];
  const garmentTags = garmentColors.map((c) => `garment:${tagsSlugifyUnderscore(c)}`).filter((t) => t !== "garment:");
  const prevTags = Array.isArray(parentAfter.tags) ? parentAfter.tags : [];
  const nonGarmentTags = prevTags.filter((t) => !String(t).toLowerCase().startsWith("garment:"));
  const nextTags = [...new Set([...nonGarmentTags, ...garmentTags])];

  const parentUpdate = {
    variantSummary,
    variantCount: variantSummary.length,
    colorVariantCount,
    garmentColors,
    tags: nextTags,
    tagsNormalized: nextTags.map((t) => String(t).toLowerCase()),
    updatedAt: now,
    updatedBy: userId,
    availableSizes: deriveSizesForProductMatrix(blank),
    defaultVariantId: nextDefaultId,
    heroVariantId: nextDefaultId,
  };
  if (!stillExists && nextDefaultId) {
    parentUpdate.displayMedia = parentAfter.displayMedia || { heroUrl: null, thumbUrl: null };
  }
  await parentRef.update(sanitizeForFirestore(parentUpdate));

  let primaryVariantIdForColor = null;
  for (const d of postSnap.docs) {
    const v = d.data();
    if ((v.optionValues && v.optionValues.size) === sizesList[0]) {
      primaryVariantIdForColor = d.id;
      break;
    }
  }
  if (!primaryVariantIdForColor && postSnap.docs.length > 0) {
    primaryVariantIdForColor = postSnap.docs[0].id;
  }

  if (primaryVariantIdForColor && postSnap.docs.length > 0) {
    const inhBatch = db.batch();
    for (const d of postSnap.docs) {
      const isPrimary = d.id === primaryVariantIdForColor;
      inhBatch.update(
        d.ref,
        sanitizeForFirestore({
          isPrimaryForColor: isPrimary,
          inheritsMediaFromVariantId: isPrimary ? null : primaryVariantIdForColor,
          updatedAt: now,
          updatedBy: userId,
        })
      );
    }
    await inhBatch.commit();
  }

  const variantIdsThisColor = postSnap.docs.map((d) => d.id);

  let returnVariantId = null;
  for (const d of postSnap.docs) {
    const v = d.data();
    if ((v.optionValues && v.optionValues.size) === sizesList[0]) {
      returnVariantId = d.id;
      break;
    }
  }
  if (!returnVariantId) returnVariantId = postSnap.docs[0] ? postSnap.docs[0].id : null;

  console.log(
    JSON.stringify({
      tag: "[TEAM_PRODUCT_GEN:SERVER:CORE_SUMMARY]",
      parentProductId: parentId,
      parentSlug: parentSlug || null,
      blankVariantId: blankVariantFk,
      colorName: colorNameForProduct || null,
      sizesToCreateCount: sizesToCreate.length,
      wroteAnyVariant,
      variantFirestoreIdsThisColor: variantIdsThisColor,
      variantSubdocCountForColor: postSnap.docs.length,
      parentVariantSummaryLength: variantSummary.length,
      colorVariantCountWritten: colorVariantCount,
    })
  );

  return {
    ok: true,
    productId: parentId,
    slug: parentSlug,
    variantId: returnVariantId,
    variantIds: variantIdsThisColor,
    /**
     * True if parent `rp_products` doc already existed before this run (team gen /
     * multi-color), OR we lost the deterministic-id create race and reused a concurrent
     * launch's parent — either way this run did not author a fresh parent.
     */
    parentExisted: !!parentDocExisting || parentCreateRaceLost,
  };
}

module.exports = runCreateProductFromDesignBlankCore;
