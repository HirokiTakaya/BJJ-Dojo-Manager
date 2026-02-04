/**
 * Signup flow management hook
 * ファイル: /hooks/useSignupFlow.ts
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authNullable, dbNullable, waitForUser, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type SignupRole = "student" | "instructor" | "dojo-owner";

export interface SignupFlowState {
  step: number;
  role: SignupRole;
  profileComplete: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
}

export interface UseSignupFlowOptions {
  role: SignupRole;
  nextUrl?: string;
  onComplete?: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const SIGNUP_STATE_KEY = "signupFlowState";
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// ─────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatFirebaseError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "permission-denied":
        return "Permission denied. Please contact support.";
      case "unavailable":
        return "Service temporarily unavailable. Please try again.";
      case "network-request-failed":
        return "Network error. Please check your connection.";
      case "unauthenticated":
        return "Please sign in to continue.";
      default:
        return e.message;
    }
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "An unexpected error occurred.";
}

// ─────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────
export function useSignupFlow(options: UseSignupFlowOptions) {
  const router = useRouter();
  const { role, nextUrl = "/home", onComplete } = options;

  const [state, setState] = useState<SignupFlowState>({
    step: 1,
    role,
    profileComplete: false,
    emailVerified: false,
    mfaEnabled: false,
    error: null,
    isLoading: true,
    isSaving: false,
  });

  const [isOnline, setIsOnline] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  // ─────────────────────────────────────────────
  // Online/Offline detection
  // ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  // ─────────────────────────────────────────────
  // Load saved state from sessionStorage
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = sessionStorage.getItem(SIGNUP_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SignupFlowState>;
        setState((prev) => ({
          ...prev,
          ...parsed,
          role: parsed.role || prev.role,
          isLoading: false,
        }));
        return;
      }
    } catch {
      // Ignore parse errors
    }

    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  // ─────────────────────────────────────────────
  // Save state to sessionStorage
  // ─────────────────────────────────────────────
  const saveState = useCallback((newState: Partial<SignupFlowState>) => {
    setState((prev) => {
      const updated = { ...prev, ...newState };
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(SIGNUP_STATE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore storage errors
        }
      }
      return updated;
    });
  }, []);

  // ─────────────────────────────────────────────
  // Clear state
  // ─────────────────────────────────────────────
  const clearState = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SIGNUP_STATE_KEY);
    }
    setState({
      step: 1,
      role,
      profileComplete: false,
      emailVerified: false,
      mfaEnabled: false,
      error: null,
      isLoading: false,
      isSaving: false,
    });
  }, [role]);

  // ─────────────────────────────────────────────
  // Set error
  // ─────────────────────────────────────────────
  const setError = useCallback((error: string | null) => {
    saveState({ error });
  }, [saveState]);

  // ─────────────────────────────────────────────
  // Go to next step
  // ─────────────────────────────────────────────
  const nextStep = useCallback(() => {
    saveState({ step: state.step + 1, error: null });
  }, [state.step, saveState]);

  // ─────────────────────────────────────────────
  // Go to previous step
  // ─────────────────────────────────────────────
  const prevStep = useCallback(() => {
    if (state.step > 1) {
      saveState({ step: state.step - 1, error: null });
    }
  }, [state.step, saveState]);

  // ─────────────────────────────────────────────
  // Save profile to Firestore with retry
  // ─────────────────────────────────────────────
  const saveProfile = useCallback(
    async <T extends Record<string, unknown>>(
      profileData: T,
      profileKey: string,
      attempt = 1
    ): Promise<boolean> => {
      if (!firebaseEnabled) {
        throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      }

      if (!dbNullable) {
        throw new Error("Database not available.");
      }

      if (!isOnline) {
        throw new Error("No internet connection. Please check your network.");
      }

      const user = authNullable?.currentUser ?? (await waitForUser(8000));
      if (!user) {
        throw new Error("Please sign in to continue.");
      }

      saveState({ isSaving: true, error: null });
      setRetryCount(attempt);

      try {
        const userRef = doc(dbNullable, "users", user.uid);
        const existingDoc = await getDoc(userRef);
        const existingData = existingDoc.data();

        await setDoc(
          userRef,
          {
            role,
            roles: [role],
            accountType: role,
            roleUi: role,
            [profileKey]: {
              ...profileData,
              updatedAt: serverTimestamp(),
              ...(existingData?.[profileKey]?.createdAt
                ? {}
                : { createdAt: serverTimestamp() }),
            },
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            ...(existingData?.createdAt ? {} : { createdAt: serverTimestamp() }),
          },
          { merge: true }
        );

        saveState({ profileComplete: true, isSaving: false });
        setRetryCount(0);
        return true;
      } catch (e) {
        if (attempt < MAX_RETRY_ATTEMPTS && e instanceof FirebaseError) {
          if (e.code === "unavailable" || e.code === "network-request-failed") {
            await sleep(RETRY_DELAY_MS * attempt);
            return saveProfile(profileData, profileKey, attempt + 1);
          }
        }

        saveState({ isSaving: false, error: formatFirebaseError(e) });
        setRetryCount(0);
        throw e;
      }
    },
    [role, isOnline, saveState]
  );

  // ─────────────────────────────────────────────
  // Check if user exists and load their status
  // ─────────────────────────────────────────────
  const checkUserStatus = useCallback(async (): Promise<{
    exists: boolean;
    emailVerified: boolean;
    profileComplete: boolean;
    mfaEnabled: boolean;
  }> => {
    if (!firebaseEnabled || !dbNullable) {
      return {
        exists: false,
        emailVerified: false,
        profileComplete: false,
        mfaEnabled: false,
      };
    }

    const user = authNullable?.currentUser ?? (await waitForUser(5000));
    if (!user) {
      return {
        exists: false,
        emailVerified: false,
        profileComplete: false,
        mfaEnabled: false,
      };
    }

    await user.reload();

    try {
      const userRef = doc(dbNullable, "users", user.uid);
      const snap = await getDoc(userRef);
      const data = snap.data();

      const profileKey = role === "student" ? "studentProfile" : "profile";
      const hasProfile = !!(data?.[profileKey]?.fullName);

      return {
        exists: snap.exists(),
        emailVerified: user.emailVerified,
        profileComplete: hasProfile,
        mfaEnabled: (data?.mfaEnabled as boolean) || false,
      };
    } catch {
      return {
        exists: false,
        emailVerified: user.emailVerified,
        profileComplete: false,
        mfaEnabled: false,
      };
    }
  }, [role]);

  // ─────────────────────────────────────────────
  // Complete signup and redirect
  // ─────────────────────────────────────────────
  const completeSignup = useCallback(() => {
    clearState();
    onComplete?.();
    router.replace(nextUrl);
  }, [clearState, onComplete, router, nextUrl]);

  // ─────────────────────────────────────────────
  // Redirect to login with return URL
  // ─────────────────────────────────────────────
  const goToLogin = useCallback(
    (returnUrl: string) => {
      const qs = new URLSearchParams();
      qs.set("next", returnUrl);
      qs.set("role", role);
      router.push(`/login?${qs.toString()}`);
    },
    [role, router]
  );

  return {
    // State
    ...state,
    isOnline,
    retryCount,

    // Actions
    saveState,
    clearState,
    setError,
    nextStep,
    prevStep,
    saveProfile,
    checkUserStatus,
    completeSignup,
    goToLogin,
  };
}

export default useSignupFlow;