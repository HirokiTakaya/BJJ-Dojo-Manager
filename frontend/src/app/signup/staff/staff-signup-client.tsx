// app/signup/staff/page.tsx
"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  fetchSignInMethodsForEmail,
  signOut,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  type UserCredential,
} from "firebase/auth";
import { collection, doc, serverTimestamp, setDoc, getDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";

import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type FormState = {
  dojoName: string;
  country: string;
  city: string;
  website: string;
  phone: string;
  ownerDisplayName: string;

  // Email/Password 用
  email: string;
  password: string;
  password2: string;
};

type Mode = "create" | "select";
type AuthMethod = "google" | "email";

// ─────────────────────────────────────────────────────────────
// Sub-components (統一デザイン)
// ─────────────────────────────────────────────────────────────
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);

const Alert = ({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) => {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
};

const Input = ({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  success,
  required,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  success?: string;
  required?: boolean;
}) => (
  <label className="block space-y-1">
    <span className="text-sm font-semibold text-slate-700">
      {label} {required && <span className="text-rose-500">*</span>}
    </span>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
        error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
      }`}
    />
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
    {success && <p className="text-xs text-emerald-600">✓ {success}</p>}
    {error && <p className="text-xs text-rose-600">{error}</p>}
  </label>
);

const PrimaryBtn = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {children}
  </button>
);

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
      active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`}
  >
    {children}
  </button>
);

const MethodButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
      active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`}
  >
    {children}
  </button>
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function normalizeNameLower(s: string) {
  return s.trim().toLowerCase();
}

function buildKeywords(input: { dojoName: string; city: string; country: string }) {
  const tokens = [input.dojoName, input.city, input.country]
    .map((v) => v.trim())
    .filter(Boolean)
    .flatMap((v) => v.split(/\s+/g))
    .map((v) => v.toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(tokens)).slice(0, 30);
}

function authErrorMessage(e: any) {
  const code = e?.code as string | undefined;
  const msg = e?.message as string | undefined;
  if (!code) return msg || "Signup failed.";

  if (code === "auth/email-already-in-use") return "This email address is already in use.";
  if (code === "auth/invalid-email") return "The email address format is invalid.";
  if (code === "auth/weak-password") return "The password is too weak (at least 6 characters).";
  if (code === "auth/operation-not-allowed")
    return "Auth is disabled (enable Email/Password in the Firebase Console).";
  if (code === "auth/invalid-api-key") return "Invalid Firebase API Key (check .env.local).";
  if (code === "auth/network-request-failed") return "Network error.";

  return msg || `Signup failed: ${code}`;
}

function formatErr(e: unknown) {
  if (e instanceof FirebaseError) {
    if (e.code?.startsWith("auth/")) return authErrorMessage(e);

    if (e.code === "permission-denied")
      return "Firestore permission error (permission-denied). Please check your Rules.";
    if (e.code === "failed-precondition") return "Firestore precondition failed (failed-precondition).";
    if (e.code === "unavailable") return "Firestore is temporarily unavailable (unavailable).";
    return `${e.code}: ${e.message}`;
  }

  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return "Signup failed.";
}

// ─────────────────────────────────────────────
// ✅ Firebase ready wait (getRedirectResult が早すぎて失敗するのを防ぐ)
// ─────────────────────────────────────────────
async function waitForFirebaseReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (authNullable && dbNullable) return { auth: authNullable, db: dbNullable };
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// ─────────────────────────────────────────────
// Google redirect draft (Staff)
// ─────────────────────────────────────────────
const STAFF_GOOGLE_DRAFT_KEY = "staff_google_signup_draft_v1";

type StaffGoogleDraft =
  | {
      mode: "create";
      next: string;
      dojoName: string;
      country: string;
      city: string;
      website: string;
      phone: string;
      ownerDisplayName: string;
    }
  | {
      mode: "select";
      next: string;
      selectedDojo: DojoLite;
      ownerDisplayName: string;
    };

function saveStaffDraft(d: StaffGoogleDraft) {
  sessionStorage.setItem(STAFF_GOOGLE_DRAFT_KEY, JSON.stringify(d));
}

function loadStaffDraft(): StaffGoogleDraft | null {
  const raw = sessionStorage.getItem(STAFF_GOOGLE_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffGoogleDraft;
  } catch {
    return null;
  }
}

function clearStaffDraft() {
  sessionStorage.removeItem(STAFF_GOOGLE_DRAFT_KEY);
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function StaffSignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="text-slate-500">Loading...</div>
        </div>
      }
    >
      <StaffSignupInner />
    </Suspense>
  );
}

function StaffSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";

  const [mode, setMode] = useState<Mode>("create");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("google");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [emailCheckResult, setEmailCheckResult] = useState<"available" | "taken" | "checking" | "">("");

  const [f, setF] = useState<FormState>({
    dojoName: "",
    country: "Canada",
    city: "Vancouver",
    website: "",
    phone: "",
    ownerDisplayName: "",
    email: "",
    password: "",
    password2: "",
  });

  // --- select mode: search state ---
  const [searchTerm, setSearchTerm] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [candidates, setCandidates] = useState<DojoLite[]>([]);
  const [selectedDojo, setSelectedDojo] = useState<DojoLite | null>(null);

  const onChange = (k: keyof FormState) => (value: string) => {
    setF((p) => ({ ...p, [k]: value }));
    setError("");
  };

  // ─────────────────────────────────────────────
  // Email availability check（Email/Password用のときだけ）
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (authMethod !== "email") {
      setEmailCheckResult("");
      return;
    }

    const email = f.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setEmailCheckResult("");
      return;
    }

    setEmailCheckResult("checking");

    const timer = setTimeout(async () => {
      if (!authNullable) {
        setEmailCheckResult("");
        return;
      }

      try {
        const methods = await fetchSignInMethodsForEmail(authNullable, email);
        setEmailCheckResult(methods.length > 0 ? "taken" : "available");
      } catch {
        setEmailCheckResult("");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [f.email, authMethod]);

  // ─────────────────────────────────────────────
  // Search existing dojos (select mode)
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "select") return;

    const t = setTimeout(async () => {
      setSearchErr("");
      setCandidates([]);

      const s = searchTerm.trim();
      if (!s) return;

      if (!dbNullable) {
        setSearchErr("Firestore is not ready.");
        return;
      }

      setSearchBusy(true);
      try {
        const rows = await searchPublicDojosByPrefix(dbNullable!, s, 20);
        setCandidates(rows);
      } catch (e: any) {
        setSearchErr(e?.message || "Search failed.");
      } finally {
        setSearchBusy(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [mode, searchTerm]);

  // ─────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────
  const baseErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!f.ownerDisplayName.trim()) errors.ownerDisplayName = "Please enter your name.";

    if (mode === "create") {
      if (!f.dojoName.trim()) errors.dojoName = "Please enter gym name.";
    } else {
      if (!selectedDojo?.id) errors.selectedDojo = "Please select an existing dojo.";
    }

    return errors;
  }, [f.ownerDisplayName, f.dojoName, mode, selectedDojo]);

  const emailErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (authMethod !== "email") return errors;

    if (!f.email.trim()) errors.email = "Please enter your email address.";
    else if (!f.email.includes("@")) errors.email = "Please enter a valid email address.";
    else if (emailCheckResult === "taken") errors.email = "This email is already registered.";

    if (!f.password) errors.password = "Please enter your password.";
    else if (f.password.length < 6) errors.password = "Password must be at least 6 characters.";

    if (f.password !== f.password2) errors.password2 = "Passwords do not match.";

    return errors;
  }, [authMethod, f.email, f.password, f.password2, emailCheckResult]);

  const canGoogleSubmit = useMemo(() => {
    if (Object.keys(baseErrors).length > 0) return false;
    return true;
  }, [baseErrors]);

  const canEmailSubmit = useMemo(() => {
    const combined = { ...baseErrors, ...emailErrors };
    return Object.keys(combined).length === 0;
  }, [baseErrors, emailErrors]);

  // ─────────────────────────────────────────────
  // ✅ Google redirect: start（A：フォーム入力後に押す）
  // ─────────────────────────────────────────────
  const startGoogleRedirect = async () => {
    if (busy) return;
    if (!canGoogleSubmit) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable) throw new Error("Auth is not ready.");

      if (mode === "select" && !selectedDojo?.id) throw new Error("Please select an existing dojo.");
      if (mode === "create" && !f.dojoName.trim()) throw new Error("Please enter gym name.");
      if (!f.ownerDisplayName.trim()) throw new Error("Please enter your name.");

      if (mode === "create") {
        saveStaffDraft({
          mode: "create",
          next,
          dojoName: f.dojoName.trim(),
          country: f.country.trim(),
          city: f.city.trim(),
          website: f.website.trim(),
          phone: f.phone.trim(),
          ownerDisplayName: f.ownerDisplayName.trim(),
        });
      } else {
        saveStaffDraft({
          mode: "select",
          next,
          selectedDojo: selectedDojo!,
          ownerDisplayName: f.ownerDisplayName.trim(),
        });
      }

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      await signInWithRedirect(authNullable, provider);
    } catch (e) {
      setError(formatGoogleAuthError(e));
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // ✅ Google redirect: handle result on mount（Firebase ready待ち）
  // ─────────────────────────────────────────────
  const redirectHandledRef = useRef(false);

  useEffect(() => {
    if (redirectHandledRef.current) return;
    redirectHandledRef.current = true;

    let cancelled = false;

    const run = async () => {
      try {
        const ready = await waitForFirebaseReady(8000);
        if (cancelled) return;

        if (!ready) {
          // Firebaseがまだ用意できてない場合は、次回リロードで拾えるようにする
          redirectHandledRef.current = false;
          return;
        }

        const { auth, db } = ready;

        const cred: UserCredential | null = await getRedirectResult(auth);
        if (!cred) return;

        const draft = loadStaffDraft();
        if (!draft) {
          setError("Signup data was missing after redirect. Please try again.");
          try {
            await signOut(auth);
          } catch {}
          return;
        }

        setBusy(true);
        setError("");
        setSuccess("");

        const uid = cred.user.uid;
        const email = (cred.user.email ?? "").trim().toLowerCase();
        if (!email) throw new Error("Google account email is missing.");

        const displayName = (draft.ownerDisplayName || cred.user.displayName || "").trim();
        if (displayName) {
          await updateProfile(cred.user, { displayName }).catch(() => {});
        }

        const userRef = doc(db, "users", uid);

        // 既存 doc があって role が別ならブロック
        const existing = await getDoc(userRef);
        if (existing.exists()) {
          const role = existing.data()?.role;
          if (role && role !== "staff_member") {
            throw new Error("This Google account is already used for a different account type.");
          }
        }

        // users/{uid} 作成/更新
        await setDoc(
          userRef,
          {
            uid,
            email,
            emailLower: email,
            displayName: displayName || null,
            displayNameLower: displayName ? displayName.toLowerCase() : null,

            roleUi: "staff",
            role: "staff_member",
            roles: ["staff_member"],
            accountType: "staff_member",

            staffProfile:
              draft.mode === "create"
                ? {
                    dojoName: draft.dojoName,
                    country: draft.country || "Canada",
                    city: draft.city || "Vancouver",
                    website: draft.website.trim() || null,
                    phone: draft.phone.trim() || null,
                  }
                : {
                    dojoName: draft.selectedDojo?.name ?? "",
                    country: draft.selectedDojo?.country ?? null,
                    city: draft.selectedDojo?.city ?? null,
                    website: draft.selectedDojo?.website ?? null,
                    phone: draft.selectedDojo?.phone ?? null,
                  },

            emailVerified: !!cred.user.emailVerified,

            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );

        // ─────────────────────────────────────────
        // MODE: select（Join Request）
        // ─────────────────────────────────────────
        if (draft.mode === "select") {
          const dojoId = draft.selectedDojo.id;

          const jrRef = doc(db, "dojos", dojoId, "joinRequests", uid);
          await setDoc(jrRef, {
            uid,
            dojoId,
            status: "pending",
            note: "Staff member join request",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await setDoc(
            userRef,
            {
              dojoId,
              staffProfile: {
                dojoId,
                dojoName: draft.selectedDojo?.name ?? "",
                country: draft.selectedDojo?.country ?? null,
                city: draft.selectedDojo?.city ?? null,
                website: draft.selectedDojo?.website ?? null,
                phone: draft.selectedDojo?.phone ?? null,
              },
              updatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );

          clearStaffDraft();
          setSuccess("Join request sent with Google!");
          setTimeout(() => router.replace("/verify"), 800);
          return;
        }

        // ─────────────────────────────────────────
        // MODE: create（Dojo作成 + Owner登録）
        // ─────────────────────────────────────────
        const dojoName = draft.dojoName.trim();
        const country = (draft.country || "Canada").trim();
        const city = (draft.city || "Vancouver").trim();
        const website = draft.website.trim() || null;
        const phone = draft.phone.trim() || null;

        const dojoRef = doc(collection(db, "dojos"));
        const dojoId = dojoRef.id;

        const nameLower = normalizeNameLower(dojoName);
        const keywords = buildKeywords({ dojoName, city, country });

        await setDoc(dojoRef, {
          name: dojoName,
          nameLower,
          keywords,
          isPublic: true,
          ownerUid: uid,
          ownerIds: [uid],
          createdBy: uid,
          country: country || null,
          city: city || null,
          website,
          phone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const memberRef = doc(db, "dojos", dojoId, "members", uid);
        await setDoc(memberRef, {
          uid,
          dojoId,
          status: "approved",
          roleInDojo: "owner",
          role: "owner",
          approvedAt: serverTimestamp(),
          approvedBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(
          userRef,
          {
            dojoId,
            staffProfile: {
              dojoId,
              dojoName,
              country,
              city,
              website,
              phone,
              roleInDojo: "owner",
            },
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );

        clearStaffDraft();
        setSuccess("Dojo and account created with Google!");
        setTimeout(() => router.replace("/verify"), 800);
      } catch (e) {
        console.error("[StaffSignup][GoogleRedirect] Error:", e);
        setError(formatGoogleAuthError(e));
        try {
          if (authNullable) await signOut(authNullable);
        } catch {}
      } finally {
        setBusy(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [router, next]);

  // ─────────────────────────────────────────────
  // Email/Password signup
  // ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (busy) return;
    if (authMethod !== "email") return;
    if (!canEmailSubmit) return;

    setBusy(true);
    setError("");
    setSuccess("");

    const email = f.email.trim().toLowerCase();
    const password = f.password;
    const dojoName = f.dojoName.trim();
    const displayName = f.ownerDisplayName.trim();
    const country = f.country.trim();
    const city = f.city.trim();
    const website = f.website.trim() || null;
    const phone = f.phone.trim() || null;

    let createdAuthUser: { delete: () => Promise<void> } | null = null;

    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable) throw new Error("Auth is not ready.");
      if (!dbNullable) throw new Error("Firestore is not ready.");

      if (mode === "select" && !selectedDojo?.id) {
        throw new Error("Please select an existing dojo.");
      }

      // 1) Auth signup
      const cred = await createUserWithEmailAndPassword(authNullable, email, password);
      const uid = cred.user.uid;
      createdAuthUser = cred.user;

      if (displayName) {
        await updateProfile(cred.user, { displayName }).catch(() => {});
      }

      // 2) Create users/{uid} first
      const userRef = doc(dbNullable, "users", uid);

      await setDoc(
        userRef,
        {
          uid,
          email: cred.user.email ?? email,
          emailLower: email,
          displayName: displayName || null,
          displayNameLower: displayName ? displayName.toLowerCase() : null,

          roleUi: "staff",
          role: "staff_member",
          roles: ["staff_member"],
          accountType: "staff_member",

          staffProfile:
            mode === "create"
              ? { dojoName, country, city, website, phone }
              : {
                  dojoName: selectedDojo?.name ?? "",
                  country: selectedDojo?.country ?? null,
                  city: selectedDojo?.city ?? null,
                  website: selectedDojo?.website ?? null,
                  phone: selectedDojo?.phone ?? null,
                },

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      // ─────────────────────────────────────────
      // MODE: select（Join Request）
      // ─────────────────────────────────────────
      if (mode === "select") {
        const dojoId = selectedDojo!.id;

        const jrRef = doc(dbNullable, "dojos", dojoId, "joinRequests", uid);
        await setDoc(jrRef, {
          uid,
          dojoId,
          status: "pending",
          note: "Staff member join request",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(
          userRef,
          {
            dojoId,
            staffProfile: {
              dojoId,
              dojoName: selectedDojo?.name ?? "",
              country: selectedDojo?.country ?? null,
              city: selectedDojo?.city ?? null,
              website: selectedDojo?.website ?? null,
              phone: selectedDojo?.phone ?? null,
            },
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );

        await sendEmailVerification(cred.user).catch(() => {});
        setSuccess("Join request sent! Please complete email verification.");
        setTimeout(() => router.replace("/verify"), 1500);
        return;
      }

      // ─────────────────────────────────────────
      // MODE: create（Dojo作成 + Owner登録）
      // ─────────────────────────────────────────
      const dojoRef = doc(collection(dbNullable, "dojos"));
      const dojoId = dojoRef.id;

      const nameLower = normalizeNameLower(dojoName);
      const keywords = buildKeywords({ dojoName, city, country });

      await setDoc(dojoRef, {
        name: dojoName,
        nameLower,
        keywords,
        isPublic: true,
        ownerUid: uid,
        ownerIds: [uid],
        createdBy: uid,
        country: country || null,
        city: city || null,
        website,
        phone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const memberRef = doc(dbNullable, "dojos", dojoId, "members", uid);
      await setDoc(memberRef, {
        uid,
        dojoId,
        status: "approved",
        roleInDojo: "owner",
        role: "owner",
        approvedAt: serverTimestamp(),
        approvedBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(
        userRef,
        {
          dojoId,
          staffProfile: {
            dojoId,
            dojoName,
            country,
            city,
            website,
            phone,
            roleInDojo: "owner",
          },
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      await sendEmailVerification(cred.user).catch(() => {});
      setSuccess("Dojo and account created! Please complete email verification.");
      setTimeout(() => router.replace("/verify"), 1500);
    } catch (e) {
      console.error("[StaffSignup] Error:", e);

      const isAuthError = e instanceof FirebaseError && e.code?.startsWith("auth/");
      if (!isAuthError && createdAuthUser) {
        try {
          await createdAuthUser.delete();
        } catch {}
      }

      setError(formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-100 mb-4">
            <span className="text-3xl">🏢</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Staff Signup</h1>
          <p className="mt-2 text-sm text-slate-500">Create a new gym or join an existing one</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <TabButton
            active={mode === "create"}
            onClick={() => {
              setMode("create");
              setSearchTerm("");
              setCandidates([]);
              setSelectedDojo(null);
              setSearchErr("");
              setError("");
              setSuccess("");
            }}
          >
            🆕 Create a Gym
          </TabButton>
          <TabButton
            active={mode === "select"}
            onClick={() => {
              setMode("select");
              setError("");
              setSuccess("");
            }}
          >
            🔍 Join Existing
          </TabButton>
        </div>

        {/* Method Toggle */}
        <div className="flex gap-2">
          <MethodButton
            active={authMethod === "google"}
            onClick={() => {
              setAuthMethod("google");
              setError("");
              setSuccess("");
            }}
          >
            Google
          </MethodButton>
          <MethodButton
            active={authMethod === "email"}
            onClick={() => {
              setAuthMethod("email");
              setError("");
              setSuccess("");
            }}
          >
            Email/Password
          </MethodButton>
        </div>

        {/* Alerts */}
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        {/* Form Card */}
        <Card>
          <div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
            {/* Create Mode Fields */}
            {mode === "create" && (
              <>
                <div className="text-sm font-semibold text-slate-700 mb-2">Gym Information</div>

                <Input
                  label="Gym Name"
                  placeholder="Enter gym name"
                  value={f.dojoName}
                  onChange={onChange("dojoName")}
                  required
                  error={!f.dojoName.trim() ? "Gym name is required." : undefined}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Country" placeholder="Country" value={f.country} onChange={onChange("country")} />
                  <Input label="City" placeholder="City" value={f.city} onChange={onChange("city")} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Website" placeholder="https://..." value={f.website} onChange={onChange("website")} />
                  <Input label="Phone" placeholder="Phone number" value={f.phone} onChange={onChange("phone")} />
                </div>

                <hr className="border-slate-100" />
              </>
            )}

            {/* Select Mode Fields */}
            {mode === "select" && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Search Gym</label>
                  <input
                    placeholder="Type gym name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                  {searchBusy && <p className="text-xs text-slate-500">Searching...</p>}
                  {searchErr && <p className="text-xs text-rose-600">{searchErr}</p>}
                </div>

                {candidates.length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {candidates.map((d) => {
                      const selected = selectedDojo?.id === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSelectedDojo(d)}
                          className={`w-full text-left rounded-2xl border px-4 py-3 transition ${
                            selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="font-semibold text-slate-900">{d.name ?? "(no name)"}</div>
                          <div className="text-sm text-slate-500">
                            {d.city ?? ""} {d.country ?? ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedDojo && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-emerald-800">Selected</div>
                        <div className="text-emerald-700">{selectedDojo.name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedDojo(null)}
                        className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-500">
                  * Selecting an existing gym will create a join request (pending approval).
                </p>

                <hr className="border-slate-100" />
              </>
            )}

            {/* Common Fields */}
            <div className="text-sm font-semibold text-slate-700 mb-2">Account Information</div>

            <Input
              label="Your Name"
              placeholder="Display name"
              value={f.ownerDisplayName}
              onChange={onChange("ownerDisplayName")}
              required
              error={!f.ownerDisplayName.trim() ? "Your name is required." : undefined}
            />

            {/* ✅ A：Google はフォーム入力の後 */}
            {authMethod === "google" && (
              <>
                <GoogleSignInButton
                  onClick={startGoogleRedirect}
                  disabled={!canGoogleSubmit || busy}
                  label="Continue with Google"
                />
                <p className="text-xs text-slate-500">
                  * The information you entered above will be saved and linked to your Google account.
                </p>
              </>
            )}

            {/* Email/Password */}
            {authMethod === "email" && (
              <>
                <div className="text-center text-xs text-slate-400">— use Email/Password —</div>

                <Input
                  label="Email"
                  type="email"
                  placeholder="Enter your email"
                  value={f.email}
                  onChange={onChange("email")}
                  required
                  hint={emailCheckResult === "checking" ? "Checking..." : undefined}
                  success={emailCheckResult === "available" ? "Available" : undefined}
                  error={
                    emailCheckResult === "taken"
                      ? "This email is already registered."
                      : !f.email.trim()
                      ? "Email is required."
                      : !f.email.includes("@")
                      ? "Invalid email."
                      : undefined
                  }
                />

                <Input
                  label="Password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={f.password}
                  onChange={onChange("password")}
                  required
                  error={f.password && f.password.length < 6 ? "Password must be at least 6 characters" : undefined}
                />

                <Input
                  label="Confirm Password"
                  type="password"
                  placeholder="Re-enter password"
                  value={f.password2}
                  onChange={onChange("password2")}
                  required
                  error={f.password2 && f.password !== f.password2 ? "Passwords do not match" : undefined}
                />

                <div className="pt-2">
                  <PrimaryBtn onClick={handleSubmit} disabled={!canEmailSubmit || busy}>
                    {busy ? "Creating..." : mode === "create" ? "Create Gym & Sign Up" : "Join Gym & Sign Up"}
                  </PrimaryBtn>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Footer Links */}
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">
            Already have an account?{" "}
            <button onClick={() => router.push("/login")} className="font-semibold text-slate-900 hover:underline">
              Log in
            </button>
          </p>

          <p className="text-sm text-slate-500">
            Sign up as a student?{" "}
            <button
              onClick={() => router.push("/signup/student-profile")}
              className="font-semibold text-slate-900 hover:underline"
            >
              Click here
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
