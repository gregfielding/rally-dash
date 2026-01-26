"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import Link from "next/link";
import IdentityForm from "@/components/IdentityForm";
import { ModelPackIdentity } from "@/lib/types/firestore";

function IdentityDetailContent() {
  const params = useParams();
  const router = useRouter();
  const packId = params?.packId as string;
  const identityId = params?.identityId as string;
  const { identities, loading: identitiesLoading, updateIdentity } = useIdentities(packId);
  const { packs, loading: packsLoading } = useModelPacks();
  const [isEditing, setIsEditing] = useState(false);

  const identity = identities.find((id) => id.id === identityId);
  const pack = packs.find((p) => p.id === packId);

  if (packsLoading || identitiesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg text-gray-700">Loading...</div>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4 text-gray-900">Pack not found</h2>
          <Link href="/lora/packs" className="text-blue-600 hover:text-blue-700">
            ← Back to Packs
          </Link>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4 text-gray-900">Identity not found</h2>
          <Link href={`/lora/packs/${packId}`} className="text-blue-600 hover:text-blue-700">
            ← Back to Pack
          </Link>
        </div>
      </div>
    );
  }

  const handleUpdate = async (updatedIdentity: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt">) => {
    if (!identityId) return;
    await updateIdentity(identityId, updatedIdentity);
    setIsEditing(false);
  };

  // Submenu items
  const submenuItems = [
    {
      label: "Edit Details",
      href: `#`,
      active: isEditing,
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        setIsEditing(true);
      },
    },
    // Add more submenu items here as needed
    // { label: "Face Images", href: `/lora/packs/${packId}/identities/${identityId}/faces` },
    // { label: "Training History", href: `/lora/packs/${packId}/identities/${identityId}/training` },
  ];

  if (isEditing) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <div className="mb-6">
          <Link
            href={`/lora/packs/${packId}/identities/${identityId}`}
            onClick={(e) => {
              e.preventDefault();
              setIsEditing(false);
            }}
            className="text-blue-600 hover:text-blue-700 mb-4 inline-block"
          >
            ← Back to {identity.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Edit {identity.name}</h1>
        </div>
        <IdentityForm
          identity={identity}
          packId={packId}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditing(false)}
          loading={false}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <Link href={`/lora/packs/${packId}`} className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Pack
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-2 text-gray-900">{identity.name}</h2>
            <div className="flex gap-4 items-center">
              <span className="text-sm text-gray-600">Token: <code className="bg-gray-100 px-2 py-1 rounded">{identity.token}</code></span>
              <span
                className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  identity.status === "faces_complete"
                    ? "bg-green-100 text-green-800"
                    : identity.status === "needs_more_faces"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {identity.status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Submenu */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex space-x-8" aria-label="Submenu">
          {submenuItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={item.onClick}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                item.active
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Identity Details</h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Name</dt>
                <dd className="mt-1 text-sm text-gray-900">{identity.name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Token</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  <code className="bg-gray-100 px-2 py-1 rounded">{identity.token}</code>
                </dd>
              </div>
              {identity.hometown && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Hometown</dt>
                  <dd className="mt-1 text-sm text-gray-900">{identity.hometown}</dd>
                </div>
              )}
              {identity.personaBio && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Persona Bio</dt>
                  <dd className="mt-1 text-sm text-gray-900">{identity.personaBio}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500">Face Images</dt>
                <dd className="mt-1 text-sm text-gray-900">{identity.faceImageCount || 0}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}

export default function IdentityDetailContentWrapper() {
  return (
    <ProtectedRoute requiredRole="ops">
      <IdentityDetailContent />
    </ProtectedRoute>
  );
}

