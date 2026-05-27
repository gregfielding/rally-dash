"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
(async () => {
  const designId = "0PrHjyUSVE7a390HDb4U";
  const snap = await db.collection("designs").doc(designId).get();
  if (!snap.exists) { console.log("design not found"); return; }
  const d = snap.data();
  const ts = (x) => (x && x.toDate ? x.toDate().toISOString() : x);
  console.log("design", designId, ":");
  console.log(JSON.stringify({
    name: d.name,
    slug: d.slug,
    teamId: d.teamId,
    leagueCode: d.leagueCode,
    autoLaunchProductsAt: ts(d.autoLaunchProductsAt),
    autoLaunchProductsStatus: d.autoLaunchProductsStatus,
    autoLaunchProductsResults: d.autoLaunchProductsResults,
  }, null, 2));

  console.log("\n=== rp_product_asset_batches for SF Giants productIds ===");
  const ids = ["Ch9CxTZdZgouzSOYRekr","S2JBJOD71egMEDVP35aj","mIrikKfLsu6QR1h7Ja0A","jD3ATvD9PumfkA31epX7"];
  for (const pid of ids) {
    const batches = await db.collection("rp_product_asset_batches").where("productId","==",pid).get();
    console.log(`  product ${pid}: ${batches.size} batches`);
    for (const b of batches.docs) {
      const bd = b.data();
      console.log("    batch", b.id, JSON.stringify({status: bd.status, createdAt: ts(bd.createdAt), updatedAt: ts(bd.updatedAt), errors: bd.errors || bd.error, counts: bd.counts}));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
