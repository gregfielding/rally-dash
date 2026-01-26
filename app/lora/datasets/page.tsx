"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Modal from "@/components/Modal";
import { TableSkeleton } from "@/components/Skeleton";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useIdentities } from "@/lib/hooks/useIdentities";
import {
  useRPDatasets,
  CreateRPDatasetInput,
} from "@/lib/hooks/useRPDatasets";
import {
  useRPDatasetImages,
  useBuildDatasetZip,
} from "@/lib/hooks/useRPDatasetImages";
import { RPDataset, RPDatasetType } from "@/lib/types/firestore";

function getMinRequiredImages(type: RPDatasetType): number {
  switch (type) {
    case "face":
      return 15;
    case "upper_body":
    case "full_body":
      return 20;
    case "mixed":
    default:
      return 30;
  }
}

function deriveStatus(
  dataset: RPDataset,
  imageCount: number,
  isBuilding: boolean
): "draft" | "building" | "ready" {
  if (isBuilding) return "building";

  const hasZip =
    !!(dataset as any).lastZipSignedUrl ||
    !!(dataset as any).lastZipStoragePath;

  if (dataset.status === "ready" && hasZip) return "ready";
  if (hasZip) return "ready";
  return "draft";
}

function StatusBadge({
  status,
}: {
  status: "draft" | "building" | "ready";
}) {
  let label = status;
  let classes =
    "inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800";

  if (status === "ready") {
    label = "ready";
    classes =
      "inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800";
  } else if (status === "building") {
    label = "building";
    classes =
      "inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800";
  }

  return <span className={classes}>{label}</span>;
}

function typeLabel(type: RPDatasetType): string {
  if (type === "face") return "Face identity";
  if (type === "upper_body") return "Upper body";
  if (type === "full_body") return "Body";
  if (type === "mixed") return "Mixed";
  return type;
}

