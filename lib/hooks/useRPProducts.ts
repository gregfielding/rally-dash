"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  RpProduct,
  RpProductStatus,
  RpProductCategory,
} from "@/lib/types/firestore";

export interface UseProductsFilters {
  status?: RpProductStatus;
  category?: RpProductCategory;
  baseProductKey?: string;
  search?: string; // client-side search for now
  limit?: number;
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
  let products = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProduct) }));

  // Client-side search (if provided)
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.slug.toLowerCase().includes(searchLower) ||
        p.baseProductKey.toLowerCase().includes(searchLower) ||
        p.colorway.name.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower)
    );
  }

  // Apply limit
  if (filters?.limit) {
    products = products.slice(0, filters.limit);
  }

  return products;
}

async function fetchRPProductBySlug(slug: string): Promise<RpProduct | null> {
  if (!db) throw new Error("Database not initialized");
  if (!slug) return null;

  const decodedSlug = decodeURIComponent(slug);
  const base = collection(db, "rp_products");
  
  // Query by slug only (slug should be unique, so no need for orderBy)
  // Try both encoded and decoded versions
  try {
    // First try with decoded slug
    let q = query(base, where("slug", "==", decodedSlug));
    let snapshot = await getDocs(q);

    if (snapshot.empty && slug !== decodedSlug) {
      q = query(base, where("slug", "==", slug));
      snapshot = await getDocs(q);
    }

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as RpProduct) };
  } catch (error: any) {
    console.error("[fetchRPProductBySlug] Error fetching product:", error);
    // If query fails (e.g., missing index), return null
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
      return { id: docSnap.id, ...(docSnap.data() as RpProduct) };
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
