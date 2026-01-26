"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useModelPacks } from "@/lib/hooks/useModelPacks";
import { useIdentities } from "@/lib/hooks/useIdentities";
import { useTrainingJobs } from "@/lib/hooks/useTrainingJobs";
import { useRPDatasets } from "@/lib/hooks/useRPDatasets";
import { useLoraArtifacts } from "@/lib/hooks/useLoraArtifacts";
import { functions } from "@/lib/firebase/config";
import { httpsCallable } from "firebase/functions";
import { ArtifactsPanel } from "./components/ArtifactsPanel";

const TRAINER_PRESETS = [
  {
    key: "portrait_v1",
    label: "Portrait Trainer (recommended)",
    endpoint: "fal-ai/flux-lora-portrait-trainer",
    defaults: { steps: 2000, learningRate: 0.0002 },
  },
  {
    key: "fast_v1",
    label: "Fast Trainer",
    endpoint: "fal-ai/flux-lora-fast-training",
    defaults: { steps: 1200, learningRate: 0.0003 },
  },
] as const;

// Helper to safely convert Firestore Timestamp to Date
function timestampToDate(timestamp: any): Date | null {
  if (!timestamp) return null;
  
  // If it's a Firestore Timestamp object
  if (timestamp.toMillis && typeof timestamp.toMillis === 'function') {
    return new Date(timestamp.toMillis());
  }
  
  // If it has seconds property (Firestore Timestamp structure)
  if (timestamp.seconds && typeof timestamp.seconds === 'number') {
    return new Date(timestamp.seconds * 1000);
  }
  
  // If it has toDate method
  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  
  // If it's already a number (milliseconds)
  if (typeof timestamp === 'number') {
    return new Date(timestamp);
  }
  
  // If it's already a Date
  if (timestamp instanceof Date) {
    return timestamp;
  }
  
  return null;
}