function DatasetsContent() {
  const {
    datasets,
    loading: datasetsLoading,
    error: datasetsError,
    createDataset,
    deleteDataset,
  } = useRPDatasets();
  const {
    images: allImages,
    loading: imagesLoading,
  } = useRPDatasetImages();
  const { packs } = useModelPacks();
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const { identities } = useIdentities(selectedPackId || undefined);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<RPDatasetType>("face");
  const [newDescription, setNewDescription] = useState("");
  const [selectedIdentityId, setSelectedIdentityId] = useState("");

  const [buildingDatasetId, setBuildingDatasetId] = useState<string | null>(
    null
  );
  const [zipError, setZipError] = useState<string | null>(null);

  const { buildDatasetZip } = useBuildDatasetZip();

  const imageCountByDatasetId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const img of allImages) {
      const id = (img as any).datasetId as string | undefined;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [allImages]);

  const handleOpenCreate = () => {
    setIsCreateOpen(true);
    setCreateError(null);
    setNewName("");
    setNewDescription("");
    setNewType("face");
    setSelectedPackId("");
    setSelectedIdentityId("");
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!selectedIdentityId) {
      setCreateError("Identity is required for a dataset.");
      return;
    }
    if (!newName.trim()) {
      setCreateError("Dataset name is required.");
      return;
    }

    try {
      setCreating(true);
      const input: CreateRPDatasetInput = {
        identityId: selectedIdentityId,
        name: newName,
        type: newType,
        description: newDescription.trim() || undefined,
      };
      await createDataset(input);
      setIsCreateOpen(false);
    } catch (err: any) {
      console.error("[Datasets] Failed to create dataset:", err);
      setCreateError(err?.message || "Failed to create dataset.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (dataset: RPDataset) => {
    if (!dataset.id) return;
    const ok = window.confirm(
      "Delete this dataset? This will remove the dataset record but not any underlying Storage files."
    );
    if (!ok) return;
    await deleteDataset(dataset.id);
  };

  const handleBuildZip = async (dataset: RPDataset) => {
    if (!dataset.id) return;
    setZipError(null);
    setBuildingDatasetId(dataset.id);
    try {
      await buildDatasetZip(dataset.id);
    } catch (err: any) {
      console.error("[Datasets] Failed to build dataset ZIP:", err);
      setZipError(err?.message || "Failed to build dataset ZIP.");
    } finally {
      setBuildingDatasetId(null);
    }
  };

  const anyLoading =
    (datasetsLoading && datasets.length === 0) ||
    (imagesLoading && allImages.length === 0);

  return (
    <>
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-2 text-gray-900">
          Training Datasets
        </h2>
        <p className="text-gray-700">
          Create and manage LoRA training datasets. Datasets must be zip-built
          and marked ready before they can be used in training jobs.
        </p>
      </div>

      {(datasetsError || zipError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {datasetsError || zipError}
        </div>
      )}

      <div className="mb-6 flex justify-between items-center">
        <h3 className="text-xl font-semibold text-gray-900">All Datasets</h3>
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Create Dataset
        </button>
      </div>

      {anyLoading && datasets.length === 0 ? (
        <TableSkeleton />
      ) : datasets.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">
            No datasets yet. Create a dataset to start collecting training
            images.
          </p>
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create Dataset
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    Images
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    Last ZIP
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                    ZIP Path
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((ds) => {
                  const id = ds.id!;
                  const imageCount = imageCountByDatasetId.get(id) || 0;
                  const minRequired = getMinRequiredImages(ds.type);
                  const status = deriveStatus(
                    ds,
                    imageCount,
                    buildingDatasetId === id
                  );
                  const lastZipAt = (ds as any).lastZipCreatedAt;
                  const zipPath =
                    (ds as any).lastZipStoragePath ||
                    (ds as any).lastZipSignedUrl ||
                    null;

                  const canBuildZip =
                    imageCount >= minRequired && status !== "building";

                  return (
                    <tr key={id} className="border-b border-gray-100">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {ds.name}
                          </span>
                          {ds.description && (
                            <span className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {ds.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        {typeLabel(ds.type)}
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        {imageCount}{" "}
                        <span className="text-xs text-gray-500">
                          / target {ds.targetImageCount}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        {lastZipAt && typeof lastZipAt.toDate === "function"
                          ? lastZipAt.toDate().toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 max-w-xs truncate">
                        {zipPath || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/lora/datasets/${id}`}
                            className="px-3 py-1.5 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleBuildZip(ds)}
                            disabled={!canBuildZip}
                            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {buildingDatasetId === id
                              ? "Building…"
                              : "Build ZIP"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(ds)}
                            className="px-3 py-1.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          if (!creating) {
            setIsCreateOpen(false);
          }
        }}
        title="Create Dataset"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {createError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {createError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Amber Face v1"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type *
              </label>
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(e.target.value as RPDatasetType)
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="face">Face</option>
                <option value="upper_body">Upper body</option>
                <option value="full_body">Body</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target images (guidance)
              </label>
              <input
                type="text"
                disabled
                value={
                  newType === "face"
                    ? "20+ faces"
                    : newType === "mixed"
                    ? "30–40 mixed"
                    : "20–40 body"
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pack *
              </label>
              <select
                value={selectedPackId}
                onChange={(e) => {
                  setSelectedPackId(e.target.value);
                  setSelectedIdentityId("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select pack…</option>
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.packName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Identity *
              </label>
              <select
                value={selectedIdentityId}
                onChange={(e) => setSelectedIdentityId(e.target.value)}
                disabled={!selectedPackId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-50"
              >
                <option value="">Select identity…</option>
                {identities.map((id) => (
                  <option key={id.id} value={id.id}>
                    {id.name} ({id.token})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Short notes about this dataset version…"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="submit"
              disabled={creating}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Creating…" : "Create Dataset"}
            </button>
            <button
              type="button"
              onClick={() => !creating && setIsCreateOpen(false)}
              disabled={creating}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            Datasets are identity-scoped. Upload and curate images on the
            dataset detail page, then deliberately build a ZIP before starting
            training.
          </p>
        </form>
      </Modal>
    </>
  );
}

export default function DatasetsPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <DatasetsContent />
    </ProtectedRoute>
  );
}


