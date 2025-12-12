import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as firebaseSignOut,
  User,
  onAuthStateChanged,
  NextOrObserver
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./config";

const googleProvider = new GoogleAuthProvider();

export interface AdminUser {
  uid: string;
  email: string | null;
  role: "admin" | "editor" | "viewer";
  createdAt?: Date;
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error("Firebase Auth is not initialized");
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  if (!auth) {
    throw new Error("Firebase Auth is not initialized");
  }
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
      return {
        uid,
        email: adminDoc.data().email || null,
        role: adminDoc.data().role || "viewer",
        createdAt: adminDoc.data().createdAt?.toDate(),
      };
    }
    return null;
  } catch (error) {
    console.error("Error checking admin access:", error);
    return null;
  }
}

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback: NextOrObserver<User>) {
  if (!auth) {
    throw new Error("Firebase Auth is not initialized");
  }
  return onAuthStateChanged(auth, callback);
}
