// src/lib/auth/google-auth.ts
import { authNullable } from "@/firebase";
import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  signInWithPopup,
  type UserCredential,
} from "firebase/auth";

export async function signInWithGooglePopup(): Promise<UserCredential> {
  if (!authNullable) throw new Error("Auth is not ready.");

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  return await signInWithPopup(authNullable, provider);
}

export function formatGoogleAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "auth/popup-closed-by-user":
        return "Google sign-in was cancelled.";
      case "auth/cancelled-popup-request":
        return "Another popup is already open.";
      case "auth/popup-blocked":
        return "Popup was blocked. Please allow popups and try again.";
      case "auth/account-exists-with-different-credential":
        return "This email already exists with a different sign-in method. Please log in with that method first, then link Google.";
      case "auth/operation-not-allowed":
        return "Google sign-in is not enabled in Firebase Console.";
      default:
        return `Google sign-in failed: ${e.code}`;
    }
  }
  if (e instanceof Error) return e.message;
  return "Google sign-in failed.";
}
