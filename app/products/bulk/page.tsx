"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useDesigns } from "@/lib/hooks/useDesignAssets";
import { useBlanks } from "@/lib/hooks/useBlanks";
import { useBulkGenerationJobs, useCreateBulkGenerationJob, bulkJobStatusLabel, bulkJobStatusClass } from "@/lib/hooks/useBulkGenerationJobs";
import { useScenePresets as useRPScenePresets } from "@/lib/hooks/useRPScenePresets";
import useSWR from "swr";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { RpBulkGenerationJobStatus } from "@/lib/types/firestore";

function BulkGenerateContent() {
  const [designIds, setDesignIds] = useState<Set<string>>(new Set());
  const [blankIds, setBlankIds] = useState<Set<string>>(new Set());
  const [identityIds, setIdentityIds] = useState<Set<string>>(new Set());
  const [imagesPerProduct, setImagesPerProduct] = useState(3);
  const [presetId, setPresetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const { designs } = useDesigns();
  const { blanks } = useBlanks({ status: "active" });
  const { jobs, isLoading: jobsLoading, mutate: mutateJobs } = useBulkGenerationJobs(30);
  const { createJob } = useCreateBulkGenerationJob();
  const { presets } = useRPScenePresets({ isActive: true });

  const { data: identities } = useSWR("rp_identities_bulk", async () => {
    if (!db) return [];
    const snapshot = await getDocs(query(collection(db, "rp_identities"), orderBy("name")));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  const designsWithPng = designs.filter((d) => d.hasPng);

  const toggleDesign = (id: string) => {
    setDesignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBlank = (id: string) => {
    setBlankIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleIdentity = (id: string) => {
    setIdentityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCombinations =
    designIds.size * blankIds.size * (identityIds.size || 1) || 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    if (designIds.size === 0 || blankIds.size === 0 || identityIds.size === 0) {
      setSubmitError("Select at least one design, one blank, and one model.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createJob({
        designIds: Array.from(designIds),
        blankIds: Array.from(blankIds),
        identityIds: Array.from(identityIds),
        imagesPerProduct,
        presetId: presetId || undefined,
      });
      setSubmitSuccess(`Bulk job started. ${result.total} generation tasks queued. Job ID: ${result.jobId}`);
      setDesignIds(new Set());
      setBlankIds(new Set());
      setIdentityIds(new Set());
      mutateJobs();
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to start bulk job.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (ts: { seconds?: number; toDate?: () => Date } | undefined) => {
    if (!ts) return "—";
    const date = ts.toDate ? ts.toDate() : new Date((ts as { seconds: number }).seconds * 1000);
    return date.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link href="/products" className="text-blue-600 hover:underline text-sm">
            ← Back to Products
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Bulk Generate</h1>
        <p className="text-sm text-gray-600 mb-8">
          Select designs, blanks, and models. The system will create products (design + blank), generate mockups, then run model generation for each combination.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
          {submitError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              {submitSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Designs */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Designs ({designIds.size} selected)
              </label>
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-gray-50">
                {designsWithPng.length === 0 ? (
                  <p className="text-sm text-gray-500">No designs with PNG. Upload PNG in Design Detail → Files.</p>
                ) : (
                  designsWithPng.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-100 rounded px-2">
                      <input
                        type="checkbox"
                        checked={designIds.has(d.id)}
                        onChange={() => toggleDesign(d.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm truncate">{d.teamNameCache} — {d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Blanks */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Blanks ({blankIds.size} selected)
              </label>
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-gray-50">
                {blanks.length === 0 ? (
                  <p className="text-sm text-gray-500">No blanks.</p>
                ) : (
                  blanks.map((b) => (
                    <label key={b.blankId} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-100 rounded px-2">
                      <input
                        type="checkbox"
                        checked={blankIds.has(b.blankId)}
                        onChange={() => toggleBlank(b.blankId)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm truncate">{b.styleCode} {b.styleName} — {b.colorName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Models (Identities) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Models ({identityIds.size} selected)
              </label>
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-gray-50">
                {!identities?.length ? (
                  <p className="text-sm text-gray-500">Loading models…</p>
                ) : (
                  (identities as { id: string; name?: string }[]).map((i) => (
                    <label key={i.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-100 rounded px-2">
                      <input
                        type="checkbox"
                        checked={identityIds.has(i.id)}
                        onChange={() => toggleIdentity(i.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm truncate">{i.name || i.id}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Images per product</label>
              <input
                type="number"
                min={1}
                max={10}
                value={imagesPerProduct}
                onChange={(e) => setImagesPerProduct(parseInt(e.target.value, 10) || 3)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scene preset (optional)</label>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Use default</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Total: <strong>{totalCombinations}</strong> generation tasks (designs × blanks × models)
            </p>
            <button
              type="submit"
              disabled={submitting || totalCombinations === 0}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {submitting ? "Starting…" : "Start Generation"}
            </button>
          </div>
        </form>

        {/* Bulk jobs list */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Bulk Jobs</h2>
          {jobsLoading ? (
            <p className="text-sm text-gray-500">Loading jobs…</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-gray-500">No bulk jobs yet. Start one above.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {jobs.map((job) => {
                    const progress = job.progress || { total: 0, completed: 0, failed: 0 };
                    const status = (job.status || "pending") as RpBulkGenerationJobStatus;
                    return (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-mono text-gray-700">{job.id?.slice(0, 8)}…</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${bulkJobStatusClass(status)}`}>
                            {bulkJobStatusLabel(status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {progress.completed}+{progress.failed} / {progress.total}
                          {progress.failed > 0 && <span className="text-red-600 ml-1">({progress.failed} failed)</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatDate(job.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BulkGeneratePage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <BulkGenerateContent />
    </ProtectedRoute>
  );
}
