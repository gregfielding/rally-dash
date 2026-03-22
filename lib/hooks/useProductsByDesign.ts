"use client";

import { useMemo } from "react";
import { useProducts } from "@/lib/hooks/useRPProducts";
import {
  buildProductsByDesignMap,
  type ProductDesignLink,
} from "@/lib/designs/productDesignLinks";

/**
 * Single fetch of all products, indexed by design id for Design Library "Used on" / detail.
 */
export function useProductsByDesignIndex() {
  const { products, loading, error, refetch } = useProducts();

  const productsByDesign = useMemo(
    () => buildProductsByDesignMap(products),
    [products]
  );

  const getProductsForDesign = (designId: string): ProductDesignLink[] =>
    productsByDesign.get(designId) ?? [];

  return {
    productsByDesign,
    getProductsForDesign,
    loading,
    error,
    refetch,
  };
}
