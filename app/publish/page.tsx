"use client";

import Link from "next/link";
import { useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TableSkeleton } from "@/components/Skeleton";
import { useProducts } from "@/lib/hooks/useRPProducts";
import { isProductReadyForShopify } from "@/lib/shopify/isProductReadyForShopify";
import type { RpProduct } from "@/lib/types/firestore";

type PublishBucket = "ready" | "attention" | "synced" | "errors";

function bucketForProduct(p: RpProduct): PublishBucket {
  const err = p.shopify?.lastSyncError;
  if (err) return "errors";

  const pid = p.shopify?.productId;
  const { ready } = isProductReadyForShopify(p);

  if (pid) return "synced";
  if (ready) return "ready";
  return "attention";
}

function ProductRow({ p }: { p: RpProduct }) {
  const thumb = p.media?.heroFront ?? p.media?.heroBack ?? p.mockupUrl ?? p.heroAssetPath;
  const { ready, missing } = isProductReadyForShopify(p);

  return (
    <li className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="w-14 h-14 shrink-0 rounded bg-gray-100 overflow-hidden border border-gray-200">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
            —
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/products/${encodeURIComponent(p.slug)}`}
          className="font-medium text-gray-900 hover:text-blue-600"
        >
          {p.title ?? p.name}
        </Link>
        <p className="text-xs text-gray-500 mt-0.5">
          Sync: {p.shopify?.status ?? "not_synced"}
          {p.shopify?.productId && (
            <span className="ml-2 font-mono">#{p.shopify.productId}</span>
          )}
        </p>
        {!ready && (
          <p className="text-xs text-amber-700 mt-1">
            Missing: {missing.join(", ")}
          </p>
        )}
        {p.shopify?.lastSyncError && (
          <p className="text-xs text-red-600 mt-1">
            {p.shopify.lastSyncError}
          </p>
        )}
      </div>
    </li>
  );
}

function BucketSection({
  title,
  description,
  products,
  emptyHint,
}: {
  title: string;
  description: string;
  products: RpProduct[];
  emptyHint: string;
}) {
  return (
    <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <div className="p-4">
        {products.length === 0 ? (
          <p className="text-sm text-gray-500">{emptyHint}</p>
        ) : (
          <ul>
            {products.map((p) => (
              <ProductRow key={p.id} p={p} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PublishContent() {
  const { products, loading, error } = useProducts({});

  const grouped = useMemo(() => {
    const ready: RpProduct[] = [];
    const attention: RpProduct[] = [];
    const synced: RpProduct[] = [];
    const errors: RpProduct[] = [];

    for (const p of products) {
      switch (bucketForProduct(p)) {
        case "ready":
          ready.push(p);
          break;
        case "attention":
          attention.push(p);
          break;
        case "synced":
          synced.push(p);
          break;
        case "errors":
          errors.push(p);
          break;
      }
    }

    return { ready, attention, synced, errors };
  }, [products]);

  if (loading) {
    return (
      <div className="p-6">
        <TableSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Publish</h1>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Pre-Shopify launch queue: readiness, sync state, and errors. Open a product’s
          <span className="font-medium"> Shopify</span> tab to queue sync.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BucketSection
          title="Ready to sync"
          description="Required fields for Shopify are satisfied; not yet synced."
          products={grouped.ready}
          emptyHint="No products are fully ready and unsynced."
        />
        <BucketSection
          title="Needs attention"
          description="Missing required data or warnings before you can sync."
          products={grouped.attention}
          emptyHint="Nothing blocked — or everything is already synced."
        />
        <BucketSection
          title="Synced"
          description="Linked to Shopify (product ID present)."
          products={grouped.synced}
          emptyHint="No products linked to Shopify yet."
        />
        <BucketSection
          title="Sync errors"
          description="Last sync failed — fix issues and retry from the product."
          products={grouped.errors}
          emptyHint="No sync errors."
        />
      </div>
    </div>
  );
}

export default function PublishPage() {
  return (
    <ProtectedRoute requiredRole="editor">
      <PublishContent />
    </ProtectedRoute>
  );
}
