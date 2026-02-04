// lib/memberUtils.ts
// メンバー管理のユーティリティ関数

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
  Firestore,
} from "firebase/firestore";

/**
 * ユーザーを道場のメンバーとして登録する
 * - 既に登録済みの場合は何もしない
 * - 生徒の場合は status: "active" で登録（承認不要）
 * - スタッフの場合は status: "approved" で登録
 */
export async function ensureMemberRegistration(
  db: Firestore,
  params: {
    dojoId: string;
    userId: string;
    displayName?: string;
    email?: string;
    roleInDojo?: string; // "student" | "coach" | "staff" | "owner"
    beltRank?: string;
    stripes?: number;
    isKids?: boolean;
    requireApproval?: boolean; // trueの場合はpendingステータスで登録
  }
): Promise<{ created: boolean; memberId: string }> {
  const {
    dojoId,
    userId,
    displayName,
    email,
    roleInDojo = "student",
    beltRank = "white",
    stripes = 0,
    isKids = false,
    requireApproval = false,
  } = params;

  const memberRef = doc(db, "dojos", dojoId, "members", userId);
  const memberSnap = await getDoc(memberRef);

  if (memberSnap.exists()) {
    // 既に登録済み
    return { created: false, memberId: userId };
  }

  // 新規登録
  const now = serverTimestamp();
  const status = requireApproval ? "pending" : "active";

  await setDoc(memberRef, {
    uid: userId,
    dojoId,
    displayName: displayName || email || userId.substring(0, 8),
    email: email || null,
    roleInDojo,
    role: roleInDojo,
    status,
    beltRank,
    stripes,
    isKids,
    createdAt: now,
    updatedAt: now,
    ...(status === "active" ? { approvedAt: now } : {}),
  });

  return { created: true, memberId: userId };
}

/**
 * ユーザードキュメントから情報を取得してメンバー登録する
 */
export async function registerUserAsMember(
  db: Firestore,
  dojoId: string,
  userId: string,
  options?: {
    roleInDojo?: string;
    requireApproval?: boolean;
  }
): Promise<{ created: boolean; memberId: string }> {
  // ユーザー情報を取得
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  let displayName = "";
  let email = "";
  let beltRank = "white";
  let isKids = false;

  if (userSnap.exists()) {
    const userData = userSnap.data();
    displayName = userData.displayName || userData.studentProfile?.fullName || "";
    email = userData.email || "";
    beltRank = userData.studentProfile?.belt || userData.beltRank || "white";
    // 年齢から判定（もし dateOfBirth があれば）
    if (userData.dateOfBirth) {
      const birthDate = new Date(userData.dateOfBirth);
      const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      isKids = age < 16;
    }
  }

  return ensureMemberRegistration(db, {
    dojoId,
    userId,
    displayName,
    email,
    roleInDojo: options?.roleInDojo || "student",
    beltRank,
    isKids,
    requireApproval: options?.requireApproval,
  });
}

/**
 * 道場に紐づく全ユーザーをmembersコレクションに同期する
 * （既存データの移行用）
 */
export async function syncDojoMembers(
  db: Firestore,
  dojoId: string
): Promise<{ added: number; skipped: number; errors: string[] }> {
  const result = { added: 0, skipped: 0, errors: [] as string[] };

  try {
    // 全ユーザーを取得
    const usersRef = collection(db, "users");
    const usersSnap = await getDocs(usersRef);

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;

      // このdojoに紐づいているか確認
      const userDojoId =
        userData.dojoId ||
        userData.staffProfile?.dojoId ||
        userData.studentProfile?.dojoId;

      if (userDojoId !== dojoId) continue;

      try {
        // roleを判定
        let roleInDojo = "student";
        if (userData.staffProfile?.dojoId === dojoId) {
          roleInDojo = userData.staffProfile?.roleInDojo || "staff";
        }

        const { created } = await registerUserAsMember(db, dojoId, userId, {
          roleInDojo,
          requireApproval: false,
        });

        if (created) {
          result.added++;
        } else {
          result.skipped++;
        }
      } catch (e: any) {
        result.errors.push(`${userId}: ${e?.message || "unknown error"}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`Global error: ${e?.message || "unknown"}`);
  }

  return result;
}

/**
 * メンバーのステータスを更新
 */
export async function updateMemberStatus(
  db: Firestore,
  dojoId: string,
  memberId: string,
  status: "active" | "pending" | "frozen" | "inactive" | "rejected"
): Promise<void> {
  const memberRef = doc(db, "dojos", dojoId, "members", memberId);
  const updates: any = {
    status,
    updatedAt: serverTimestamp(),
  };

  if (status === "active") {
    updates.approvedAt = serverTimestamp();
  }

  await updateDoc(memberRef, updates);
}