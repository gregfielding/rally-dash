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
import { Team } from "@/lib/types/firestore";

export function useTeams(leagueId?: string) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeams = async () => {
    if (!db) {
      setError("Database not initialized");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      let q;
      if (leagueId) {
        q = query(
          collection(db, "teams"), 
          where("leagueId", "==", leagueId),
          orderBy("name")
        );
      } else {
        q = query(collection(db, "teams"), orderBy("name"));
      }
      
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Team[];
      setTeams(data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, [leagueId]);

  const createTeam = async (team: Omit<Team, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const slug = team.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const newTeam = {
      ...team,
      slug,
      keywords: team.keywords || [],
      bannedTerms: team.bannedTerms || [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    const docRef = await addDoc(collection(db, "teams"), newTeam);
    await fetchTeams();
    return docRef.id;
  };

  const updateTeam = async (id: string, updates: Partial<Team>) => {
    if (!db) throw new Error("Database not initialized");
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    if (updates.name) {
      updateData.slug = updates.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    
    await updateDoc(doc(db, "teams", id), updateData);
    await fetchTeams();
  };

  const deleteTeam = async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    await deleteDoc(doc(db, "teams", id));
    await fetchTeams();
  };

  return {
    teams,
    loading,
    error,
    createTeam,
    updateTeam,
    deleteTeam,
    refetch: fetchTeams,
  };
}

