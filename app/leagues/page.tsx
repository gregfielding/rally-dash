"use client";

import { useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useLeagues } from "@/lib/hooks/useLeagues";
import LeagueForm from "@/components/LeagueForm";
import Modal from "@/components/Modal";
import { TableSkeleton } from "@/components/Skeleton";
import { League } from "@/lib/types/firestore";

function LeaguesContent() {
  const { leagues, loading, error, createLeague, updateLeague, deleteLeague } = useLeagues();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLeague, setEditingLeague] = useState<League | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingLeague(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (league: League) => {
    setEditingLeague(league);
    setIsModalOpen(true);
  };

  const handleSubmit = async (league: Omit<League, "id" | "createdAt" | "updatedAt">) => {
    if (editingLeague) {
      await updateLeague(editingLeague.id!, league);
    } else {
      await createLeague(league);
    }
    setIsModalOpen(false);
    setEditingLeague(undefined);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this league?")) {
      setDeletingId(id);
      try {
        await deleteLeague(id);
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-xl font-semibold">All Leagues</h2>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add League
          </button>
        </div>

        {loading && leagues.length === 0 ? (
          <TableSkeleton />
        ) : leagues.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-500 mb-4">No leagues yet. Create your first league!</p>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create League
            </button>
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
                    Slug
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
                {leagues.map((league) => (
                  <tr key={league.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {league.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {league.slug}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          league.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {league.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(league)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(league.id!)}
                        disabled={deletingId === league.id}
                        className="text-red-600 hover:text-red-900 disabled:opacity-50"
                      >
                        {deletingId === league.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingLeague(undefined);
          }}
          title={editingLeague ? "Edit League" : "Create New League"}
        >
          <LeagueForm
            league={editingLeague}
            onSubmit={handleSubmit}
            onCancel={() => {
              setIsModalOpen(false);
              setEditingLeague(undefined);
            }}
          />
        </Modal>
    </>
  );
}

export default function LeaguesPage() {
  return (
    <ProtectedRoute requiredRole="editor">
      <LeaguesContent />
    </ProtectedRoute>
  );
}

