import { initializeApp, getApps, FirebaseApp, FirebaseOptions } from "firebase/app";
import {
  getAuth,
  Auth,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import { getFunctions, Functions } from "firebase/functions";

/**
 * Required fields from the Firebase web SDK snippet. Storage bucket + messaging sender ID are
 * optional here — we default them so a partial .env still initializes Auth.
 *
 * Important: Next.js only inlines `NEXT_PUBLIC_*` into the **client** bundle when you use
 * **static** `process.env.NEXT_PUBLIC_FOO` access. Dynamic `process.env[key]` stays undefined
 * in the browser, which breaks Firebase even when `.env.local` is correct.
 */
function missingFirebasePublicEnv(): string[] {
  const missing: string[] = [];
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  }
  if (typeof authDomain !== "string" || authDomain.trim() === "") {
    missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  }
  if (typeof projectId !== "string" || projectId.trim() === "") {
    missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }
  if (typeof appId !== "string" || appId.trim() === "") {
    missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");
  }
  return missing;
}

/** For login / diagnostics — same keys as `missingFirebasePublicEnv`. */
export function getMissingFirebasePublicEnvKeys(): string[] {
  return missingFirebasePublicEnv();
}

function buildFirebaseOptions(): FirebaseOptions | null {
  if (missingFirebasePublicEnv().length > 0) return null;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!.trim();
  const storageRaw = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingRaw = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();
  if (!storageRaw) {
    console.warn(
      `[Firebase] NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET missing; using ${projectId}.appspot.com`
    );
  }
  if (!messagingRaw) {
    console.warn(
      "[Firebase] NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID missing; using placeholder — copy the full SDK snippet for production."
    );
  }
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!.trim(),
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!.trim(),
    projectId,
    storageBucket: storageRaw || `${projectId}.appspot.com`,
    messagingSenderId: messagingRaw || "000000000000",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!.trim(),
  };
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;
let functionsInstance: Functions | undefined;

if (typeof window !== "undefined") {
  const missing = missingFirebasePublicEnv();
  if (missing.length > 0) {
    console.error(
      `[Firebase] Missing or empty: ${missing.join(", ")}. Set these in .env.local from Firebase Console → Project settings → Your apps (SDK snippet).`
    );
  } else {
    try {
      const firebaseConfig = buildFirebaseOptions();
      if (!firebaseConfig) {
        console.error("[Firebase] Could not build config.");
      } else {
        app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        auth = getAuth(app);
        setPersistence(auth, browserLocalPersistence).catch((err) =>
          console.error("[Firebase Config] Error setting persistence:", err)
        );
        db = getFirestore(app);
        storage = getStorage(app);
        const fnRegion =
          process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() || "us-central1";
        functionsInstance = getFunctions(app, fnRegion);
      }
    } catch (err) {
      console.error("[Firebase Config] Initialization error:", err);
    }
  }
}

export { auth, db, storage, functionsInstance as functions };
export default app;
