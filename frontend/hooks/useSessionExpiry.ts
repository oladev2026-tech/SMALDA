"use client";

import { useEffect } from "react";

/**
 * Synchronize sign-out across browser tabs via the Storage API. When
 * one tab removes the `auth-token` entry from localStorage (e.g. on
 * a deliberate sign-out or a forced session-cleanup), the other tabs
 * fire the onSessionExpired callback so the entire app reacts at
 * once without polling.
 *
 * Pair this with a "Stay signed in?" warning dialog (separate feature)
 * by reading access-token timestamps from sessionStorage; this hook
 * remains a pure listener without owning the warning UI.
 */
export function useSessionExpiry(onSessionExpired: () => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handler(e: StorageEvent) {
      if (e.key !== "auth-token") return;
      if (e.newValue === null || e.newValue === "") {
        onSessionExpired();
      }
    }
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }, [onSessionExpired]);
}
