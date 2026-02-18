// lib/usePendingDojoAction.ts
"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/firebase";
import { completePendingDojoAction, type PendingDojoAction } from "@/lib/completePendingDojoAction";

/**
 * ダッシュボード等で使うフック。
 * users/{uid}.pendingDojoAction が存在すれば自動実行する。
 *
 * これにより /verify/success で失敗した場合のリカバリーが可能。
 *
 * 使い方:
 * ```tsx
 * const { pending, executing, result, error } = usePendingDojoAction();
 * if (executing) return <div>Setting up your dojo...</div>;
 * if (error) return <div>Setup failed: {error}</div>;
 * ```
 */
export function usePendingDojoAction() {
  const [pending, setPending] = useState<PendingDojoAction | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Firestore でリアルタイム監視
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data?.pendingDojoAction && typeof data.pendingDojoAction === "object" && data.pendingDojoAction.type) {
        setPending(data.pendingDojoAction as PendingDojoAction);
      } else {
        setPending(null);
      }
    });

    return () => unsub();
  }, []);

  // pendingDojoAction が検出されたら自動実行
  useEffect(() => {
    if (!pending || executing || result) return;

    const user = auth.currentUser;
    if (!user) return;

    setExecuting(true);
    setError(null);

    completePendingDojoAction(db, user.uid, user.displayName || null)
      .then((res) => {
        setResult(res);
        setPending(null);
        console.log("[usePendingDojoAction] Completed:", res);
      })
      .catch((err) => {
        console.error("[usePendingDojoAction] Failed:", err);
        setError(err?.message || "Failed to complete setup.");
      })
      .finally(() => {
        setExecuting(false);
      });
  }, [pending, executing, result]);

  return { pending, executing, result, error };
}