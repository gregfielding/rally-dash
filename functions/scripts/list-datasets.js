#!/usr/bin/env node

/**
 * Script to list all datasets and their image counts.
 * 
 * Usage:
 *   node scripts/list-datasets.js
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function listDatasets() {
  console.log("\n🔍 Fetching all datasets...\n");

  // Fetch all datasets
  const datasetsRef = db.collection("rp_datasets");
  const datasetsSnapshot = await datasetsRef.get();

  if (datasetsSnapshot.empty) {
    console.log("❌ No datasets found.");
    return;
  }

  console.log(`📊 Found ${datasetsSnapshot.size} datasets\n`);

  // Fetch all images to count per dataset
  const imagesRef = db.collection("rp_dataset_images");
  const imagesSnapshot = await imagesRef.get();

  const imageCountsByDataset = new Map();
  imagesSnapshot.forEach((doc) => {
    const data = doc.data();
    const datasetId = data.datasetId;
    if (datasetId) {
      imageCountsByDataset.set(datasetId, (imageCountsByDataset.get(datasetId) || 0) + 1);
    }
  });

  // Display datasets
  datasetsSnapshot.forEach((doc) => {
    const data = doc.data();
    const imageCount = imageCountsByDataset.get(doc.id) || 0;
    console.log(`📁 ${doc.id}`);
    console.log(`   Name: ${data.name || "N/A"}`);
    console.log(`   Type: ${data.type || "N/A"}`);
    console.log(`   Identity: ${data.identityId || "N/A"}`);
    console.log(`   Status: ${data.status || "N/A"}`);
    console.log(`   Images: ${imageCount}`);
    console.log("");
  });

  console.log("✅ Done.\n");
}

listDatasets()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
