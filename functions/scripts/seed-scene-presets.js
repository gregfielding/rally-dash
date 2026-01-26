#!/usr/bin/env node

/**
 * Script to seed the 3 initial scene presets into Firestore.
 * 
 * Usage (from functions directory):
 *   node scripts/seed-scene-presets.js
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const presets = [
  // NEW: Product Packshot White (Section 11.1)
  {
    name: "Product Packshot White",
    slug: "product-packshot-white",
    sceneType: "ecommerce",
    mode: "productOnly", // NEW
    supportedModes: ["product_only"], // Legacy, kept for backward compatibility
    description: "Clean product-only packshots on white background",
    safetyProfile: "general_safe", // NEW
    requireIdentity: false, // NEW
    allowFaceArtifact: false, // NEW
    allowBodyArtifact: false, // NEW
    allowProductArtifact: true, // NEW
    defaultProductScale: 0.95, // NEW
    defaultImageCount: 4, // NEW
    promptTemplate: "clean ecommerce packshot of {productName} ({productColorway}), laid flat, centered, pure white background, soft studio shadow, high detail fabric texture, realistic stitching, product only, no model, no person",
    negativePromptTemplate: "person, model, mannequin, body, wearing, hands, legs, torso, lifestyle scene, clutter, text overlay, watermark",
    defaults: {
      imageSize: "square",
      imageCount: 4,
      productScale: 0.95,
    },
    isActive: true,
  },
  // NEW: Underwear Studio On-Model (Section 11.2)
  {
    name: "Underwear Studio On-Model",
    slug: "underwear-studio-on-model",
    sceneType: "studio",
    mode: "onModel", // NEW
    supportedModes: ["on_model"], // Legacy
    description: "Studio on-model photography with strict underwear safety",
    safetyProfile: "underwear_strict", // NEW
    requireIdentity: true, // NEW
    allowFaceArtifact: true, // NEW
    allowBodyArtifact: true, // NEW
    allowProductArtifact: true, // NEW
    defaultFaceScale: 0.80, // NEW (recommended for identity locking)
    defaultBodyScale: 0.60, // NEW
    defaultProductScale: 0.90, // NEW
    defaultImageCount: 4, // NEW
    promptTemplate: "{identityTrigger}, adult woman, female model, studio lighting, clean neutral background, wearing matching bra or bralette and panties, fully covered, no nudity, commercial fashion photography, realistic skin texture",
    negativePromptTemplate: "nude, topless, nipples, areola, exposed breasts, naked, explicit, man, male, boy, porn, sexual act, fetish, watermark, text overlay",
    defaults: {
      imageSize: "square",
      imageCount: 4,
      faceScale: 0.80,
      bodyScale: 0.60,
      productScale: 0.90,
    },
    isActive: true,
  },
  // Updated: Ecommerce White (migrated to use mode)
  {
    name: "Ecommerce White",
    slug: "ecommerce-white",
    sceneType: "ecommerce",
    mode: "onModel", // NEW (default, but supports both via legacy supportedModes)
    supportedModes: ["product_only", "on_model"], // Legacy, kept for backward compatibility
    safetyProfile: "general_safe", // NEW
    requireIdentity: false, // NEW (optional for this preset)
    allowFaceArtifact: true, // NEW
    allowBodyArtifact: true, // NEW
    allowProductArtifact: true, // NEW
    defaultFaceScale: 0.75, // NEW
    defaultBodyScale: 0.60, // NEW
    defaultProductScale: 0.90, // NEW
    defaultImageCount: 4, // NEW
    promptTemplate: `{identityTrigger}, blonde hair, blue-green eyes, fair warm skin tone,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
full body head-to-toe, standing naturally, relaxed posture,
ecommerce studio photo, seamless white background,
realistic fabric texture, natural wrinkles, accurate shadows,
sharp focus, real camera look`,
    negativePromptTemplate: `dark hair, brunette, brown hair, black hair, red hair, auburn hair,
cartoon, CGI, plastic skin, blurry, extra limbs, deformed hands, man, male, boy`,
    defaults: {
      imageSize: "square",
      imageCount: 4,
      faceScale: 0.75,
      bodyScale: 0.6,
      productScale: 0.9,
    },
    isActive: true,
  },
  // Updated: Studio Editorial
  {
    name: "Studio Editorial",
    slug: "studio-editorial",
    sceneType: "studio",
    mode: "onModel", // NEW
    supportedModes: ["on_model"], // Legacy
    safetyProfile: "general_safe", // NEW
    requireIdentity: true, // NEW
    allowFaceArtifact: true, // NEW
    allowBodyArtifact: true, // NEW
    allowProductArtifact: true, // NEW
    defaultFaceScale: 0.80, // NEW
    defaultBodyScale: 0.60, // NEW
    defaultProductScale: 0.90, // NEW
    defaultImageCount: 4, // NEW
    promptTemplate: `{identityTrigger}, blonde hair, natural makeup,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
studio editorial fashion photography, neutral backdrop,
soft directional light, cinematic, shallow depth of field,
high-end lingerie campaign look, realistic skin texture`,
    negativePromptTemplate: `dark hair, brunette, brown hair, black hair, red hair, auburn hair,
cartoon, CGI, plastic skin, blurry, extra limbs, deformed hands, man, male, boy`,
    defaults: {
      imageSize: "portrait",
      imageCount: 4,
      faceScale: 0.80,
      bodyScale: 0.60,
      productScale: 0.90,
    },
    isActive: true,
  },
  // Updated: Lifestyle Outdoor
  {
    name: "Lifestyle Outdoor",
    slug: "lifestyle-outdoor",
    sceneType: "lifestyle",
    mode: "onModel", // NEW
    supportedModes: ["on_model"], // Legacy
    safetyProfile: "general_safe", // NEW
    requireIdentity: true, // NEW
    allowFaceArtifact: true, // NEW
    allowBodyArtifact: true, // NEW
    allowProductArtifact: true, // NEW
    defaultFaceScale: 0.80, // NEW
    defaultBodyScale: 0.60, // NEW
    defaultProductScale: 0.90, // NEW
    defaultImageCount: 4, // NEW
    promptTemplate: `{identityTrigger}, blonde hair, bright daylight,
wearing {PRODUCT_TRIGGER} in {COLORWAY_NAME},
lifestyle outdoor photo, candid, natural smile,
realistic shadows, authentic camera grain, high-end look`,
    negativePromptTemplate: `dark hair, brunette, brown hair, black hair, red hair, auburn hair,
cartoon, CGI, plastic skin, blurry, extra limbs, deformed hands, man, male, boy`,
    defaults: {
      imageSize: "landscape",
      imageCount: 4,
      faceScale: 0.80,
      bodyScale: 0.60,
      productScale: 0.90,
    },
    isActive: true,
  },
];

async function seedPresets() {
  console.log("\n🌱 Seeding scene presets...\n");

  const presetsRef = db.collection("rp_scene_presets");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = "system"; // Or get from context

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const preset of presets) {
    // Check if preset already exists (by name or slug)
    const nameQuery = await presetsRef.where("name", "==", preset.name).get();
    const slugQuery = preset.slug ? await presetsRef.where("slug", "==", preset.slug).get() : { empty: true, docs: [] };
    
    const existing = !nameQuery.empty ? nameQuery.docs[0] : (!slugQuery.empty ? slugQuery.docs[0] : null);
    
    if (existing) {
      // Update existing preset with new fields (mode, safetyProfile, defaults, etc.)
      const existingData = existing.data();
      const needsUpdate = 
        !existingData.mode ||
        !existingData.safetyProfile ||
        !existingData.defaultFaceScale ||
        !existingData.defaultBodyScale ||
        !existingData.defaultProductScale;
      
      if (needsUpdate) {
        try {
          const updateData = {
            mode: preset.mode || existingData.mode || "onModel",
            safetyProfile: preset.safetyProfile || existingData.safetyProfile || "general_safe",
            requireIdentity: preset.requireIdentity !== undefined ? preset.requireIdentity : (existingData.requireIdentity !== undefined ? existingData.requireIdentity : true),
            allowFaceArtifact: preset.allowFaceArtifact !== undefined ? preset.allowFaceArtifact : (existingData.allowFaceArtifact !== undefined ? existingData.allowFaceArtifact : true),
            allowBodyArtifact: preset.allowBodyArtifact !== undefined ? preset.allowBodyArtifact : (existingData.allowBodyArtifact !== undefined ? existingData.allowBodyArtifact : true),
            allowProductArtifact: preset.allowProductArtifact !== undefined ? preset.allowProductArtifact : (existingData.allowProductArtifact !== undefined ? existingData.allowProductArtifact : true),
            defaultFaceScale: preset.defaultFaceScale || existingData.defaultFaceScale || 0.80,
            defaultBodyScale: preset.defaultBodyScale || existingData.defaultBodyScale || 0.60,
            defaultProductScale: preset.defaultProductScale || existingData.defaultProductScale || 0.90,
            defaultImageCount: preset.defaultImageCount || existingData.defaultImageCount || 4,
            slug: preset.slug || existingData.slug || null,
            description: preset.description || existingData.description || null,
            promptTemplate: preset.promptTemplate || existingData.promptTemplate,
            negativePromptTemplate: preset.negativePromptTemplate || existingData.negativePromptTemplate || null,
            defaults: {
              ...existingData.defaults,
              ...preset.defaults,
            },
            updatedAt: now,
            updatedBy: userId,
          };
          
          await existing.ref.update(updateData);
          console.log(`🔄 Updated "${preset.name}" with mode: ${updateData.mode}, safetyProfile: ${updateData.safetyProfile}`);
          updated++;
        } catch (error) {
          console.error(`❌ Failed to update "${preset.name}":`, error.message);
        }
      } else {
        console.log(`⏭️  Skipping "${preset.name}" (already up to date)`);
        skipped++;
      }
      continue;
    }

    try {
      await presetsRef.add({
        ...preset,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
      });
      console.log(`✅ Created "${preset.name}" with mode: ${preset.mode}, safetyProfile: ${preset.safetyProfile || "general_safe"}`);
      created++;
    } catch (error) {
      console.error(`❌ Failed to create "${preset.name}":`, error.message);
    }
  }

  console.log(`\n✅ Complete! Created: ${created}, Updated: ${updated}, Skipped: ${skipped}\n`);
}

seedPresets()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
