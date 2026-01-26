"use client";

import { useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { ModelPack } from "@/lib/types/firestore";
import Modal from "@/components/Modal";
import ModelPackForm from "@/components/ModelPackForm";
import { GridSkeleton } from "@/components/Skeleton";

function PacksContent() {
  const { packs, loading, error, createPack, updatePack, deletePack } = useModelPacks();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<ModelPack | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingPack(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (pack: ModelPack) => {
    setEditingPack(pack);
    setIsModalOpen(true);
  };

  const handleSubmit = async (pack: Omit<ModelPack, "id" | "createdAt" | "updatedAt">) => {
    if (editingPack) {
      await updatePack(editingPack.id!, pack);
    } else {
      await createPack(pack);
    }
    setIsModalOpen(false);
    setEditingPack(undefined);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this pack? This will also delete all identities.")) {
      setDeletingId(id);
      try {
        await deletePack(id);
      } finally {
        setDeletingId(null);
      }
    }
  };


  return (
    <>
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-4 text-gray-900">Model Packs</h2>
        <p className="text-gray-700">Manage LoRA training packs and their identities.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 flex justify-between items-center">
        <h3 className="text-xl font-semibold text-gray-900">All Packs</h3>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Create Pack
        </button>
      </div>

      {loading && packs.length === 0 ? (
        <GridSkeleton count={6} />
      ) : packs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">No packs yet. Create your first pack!</p>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create Pack
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {packs.map((pack) => (
            <Link
              key={pack.id}
              href={`/lora/packs/${pack.id}`}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <h4 className="text-lg font-semibold text-gray-900">{pack.packName}</h4>
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    pack.status === "ready"
                      ? "bg-green-100 text-green-800"
                      : pack.status === "training"
                      ? "bg-blue-100 text-blue-800"
                      : pack.status === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {pack.status}
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <p><span className="font-medium">Version:</span> {pack.version}</p>
                <p><span className="font-medium">Provider:</span> {pack.provider}</p>
                {pack.loraModelId && (
                  <p><span className="font-medium">Model ID:</span> {pack.loraModelId}</p>
                )}
                {pack.identityCount !== undefined && (
                  <p><span className="font-medium">Identities:</span> {pack.identityCount}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingPack(undefined);
        }}
        title={editingPack ? "Edit Pack" : "Create New Pack"}
      >
        <ModelPackForm
          pack={editingPack}
          onSubmit={handleSubmit}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingPack(undefined);
          }}
        />
      </Modal>
    </>
  );
}

export default function PacksPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <PacksContent />
    </ProtectedRoute>
  );
}

