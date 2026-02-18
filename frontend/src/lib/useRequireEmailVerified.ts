// lib/useRequireEmailVerified.ts
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

/**
 * 全ての認証済みページで使う共通フック。
 *
 * - ログインしていない → /login へリダイレクト
 * - ログイン済みだが emailVerified === false → /verify へリダイレクト
 * - ログイン済み + emailVerified === true → user を返す
 *
 * 使い方:
 * ```ts
 * const { user, loading } = useRequireEmailVerified();
 * if (loading) return <Spinner />;
 * // ここに到達 = email verified 済みのユーザー
 * ```
 */
export function useRequireEmailVerified(options?: {
  /** リダイレクト先を変えたい場合（デフォルト: "/login"） */
  loginPath?: string;
  /** verify リダイレクト先を変えたい場合（デフォルト: "/verify"） */
  verifyPath?: string;
}) {
  const router = useRouter();
  const loginPath = options?.loginPath ?? "/login";
  const verifyPath = options?.verifyPath ?? "/verify";

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // 未ログイン → ログインページへ
        router.replace(loginPath);
        setLoading(false);
        return;
      }

      // reload して最新の emailVerified を取得
      try {
        await u.reload();
      } catch {
        // オフラインなどでは無視
      }

      const current = auth.currentUser;
      if (!current) {
        router.replace(loginPath);
        setLoading(false);
        return;
      }

      if (!current.emailVerified) {
        // メール未認証 → verify ページへ
        router.replace(verifyPath);
        setLoading(false);
        return;
      }

      // ✅ メール認証済み
      setUser(current);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router, loginPath, verifyPath]);

  return { user, loading };
}