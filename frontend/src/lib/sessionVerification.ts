// lib/sessionVerification.ts
//
// 毎回ログイン時にメール認証リンクのクリックを要求する仕組み。
//
// フロー:
//   1. ログイン成功（Email/Password or Google）
//   2. invalidateSession() → users/{uid}.sessionVerified = false に設定
//   3. /verify ページで sendSignInLinkToEmail() → 認証メール送信
//   4. ユーザーがリンクをクリック → /verify に戻る
//   5. checkActionCode() で検証 → markSessionVerified()
//   6. /verify/success → /home

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";

/**
 * ログイン直後に呼ぶ。sessionVerified を false にリセットする。
 * メール送信は /verify ページで行う（sendSignInLinkToEmail 方式）。
 */
export async function invalidateSessionAndSendEmail(
  db: Firestore,
  user: User
): Promise<void> {
  const userRef = doc(db, "users", user.uid);

  await setDoc(
    userRef,
    {
      sessionVerified: false,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * /verify ページでメール認証が確認できた後に呼ぶ。
 * sessionVerified = true にする。
 */
export async function markSessionVerified(
  db: Firestore,
  uid: string
): Promise<void> {
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      sessionVerified: true,
      sessionVerifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * 現在のセッションが認証済みかチェック。
 * 保護ページで使う。
 */
export async function isSessionVerified(
  db: Firestore,
  uid: string
): Promise<boolean> {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;
  return snap.data()?.sessionVerified === true;
}