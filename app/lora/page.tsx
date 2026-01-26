"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";

function LoRAContent() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace("/lora/packs");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-lg text-gray-700">Redirecting...</div>
    </div>
  );
}

export default function LoRAPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <LoRAContent />
    </ProtectedRoute>
  );
}

