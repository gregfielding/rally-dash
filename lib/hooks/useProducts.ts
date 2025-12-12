"use client";

import { useState, useEffect } from "react";
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { Product } from "@/lib/types/firestore";

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    if (!db) {
      setError("Database not initialized");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const q = query(collection(db, "products"), orderBy("name"));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Product[];
      setProducts(data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const createProduct = async (product: Omit<Product, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const newProduct = {
      ...product,
      variants: product.variants || [],
      active: product.active ?? true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    const docRef = await addDoc(collection(db, "products"), newProduct);
    await fetchProducts();
    return docRef.id;
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    if (!db) throw new Error("Database not initialized");
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    await updateDoc(doc(db, "products", id), updateData);
    await fetchProducts();
  };

  const deleteProduct = async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    await deleteDoc(doc(db, "products", id));
    await fetchProducts();
  };

  return {
    products,
    loading,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    refetch: fetchProducts,
  };
}

