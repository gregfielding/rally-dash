"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  QueryDocumentSnapshot,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  RpProduct,
  RpProductStatus,
  RpProductCategory,
  RpProductVariant,
} from "@/lib/types/firestore";

export interface UseProductsFilters {
  status?: RpProductStatus;
  category?: RpProductCategory;
  baseProductKey?: string;
  search?: string; // client-side search for now
  limit?: number;
  /**
   * When explicitly `true`, only top-level docs with `productKind === "parent"` (excludes legacy per-color docs).
   * Omit or `false` to list all top-level `rp_products` rows (e.g. dashboard / publish). The Products page passes `true` by default.
   */
  parentsOnly?: boolean;
}

async function fetchRPProducts(filters?: UseProductsFilters): Promise<RpProduct[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_products");
  let q = query(base);

  // Apply filters
  const conditions: any[] = [];
  if (filters?.status) {
    conditions.push(where("status", "==", filters.status));
  }
  if (filters?.category) {
    conditions.push(where("category", "==", filters.category));
  }
  if (filters?.baseProductKey) {
    conditions.push(where("baseProductKey", "==", filters.baseProductKey));
  }

  // Add orderBy (required if using where)
  if (conditions.length > 0) {
    conditions.push(orderBy("createdAt", "desc"));
    q = query(base, ...conditions);
  } else {
    q = query(base, orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  // Document id must win over any stored `id` field on the snapshot payload.
  let products = snapshot.docs.map((d) => ({ ...(d.data() as RpProduct), id: d.id }));

  // Opt-in: parent products only (Products list default). Other callers omit this to see legacy rows when needed.
  if (filters?.parentsOnly === true) {
    products = products.filter((p) => p.productKind === "parent");
  }

  // Client-side search (if provided)
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    products = products.filter((p) => {
      const hay = [
        p.title,
        p.name,
        p.slug,
        p.baseProductKey,
        p.colorway?.name,
        p.description,
        p.handle,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(searchLower);
    });
  }

  // Apply limit
  if (filters?.limit) {
    products = products.slice(0, filters.limit);
  }

  return products;
}

function mapProductDoc(d: QueryDocumentSnapshot): RpProduct {
  return { ...(d.data() as RpProduct), id: d.id };
}

/** Prefer parent doc when multiple rows match (e.g. duplicate slug/handle). */
function pickProductDoc(docs: QueryDocumentSnapshot[]): QueryDocumentSnapshot {
  if (docs.length === 1) return docs[0]!;
  const parents = docs.filter((d) => (d.data() as RpProduct).productKind === "parent");
  return parents[0] ?? docs[0]!;
}

async function fetchRPProductBySlug(slug: string): Promise<RpProduct | null> {
  if (!db) throw new Error("Database not initialized");
  if (!slug) return null;

  const decodedSlug = decodeURIComponent(slug);
  const base = collection(db, "rp_products");

  try {
    const tryQueries = [
      query(base, where("slug", "==", decodedSlug)),
      ...(slug !== decodedSlug ? [query(base, where("slug", "==", slug))] : []),
      query(base, where("handle", "==", decodedSlug)),
      ...(decodedSlug !== slug ? [query(base, where("handle", "==", slug))] : []),
    ];

    for (const q of tryQueries) {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const picked = pickProductDoc(snapshot.docs);
        const out = mapProductDoc(picked);
        if (process.env.NODE_ENV === "development") {
          console.info("[fetchRPProductBySlug] resolved", {
            routeSlug: slug,
            docId: out.id,
            productKind: out.productKind,
            slugField: out.slug,
            handleField: out.handle,
            matchCount: snapshot.docs.length,
          });
        }
        return out;
      }
    }

    return null;
  } catch (error: unknown) {
    console.error("[fetchRPProductBySlug] Error fetching product:", error);
    return null;
  }
}

/**
 * Hook to fetch all products with optional filters
 */
export function useProducts(filters?: UseProductsFilters) {
  const cacheKey = useMemo(
    () =>
      `rp_products:${JSON.stringify(filters || {})}`,
    [filters]
  );

  const { data, error, isLoading, mutate } = useSWR<RpProduct[]>(
    cacheKey,
    () => fetchRPProducts(filters),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    products: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}

/**
 * Hook to fetch a single product by slug
 */
export function useProductBySlug(slug: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<RpProduct | null>(
    slug ? `rp_product:${slug}` : null,
    (slug ? () => fetchRPProductBySlug(slug) : () => null),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  return {
    product: data || null,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}

/** Variants subcollection: `rp_products/{parentId}/variants` */
export async function fetchProductVariants(parentProductId: string): Promise<RpProductVariant[]> {
  if (!db) return [];
  const snap = await getDocs(collection(db, "rp_products", parentProductId, "variants"));
  const rows = snap.docs.map((d) => ({ ...(d.data() as RpProductVariant), id: d.id }));
  return rows.sort((a, b) => (a.colorName || "").localeCompare(b.colorName || "", undefined, { sensitivity: "base" }));
}

export function useProductVariants(parentProductId: string | undefined) {
  const key = parentProductId ? `rp_product_variants:${parentProductId}` : null;
  const { data, error, isLoading, mutate } = useSWR<RpProductVariant[]>(
    key,
    () => fetchProductVariants(parentProductId!),
    { revalidateOnFocus: false, dedupingInterval: 3000 }
  );
  return {
    variants: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}

/**
 * Hook to fetch a single product by ID
 */
export function useProduct(productId: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<RpProduct | null>(
    productId ? `rp_product:${productId}` : null,
    async () => {
      if (!db || !productId) return null;
      const docRef = doc(db, "rp_products", productId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return null;
      return { ...(docSnap.data() as RpProduct), id: docSnap.id };
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  return {
    product: data || null,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
