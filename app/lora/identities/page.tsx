"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { ModelPackIdentity } from "@/lib/types/firestore";
import Modal from "@/components/Modal";
import IdentityForm from "@/components/IdentityForm";
import { TableSkeleton } from "@/components/Skeleton";

function IdentitiesContent() {
  const { packs, loading: packsLoading } = useModelPacks();
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<ModelPackIdentity | undefined>();

  const { identities, loading: identitiesLoading, createIdentity, updateIdentity, deleteIdentity } = useIdentities(
    selectedPackId || undefined
  );

  // Filter identities
  const filteredIdentities = useMemo(() => {
    let filtered = identities;

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((id) => id.status === statusFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (id) =>
          id.name.toLowerCase().includes(query) ||
          id.token.toLowerCase().includes(query) ||
          id.hometown?.toLowerCase().includes(query) ||
          id.primaryTeams?.some((team) => team.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [identities, statusFilter, searchQuery]);

  const selectedPack = packs.find((p) => p.id === selectedPackId);

  const handleCreate = () => {
    if (!selectedPackId) {
      alert("Please select a pack first");
      return;
    }
    setEditingIdentity(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (identity: ModelPackIdentity) => {
    setEditingIdentity(identity);
    setIsModalOpen(true);
  };

  const handleSubmit = async (identity: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt">) => {
    if (editingIdentity) {
      await updateIdentity(editingIdentity.id!, identity);
    } else {
      await createIdentity(identity);
    }
    setIsModalOpen(false);
    setEditingIdentity(undefined);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this identity? This action cannot be undone.")) {
      await deleteIdentity(id);
    }
  };

  const getPrimaryTeam = (identity: ModelPackIdentity) => {
    if (identity.primaryTeams && identity.primaryTeams.length > 0) {
      return identity.primaryTeams[0];
    }
    return "—";
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: "bg-gray-100 text-gray-800",
      faces_complete: "bg-green-100 text-green-800",
      needs_more_faces: "bg-yellow-100 text-yellow-800",
      archived: "bg-red-100 text-red-800",
    };
    return styles[status as keyof typeof styles] || styles.draft;
  };

  return (
    <>
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-4 text-gray-900">Identities</h2>
        <p className="text-gray-700">Manage identity personas across all packs.</p>
      </div>

      {/* Pack Selector */}
      <div className="mb-6 bg-white rounded-lg shadow p-6">
        <label htmlFor="packSelect" className="block text-sm font-medium text-gray-700 mb-2">
          Select Pack *
        </label>
        <select
          id="packSelect"
          value={selectedPackId}
          onChange={(e) => setSelectedPackId(e.target.value)}
          className="w-full md:w-1/3 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
        >
          <option value="">Choose a pack...</option>
          {packs.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.packName} ({pack.version})
            </option>
          ))}
        </select>
      </div>

      {!selectedPackId ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">Please select a pack to view and manage identities.</p>
        </div>
      ) : (
        <>
          {/* Filters and Actions */}
          <div className="mb-6 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex flex-col md:flex-row gap-4 flex-1">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="faces_complete">Faces Complete</option>
                <option value="needs_more_faces">Needs More Faces</option>
                <option value="archived">Archived</option>
              </select>

              {/* Search */}
              <input
                type="text"
                placeholder="Search by name, token, hometown, or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              + Add Identity
            </button>
          </div>

          {/* Identities Table */}
          {identitiesLoading && identities.length === 0 ? (
            <TableSkeleton />
          ) : filteredIdentities.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-500 mb-4">
                {identities.length === 0
                  ? "No identities yet. Create your first identity!"
                  : "No identities match your filters."}
              </p>
              {identities.length === 0 && (
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Create Identity
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Token
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Primary Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Faces
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredIdentities.map((identity) => (
                    <tr key={identity.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{identity.name}</div>
                        {identity.hometown && (
                          <div className="text-sm text-gray-500">{identity.hometown}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-900">
                          {identity.token}
                        </code>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {getPrimaryTeam(identity)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {identity.faceImageCount || 0} / 20
                        </div>
                        <div className="text-xs text-gray-500">
                          {identity.faceImageCount >= 20
                            ? "Ready"
                            : identity.faceImageCount >= 8
                            ? "Good start"
                            : "Too few"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
                            identity.status
                          )}`}
                        >
                          {identity.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <Link
                          href={`/lora/packs/${selectedPackId}/identities/${identity.id}`}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => handleEdit(identity)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(identity.id!)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary Stats */}
          {identities.length > 0 && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-sm text-gray-600">Total Identities</div>
                <div className="text-2xl font-bold text-gray-900">{identities.length}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-sm text-gray-600">Ready for Training</div>
                <div className="text-2xl font-bold text-green-600">
                  {identities.filter((id) => id.status === "faces_complete").length}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-sm text-gray-600">Needs More Faces</div>
                <div className="text-2xl font-bold text-yellow-600">
                  {identities.filter((id) => id.status === "needs_more_faces" || id.faceImageCount < 20).length}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-sm text-gray-600">Total Face Images</div>
                <div className="text-2xl font-bold text-gray-900">
                  {identities.reduce((sum, id) => sum + (id.faceImageCount || 0), 0)}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      {selectedPackId && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingIdentity(undefined);
          }}
          title={editingIdentity ? "Edit Identity" : "Create New Identity"}
        >
          <IdentityForm
            identity={editingIdentity}
            packId={selectedPackId}
            onSubmit={handleSubmit}
            onCancel={() => {
              setIsModalOpen(false);
              setEditingIdentity(undefined);
            }}
          />
        </Modal>
      )}
    </>
  );
}

export default function IdentitiesPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <IdentitiesContent />
    </ProtectedRoute>
  );
}
