#!/usr/bin/env node

/**
 * Script to check images in Firestore (diagnostic).
 * 
 * Usage:
 *   node scripts/check-images.js [datasetId]
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function checkImages(datasetId) {
  console.log("\n🔍 Checking images in Firestore...\n");

  try {
    // Try to get all images
    const imagesRef = db.collection("rp_dataset_images");
    let snapshot;

    if (datasetId) {
      console.log(`📊 Querying images for dataset: ${datasetId}\n`);
      snapshot = await imagesRef.where("datasetId", "==", datasetId).get();
    } else {
      console.log(`📊 Querying all images...\n`);
      snapshot = await imagesRef.limit(10).get();
    }

    if (snapshot.empty) {
      console.log("❌ No images found.");
      if (datasetId) {
        console.log(`   Dataset ID: ${datasetId}`);
        console.log("   Try running without datasetId to see all images.");
      }
      return;
    }

    console.log(`✅ Found ${snapshot.size} image(s)\n`);

    snapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`📷 ${doc.id}`);
      console.log(`   Dataset: ${data.datasetId || "N/A"}`);
      console.log(`   Storage Path: ${data.storagePath || "N/A"}`);
      console.log(`   Download URL: ${data.downloadUrl ? data.downloadUrl.substring(0, 60) + "..." : "N/A"}`);
      console.log(`   Kind: ${data.kind || "N/A"}`);
      console.log(`   Source: ${data.source || "N/A"}`);
      console.log("");
    });

    console.log("✅ Done.\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("   This might be an authentication issue.");
    console.error("   Make sure you're authenticated with Firebase or have proper credentials set up.\n");
  }
}

const datasetId = process.argv[2];
checkImages(datasetId)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
