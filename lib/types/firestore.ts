import { Timestamp } from "firebase/firestore";

export interface League {
  id?: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * The legacy `Team` interface (for the deprecated `teams` collection)
 * was removed in Phase J1 (2026-06-02). Its data was merged into
 * `design_teams` via functions/scripts/migrate-teams-into-design-teams.js
 * during Phase F (executed 2026-06-01). Use `DesignTeam` instead — see
 * canonical definition below.
 */

/**
 * Design System / color library (Illustrator workflow, future bulk import).
 * Firestore: collection `design_system`, document ID = leagueCode (e.g. `MLB`).
 * Logical path: design_system / {leagueCode}
 */
export interface DesignSystemCmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface DesignSystemPaletteColor {
  role: string;
  name: string;
  hex: string;
  cmyk: DesignSystemCmyk;
}

export interface DesignSystemPaletteTeam {
  teamCode: string;
  teamName: string;
  colors: DesignSystemPaletteColor[];
}

export interface DesignSystemLeagueDocument {
  leagueCode: string;
  leagueName: string;
  teams: DesignSystemPaletteTeam[];
}

/** Loaded league doc (id matches leagueCode when stored conventionally). */
export interface DesignSystemLeague extends DesignSystemLeagueDocument {
  id: string;
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
  metadata?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    nickname?: string | null;
  };
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

/**
 * Optional display names + canonical codes mirrored from the product row (for UI labels).
 * `teamCode` matches `rp_taxonomy_entities.code` (short code for pickers). `teamId` / `teamSlug` are the
 * canonical team slug for structured tags and `design_teams` ids: `slugify(full_official_team_name)`.
 * Extended fields support dual-layer tags (`rally_tag_system_spec.md`).
 */
export interface RpTaxonomyDisplay {
  sportName?: string;
  leagueName?: string;
  teamName?: string;
  themeName?: string;
  /** Canonical team slug (value after `team:`), e.g. `los_angeles_dodgers`; matches `design_teams` doc id */
  teamId?: string | null;
  /** Taxonomy entity code (e.g. `GIANTS`) — not the storefront tag slug */
  teamCode?: string | null;
  teamCity?: string | null;
  teamNickname?: string | null;
  themeCode?: string | null;
  designFamily?: string | null;
  /** Human-readable city (e.g. "Los Angeles"); mirrors `teamCity` when sourced from entity. */
  cityName?: string | null;
  citySlug?: string | null;
  /** Same as `teamId` when set; structured `team:{teamSlug}` tag */
  teamSlug?: string | null;
  leagueCode?: string | null;
  sportCode?: string | null;
  productTypeName?: string | null;
  productTypeSlug?: string | null;
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

/**
 * Identity-source mode (Phase I, 2026-06-01 — post deep-research recalibration).
 *
 *   - "reference_images": identity is preserved at inference time via N
 *     reference photos fed to a multi-reference model (Flux 2 multi-ref or
 *     equivalent). NO training step. Fast iteration, no overfitting risk.
 *     The recommended default for new identities — Zalando's analog production
 *     workflow and FASHN AI's fashion-vertical SaaS both use this pattern.
 *   - "lora": legacy training-based identity. Identity lives in trained
 *     LoRA weights (`activeLoraArtifactId`). Use only when reference-image
 *     mode disappoints quality-wise, OR when the identity is highly stylized
 *     and needs the per-character fine-tune.
 *   - "hybrid": both modes available. Inference picks LoRA when available
 *     AND a reference set when supported by the chosen VTON provider.
 *
 * Legacy docs (pre-Phase-I) lack this field — `resolveIdentityMode()` in
 * lib/identity treats missing as "lora" if `activeLoraArtifactId` is set,
 * otherwise "reference_images" so the field is fully optional.
 */
export type RPIdentityMode = "reference_images" | "lora" | "hybrid";

/**
 * One reference photo of the identity, used for Flux 2 multi-reference and
 * other reference-conditioned VTON providers. Role is the angle/coverage tag
 * — UI groups photos by role so the operator can see "do I have a face front
 * + face 3-quarter + body full?" at a glance.
 */
export type RPIdentityReferenceRole =
  | "face_front"
  | "face_3q"
  | "face_profile"
  | "body_full"
  | "body_3q"
  | "body_side"
  | "detail_hands"
  | "detail_hair";

export interface RPIdentityReferenceImage {
  /** Auto-generated id (random); used as the deletion key. */
  refId: string;
  url: string;
  storagePath: string;
  role: RPIdentityReferenceRole;
  /** Optional operator label ("hero shot", "casual wave", etc.). Free-form. */
  label?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  uploadedAt: Timestamp;
  uploadedByUid: string;
}

export interface RPIdentity {
  id?: string;
  name: string; // "Amber"

  // Stable trigger token, immutable once created.
  token: string; // e.g. "rp_amber"

  // Default trigger phrase used in training/inference.
  // In most cases this should equal token and is treated as the system source of truth.
  defaultTriggerPhrase: string;

  status: RPIdentityStatus;

  /**
   * Phase I: how this identity is applied at inference time. See RPIdentityMode.
   * Missing = legacy behavior (LoRA if activeLoraArtifactId set, else reference_images).
   */
  mode?: RPIdentityMode;

  /**
   * Phase I: reference photos used by Flux 2 multi-reference (and future
   * reference-conditioned providers like FASHN Face Reference). Capped at ~10
   * client-side to match Flux 2's max input (4-9 per generation; we keep a
   * buffer for the inference layer to pick the best subset).
   */
  referenceImages?: RPIdentityReferenceImage[] | null;

