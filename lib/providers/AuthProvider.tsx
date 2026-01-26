"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import { User } from "firebase/auth";
import { signInWithGoogle, signOut, checkAdminAccess, AdminUser, onAuthChange, ensureUserProfile } from "@/lib/firebase/auth";
import { auth } from "@/lib/firebase/config";

interface AuthContextType {
  user: User | null;
  adminUser: AdminUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ADMIN_CACHE_KEY = "rally_admin_user";
const ADMIN_CACHE_TIMESTAMP_KEY = "rally_admin_timestamp";
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedAdmin(uid: string): AdminUser | null | undefined {
  if (typeof window === "undefined") return undefined;
  
  try {
    const cached = localStorage.getItem(ADMIN_CACHE_KEY);
    const timestamp = localStorage.getItem(ADMIN_CACHE_TIMESTAMP_KEY);
    
    if (!cached || !timestamp) return undefined;
    
    const cacheTime = parseInt(timestamp, 10);
    const now = Date.now();
    
    // Check if cache is for the same user and still valid
    const adminData = JSON.parse(cached);
    if (adminData.uid !== uid) return undefined;
    if (now - cacheTime > CACHE_DURATION) return undefined;
    
    return adminData;
  } catch {
    return undefined;
  }
}

function setCachedAdmin(admin: AdminUser | null, uid: string) {
  if (typeof window === "undefined") return;
  
  try {
    if (admin) {
      localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(admin));
      localStorage.setItem(ADMIN_CACHE_TIMESTAMP_KEY, Date.now().toString());
    } else {
      localStorage.removeItem(ADMIN_CACHE_KEY);
      localStorage.removeItem(ADMIN_CACHE_TIMESTAMP_KEY);
    }
  } catch (error) {
    console.error("Error caching admin:", error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingAdminRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    const authCallback = (authUser: User | null) => {
      if (!mounted) return;
      setUser(authUser);
      setLoading(false);

      if (!authUser) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(ADMIN_CACHE_KEY);
          localStorage.removeItem(ADMIN_CACHE_TIMESTAMP_KEY);
        }
        setAdminUser(null);
        return;
      }

      // Background: ensure profile and fetch admin once
      ensureUserProfile(authUser).catch((err) => {
        console.error("[AuthProvider] Error ensuring user profile:", err);
      });

      if (fetchingAdminRef.current.has(authUser.uid)) return;
      fetchingAdminRef.current.add(authUser.uid);

      (async () => {
        try {
          let admin = await checkAdminAccess(authUser.uid);
          if (!admin) {
            await ensureUserProfile(authUser);
            admin = await checkAdminAccess(authUser.uid);
          }
          if (mounted) {
            setCachedAdmin(admin, authUser.uid);
            setAdminUser(admin);
          }
        } catch (error) {
          console.error("[AuthProvider] Error fetching admin:", error);
          if (mounted) {
            setCachedAdmin(null, authUser.uid);
            setAdminUser(null);
          }
        } finally {
          fetchingAdminRef.current.delete(authUser.uid);
        }
      })();
    };

    try {
      if (!auth) {
        console.error("[AuthProvider] auth is null, cannot set up listener");
        setLoading(false);
        return;
      }
      unsubscribe = onAuthChange(authCallback);
    } catch (error) {
      console.error("[AuthProvider] Error initializing auth listener:", error);
      setLoading(false);
    }

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in error:", error);
      throw error;
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      if (typeof window !== "undefined") {
        localStorage.removeItem(ADMIN_CACHE_KEY);
        localStorage.removeItem(ADMIN_CACHE_TIMESTAMP_KEY);
      }
      setAdminUser(null);
    } catch (error) {
      console.error("Sign out error:", error);
      throw error;
    }
  };


  return (
    <AuthContext.Provider
      value={{
        user,
        adminUser,
        loading,
        signIn: handleSignIn,
        signOut: handleSignOut,
        isAuthenticated: !!user,
        isAdmin: !!adminUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

