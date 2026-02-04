// lib/auth/google.ts
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { authNullable, dbNullable } from "@/firebase";

const googleProvider = new GoogleAuthProvider();

// Add scopes if needed
googleProvider.addScope("email");
googleProvider.addScope("profile");

// Force account selection every time
googleProvider.setCustomParameters({
  prompt: "select_account",
});

export type GoogleSignInResult = {
  success: boolean;
  user?: User;
  isNewUser?: boolean;
  needsRoleSelection?: boolean;
  error?: string;
};

/**
 * Sign in with Google using popup
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  if (!authNullable) {
    return { success: false, error: "Auth is not initialized" };
  }

  try {
    const result = await signInWithPopup(authNullable, googleProvider);
    const user = result.user;

    // Check if user document exists
    const { isNewUser, needsRoleSelection } = await checkOrCreateUserDoc(user);

    return {
      success: true,
      user,
      isNewUser,
      needsRoleSelection,
    };
  } catch (error: any) {
    console.error("[Google Auth] Popup error:", error);

    // Handle specific errors
    if (error.code === "auth/popup-closed-by-user") {
      return { success: false, error: "Sign in cancelled" };
    }
    if (error.code === "auth/popup-blocked") {
      // Try redirect instead
      return signInWithGoogleRedirect();
    }

    return {
      success: false,
      error: error.message || "Google sign in failed",
    };
  }
}

/**
 * Sign in with Google using redirect (for browsers that block popups)
 */
export async function signInWithGoogleRedirect(): Promise<GoogleSignInResult> {
  if (!authNullable) {
    return { success: false, error: "Auth is not initialized" };
  }

  try {
    await signInWithRedirect(authNullable, googleProvider);
    // This won't return - page will redirect
    return { success: true };
  } catch (error: any) {
    console.error("[Google Auth] Redirect error:", error);
    return {
      success: false,
      error: error.message || "Google sign in failed",
    };
  }
}

/**
 * Handle redirect result (call this on page load)
 */
export async function handleGoogleRedirectResult(): Promise<GoogleSignInResult | null> {
  if (!authNullable) {
    return null;
  }

  try {
    const result = await getRedirectResult(authNullable);

    if (!result) {
      return null; // No redirect result
    }

    const user = result.user;
    const { isNewUser, needsRoleSelection } = await checkOrCreateUserDoc(user);

    return {
      success: true,
      user,
      isNewUser,
      needsRoleSelection,
    };
  } catch (error: any) {
    console.error("[Google Auth] Redirect result error:", error);
    return {
      success: false,
      error: error.message || "Failed to complete sign in",
    };
  }
}

/**
 * Check if user exists in Firestore, create basic doc if not
 */
async function checkOrCreateUserDoc(user: User): Promise<{
  isNewUser: boolean;
  needsRoleSelection: boolean;
}> {
  if (!dbNullable) {
    return { isNewUser: false, needsRoleSelection: false };
  }

  const userRef = doc(dbNullable, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data = userSnap.data();

    // Update last login
    await setDoc(
      userRef,
      {
        lastLoginAt: serverTimestamp(),
        // Update email if changed
        email: user.email,
        emailLower: user.email?.toLowerCase(),
      },
      { merge: true }
    );

    // Check if role is set
    const hasRole = data.role || data.roleUi;
    return {
      isNewUser: false,
      needsRoleSelection: !hasRole,
    };
  }

  // New user - create basic document
  await setDoc(userRef, {
    uid: user.uid,
    email: user.email,
    emailLower: user.email?.toLowerCase(),
    displayName: user.displayName,
    displayNameLower: user.displayName?.toLowerCase(),
    photoURL: user.photoURL,
    authProvider: "google",
    emailVerified: user.emailVerified,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });

  return {
    isNewUser: true,
    needsRoleSelection: true,
  };
}

/**
 * Complete Google sign up with role selection
 */
export async function completeGoogleSignUp(
  uid: string,
  role: "student" | "staff",
  additionalData?: {
    dojoId?: string;
    dojoName?: string;
    fullName?: string;
    phone?: string;
    belt?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!dbNullable) {
    return { success: false, error: "Firestore is not initialized" };
  }

  try {
    const userRef = doc(dbNullable, "users", uid);
    const storedRole = role === "staff" ? "staff_member" : "student";

    const updateData: any = {
      role: storedRole,
      roles: [storedRole],
      accountType: storedRole,
      roleUi: role,
      updatedAt: serverTimestamp(),
    };

    if (role === "student" && additionalData) {
      updateData.dojoId = additionalData.dojoId || null;
      updateData.dojoName = additionalData.dojoName || null;
      updateData.studentProfile = {
        fullName: additionalData.fullName,
        phone: additionalData.phone || null,
        belt: additionalData.belt || "white",
        dojoId: additionalData.dojoId || null,
        dojoName: additionalData.dojoName || null,
        updatedAt: serverTimestamp(),
      };
    }

    if (role === "staff" && additionalData) {
      updateData.staffProfile = {
        dojoId: additionalData.dojoId || null,
        dojoName: additionalData.dojoName || null,
        updatedAt: serverTimestamp(),
      };
    }

    await setDoc(userRef, updateData, { merge: true });

    return { success: true };
  } catch (error: any) {
    console.error("[Google Auth] Complete signup error:", error);
    return {
      success: false,
      error: error.message || "Failed to complete sign up",
    };
  }
}