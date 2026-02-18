"use client";

/**
 * 堅牢なサインアップロジック
 * 
 * 改善点:
 * 1. 必須フィールドの検証を厳格化
 * 2. Auth + Firestore を可能な限りアトミックに
 * 3. 失敗時の確実なロールバック
 * 4. リトライロジック
 * 5. 詳細なエラーログ
 */

import { 
  createUserWithEmailAndPassword, 
  updateProfile, 
  sendEmailVerification,
  deleteUser,
  signOut,
  type User,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "@/firebase";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type SignupRole = "student" | "staff_member";

export interface BaseSignupData {
  email: string;
  password: string;
  displayName: string;
  role: SignupRole;
}

export interface StudentSignupData extends BaseSignupData {
  role: "student";
  studentProfile: {
    fullName: string;
    phone?: string;
    belt?: string;
    dojoName?: string;
    dojoId?: string | null;
  };
}

export interface StaffSignupData extends BaseSignupData {
  role: "staff_member";
  dojoId?: string;
  staffProfile: {
    dojoId?: string;
    dojoName?: string;
    country?: string;
    city?: string;
    website?: string | null;
    phone?: string | null;
  };
}

export type SignupData = StudentSignupData | StaffSignupData;

export interface SignupResult {
  success: boolean;
  uid?: string;
  error?: string;
  errorCode?: string;
  needsEmailVerification?: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatError(e: unknown): { message: string; code: string } {
  if (e instanceof FirebaseError) {
    const code = e.code;
    let message: string;

    switch (code) {
      case "auth/email-already-in-use":
        message = "このメールアドレスは既に登録されています。";
        break;
      case "auth/invalid-email":
        message = "メールアドレスの形式が正しくありません。";
        break;
      case "auth/weak-password":
        message = "パスワードが弱すぎます（6文字以上必要）。";
        break;
      case "auth/operation-not-allowed":
        message = "Email/Password認証が無効です。";
        break;
      case "auth/network-request-failed":
        message = "ネットワークエラーです。";
        break;
      case "permission-denied":
        message = "データベースへの書き込み権限がありません。";
        break;
      case "unavailable":
        message = "サービスが一時的に利用できません。";
        break;
      default:
        message = e.message;
    }

    return { message, code };
  }

  if (e instanceof Error) {
    return { message: e.message, code: "unknown" };
  }

  return { message: "予期しないエラーが発生しました。", code: "unknown" };
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────
function validateSignupData(data: SignupData): string | null {
  // Email validation
  if (!data.email || !data.email.includes("@")) {
    return "有効なメールアドレスを入力してください。";
  }

  // Password validation
  if (!data.password || data.password.length < 6) {
    return "パスワードは6文字以上必要です。";
  }

  // Display name validation
  if (!data.displayName || data.displayName.trim().length < 1) {
    return "名前を入力してください。";
  }

  // Role validation
  if (!["student", "staff_member"].includes(data.role)) {
    return "無効なロールです。";
  }

  // Role-specific validation
  if (data.role === "student") {
    if (!data.studentProfile?.fullName) {
      return "生徒プロフィールの名前が必要です。";
    }
  }

  return null; // Valid
}

// ─────────────────────────────────────────────
// Build user document
// ─────────────────────────────────────────────
function buildUserDocument(user: User, data: SignupData): Record<string, unknown> {
  const email = user.email ?? data.email;
  const emailLower = email.toLowerCase();
  const displayName = data.displayName.trim();
  const displayNameLower = displayName.toLowerCase();

  const baseDoc = {
    // Identity
    uid: user.uid,
    email,
    emailLower,
    displayName,
    displayNameLower,

    // ★ 必須フィールド（これがないとログイン後に問題発生）
    role: data.role,
    roles: [data.role],
    accountType: data.role,
    roleUi: data.role === "staff_member" ? "staff" : data.role,

    // Status
    emailVerified: user.emailVerified,
    onboardingComplete: false,

    // Timestamps
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };

  // Role-specific fields
  if (data.role === "student") {
    return {
      ...baseDoc,
      studentProfile: {
        fullName: data.studentProfile.fullName,
        email: emailLower,
        phone: data.studentProfile.phone || null,
        belt: data.studentProfile.belt || "white",
        dojoName: data.studentProfile.dojoName || null,
        dojoId: data.studentProfile.dojoId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
  }

  if (data.role === "staff_member") {
    return {
      ...baseDoc,
      dojoId: data.dojoId || null,
      staffProfile: {
        dojoId: data.staffProfile.dojoId || null,
        dojoName: data.staffProfile.dojoName || null,
        country: data.staffProfile.country || null,
        city: data.staffProfile.city || null,
        website: data.staffProfile.website || null,
        phone: data.staffProfile.phone || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
  }

  return baseDoc;
}

// ─────────────────────────────────────────────
// Verify document was written correctly
// ─────────────────────────────────────────────
async function verifyUserDocument(uid: string): Promise<boolean> {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      console.error("[Signup] User document does not exist after write");
      return false;
    }

    const data = snap.data();

    // Check required fields
    const requiredFields = ["role", "roles", "accountType", "roleUi", "email"];
    for (const field of requiredFields) {
      if (!data[field]) {
        console.error(`[Signup] Missing required field: ${field}`);
        return false;
      }
    }

    // Verify roles is an array
    if (!Array.isArray(data.roles)) {
      console.error("[Signup] roles is not an array");
      return false;
    }

    console.log("[Signup] User document verified successfully");
    return true;
  } catch (e) {
    console.error("[Signup] Failed to verify user document:", e);
    return false;
  }
}

// ─────────────────────────────────────────────
// Write user document with retry
// ─────────────────────────────────────────────
async function writeUserDocumentWithRetry(
  user: User,
  data: SignupData,
  attempt: number = 1
): Promise<boolean> {
  const userRef = doc(db, "users", user.uid);
  const userDoc = buildUserDocument(user, data);

  console.log(`[Signup] Writing user document (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);

  try {
    await setDoc(userRef, userDoc, { merge: true });

    // Verify the write
    const verified = await verifyUserDocument(user.uid);
    if (!verified) {
      throw new Error("Document verification failed");
    }

    return true;
  } catch (e) {
    console.error(`[Signup] Write attempt ${attempt} failed:`, e);

    if (attempt < MAX_RETRY_ATTEMPTS) {
      console.log(`[Signup] Retrying in ${RETRY_DELAY_MS * attempt}ms...`);
      await sleep(RETRY_DELAY_MS * attempt);
      return writeUserDocumentWithRetry(user, data, attempt + 1);
    }

    throw e;
  }
}

// ─────────────────────────────────────────────
// Rollback Auth user
// ─────────────────────────────────────────────
async function rollbackAuthUser(user: User): Promise<void> {
  console.log("[Signup] Rolling back Auth user...");

  try {
    await deleteUser(user);
    console.log("[Signup] Auth user deleted successfully");
  } catch (e) {
    console.error("[Signup] Failed to delete Auth user:", e);

    // Try signing out at least
    try {
      await signOut(auth);
    } catch {
      // Ignore
    }
  }
}

// ─────────────────────────────────────────────
// Main signup function
// ─────────────────────────────────────────────
export async function performSignup(data: SignupData): Promise<SignupResult> {
  console.log("[Signup] Starting signup process...");
  console.log("[Signup] Role:", data.role);
  console.log("[Signup] Email:", data.email);

  // 1. Validate input
  const validationError = validateSignupData(data);
  if (validationError) {
    console.error("[Signup] Validation failed:", validationError);
    return {
      success: false,
      error: validationError,
      errorCode: "validation_error",
    };
  }

  let createdUser: User | null = null;

  try {
    // 2. Create Auth user
    console.log("[Signup] Creating Auth user...");
    const email = data.email.trim().toLowerCase();
    const cred = await createUserWithEmailAndPassword(auth, email, data.password);
    createdUser = cred.user;
    console.log("[Signup] Auth user created:", createdUser.uid);

    // 3. Update display name
    console.log("[Signup] Updating display name...");
    await updateProfile(createdUser, { 
      displayName: data.displayName.trim() 
    }).catch((e) => {
      console.warn("[Signup] Failed to update display name:", e);
    });

    // 4. Write Firestore document with retry
    console.log("[Signup] Writing Firestore document...");
    const writeSuccess = await writeUserDocumentWithRetry(createdUser, data);

    if (!writeSuccess) {
      throw new Error("Failed to write user document after retries");
    }

    // 5. Send verification email
    console.log("[Signup] Sending verification email...");
    // await sendEmailVerification(createdUser).catch((e) => {
      console.warn("[Signup] Failed to send verification email:", e);
    });

    // 6. Success!
    console.log("[Signup] Signup completed successfully!");
    return {
      success: true,
      uid: createdUser.uid,
      needsEmailVerification: true,
    };

  } catch (e) {
    console.error("[Signup] Signup failed:", e);

    const { message, code } = formatError(e);

    // Rollback if Firestore failed but Auth succeeded
    const isAuthError = e instanceof FirebaseError && e.code?.startsWith("auth/");
    if (!isAuthError && createdUser) {
      await rollbackAuthUser(createdUser);
    }

    return {
      success: false,
      error: message,
      errorCode: code,
    };
  }
}

// ─────────────────────────────────────────────
// Convenience functions
// ─────────────────────────────────────────────
export async function signupAsStudent(params: {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  belt?: string;
  dojoName?: string;
  dojoId?: string | null;
}): Promise<SignupResult> {
  return performSignup({
    email: params.email,
    password: params.password,
    displayName: params.fullName,
    role: "student",
    studentProfile: {
      fullName: params.fullName,
      phone: params.phone,
      belt: params.belt,
      dojoName: params.dojoName,
      dojoId: params.dojoId,
    },
  });
}

export async function signupAsStaff(params: {
  email: string;
  password: string;
  displayName: string;
  dojoId?: string;
  dojoName?: string;
  country?: string;
  city?: string;
  website?: string | null;
  phone?: string | null;
}): Promise<SignupResult> {
  return performSignup({
    email: params.email,
    password: params.password,
    displayName: params.displayName,
    role: "staff_member",
    dojoId: params.dojoId,
    staffProfile: {
      dojoId: params.dojoId,
      dojoName: params.dojoName,
      country: params.country,
      city: params.city,
      website: params.website,
      phone: params.phone,
    },
  });
}