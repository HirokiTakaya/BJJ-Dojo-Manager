"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * In-memory cache shared across all hook instances.
 * Survives page navigations within the same SPA session.
 * Resets on full page reload (which is fine — fresh data).
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchDojoName(dojoId: string): Promise<string | null> {
  // Return from cache
  if (cache.has(dojoId)) return cache.get(dojoId)!;

  // Deduplicate concurrent requests for the same dojoId
  if (inflight.has(dojoId)) return inflight.get(dojoId)!;

  const promise = (async () => {
    try {
      const snap = await getDoc(doc(db, "dojos", dojoId));
      const name = snap.exists() ? snap.data()?.name || null : null;
      cache.set(dojoId, name);
      return name;
    } catch (e) {
      console.error("useDojoName:", e);
      return null;
    } finally {
      inflight.delete(dojoId);
    }
  })();

  inflight.set(dojoId, promise);
  return promise;
}

/**
 * Fetch dojo name from Firestore: dojos/{dojoId}.name
 *
 * - Returns cached result instantly if available (no loading flash)
 * - Deduplicates concurrent requests for the same dojoId
 * - Safe to call with empty dojoId (returns null)
 *
 * Usage:
 *   const { dojoName, loading } = useDojoName(dojoId ?? "");
 */
export function useDojoName(dojoId: string) {
  const [dojoName, setDojoName] = useState<string | null>(
    () => (dojoId && cache.has(dojoId) ? cache.get(dojoId)! : null)
  );
  const [loading, setLoading] = useState(() => !!(dojoId && !cache.has(dojoId)));

  useEffect(() => {
    if (!dojoId || !db) {
      setDojoName(null);
      setLoading(false);
      return;
    }

    // Instant cache hit — no async needed
    if (cache.has(dojoId)) {
      setDojoName(cache.get(dojoId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchDojoName(dojoId).then((name) => {
      if (!cancelled) {
        setDojoName(name);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dojoId]);

  return { dojoName, loading };
}

/**
 * Manually invalidate the cache for a specific dojo.
 * Useful after the user edits the dojo name in settings.
 */
export function invalidateDojoNameCache(dojoId?: string) {
  if (dojoId) {
    cache.delete(dojoId);
  } else {
    cache.clear();
  }
}