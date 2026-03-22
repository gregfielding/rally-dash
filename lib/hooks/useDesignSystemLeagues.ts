"use client";

import useSWR from "swr";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { DesignSystemLeague } from "@/lib/types/firestore";

async function fetchDesignSystemLeagues(): Promise<DesignSystemLeague[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, "design_system"));
  const rows = snapshot.docs.map((d) => {
    const data = d.data() as Omit<DesignSystemLeague, "id">;
    return {
      id: d.id,
      leagueCode: data.leagueCode ?? d.id,
      leagueName: data.leagueName ?? d.id,
      teams: Array.isArray(data.teams) ? data.teams : [],
    };
  });
  rows.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
  return rows;
}

export function useDesignSystemLeagues() {
  const { data, error, isLoading, mutate } = useSWR<DesignSystemLeague[]>(
    "design_system_leagues",
    fetchDesignSystemLeagues,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    leagues: data ?? [],
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch: mutate,
  };
}