  /**
   * Phase I: which registered VTON provider this identity prefers. If unset,
   * `composeStageB` falls back to the global default. Setting this enables
   * "Amber always uses Flux 2 multi-ref" without operator intervention per render.
   */
  preferredProviderId?: string | null;

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
  /** Phase I: total count of reference images currently uploaded. Mirror of referenceImages.length. */
  referenceImageCount?: number;

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

/** Step 10 flat mockup look types (MVP) + model template outputs (8394 multi-source). */
export type RpFlatRenderLookType = "flat_clean" | "flat_blended" | "model_clean" | "model_blended";

/** Step 10 MVP views (expand later). */
export type RpFlatRenderView = "front" | "back";

/**
 * One persisted flat render slot on the product (canonical URLs on doc for UI).
 */
/** Traceability back to the master blank recipe used at compose time (official 8394 flats / model handoff). */
export interface RpOfficialAssetRecipeProvenance {
  resolvedFromBlankId: string;
  resolvedFromBlankVariantId: string;
  resolvedRenderTarget: string;
  resolvedPlacementId: string;
  resolvedTone: string | null;
  resolvedDesignUrl: string | null;
  sourcePathUsed: string | null;
  /** Garment / model raster URL from the saved blank variant (same as debug `garmentImageUrl`). */
  resolvedGarmentImageUrl?: string | null;
  /** `blank_native` = deterministic compose from master blank; `ai_identity` = generation job (optional). */
  compositionSource?: "blank_native" | "ai_identity" | string | null;
  /** True when `flat_front_clean` was saved as garment PNG only (no artwork compositing). */
  garmentOnlyCleanFront?: boolean | null;
  /** Alias for policy / storefront checks (`garment_only` in product spec). */
  garmentOnly?: boolean | null;
  /** `garment_only_clean_front` vs `design_composite_8394` for official 8394 flat roles. */
  renderPath?: string | null;
  /** `rp_blanks.version` when present. */
  blankRenderProfileVersion?: number | null;
  /** Blank doc `updatedAt` when available. */
  blankDocUpdatedAt?: Timestamp | null;
  tuningLayer?: string | null;
  recipeProvenanceSchemaVersion: 1;
}

export interface RpProductFlatRenderSlot {
  url: string;
  storagePath?: string | null;
  generatedAt: Timestamp;
  lookType: RpFlatRenderLookType;
  view: RpFlatRenderView;
  sourceBlankVariantId: string;
  /** Which design garment asset was composited; omitted for garment-only front (e.g. 8394 back_only). */
  sourceDesignAssetRef?: "light" | "dark" | "white" | null;
  /** SHA-256 hex (prefix) of canonical input payload when this render was built. */
  inputFingerprint: string;
  width?: number;
  height?: number;
  /** When set, official pipeline wrote this slot from `resolveSavedBlankRenderProfile` + compose. */
  recipeProvenance?: RpOfficialAssetRecipeProvenance | null;
}

/**
 * Nested by look then view. MVP: 8394 uses `back`; tees / crewneck may use `front` when generated.
 * `model_*` holds outputs from variant `modelFront` / `modelBack` sources (separate from flat vendor flats).
 */
export interface RpProductFlatRendersMvp {
  flat_clean?: { front?: RpProductFlatRenderSlot | null; back?: RpProductFlatRenderSlot | null };
  flat_blended?: { front?: RpProductFlatRenderSlot | null; back?: RpProductFlatRenderSlot | null };
  model_clean?: { front?: RpProductFlatRenderSlot | null; back?: RpProductFlatRenderSlot | null };
  model_blended?: { front?: RpProductFlatRenderSlot | null; back?: RpProductFlatRenderSlot | null };
}

/** Deterministic gallery ordering helper on `rp_products/.../variants/*` (Shopify prep). */
export type RpVariantGeneratedRenderOutputRole =
  | "flat_front"
  | "flat_back"
  | "model_front"
  | "model_back"
  | "detail";

export interface RpVariantGeneratedRenderOutput {
  role: RpVariantGeneratedRenderOutputRole;
  sourceType:
    | "variant_render_source"
    | "official_generation"
    | "official_deterministic_generation";
  sourceImageRole?: string | null;
  url: string;
  storagePath?: string | null;
  width?: number | null;
  height?: number | null;
  sort: number;
  createdAt?: Timestamp | null;
  lookType?: string | null;
  view?: RpFlatRenderView | null;
  recipeProvenance?: RpOfficialAssetRecipeProvenance | null;
}

/** One deterministic scene output (non-AI composite). */
export interface RpProductSceneRenderSlot {
  url: string;
  storagePath?: string | null;
  generatedAt: Timestamp;
  /** Which template produced this image. */
  sceneId: string;
  /** flat_blended source used (front vs back). */
  sourceFlatView: RpFlatRenderView;
  sourceFlatUrl: string;
}

/**
 * Lifestyle-style renders from flat mockups. `hanger` is the first shipped key; additional keys align with
 * `generateProductSceneRender` `sceneKey` and `rp_blanks.generationDefaults.defaultSceneRenderKey`.
 */
export interface RpProductSceneRendersMvp {
  hanger?: RpProductSceneRenderSlot | null;
  [sceneKey: string]: RpProductSceneRenderSlot | null | undefined;
}

// ---------------------------------------------------------------------------
// Alt-image / scene template system (v1 deterministic) — see rally_alt_image_scene_template_spec.md
// Coexists with MVP `sceneRenders` above until migrated.
// ---------------------------------------------------------------------------

/** Semantic taxonomy — distinct from `RpAssetType` (legacy). */
export type RpSemanticAssetKind =
  | "commerce_front_clean"
  | "commerce_back_clean"
  | "commerce_front_hero"
  | "commerce_back_hero"
  | "commerce_front_blended"
  | "commerce_back_blended"
  | "scene_hanger"
  | "scene_backdrop_neutral"
  | "scene_flatlay_wood"
  | "scene_flatlay_boutique"
  | "scene_model_back"
  | "scene_bed_soft"
  | "scene_folded"
  | "scene_hero_studio"
  | "promo_social_card"
  | "promo_drop_hero"
  | "promo_campaign_tile"
  | "hero_promo_card"
  | "ai_model_studio"
  | "ai_model_lifestyle"
  | "ai_scene_editorial"
  | "ai_social_campaign";

export type RpGalleryRole =
  | "hero_front"
  | "hero_back"
  | "gallery_primary"
  | "gallery_secondary"
  | "alt_scene_primary"
  | "alt_scene_secondary"
  | "social_scene";

export type RpSceneAssetApprovalState = "auto_approved" | "pending_review" | "needs_review" | "approved" | "rejected";

/** Firestore: `rp_scene_templates/{sceneTemplateId}` */
export type RpSceneTemplateSceneType =
  | "hanger"
  | "backdrop"
  | "flatlay_floor"
  | "flatlay_boutique"
  | "body_model"
  | "flatlay_bed"
  | "promo_card"
  | "hero_studio"
  | "future_ai_model";

export type RpSceneTemplateStatus = "draft" | "active" | "archived";
export type RpSceneTemplateMode = "deterministic" | "future_ai";
export type RpSceneGenerationScope = "hero_variant_only" | "all_colors" | "manual_only";
export type RpSceneDefaultGalleryRoleDoc = "pdp_alt" | "hero_alt" | "marketing_only";

export interface RpSceneTemplate {
  id?: string;
  name: string;
  /** Stable key, e.g. `neutral_hanger`, `wood_floor_flatlay` */
  sceneKey: string;
  sceneType: RpSceneTemplateSceneType;
  status: RpSceneTemplateStatus;
  templateMode: RpSceneTemplateMode;
  templateVersion?: number;
  description?: string;
  sortOrder?: number;
  productTypesAllowed?: string[];
  blankCategoriesAllowed?: string[];
  supportsFront?: boolean;
  supportsBack?: boolean;
  supportsPerColor?: boolean;
  defaultGenerationScope?: RpSceneGenerationScope;
  defaultGalleryRole?: RpSceneDefaultGalleryRoleDoc;
  backgroundAssetUrl?: string | null;
  shadowAssetUrl?: string | null;
  /** Garment / fabric region mask (same aspect as `backgroundAssetUrl` after resize). Required for `body_model`. */
  maskAssetUrl?: string | null;
  /** Optional warm or cool lighting overlay (full-frame, composited last). */
  lightingAssetUrl?: string | null;
  /** Written to `rp_product_assets.galleryRole` for deterministic workers that support it. */
  sceneOutputGalleryRole?: RpGalleryRole;
  /** Written to `rp_product_assets.gallerySort` when set. */
  gallerySort?: number;
  placementZone?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    zIndex?: number;
    cropMode?: string;
  };
  renderDefaults?: {
    outputWidth?: number;
    outputHeight?: number;
    imageFormat?: "jpg" | "png" | "webp";
    jpegQuality?: number;
    backgroundMode?: string;
    padding?: number;
    shadowOpacity?: number;
    shadowBlur?: number;
    colorAdjustmentProfile?: string;
  };
  /** Priority-ordered source asset kinds for compositing */
  preferredSourceKinds?: RpSemanticAssetKind[];
  /** When true, generated assets default to auto_approved (deterministic v1). */
  autoApproveDefault?: boolean;
  /** Garment placement in scene (normalized 0–1 center + scale of max width vs background width). */
  garmentPlacement?: { x: number; y: number; scale: number };
  usageTags?: string[];
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  updatedBy?: string;
}

/** Firestore: `rp_scene_render_jobs/{jobId}` */
export type RpSceneRenderJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RpSceneRenderJob {
  id?: string;
  productId: string;
  productVariantId?: string | null;
  blankVariantId?: string;
  sceneTemplateId: string;
  sceneKey: string;
  jobType: "scene_render";
  generationScope: RpSceneGenerationScope | "single_variant";
  status: RpSceneRenderJobStatus;
  inputSnapshot?: Record<string, unknown>;
  output?: {
    assetId?: string;
    imageUrl?: string;
    thumbUrl?: string;
    storagePath?: string;
  };
  errorMessage?: string | null;
  attemptCount?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  updatedBy?: string;
}

/** One typed scene output cached on variant (`sceneTemplateRenders[sceneTemplateSlug]`). */
export interface RpProductVariantSceneRender {
  sceneTemplateId: string;
  sceneTemplateSlug: string;
  sceneType: RpSceneTemplateSceneType;
  status: "queued" | "processing" | "generated" | "approved" | "rejected" | "error";
  assetUrl?: string;
  thumbUrl?: string;
  outputWidth?: number;
  outputHeight?: number;
  outputFormat?: string;
  sourceView?: "front" | "back" | "folded" | "hero";
  /** e.g. `flat_blended.back`, `media.heroBack` */
  sourceAssetRef?: string;
  approvalState: RpSceneAssetApprovalState;
  rejectionReason?: string;
  generationFingerprint?: string;
  generationVersion?: string;
  renderEngine?: string;
  errorMessage?: string;
  /** Links to `rp_product_assets` when persisted */
  assetId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  updatedBy?: string;
}

/** Phase-1 parent/variant model: top-level sellable product vs color variant under parent. */
export type RpProductKind = "parent" | "variant";

/**
 * Cached variant row on parent (`variantSummary`) — not canonical for media; variants subcollection is.
 */
export interface RpProductVariantSummary {
  variantId: string;
  blankVariantId: string;
  colorName: string;
  colorHex?: string | null;
  /** Garment size option (Color × Size); mirrors variant `optionValues.size`. */
  sizeCode?: RPBlankGarmentSizeCode | string | null;
  isDefault: boolean;
}

/** Initial 8394 team-product asset roles (orchestrator + batch doc). Canonical display order. */
export type Rp8394InitialAssetRole =
  | "model_back_designed"
  | "model_front_designed"
  | "flat_front_clean"
  | "flat_front_designed"
  | "flat_back_designed"
  | "model_front_clean";

/** Aggregated per-role status on parent `rp_products` (worst color wins). */
export type RpParentAssetRoleState =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped_no_identity"
  | "optional_failed";

/** Parent-level fulfillment snapshot (`rp_products.fulfillmentSummary`). */
export interface RpProductFulfillmentSummary {
  version?: number;
  blankId?: string | null;
  designId?: string | null;
  teamId?: string | null;
  blankStyleCode?: string | null;
  printSides?: Record<string, unknown>;
  artworkToneNotes?: string | null;
  sizesOffered?: string[];
  colorLines?: Array<{
    blankVariantId: string;
    colorName?: string | null;
    variantDocCount?: number;
  }>;
  variantCount?: number;
  fulfillmentReady?: boolean;
  fulfillmentMissing?: string[];
  generatedAt?: Timestamp | null;
}

/** Variant-level fulfillment (`variants/{id}.fulfillmentPackage`). */
export interface RpProductVariantFulfillmentPackage {
  version?: number;
  blankId?: string | null;
  blankVariantId?: string | null;
  designId?: string | null;
  designIdFront?: string | null;
  designIdBack?: string | null;
  colorName?: string | null;
  optionValues?: { color?: string; size?: string };
  sku?: string | null;
  preferredArtworkTone?: string | null;
  printSides?: Record<string, unknown>;
  printFileRefs?: Record<string, string | null | undefined>;
  renderSetup?: unknown;
  placementOverrides?: unknown;
  renderOverrides?: unknown;
  fulfillmentReady?: boolean;
  fulfillmentMissing?: string[];
  generatedAt?: Timestamp | null;
}

/** `rp_product_asset_batches/{batchId}` — per-color / per-role progress for initial assets. */
export interface RpProductAssetBatch {
  id?: string;
  productId: string;
  blankId: string;
  designId: string;
  teamId?: string | null;
  status: "queued" | "running" | "complete" | "failed" | "partial" | "superseded";
  /** When true, asset completion advances `rp_products.launchStatus` / Shopify flags. */
  launchPipeline?: boolean;
  launchOptions?: { autoSyncShopify?: boolean; queue8394Secondary?: boolean } | null;
  /**
   * Same `resolvePrintSidesForProductBuild(blank, design)` as readiness — used so `flat_front_clean` failures
   * become `optional_failed` when commerce is back-only (`effectiveBack && !effectiveFront`).
   */
  readinessPrintSides?: {
    effectiveFront?: boolean;
    effectiveBack?: boolean;
    primaryPlacementSide?: string | null;
    blankMode?: string | null;
    designMode?: string | null;
  } | null;
  resolvedModelIdentityId?: string | null;
  /** When true, model_back / model_front official jobs were enqueued for this batch. */
  officialModelRolesEnabled?: boolean;
  colors: Record<
    string,
    {
      blankVariantId: string;
      colorName?: string | null;
      primaryVariantId?: string | null;
      /** Snapshot from `resolveBlankProductImagePlan` at batch creation (blank color row). */
      officialPlan?: {
        enabledOfficialRolesOrdered: Rp8394InitialAssetRole[];
        requiredLaunchOfficialRoles: Rp8394InitialAssetRole[];
        requiredShopifyOfficialRoles: Rp8394InitialAssetRole[] | null;
        galleryOrderOfficialRoles: Rp8394InitialAssetRole[];
      } | null;
      roles: Partial<
        Record<
          Rp8394InitialAssetRole,
          {
            status:
              | "queued"
              | "running"
              | "done"
              | "failed"
              | "skipped_no_identity"
              | "optional_failed";
            reason?: string;
            error?: string;
            updatedAt?: Timestamp;
          }
        >
      >;
    }
  >;
  assetsProgress?: { completed: number; total: number };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  updatedBy?: string;
  supersededAt?: Timestamp | null;
  supersededBy?: string | null;
}

/** Parent-only cache for list/cards; variant `media` remains source of truth for PDP. */
export interface RpProductDisplayMediaCache {
  heroUrl?: string;
  thumbUrl?: string;
  /**
   * Denormalized hint: which `rp_hero_templates` id produced `heroUrl` once hero pipeline exists (dormant until then).
   * Cache only — not authoritative. Does not replace conceptual ownership / precedence on live documents.
   */
  heroTemplateId?: string | null;
}

export interface RpProduct {
  id?: string; // productId
  /**
   * App route segment (`/products/:slug`). Defaults to `handle` unless intentionally overridden.
   * `handle` is the canonical storefront URL key (Shopify handle).
   */
  slug: string; // for route /products/:slug
  name: string; // e.g. "San Francisco Giants Classic Black"
  description?: string;

  /** Phase 1: `parent` = multi-variant product; omit on legacy single-SKU docs. */
  productKind?: RpProductKind;
  /** Bump when parent document shape changes. */
  schemaVersion?: number;
  /** Dedupe: league_team_design_blank (no variant segment). */
  parentProductIdentityKey?: string | null;
  teamId?: string | null;
  /** Denormalized admin/debug; canonical source: design_teams + designs. */
  teamName?: string | null;
  designName?: string | null;
  blankStyleCode?: string | null;
  blankStyleName?: string | null;
  /** Firestore id of default variant doc; phase 1: same as `heroVariantId`. */
  defaultVariantId?: string | null;
  /** Phase 1: must equal `defaultVariantId`. */
  heroVariantId?: string | null;
  variantSummary?: RpProductVariantSummary[];
  /** Sellable variant subdocs under `variants/` (Color × Size rows). */
  variantCount?: number;
  /** Distinct blank color lines (unique `blankVariantId` on variant subdocs). */
  colorVariantCount?: number;
  /**
   * Inherited from blank at creation. Drives Shopify `productSet` shape (see `functions/shopifySync.js`).
   * Omitted on older docs: legacy sync (full Color × Size, unchanged).
   */
  shopifyVariantMode?: ShopifyVariantMode | null;
  /** Cache only — not authoritative for PDP imagery. */
  displayMedia?: RpProductDisplayMediaCache | null;

  /** Initial 8394 asset batch — summary; detail in `rp_product_asset_batches/{assetsBatchId}`. */
  assetsStatus?: "idle" | "queued" | "running" | "complete" | "failed" | "partial";
  assetsBatchId?: string | null;
  assetsProgress?: { completed: number; total: number };
  assetsRoles?: Partial<Record<Rp8394InitialAssetRole, RpParentAssetRoleState>>;
  assetsUpdatedAt?: Timestamp | null;
  /** Operator hint when model official jobs were skipped (no identity). */
  officialAssetsNote?: string | null;

  /** One-click launch pipeline (operator-facing). Lower-level `assets*` tracks image batch. */
  launchStatus?:
    | "draft"
    | "materializing"
    | "generating_assets"
    | "assembling_metadata"
    | "needs_review"
    | "shopify_ready"
    | "syncing_shopify"
    | "live"
    | "failed";
  launchSource?: "one_click" | string;
  launchStartedAt?: Timestamp | null;
  launchUpdatedAt?: Timestamp | null;
  launchPipelineVersion?: number;
  launchNote?: string | null;
  /** Denormalized gallery slot order for default PDP / Shopify (8394 roles). */
  defaultGalleryRoleOrder?: Rp8394InitialAssetRole[];
  heroSelectionRule?: string | null;
  featuredImagePreference?: string | null;
  linkedBlankId?: string | null;
  linkedDesignId?: string | null;
  linkedTeamId?: string | null;
  launchMetadataFilledAt?: Timestamp | null;
  /** Server evaluation vs `shopifySync.readinessCheck` (variant matrix). */
  shopifyReady?: boolean;
  shopifyReadinessMissing?: string[] | null;
  /** Human approval gate before bulk Shopify sync (`approve` / `hold` / `pending` / `skipped`). */
  opsReviewStatus?: "pending" | "approved" | "hold" | "skipped";
  reviewedAt?: Timestamp | null;
  reviewedBy?: string | null;
  reviewRequestedAt?: Timestamp | null;

