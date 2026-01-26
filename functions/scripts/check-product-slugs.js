#!/usr/bin/env node

/**
 * Script to check product slugs in Firestore.
 * 
 * Usage (from functions directory):
 *   node scripts/check-product-slugs.js
 */

const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function checkProductSlugs() {
  console.log("\n🔍 Checking product slugs in Firestore...\n");

  try {
    const productsRef = db.collection("rp_products");
    const snapshot = await productsRef.get();

    if (snapshot.empty) {
      console.log("❌ No products found in Firestore.");
      return;
    }

    console.log(`✅ Found ${snapshot.size} product(s)\n`);

    snapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`📦 Product: ${data.name || "N/A"}`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Slug: ${data.slug || "MISSING"}`);
      console.log(`   Base Product Key: ${data.baseProductKey || "N/A"}`);
      console.log(`   Status: ${data.status || "N/A"}`);
      console.log("");
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkProductSlugs()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
