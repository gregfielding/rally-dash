"use client";

import useSWR from "swr";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { DesignTeam } from "@/lib/types/firestore";

export function useDesignTeam(teamId: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<DesignTeam | null>(
    teamId ? `design_team:${teamId}` : null,
    async () => {
      if (!db || !teamId) return null;
      const snap = await getDoc(doc(db, "design_teams", teamId));
      if (!snap.exists()) return null;
      return { ...(snap.data() as DesignTeam), id: snap.id };
    },
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  return {
    team: data ?? null,
    loading: isLoading,
    error: error?.message ?? null,
    refetch: mutate,
  };
}