  /** Structured fulfillment snapshot for ops / export (built server-side). */
  fulfillmentSummary?: RpProductFulfillmentSummary | null;

  /** Last pipeline / asset error string for list surfaces. */
  lastPipelineError?: string | null;
  /**
   * Where the last recorded pipeline issue occurred (`materializing` | `generating_assets` | `assembling_metadata` | `fulfillment` | `shopify_sync`).
   * Cleared on successful transitions; may be set without error when entering Shopify sync.
   */
  lastPipelineStage?: string | null;
  lastPipelineAt?: Timestamp | null;

  /** Alt-image system: denormalized counts / by-kind (optional; canonical data in `rp_product_assets`). */
  sceneAssetSummary?: {
    approvedCount?: number;
    byKind?: Partial<Record<RpSemanticAssetKind, number>>;
    bySceneKey?: Record<string, number>;
  };

  /** Optional marketing / alt hero cache (not color truth for multi-variant). */
  displayMediaAlt?: {
    heroAltUrl?: string;
    promoUrl?: string;
    hangerUrl?: string;
    flatlayUrl?: string;
  };

  /**
   * Rare explicit hero template override on the parent (future hero pipeline).
   * Conceptual layer: Product. Precedence + fields: `lib/hero/resolveHeroTemplate.ts`. Variant-owned `media` stays canonical for PDP imagery.
   */
  heroTemplateId?: string | null;

  /**
   * Denormalized from `rp_blanks.garmentSizes` for UI / Shopify preview. Canonical source: the blank.
   * Set on parent create and refreshed with merchandising. Does not create size variants (Color × Size is future work).
   */
  availableSizes?: RPBlankGarmentSizeCode[] | null;

  // Spec alignment (RALLY_FIRESTORE_AND_PRODUCT_PAGE_MAPPING): merchandising + Shopify
  title?: string; // display title; fallback: name
  /** Canonical storefront URL key (Shopify handle); slug defaults to this unless overridden. */
  handle?: string; // URL handle; fallback: slug
  descriptionHtml?: string;
  descriptionText?: string;
  /** Plain-text listing / card blurb; fully resolved at create (no template tokens). */
  shortDescription?: string | null;
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
  /** Denormalized from design when product is created (optional). */
  designSeries?: string | null;
  taxonomy?: RpTaxonomyDisplay | null;

  category: RpProductCategory;
  baseProductKey: string; // "SFGIANTS_PANTY_1" (style family)
  /**
   * Canonical identity for dedupe/bulk generation.
   * Format: {leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantIdOrLegacy}
   * Set at creation only. See RALLY_GENERATED_PRODUCT_SPEC.md + buildProductIdentityKey.
   */
  productIdentityKey?: string | null;
  /**
   * Blank version (or updatedAt fallback) at time product was materialized from this blank.
   * Used to derive isBlankStale. Set at create and on "Refresh from blank".
   */
  blankVersionUsed?: number | null;
  /**
   * Design updatedAt (or version) at time product pulled design assets.
   * Used to derive isDesignStale. Set at create and on "Refresh design assets".
   */
  designVersionUsed?: number | null;
  /** Traceability: importKey of the design row(s) this product was generated from (e.g. MLB_WILL_DROP_FOR_GIANTS_BACK_LIGHT). Set on create/update from batch import. */
  generatedFromImportKey?: string | null;
  /** Legacy / single-SKU docs; parents may omit or use a neutral placeholder. */
  colorway?: {
    name: string; // "Black"
    hex?: string; // "#000000"
  };

  supplier?: {
    supplierName?: string;
    supplierSku?: string;
    styleCode?: string;
  };

  // Blank reference (required for product-only generation)
  blankId?: string; // FK to rp_blanks - master blank (style)
  /**
   * FK to `rp_blanks.variants[].variantId` (schema v2). Ties this product — and Shopify color option —
   * to one garment color line; storefront gallery for that option should match products with this id.
   */
  blankVariantId?: string | null;

  // Design + Blank product flow (alignment: product = design + blank, mockup stored here)
  designId?: string; // FK to designs - artwork used for this product (primary; use designIdFront/Back for spec)
  designIdFront?: string; // spec: front design
  designIdBack?: string; // spec: back design
  mockupUrl?: string; // URL of generated mockup image (e.g. /products/{productId}/mockup.png)

  /**
   * **Ephemeral UI state** (modals, transient picker URLs). Do not treat as persisted source of truth.
   * Persisted asset selection belongs in `renderSetup`; placement geometry defaults on the blank (`rp_blanks.placements[]`);
   * optional SKU-specific placement in `placementOverrides`.
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
   * Per-side **asset selection** (blank/design URLs, `placementKey`) and **verification** metadata.
   *
   * **Hierarchy (see `lib/products/resolveProductRenderProfile.ts`):**
   * - Blank `placements[]` + `renderDefaults` + variant `renderOverrides` = inherited defaults.
   * - Product **`placementOverrides`** / **`renderOverrides`** = canonical structured overrides (prefer for new writes).
   * - **`placementOverride`** / **`blendMode`** / **`blendOpacity`** on each side = **legacy** overrides; still read by the resolver for backward compatibility.
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

  /**
   * Optional structured **placement** overrides per garment side (SKU-specific).
   * Omitted sides / omitted fields inherit from the blank placement row for `renderSetup.{side}.placementKey`.
   * Prefer this over `renderSetup.*.placementOverride` for new persistence.
   */
  placementOverrides?: RpProductPlacementOverrides | null;

  /**
   * Optional structured **render (blend)** overrides per side.
   * Applied after blank zone `renderZoneDefaults` and the color variant’s `renderOverrides`;
   * wins over legacy `renderSetup.*.blendMode` / `blendOpacity` when set.
   */
  renderOverrides?: RpProductRenderOverrides | null;

  // AI Links (core)
  ai: {
    productArtifactId?: string; // reference to rp_lora_artifacts doc (Product LoRA)
    productTrigger?: string; // e.g. "rp_sfg_panty_1"
    productRecommendedScale?: number; // e.g. 0.9
    blankTemplateId?: string; // deprecated: use blankId instead
  };

  // Workflow
  status: RpProductStatus; // "draft" until ready
  /** Display tags: generated from Team + Design + Blank only (proper case). City from Team only; no manual entry. */
  tags?: string[];
  /** Normalized tags for filtering/search only; do not display. */
  tagsNormalized?: string[];

  // Simple analytics
  counters?: {
    assetsTotal?: number;
    assetsApproved?: number;
    assetsPublished?: number;
  };

  // Hero image (legacy single hero)
  heroAssetId?: string;
  heroAssetPath?: string;

  /**
   * MVP: Product owns primary render/media URLs directly on the document.
   * No required render subcollection for MVP; subcollection can be added later if needed.
   */
  media?: {
    heroFront?: string; // URL or assetId
    heroBack?: string;
    gallery?: string[];
    modelAssets?: string[];
    lifestyleAssets?: string[];
  };

  /**
   * Step 10 MVP: deterministic flat mockups (8394 back-only for now).
   * Explicit generation only; stale when slot.inputFingerprint !== computeProductFlatRenderFingerprint(...) (lib/products/flatRenderFingerprint).
   */
  flatRenders?: RpProductFlatRendersMvp | null;

  /**
   * Deterministic scene composites (flat_blended → template). Non-AI. MVP: hanger (crewneck template).
   */
  sceneRenders?: RpProductSceneRendersMvp | null;

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

/** 8394 base-asset pipeline progress (`variant8394Pipeline` / onMockJobCreated). */
export interface RpVariantAssetPipeline8394 {
  mock_back?: {
    status?: string;
    jobId?: string | null;
    error?: string | null;
  };
  flat_render?: {
    status?: string;
    error?: string | null;
    reason?: string;
    message?: string;
  };
  baseComplete?: boolean;
}

/**
 * Variant document: `rp_products/{parentProductId}/variants/{variantId}`.
 * Shopper-visible color-specific imagery lives here only (phase 1).
 */
export interface RpProductVariant {
  id?: string;
  productKind: "variant";
  schemaVersion: number;
  parentProductId: string;
  /** Business identity: league_team_design_blank_variant (optional cross-reference). */
  variantIdentityKey?: string | null;
  blankVariantId: string;
  designId: string;
  blankId: string;
  optionValues: { color?: string; size?: string };
  colorName: string;
  colorHex?: string | null;
  /** Denormalized from master blank variant; used for light/dark/white artwork selection on renders. */
  colorFamily?: RPBlankColorFamily | null;
  /** Denormalized from master blank variant when set. */
  preferredArtworkTone?: RPBlankArtworkTone | null;
  /**
   * Deterministic SKU (immutable after first write). Format `RP-{LEAGUE}-{TEAM}-{DESIGN}-{COLOR}-{SIZE}`.
   */
  sku?: string | null;
  /** Soft inventory for Shopify (unmanaged when `management` is null). */
  inventory?: {
    quantity?: number | null;
    /** `null` = do not track in Shopify (spec: unmanaged / continue selling). */
    management?: string | null;
  } | null;
  /** Default true for new variants (Shopify taxable). */
  taxable?: boolean | null;
  status: "active" | "archived";
  shopify?: {
    variantId?: string | null;
    status?: "not_synced" | "queued" | "synced" | "error";
    lastSyncAt?: Timestamp;
    /** Set when parent sync fails or variant-level error is recorded. */
    lastSyncError?: string | null;
  };
  mockupUrl?: string | null;
  media?: RpProduct["media"];
  flatRenders?: RpProductFlatRendersMvp | null;
  sceneRenders?: RpProductSceneRendersMvp | null;
  /**
   * Ordered list of generated commerce outputs for this SKU/color (flat + model). Used for gallery / future multi-image Shopify sync.
   */
  generatedRenderOutputs?: RpVariantGeneratedRenderOutput[] | null;
  /**
   * Typed deterministic scene outputs keyed by `sceneTemplateSlug` (alt-image v1).
   * Canonical rows also live in `rp_product_assets`; this is a cache for fast UI.
   */
  sceneTemplateRenders?: Record<string, RpProductVariantSceneRender> | null;
  designIdFront?: string | null;
  designIdBack?: string | null;
  renderSetup?: RpProduct["renderSetup"];
  renderConfig?: RpProduct["renderConfig"];
  placementOverrides?: RpProductPlacementOverrides | null;
  renderOverrides?: RpProductRenderOverrides | null;
  pricing?: RpProduct["pricing"];
  shipping?: RpProduct["shipping"];
  blankVersionUsed?: number | null;
  designVersionUsed?: number | null;
  ai?: RpProduct["ai"];
  counters?: RpProduct["counters"];
  /** 8394: mock job + flat render steps and overall base-complete flag. */
  assetPipeline?: RpVariantAssetPipeline8394 | null;
  /** When due, scheduled retry runs missing 8394 base assets. */
  variant8394NextRetryAt?: Timestamp | null;
  /** One primary size per color receives generation; other sizes inherit media from this variant. */
  isPrimaryForColor?: boolean;
  inheritsMediaFromVariantId?: string | null;
  /** Active `rp_product_asset_batches` id for orchestration callbacks (primary variant only). */
  productAssetBatchId?: string | null;
  /** Blank color key matching batch.colors (usually `blankVariantId`). */
  productAssetColorKey?: string | null;
  /** Deterministic fulfillment row for export / manufacturing handoff. */
  fulfillmentPackage?: RpProductVariantFulfillmentPackage | null;
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

/**
 * Reusable hero image templates (AI + deterministic). Collection: `rp_hero_templates/{templateId}`.
 * Structural foundation only — dormant until hero generation is activated; fields are for future pipeline + eligibility.
 * Conceptual ownership of *which* template applies: Blank (baseline) → Team (brand) → Design (campaign) → Product (rare explicit); see `lib/hero/resolveHeroTemplate.ts`.
 */
export type RpHeroTemplateCategory =
  | "studio_clean"
  | "flat_lay"
  | "hanger"
  | "folded"
  | "lifestyle"
  | "model";

/**
 * How the template is satisfied: catalog product render, deterministic scene composite, or on-model.
 * `scene_only` = deterministic scene composite (e.g. hanger) without full AI product pipeline.
 */
export type RpHeroTemplateGenerationMode = "product_only" | "scene_only" | "on_model";

/** How identity is chosen when the template needs a model. Extend as needed. */
export type RpHeroIdentityPolicy = "inherit_default" | "explicit" | "none" | string;

/** Cropping / safe-area hints for hero output. */
export type RpHeroCropPolicy = "center" | "bottom_weighted" | "top_weighted" | "face_safe" | string;

export interface RpHeroTemplate {
  /** Firestore document id; usually equals `templateId`. */
  id?: string;
  /** Same as document id when stored in Firestore. */
  templateId: string;
  name: string;
  slug: string;
  isActive: boolean;
  schemaVersion: number;
  category: RpHeroTemplateCategory;
  generationMode: RpHeroTemplateGenerationMode;
  /** When `generationMode` includes deterministic scene step; aligns with `generateProductSceneRender` keys. */
  sceneRenderKey?: string | null;
  /** Optional link to `rp_scene_presets` for AI paths. */
  presetId?: string | null;
  identityPolicy?: RpHeroIdentityPolicy | null;
  explicitIdentityId?: string | null;
  /** e.g. "1:1", "4:5" */
  aspectRatio?: string | null;
  cropPolicy?: RpHeroCropPolicy | null;
  allowedBlankStyleCodes?: string[] | null;
  excludedBlankStyleCodes?: string[] | null;
  allowedProductCategories?: RpProductCategory[] | null;
  allowedLeagueCodes?: string[] | null;
  allowedTeamIds?: string[] | null;
  preferredView?: "front" | "back" | null;
  requiresRenderedProductImage?: boolean;
  requiresModelPipeline?: boolean;
  promptTemplate?: string | null;
  notes?: string | null;
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
  /** Parent `rp_products` id (same as `productId` for legacy; use for multi-variant products). */
  productId: string;
  /** When set, ties asset to a color line under the parent product. */
  parentProductId?: string;
  blankVariantId?: string;
  /** `rp_products/{parent}/variants/{variantDocId}` */
  variantDocId?: string;
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
  /** Garment side for packshots / mockups */
  view?: "front" | "back";
  /** Pipeline role for labels in the Assets tab (e.g. hero, front, back, blended) */
  assetRole?: string;

