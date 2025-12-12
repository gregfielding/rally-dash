"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import LoginPage from "./LoginPage";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "admin" | "editor" | "viewer";
}

export default function ProtectedRoute({ 
  children, 
  requiredRole = "viewer" 
}: ProtectedRouteProps) {
  const { user, adminUser, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!adminUser) {
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

  const roleHierarchy: Record<string, number> = {
    viewer: 1,
    editor: 2,
    admin: 3,
  };

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

  return <>{children}</>;
}