function TrainingContent() {
  const { packs } = useModelPacks();
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const { identities } = useIdentities(selectedPackId || undefined);
  const { datasets, refetch: refetchDatasets } = useRPDatasets();
  const {
    jobs,
    loading: jobsLoading,
    createTrainingJob,
    refetch: refetchJobs,
  } = useTrainingJobs();

  const { artifacts: allArtifacts } = useLoraArtifacts();
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    TRAINER_PRESETS[0]?.key || ""
  );
  const [triggerPhrase, setTriggerPhrase] = useState<string>("");
  const [steps, setSteps] = useState<number>(
    TRAINER_PRESETS[0]?.defaults.steps ?? 2000
  );
  const [learningRate, setLearningRate] = useState<number>(
    TRAINER_PRESETS[0]?.defaults.learningRate ?? 0.0002
  );
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildingZip, setBuildingZip] = useState(false);
  const [trainingKind, setTrainingKind] = useState<"face" | "body">("face");

  const selectedPack = useMemo(
    () => packs.find((p) => p.id === selectedPackId),
    [packs, selectedPackId]
  );
  const selectedIdentity = useMemo(
    () => identities.find((i) => i.id === selectedIdentityId),
    [identities, selectedIdentityId]
  );
  const filteredDatasets = useMemo(
    () =>
      datasets.filter((d: any) => {
        if (trainingKind === "face") {
          return d.type === "face";
        }
        // Body training: allow upper/full body and mixed datasets.
        return (
          d.type === "upper_body" ||
          d.type === "full_body" ||
          d.type === "mixed"
        );
      }),
    [datasets, trainingKind]
  );
  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId),
    [datasets, selectedDatasetId]
  );
  const selectedPreset = useMemo(
    () => TRAINER_PRESETS.find((p) => p.key === selectedPresetId),
    [selectedPresetId]
  );

  // When identity changes, default trigger phrase from its token.
  useEffect(() => {
    if (selectedIdentity) {
      setTriggerPhrase(selectedIdentity.token);
    }
  }, [selectedIdentity]);

  // When preset changes, apply its default hyperparameters.
  useEffect(() => {
    if (selectedPreset) {
      setSteps(selectedPreset.defaults.steps);
      setLearningRate(selectedPreset.defaults.learningRate);
    }
  }, [selectedPreset]);

  // Clear incompatible dataset when training kind changes.
  useEffect(() => {
    if (!selectedDatasetId) return;
    const ds: any = datasets.find((d) => d.id === selectedDatasetId);
    if (!ds) return;
    const isFace = ds.type === "face";
    const isBodyType =
      ds.type === "upper_body" || ds.type === "full_body" || ds.type === "mixed";
    if (trainingKind === "face" && !isFace) {
      setSelectedDatasetId("");
    } else if (trainingKind === "body" && !isBodyType) {
      setSelectedDatasetId("");
    }
  }, [trainingKind, datasets, selectedDatasetId]);

  const hasRequiredDatasetZip = !!(
    (selectedDataset as any)?.lastZipSignedUrl ||
    (selectedDataset as any)?.lastZipStoragePath
  );

  const handleStartTraining = async () => {
    if (!selectedIdentity || !selectedDataset || !selectedPreset || !functions) {
      setError("Identity, dataset, and trainer preset are required.");
      return;
    }
    if (!triggerPhrase.trim()) {
      setError("Trigger phrase is required.");
      return;
    }
    if (!Number.isFinite(steps) || steps <= 0) {
      setError("Steps must be a positive number.");
      return;
    }
    if (!Number.isFinite(learningRate) || learningRate <= 0) {
      setError("Learning rate must be a positive number.");
      return;
    }
    if (!hasRequiredDatasetZip) {
      setError("Selected dataset is not ready (missing images zip).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await createTrainingJob({
        identityId: selectedIdentity.id!,
        identityToken: selectedIdentity.token,
        packId: selectedPack?.id,
        identityName: `${selectedPack?.packName || "Pack"} – ${
          selectedIdentity.name
        }`,
        datasetId: selectedDataset.id!,
        datasetName: selectedDataset.name,
        provider: "fal",
        trainerEndpoint: selectedPreset.endpoint,
        triggerPhrase: triggerPhrase || selectedIdentity.token,
        steps,
        learningRate,
        seed,
      } as any);

      const startTrainingJobFn = httpsCallable(functions, "startTrainingJob");
      await startTrainingJobFn({ jobId });
      await refetchJobs();
    } catch (e: any) {
      console.error("[Training] Failed to start job:", e);
      setError(e?.message || "Failed to start training job.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async (jobId: string) => {
    if (!functions) return;
    try {
      const checkTrainingJobFn = httpsCallable(functions, "checkTrainingJob");
      await checkTrainingJobFn({ jobId });
      await refetchJobs();
    } catch (e) {
      console.error("[Training] Failed to check status:", e);
    }
  };

  const handleSetActive = async (jobId: string) => {
    // For now, checkTrainingJob already wires the active artifact.
    console.info("[Training] Set Active clicked for job:", jobId);
  };

  const handleBuildDatasetZip = async () => {
    if (!functions || !selectedDatasetId) return;
    setBuildingZip(true);
    setError(null);
    try {
      const createDatasetZipFn = httpsCallable(functions, "createDatasetZip");
      await createDatasetZipFn({ datasetId: selectedDatasetId });
      await refetchDatasets();
      await refetchJobs();
    } catch (e: any) {
      console.error("[Training] Failed to build dataset zip:", e);
      setError(e?.message || "Failed to build dataset zip.");
    } finally {
      setBuildingZip(false);
    }
  };

  return (
    <>
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-4 text-gray-900">Training Jobs</h2>
        <p className="text-gray-700">
          Create and monitor LoRA training jobs. All fal.ai calls run through
          Cloud Functions.
        </p>
      </div>

      {/* Job Creator */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">
          Create Training Job
        </h3>

        {error && (
          <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pack
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
              Identity
            </label>
            <select
              value={selectedIdentityId}
              onChange={(e) => setSelectedIdentityId(e.target.value)}
              disabled={!selectedPackId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select identity…</option>
              {identities.map((id) => (
                <option key={id.id} value={id.id}>
                  {id.name} ({id.token})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Training Kind
            </label>
            <select
              value={trainingKind}
              onChange={(e) =>
                setTrainingKind(e.target.value as "face" | "body")
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="face">Face (identity)</option>
              <option value="body">Body (full/upper body)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dataset
            </label>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select dataset…</option>
              {filteredDatasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.type})
                </option>
              ))}
            </select>
            {selectedDataset && (
              <p className="mt-1 text-xs text-gray-500">
                {((selectedDataset as any).lastZipSignedUrl ||
                  (selectedDataset as any).lastZipStoragePath) ? (
                  <span className="text-green-600">ZIP ready</span>
                ) : (
                  <span className="text-yellow-600">
                    ZIP not built yet – click “Build Dataset ZIP”
                  </span>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={handleBuildDatasetZip}
              disabled={buildingZip || !selectedDatasetId}
              className="mt-2 inline-flex items-center px-3 py-1 rounded bg-gray-100 text-gray-800 text-xs hover:bg-gray-200 disabled:opacity-50"
            >
              {buildingZip ? "Building ZIP…" : "Build Dataset ZIP"}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trainer Preset
            </label>
            <select
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {TRAINER_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trigger Phrase
            </label>
            <input
              type="text"
              value={triggerPhrase}
              onChange={(e) => setTriggerPhrase(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="rp_amber"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Steps
            </label>
            <input
              type="number"
              value={steps}
              onChange={(e) =>
                setSteps(parseInt(e.target.value || "0", 10))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Learning Rate
            </label>
            <input
              type="number"
              step="0.00001"
              value={learningRate}
              onChange={(e) =>
                setLearningRate(parseFloat(e.target.value || "0"))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seed (optional)
            </label>
            <input
              type="number"
              value={seed ?? ""}
              onChange={(e) =>
                setSeed(
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={handleStartTraining}
            disabled={
              submitting ||
              !selectedIdentity ||
              !selectedDataset ||
              !selectedPreset ||
              !triggerPhrase.trim() ||
              !Number.isFinite(steps) ||
              steps <= 0 ||
              !Number.isFinite(learningRate) ||
              learningRate <= 0 ||
              !hasRequiredDatasetZip
            }
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Starting…" : "Start Training"}
          </button>
        </div>
      </div>

      {/* Jobs table */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Jobs</h3>
          <button
            type="button"
            onClick={() => refetchJobs()}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>

        {jobsLoading ? (
          <p className="text-gray-500 text-sm">Loading jobs…</p>
        ) : jobs.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No training jobs yet. Create one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Created
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Identity
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Dataset
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Steps / LR
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    fal Request Id
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Artifact
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-800">
                      {(() => {
                        const date = timestampToDate(job.createdAt);
                        return date ? date.toLocaleString() : "—";
                      })()}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {job.identityName || job.identityId}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {job.datasetName || job.datasetId}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const status = job.status || "unknown";
                        const statusColors: Record<string, string> = {
                          queued: "bg-yellow-100 text-yellow-800",
                          running: "bg-blue-100 text-blue-800",
                          completed: "bg-green-100 text-green-800",
                          failed: "bg-red-100 text-red-800",
                        };
                        const colorClass = statusColors[status] || "bg-gray-100 text-gray-800";
                        return (
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}
                          >
                            {status}
                          </span>
                        );
                      })()}
                      {job.status === "failed" && job.error && (
                        <div className="mt-1 text-xs text-red-600 max-w-xs">
                          {typeof job.error === "string" 
                            ? job.error 
                            : (job.error as any)?.message || "Unknown error"}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {job.steps ?? "—"} / {job.learningRate ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">
                      {job.falRequestId || "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {allArtifacts.some((a) => a.trainingJobId === job.id) ? (
                        <span className="text-green-600 font-semibold">✅ Created</span>
                      ) : job.status === "completed" ? (
                        <span className="text-gray-400 text-xs">No artifact</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-2">
                          {(job.status === "running" || job.status === "queued") && (
                            <button
                              type="button"
                              onClick={() => job.id && handleCheckStatus(job.id)}
                              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Check Status
                            </button>
                          )}
                          {job.status === "completed" && (
                            <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800 font-medium">
                              ✓ Complete
                            </span>
                          )}
                          {job.status === "failed" && (
                            <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-800 font-medium">
                              ✗ Failed
                            </span>
                          )}
                        </div>
                        {job.status === "completed" && job.completedAt && (
                          <span className="text-xs text-gray-500">
                            {(() => {
                              const date = timestampToDate(job.completedAt);
                              return date ? date.toLocaleString() : "";
                            })()}
                          </span>
                        )}
                        {job.status === "running" && job.startedAt && (
                          <span className="text-xs text-gray-500">
                            Started {(() => {
                              const date = timestampToDate(job.startedAt);
                              return date ? date.toLocaleString() : "";
                            })()}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ArtifactsPanel
        identityId={selectedIdentity?.id}
        identityToken={selectedIdentity?.token}
      />
    </>
  );
}

export default function TrainingPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <TrainingContent />
    </ProtectedRoute>
  );
}