  /** Alt-image / gallery taxonomy (v1); prefer over generic labels for new assets */
  semanticAssetKind?: RpSemanticAssetKind;
  galleryRole?: RpGalleryRole;
  gallerySort?: number;
  sceneTemplateId?: string;
  sceneTemplateSlug?: string;
  /** Pipeline provenance vs merchandising approval (see spec) */
  approvalState?: RpSceneAssetApprovalState;
  sourceType?: "deterministic_scene" | "commerce_render" | "ai_generated";
  /** Staleness / regeneration (template + source fingerprint) */
  metadata?: Record<string, unknown>;

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

// Phase 1: Blank as foundation
/** Drives default garment artwork mapping; optional `preferredArtworkTone` on blank variant overrides. */
export type RPBlankColorFamily = "light" | "dark";

/** Preferred design artwork tone for this garment color (overrides default light/dark garment mapping). */
export type RPBlankArtworkTone = "light" | "dark" | "white";

/** Garment-level default for which sides receive print in product generation (orthogonal to design artwork inventory). */
export type RPBlankDefaultPrintSides = "front_only" | "back_only" | "both";

/** How Shopify variant rows/options are built at sync (blank → product inheritance). */
export type ShopifyVariantMode = "color" | "color_size";

/**
 * Letter sizes for apparel (blank-level). Phase 1: configure on `rp_blanks` only.
 * Future: Shopify product variants can combine **Color** (from blank color variants) × **Size** (from this list)
 * without renaming this field.
 */
export type RPBlankGarmentSizeCode = "XS" | "S" | "M" | "L" | "XL";

export interface RPBlankShopifyDefaults {
  productType?: string | null;
  /** Shopify brand (display); prefer over vendor for new docs */
  brand?: string | null;
  /** @deprecated Use brand */
  vendor?: string | null;
  productCategory?: string | null;
  collectionHandles?: string[] | null;
  /**
   * Shopify option name for the size dimension when sync creates multi-option variants (e.g. Color × Size).
   * Default at sync time: `"Size"` if unset. Does not create extra product rows in phase 1.
   */
  sizeOptionName?: string | null;
}

export interface RPBlankDefaultPricing {
  retailPrice?: number | null;
  cost?: number | null;
  currencyCode?: string | null;
  /** @deprecated Legacy; use retailPrice */
  basePrice?: number | null;
  /** @deprecated */
  compareAtPrice?: number | null;
}

export interface RPBlankDefaultShipping {
  defaultWeightGrams?: number | null;
  requiresShipping?: boolean | null;
}

export interface RPBlankRenderDefaults {
  blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | null;
  blendOpacity?: number | null;
  front?: { blendMode?: string | null; blendOpacity?: number | null } | null;
  back?: { blendMode?: string | null; blendOpacity?: number | null } | null;
}

/** Style-level sourcing (canonical master blank). */
export interface RPBlankSourcing {
  supplier?: string | null;
  supplierStyleCode?: string | null;
  supplierProductUrl?: string | null;
  notes?: string | null;
  /** @deprecated Legacy fields */
  vendor?: string | null;
  vendorSku?: string | null;
  vendorColorName?: string | null;
  vendorProductUrl?: string | null;
}

/**
 * Normalized team / brand color families for eligibility (garment ↔ team matching).
 * Teams may expose `colorFamilies[]`; expand list over time without schema churn.
 */
export type RPTeamColorFamily =
  | "black"
  | "white"
  | "grey"
  | "red"
  | "blue"
  | "navy"
  | "green"
  | "orange"
  | "purple"
  | "teal"
  | "pink"
  | "yellow";

/** Master-blank eligibility: which teams may use this style (variant may override). */
export interface RPBlankEligibility {
  allowedLeagues?: string[] | null;
  allowAllTeamsInAllowedLeagues?: boolean | null;

  matchTeamColorFamilies?: boolean | null;
  allowedTeamColorFamilies?: string[] | null;

  supportedDesignZones?: string[] | null;
  supportedProductFamilies?: string[] | null;

  includedTeamIds?: string[] | null;
  excludedTeamIds?: string[] | null;
}

/** When enabled, replaces master eligibility for this variant’s team resolution. */
export interface RPBlankVariantEligibilityOverride {
  enabled?: boolean | null;

  allowedLeagues?: string[] | null;
  allowAllTeamsInAllowedLeagues?: boolean | null;

  matchTeamColorFamilies?: boolean | null;
  allowedTeamColorFamilies?: string[] | null;

