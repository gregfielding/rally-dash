"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, updateDoc } from "firebase/firestore";
import { db, functions } from "@/lib/firebase/config";
import { useLoraArtifacts } from "@/lib/hooks/useLoraArtifacts";
import { useGenerations } from "@/lib/hooks/useGenerations";
import { useRPDatasets } from "@/lib/hooks/useRPDatasets";

interface ArtifactsPanelProps {
  identityId?: string;
  identityToken?: string;
}

const buildDefaultPrompt = (trigger: string) =>
  `${trigger}, candid handheld street photo in San Francisco, early 20s athletic girl, long blonde hair, natural warm smile showing a little teeth, bright open eyes, longer darker eyelashes, natural skin texture with visible pores and light freckles, subtle uneven skin tone, minimal makeup, athleisure outfit in neutral tones, tank top and light zip-up sweatshirt, no bag, daylight, shallow depth of field, real camera look`;

export function ArtifactsPanel({ identityId, identityToken }: ArtifactsPanelProps) {
  const { artifacts, loading: artifactsLoading } = useLoraArtifacts(
    identityId || undefined
  );
  const {
    generations,
    loading: generationsLoading,
    refetch: refetchGenerations,
  } = useGenerations(identityId || undefined);
  const { datasets } = useRPDatasets();

  const identityDatasets = useMemo(
    () => datasets.filter((d) => d.identityId === identityId),
    [datasets, identityId]
  );

  const [promptsByArtifact, setPromptsByArtifact] = useState<Record<string, string>>(
    {}
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [negativePrompt, setNegativePrompt] = useState<string>("");
  const [imageCount, setImageCount] = useState<number>(4);
  const [seed, setSeed] = useState<string>("");
  const [scale, setScale] = useState<number>(0.65);
  const [sizePreset, setSizePreset] = useState<"square" | "portrait" | "landscape">(
    "square"
  );
  const [selectedBodyArtifactId, setSelectedBodyArtifactId] = useState<string>("");
  const [selectedProductArtifactId, setSelectedProductArtifactId] = useState<string>("");
  const [bodyScale, setBodyScale] = useState<number>(0.45);
  const [productScale, setProductScale] = useState<number>(0.8);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [lastGenerationStatus, setLastGenerationStatus] = useState<"success" | "error" | null>(null);

  const getPromptForArtifact = (artifactId: string, trigger: string) => {
    if (promptsByArtifact[artifactId] !== undefined) {
      return promptsByArtifact[artifactId];
    }
    return buildDefaultPrompt(trigger || identityToken || "");
  };

  const handlePromptChange = (artifactId: string, value: string) => {
    setPromptsByArtifact((prev) => ({ ...prev, [artifactId]: value }));
  };

  const handleSetActiveArtifact = async (artifactId: string) => {
    if (!functions || !identityId) return;
    try {
      const setActiveFn = httpsCallable(functions, "setActiveLoraArtifact");
      await setActiveFn({
        identityId,
        loraId: artifactId,
      });
      // Also select this artifact for test generation
      setSelectedArtifactId(artifactId);
    } catch (e) {
      console.error("[ArtifactsPanel] Failed to set active artifact:", e);
    }
  };

  const handleTestGenerate = async () => {
    console.log("[ArtifactsPanel] handleTestGenerate called", {
      functions: !!functions,
      identityId,
      selectedArtifactId,
      artifactsCount: artifacts.length,
    });

    if (!functions) {
      console.error("[ArtifactsPanel] Functions not initialized");
      alert("Cloud Functions not initialized. Please refresh the page.");
      return;
    }
    if (!identityId) {
      console.error("[ArtifactsPanel] identityId missing");
      alert("Identity ID is required. Please select an identity.");
      return;
    }
    if (!selectedArtifactId) {
      console.error("[ArtifactsPanel] No artifact selected");
      alert("Please select an artifact first.");
      return;
    }

    setBusy(true);
    try {
      const artifact = artifacts.find((a) => a.id === selectedArtifactId);
      if (!artifact) {
        console.error("[ArtifactsPanel] Artifact not found:", selectedArtifactId);
        alert("Selected artifact not found.");
        setBusy(false);
        return;
      }

      const trigger = artifact.triggerPhrase || identityToken || "";
      const prompt = getPromptForArtifact(selectedArtifactId, trigger);
      const parsedSeed = seed ? parseInt(seed, 10) : undefined;

      const imageSize =
        sizePreset === "square"
          ? { w: 1024, h: 1024 }
          : sizePreset === "portrait"
          ? { w: 832, h: 1216 }
          : { w: 1216, h: 832 };

      const loras: Array<{ loraId: string; scale: number }> = [
        { loraId: selectedArtifactId, scale },
      ];
      if (selectedBodyArtifactId) {
        loras.push({ loraId: selectedBodyArtifactId, scale: bodyScale });
      }
      if (selectedProductArtifactId) {
        loras.push({ loraId: selectedProductArtifactId, scale: productScale });
      }

      console.log("[ArtifactsPanel] Calling runGeneration with:", {
        identityId,
        loraId: selectedArtifactId,
        prompt: prompt.substring(0, 50) + "...",
        numImages: imageCount,
        seed: parsedSeed,
        scale,
        imageSize,
        lorasCount: loras.length,
      });

      const runGenerationFn = httpsCallable(functions, "runGeneration");
      const result = await runGenerationFn({
        identityId,
        loraId: selectedArtifactId,
        prompt,
        negativePrompt: negativePrompt || undefined,
        numImages: imageCount || undefined,
        seed: Number.isFinite(parsedSeed as any) ? parsedSeed : undefined,
        scale,
        imageSize,
        loras,
      });

      console.log("[ArtifactsPanel] Generation result:", result.data);
      const resultData = result.data as { genId?: string; resultImageUrls?: string[] };
      await refetchGenerations();
      console.log("[ArtifactsPanel] Generations refetched");
      
      // Show success feedback
      setLastGenerationStatus("success");
      const generatedImageCount = resultData?.resultImageUrls?.length || 0;
      alert(`✅ Generation successful! Created ${generatedImageCount} image(s). Check the "Latest Results" section below.`);
      
      // Clear success status after 5 seconds
      setTimeout(() => setLastGenerationStatus(null), 5000);
    } catch (e: any) {
      console.error("[ArtifactsPanel] Failed to run test generation:", e);
      setLastGenerationStatus("error");
      alert(`❌ Failed to run generation: ${e?.message || "Unknown error"}`);
      setTimeout(() => setLastGenerationStatus(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveToReference = async (genId: string, imageIndex: number) => {
    if (!functions || !identityId) return;
    setBusy(true);
    try {
      const fn = httpsCallable(functions, "saveGenerationImageToReference");
      await fn({ identityId, genId, imageIndex });
      await refetchGenerations();
    } catch (e) {
      console.error("[ArtifactsPanel] Failed to save to reference:", e);
    } finally {
      setBusy(false);
    }
  };

  const handleAddToDataset = async (genId: string, imageIndex: number) => {
    if (!functions || !identityId || !selectedDatasetId) return;
    setBusy(true);
    try {
      const fn = httpsCallable(functions, "addGenerationImageToDataset");
      const result = await fn({ identityId, genId, imageIndex, datasetId: selectedDatasetId });
      console.log("[ArtifactsPanel] Successfully added image to dataset:", result.data);
      // Show success feedback
      alert(`✅ Image ${imageIndex + 1} added to dataset successfully!`);
      // Refresh generations to update the UI
      await refetchGenerations();
    } catch (e: any) {
      console.error("[ArtifactsPanel] Failed to add to dataset:", e);
      alert(`❌ Failed to add image to dataset: ${e?.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const selectedArtifact = useMemo(
    () =>
      artifacts.length === 0
        ? undefined
        : artifacts.find((a) => a.id === selectedArtifactId) || artifacts[0],
    [artifacts, selectedArtifactId]
  );

  const generationsForSelected = useMemo(
    () =>
      selectedArtifact && identityId
        ? generations.filter((g) => g.loraId === selectedArtifact.id)
        : [],
    [generations, selectedArtifact, identityId]
  );

  const latestGeneration =
    generationsForSelected.length > 0 ? generationsForSelected[0] : undefined;

  useEffect(() => {
    // Auto-select first artifact if none selected
    if (!selectedArtifactId && artifacts.length > 0) {
      setSelectedArtifactId(artifacts[0].id as string);
      return;
    }

    if (selectedArtifact) {
      const trigger = selectedArtifact.triggerPhrase || identityToken || "";
      // Ensure prompt map has a default entry for this artifact
      setPromptsByArtifact((prev) => {
        if (prev[selectedArtifact.id as string] !== undefined) return prev;
        return {
          ...prev,
          [selectedArtifact.id as string]: buildDefaultPrompt(trigger),
        };
      });

      const defaultScale =
        (selectedArtifact as any).defaultScale ??
        (selectedArtifact as any).recommendedScale ??
        0.65;
      setScale(defaultScale);
    }
  }, [artifacts, selectedArtifact, identityToken]);

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Artifacts &amp; Test Generate
        </h3>
      </div>

      {!identityId ? (
        <p className="text-sm text-gray-500">
          Select an identity above to see its artifacts and run test generations.
        </p>
      ) : artifactsLoading ? (
        <p className="text-sm text-gray-500">Loading artifacts…</p>
      ) : artifacts.length === 0 ? (
        <p className="text-sm text-gray-500">
          No artifacts yet. Complete a training job to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Artifacts list */}
          <div className="space-y-3">
            {artifacts.map((artifact) => {
              const artifactId = artifact.id as string;
              const isSelected = selectedArtifact?.id === artifactId;
              const createdAt =
                (artifact as any).createdAt &&
                typeof (artifact as any).createdAt.toDate === "function"
                  ? (artifact as any).createdAt.toDate().toLocaleString()
                  : "—";

              return (
                <div
                  key={artifactId}
                  onClick={() => setSelectedArtifactId(artifactId)}
                  className={`w-full text-left border rounded-lg p-3 transition cursor-pointer ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                      : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-gray-900">
                          {artifact.name || `${identityToken || "Identity"} LoRA`}
                        </div>
                        {isSelected && (
                          <span className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded-full font-medium">
                            Selected for Generation
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 space-y-0.5">
                        <div>Created: {createdAt}</div>
                        <div>
                          Provider:{" "}
                          <span className="font-medium">{artifact.provider}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span>Status:</span>
                          <span
                            className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                              artifact.status === "active"
                                ? "bg-green-100 text-green-800"
                                : artifact.status === "archived"
                                ? "bg-gray-200 text-gray-700"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {artifact.status}
                          </span>
                        </div>
                        {artifact.recommendedScale !== undefined && (
                          <div>
                            Recommended scale:{" "}
                            <span className="font-mono">
                              {artifact.recommendedScale.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(artifact.weightsUrl);
                        }}
                        className="text-[10px] px-2 py-1 rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                      >
                        Copy weights
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetActiveArtifact(artifactId);
                        }}
                        className="text-[10px] px-2 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200"
                      >
                        Set Active
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Test generation + results */}
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Test Generate
              </h4>
              {!selectedArtifact ? (
                <p className="text-xs text-gray-500">
                  Select an artifact on the left to run test generations.
                </p>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Prompt
                    </label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      rows={3}
                      value={getPromptForArtifact(
                        selectedArtifact.id as string,
                        selectedArtifact.triggerPhrase || identityToken || ""
                      )}
                      onChange={(e) =>
                        handlePromptChange(selectedArtifact.id as string, e.target.value)
                      }
                    />
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Negative Prompt (optional)
                    </label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      rows={2}
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Image Count
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={imageCount}
                        onChange={(e) =>
                          setImageCount(
                            Math.max(1, Math.min(8, parseInt(e.target.value || "1", 10)))
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Seed (optional)
                      </label>
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="mb-3 border-t pt-3">
                    <h5 className="text-[11px] font-semibold text-gray-800 mb-2">
                      Stacking (optional)
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Body Artifact
                        </label>
                        <select
                          value={selectedBodyArtifactId}
                          onChange={(e) => setSelectedBodyArtifactId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">None</option>
                          {artifacts
                            .filter((a: any) => a.artifactKind === "body")
                            .map((a) => (
                              <option key={a.id} value={a.id as string}>
                                {a.name || `Body LoRA ${a.id}`}
                              </option>
                            ))}
                        </select>
                        {selectedBodyArtifactId && (
                          <div className="mt-2">
                            <label className="block text-[11px] font-medium text-gray-700 mb-1">
                              Body Scale ({bodyScale.toFixed(2)})
                            </label>
                            <input
                              type="range"
                              min={0.3}
                              max={0.9}
                              step={0.05}
                              value={bodyScale}
                              onChange={(e) => setBodyScale(parseFloat(e.target.value))}
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Product Artifact
                        </label>
                        <select
                          value={selectedProductArtifactId}
                          onChange={(e) => setSelectedProductArtifactId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">None</option>
                          {artifacts
                            .filter((a: any) => a.artifactKind === "product")
                            .map((a) => (
                              <option key={a.id} value={a.id as string}>
                                {a.name || `Product LoRA ${a.id}`}
                              </option>
                            ))}
                        </select>
                        {selectedProductArtifactId && (
                          <div className="mt-2">
                            <label className="block text-[11px] font-medium text-gray-700 mb-1">
                              Product Scale ({productScale.toFixed(2)})
                            </label>
                            <input
                              type="range"
                              min={0.3}
                              max={1}
                              step={0.05}
                              value={productScale}
                              onChange={(e) =>
                                setProductScale(parseFloat(e.target.value))
                              }
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Scale ({scale.toFixed(2)})
                      </label>
                      <input
                        type="range"
                        min={0.4}
                        max={0.9}
                        step={0.05}
                        value={scale}
                        onChange={(e) => setScale(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Size
                      </label>
                      <select
                        value={sizePreset}
                        onChange={(e) =>
                          setSizePreset(e.target.value as "square" | "portrait" | "landscape")
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      >
                        <option value="square">Square</option>
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end items-center gap-2">
                    {lastGenerationStatus === "success" && (
                      <span className="text-xs text-green-600 font-medium">
                        ✅ Generation successful!
                      </span>
                    )}
                    {lastGenerationStatus === "error" && (
                      <span className="text-xs text-red-600 font-medium">
                        ❌ Generation failed
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleTestGenerate}
                      disabled={busy}
                      className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? "Running…" : "Run Test Generation"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {latestGeneration && (
              <div className="border-t pt-3 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Latest Results
                  </h4>
                  {latestGeneration.resultImageUrls && latestGeneration.resultImageUrls.length > 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      ✓ {latestGeneration.resultImageUrls.length} image(s) generated
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-gray-600 space-y-0.5 mb-3">
                  <div>
                    falRequestId:{" "}
                    <span className="font-mono">
                      {latestGeneration.falRequestId || "—"}
                    </span>
                  </div>
                  <div>Endpoint: {latestGeneration.endpoint || "—"}</div>
                  <div>Seed: {latestGeneration.seed ?? "—"}</div>
                  <div>
                    Created:{" "}
                    {latestGeneration.createdAt &&
                    typeof latestGeneration.createdAt.toMillis === "function"
                      ? new Date(
                          latestGeneration.createdAt.toMillis()
                        ).toLocaleString()
                      : "—"}
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <label className="text-xs font-medium text-gray-700">
                    Promote images to dataset:
                  </label>
                  <select
                    value={selectedDatasetId}
                    onChange={(e) => setSelectedDatasetId(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
                  >
                    <option value="">Select dataset…</option>
                    {identityDatasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.type})
                      </option>
                    ))}
                  </select>
                </div>

                {generationsLoading ? (
                  <p className="text-xs text-gray-500">Loading images…</p>
                ) : latestGeneration.resultImageUrls &&
                  latestGeneration.resultImageUrls.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {latestGeneration.resultImageUrls.map((url, idx) => {
                      const isMockUrl = url.includes("example.com/mock-generation");
                      return (
                        <div key={idx} className="relative">
                          {isMockUrl ? (
                            <div className="w-full h-32 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center">
                              <div className="text-center">
                                <div className="text-gray-400 text-xs mb-1">Mock Image</div>
                                <div className="text-gray-500 text-[10px] font-mono break-all px-2">
                                  {url.split("/").pop()?.substring(0, 20)}...
                                </div>
                              </div>
                            </div>
                          ) : (
                            <img
                              src={url}
                              alt={`Generation ${idx + 1}`}
                              className="w-full h-32 object-cover rounded-lg"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = "none";
                                const placeholder = document.createElement("div");
                                placeholder.className = "w-full h-32 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center";
                                placeholder.innerHTML = `<div class="text-gray-400 text-xs">Failed to load image</div>`;
                                target.parentNode?.appendChild(placeholder);
                              }}
                            />
                          )}
                          <div className="mt-1 flex flex-col gap-1">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="w-full text-[10px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 text-center"
                          >
                            Download
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              handleSaveToReference(latestGeneration.id as string, idx)
                            }
                            className="w-full text-[10px] px-2 py-1 rounded bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                            disabled={busy}
                          >
                            Add to Reference Library
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleAddToDataset(latestGeneration.id as string, idx)
                            }
                            className="w-full text-[10px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            disabled={busy || !selectedDatasetId}
                          >
                            Add to Dataset
                          </button>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Generation record exists but has no images.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


