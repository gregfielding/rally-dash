"use client";

import ProtectedRoute from "@/components/ProtectedRoute";

function ReferencesContent() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-4 text-gray-900">Reference Library</h2>
        <p className="text-gray-700">Upload and manage reference images for training datasets.</p>
      </div>
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">Reference library coming soon...</p>
      </div>
    </>
  );
}

export default function ReferencesPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <ReferencesContent />
    </ProtectedRoute>
  );
}