  includedTeamIds?: string[] | null;
  excludedTeamIds?: string[] | null;
}

/**
 * Per-color overrides on top of blank `placements[]` for this zone.
 * Resolution order: blank row → **this** → product `placementOverrides` / legacy `renderSetup`.
 * `placementKey` matches `RPPlacementId` values (e.g. `back_center`) when set.
 */
export interface RPBlankVariantRenderProfileSideOverride {
  placementKey?: string | null;
  defaultX?: number | null;
  defaultY?: number | null;
  defaultScale?: number | null;
  safeArea?: Partial<{ x: number; y: number; w: number; h: number }> | null;
  /** 8394 back: merged into blank row `simpleRenderControls8394` for this color. */
  simpleRenderControls8394?: Partial<RPPlacementSimpleRenderControls8394> | null;
  renderZoneDefaults?: {
    blendMode?: string | null;
    blendOpacity?: number | null;
  } | null;
}

/** Only set sides/fields you need; omit entirely to inherit blank defaults for this color. */
export interface RPBlankVariantRenderProfileOverrides {
  front?: RPBlankVariantRenderProfileSideOverride | null;
  back?: RPBlankVariantRenderProfileSideOverride | null;
}

/** Per render-target keys: variant source slots / pipeline outputs (flat vs on-model). */
export type RpRenderTarget =
  | "flat_front"
  | "flat_back"
  | "model_front"
  | "model_back";

/** Alias retained for existing imports and `Record<…>` maps. */
export type RpRenderTargetKey = RpRenderTarget;

export interface RpPlacementSettings {
  scale: number;
  /** 0–1 */
  x: number;
  /** 0–1 */
  y: number;
  safeArea?: boolean;
}

export interface RpBlendSettings {
  /** 0–1 */
  fabricFeel: number;
  /** 0–1 */
  printStrength: number;
  mode?: "clean" | "soft" | "vintage" | "bold";
}

export interface RpWarpSettings {
  enabled: boolean;
  /** Curve intensity */
  warpStrength?: number;
  verticalStretch?: number;
  horizontalWarp?: number;
}

export interface RpMaskSettings {
  enabled: boolean;
  feather?: number;
  edgeFade?: number;
}

export interface RpRenderTargetSettings {
  placement: RpPlacementSettings;
  blend: RpBlendSettings;
  warp?: RpWarpSettings;
  mask?: RpMaskSettings;
}

/**
 * 8394 MVP `generateProductFlatRenders` slots (Cloud Functions + variant `flatRenders` / `generatedRenderOutputs` roles).
 * Order matches default gallery / hero priority within the shot plan.
 */
export type RpBlankProductImageGenerationKey =
  | "model_blended_back"
  | "model_blended_front"
  | "flat_blended_front"
  | "flat_clean_front"
  | "flat_blended_back"
  | "model_clean_front";

/**
 * Blank-defined row for one catalog shot: whether it exists for this color, launch / Shopify gates, ordering, source photo, artwork expectation.
 * When `productImageTargets` is omitted on the blank variant, the pipeline infers enabled slots from `images.*` URLs (legacy).
 */
export interface RPBlankProductImageTarget {
  /** When false, this slot is never generated. */
  enabled?: boolean;
  requiredForLaunch?: boolean;
  requiredForShopify?: boolean;
  /** Lower sorts earlier in PDP / preview galleries when using blank-driven ordering. */
  galleryOrder?: number | null;
  /** Overrides `images.flatBack` / `modelBack` / etc. for this shot’s source photograph. */
  sourcePhotoUrl?: string | null;
  /**
   * For back design-composite slots only (`flat_blended_back`, `model_blended_back`).
   * When false, the pipeline emits garment-only output (no design fetch). Front clean slots are always garment-only.
   */
  expectsArtwork?: boolean;
  /** Merged on top of blank `renderProfile` tuning for this render target after base resolution. */
  renderSettings?: Partial<RpRenderTargetSettings> | null;
}

/** Default `galleryOrder` when a target omits it (lower = earlier). */
export const RP_BLANK_PRODUCT_IMAGE_DEFAULT_GALLERY_ORDER: Record<RpBlankProductImageGenerationKey, number> = {
  model_blended_back: 10,
  model_blended_front: 12,
  flat_blended_front: 15,
  flat_clean_front: 20,
  flat_blended_back: 30,
  model_clean_front: 40,
};

/**
 * Per-render-target tuning on the blank (placement scale/position hints, blend, warp, mask).
 * **Zone geometry and safe-area shape** remain on `RPBlank.placements[]` only.
 */
export interface RPBlankRenderProfile {
  renderTargets?: Partial<Record<RpRenderTarget, RpRenderTargetSettings>>;
  /**
   * Per-color (variantId) × per-render-target tuning. Merged on top of `renderTargets[target]` for that blank.
   * Used for 8394 master blanks so each garment color can tune flat/model placement independently.
   */
  renderTargetsByColor?: Partial<Record<string, Partial<Record<RpRenderTarget, RpRenderTargetSettings>>>>;
}

export type RPBlankVariantRenderTargetOverrides = Partial<
  Record<RpRenderTargetKey, RPBlankVariantRenderProfileSideOverride | null>
>;

export type RPBlankVariantMarketingImageRole =
  | "lifestyle"
  | "flatlay"
  | "bed"
  | "wood"
  | "promo"
  | "detail";

/** Manual marketing / lifestyle assets — not consumed by the flat/model compositor. */
export interface RPBlankVariantMarketingImage {
  id: string;
  role: RPBlankVariantMarketingImageRole;
  storagePath: string;
  downloadUrl: string;
  width?: number | null;
  height?: number | null;
  sort?: number | null;
  caption?: string | null;
  updatedAt?: Timestamp | null;
}

/** One color / SKU line on a master blank */
export interface RPBlankVariant {
  variantId: string;
  colorName: string;
  colorHex?: string | null;
  colorFamily: RPBlankColorFamily;
  /**
   * When set, prefer this design asset tone (light/dark/white PNG slot) if present on the design,
   * then deterministic fallbacks. See `lib/designs/artworkToneResolution.ts`.
   */
  preferredArtworkTone?: RPBlankArtworkTone | null;
  vendorColorName?: string | null;
  vendorColorCode?: string | null;
  vendorSku?: string | null;
  isActive?: boolean;
  /**
   * Per-color flat/reference mockups for this blank variant (e.g. Heather Grey front/back).
   * Pipeline: these feed product generation for any `rp_products` with this `blankVariantId`;
   * shopper-facing Shopify galleries should ultimately reflect **product-owned** `media` built from
   * that generation — see RALLY_MASTER_BLANK_SCHEMA.md (Storefront / Shopify).
   */
  images?: {
    /** @deprecated Prefer `flatFront`; kept for backward compatibility (lazy-mapped to flat front in readers). */
    front?: RPImageRef | null;
    /** @deprecated Prefer `flatBack`; lazy-mapped to flat back in readers. */
    back?: RPImageRef | null;
    detail?: RPImageRef | null;
    flatFront?: RPImageRef | null;
    flatBack?: RPImageRef | null;
    modelFront?: RPImageRef | null;
    modelBack?: RPImageRef | null;
  };
  /** Lifestyle / promo shots stored for merchandising only (not render inputs). */
  marketingImages?: RPBlankVariantMarketingImage[] | null;
  /**
   * Quick global blend hint (applies before product overrides; after `renderProfileOverrides` side blend).
   * Prefer `renderProfileOverrides` for per-side control.
   */
  renderOverrides?: { blendMode?: string | null; blendOpacity?: number | null } | null;
  /**
   * Per-color placement + 8394 simple / zone blend overrides.
   * Resolution: blank placement row → `renderProfileOverrides.{front|back}` → product overrides.
   */
  renderProfileOverrides?: RPBlankVariantRenderProfileOverrides | null;
  /**
   * Optional per render-target overrides (e.g. `model_back` vs `flat_back`).
   * `flat_*` merges with legacy `renderProfileOverrides.{front|back}`; `model_*` does not inherit legacy side overrides.
   */
  renderTargetOverrides?: RPBlankVariantRenderTargetOverrides | null;
  /**
   * Which product-image passes exist for this garment color, their launch/Shopify requirements, gallery order, and overrides.
   * Drives `generateProductFlatRenders`, PDP gallery ordering, and variant readiness when provided.
   */
  productImageTargets?: Partial<Record<RpBlankProductImageGenerationKey, RPBlankProductImageTarget>> | null;
  sortOrder?: number | null;
  eligibilityOverride?: RPBlankVariantEligibilityOverride | null;
  /**
   * Phase L (2026-06-02): deterministic chest-print perspective quad for the
   * model photos. Each model shot is a fixed pose at an angle; the operator
   * sets a 4-corner quad ONCE per photo (front/back) that captures the chest
   * plane's perspective. The renderer warps every design through a homography
   * onto this quad so the print follows the body angle + fabric drape — same
   * geometry every render. Absent → Stage A falls back to the legacy flat
   * rectangle paste. See functions/lib/perspectiveWarp.js.
   */
  modelPrintQuad?: {
    front?: RPModelPrintQuad | null;
    back?: RPModelPrintQuad | null;
  } | null;
}

/**
 * Phase L: 4 normalized corners (0..1 fractions of the model photo) describing
 * the chest-print plane. Order is conventional: topLeft, topRight, bottomRight,
 * bottomLeft (clockwise from top-left). The design's rectangle maps
 * (0,0)→topLeft, (W,0)→topRight, (W,H)→bottomRight, (0,H)→bottomLeft.
 */
export interface RPModelPrintQuadCorner {
  x: number;
  y: number;
}
export interface RPModelPrintQuad {
  topLeft: RPModelPrintQuadCorner;
  topRight: RPModelPrintQuadCorner;
  bottomRight: RPModelPrintQuadCorner;
  bottomLeft: RPModelPrintQuadCorner;
  /** Audit. */
  updatedAt?: Timestamp | null;
  updatedByUid?: string | null;
}

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

/** Per-zone readiness (canonical render profile on the blank). */
export type RPPlacementProfileStatus = "draft" | "approved";

/** 8394 back MVP — size preset maps to placement `defaultScale` internally. */
export type RP8394SizePreset = "small" | "medium" | "large" | "fill_safe";

/**
 * Simple render tuning for LA Apparel 8394 back (non-designer UI).
 * Engines use `derivePlacementEngineFields8394` → `renderZoneDefaults` + ink multipliers.
 */
export interface RPPlacementSimpleRenderControls8394 {
  /** 0 = flat sticker look, 100 = more “in the fabric” (internal blend + opacity curve). */
  realism?: number | null;
  /** 0 = light / faded print, 100 = bold print (internal opacity + contrast). */
  inkStrength?: number | null;
  sizePreset?: RP8394SizePreset | null;
}

/** Which garment PNGs this zone expects from the design library (MVP metadata). */
export type RPAllowedDesignAssetMode = "light_dark" | "light_only" | "dark_only";

/** Future: rp_blank_masks / soft clip — stored for expansion without schema churn. */
export interface RPPlacementMaskConfig {
  mode?: "none" | "blank_mask_doc" | "safe_area_clip" | string | null;
  notes?: string | null;
}

/**
 * Canonical blank render profile row (a "zone"): geometry + zone-level blend for flat_blended.
 * Stored in `placements[]` — this is the single source of truth for mockup engines.
 */
/**
 * Optional product-level placement override (per side).
 * **Blank `placements[]` is canonical;** omit or null here to inherit blank defaults.
 * Presence = intentional deviation for this SKU only.
 */
/** One side of `RpProduct.placementOverrides` — merged by `resolveEffectivePlacement`. */
export interface RpProductPlacementOverrideSlice {
  defaultX?: number;
  defaultY?: number;
  defaultScale?: number;
  safeArea?: { x?: number; y?: number; w?: number; h?: number };
}

/** `RpProduct.placementOverrides` — structured alternative to legacy `renderSetup.*.placementOverride`. */
export interface RpProductPlacementOverrides {
  front?: RpProductPlacementOverrideSlice | null;
  back?: RpProductPlacementOverrideSlice | null;
}

/**
 * One side of `RpProduct.renderOverrides` — merged by `resolveEffectiveRenderSettings`
 * after blank zone defaults and variant `renderOverrides`; ahead of legacy `renderSetup.*` blend fields.
 */
export interface RpProductRenderOverrideSlice {
  blendMode?: string | null;
  blendOpacity?: number | null;
  /** Optional UX hint; engines may ignore if they only read blendMode/blendOpacity. */
  renderStylePreset?: string | null;
}

/** `RpProduct.renderOverrides` — structured alternative to legacy `renderSetup.*.blendMode` / `blendOpacity`. */
export interface RpProductRenderOverrides {
  front?: RpProductRenderOverrideSlice | null;
  back?: RpProductRenderOverrideSlice | null;
}

export interface RPPlacement {
  placementId: RPPlacementId;
  label: string;
  /** Redundant with `placementId` prefix; explicit for tooling and queries. */
  view?: "front" | "back" | null;
  defaultX?: number;
  defaultY?: number;
  defaultScale?: number;
  safeArea?: { x: number; y: number; w: number; h: number };
  /**
   * Artboard fraction: design box uses `artboardBase * garment dimension * defaultScale` (matches engine).
   * Default 0.5 (50% of garment width/height before scale).
   */
  artboardBase?: number | null;
  /** Notes on export / print assumptions for this zone. */
  artboardNotes?: string | null;
  allowedDesignAssetMode?: RPAllowedDesignAssetMode | null;
  /** Zone defaults for flat_blended; flat_clean ignores blend. Variant `renderOverrides` still win at product time. */
  renderZoneDefaults?: {
    blendMode?: "normal" | "multiply" | "overlay" | "soft-light" | string | null;
    blendOpacity?: number | null;
  } | null;
  /**
   * 8394 back MVP: persisted simple sliders/preset. Derived `renderZoneDefaults` + `defaultScale` are kept in sync on save.
   */
  simpleRenderControls8394?: RPPlacementSimpleRenderControls8394 | null;
  maskConfig?: RPPlacementMaskConfig | null;
  profileStatus?: RPPlacementProfileStatus | null;
  /** Ops / handoff notes for this zone. */
  notes?: string | null;
}

// User reference
export interface RPUserRef {
  uid: string;
  email?: string;
}

/**
 * rp_blanks/{blankId}
 *
 * **Canonical (schemaVersion === 2):** one document per STYLE (master blank); colors live in `variants[]`.
 * **Legacy:** one document per style+color; top-level `colorName`, `images`, optional `schemaVersion` omitted.
 */
export interface RPBlank {
  blankId: string;
  slug: string;
  status: RPBlankStatus;
  /** 2 = master blank + variants; omit/1 = legacy color-specific row */
  schemaVersion?: number;

  // —— Style identity (canonical) ——
  styleCode: string;
  styleName: string;
  /** Human garment line label, e.g. "Bikini Panty" */
  garmentStyle?: string;
  /** Canonical category key (panty | thong | tank | crewneck | string) */
  category?: string;
  /** @deprecated Prefer `category`; kept for legacy queries */
  garmentCategory?: RPBlankGarmentCategory;
  supplier: string;
  supplierUrl?: string | null;
  supplierSku?: string | null;

  // —— Master model: color variants ——
  variants?: RPBlankVariant[] | null;

  /**
   * Shopify variant matrix: `color` = one sellable variant per color (sizes share that Shopify variant id);
   * `color_size` = Color × Size options with one Shopify row per Rally variant. Omitted / legacy: pre-field sync behavior.
   */
  shopifyVariantMode?: ShopifyVariantMode | null;

  /**
   * Which garment sizes this style carries (master blank). Canonical for **Size** Shopify option.
   * When omitted, product generation uses full XS–XL (see `getProductVariantSizeList`).
   */
  garmentSizes?: RPBlankGarmentSizeCode[] | null;

  // —— Legacy only: single color + images at root (omit when using variants) ——
  colorName?: RPBlankColorName | string;
  colorHex?: string;
  colorFamily?: RPBlankColorFamily | null;
  images?: {
    front: RPImageRef | null;
    back: RPImageRef | null;
  };

  imageMeta?: RPImageMeta;
  placements?: RPPlacement[];
  /**
   * Optional per-render-target tuning (see `RPBlankRenderProfile`).
   * Canonical zone geometry remains `placements[]`.
   */
  renderProfile?: RPBlankRenderProfile | null;
  /**
   * Blank-level render profile gate (not product-level).
   * `approved` = safe for production / bulk generation once zones are tuned.
   */
  renderProfileStatus?: "draft" | "approved" | null;
  renderProfileNotes?: string | null;
  /** Which sides participate in canonical rendering for this style (editor + validation hint). */
  supportedRenderViews?: ("front" | "back")[] | null;
  /**
   * 8394 MVP: which flat look Merch uses as the primary reference when both are generated (handoff / QA).
   * Does not change generation; UI + notes only unless downstream reads this field later.
   */
  preferredFlatLook8394?: "flat_clean" | "flat_blended" | null;
  tags?: string[];
  searchKeywords?: string[];

  createdAt: Timestamp;
  createdBy: RPUserRef;
  updatedAt: Timestamp;
  updatedBy: RPUserRef;

  shopifyDefaults?: RPBlankShopifyDefaults | null;
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
  tagTemplates?: string[] | null;
  defaultPricing?: RPBlankDefaultPricing | null;
  defaultShipping?: RPBlankDefaultShipping | null;
  renderDefaults?: RPBlankRenderDefaults | null;
  sourcing?: RPBlankSourcing | null;
  /** @deprecated Prefer defaultPricing.cost */
  blankCost?: number | null;
  /** @deprecated Prefer defaultPricing.currencyCode */
  costCurrency?: string | null;
  placementNotes?: string | null;
  version?: number | null;

