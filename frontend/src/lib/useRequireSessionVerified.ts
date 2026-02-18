// lib/useRequireSessionVerified.ts
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/firebase";

/**
 * 保護ページ（/home 等）で使うフック。
 *
 * - ログインしていない → /login へ
 * - ログイン済みだが sessionVerified !== true → /verify へ
 * - sessionVerified === true → user を返す
 *
 * 使い方:
 * ```tsx
 * const { user, loading } = useRequireSessionVerified();
 * if (loading) return <Spinner />;
 * // ここに到達 = セッション認証済み
 * ```
 */
export function useRequireSessionVerified() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      // 前のリスナーをクリーンアップ
      if (unsubFirestore) {
        unsubFirestore();
        unsubFirestore = null;
      }

      if (!u) {
        router.replace("/login");
        setLoading(false);
        return;
      }

      // Firestore の sessionVerified をリアルタイム監視
      const userRef = doc(db, "users", u.uid);
      unsubFirestore = onSnapshot(
        userRef,
        (snap) => {
          if (!snap.exists()) {
            router.replace("/verify");
            setLoading(false);
            return;
          }

          const data = snap.data();
          if (data?.sessionVerified !== true) {
            router.replace("/verify");
            setLoading(false);
            return;
          }

          // ✅ セッション認証済み
          setUser(u);
          setLoading(false);
        },
        (err) => {
          console.error("[useRequireSessionVerified] Firestore error:", err);
          // エラー時は安全側に倒す
          router.replace("/verify");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubFirestore) unsubFirestore();
    };
  }, [router]);

  return { user, loading };
}