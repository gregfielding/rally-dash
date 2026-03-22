"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const sections = [
  {
    title: "Product lines",
    description:
      "Browse products by base product key and colorway. Manage SKUs and variants from the Products workspace.",
    href: "/products",
    cta: "Open Products",
  },
  {
    title: "Leagues",
    description: "League codes and metadata used for taxonomy and Shopify collections.",
    href: "/leagues",
    cta: "Manage leagues",
  },
  {
    title: "Teams",
    description: "Team / entity codes tied to designs and product classification.",
    href: "/teams",
    cta: "Manage teams",
  },
  {
    title: "Collections & themes",
    description:
      "Theme codes and design families are set per product under Content → Taxonomy. Batch design import uses taxonomy context from Design batch flows.",
    href: "/designs/batch",
    cta: "Design batch",
  },
  {
    title: "Taxonomy rules",
    description:
      "Sport → League → Entity hierarchy, theme codes, and design family drive tags and Smart Collections in Shopify. Edit classification on each product’s Content tab.",
    href: "/products",
    cta: "Go to products",
  },
];

function CatalogContent() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Catalog</h1>
        <p className="text-gray-600 mt-2 max-w-2xl">
          One place for how products are organized: lines, sports metadata, leagues,
          teams, themes, and the rules that flow into Shopify.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map((s) => (
          <div
            key={s.title}
            className="bg-white rounded-lg shadow border border-gray-100 p-6 flex flex-col"
          >
            <h2 className="text-lg font-semibold text-gray-900">{s.title}</h2>
            <p className="text-sm text-gray-600 mt-2 flex-1">{s.description}</p>
            <Link
              href={s.href}
              className="mt-4 inline-flex px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 w-fit"
            >
              {s.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <CatalogContent />
    </ProtectedRoute>
  );
}