  /**
   * Team/catalog eligibility for generation (broad rules + overrides).
   * Available garment colors are defined only on `variants[]`, not here.
   */
  eligibility?: RPBlankEligibility | null;

  /**
   * Garment-format generation defaults (canonical over product-level strategy).
   * Product page resolves: blank → team → design → central config.
   */
  generationDefaults?: RPBlankGenerationDefaults | null;
  /** Optional `rp_identities` id for default on-model generation (orchestrator / Generate tab). */
  defaultModelId?: string | null;
  /**
   * Default placement driver for new products: which garment side(s) are intended for print.
   * Inferred from `garmentCategory` when unset (e.g. panty/thong → back_only, tank/crewneck → front_only).
   * Resolved against design `supportedSides` / artwork assets at generation time.
   */
  defaultPrintSides?: RPBlankDefaultPrintSides | null;
}

/** Blank-owned defaults for scene/preset resolution on the Product page. */
export interface RPBlankGenerationDefaults {
  /** Which side mockups / primary composite should prefer when not overridden. */
  primaryView?: "front" | "back" | null;
  productOnlyPresetId?: string | null;
  onModelPresetId?: string | null;
  allowedSceneTypes?: RpSceneType[] | null;
  /** Deterministic scene composite key (e.g. hanger) for `generateProductSceneRender`. */
  defaultSceneRenderKey?: string | null;
  /**
   * Future hero pipeline: allowlisted template ids for this blank (garment/format).
   * When set, only these ids are eligible unless overridden upstream.
   * **Do not use array order as a stable default** — `resolveHeroTemplateId` may use `[0]` only as a temporary stub until real selection rules exist.
   */
  allowedHeroTemplateIds?: string[] | null;
  /** Baseline / default-capability hero template for this garment format when upstream layers do not override. */
  preferredHeroTemplateId?: string | null;
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

/** CMYK approximation for print reference (0–100 per channel). */
export interface DesignTeamColorCMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

/**
 * Structured fan phrase / chant. Not safe for automatic product generation without human review;
 * prefer `verified: true` + explicit `type` before any templated merch copy.
 */
export interface DesignTeamFanPhrase {
  text: string;
  type: "fan_generated" | "official" | string;
  verified: boolean;
}

/** One brand color on a design team (design + print prep). */
export interface DesignTeamColor {
  role: "primary" | "secondary" | "tertiary" | string;
  name: string | null;
  hex: string;
  cmyk: DesignTeamColorCMYK;
  /** Optional Pantone identifier when sourced from brand/print specs (e.g. "PMS 186 C"). */
  pantone?: string | null;
}

/**
 * One blank’s row in a team’s **Product Matrix** (explicit catalog allowlist).
 * Stored under `DesignTeam.productCatalogMatrix[blankId]`.
 * @see RALLY_TEAM_PRODUCT_MATRIX_SPEC.md
 */
export interface TeamCatalogBlankEntry {
  /**
   * When false, the blank is hidden from team-scaled generation for this team (keeps history without deleting variant picks).
   * Default: treat as true when omitted.
   */
  enabled?: boolean | null;
  /**
   * Allowlisted `rp_blanks.variants[].variantId` values for this master blank.
   * Empty array = blank offered but no colors approved yet (generation should skip or warn).
   */
  approvedVariantIds: string[];
  updatedAt?: Timestamp | null;
  updatedBy?: RPUserRef | string | null;
}

/** Team-level brand continuity for generation (default identity, on-model preset). */
export interface DesignTeamGenerationDefaults {
  defaultIdentityId?: string | null;
  defaultOnModelPresetId?: string | null;
  /** Future hero pipeline: brand-level preferred `rp_hero_templates` id (conceptual layer: Team). */
  preferredHeroTemplateId?: string | null;
}

// Team document (design_teams/{teamId})
export interface DesignTeam {
  id: string;                       // canonical team slug, e.g. 'san_francisco_giants' (see canonicalTeamSlug.ts)
  /** Full display name, e.g. "San Francisco Giants" */
  name: string;
  /** League label, e.g. "MLB" */
  league?: string | null;
  /** Stable league key for filters (e.g. "MLB") */
  leagueId?: string | null;
  /** Home city for search/filter (e.g. "San Francisco") */
  city?: string | null;
  /** US state / DC / province code (e.g. "CA", "ON", "DC") */
  state?: string | null;
  /** Club nickname without city (e.g. "Giants", "Dodgers") */
  teamName?: string | null;
  /** Venue / stadium name (e.g. "Oracle Park", "FedExForum") */
  stadiumName?: string | null;
  /** Team saying / tagline (e.g. "Whoop That Trick") */
  teamSaying?: string | null;
  /** Fan phrase / culture phrase */
  fanPhrase?: string | null;
  /**
   * Brand colors with hex + CMYK for design reference and print/production.
   * Canonical seed ensures at least one entry; roles reflect importance (primary, secondary, …).
   */
  teamColors?: DesignTeamColor[] | null;
  /** Convenience: matches primary team color hex (normalized #RRGGBB). */
  primaryColorHex?: string | null;
  /** Convenience: secondary brand hex when present; null if single-color identity in seed. */
  secondaryColorHex?: string | null;
  /**
   * Normalized color families for eligibility (e.g. ["orange","black"]).
   * Required for canonical Phase 1 teams; resolver treats missing as no match when color rules apply.
   */
  colorFamilies?: string[] | null;
  /** Normalized code for productIdentityKey (e.g. GIANTS). Prefer this over id when present. */
  teamCode?: string | null;
  /** Kebab-case URL key (e.g. sf-giants). Canonical Phase 1 seed sets this for all pro teams. */
  slug?: string | null;
  /** Mirror of leagueId for templates/filters (e.g. MLB, NFL). */
  leagueCode?: string | null;
  /** Optional `rp_identities` id for default on-model generation (orchestrator / Generate tab). */
  defaultModelId?: string | null;
  /**
   * Default model + on-model preset for generation when design does not override.
   * Product page resolves: blank → **team** → design → config.
   */
  generationDefaults?: DesignTeamGenerationDefaults | null;

  /**
   * MLB: hand-verified brand colors from `mlbVerifiedBrandColors.json` when `"verified"`.
   * Other leagues may omit or use future statuses (e.g. pending).
   */
  colorVerificationStatus?: "verified" | "pending" | string | null;
  /**
   * Print pipeline: whether CMYK (and future Pantone) is authoritative vs hex-derived.
   * `derived` = CMYK computed from hex for consistency; `verified` = manually confirmed for print.
   */
  printVerificationStatus?: "derived" | "verified" | null;
  /**
   * Normalized lowercase hyphenated tokens for search / filtering / SEO (city, nickname, league, slug, etc.).
   * Canonical seed merges explicit `tags` with derived tokens.
   */
  tags?: string[];
  /** Broad geography keywords (e.g. "california", "west-coast"); derived from `state` when not set in seed. */
  region?: string[] | null;
  /**
   * Optional rival `teamCode` references (uppercase). Not auto-populated in seed — add manually when curated.
   */
  rivals?: string[] | null;
  /** Public-facing mascot name when known and non-contentious; omit/null in default seed. */
  mascot?: string | null;
  /** Social-style hashtags (lowercase), e.g. #sf-giants — generic slug/code based in default seed, no slogans. */
  hashtags?: string[] | null;
  /**
   * Curated phrases; **not** safe for automatic product generation without review.
   * Default seed uses `[]`; do not bulk-import trademarked slogans without `type` + legal review.
   */
  fanPhrases?: DesignTeamFanPhrase[] | null;
  /**
   * **Team Product Matrix** — explicit catalog: which blanks and which variant SKUs this team may use
   * for scalable generation (`Generate Team Products` and related flows).
   * Keys are `rp_blanks.blankId`. Omitted blank = not in the team’s approved catalog for bulk flows.
   * Orthogonal to `RPBlank.eligibility` (broad engine rules); bulk generation should require matrix membership.
   */
  productCatalogMatrix?: Record<string, TeamCatalogBlankEntry> | null;

  /**
   * Phase F (teams → design_teams merge, 2026-06-01): explicit lifecycle flag
   * for hiding teams from pickers without deleting historical references.
   * Migrated from the legacy `teams.active` boolean. Missing field = treat
   * as `true` (legacy design_teams docs predate this field and are all
   * implicitly active).
   */
  active?: boolean;
  /**
   * Legacy `teams.keywords` array preserved through the merge. Not used by
   * any rendering pipeline; available for future search/SEO if useful.
   */
  keywords?: string[] | null;
  /** Legacy `teams.bannedTerms` preserved through the merge. */
  bannedTerms?: string[] | null;
  /** Legacy `teams.notes` operator notes. */
  notes?: string | null;
  /** Provenance: which legacy doc this row was migrated from (audit trail). */
  migratedFrom?: string | null;
  migratedAt?: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Design status
export type DesignStatus = "draft" | "active" | "archived";

/**
 * Concept / campaign theme for the design library (field name in Firestore remains `designType`).
 * Style-oriented values (wordmark, script) were removed from the canonical set; see `DesignDesignTypeLegacy`.
 */
export type DesignDesignType =
  | "city_69"
  | "slogan"
  | "stadium"
  | "rivalry"
  | "number"
  | "wordplay"
  | "badge_crest"
  | "pillows"
  | "custom_one_off";

/** Older documents may still store these; UI and functions accept them on read/update */
export type DesignDesignTypeLegacy = "wordmark" | "script" | "other" | "badge";

export type DesignThemeValue = DesignDesignType | DesignDesignTypeLegacy;

/** Print / ink color role (structured); legacy designs may use ink/accent/underbase */
export type DesignPrintColorRole =
  | "team_primary"
  | "team_secondary"
  | "number_light"
  | "number_dark"
  | "accent"
  | "alt"
  | "standard_off_black"
  | "standard_off_white"
  | "other"
  | "ink"
  | "underbase"
  | "unknown";

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
  /** Optional human label (not garment color names) */
  name?: string;
  role?: DesignPrintColorRole | string;
  notes?: string;                   // e.g. 'white underbase required'
  /** Derived from hex unless overridden; 0–100 per channel (sRGB → CMYK reference). */
  cmyk?: { c: number; m: number; y: number; k: number };
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

/** One garment side (front or back): light / dark / white artwork tones + production files. */
export interface DesignGarmentSideFiles {
  lightPng?: DesignFile;
  darkPng?: DesignFile;
  whitePng?: DesignFile;
  lightSvg?: DesignFile;
  darkSvg?: DesignFile;
  whiteSvg?: DesignFile;
  lightPdf?: DesignFile;
  darkPdf?: DesignFile;
  whitePdf?: DesignFile;
}

/** Light / dark / white garment artwork URLs for a single print side. */
export interface DesignGarmentSideAssetUrls {
  lightPng?: string | null;
  darkPng?: string | null;
  whitePng?: string | null;
  lightSvg?: string | null;
  darkSvg?: string | null;
  whiteSvg?: string | null;
  lightPdf?: string | null;
  darkPdf?: string | null;
  whitePdf?: string | null;
}

/** Asset slots for reusable artwork (URLs live on DesignFile.downloadUrl) */
export interface DesignFilesMap {
  /** Side-aware files (preferred). When set, use with `supportedSides` / generation. */
  front?: DesignGarmentSideFiles;
  back?: DesignGarmentSideFiles;
  /** Light garment overlay PNG */
  lightPng?: DesignFile;
  /** Dark garment overlay PNG */
  darkPng?: DesignFile;
  /** White artwork overlay PNG (optional) */
  whitePng?: DesignFile;
  /**
   * @deprecated Legacy single PNG before light/dark split; migrate to assets.lightPng + assets.darkPng.
   * Temporarily treated as light-garment variant only.
   */
  png?: DesignFile;
  /** Light-garment production vector (optional) */
  lightSvg?: DesignFile;
  /** Dark-garment production vector (optional) */
  darkSvg?: DesignFile;
  /** White artwork vector (optional) */
  whiteSvg?: DesignFile;
  /**
   * @deprecated Prefer `lightSvg` + `darkSvg`; kept for older records.
   * Display/upload fallbacks treat this as light-garment when variants are absent.
   */
  svg?: DesignFile;
  /** Light-garment print-ready PDF (optional) */
  lightPdf?: DesignFile;
  /** Dark-garment print-ready PDF (optional) */
  darkPdf?: DesignFile;
  /** White artwork PDF (optional) */
  whitePdf?: DesignFile;
  /**
   * @deprecated Prefer `lightPdf` + `darkPdf`; kept for older records.
   * Display fallbacks treat this as light-garment when variants are absent.
   */
  pdf?: DesignFile;
}

/**
 * Canonical asset URLs for rendering (light vs dark garment, not ink).
 * Prefer `front` / `back` for side-aware designs; legacy flat fields remain for migration.
 * Kept in sync with `files` on write; readers merge via `resolveDesignAssets` / `resolveDesignSideAssets`.
 */
export interface DesignAssetsUrls {
  front?: DesignGarmentSideAssetUrls | null;
  back?: DesignGarmentSideAssetUrls | null;
  /** @deprecated Legacy flat; migrate to front/back. When only legacy exists, readers map to a default side. */
  lightPng?: string | null;
  darkPng?: string | null;
  whitePng?: string | null;
  lightSvg?: string | null;
  darkSvg?: string | null;
  whiteSvg?: string | null;
  /**
   * @deprecated Aggregated / legacy single slot; prefer `lightSvg` + `darkSvg`.
   */
  svg?: string | null;
  lightPdf?: string | null;
  darkPdf?: string | null;
  whitePdf?: string | null;
  /**
   * @deprecated Aggregated / legacy single slot; prefer `lightPdf` + `darkPdf`.
   */
  pdf?: string | null;
}

// Design document (designs/{designId})
export interface DesignDoc {
  id: string;                       // auto-id
  name: string;                     // e.g. 'San Francisco Giants – City 69'
  slug: string;                     // 'sf-giants-design-1'
  teamId: string;                   // 'sf_giants'
  teamNameCache?: string;           // 'San Francisco Giants' (for list speed)
  /** Denormalized from design_teams when available */
  leagueId?: string | null;
  /** Denormalized from design_teams.city for search/filter */
  teamCityCache?: string | null;
  /** Denormalized from design_teams.state */
  teamStateCache?: string | null;
  /** Denormalized from design_teams.teamName (nickname) */
  teamNicknameCache?: string | null;
  status: DesignStatus;

