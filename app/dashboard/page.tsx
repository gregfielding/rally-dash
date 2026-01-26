"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

function DashboardContent() {

  return (
    <>
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-4 text-gray-900">Dashboard</h2>
          <p className="text-gray-700">Welcome to the DesignOps admin panel.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Designs Generated</h3>
            <p className="text-3xl font-bold">0</p>
            <p className="text-sm text-gray-600 mt-1">Last 7 days</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Approved</h3>
            <p className="text-3xl font-bold">0</p>
            <p className="text-sm text-gray-600 mt-1">Last 30 days</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Published</h3>
            <p className="text-3xl font-bold">0</p>
            <p className="text-sm text-gray-600 mt-1">Last 30 days</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">Data Management</h3>
            <div className="space-y-3">
              <Link
                href="/leagues"
                className="block px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center"
              >
                Manage Leagues
              </Link>
              <Link
                href="/teams"
                className="block px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center"
              >
                Manage Teams
              </Link>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">Quick Actions</h3>
            <div className="space-y-3">
              <button className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                Generate New Design
              </button>
              <button className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                Bulk Generate
              </button>
              <button className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                Review Queue
              </button>
            </div>
          </div>
        </div>
    </>
  );
}

export default function Dashboard() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <DashboardContent />
    </ProtectedRoute>
  );
}
