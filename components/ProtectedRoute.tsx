"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/providers/AuthProvider";
import LoginPage from "./LoginPage";
import Layout from "./Layout";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "admin" | "editor" | "viewer" | "ops";
}

export default function ProtectedRoute({ 
  children, 
  requiredRole = "viewer" 
}: ProtectedRouteProps) {
  const { user, adminUser, loading, isAdmin } = useAuth();
  const router = useRouter();

  console.log("[ProtectedRoute] Render - user:", user?.uid || "null", "adminUser:", adminUser?.role || "null", "loading:", loading, "requiredRole:", requiredRole);

  useEffect(() => {
    console.log("[ProtectedRoute] useEffect - loading:", loading, "user:", user?.uid || "null");
    if (!loading && !user) {
      console.log("[ProtectedRoute] Redirecting to login");
      router.push("/login");
    }
  }, [user, loading, router]);

  // Show loading only briefly on initial check
  if (loading && !user) {
    console.log("[ProtectedRoute] Showing loading skeleton");
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-gray-200 rounded mb-2"></div>
          <div className="h-4 w-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  // No user = show login
  if (!user) {
    console.log("[ProtectedRoute] No user, showing LoginPage");
    return <LoginPage />;
  }

  // If we have a user, show content optimistically (even if admin is still loading)
  // This prevents infinite loading states
  if (user && (!adminUser || loading)) {
    console.log("[ProtectedRoute] User exists, showing content optimistically (adminUser:", adminUser?.role || "null", "loading:", loading, ")");
    return <Layout>{children}</Layout>;
  }

  // Only show "Access Denied" if we've confirmed no admin access after loading completes
  if (!loading && !adminUser) {
    console.log("[ProtectedRoute] Access Denied - no admin user after loading completed");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md p-8 border border-gray-300 rounded-lg text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="mb-4">
            Your account does not have access to this system.
          </p>
          <p className="text-sm text-gray-600">
            Please contact an administrator if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  // At this point, we must have adminUser
  if (!adminUser) {
    console.log("[ProtectedRoute] Fallback: showing content optimistically (no adminUser but user exists)");
    return <Layout>{children}</Layout>; // Fallback - show content optimistically
  }

  console.log("[ProtectedRoute] Admin user exists, checking role permissions");

  const roleHierarchy: Record<string, number> = {
    viewer: 1,
    editor: 2,
    ops: 2.5, // Ops role can access LoRA Ops
    admin: 3,
  };

  // Special check for ops role - can access LoRA Ops even if not admin
  const isLoRARoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/lora');
  if (isLoRARoute && requiredRole === 'ops') {
    if (adminUser.role !== 'ops' && adminUser.role !== 'admin') {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md p-8 border border-gray-300 rounded-lg text-center">
            <h1 className="text-2xl font-bold mb-4">Insufficient Permissions</h1>
            <p className="mb-4">
              LoRA Ops requires &apos;ops&apos; or &apos;admin&apos; access. Your role: {adminUser.role}
            </p>
          </div>
        </div>
      );
    }
  }

  if (roleHierarchy[adminUser.role] < roleHierarchy[requiredRole]) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md p-8 border border-gray-300 rounded-lg text-center">
          <h1 className="text-2xl font-bold mb-4">Insufficient Permissions</h1>
          <p className="mb-4">
            This action requires {requiredRole} access. Your role: {adminUser.role}
          </p>
        </div>
      </div>
    );
  }

  console.log("[ProtectedRoute] All checks passed, rendering children");
  return <Layout>{children}</Layout>;
}