  /** Concept theme for library / filters / automation (Firestore field name unchanged) */
  designType?: DesignThemeValue | null;

  /**
   * Optional campaign / grouping slug (snake_case), e.g. `will_drop_for`.
   * Complements `designType` (theme); does not replace it.
   */
  designSeries?: string | null;

  /** @deprecated Prefer internalNotes; kept for Firestore backfill */
  tags?: string[];
  /** @deprecated Not for Shopify/product copy — migrate to internalNotes */
  description?: string;
  /** Internal-only notes (replaces free-form description for MVP) */
  internalNotes?: string | null;

  // Batch import metadata (RALLY_BATCH_DESIGN_IMPORT) + taxonomy (RALLY_TAXONOMY_SPEC)
  importKey?: string;               // matching key: LEAGUE_DESIGNNAME_TEAM_SIDE_VARIANT
  sportCode?: string | null;        // e.g. 'BASEBALL'
  leagueCode?: string | null;      // e.g. 'MLB'
  designFamily?: string | null;     // e.g. 'WILL_DROP_FOR'
  teamCode?: string | null;         // e.g. 'GIANTS'
  themeCode?: string | null;        // e.g. 'FUNNY_BASEBALL' for generic/humor designs
  taxonomy?: { sportName?: string; leagueName?: string; teamName?: string; themeName?: string } | null;
  /**
   * Operator's per-design picker selection from the bulk-upload review screen:
   * which active master blanks should `onDesignCreated` auto-launch a product
   * for. Null/missing/empty = trigger's default fallback (currently all
   * pipeline-ready blanks, which today means 8394 only). The trigger always
   * further filters by the pipeline-ready style-code gate, so a stale entry
   * here cannot spawn dead stubs.
   */
  targetBlankIds?: string[] | null;

  /**
   * Opt-out from auto-launching products. When `true`, `onDesignCreated`
   * returns early without spawning anything — the design lives in the library
   * but no `rp_products` are created. Set by the bulk-upload "Commit to
   * library" path; unset by default. Operators can still launch products
   * later by calling `launchProductsFromDesign` manually (the stored
   * `targetBlankIds` remain valid for that deferred launch).
   */
  skipAutoLaunch?: boolean | null;

  /**
   * Operator-provided short label that becomes the storefront `designShortName`
   * slot in product titles ("San Francisco Giants **Pillows** Panty"). When set,
   * overrides `designTypeToStorefrontShort(designType)` — escapes the "Custom"
   * fallback that fires when the design type is `custom_one_off`. Editable on
   * the bulk-upload review screen.
   *
   * Defaults to the parser-derived themeName on bulk import; operators can
   * blank it to use the storefront-short default, or type any short phrase
   * (1-3 words is typical: "Pillows", "Subway Series", "City 69 Vintage").
   */
  productLabel?: string | null;
  /**
   * Which garment sides this artwork may print on (front / back). Authoritative for generation
   * when set (e.g. batch import derives from which side keys have assets). Firestore field name unchanged.
   */
  /**
   * Which sides have artwork assets (front / back). Describes inventory only — not garment placement.
   * When unset, derived from nested `assets` / `files` (see `getDesignPrintSidesMode`).
   */
  supportedSides?: string[];        // e.g. ['back'] or ['front','back']
  variant?: string;                 // e.g. 'LIGHT' (batch garment tone; legacy)

  /**
   * Canonical download URLs for asset variants (garment context, not ink).
   * @see DesignAssetsUrls
   */
  assets?: DesignAssetsUrls | null;

  /**
   * Rich file metadata (storage path, dimensions, etc.).
   * @deprecated Prefer `assets` for URLs; `files` retained for uploads and migration.
   */
  files?: DesignFilesMap;

  // Production colors
  colors: DesignColor[];            // 1+ ink colors
  colorCount: number;               // denorm for filtering

  /** @deprecated Advisory only. Prefer Blank.placements as canonical. Use only when Blank has no placement for that id. */
  placementDefaults: DesignPlacementDefault[];

  // Links (denorm quick stats)
  linkedBlankVariantCount: number;  // how many blank variants are associated
  linkedProductCount: number;       // products that use this design

  // Completeness indicators
  hasSvg: boolean;
  /** True if legacy PNG exists OR both light+dark variants exist */
  hasPng: boolean;
  hasLightPng?: boolean;
  hasDarkPng?: boolean;
  hasWhitePng?: boolean;
  hasPdf: boolean;
  /** Metadata + both PNG variants (or legacy single PNG with partial flag in UI) */
  isComplete: boolean;

  // Search keywords (for fast queries)
  searchKeywords: string[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  updatedByUid: string;

  /**
   * Optional campaign overrides for generation (preset / identity / hero template).
   * Conceptual layer: Design — resolved after blank + team defaults; see `lib/hero/resolveHeroTemplate.ts` for hero precedence.
   */
  generationOverrides?: DesignGenerationOverrides | null;

  /** Bulk design uploader traceability */
  importSource?: string | null;
  importBatchId?: string | null;
  importVersion?: string | null;
}

/** rp_design_import_jobs/{jobId} — bulk design upload batch */
export type RpDesignImportJobStatus =
  | "draft"
  | "uploading"
  | "parsing"
  | "ready"
  | "blocked"
  | "importing"
  | "completed"
  | "failed"
  | "partial";

export interface RpDesignImportJobDoc {
  id: string;
  status: RpDesignImportJobStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  totalFiles: number;
  acceptedFiles: number;
  ignoredFiles: number;
  groupedDesignCount: number;
  createdDesignCount?: number;
  updatedDesignCount?: number;
  skippedCount?: number;
  blockedDesignCount?: number;
  failedCount?: number;
  notes?: string | null;
  summary?: string | null;
  importVersion?: string;
  /** Original ignored filenames + reasons (compact) */
  ignoredList?: { name: string; reason: string }[];
  /** Server-side filename parse failures (preview step) */
  parseFailures?: { name: string; message: string }[];
}

export type RpDesignImportItemAction = "create" | "update" | "skip" | "blocked";

/** rp_design_import_jobs/{jobId}/items/{itemId} */
export interface RpDesignImportJobItemDoc {
  id: string;
  itemId?: string;
  groupKey: string;
  designName: string;
  slug: string;
  leagueCode?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  themeCode?: string | null;
  themeName?: string | null;
  designSeries?: string | null;
  designType?: string | null;
  /** Legacy client shape; server-authoritative items use `files` as structured entries */
  files: string[] | RpDesignImportJobItemFileEntry[];
  assetCoverage: Record<string, boolean>;
  warnings: string[];
  errors: string[];
  action?: RpDesignImportItemAction;
  defaultAction?: RpDesignImportItemAction;
  confirmedAction?: RpDesignImportItemAction;
  existingDesignId?: string | null;
  existingMatchReason?: string | null;
  overwriteWarnings?: Record<string, boolean>;
  overwriteAllowed?: boolean;
  duplicateKindConflicts?: boolean;
  resultStatus?: "ok" | "failed" | "skipped" | "blocked";
  resultDesignId?: string | null;
  resultError?: string | null;
}

/** Per-file row written by bulk import preview (server). */
export interface RpDesignImportJobItemFileEntry {
  kind: string;
  originalFilename: string;
  storagePath: string;
  ext: string;
  size: number;
  filenameLegacySide?: string | null;
  contentType?: string;
}

/** Design-level overrides for Product page generation resolution. */
export interface DesignGenerationOverrides {
  productOnlyPresetId?: string | null;
  onModelPresetId?: string | null;
  identityId?: string | null;
  /** Future hero pipeline: campaign-level `rp_hero_templates` id (conceptual layer: Design). */
  heroTemplateId?: string | null;
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
  /** @deprecated Advisory only. Prefer Blank.placements as canonical. */
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

  /** When set, successful/failed mock updates this product (and optional variant). */
  productId?: string | null;
  productVariantId?: string | null;

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

/**
 * How a mask was produced. Existing docs without this field are treated as `manual_upload`.
 * See RALLY_BLANK_MASK_AI_AUTOGEN.md for the source state machine.
 */
export type RPBlankMaskSource = "manual_upload" | "ai_sam" | "auto_safearea";

/**
 * Which rendering surface this mask is for.
 *
 * - `flat_front` / `flat_back` — the catalog flat photo of the garment (one mask per
 *   blank, shared across all colors). Same geometry as the legacy
 *   `{blankId}_{view}` doc id.
 * - `model_front` / `model_back` — a specific model photo (different per color +
 *   pose, because each variant's model shot has a unique silhouette). Requires
 *   `variantId` so the AI mask generator can read `variant.images.modelFront/Back`.
 *
 * Legacy mask docs lack this field; treat as `flat_<view>`.
 */
export type RPBlankMaskRenderTarget =
  | "flat_front"
  | "flat_back"
  | "model_front"
  | "model_back";

// Blank mask document.
//
// Doc id patterns:
//   - Flat mask (one per blank+view, shared across colors):
//       `{blankId}_{view}`
//   - Model-pose mask (one per blank+variant+pose, because each color has a
//     distinct model photo):
//       `{blankId}_{variantId}_{model_front|model_back}`
//
// The flat form is preserved verbatim so existing flat masks keep working.
export interface RPBlankMask {
  id: string;                     // e.g. "abc123_front" or "abc123_var-id_model_front"

  blankId: string;                // FK to rp_blanks
  view: "front" | "back";

  /**
   * Surface this mask is for. Optional for backward compat — when omitted, treat
   * as `flat_<view>`. New writes always set it explicitly.
   */
  renderTarget?: RPBlankMaskRenderTarget;

  /**
   * Required when `renderTarget` starts with `model_`. Identifies which variant
   * (color) the model photo belongs to so the renderer can pair mask ↔ photo.
   * Null/missing for flat masks.
   */
  variantId?: string | null;

  mask: RPImageRef;               // PNG mask file (white = editable, black = protected)

  mode: RPBlankMaskMode;          // "inpaint" (default)

  notes?: string;                 // Optional operator notes

