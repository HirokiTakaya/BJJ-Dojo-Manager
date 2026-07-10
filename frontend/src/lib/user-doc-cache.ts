// In-memory session cache for the signed-in user's users/{uid} document.
//
// Almost every page fetches users/{uid} on mount just to resolve the role
// (staff/student) before rendering, which made each navigation pay a
// Firestore round-trip. This mirrors the proven useDojoName pattern:
// shared cache + inflight dedup, plus a short TTL so role/status changes
// still propagate quickly without a reload.
//
// The returned object mimics the DocumentSnapshot surface that call sites
// already use (.exists() / .data()), so adopting it is a one-line change.

import { doc, getDoc, type DocumentData } from "firebase/firestore";
import { db } from "@/firebase";

export type CachedUserSnap = {
  exists: () => boolean;
  data: () => DocumentData | undefined;
};

const TTL_MS = 2 * 60 * 1000; // 2 minutes: kills per-navigation refetch bursts,
                              // while approvals/role changes self-heal fast.

const cache = new Map<string, { snap: CachedUserSnap; at: number }>();
const inflight = new Map<string, Promise<CachedUserSnap>>();

export async function getCachedUserDoc(
  uid: string,
  opts?: { force?: boolean }
): Promise<CachedUserSnap> {
  const hit = cache.get(uid);
  if (!opts?.force && hit && Date.now() - hit.at < TTL_MS) return hit.snap;

  const running = inflight.get(uid);
  if (!opts?.force && running) return running;

  const p = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const data = snap.exists() ? (snap.data() as DocumentData) : undefined;
      const wrapped: CachedUserSnap = {
        exists: () => data !== undefined,
        data: () => data,
      };
      cache.set(uid, { snap: wrapped, at: Date.now() });
      return wrapped;
    } finally {
      inflight.delete(uid);
    }
  })();

  inflight.set(uid, p);
  return p;
}

/** Call after writing users/{uid} (profile save, signup) or on sign-out. */
export function invalidateUserDoc(uid?: string) {
  if (uid) {
    cache.delete(uid);
    inflight.delete(uid);
  } else {
    cache.clear();
    inflight.clear();
  }
}