"use client";

import { useState, FormEvent } from "react";
import { ModelPack } from "@/lib/types/firestore";

interface ModelPackFormProps {
  pack?: ModelPack;
  onSubmit: (pack: Omit<ModelPack, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

// Helper function to generate packCode from packName
function generatePackCode(packName: string): string {
  return packName
    .toLowerCase()
    .replace(/[–—]/g, "-") // Replace em/en dashes with hyphens
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[^a-z0-9_-]/g, "") // Remove special characters
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
}

export default function ModelPackForm({ pack, onSubmit, onCancel, loading }: ModelPackFormProps) {
  const [packName, setPackName] = useState(pack?.packName || "");
  const [version, setVersion] = useState(pack?.version || "v1");
  const [provider, setProvider] = useState<"fal" | "replicate" | "runpod">(pack?.provider || "fal");
  const [notes, setNotes] = useState(pack?.notes || "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Status is system-controlled, always show current status (default to "draft" for new packs)
  const currentStatus = pack?.status || "draft";

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!packName.trim()) newErrors.packName = "Pack name is required";
    if (!version.trim()) newErrors.version = "Version is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      // Generate packCode from packName (internal, hidden field)
      // Preserve existing packCode when editing, generate new one when creating
      const packCode = pack?.packCode || generatePackCode(packName);
      
      // Build pack data, ensuring no undefined values (Firestore doesn't accept undefined)
      const packData: Omit<ModelPack, "id" | "createdAt" | "updatedAt"> = {
        packName,
        packKey: pack?.packKey || packCode,
        packCode,
        version,
        provider,
        status: currentStatus,
        loraModelId: pack?.loraModelId ?? null,
        loraModelVersion: pack?.loraModelVersion ?? null,
        recommendedPrompt: pack?.recommendedPrompt || "",
        createdBy: pack?.createdBy || "",
        createdByUid: pack?.createdByUid || "",
        identityCount: pack?.identityCount || 0,
        faceImageCount: pack?.faceImageCount || 0,
        datasetIdActive: pack?.datasetIdActive ?? null,
        lastTrainingJobId: pack?.lastTrainingJobId ?? null,
      };

      // Only include optional fields if they have values (avoid undefined)
      if (pack?.negativePrompt) {
        packData.negativePrompt = pack.negativePrompt;
      }
      
      if (notes.trim()) {
        packData.notes = notes;
      }

      await onSubmit(packData);
    } catch (error: any) {
      setErrors({ submit: error.message || "Failed to save pack" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errors.submit && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {errors.submit}
        </div>
      )}

      <div>
        <label htmlFor="packName" className="block text-sm font-medium text-gray-700 mb-1">
          Pack Name *
        </label>
        <input
          type="text"
          id="packName"
          value={packName}
          onChange={(e) => setPackName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
          placeholder="e.g., Pack A – Rally Girls Core"
        />
        {errors.packName && <p className="mt-1 text-sm text-red-600">{errors.packName}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="version" className="block text-sm font-medium text-gray-700 mb-1">
            Version *
          </label>
          <input
            type="text"
            id="version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
            placeholder="v1"
          />
          {errors.version && <p className="mt-1 text-sm text-red-600">{errors.version}</p>}
        </div>

        <div>
          <label htmlFor="provider" className="block text-sm font-medium text-gray-700 mb-1">
            Provider *
          </label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as "fal" | "replicate" | "runpod")}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="fal">fal</option>
            <option value="replicate">replicate</option>
            <option value="runpod">runpod</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
          Status
        </label>
        <input
          type="text"
          id="status"
          value={currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1).replace(/_/g, " ")}
          disabled
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
          readOnly
        />
        <p className="mt-1 text-xs text-gray-600">
          Status is system-controlled and changes automatically based on workflow events.
        </p>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
          placeholder="Additional notes..."
        />
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : pack ? "Update Pack" : "Create Pack"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

