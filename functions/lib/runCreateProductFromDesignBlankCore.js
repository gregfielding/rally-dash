"use strict";

/**
 * Shared implementation: parent rp_products doc + one variant subdoc.
 * Used by createProductFromDesignBlank callable and bulk find-or-create.
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
 * @param {object} ctx.merchandisingAtCreate
 * @param {object} ctx.resolveBlankTemplates
 * @param {string} ctx.designId
 * @param {string} ctx.blankId
 * @param {string} [ctx.blankVariantId]
 * @param {string} ctx.userId
 */
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
  const variantIdentityKey = buildProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId,
    blankId,
    blankVariantIdOrLegacy: variantIdOrLegacy,
  });
  const parentProductIdentityKey = buildParentProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId,
    blankId,
  });

  const legacyDup = await db
    .collection("rp_products")
    .where("productIdentityKey", "==", variantIdentityKey)
    .limit(1)
    .get();
  if (!legacyDup.empty) {
    const d = legacyDup.docs[0];
    const dslug = d.data().slug || d.id;
    throw new functions.https.HttpsError(
      "already-exists",
      `A product already exists for this design + blank + variant (identity key). slug: ${dslug}`,
      { productId: d.id, slug: d.data().slug }
    );
  }

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

  const dp = blank.defaultPricing || {};
  const retail = dp.retailPrice != null ? dp.retailPrice : dp.basePrice;

  const isV2Master = blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION;
  const initialRender = buildInitialRenderSetupForProduct({
    design,
    blank,
    variantRow,
    designId,
  });

  let parentRef;
  let parentSlug;
  let parentId;

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

    const parentData = {
      productKind: "parent",
      schemaVersion: 1,
      parentProductIdentityKey,
      teamId: design.teamId || null,
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
      designFamily: parentBundle.tax.designFamily ?? null,
      taxonomy: parentBundle.tax.taxonomy ?? null,
      baseProductKey: `DESIGN_${designId}_BLANK_${blankId}`,
      blankVersionUsed,
      designVersionUsed,
      blankId,
      blankVariantId: null,
      designId,
      designSeries: design.designSeries ?? null,
      variantSummary: [],
      variantCount: 0,
      defaultVariantId: null,
      heroVariantId: null,
      displayMedia: null,
      availableSizes: deriveAvailableSizesFromBlank(blank),
      ai: {
        productArtifactId: null,
        productTrigger: null,
        productRecommendedScale: null,
        blankTemplateId: null,
      },
      status: "draft",
      tags: parentBundle.tags,
      tagsNormalized: parentBundle.tagsNormalized,
      pricing:
        blank.defaultPricing &&
        (retail != null ||
          dp.basePrice != null ||
          dp.compareAtPrice != null ||
          (dp.currencyCode && String(dp.currencyCode).trim()))
          ? {
              basePrice: retail ?? dp.basePrice ?? undefined,
              compareAtPrice: dp.compareAtPrice ?? undefined,
              currencyCode: (dp.currencyCode && String(dp.currencyCode).trim()) || "USD",
            }
          : undefined,
      shipping:
        blank.defaultShipping &&
        (blank.defaultShipping.defaultWeightGrams != null || blank.defaultShipping.requiresShipping != null)
          ? {
              defaultWeightGrams: blank.defaultShipping.defaultWeightGrams ?? undefined,
              requiresShipping: blank.defaultShipping.requiresShipping ?? true,
            }
          : undefined,
      counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    parentRef = await db.collection("rp_products").add(sanitizeForFirestore(parentData));
    parentId = parentRef.id;
    console.log("[createProductFromDesignBlank] Created parent product:", parentId, slug);
  }

  const dupVar = await parentRef.collection("variants").where("blankVariantId", "==", variantRow.variantId).limit(1).get();
  if (!dupVar.empty) {
    const v = dupVar.docs[0];
    throw new functions.https.HttpsError(
      "already-exists",
      `Variant already exists for this parent (blankVariantId ${variantRow.variantId}).`,
      { productId: parentId, slug: parentSlug, variantId: v.id }
    );
  }

  const variantRef = parentRef.collection("variants").doc();
  const variantData = {
    productKind: "variant",
    schemaVersion: 1,
    parentProductId: parentId,
    variantIdentityKey,
    blankVariantId: isV2Master ? variantRow.variantId : blankVariantId || "legacy",
    designId,
    blankId,
    optionValues: { color: colorTitle },
    colorName: variantRow.colorName || "",
    colorHex: variantRow.colorHex ?? null,
    sku: null,
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
    pricing:
      blank.defaultPricing &&
      (retail != null ||
        dp.basePrice != null ||
        dp.compareAtPrice != null ||
        (dp.currencyCode && String(dp.currencyCode).trim()))
        ? {
            basePrice: retail ?? dp.basePrice ?? undefined,
            compareAtPrice: dp.compareAtPrice ?? undefined,
            currencyCode: (dp.currencyCode && String(dp.currencyCode).trim()) || "USD",
          }
        : undefined,
    shipping:
      blank.defaultShipping &&
      (blank.defaultShipping.defaultWeightGrams != null || blank.defaultShipping.requiresShipping != null)
        ? {
            defaultWeightGrams: blank.defaultShipping.defaultWeightGrams ?? undefined,
            requiresShipping: blank.defaultShipping.requiresShipping ?? true,
          }
        : undefined,
    counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  await variantRef.set(sanitizeForFirestore(variantData));

  const parentAfter = (await parentRef.get()).data() || {};
  const prevSummary = Array.isArray(parentAfter.variantSummary) ? [...parentAfter.variantSummary] : [];
  const isFirst = prevSummary.length === 0;
  const summaryRow = {
    variantId: variantRef.id,
    blankVariantId: variantRow.variantId,
    colorName: variantRow.colorName || "",
    colorHex: variantRow.colorHex ?? null,
    isDefault: isFirst,
  };
  prevSummary.push(summaryRow);

  const parentUpdate = {
    variantSummary: prevSummary,
    variantCount: prevSummary.length,
    updatedAt: now,
    updatedBy: userId,
    availableSizes: deriveAvailableSizesFromBlank(blank),
  };
  if (isFirst) {
    parentUpdate.defaultVariantId = variantRef.id;
    parentUpdate.heroVariantId = variantRef.id;
    parentUpdate.displayMedia = { heroUrl: null, thumbUrl: null };
  }
  await parentRef.update(sanitizeForFirestore(parentUpdate));

  console.log("[createProductFromDesignBlank] Created variant:", variantRef.id, "under parent", parentId);

  return {
    ok: true,
    productId: parentId,
    slug: parentSlug,
    variantId: variantRef.id,
  };
}

module.exports = runCreateProductFromDesignBlankCore;
