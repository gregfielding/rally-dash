import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  User,
  onAuthStateChanged,
  NextOrObserver,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./config";

const googleProvider = new GoogleAuthProvider();

export interface AdminUser {
  uid: string;
  email: string | null;
  role: "admin" | "editor" | "viewer" | "ops";
  createdAt?: Date;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName?: string | null;
  role: "admin" | "editor" | "viewer" | "ops";
  createdAt: Date;
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle(): Promise<User> {
  if (!auth) throw new Error("Firebase Auth is not initialized");
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Sign in with email and password
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error("Firebase Auth is not initialized");
  const result = await signInWithEmailAndPassword(auth, email, password);
  ensureUserProfile(result.user).catch((err) =>
    console.error("[signInWithEmail] Error ensuring user profile (non-blocking):", err)
  );
  return result.user;
}

/**
 * Create account with email and password
 */
export async function createAccountWithEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error("Firebase Auth is not initialized");
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  if (!auth) throw new Error("Firebase Auth is not initialized");
  await firebaseSignOut(auth);
}

/**
 * Check if user is an admin
 */
export async function checkAdminAccess(uid: string): Promise<AdminUser | null> {
  if (!db) {
    return null;
  }
  try {
    const adminDoc = await getDoc(doc(db, "admins", uid));
    if (adminDoc.exists()) {
      const data = adminDoc.data();
      return {
        uid,
        email: data.email || null,
        role: data.role || "viewer",
        createdAt: data.createdAt?.toDate(),
      };
    }
    return null;
  } catch (error: any) {
    // If permission denied, user is not an admin
    if (error?.code === 'permission-denied') {
      return null;
    }
    console.error("Error checking admin access:", error);
    return null;
  }
}

/**
 * Create or update user profile on first login
 * Optimized: only creates if doesn't exist
 */
export async function ensureUserProfile(user: User): Promise<void> {
  if (!db) {
    throw new Error("Database not initialized");
  }
  
  const adminRef = doc(db, "admins", user.uid);
  const adminSnap = await getDoc(adminRef);
  
  // Create admin doc if it doesn't exist (required for access)
  // This is the critical one - do it first
  if (!adminSnap.exists()) {
    try {
      await setDoc(adminRef, {
        email: user.email,
        role: "admin",
        createdAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error("Error creating admin doc:", error);
      throw error; // Re-throw so caller knows it failed
    }
  }
  
  // Create user profile if it doesn't exist (non-critical, can fail silently)
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    try {
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        role: "admin",
        createdAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error("Error creating user profile:", error);
      // Don't throw - admin doc is the critical one
    }
  }
}

/**
 * Subscribe to auth state changes (sign-in, sign-out, restored sessions)
 */
export function onAuthChange(callback: NextOrObserver<User>) {
  if (!auth) {
    console.warn("[onAuthChange] Firebase Auth not initialized");
    return () => {};
  }

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (typeof callback === "function") {
      callback(user);
    } else if (callback && typeof callback === "object" && typeof callback.next === "function") {
      callback.next(user);
    }
  }, (error) => {
    console.error("[onAuthChange] Auth state error:", error);
    if (callback && typeof callback === "object" && typeof callback.error === "function") {
      callback.error(error);
    }
  });

  return unsubscribe;
}
