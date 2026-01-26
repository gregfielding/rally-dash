#!/usr/bin/env node

/**
 * Script to find and remove duplicate images in a dataset.
 * 
 * Usage (from functions directory):
 *   node scripts/remove-duplicate-images.js <datasetId>
 * 
 * Example:
 *   node scripts/remove-duplicate-images.js H0BDpCGNhMuomyDXizhM
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin (same as functions/index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

async function findAndRemoveDuplicates(datasetId) {
  console.log(`\n🔍 Checking dataset: ${datasetId}\n`);

  // Fetch all images for this dataset
  const imagesRef = db.collection("rp_dataset_images");
  const snapshot = await imagesRef
    .where("datasetId", "==", datasetId)
    .get();

  if (snapshot.empty) {
    console.log("❌ No images found for this dataset.");
    return;
  }

  console.log(`📊 Found ${snapshot.size} total images\n`);

  const images = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    images.push({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toMillis?.() || (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : 0) || Date.now(),
    });
  });

  // Group by storagePath to find duplicates
  const byStoragePath = new Map();
  images.forEach((img) => {
    if (img.storagePath) {
      if (!byStoragePath.has(img.storagePath)) {
        byStoragePath.set(img.storagePath, []);
      }
      byStoragePath.get(img.storagePath).push(img);
    }
  });

  // Group by downloadUrl to find duplicates
  const byDownloadUrl = new Map();
  images.forEach((img) => {
    if (img.downloadUrl) {
      if (!byDownloadUrl.has(img.downloadUrl)) {
        byDownloadUrl.set(img.downloadUrl, []);
      }
      byDownloadUrl.get(img.downloadUrl).push(img);
    }
  });

  // Find duplicates
  const duplicatesToRemove = new Set();
  let duplicateCount = 0;

  // Check storagePath duplicates
  console.log("🔎 Checking for duplicates by storage path...");
  for (const [storagePath, imgs] of byStoragePath.entries()) {
    if (imgs.length > 1) {
      console.log(`  ⚠️  Found ${imgs.length} images with same storage path: ${storagePath}`);
      // Sort by createdAt (oldest first) and keep the first one
      imgs.sort((a, b) => a.createdAt - b.createdAt);
      // Mark all except the first (oldest) for removal
      for (let i = 1; i < imgs.length; i++) {
        duplicatesToRemove.add(imgs[i].id);
        duplicateCount++;
        console.log(`    🗑️  Will remove: ${imgs[i].id} (created: ${new Date(imgs[i].createdAt).toISOString()})`);
      }
      console.log(`    ✓ Keeping: ${imgs[0].id} (oldest, created: ${new Date(imgs[0].createdAt).toISOString()})`);
    }
  }

  // Check downloadUrl duplicates
  console.log("\n🔎 Checking for duplicates by download URL...");
  for (const [downloadUrl, imgs] of byDownloadUrl.entries()) {
    if (imgs.length > 1) {
      // Only process if not already marked for removal
      const unprocessed = imgs.filter((img) => !duplicatesToRemove.has(img.id));
      if (unprocessed.length > 1) {
        console.log(`  ⚠️  Found ${imgs.length} images with same download URL (${unprocessed.length} not yet marked)`);
        // Sort by createdAt (oldest first) and keep the first one
        unprocessed.sort((a, b) => a.createdAt - b.createdAt);
        // Mark all except the first (oldest) for removal
        for (let i = 1; i < unprocessed.length; i++) {
          duplicatesToRemove.add(unprocessed[i].id);
          duplicateCount++;
          console.log(`    🗑️  Will remove: ${unprocessed[i].id} (created: ${new Date(unprocessed[i].createdAt).toISOString()})`);
        }
        console.log(`    ✓ Keeping: ${unprocessed[0].id} (oldest, created: ${new Date(unprocessed[0].createdAt).toISOString()})`);
      }
    }
  }

  if (duplicatesToRemove.size === 0) {
    console.log("\n✅ No duplicates found! All images are unique.\n");
    return;
  }

  console.log(`\n📋 Summary:`);
  console.log(`   Total images: ${images.length}`);
  console.log(`   Duplicates found: ${duplicateCount}`);
  console.log(`   Unique images: ${images.length - duplicateCount}`);
  console.log(`   Images to remove: ${duplicatesToRemove.size}\n`);

  // Ask for confirmation (in a real script, you might want to use readline)
  console.log("⚠️  About to remove duplicate images from Firestore.");
  console.log("   Storage files will NOT be deleted (to prevent accidental data loss).");
  console.log("   You can manually clean up storage files later if needed.\n");

  // Get the images to remove
  const imagesToRemove = images.filter((img) => duplicatesToRemove.has(img.id));

  // Remove from Firestore
  console.log("🗑️  Removing duplicates from Firestore...\n");
  let removedCount = 0;
  let errorCount = 0;

  for (const img of imagesToRemove) {
    try {
      await db.collection("rp_dataset_images").doc(img.id).delete();
      console.log(`   ✓ Removed: ${img.id} (${img.storagePath || "no path"})`);
      removedCount++;
    } catch (error) {
      console.error(`   ❌ Error removing ${img.id}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Removed: ${removedCount} duplicate images`);
  if (errorCount > 0) {
    console.log(`   Errors: ${errorCount}`);
  }
  console.log(`   Remaining unique images: ${images.length - removedCount}\n`);
}

// Main execution
const datasetId = process.argv[2];

if (!datasetId) {
  console.error("❌ Error: Dataset ID is required");
  console.error("\nUsage:");
  console.error("  node scripts/remove-duplicate-images.js <datasetId>");
  console.error("\nExample:");
  console.error("  node scripts/remove-duplicate-images.js H0BDpCGNhMuomyDXizhM");
  process.exit(1);
}

findAndRemoveDuplicates(datasetId)
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
