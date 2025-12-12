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
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { League } from "@/lib/types/firestore";

export function useLeagues() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeagues = async () => {
    if (!db) {
      setError("Database not initialized");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const q = query(collection(db, "leagues"), orderBy("name"));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as League[];
      setLeagues(data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch leagues");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeagues();
  }, []);

  const createLeague = async (league: Omit<League, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const slug = league.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const newLeague = {
      ...league,
      slug,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    const docRef = await addDoc(collection(db, "leagues"), newLeague);
    await fetchLeagues();
    return docRef.id;
  };

  const updateLeague = async (id: string, updates: Partial<League>) => {
    if (!db) throw new Error("Database not initialized");
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    if (updates.name) {
      updateData.slug = updates.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    
    await updateDoc(doc(db, "leagues", id), updateData);
    await fetchLeagues();
  };

  const deleteLeague = async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    await deleteDoc(doc(db, "leagues", id));
    await fetchLeagues();
  };

  return {
    leagues,
    loading,
    error,
    createLeague,
    updateLeague,
    deleteLeague,
    refetch: fetchLeagues,
  };
}

