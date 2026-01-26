"use client";

import { useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useInspirations } from "@/lib/hooks/useInspirations";
import { useCreateInspiration } from "@/lib/hooks/useInspirationMutations";
import Modal from "@/components/Modal";
import {
  RpInspirationSource,
  RpProductCategory,
} from "@/lib/types/firestore";

function UploadInspirationModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  const { createInspiration } = useCreateInspiration();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<RpInspirationSource>("other");
  const [sourceUrl, setSourceUrl] = useState("");
  const [category, setCategory] = useState<RpProductCategory | "">("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [licenseNote, setLicenseNote] = useState("");
  const [images, setImages] = useState<File[]>([]);

  const handleAddTag = () => {
    if (newTag.trim() && tags.length < 10) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, 5);
      setImages(files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (images.length === 0) {
      setError("At least one image is required");
      return;
    }

    if (tags.length > 10) {
      setError("Maximum 10 tags allowed");
      return;
    }

    setCreating(true);
    try {
      // Convert images to base64
      const imageData = await Promise.all(
        images.map(async (file) => {
          return new Promise<{ data: string; filename: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                data: reader.result as string,
                filename: file.name,
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        })
      );

      await createInspiration({
        title: title.trim(),
        description: description.trim() || undefined,
        sourceType,
        sourceUrl: sourceUrl.trim() || undefined,
        category: category || undefined,
        tags,
        licenseNote: licenseNote.trim() || undefined,
        images: imageData,
      });

      // Reset form
      setTitle("");
      setDescription("");
      setSourceType("other");
      setSourceUrl("");
      setCategory("");
      setTags([]);
      setLicenseNote("");
      setImages([]);

      onCreate();
      onClose();
    } catch (err: any) {
      console.error("[UploadInspirationModal] Error:", err);
      setError(err?.message || "Failed to create inspiration");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Upload Inspiration" size="large">
      <div className="p-6">

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Vintage Typography Style"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Why is this inspiring? What elements should we reference?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Type *
              </label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as RpInspirationSource)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="etsy">Etsy</option>
                <option value="pinterest">Pinterest</option>
                <option value="shopify">Shopify</option>
                <option value="screenshot">Screenshot</option>
                <option value="internal">Internal</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as RpProductCategory | "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">None</option>
                <option value="panties">Panties</option>
                <option value="bralette">Bralette</option>
                <option value="tank">Tank</option>
                <option value="tee">Tee</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Source URL
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags ({tags.length}/10)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={tags.length >= 10}
              />
              <button
                type="button"
                onClick={handleAddTag}
                disabled={tags.length >= 10 || !newTag.trim()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-blue-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Images * (1-5 images)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {images.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {images.length} image(s) selected
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              License Note
            </label>
            <input
              type="text"
              value={licenseNote}
              onChange={(e) => setLicenseNote(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Internal inspiration only"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Uploading..." : "Upload Inspiration"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export default function InspirationsPage() {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<RpInspirationSource | "">("");
  const [categoryFilter, setCategoryFilter] = useState<RpProductCategory | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  const filters = {
    ...(sourceTypeFilter && { sourceType: sourceTypeFilter }),
    ...(categoryFilter && { category: categoryFilter }),
    ...(searchQuery && { search: searchQuery }),
  };

  const { inspirations, loading, error, refetch } = useInspirations(filters);

  return (
    <ProtectedRoute requiredRole="ops">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Inspiration Library</h1>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Upload Inspiration
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by title, description, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <select
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value as RpInspirationSource | "")}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Sources</option>
              <option value="etsy">Etsy</option>
              <option value="pinterest">Pinterest</option>
              <option value="shopify">Shopify</option>
              <option value="screenshot">Screenshot</option>
              <option value="internal">Internal</option>
              <option value="other">Other</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as RpProductCategory | "")}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Categories</option>
              <option value="panties">Panties</option>
              <option value="bralette">Bralette</option>
              <option value="tank">Tank</option>
              <option value="tee">Tee</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading inspirations...</p>}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {inspirations.length === 0 ? (
              <p className="text-sm text-gray-500">No inspirations found. Upload some to get started!</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {inspirations.map((inspiration) => (
                  <div
                    key={inspiration.id}
                    className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    {inspiration.imageUrls && inspiration.imageUrls.length > 0 && (
                      <img
                        src={inspiration.imageUrls[0]}
                        alt={inspiration.title}
                        className="w-full h-48 object-cover"
                      />
                    )}
                    <div className="p-3">
                      <h3 className="font-semibold text-sm text-gray-900 mb-1 line-clamp-2">
                        {inspiration.title}
                      </h3>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                          {inspiration.sourceType}
                        </span>
                        {inspiration.category && (
                          <span className="inline-flex px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                            {inspiration.category}
                          </span>
                        )}
                      </div>
                      {inspiration.tags && inspiration.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {inspiration.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex px-1.5 py-0.5 bg-gray-50 text-gray-600 rounded text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                          {inspiration.tags.length > 3 && (
                            <span className="text-xs text-gray-400">+{inspiration.tags.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <UploadInspirationModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onCreate={refetch}
        />
      </div>
    </ProtectedRoute>
  );
}
