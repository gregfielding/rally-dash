"use client";

import Link from "next/link";
import { useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TableSkeleton } from "@/components/Skeleton";
import { useProducts } from "@/lib/hooks/useRPProducts";
import {
  productAttentionReasons,
  labelAttentionReason,
} from "@/lib/dashboard/productWorkflow";

function tsMs(t: unknown): number {
  if (!t) return 0;
  const x = t as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof x.toMillis === "function") return x.toMillis();
  if (typeof x.seconds === "number") return x.seconds * 1000;
  if (typeof x._seconds === "number") return x._seconds * 1000;
  return 0;
}

function DashboardContent() {
  const { products, loading, error } = useProducts({});

  const attentionRows = useMemo(() => {
    if (!products.length) return [];
    const rows: { product: (typeof products)[0]; reasons: string[] }[] = [];
    for (const p of products) {
      const reasons = productAttentionReasons(p);
      if (reasons.length === 0) continue;
      rows.push({
        product: p,
        reasons: [...new Set(reasons)].map(labelAttentionReason),
      });
    }
    return rows.slice(0, 24);
  }, [products]);

  const recentProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt))
      .slice(0, 8);
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

  const workflowCards = [
    {
      title: "Organize Catalog",
      description: "Product lines, leagues, teams, themes, and taxonomy rules.",
      href: "/catalog",
      color: "bg-violet-600 hover:bg-violet-700",
    },
    {
      title: "Create Products",
      description: "Create manually or from design + blank.",
      href: "/products",
      color: "bg-blue-600 hover:bg-blue-700",
    },
    {
      title: "Complete Content",
      description: "Titles, descriptions, SEO, and classification on each product.",
      href: "/products",
      color: "bg-emerald-600 hover:bg-emerald-700",
    },
    {
      title: "Sync to Shopify",
      description: "Review readiness and publish from the Publish queue.",
      href: "/publish",
      color: "bg-amber-600 hover:bg-amber-700",
    },
  ];

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">
          Product-first workflow — start with catalog, then products, content, and publish.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Next steps
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {workflowCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={`block rounded-xl p-6 text-white shadow-md transition ${card.color}`}
            >
              <h4 className="text-lg font-semibold">{card.title}</h4>
              <p className="text-sm text-white/90 mt-2">{card.description}</p>
              <span className="inline-block mt-4 text-sm font-medium underline">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Needs attention</h3>
            <Link
              href="/publish"
              className="text-sm text-blue-600 hover:underline"
            >
              Publish queue
            </Link>
          </div>
          <div className="p-4">
            {attentionRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                No products flagged right now. Nice work.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {attentionRows.map(({ product, reasons }) => (
                  <li key={product.id} className="py-3 first:pt-0">
                    <Link
                      href={`/products/${encodeURIComponent(product.slug)}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {product.title ?? product.name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-1">
                      {reasons.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Recent products</h3>
          </div>
          <div className="p-4">
            {recentProducts.length === 0 ? (
              <p className="text-sm text-gray-500">
                No products yet.{" "}
                <Link href="/products" className="text-blue-600 hover:underline">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentProducts.map((p) => (
                  <li key={p.id} className="py-3 first:pt-0 flex gap-3">
                    <div className="w-14 h-14 shrink-0 rounded bg-gray-100 overflow-hidden border border-gray-200">
                      {p.media?.heroFront || p.mockupUrl ? (
                        <img
                          src={(p.media?.heroFront || p.mockupUrl) as string}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                          —
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/products/${encodeURIComponent(p.slug)}`}
                        className="font-medium text-gray-900 hover:text-blue-600 truncate block"
                      >
                        {p.title ?? p.name}
                      </Link>
                      <p className="text-xs text-gray-500 truncate">
                        {p.baseProductKey} · {p.colorway?.name}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <DashboardContent />
    </ProtectedRoute>
  );
}
