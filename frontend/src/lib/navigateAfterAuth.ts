// lib/navigateAfterAuth.ts
//
// ログイン成功後に呼ばれる。
// Go API で emailVerified を false にリセットし、/verify にリダイレクト。
// /verify ページで sendEmailVerification() → ポーリングで emailVerified を監視。

import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { dbNullable } from "@/firebase";
import type { User } from "firebase/auth";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Go API の URL。
 * 環境変数 NEXT_PUBLIC_API_URL から取得。
 */
function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

/**
 * ログイン成功後に呼ぶ。
 *
 * 1. Firestore で sessionVerified = false にリセット
 * 2. Go API で emailVerified = false にリセット
 * 3. /verify にリダイレクト
 *
 * @param user - Firebase Auth のユーザー
 * @param router - Next.js の router
 * @param _next - 旧互換パラメータ（使用しない。常に /verify に飛ばす）
 */
export async function navigateAfterAuth(
  user: User,
  router: AppRouterInstance,
  _next?: string
): Promise<void> {
  console.log("[navigateAfterAuth] Starting for:", user.uid, user.email);

  // 1. Firestore: sessionVerified = false
  if (dbNullable) {
    const userRef = doc(dbNullable, "users", user.uid);
    await setDoc(
      userRef,
      {
        sessionVerified: false,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log("[navigateAfterAuth] sessionVerified set to false");
  } else {
    console.warn("[navigateAfterAuth] db not available, skipping sessionVerified reset");
  }

  // 2. Go API: emailVerified = false にリセット
  const apiUrl = getApiUrl();
  if (apiUrl) {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${apiUrl}/v1/auth/reset-email-verified`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        console.error("[navigateAfterAuth] API error:", res.status, body);
      } else {
        console.log("[navigateAfterAuth] emailVerified reset via API");
        // トークンを強制リフレッシュして emailVerified=false を反映
        await user.getIdToken(true);
      }
    } catch (err) {
      console.error("[navigateAfterAuth] API call failed:", err);
      // API が落ちていても /verify には進む
    }
  } else {
    console.warn("[navigateAfterAuth] NEXT_PUBLIC_API_URL not set, skipping emailVerified reset");
  }

  // 3. /verify にリダイレクト
  router.replace("/verify");
}