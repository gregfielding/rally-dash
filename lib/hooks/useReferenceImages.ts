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
  where,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { ReferenceImage } from "@/lib/types/firestore";

export function useReferenceImages(category?: string) {
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImages = async () => {
    if (!db) {
      setError("Database not initialized");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      let q;
      if (category) {
        q = query(
          collection(db, "referenceImages"), 
          where("category", "==", category),
          orderBy("createdAt", "desc")
        );
      } else {
        q = query(collection(db, "referenceImages"), orderBy("createdAt", "desc"));
      }
      
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ReferenceImage[];
      setImages(data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch reference images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, [category]);

  const createImage = async (image: Omit<ReferenceImage, "id" | "createdAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const newImage = {
      ...image,
      tags: image.tags || [],
      createdAt: serverTimestamp(),
    };
    
    const docRef = await addDoc(collection(db, "referenceImages"), newImage);
    await fetchImages();
    return docRef.id;
  };

  const updateImage = async (id: string, updates: Partial<ReferenceImage>) => {
    if (!db) throw new Error("Database not initialized");
    
    await updateDoc(doc(db, "referenceImages", id), updates);
    await fetchImages();
  };

  const deleteImage = async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    await deleteDoc(doc(db, "referenceImages", id));
    await fetchImages();
  };

  return {
    images,
    loading,
    error,
    createImage,
    updateImage,
    deleteImage,
    refetch: fetchImages,
  };
}

