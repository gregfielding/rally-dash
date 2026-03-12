"use client";

import useSWR from "swr";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type {
  RpTaxonomySport,
  RpTaxonomyLeague,
  RpTaxonomyEntity,
  RpTaxonomyTheme,
  RpTaxonomyDesignFamily,
} from "@/lib/types/firestore";

const COLLECTIONS = {
  sports: "rp_taxonomy_sports",
  leagues: "rp_taxonomy_leagues",
  entities: "rp_taxonomy_entities",
  themes: "rp_taxonomy_themes",
  design_families: "rp_taxonomy_design_families",
} as const;

function sortByOrder<T extends { sortOrder?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
}

async function fetchSports(): Promise<RpTaxonomySport[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, COLLECTIONS.sports));
  const items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() } as RpTaxonomySport))
    .filter((x) => x.active !== false);
  return sortByOrder(items);
}

async function fetchLeagues(filters?: { sportCode?: string | null }): Promise<RpTaxonomyLeague[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, COLLECTIONS.leagues));
  let items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() } as RpTaxonomyLeague))
    .filter((x) => x.active !== false);
  if (filters?.sportCode) {
    items = items.filter((x) => x.sportCode === filters.sportCode);
  }
  return sortByOrder(items);
}

async function fetchEntities(filters?: {
  sportCode?: string | null;
  leagueCode?: string | null;
}): Promise<RpTaxonomyEntity[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, COLLECTIONS.entities));
  let items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() } as RpTaxonomyEntity))
    .filter((x) => x.active !== false);
  if (filters?.sportCode) {
    items = items.filter((x) => x.sportCode === filters.sportCode);
  }
  if (filters?.leagueCode) {
    items = items.filter((x) => x.leagueCode === filters.leagueCode);
  }
  return sortByOrder(items);
}

async function fetchThemes(filters?: { sportCode?: string | null }): Promise<RpTaxonomyTheme[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, COLLECTIONS.themes));
  let items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() } as RpTaxonomyTheme))
    .filter((x) => x.active !== false);
  if (filters?.sportCode) {
    items = items.filter((x) => x.sportCode === filters.sportCode);
  }
  return sortByOrder(items);
}

async function fetchDesignFamilies(): Promise<RpTaxonomyDesignFamily[]> {
  if (!db) throw new Error("Database not initialized");
  const snapshot = await getDocs(collection(db, COLLECTIONS.design_families));
  const items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() } as RpTaxonomyDesignFamily))
    .filter((x) => x.active !== false);
  return sortByOrder(items);
}

const swrOpts = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 60000,
  keepPreviousData: true,
};

export function useTaxonomySports() {
  const { data, error, isLoading, mutate } = useSWR<RpTaxonomySport[]>(
    "taxonomy:sports",
    fetchSports,
    swrOpts
  );
  return { sports: data ?? [], loading: isLoading, error: error?.message ?? null, refetch: mutate };
}

export function useTaxonomyLeagues(sportCode?: string | null) {
  const key = sportCode ? `taxonomy:leagues:${sportCode}` : "taxonomy:leagues";
  const { data, error, isLoading, mutate } = useSWR<RpTaxonomyLeague[]>(
    key,
    () => fetchLeagues({ sportCode: sportCode ?? undefined }),
    swrOpts
  );
  return { leagues: data ?? [], loading: isLoading, error: error?.message ?? null, refetch: mutate };
}

export function useTaxonomyEntities(filters?: {
  sportCode?: string | null;
  leagueCode?: string | null;
}) {
  const key = filters
    ? `taxonomy:entities:${filters.sportCode ?? ""}:${filters.leagueCode ?? ""}`
    : "taxonomy:entities";
  const { data, error, isLoading, mutate } = useSWR<RpTaxonomyEntity[]>(
    key,
    () => fetchEntities(filters),
    swrOpts
  );
  return { entities: data ?? [], loading: isLoading, error: error?.message ?? null, refetch: mutate };
}

export function useTaxonomyThemes(sportCode?: string | null) {
  const key = sportCode ? `taxonomy:themes:${sportCode}` : "taxonomy:themes";
  const { data, error, isLoading, mutate } = useSWR<RpTaxonomyTheme[]>(
    key,
    () => fetchThemes({ sportCode: sportCode ?? undefined }),
    swrOpts
  );
  return { themes: data ?? [], loading: isLoading, error: error?.message ?? null, refetch: mutate };
}

export function useTaxonomyDesignFamilies() {
  const { data, error, isLoading, mutate } = useSWR<RpTaxonomyDesignFamily[]>(
    "taxonomy:design_families",
    fetchDesignFamilies,
    swrOpts
  );
  return {
    designFamilies: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    refetch: mutate,
  };
}
