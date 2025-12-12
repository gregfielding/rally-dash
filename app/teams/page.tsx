"use client";

import { useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTeams } from "@/lib/hooks/useTeams";
import { useLeagues } from "@/lib/hooks/useLeagues";
import TeamForm from "@/components/TeamForm";
import Modal from "@/components/Modal";
import { Team } from "@/lib/types/firestore";

function TeamsContent() {
  const { adminUser } = useAuth();
  const { leagues } = useLeagues();
  const { teams, loading, error, createTeam, updateTeam, deleteTeam } = useTeams();
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredTeams = selectedLeague
    ? teams.filter((team) => team.leagueId === selectedLeague)
    : teams;

  const handleCreate = () => {
    setEditingTeam(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (team: Team) => {
    setEditingTeam(team);
    setIsModalOpen(true);
  };

  const handleSubmit = async (team: Omit<Team, "id" | "createdAt" | "updatedAt">) => {
    setSaving(true);
    try {
      if (editingTeam) {
        await updateTeam(editingTeam.id!, team);
      } else {
        await createTeam(team);
      }
      setIsModalOpen(false);
      setEditingTeam(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this team?")) {
      setDeletingId(id);
      try {
        await deleteTeam(id);
      } finally {
        setDeletingId(null);
      }
    }
  };

  if (loading && teams.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading teams...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Teams</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{adminUser?.email}</span>
            <a
              href="/dashboard"
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >
              Dashboard
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">All Teams</h2>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Leagues</option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={leagues.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Add Team
          </button>
        </div>

        {leagues.length === 0 && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
            <p>You need to create at least one league before adding teams.</p>
            <a href="/leagues" className="underline mt-2 inline-block">
              Create a league →
            </a>
          </div>
        )}

        {filteredTeams.length === 0 && leagues.length > 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-500 mb-4">
              {selectedLeague ? "No teams found in this league." : "No teams yet. Create your first team!"}
            </p>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create Team
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    League
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    City
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Colors
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
                {filteredTeams.map((team) => {
                  const league = leagues.find((l) => l.id === team.leagueId);
                  return (
                    <tr key={team.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {team.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {league?.name || "Unknown"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {team.city}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-1">
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: team.colors.primary }}
                            title={`Primary: ${team.colors.primary}`}
                          />
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: team.colors.secondary }}
                            title={`Secondary: ${team.colors.secondary}`}
                          />
                          {team.colors.accent && (
                            <div
                              className="w-6 h-6 rounded border border-gray-300"
                              style={{ backgroundColor: team.colors.accent }}
                              title={`Accent: ${team.colors.accent}`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            team.active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {team.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(team)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(team.id!)}
                          disabled={deletingId === team.id}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          {deletingId === team.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingTeam(undefined);
          }}
          title={editingTeam ? "Edit Team" : "Create New Team"}
        >
          <TeamForm
            team={editingTeam}
            leagues={leagues}
            onSubmit={handleSubmit}
            onCancel={() => {
              setIsModalOpen(false);
              setEditingTeam(undefined);
            }}
            loading={saving}
          />
        </Modal>
      </main>
    </div>
  );
}

export default function TeamsPage() {
  return (
    <ProtectedRoute requiredRole="editor">
      <TeamsContent />
    </ProtectedRoute>
  );
}