  /** How the mask was produced. Omitted in legacy docs → treat as `manual_upload`. */
  source?: RPBlankMaskSource;

  /** SAM text prompt used to generate this mask. Only when `source === "ai_sam"`. */
  aiPrompt?: string;

  /** Random seed used to generate this mask. Only when `source === "ai_sam"`. */
  aiSeed?: number;

  /**
   * Phase A cost-meter telemetry (introduced 2026-06-01). Populated when the
   * mask was generated by `runFalInference` (via runSam). Older docs lack
   * these fields — the dashboard widget treats `null`/missing as "unknown"
   * rather than $0 so spend totals don't undercount.
   */
  falCostUsd?: number | null;
  falLatencyMs?: number | null;
  falRequestId?: string | null;
  /** fal.ai endpoint slug, e.g. `fal-ai/evf-sam`. Useful for grouping spend. */
  falEndpoint?: string | null;

  /**
   * Set when the operator clicks **Save** on an AI-generated preview (or otherwise
   * explicitly commits a mask they intend to ship). Production-render enforcement is
   * not implemented yet — this field exists so a follow-up can read it without a migration.
   */
  lockedAt?: Timestamp | null;

  // Timestamps
  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
  updatedByUid: string;
}

/**
 * Async preview-render job. The synchronous Firebase callable HTTP gateway times out
 * at ~60s — too short for fal.ai realism (20–60s + polling). This collection lets the
 * `previewBlankRender` callable enqueue work, return immediately, and have a Firestore
 * trigger process Stage A → Stage B in the background. The editor subscribes via
 * `onSnapshot` and progresses the UI as fields land. See RALLY_BLANK_PREVIEW_RENDER.md.
 */
export type RPBlankPreviewJobStatus = "queued" | "processing" | "completed" | "failed";

export interface RPBlankPreviewJobPlacementInput {
  x: number;
  y: number;
  scale: number;
  /** safeArea.w in fraction of blank — Option A safeArea-based sizing. */
  width?: number | null;
  height?: number | null;
  blendMode?: string | null;
  blendOpacity?: number | null;
  maskConfig?: { mode?: string | null } | null;
}

export interface RPBlankPreviewJobStageA {
  previewUrl: string;
  storagePath: string;
  width: number;
  height: number;
  bytes: number;
  maskApplied: boolean;
  maskMean?: number | null;
  maskMode?: string | null;
  /** Phase L: design was perspective-warped onto the saved chest quad (model targets). */
  quadWarpApplied?: boolean;
  /** Phase L7: print was clipped to the garment silhouette (curves out of sight at the fabric edge). */
  garmentClipApplied?: boolean;
  placementUsed?: { x: number; y: number; scale: number; blendMode: string; blendOpacity: number };
}

/**
 * Phase A inference telemetry. Stamped onto stageB by `runFalInference` and
 * mirrored at the job-doc top level for dashboard aggregation queries.
 */
export interface RPBlankPreviewJobInferenceTelemetry {
  costUsd: number | null;
  latencyMs: number;
  endpoint: string;
  requestId: string | null;
}

/**
 * Phase B: stable identifiers for the registered VTON providers. New
 * providers added to functions/lib/vtonProviders.js should also be added
 * here so the type system catches typos at job-creation time.
 */
export type RPVtonProviderId = "flux_fill" | "kolors_vto" | "flux2_vto";

export interface RPBlankPreviewJobStageB {
  previewUrl: string;
  storagePath: string;
  width: number;
  height: number;
  bytes: number;
  falEndpoint: string;
  /**
   * Phase B: which VTON provider produced this realism PNG. Legacy
   * pre-Phase-B docs lack this field; consumers should treat missing as
   * `"flux_fill"` (the historical default).
   */
  providerId?: RPVtonProviderId;
  /**
   * Provider-specific params bag — shape depends on `providerId`. Flux Fill:
   * { strength, num_inference_steps, guidance_scale, seed, fabric_feel, ... }.
   * Kolors VTO: { modelImageUrl, garmentDraftBytes }. Don't rely on specific
   * fields — use `providerId` to discriminate.
   */
  params: Record<string, unknown>;
  /** Phase A: cost meter telemetry from runFalInference. */
  inference?: RPBlankPreviewJobInferenceTelemetry | null;
}

export interface RPBlankPreviewJob {
  id: string;
  blankId: string;
  variantId?: string | null;
  designId: string;
  view: "front" | "back";
  /**
   * Per-target render surface. Defaults to `flat_<view>` for legacy jobs.
   * Model targets require a non-null variantId (each color's model photo has
   * unique geometry, so masks + composites must be per-variant).
   */
  renderTarget?: "flat_front" | "flat_back" | "model_front" | "model_back";
  artworkMode?: "light" | "dark" | "white";
  placement: RPBlankPreviewJobPlacementInput;

  /**
   * Phase 3: optional product binding. When set, the trigger writes the Stage B
   * result URL onto the product variant's `flatRenders[officialRole]` slot when
   * the job completes — so the editor-only preview pipeline doubles as the
   * production renderer for product assets.
   *
   * Editor-only jobs leave all three fields null.
   */
  targetProductId?: string | null;
  targetVariantId?: string | null;
  /**
   * Which `enabledOfficialRolesOrdered` slot to fill on the variant.
   * For Phase 2 model realism this is typically `model_back_designed`
   * (back-printed garments) or `model_front_designed` (front-printed).
   * Strings are the official role names from `blankProductImagePlan.js`.
   */
  officialRole?:
    | "flat_back_designed"
    | "flat_front_designed"
    | "model_back_designed"
    | "model_front_designed"
    | "model_back_clean"
    | "model_front_clean"
    | "flat_back_clean"
    | "flat_front_clean"
    | null;
  /** When true, the trigger runs Stage A then Stage B; otherwise Stage A only. */
  withRealism: boolean;

  /**
   * Phase B: which VTON provider to dispatch through for Stage B. Pre-Phase-B
   * docs lack this field; the trigger defaults to `"flux_fill"` for back-compat.
   * The A/B harness sets this explicitly when fanning out N jobs across
   * providers from the same Stage A input.
   */
  providerId?: RPVtonProviderId;

  /**
   * Phase I (2026-06-01): identity attachment. When set, the trigger pulls
   * referenceImages from `rp_identities/{identityId}` and threads them into
   * the VTON provider's context. The identity's `preferredProviderId` also
   * overrides the job-level `providerId` UNLESS the job explicitly set one
   * (A/B harness use case). Legacy jobs without this field route as before.
   */
  identityId?: string | null;

  /**
   * Phase B: when this job is part of an A/B fan-out, every job in the same
   * fan-out shares this id. The comparison UI queries
   * `where("abTestGroupId", "==", groupId)` to render all attempts side-by-side.
   * Single-job (non-A/B) callables leave this field unset.
   */
  abTestGroupId?: string | null;

  status: RPBlankPreviewJobStatus;
  /** Populated when `status === "failed"`. */
  error?: string | null;

  stageA?: RPBlankPreviewJobStageA | null;
  stageB?: RPBlankPreviewJobStageB | null;

  /**
   * Phase A: top-level mirror of stageB.inference fields. The trigger lifts
   * these from stageB so the dashboard widget can query
   * `where("falCostUsd", ">", 0)` without descending into nested objects (and
   * without needing a Firestore composite index for stageB.inference.costUsd).
   * Null when realism wasn't run (Stage A only).
   */
  falCostUsd?: number | null;
  falLatencyMs?: number | null;
  falEndpoint?: string | null;
  falRequestId?: string | null;

  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
}


// --------------------------------------------------------------------
// Phase C: AI scene generation via Flux Kontext
// --------------------------------------------------------------------

/**
 * Curated scene templates the operator can pick from when generating
 * lifestyle / studio / gameday variations of a product render. The full
 * list (with prompts) lives in functions/lib/sceneTemplates.js — keep
 * this string union in sync. Adding one here without registering it
 * server-side will cause invalid-argument errors at job-creation time.
 */
export type RPSceneTemplateId =
  | "gameday_stadium"
  | "lifestyle_coffee"
  | "outdoor_park"
  | "studio_clean"
  | "editorial_moody"
  | "flatlay_table"
  | "hanging_rack"
  | "detail_print_crop";

export type RPSceneSourceSlot =
  | "flat_front_designed"
  | "flat_back_designed"
  | "model_front_designed"
  | "model_back_designed"
  | "flat_blended"
  | "custom";

export type RPSceneJobStatus = "queued" | "processing" | "completed" | "failed";

export interface RPSceneJobResult {
  url: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  bytes: number;
  sourceUrl: string;
  sourceSlot: RPSceneSourceSlot;
  sceneTemplateId: RPSceneTemplateId;
  category: string;
  prompt: string;
  renderedAt: Timestamp;
}

export interface RPSceneJob {
  id: string;
  productId: string;
  variantId: string;
  sourceSlot: RPSceneSourceSlot;
  /** Set only when sourceSlot="custom". */
  sourceUrlOverride: string | null;
  sceneTemplateId: RPSceneTemplateId;
  /** When part of a batch fan-out (enqueueSceneJobBatch), all sibling jobs share this. */
  sceneSetId?: string;
  status: RPSceneJobStatus;
  error: string | null;
  result: RPSceneJobResult | null;
  /** Phase A cost meter — top-level for dashboard aggregation queries. */
  falCostUsd?: number | null;
  falLatencyMs?: number | null;
  falEndpoint?: string | null;
  falRequestId?: string | null;
  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
}

/**
 * Phase C: per-variant scene render storage. The trigger writes
 * variant.sceneRenders[templateId] when a scene job completes. The product
 * page reads from this map to render the scene gallery.
 */
export interface RPVariantSceneRender {
  url: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  bytes: number;
  sceneTemplateId: RPSceneTemplateId;
  category: string;
  sourceSlot: RPSceneSourceSlot;
  sourceUrl: string;
  jobId: string;
  updatedAt: Timestamp;
}



// --------------------------------------------------------------------
// Phase E: durable batch fan-out tracking (rp_batches)
// --------------------------------------------------------------------

/**
 * Stable identifiers for the kinds of batches Rally can fan out. Each kind
 * corresponds to a specific batch callable + child-job collection:
 *
 *   - vton_ab            → enqueueVtonAbTest          → rp_blank_preview_jobs
 *   - scene_set          → enqueueSceneJobBatch       → rp_scene_jobs
 *   - product_realism    → enqueueProductModelRealismBatch → rp_blank_preview_jobs
 *   - shopify_collections → syncShopifySmartCollectionsFromTaxonomy (no child docs;
 *                            tracks N taxonomy upserts in summary[])
 */
export type RPBatchKind =
  | "vton_ab"
  | "scene_set"
  | "product_realism"
  | "shopify_collections";

export type RPBatchStatus =
  | "queued"        // batch doc + child docs created, no triggers fired yet
  | "running"       // at least one child job in_progress / completed / failed
  | "completed"     // every child reached a terminal state, ALL succeeded
  | "partial"       // every child terminal, but ≥1 failed (NOT a fatal batch error)
  | "failed";       // the fan-out callable itself errored before/while creating child docs

/**
 * One row per fan-out. The batch doc is the ATOMIC anchor — created in the same
 * Firestore batched write as its child job docs so a half-fan-out is impossible
 * (either all docs land or none do). Progress triggers on the child collections
 * update the counter fields via FieldValue.increment.
 */
export interface RPBatch {
  id: string;
  kind: RPBatchKind;
  status: RPBatchStatus;

  /**
   * Counts. `total` is set at fan-out time; the others increment from 0 as
   * child jobs transition. `total = completed + failed + (queued + processing)`
   * is the loop invariant.
   */
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;

  /** Free-form bag for kind-specific metadata that helps the UI render the batch. */
  metadata?: {
    /** Product context for product-scoped batches. */
    productId?: string | null;
    variantId?: string | null;
    /** For vton_ab: which providers were in the fan-out. */
    providerIds?: string[];
    /** For scene_set: which templates were in the fan-out. */
    sceneTemplateIds?: string[];
    /** Free-form label for the dashboard batch list. */
    label?: string | null;
  };

  /** Top-level cost mirror, summed from child jobs by the progress trigger. */
  falCostUsdTotal?: number | null;

  /** Populated when the fan-out callable itself errored before completing. */
  error?: string | null;

  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
}
