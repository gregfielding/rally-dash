"use client";

import { useState, FormEvent } from "react";
import { Product } from "@/lib/types/firestore";

interface ProductFormProps {
  product?: Product;
  onSubmit: (product: Omit<Product, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function ProductForm({ product, onSubmit, onCancel, loading }: ProductFormProps) {
  const [name, setName] = useState(product?.name || "");
  const [skuPrefix, setSkuPrefix] = useState(product?.skuPrefix || "");
  const [widthIn, setWidthIn] = useState(product?.printArea?.widthIn.toString() || "");
  const [heightIn, setHeightIn] = useState(product?.printArea?.heightIn.toString() || "");
  const [dpi, setDpi] = useState(product?.printArea?.dpi.toString() || "300");
  const [x, setX] = useState(product?.printArea?.x.toString() || "0");
  const [y, setY] = useState(product?.printArea?.y.toString() || "0");
  const [active, setActive] = useState(product?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (!skuPrefix.trim()) newErrors.skuPrefix = "SKU Prefix is required";
    if (!widthIn || isNaN(parseFloat(widthIn)) || parseFloat(widthIn) <= 0) {
      newErrors.widthIn = "Valid width is required";
    }
    if (!heightIn || isNaN(parseFloat(heightIn)) || parseFloat(heightIn) <= 0) {
      newErrors.heightIn = "Valid height is required";
    }
    if (!dpi || isNaN(parseInt(dpi)) || parseInt(dpi) <= 0) {
      newErrors.dpi = "Valid DPI is required";
    }
    if (isNaN(parseFloat(x))) newErrors.x = "Valid X position is required";
    if (isNaN(parseFloat(y))) newErrors.y = "Valid Y position is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await onSubmit({
        name,
        skuPrefix,
        printArea: {
          widthIn: parseFloat(widthIn),
          heightIn: parseFloat(heightIn),
          dpi: parseInt(dpi),
          x: parseFloat(x),
          y: parseFloat(y),
        },
        basePhotos: product?.basePhotos,
        mockupTemplateId: product?.mockupTemplateId,
        variants: product?.variants || [],
        active,
      });
    } catch (error: any) {
      setErrors({ submit: error.message || "Failed to save product" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errors.submit && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {errors.submit}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Product Name *
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Panty, Tank, Crewneck"
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="skuPrefix" className="block text-sm font-medium text-gray-700 mb-1">
            SKU Prefix *
          </label>
          <input
            type="text"
            id="skuPrefix"
            value={skuPrefix}
            onChange={(e) => setSkuPrefix(e.target.value.toUpperCase())}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., PNTY"
          />
          {errors.skuPrefix && <p className="mt-1 text-sm text-red-600">{errors.skuPrefix}</p>}
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-lg font-semibold mb-3">Print Area</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="widthIn" className="block text-sm font-medium text-gray-700 mb-1">
              Width (inches) *
            </label>
            <input
              type="number"
              id="widthIn"
              step="0.01"
              value={widthIn}
              onChange={(e) => setWidthIn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.widthIn && <p className="mt-1 text-sm text-red-600">{errors.widthIn}</p>}
          </div>

          <div>
            <label htmlFor="heightIn" className="block text-sm font-medium text-gray-700 mb-1">
              Height (inches) *
            </label>
            <input
              type="number"
              id="heightIn"
              step="0.01"
              value={heightIn}
              onChange={(e) => setHeightIn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.heightIn && <p className="mt-1 text-sm text-red-600">{errors.heightIn}</p>}
          </div>

          <div>
            <label htmlFor="dpi" className="block text-sm font-medium text-gray-700 mb-1">
              DPI *
            </label>
            <input
              type="number"
              id="dpi"
              value={dpi}
              onChange={(e) => setDpi(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.dpi && <p className="mt-1 text-sm text-red-600">{errors.dpi}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label htmlFor="x" className="block text-sm font-medium text-gray-700 mb-1">
              X Position (inches)
            </label>
            <input
              type="number"
              id="x"
              step="0.01"
              value={x}
              onChange={(e) => setX(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.x && <p className="mt-1 text-sm text-red-600">{errors.x}</p>}
          </div>

          <div>
            <label htmlFor="y" className="block text-sm font-medium text-gray-700 mb-1">
              Y Position (inches)
            </label>
            <input
              type="number"
              id="y"
              step="0.01"
              value={y}
              onChange={(e) => setY(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.y && <p className="mt-1 text-sm text-red-600">{errors.y}</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="active" className="ml-2 block text-sm text-gray-700">
          Active
        </label>
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : product ? "Update Product" : "Create Product"}
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

