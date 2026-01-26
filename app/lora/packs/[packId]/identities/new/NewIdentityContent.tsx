"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import IdentityForm from "@/components/IdentityForm";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { ModelPackIdentity } from "@/lib/types/firestore";

function NewIdentityContent() {
  const params = useParams();
  const router = useRouter();
  const packId = params?.packId as string;
  const { createIdentity } = useIdentities(packId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (identity: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt">) => {
    if (!packId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createIdentity(identity);
      router.push(`/lora/packs/${packId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create identity");
    } finally {
      setSubmitting(false);
    }
  };

  if (!packId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-700">Pack not found.</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Identity</h1>
        <p className="text-gray-600">Add a new identity to this pack.</p>
      </div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
      <IdentityForm
        packId={packId}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/lora/packs/${packId}`)}
        loading={submitting}
      />
    </div>
  );
}

export default function NewIdentityContentWrapper() {
  return (
    <ProtectedRoute requiredRole="ops">
      <NewIdentityContent />
    </ProtectedRoute>
  );
}

