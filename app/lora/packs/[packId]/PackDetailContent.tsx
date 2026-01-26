"use client";

import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useIdentities } from "@/lib/hooks/useIdentities";
import Link from "next/link";

function PackDetailContent() {
  const params = useParams();
  const packId = params?.packId as string;
  const { packs, loading: packsLoading } = useModelPacks();
  const { identities, loading: identitiesLoading } = useIdentities(packId);

  const pack = packs.find((p) => p.id === packId);

  if (packsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg text-gray-700">Loading pack...</div>
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

  return (
    <>
      <div className="mb-6">
        <Link href="/lora/packs" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Packs
        </Link>
        <h2 className="text-3xl font-bold mb-2 text-gray-900">{pack.packName}</h2>
        <div className="flex gap-4 items-center">
          <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
            pack.status === "ready"
              ? "bg-green-100 text-green-800"
              : pack.status === "training"
              ? "bg-blue-100 text-blue-800"
              : pack.status === "failed"
              ? "bg-red-100 text-red-800"
              : "bg-gray-100 text-gray-800"
          }`}>
            {pack.status}
          </span>
          <span className="text-sm text-gray-600">Version: {pack.version}</span>
          <span className="text-sm text-gray-600">Provider: {pack.provider}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-900">Identities</h3>
          <p className="text-3xl font-bold">{identities.length}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-900">Face Images</h3>
          <p className="text-3xl font-bold">{pack.faceImageCount || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-900">Status</h3>
          <p className="text-lg font-semibold capitalize">{pack.status}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-gray-900">Identities</h3>
          <Link
            href={`/lora/packs/${packId}/identities/new`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add Identity
          </Link>
        </div>

        {identitiesLoading ? (
          <div className="text-center py-8 text-gray-600">Loading identities...</div>
        ) : identities.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="mb-4">No identities yet. Add your first identity!</p>
            <Link
              href={`/lora/packs/${packId}/identities/new`}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block"
            >
              Create Identity
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {identities.map((identity) => (
              <Link
                key={identity.id}
                href={`/lora/packs/${packId}/identities/${identity.id}`}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:shadow transition-all"
              >
                <h4 className="font-semibold text-gray-900 mb-2">{identity.name}</h4>
                <p className="text-sm text-gray-600 mb-1">Token: <code className="bg-gray-100 px-1 rounded">{identity.token}</code></p>
                <p className="text-sm text-gray-600 mb-1">Faces: {identity.faceImageCount}</p>
                <span className={`inline-block px-2 py-1 text-xs font-semibold rounded-full mt-2 ${
                  identity.status === "faces_complete"
                    ? "bg-green-100 text-green-800"
                    : identity.status === "needs_more_faces"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-gray-100 text-gray-800"
                }`}>
                  {identity.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function PackDetailContentWrapper() {
  return (
    <ProtectedRoute requiredRole="ops">
      <PackDetailContent />
    </ProtectedRoute>
  );
}

