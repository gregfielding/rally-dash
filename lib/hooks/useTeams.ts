"use client";

import { useCallback } from "react";
import useSWR from "swr";
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

async function fetchTeams(leagueId?: string): Promise<Team[]> {
  if (!db) throw new Error("Database not initialized");
  
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
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Team[];
}

export function useTeams(leagueId?: string) {
  const { data, error, isLoading, mutate } = useSWR<Team[]>(
    leagueId ? `teams:${leagueId}` : "teams",
    () => fetchTeams(leagueId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createTeam = useCallback(async (team: Omit<Team, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const slug = team.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    
    // Build the new team object, excluding undefined values (Firestore doesn't accept undefined)
    const newTeam: Record<string, any> = {
      leagueId: team.leagueId,
      name: team.name,
      slug,
      city: team.city,
      colors: team.colors,
      keywords: team.keywords || [],
      bannedTerms: team.bannedTerms || [],
      active: team.active,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // Only add notes if it has a value
    if (team.notes) {
      newTeam.notes = team.notes;
    }
    
    // Optimistic update
    const optimisticTeam: Team = {
      ...newTeam as Team,
      id: "temp",
      createdAt: undefined,
      updatedAt: undefined,
    };
    mutate([...(data || []), optimisticTeam], false);
    
    const docRef = await addDoc(collection(db, "teams"), newTeam);
    await mutate();
    return docRef.id;
  }, [data, mutate]);

  const updateTeam = useCallback(async (id: string, updates: Partial<Team>) => {
    if (!db) throw new Error("Database not initialized");
    
    // Filter out undefined values (Firestore doesn't accept undefined)
    const updateData: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };
    
    // Only include defined values
    if (updates.leagueId !== undefined) updateData.leagueId = updates.leagueId;
    if (updates.name !== undefined) {
      updateData.name = updates.name;
      updateData.slug = updates.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    if (updates.city !== undefined) updateData.city = updates.city;
    if (updates.colors !== undefined) updateData.colors = updates.colors;
    if (updates.keywords !== undefined) updateData.keywords = updates.keywords;
    if (updates.bannedTerms !== undefined) updateData.bannedTerms = updates.bannedTerms;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.active !== undefined) updateData.active = updates.active;
    
    // Optimistic update
    const optimisticData = (data || []).map(team => 
      team.id === id ? { ...team, ...updates } : team
    );
    mutate(optimisticData, false);
    
    await updateDoc(doc(db, "teams", id), updateData);
    await mutate();
  }, [data, mutate]);

  const deleteTeam = useCallback(async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    
    // Optimistic update
    const optimisticData = (data || []).filter(team => team.id !== id);
    mutate(optimisticData, false);
    
    await deleteDoc(doc(db, "teams", id));
    await mutate();
  }, [data, mutate]);

  return {
    teams: data || [],
    loading: isLoading,
    error: error?.message || null,
    createTeam,
    updateTeam,
    deleteTeam,
    refetch: mutate,
  };
}

