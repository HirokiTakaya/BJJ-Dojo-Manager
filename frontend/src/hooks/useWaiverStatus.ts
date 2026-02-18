// src/hooks/useWaiverStatus.ts
"use client";

import { useEffect, useState } from "react";
import { dbNullable } from "@/firebase";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
} from "firebase/firestore";

type WaiverStatus = {
  loading: boolean;
  signed: boolean;
};

/**
 * Check whether the given user has at least one signed waiver
 * in the dojo's `waiverSubmissions` sub-collection.
 *
 * Returns { loading, signed }.
 */
export function useWaiverStatus(
  dojoId: string | null | undefined,
  uid: string | null | undefined
): WaiverStatus {
  const [loading, setLoading] = useState(true);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    // Nothing to check
    if (!dojoId || !uid) {
      setLoading(false);
      setSigned(false);
      return;
    }

    const db = dbNullable;
    if (!db) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Check waiverSubmissions (visitor flow writes here)
        const q1 = query(
          collection(db, "dojos", dojoId, "waiverSubmissions"),
          where("authUid", "==", uid),
          limit(1)
        );
        const snap1 = await getDocs(q1);

        if (!cancelled && !snap1.empty) {
          setSigned(true);
          setLoading(false);
          return;
        }

        // Also check waivers collection (in case of alternate write path)
        const q2 = query(
          collection(db, "dojos", dojoId, "waivers"),
          where("uid", "==", uid),
          limit(1)
        );
        const snap2 = await getDocs(q2);

        if (!cancelled) {
          setSigned(!snap2.empty);
        }
      } catch (e) {
        console.warn("[useWaiverStatus] failed to check waiver status:", e);
        // On error, don't block the user — assume unsigned so banner shows
        if (!cancelled) setSigned(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dojoId, uid]);

  return { loading, signed };
}