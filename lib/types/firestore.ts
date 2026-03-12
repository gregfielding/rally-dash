import { Timestamp } from "firebase/firestore";

export interface League {
  id?: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Team {
  id?: string;
  leagueId: string;
  name: string;
  slug: string;
  city: string;
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  keywords: string[];
  bannedTerms: string[];
  notes?: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Taxonomy (rp_taxonomy_* collections, per RALLY_TAXONOMY_SPEC / RALLY_TAXONOMY_SEEDER_SPEC)
export interface RpTaxonomySport {
  id: string;
  code: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder?: number | null;
  description?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RpTaxonomyLeague {
  id: string;
  code: string;
  name: string;
  slug: string;
  sportCode?: string | null;
  active: boolean;
  sortOrder?: number | null;
  description?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Entity type for taxonomy entities (teamCode resolves from entity record; do not store on product). */
export type RpTaxonomyEntityType =
  | "pro_team"
  | "college"
  | "club"
  | "driver"
  | "constructor"
  | "brand"
  | "athlete"
  | "generic_entity"
  | "team"        // legacy alias for pro_team
  | "motorsport_team"; // legacy alias for constructor

export interface RpTaxonomyEntity {
  id: string;
  code: string;
  name: string;
  slug: string;
  sportCode?: string | null;
  leagueCode?: string | null;
  entityType: RpTaxonomyEntityType;
  active: boolean;
  aliases?: string[] | null;
  sortOrder?: number | null;
  metadata?: { city?: string | null; state?: string | null; country?: string | null };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type RpTaxonomyThemeType = "generic_sport" | "humor" | "lifestyle" | "topical" | "campaign";

export interface RpTaxonomyTheme {
  id: string;
  code: string;
  name: string;
  slug: string;
  sportCode?: string | null;
  leagueCode?: string | null;
  active: boolean;
  themeType?: RpTaxonomyThemeType | null;
  sortOrder?: number | null;
  description?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RpTaxonomyDesignFamily {
  id: string;
  code: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder?: number | null;
  description?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Optional display names resolved from taxonomy (e.g. for UI labels). */
export interface RpTaxonomyDisplay {
  sportName?: string;
  leagueName?: string;
  teamName?: string;
  themeName?: string;
}

export interface Product {
  id?: string;
  name: string;
  skuPrefix: string;
  printArea: {
    widthIn: number;
    heightIn: number;
    dpi: number;
    x: number;
    y: number;
  };
  basePhotos?: {
    flatLayUrl?: string;
    hangerUrl?: string;
  };
  mockupTemplateId?: string;
  variants?: Array<{
    name: string;
    type: "color" | "size";
    values: string[];
  }>;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// LoRA Ops Types
export interface ModelPack {
  id?: string;
  packName: string; // e.g., "Pack A – Rally Girls Core"
  packKey?: string; // stable identifier like "pack_a_core" (optional for backward compat)
  packCode: string; // internal identifier like "pack_a_core" (auto-generated from packName)
  version: string; // e.g., "v1", "v2"
  provider: "fal" | "replicate" | "runpod";
  status: "draft" | "dataset_ready" | "training" | "ready" | "failed" | "archived";
  loraModelId?: string | null;
  loraModelVersion?: string | null;
  recommendedPrompt?: string;
  negativePrompt?: string;
  createdAt: Timestamp;
  createdBy?: string; // user UID or email
  createdByUid?: string; // backward compat
  updatedAt?: Timestamp;
  notes?: string;
  identityCount?: number;
  faceImageCount?: number;
  datasetIdActive?: string | null;
  lastTrainingJobId?: string | null;
}

export interface FaceImageMetadata {
  url: string;
  type?: "close" | "mid" | "full" | "anchor";
  source?: "generated" | "uploaded" | "stock" | "licensed";
  qualityScore?: number; // 1-5
  containsLogos?: boolean;
  approved?: boolean;
  rejected?: boolean;
  rejectionReason?: string;
  rightsAttested?: boolean;
  rightsAttestedAt?: Timestamp;
  uploadedAt?: Timestamp;
}

export interface StructuredNotes {
  voiceQuirks?: string;
  doDont?: string;
  visualMotifs?: string;
  locations?: string;
  raw?: string; // Fallback for legacy data
}

export interface IdentityProfile {
  promptSignature?: string; // Short stable descriptor for prompts
  negativeSignature?: string; // Stable negatives
  visualMotifs?: string[]; // e.g., ["karaoke mic", "houseplants", "vintage tees"]
  locations?: string[]; // e.g., ["Marina", "Tahoe", "Ocean Beach"]
}

export interface ModelPackIdentity {
  id?: string;
  packId: string;
  name: string; // e.g., "Amber"
  token: string; // trigger token, e.g., "rp_amber"
  bodyType: Array<"petite" | "athletic" | "curvy" | "plus" | "tall" | "slim" | "fit" | "average" | "other">;
  ageRange: "21-29" | "30-39" | "40-49" | "50+" | "unspecified" | string; // Allow custom ranges like "26-32"
  ethnicity?: string;
  styleVibe?: string;
  
  // Pack A persona fields
  hometown?: string;
  region?: string;
  neighborhood?: string; // e.g., "Marina District, San Francisco"
  almaMater?: string; // e.g., "University of Southern California (USC)" - separate from teams
  college?: string; // Legacy field, use almaMater instead
  primaryTeams?: string[]; // e.g., ["NFL – 49ers", "MLB – Giants", "NCAA – USC"] - one per league
  primaryNCAATeam?: string; // Separate NCAA primary team
  secondaryTeams?: string[]; // e.g., ["MLB – Giants"]
  fandomIntensity?: "die-hard" | "strong" | "casual";
  personaBio?: string;
  notes?: string; // Legacy - use structuredNotes instead
  structuredNotes?: StructuredNotes; // Structured notes with sections
  
  // Identity profile for prompts
  identityProfile?: IdentityProfile;
  
  instagram?: {
    handle?: string;
    accountStatus?: "draft" | "active" | "planned" | "paused";
    contentTone?: string;
    postingStyle?: string;
  };
  
  status: "draft" | "faces_complete" | "needs_more_faces" | "archived";
  faceImagePaths?: string[]; // Legacy - use faceImages with metadata
  faceImages?: FaceImageMetadata[]; // New structure with metadata
  faceImageCount: number;
  faceImagesApproved?: number; // Count of approved images
  canTrain?: boolean; // Training readiness flag
  poseCoverage?: {
    front: boolean;
    threeQuarter: boolean;
    profile: boolean;
    smile: boolean;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReferenceImage {
  id?: string;
  category: "stadium" | "tailgate" | "sportsbar" | "streetwear" | "winter" | "studio" | "other";
  tags: string[];
  gcsPath: string;
  source: "stock" | "self" | "ai_generated" | "other";
  safeToUse: boolean;
  notes?: string;
  createdAt: Timestamp;
  createdByUid: string;
}

export interface TrainingDataset {
  id?: string;
  packId: string;
  status: "building" | "ready" | "failed" | "archived";
  zipGcsPath: string | null;
  manifestGcsPath: string | null;
  faceImageCount: number;
  identityCount: number;
  groupImageCount: number;
  referenceImageCount: number;
  captionStyle: "simple_tokens" | "detailed";
  buildOptions: {
    perIdentityFaceMin: number;
    includeGroupShots: boolean;
    groupShotCountTarget: number;
    referenceCategoryMix: Record<string, number>;
  };
  createdAt: Timestamp;
  createdByUid: string;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TrainingJob {
  id?: string;
  packId: string;
  datasetId: string;
  provider: "fal" | "replicate" | "runpod";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  providerJobId: string;
  providerModelId: string | null;
  providerModelVersion: string | null;
  requestedAt: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  progress: number | null; // 0-100
  logs: string[];
  result?: {
    loraArtifactUrl?: string;
    modelId?: string;
  };
  error?: {
    message: string;
    code?: string;
    raw?: any;
  };
}

// ---------------------------------------------------------------------------
// fal.ai LoRA integration types (rp_* collections)
// ---------------------------------------------------------------------------

// 2.1 Identity (rp_identities/{identityId})
// Source-of-truth for identity-level LoRA linkage.
export type RPIdentityStatus = "draft" | "ready" | "trained";

export interface RPIdentity {
  id?: string;
  name: string; // "Amber"

  // Stable trigger token, immutable once created.
  token: string; // e.g. "rp_amber"

  // Default trigger phrase used in training/inference.
  // In most cases this should equal token and is treated as the system source of truth.
  defaultTriggerPhrase: string;

  status: RPIdentityStatus;

  // Currently active LoRA artifact for this identity.
  activeLoraArtifactId?: string;

  /**
   * Optional per-kind active artifacts. These enable separate face/body/style
   * LoRAs while keeping backward compatibility with activeLoraArtifactId.
   */
  activeFaceArtifactId?: string;
  activeBodyArtifactId?: string;

   // Optional active prompt / scale / endpoint overrides for inference.
   activeTriggerPhrase?: string;
   activeLoraScaleDefault?: number;
   activeInferenceEndpoint?: string;

  // Optional denormalized counts (not strictly source-of-truth)
  faceImageCount?: number;
  upperBodyCount?: number;
  fullBodyCount?: number;

  // Audit
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 2.2 Dataset (rp_datasets/{datasetId})
export type RPDatasetType = "face" | "upper_body" | "full_body" | "mixed";
export type RPDatasetStatus = "draft" | "ready" | "archived";

export interface RPDataset {
  id?: string;
  identityId: string;
  name: string;                 // "Amber Face v1"
  type: RPDatasetType;
  targetImageCount: number;     // recommended >= 20 for face
  status: RPDatasetStatus;
  /**
   * Optional human-readable description for UI. Not required by backend
   * workflows but useful when managing many datasets.
   */
  description?: string;

  // Versioning / zip caching
  contentHash?: string;
  lastZipStoragePath?: string;
  lastZipSignedUrl?: string;
  lastZipCreatedAt?: Timestamp;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 2.3 Dataset Images (rp_dataset_images/{imageId})
export type RPDatasetImageKind = "face" | "upper_body" | "full_body";
export type RPDatasetImageSource =
  | "fal_inference"
  | "midjourney"
  | "manual_upload";

export interface RPDatasetImage {
  id?: string;
  datasetId: string;
  identityId: string;
  storagePath: string;
  downloadUrl: string;
  kind: RPDatasetImageKind;
  source: RPDatasetImageSource;
  isApproved: boolean;

  // Optional traceability / reproducibility
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  scale?: number;
  steps?: number;
  loraId?: string;
  falInferenceRequestId?: string;

  createdAt: Timestamp;
}

// 3.1 Training Job (rp_training_jobs/{jobId})
export type RPTrainingJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface RPTrainingJob {
  id?: string;
  identityId: string;
  datasetId: string;
  identityName?: string;
  datasetName?: string;
  provider: "fal";
  trainerEndpoint: string;     // e.g. "fal-ai/flux-lora-portrait-trainer"
  triggerPhrase: string;       // usually identity token
  status: RPTrainingJobStatus;

  // Recommended inputs / hyperparams
  steps?: number;
  learningRate?: number;
  seed?: number;
  captioningMode?: "none" | "auto";

  // fal request tracking
  falRequestId?: string;
  falTrainerEndpoint?: string; // exact endpoint string called on fal side
  falRequestPayload?: Record<string, any>;
  falResponseMeta?: Record<string, any>;

  // Timings
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;

  // Failure info
  error?: string;

  // Outputs
  loraWeightsUrl?: string;
  previewImageUrls?: string[];
  outputFiles?: Array<{ name: string; url: string }>;

  // Optional Storage linkage / logs
  loraWeightsStoragePath?: string;
  logsUrl?: string;
}

// 4.1 LoRA Artifact (rp_lora_artifacts/{loraId})
export type RPLoraArtifactStatus = "active" | "inactive" | "archived";

export interface RPLoraArtifact {
  id?: string;
  identityId: string;
  trainingJobId: string;
  provider: "fal";
  weightsUrl: string;          // .safetensors URL
  triggerPhrase: string;       // usually token
  status: RPLoraArtifactStatus;

  name?: string;               // "Amber LoRA v1"
  trainerEndpoint?: string;
  datasetId?: string;
  recommendedScale?: number;   // Single recommended scale (default 0.65)
  recommendedScaleMin?: number;
  recommendedScaleMax?: number;
  defaultScale?: number;
  notes?: string;
  weightsStoragePath?: string;
  qualityRating?: number;      // 1–5 internal rating
  testPrompt?: string;

  createdAt: Timestamp;

  /**
   * Optional kind tag to distinguish face/body/style/product artifacts.
   * Used by the app to drive stacking and UI selection.
   */
  artifactKind?: "face" | "body" | "style" | "product";
}

// 5.1 Generation (rp_generations/{genId})
export interface RPGeneration {
  id?: string;
  identityId: string;
  loraId: string;
  provider: "fal";
  endpoint: string;            // e.g. "fal-ai/flux-lora"
  prompt: string;
  scale: number;
  resultImageUrls: string[];
  createdAt: Timestamp;

  negativePrompt?: string;
  steps?: number;
  seed?: number;
  imageSize?: { w: number; h: number };
  numImages?: number;

  // fal tracking
  falRequestId?: string;
  falRequestPayload?: Record<string, any>;
  falResponseMeta?: Record<string, any>;

  // App-level metadata
  mirroredStoragePaths?: string[];
  selectedAsHero?: boolean;
  addedToDatasetId?: string;
  savedToReferenceLibrary?: boolean;
}

export interface AuditLog {
  id?: string;
  actorUid: string;
  action: string; // e.g., "IDENTITY_FACE_UPLOADED"
  entityType: "model_pack" | "identity" | "reference_image" | "training_dataset" | "training_job";
  entityId: string;
  createdAt: Timestamp;
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Product System Types (rp_* collections)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bulk Generation Jobs (rp_bulk_generation_jobs)
// ---------------------------------------------------------------------------

export type RpBulkGenerationJobStatus = "pending" | "running" | "completed" | "failed";

export interface RpBulkGenerationJobProgress {
  total: number;
  completed: number;
  failed: number;
}

export interface RpBulkGenerationJobOptions {
  imagesPerProduct?: number;
  presetId?: string; // Scene preset for generation jobs
}

export interface RpBulkGenerationJobResult {
  productId: string;
  designId: string;
  blankId: string;
  mockupStatus: "pending" | "done" | "failed";
  generationStatus: "pending" | "done" | "failed";
}

export interface RpBulkGenerationJob {
  id?: string;
  designIds: string[];
  blankIds: string[];
  identityIds: string[];
  options?: RpBulkGenerationJobOptions;
  status: RpBulkGenerationJobStatus;
  progress: RpBulkGenerationJobProgress;
  /** designId_blankId -> productId for idempotent product creation */
  productIdsByKey?: Record<string, string>;
  /** Number of generation jobs created (used for resumable worker) */
  generationJobsCreated?: number;
  results?: RpBulkGenerationJobResult[];
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Bulk Generation Job Items (rp_bulk_generation_job_items) — child tasks
// ---------------------------------------------------------------------------

export type RpBulkGenerationJobItemStatus =
  | "pending"
  | "running"
  | "awaiting_mock"
  | "completed"
  | "failed";

export interface RpBulkGenerationJobItem {
  id?: string;
  bulkJobId: string;
  designId: string;
  blankId: string;
  identityId: string;
  productId?: string | null;
  mockJobId?: string | null;
  generationJobId?: string | null;
  status: RpBulkGenerationJobItemStatus;
  error?: string | null;
  attemptCount?: number;
  lastAttemptAt?: Timestamp | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 1.1 Product (rp_products/{productId})
export type RpProductStatus = "draft" | "active" | "archived";
export type RpProductCategory = "panties" | "bralette" | "tank" | "tee" | "other";

// ============================================================================
// Asset Collections & Organization
// ============================================================================

export interface RpAssetCollection {
  id?: string;
  name: string;
  description?: string;
  assetIds: string[];
  tags?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// Generation Templates
// ============================================================================

export interface RpGenerationTemplate {
  id?: string;
  name: string;
  description?: string;
  presetId: string;
  identityId?: string | null;
  faceArtifactId?: string | null;
  bodyArtifactId?: string | null;
  scales?: {
    face?: number;
    body?: number;
    product?: number;
  };
  imageCount?: number;
  imageSize?: "square" | "portrait" | "landscape";
  tags?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// Notifications
// ============================================================================

export interface RpNotification {
  id?: string;
  userId: string;
  type: "generation_complete" | "generation_failed" | "batch_complete" | "review_requested";
  title: string;
  message: string;
  relatedJobId?: string;
  relatedAssetId?: string;
  relatedProductId?: string;
  read: boolean;
  createdAt: Timestamp;
}

export interface RpNotificationPreferences {
  id?: string;
  userId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  types: {
    generation_complete?: boolean;
    generation_failed?: boolean;
    batch_complete?: boolean;
    review_requested?: boolean;
  };
  updatedAt: Timestamp;
}

// ============================================================================
// Inspiration Library Types
// ============================================================================

export type RpInspirationSource = "etsy" | "pinterest" | "shopify" | "screenshot" | "internal" | "other";

export interface RpInspiration {
  id?: string;
  title: string;
  description?: string;
  sourceType: RpInspirationSource;
  sourceUrl?: string;
  category?: RpProductCategory;
  tags: string[];
  licenseNote?: string;
  imageUrls: string[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface RpProduct {
  id?: string; // productId
  slug: string; // for route /products/:slug
  name: string; // "SF Giants Classic Black"
  description?: string;

  // Spec alignment (RALLY_FIRESTORE_AND_PRODUCT_PAGE_MAPPING): merchandising + Shopify
  title?: string; // display title; fallback: name
  handle?: string; // URL handle; fallback: slug
  descriptionHtml?: string;
  descriptionText?: string;
  seo?: { title?: string; description?: string };
  collectionKeys?: string[];
  brand?: string;
  productType?: string;

  /** Taxonomy (RALLY_TAXONOMY_SPEC). Resolve against rp_taxonomy_* collections. */
  sportCode?: string | null;
  leagueCode?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  designFamily?: string | null;
  taxonomy?: RpTaxonomyDisplay | null;

  category: RpProductCategory;
  baseProductKey: string; // "SFGIANTS_PANTY_1" (style family)
  /** Batch import deduplication: leagueCode_designFamily_teamCode_blankId_variant (e.g. MLB_WILL_DROP_FOR_GIANTS_HEATHER_GREY_BIKINI_LIGHT). Side is not part of the key. */
  productIdentityKey?: string | null;
  /** Traceability: importKey of the design row(s) this product was generated from (e.g. MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT). Set on create/update from batch import. */
  generatedFromImportKey?: string | null;
  colorway: {
    name: string; // "Black"
    hex?: string; // "#000000"
  };

  supplier?: {
    supplierName?: string;
    supplierSku?: string;
    styleCode?: string;
  };

  // Blank reference (required for product-only generation)
  blankId?: string; // FK to rp_blanks - physical garment template

  // Design + Blank product flow (alignment: product = design + blank, mockup stored here)
  designId?: string; // FK to designs - artwork used for this product (primary; use designIdFront/Back for spec)
  designIdFront?: string; // spec: front design
  designIdBack?: string; // spec: back design
  mockupUrl?: string; // URL of generated mockup image (e.g. /products/{productId}/mockup.png)

  /**
   * UI-only state (e.g. which modal is open). Do not use for persisted render configuration.
   * Canonical render config lives in renderSetup.front / renderSetup.back.
   */
  renderConfig?: {
    renderSide?: "front" | "back";
    selectedBlankId?: string;
    selectedBlankImageUrl?: string;
    selectedDesignImageUrl?: string;
    selectedDesignImageUrlFront?: string;
    selectedDesignImageUrlBack?: string;
    placementKey?: string;
    placementOverride?: { x?: number; y?: number; scale?: number; width?: number; height?: number };
  };

  /**
   * Canonical render setup (RALLY_RENDER_SETUP_DATA_MODEL). Per-side config; renderer uses
   * renderSetup.front or renderSetup.back based on requested view. No renderSide toggle.
   */
  renderSetup?: {
    front?: {
      blankAssetId?: string | null;
      blankImageUrl?: string | null;
      designAssetId?: string | null;
      designAssetUrl?: string | null;
      placementKey?: string | null;
      placementOverride?: { x?: number; y?: number; scale?: number } | null;
      maskUrl?: string | null;
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null;
      blendOpacity?: number | null;
    } | null;
    back?: {
      blankAssetId?: string | null;
      blankImageUrl?: string | null;
      designAssetId?: string | null;
      designAssetUrl?: string | null;
      placementKey?: string | null;
      placementOverride?: { x?: number; y?: number; scale?: number } | null;
      maskUrl?: string | null;
      blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null;
      blendOpacity?: number | null;
    } | null;
    defaults?: {
      blankId?: string | null;
      designIdFront?: string | null;
      designIdBack?: string | null;
    } | null;
    lastVerifiedAt?: Timestamp | null;
    lastVerifiedBy?: string | null;
  };

  // AI Links (core)
  ai: {
    productArtifactId?: string; // reference to rp_lora_artifacts doc (Product LoRA)
    productTrigger?: string; // e.g. "rp_sfg_panty_1"
    productRecommendedScale?: number; // e.g. 0.9
    blankTemplateId?: string; // deprecated: use blankId instead
  };

  // Workflow
  status: RpProductStatus; // "draft" until ready
  tags?: string[];

  // Simple analytics
  counters?: {
    assetsTotal?: number;
    assetsApproved?: number;
    assetsPublished?: number;
  };

  // Hero image (legacy single hero)
  heroAssetId?: string;
  heroAssetPath?: string;

  // Spec: media slots (hero front/back, gallery, etc.)
  media?: {
    heroFront?: string; // URL or assetId
    heroBack?: string;
    gallery?: string[];
    modelAssets?: string[];
    lifestyleAssets?: string[];
  };

  // Spec: production (PDFs, print colors, notes)
  production?: {
    printPdfFront?: string;
    printPdfBack?: string;
    printPdfMaster?: string;
    printColors?: string[];
    productionNotes?: string;
  };

  // Spec: Shopify sync status
  shopify?: {
    productId?: string;
    variantId?: string | null;
    status?: "not_synced" | "queued" | "synced" | "error";
    lastSyncAt?: Timestamp;
    lastSyncError?: string;
  };

  // Optional: pricing + weight for readiness / Shopify
  pricing?: { basePrice?: number; compareAtPrice?: number; currencyCode?: string };
  shipping?: { defaultWeightGrams?: number; requiresShipping?: boolean };

  // Inspiration Library
  inspirationIds?: string[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

/** Shopify sync job (shopifySyncJobs). Created by UI; processed by worker. */
export interface ShopifySyncJob {
  id?: string;
  entityType: "product";
  entityId: string;
  action: "create_or_update";
  status: "queued" | "running" | "succeeded" | "failed";
  requestSummary?: string | null;
  responseSummary?: string | null;
  error?: string | null;
  createdAt: Timestamp;
  startedAt?: Timestamp | null;
  finishedAt?: Timestamp | null;
}

// 1.2 Product Design (rp_product_designs/{designId})
export type RpDesignStatus = "draft" | "approved" | "archived";
export type RpBriefStatus = "draft" | "final";
export type RpConceptStatus = "proposed" | "selected" | "rejected";

export type RpPrintMethod =
  | "screenprint"
  | "dtf"
  | "sublimation"
  | "embroidery"
  | "heat_transfer"
  | "unknown";

export type RpDesignPlacement =
  | "front_center"
  | "front_left"
  | "front_right"
  | "back_center"
  | "back_upper"
  | "back_lower"
  | "waistband"
  | "custom";

// Ink Color (for print/design)
export interface RpInkColor {
  name: string;
  hex?: string;
  pantone?: string;
  cmyk?: { c: number; m: number; y: number; k: number };
  notes?: string;
}

export interface RpProductDesign {
  id?: string; // designId
  productId: string; // parent SKU record
  
  designKey: string; // "GIANTS_WORDMARK" (version-independent key for versioning)
  slug: string; // "giants-wordmark-v1"
  name: string; // "GIANTS Wordmark — Rear Center — Orange Ink"
  code: string; // "SFGIANTS_PANTY_1_WORDMARK_A" (versioned)
  status: RpDesignStatus;
  version: number;

  // Design intent
  briefId?: string;
  description?: string;
  textElements?: string[];
  styleTags?: string[];

  // Color logic (colorway is on Product, ink colors are here)
  colorwayName?: string;
  colorwayHex?: string;
  inkColors: RpInkColor[];

  // Manufacturing constraints
  printMethod: RpPrintMethod;
  maxInkColors?: number;
  placement: RpDesignPlacement;
  placementNotes?: string;

  sizeSpec?: {
    widthIn?: number;
    heightIn?: number;
    notes?: string;
  };

  // Assets
  artwork: {
    // Upload your artwork (transparent PNG / SVG etc.)
    sourcePngPath?: string; // Storage path
    sourceSvgPath?: string;
    previewPath?: string; // optional pre-render
    width?: number;
    height?: number;
    notes?: string;
  };

  primaryPreviewUrl?: string;
  primaryPrintFileId?: string;

  // Optional: record how the artwork is applied to the garment blank
  placementData?: {
    zone?: RpDesignPlacement;
    // normalized box in [0..1] relative to blank template image
    bbox?: { x: number; y: number; w: number; h: number };
    rotationDeg?: number;
  };

  // AI metadata
  ai?: {
    source: "manual" | "ai-brief";
    lastPrompt?: string;
    model?: string;
    generatedAt?: Timestamp;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// 1.3 Scene Preset (rp_scene_presets/{presetId})
export type RpSceneType = "ecommerce" | "studio" | "lifestyle" | "social" | "ugc" | "video";
export type RpGenerationType = "product_only" | "on_model";
export type RpScenePresetMode = "onModel" | "productOnly";
export type RpSafetyProfile = "none" | "underwear_strict" | "general_safe";

export interface RpScenePreset {
  id?: string; // presetId
  name: string; // "Ecommerce White Seamless"
  slug?: string; // unique identifier
  description?: string;
  sceneType: RpSceneType;

  // NEW: Mode (replaces supportedModes)
  mode: RpScenePresetMode; // "onModel" | "productOnly"

  // Prompt templates. Use token placeholders.
  promptTemplate: string;
  negativePromptTemplate?: string;

  // Legacy: Supported generation modes (for backward compatibility)
  supportedModes?: RpGenerationType[]; // e.g. ["product_only","on_model"]

  // NEW: Guardrail toggles
  requireIdentity?: boolean; // defaults: true for onModel, false for productOnly
  allowFaceArtifact?: boolean; // defaults: true for onModel
  allowBodyArtifact?: boolean; // defaults: true for onModel
  allowProductArtifact?: boolean; // defaults: true

  // NEW: Safety profile
  safetyProfile?: RpSafetyProfile; // "none" | "underwear_strict" | "general_safe"

  // NEW: Default scales (at preset level)
  defaultFaceScale?: number; // recommend 0.80 for onModel
  defaultBodyScale?: number; // recommend 0.60 for onModel
  defaultProductScale?: number; // recommend 0.90
  defaultImageCount?: number; // recommend 4
  defaultSeed?: string | null;

  // Suggested generation settings (legacy, kept for backward compatibility)
  defaults?: {
    imageSize: "square" | "portrait" | "landscape";
    imageCount: number; // default 4
    seed?: number;
    // artifact scales
    faceScale?: number; // e.g. 0.75
    bodyScale?: number; // e.g. 0.6
    productScale?: number; // e.g. 0.9
    camera?: string;
    lighting?: string;
  };

  // Guardrails
  requiredTokens?: string[]; // ["{IDENTITY_TRIGGER}", "{PRODUCT_TRIGGER}"]

  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// 1.4 Generation Job (rp_generation_jobs/{jobId})
export type RpJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "processing" | "completed";

// NEW: Resolved LoRA structure
export interface RpResolvedLora {
  artifactId: string;
  type: "face" | "body" | "product";
  weight: number;
  trigger?: string; // optional (for debugging)
}

export interface RpGenerationJob {
  id?: string; // jobId
  productId: string;
  productSlug?: string; // NEW: snapshot
  designId?: string;
  
  // Generation type (legacy, kept for backward compatibility)
  generationType?: RpGenerationType; // "product_only" | "on_model"
  
  // NEW: Preset mode snapshot
  presetMode?: RpScenePresetMode; // "onModel" | "productOnly"
  
  presetId: string;
  
  // on_model-only fields (nullable for product_only)
  identityId?: string | null; // e.g. "amber" or artifact ref (required for on_model)
  faceArtifactId?: string | null;
  bodyArtifactId?: string | null;
  productArtifactId?: string | null;

  // Scales
  faceScale?: number;
  bodyScale?: number;
  productScale?: number;

  imageCount: number;
  size: "square" | "portrait" | "landscape";
  seed?: string | null;

  // NEW: Final resolved values saved for postmortem/debug
  resolvedPrompt: string;
  resolvedNegativePrompt: string;
  resolvedLoras: RpResolvedLora[];
  resolverTrace: string[]; // human-readable steps

  // Legacy: Resolved prompt (kept for backward compatibility)
  prompt?: string;
  negativePrompt?: string;

  // Legacy: Artifact stacking (kept for backward compatibility)
  artifacts?: {
    faceArtifactId?: string | null;
    faceScale?: number;
    bodyArtifactId?: string | null;
    bodyScale?: number;
    productArtifactId?: string | null;
    productScale?: number;
  } | null;

  // Debug info (written by worker, legacy)
  debug?: {
    resolvedPrompt?: string;
    negativePrompt?: string;
    identityTrigger?: string;
    productKey?: string;
    scenePresetId?: string;
    faceArtifactId?: string | null;
    faceScale?: number;
    bodyArtifactId?: string | null;
    bodyScale?: number;
    productArtifactId?: string | null;
    productScale?: number;
    imageSize?: string;
    imageCount?: number;
    seed?: number | null;
    usePlaceholderWorker?: boolean;
  };

  // Provider request metadata
  provider: "fal";
  endpoint: "fal-ai/flux-lora";
  params: {
    imageCount: number;
    size: "square" | "portrait" | "landscape";
    seed?: number;
  };

  // NEW: Cost tracking
  costEstimate?: number; // Estimated cost in USD (before generation)
  actualCost?: number; // Actual cost in USD (after completion, from provider)
  costCurrency?: string; // Default: "USD"

  // NEW: Retry logic
  retryCount?: number; // Number of retry attempts
  maxRetries?: number; // Maximum retries allowed (default: 3)
  lastRetryAt?: Timestamp; // When last retry was attempted

  // NEW: A/B Testing
  experimentId?: string; // Link to experiment if part of A/B test
  variantId?: string; // Variant identifier within experiment

  status: RpJobStatus;
  attempts: number;
  lastError?: {
    message: string;
    code?: string;
    raw?: any;
  };

  // Output
  outputs?: {
    images?: Array<{
      storagePath: string;
      downloadUrl?: string;
      width?: number;
      height?: number;
      sha256?: string;
      assetId?: string;
    }>;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// 1.5 Product Asset (rp_product_assets/{assetId})
export type RpAssetType = "onModelImage" | "productPackshot" | "lifestyleImage" | "socialPost" | "videoShort" | "other" | "image" | "video"; // "image" | "video" kept for backward compatibility
export type RpAssetStatus = "draft" | "approved" | "published" | "rejected";

export interface RpProductAsset {
  id?: string; // assetId
  productId: string;
  jobId?: string; // NEW: reference to generation job
  designId?: string;
  presetId?: string;
  
  // NEW: Asset type/intent
  assetType: RpAssetType; // "onModelImage" | "productPackshot" | etc.
  
  // Legacy: Generation type (kept for backward compatibility)
  generationType?: RpGenerationType; // "product_only" | "on_model"
  
  // NEW: Preset mode snapshot
  presetMode?: RpScenePresetMode; // "onModel" | "productOnly"
  
  // on_model-only (nullable for product_only)
  identityId?: string | null;

  // Legacy: type field (kept for backward compatibility)
  type?: RpAssetType;
  status: RpAssetStatus;

  storagePath?: string;
  publicUrl?: string; // NEW: public URL (alternative to downloadUrl)
  downloadUrl?: string; // Legacy, kept for backward compatibility
  thumbnailPath?: string;
  width?: number; // NEW
  height?: number; // NEW

  // Provenance
  generationJobId?: string; // Legacy, use jobId instead
  prompt?: string;
  negativePrompt?: string;
  artifacts?: RpGenerationJob["artifacts"];

  // Enhanced review workflow
  review?: {
    status?: "pending" | "approved" | "rejected" | "needs_revision";
    rating?: number; // 1-5 stars
    notes?: string;
    reviewedBy?: string;
    reviewedAt?: Timestamp;
    revisionNotes?: string; // Notes for revisions needed
  };

  // NEW: Asset deduplication
  imageHash?: string; // Perceptual hash for duplicate detection
  similarAssetIds?: string[]; // IDs of similar assets found

  // NEW: Collections
  collectionIds?: string[]; // Asset collections this belongs to

  // Spec: hero slot assignment (product Detail Media section)
  heroSlot?: "hero_front" | "hero_back";

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// ProductDesign + AI Design Brief System
// ============================================================================

// 1.8 Design Brief (rp_design_briefs/{briefId})
export interface RpDesignBrief {
  id?: string; // briefId
  productId: string;
  status: RpBriefStatus;

  title: string;
  objective: string;
  audience?: string;
  brandNotes?: string;

  constraints: {
    printMethod: RpPrintMethod;
    maxInkColors: number;
    mustIncludeText?: string[];
    avoid?: string[];
    placementOptions?: RpDesignPlacement[];
    colorway?: { name: string; hex?: string };
    requiredInkColors?: RpInkColor[];
    allowedInkColors?: RpInkColor[];
  };

  inspiration?: {
    notes?: string;
    links?: string[];
  };

  // Inspiration Library
  inspirationIds?: string[];

  aiOutput?: {
    summary: string;
    conceptsGenerated: number;
    model: string;
    prompt: string;
  };

  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}

// 1.9 Design Concept (rp_design_concepts/{conceptId})
export interface RpDesignConcept {
  id?: string; // conceptId
  productId: string;
  briefId: string;

  title: string;
  description: string;
  placement: RpDesignPlacement;
  inkColors: RpInkColor[];
  rationale?: string;

  status: RpConceptStatus;

  createdAt: Timestamp;
  createdBy: string;
}

// 1.10 Design File (rp_design_files/{fileId})
export interface RpDesignFile {
  id?: string; // fileId
  productId: string;
  designId: string;

  fileType: "png" | "svg" | "ai" | "psd" | "pdf";
  label: string;
  storagePath: string;
  sizeBytes: number;

  createdAt: Timestamp;
  createdBy: string;
}

// ============================================
// Blanks Library System (v2 - Per RP_Blanks_Library_Spec_v2.md)
// ============================================

// Supplier is fixed to Los Angeles Apparel
export type RPBlankSupplier = "Los Angeles Apparel";

// Style codes (5 styles)
export type RPBlankStyleCode = "8394" | "8390" | "TR3008" | "1822GD" | "HF07";

// Garment categories
export type RPBlankGarmentCategory = "panty" | "thong" | "tank" | "crewneck";

// Allowed colors (all colors across all styles)
export type RPBlankColorName =
  | "Black"
  | "White"
  | "Midnight Navy"
  | "Blue"
  | "Red"
  | "Heather Grey"
  | "Indigo"
  | "Athletic Grey"
  | "Navy"
  | "Off-White";

// Blank status
export type RPBlankStatus = "draft" | "active" | "archived";

// Image reference
export interface RPImageRef {
  storagePath: string;
  downloadUrl: string;
  width?: number;
  height?: number;
  contentType?: string;
  bytes?: number;
}

// Image metadata
export interface RPImageMeta {
  background: "white" | "transparent" | "unknown";
  source: "supplier" | "photo" | "generated";
  notes?: string;
}

// Placement configuration
export type RPPlacementId =
  | "front_center"
  | "back_center"
  | "front_left"
  | "front_right"
  | "back_left"
  | "back_right";

export interface RPPlacement {
  placementId: RPPlacementId;
  label: string;
  defaultX?: number;
  defaultY?: number;
  defaultScale?: number;
  safeArea?: { x: number; y: number; w: number; h: number };
}

// User reference
export interface RPUserRef {
  uid: string;
  email?: string;
}

// RPBlank document (rp_blanks/{blankId})
// Per Section 3.3 of the spec
export interface RPBlank {
  // Identity
  blankId: string;
  slug: string;
  status: RPBlankStatus;

  // Supplier + Style
  supplier: RPBlankSupplier;
  garmentCategory: RPBlankGarmentCategory;
  styleCode: RPBlankStyleCode;
  styleName: string;
  supplierUrl: string;
  supplierSku?: string;

  // Color
  colorName: RPBlankColorName;
  colorHex?: string;

  // Images (required: front + back)
  images: {
    front: RPImageRef | null;
    back: RPImageRef | null;
  };

  // Image metadata (optional)
  imageMeta?: RPImageMeta;

  // Print placement defaults
  placements: RPPlacement[];

  // Search + ops
  tags: string[];
  searchKeywords: string[];

  // Timestamps
  createdAt: Timestamp;
  createdBy: RPUserRef;
  updatedAt: Timestamp;
  updatedBy: RPUserRef;
}

// Legacy type aliases for backward compatibility
export type BlankSupplier = RPBlankSupplier;
export type BlankSupplierStyle = RPBlankStyleCode;
export type BlankGarmentType = RPBlankGarmentCategory;
export type BlankFitType = "bikini" | "thong";
export type BlankColorName = RPBlankColorName;
export type BlankStatus = RPBlankStatus;
export interface Blank extends RPBlank {}

// ============================================
// Design Assets Library System (Per RP_Design_Assets_Spec.md)
// ============================================

// Team document (teams/{teamId})
export interface DesignTeam {
  id: string;                       // 'sf_giants'
  name: string;                     // 'SF Giants'
  league?: string;                  // 'MLB'
  primaryColorHex?: string;         // '#FD5A1E'
  tags?: string[];                  // ['mlb','giants']
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Design status
export type DesignStatus = "draft" | "active" | "archived";

// Design file (embedded in DesignDoc)
export interface DesignFile {
  kind: "png" | "pdf" | "svg";
  storagePath: string;              // 'designs/{designId}/png|pdf|svg/...'
  downloadUrl?: string;             // cached, optional
  fileName: string;
  contentType: string;              // 'image/png' | 'application/pdf' | 'image/svg+xml'
  sizeBytes: number;
  widthPx?: number;                 // PNG only
  heightPx?: number;                // PNG only
  sha256?: string;                  // idempotency / dedupe
  uploadedAt: Timestamp;
  uploadedByUid: string;
}

// Design color (production ink color)
export interface DesignColor {
  hex: string;                      // '#000000'
  name?: string;                    // 'Black' / 'Giants Orange'
  role?: "ink" | "accent" | "underbase" | "unknown";
  notes?: string;                   // e.g. 'white underbase required'
}

// Design placement default (normalized coordinates)
export interface DesignPlacementDefault {
  placementId: "front_center" | "back_center" | string;
  // normalized coordinates within the blank preview image:
  // x,y in [0..1] representing center point
  x: number;                        // e.g. 0.50
  y: number;                        // e.g. 0.50
  // scale is relative to the shorter dimension of the blank image
  scale: number;                    // e.g. 0.60
  // safe area (padding) inside which the art must remain
  safeArea: {
    padX: number;                   // e.g. 0.20 (20% padding)
    padY: number;                   // e.g. 0.20
  };
  // optional rotation support (future)
  rotationDeg?: number;             // default 0
}

// Design document (designs/{designId})
export interface DesignDoc {
  id: string;                       // auto-id
  name: string;                     // 'Design 1'
  slug: string;                     // 'sf-giants-design-1'
  teamId: string;                   // 'sf_giants'
  teamNameCache?: string;           // 'SF Giants' (for list speed)
  status: DesignStatus;

  tags: string[];                   // ['sf-giants','mlb','orange-black']
  description?: string;

  // Batch import metadata (RALLY_BATCH_DESIGN_IMPORT) + taxonomy (RALLY_TAXONOMY_SPEC)
  importKey?: string;               // matching key: LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT
  sportCode?: string | null;        // e.g. 'BASEBALL'
  leagueCode?: string | null;      // e.g. 'MLB'
  designFamily?: string | null;     // e.g. 'WILL_DROP_FOR'
  teamCode?: string | null;         // e.g. 'GIANTS'
  themeCode?: string | null;        // e.g. 'FUNNY_BASEBALL' for generic/humor designs
  taxonomy?: { sportName?: string; leagueName?: string; teamName?: string; themeName?: string } | null;
  supportedSides?: string[];        // e.g. ['back']
  variant?: string;                 // e.g. 'LIGHT'

  // Files (SVG = master vector, PNG = rendering/AI, PDF = print vendor)
  files: {
    svg?: DesignFile;
    png?: DesignFile;
    pdf?: DesignFile;
  };

  // Production colors
  colors: DesignColor[];            // 1+ ink colors
  colorCount: number;               // denorm for filtering

  // Placement defaults (used by mock generator / product templates)
  placementDefaults: DesignPlacementDefault[];

  // Links (denorm quick stats)
  linkedBlankVariantCount: number;  // how many blank variants are associated
  linkedProductCount: number;       // products that use this design

  // Completeness indicators
  hasSvg: boolean;
  hasPng: boolean;
  hasPdf: boolean;
  isComplete: boolean;              // hasPng && hasPdf && colors.length>0 && teamId set (SVG optional for completeness)

  // Search keywords (for fast queries)
  searchKeywords: string[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  updatedByUid: string;
}

// Design link (designs/{designId}/links/{linkId})
export type DesignLinkType = "blank_variant" | "product";

export interface DesignLinkDoc {
  id: string;
  type: DesignLinkType;

  // when linking to blank variants:
  blankId?: string;                 // blank style group
  blankVariantId?: string;          // specific colorway
  blankSku?: string;                // supplier SKU or internal sku
  blankNameCache?: string;          // e.g. 'LA Apparel 8394'
  blankColorCache?: string;         // e.g. 'Black'

  // when linking to products:
  productId?: string;
  productNameCache?: string;

  createdAt: Timestamp;
  createdByUid: string;
}

// Print pack (print_packs/{packId})
export interface PrintPackDoc {
  id: string;
  designId: string;
  designNameCache: string;
  teamId: string;
  teamNameCache?: string;

  // Snapshot of design data at export time
  colors: DesignColor[];
  placementDefaults: DesignPlacementDefault[];

  // File URLs
  pngUrl?: string;
  pdfUrl?: string;

  // Linked blanks at export time
  linkedBlanks?: Array<{
    blankId: string;
    blankName: string;
    blankColor: string;
    blankSku?: string;
  }>;

  // Export metadata
  exportedAt: Timestamp;
  exportedByUid: string;
  format: "json" | "zip";
  zipStoragePath?: string;
}

// Default placement values (constants)
export const DEFAULT_DESIGN_PLACEMENTS: DesignPlacementDefault[] = [
  {
    placementId: "front_center",
    x: 0.50,
    y: 0.50,
    scale: 0.60,
    safeArea: { padX: 0.20, padY: 0.20 },
    rotationDeg: 0,
  },
  {
    placementId: "back_center",
    x: 0.50,
    y: 0.50,
    scale: 0.60,
    safeArea: { padX: 0.20, padY: 0.20 },
    rotationDeg: 0,
  },
];

// Hex color validation regex
export const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

// ============================================
// Product Mock Generation System (Per RP_Product_Mock_Generation_PNG_On_Blank_Spec.md)
// ============================================

// Mock job status
export type RpMockJobStatus = "queued" | "processing" | "succeeded" | "failed";

// Mock job placement
export interface RpMockPlacement {
  x: number;           // normalized 0..1
  y: number;           // normalized 0..1
  scale: number;       // e.g. 0.6
  safeArea: {
    padX: number;      // e.g. 0.2
    padY: number;      // e.g. 0.2
  };
  rotationDeg?: number;
}

// Mock job document (rp_mock_jobs/{jobId})
export interface RpMockJob {
  id: string;

  designId: string;
  blankId: string;

  view: "front" | "back";
  placementId: "front_center" | "back_center";

  quality: "draft" | "final";
  status: RpMockJobStatus;

  input: {
    blankImageUrl: string;
    designPngUrl: string;
    placement: RpMockPlacement;
  };

  output?: {
    draftAssetId?: string;
    finalAssetId?: string;
  };

  attempts: number;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };

  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
}

// Mock asset kind
export type RpMockAssetKind = "draft_composite" | "final_realistic";

// Mock asset provenance
export interface RpMockProvenance {
  jobId: string;
  modelProvider?: "fal";
  modelName?: string;
  params?: Record<string, any>;
  promptHash?: string;
}

// Mock asset image metadata
export interface RpMockImage {
  storagePath: string;
  downloadUrl: string;
  width?: number;
  height?: number;
  bytes?: number;
  contentType?: string;
}

// Mock asset document (rp_mock_assets/{assetId})
export interface RpMockAsset {
  id: string;

  designId: string;
  blankId: string;
  view: "front" | "back";
  placementId: "front_center" | "back_center";

  kind: RpMockAssetKind;

  image: RpMockImage;

  provenance: RpMockProvenance;

  approved: boolean;
  approvedAt?: Timestamp;
  approvedByUid?: string;

  createdAt: Timestamp;
  createdByUid: string;
}

// Default placement for mock generation (global fallback)
export const DEFAULT_MOCK_PLACEMENT: RpMockPlacement = {
  x: 0.5,
  y: 0.5,
  scale: 0.6,
  safeArea: { padX: 0.2, padY: 0.2 },
  rotationDeg: 0,
};

// ============================================
// Blank Mask System (Phase 3 - Per RP_Product_Mock_Generation_PNG_On_Blank_Spec.md)
// ============================================

// Mask mode (extensible for future use)
export type RPBlankMaskMode = "inpaint" | "control";

// Blank mask document (rp_blank_masks/{blankId}_{view})
// One document per blank + view combination
export interface RPBlankMask {
  id: string;                     // e.g. "abc123_front"
  
  blankId: string;                // FK to rp_blanks
  view: "front" | "back";
  
  mask: RPImageRef;               // PNG mask file (white = editable, black = protected)
  
  mode: RPBlankMaskMode;          // "inpaint" (default)
  
  notes?: string;                 // Optional operator notes
  
  // Timestamps
  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
  updatedByUid: string;
}
