"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpNotification, RpNotificationPreferences } from "@/lib/types/firestore";
import { useAuth } from "@/lib/providers/AuthProvider";

async function fetchNotifications(userId: string, unreadOnly: boolean = false): Promise<RpNotification[]> {
  if (!db) throw new Error("Database not initialized");
  
  const conditions: any[] = [where("userId", "==", userId)];
  if (unreadOnly) {
    conditions.push(where("read", "==", false));
  }
  conditions.push(orderBy("createdAt", "desc"));
  conditions.push(limit(50));

  const q = query(collection(db, "rp_notifications"), ...conditions);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpNotification) }));
}

export function useNotifications(unreadOnly: boolean = false) {
  const { user } = useAuth();
  
  const { data, error, isLoading, mutate } = useSWR<RpNotification[]>(
    user ? `notifications:${user.uid}:${unreadOnly}` : null,
    () => user ? fetchNotifications(user.uid, unreadOnly) : [],
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!db) throw new Error("Database not initialized");
      const notificationRef = doc(db, "rp_notifications", notificationId);
      await updateDoc(notificationRef, {
        read: true,
      });
      await mutate();
    },
    [mutate]
  );

  const markAllAsRead = useCallback(
    async () => {
      if (!db || !user) throw new Error("Database or user not initialized");
      const unreadNotifications = data?.filter((n) => !n.read) || [];
      if (unreadNotifications.length === 0) return;

      const batch = writeBatch(db);
      unreadNotifications.forEach((notification) => {
        if (notification.id && db) {
          const notificationRef = doc(db, "rp_notifications", notification.id);
          batch.update(notificationRef, { read: true });
        }
      });
      await batch.commit();
      await mutate();
    },
    [data, user, mutate]
  );

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!db) throw new Error("Database not initialized");
      const notificationRef = doc(db, "rp_notifications", notificationId);
      await updateDoc(notificationRef, { read: true }); // Mark as read instead of deleting
      await mutate();
    },
    [mutate]
  );

  return {
    notifications: data || [],
    unreadCount: data?.filter((n) => !n.read).length || 0,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}

async function fetchNotificationPreferences(userId: string): Promise<RpNotificationPreferences | null> {
  if (!db) throw new Error("Database not initialized");
  const prefsRef = doc(db, "rp_notification_preferences", userId);
  const prefsSnap = await getDoc(prefsRef);
  if (!prefsSnap.exists()) return null;
  return { id: prefsSnap.id, ...(prefsSnap.data() as RpNotificationPreferences) };
}

export function useNotificationPreferences() {
  const { user } = useAuth();
  
  const { data, error, isLoading, mutate } = useSWR<RpNotificationPreferences | null>(
    user ? `notification_preferences:${user.uid}` : null,
    () => user ? fetchNotificationPreferences(user.uid) : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 10000,
    }
  );

  const updatePreferences = useCallback(
    async (updates: Partial<RpNotificationPreferences>) => {
      if (!db || !user) throw new Error("Database or user not initialized");
      
      const prefsRef = doc(db, "rp_notification_preferences", user.uid);
      const prefsSnap = await getDoc(prefsRef);
      
      if (!prefsSnap.exists()) {
        // Create new preferences
        const { addDoc } = await import("firebase/firestore");
        const newPrefs: Omit<RpNotificationPreferences, "id"> = {
          userId: user.uid,
          emailEnabled: updates.emailEnabled ?? false,
          inAppEnabled: updates.inAppEnabled ?? true,
          types: updates.types || {
            generation_complete: true,
            generation_failed: true,
            batch_complete: true,
            review_requested: true,
          },
          updatedAt: serverTimestamp() as any,
        };
        await addDoc(collection(db, "rp_notification_preferences"), newPrefs);
      } else {
        // Update existing preferences
        await updateDoc(prefsRef, {
          ...updates,
          updatedAt: serverTimestamp(),
        });
      }
      await mutate();
    },
    [user, mutate]
  );

  return {
    preferences: data,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
    updatePreferences,
  };
}
