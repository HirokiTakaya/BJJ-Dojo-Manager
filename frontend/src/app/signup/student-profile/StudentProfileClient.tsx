"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  fetchSignInMethodsForEmail,
  signOut,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  type UserCredential,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";

// ✅ 追加：共通Googleボタン（大小区別でビルド落ちしない）
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Belt =
  | "white"
  | "blue"
  | "purple"
  | "brown"
  | "black"
  | "kids-white"
  | "kids-grey"
  | "kids-yellow"
  | "kids-orange"
  | "kids-green";

const BELTS: { value: Belt; label: string }[] = [
  { value: "white", label: "White" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "brown", label: "Brown" },
  { value: "black", label: "Black" },
  { value: "kids-white", label: "Kids - White" },
  { value: "kids-grey", label: "Kids - Grey" },
  { value: "kids-yellow", label: "Kids - Yellow" },
  { value: "kids-orange", label: "Kids - Orange" },
  { value: "kids-green", label: "Kids - Green" },
];

type AuthMode = "register" | "login";
type AuthMethod = "google" | "email";

interface FormState {
  fullName: string;
  email: string; // Email/Password用（Googleでは不要）
  password: string;
  password2: string;
  phone: string;
  belt: Belt;
  dojoName: string;
  dojoId: string | null;
}

// ─────────────────────────────────────────────────────────────
// Sub-components
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
  onKeyPress,
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
  onKeyPress?: (e: React.KeyboardEvent) => void;
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
      onKeyPress={onKeyPress}
      className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
        error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
      }`}
    />
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
    {success && <p className="text-xs text-emerald-600">✓ {success}</p>}
    {error && <p className="text-xs text-rose-600">{error}</p>}
  </label>
);

const Select = ({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) => (
  <label className="block space-y-1">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);

const PrimaryBtn = ({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "success";
}) => {
  const bgColor = variant === "success" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-900 hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-full px-6 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${bgColor}`}
    >
      {children}
    </button>
  );
};

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
// Error formatting
// ─────────────────────────────────────────────────────────────
function formatAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "auth/email-already-in-use":
        return "This email address is already registered. Please log in.";
      case "auth/invalid-email":
        return "The email address format is invalid.";
      case "auth/weak-password":
        return "The password is too weak (must be at least 6 characters).";
      case "auth/user-not-found":
        return "No account found with this email address.";
      case "auth/wrong-password":
        return "The password is incorrect.";
      case "auth/invalid-credential":
        return "The email address or password is incorrect.";
      case "auth/too-many-requests":
        return "Too many attempts. Please try again later.";
      case "auth/network-request-failed":
        return "Network error. Please check your connection.";
      case "permission-denied":
        return "You do not have permission to write to the database.";
      default:
        return `Error: ${e.code} - ${e.message}`;
    }
  }
  if (e instanceof Error) return e.message;
  return "An unexpected error occurred.";
}

// ─────────────────────────────────────────────────────────────
// Verify user document
// ─────────────────────────────────────────────────────────────
async function verifyUserDocument(uid: string): Promise<boolean> {
  if (!dbNullable) return false;

  try {
    const userRef = doc(dbNullable, "users", uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) return false;

    const data = snap.data();
    const requiredFields = ["role", "roles", "accountType", "roleUi", "dojoId"];

    for (const field of requiredFields) {
      if (!data[field]) return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Google redirect draft (Student)
// ─────────────────────────────────────────────
const STUDENT_GOOGLE_DRAFT_KEY = "student_google_signup_draft_v1";
const STUDENT_GOOGLE_FLOW_KEY = "student_google_flow_v1"; // "register" | "login"

type StudentGoogleDraft = {
  next: string;
  fullName: string;
  phone: string;
  belt: Belt;
  dojoId: string;
  dojoName: string;
};

function saveStudentDraft(d: StudentGoogleDraft) {
  sessionStorage.setItem(STUDENT_GOOGLE_DRAFT_KEY, JSON.stringify(d));
}

function loadStudentDraft(): StudentGoogleDraft | null {
  const raw = sessionStorage.getItem(STUDENT_GOOGLE_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StudentGoogleDraft;
  } catch {
    return null;
  }
}

function clearStudentDraft() {
  sessionStorage.removeItem(STUDENT_GOOGLE_DRAFT_KEY);
}

function setStudentFlow(flow: "register" | "login") {
  sessionStorage.setItem(STUDENT_GOOGLE_FLOW_KEY, flow);
}

function getStudentFlow(): "register" | "login" | null {
  const v = sessionStorage.getItem(STUDENT_GOOGLE_FLOW_KEY);
  if (v === "register" || v === "login") return v;
  return null;
}

function clearStudentFlow() {
  sessionStorage.removeItem(STUDENT_GOOGLE_FLOW_KEY);
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function StudentProfileClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="text-slate-500">Loading...</div>
        </div>
      }
    >
      <StudentSignupInner />
    </Suspense>
  );
}

function StudentSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";

  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("google"); // ✅ AのためデフォルトGoogleでもOK
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [emailStatus, setEmailStatus] = useState<"" | "checking" | "available" | "taken">("");

  const [form, setForm] = useState<FormState>({
    fullName: "",
    email: "",
    password: "",
    password2: "",
    phone: "",
    belt: "white",
    dojoName: "",
    dojoId: null,
  });

  // Dojo search
  const [dojoSearchBusy, setDojoSearchBusy] = useState(false);
  const [dojoCandidates, setDojoCandidates] = useState<DojoLite[]>([]);
  const [selectedDojo, setSelectedDojo] = useState<DojoLite | null>(null);

  // ─────────────────────────────────────────────
  // Email check（register + email method only）
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (authMode !== "register" || authMethod !== "email") {
      setEmailStatus("");
      return;
    }

    const email = form.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setEmailStatus("");
      return;
    }

    setEmailStatus("checking");

    const timer = setTimeout(async () => {
      if (!authNullable) {
        setEmailStatus("");
        return;
      }

      try {
        const methods = await fetchSignInMethodsForEmail(authNullable, email);
        setEmailStatus(methods.length > 0 ? "taken" : "available");
      } catch {
        setEmailStatus("");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.email, authMode, authMethod]);

  // ─────────────────────────────────────────────
  // Dojo search（register only）
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (authMode !== "register") {
      setDojoCandidates([]);
      return;
    }

    const term = form.dojoName.trim();
    if (!term || term.length < 2 || selectedDojo) {
      setDojoCandidates([]);
      return;
    }

    if (!dbNullable) return;

    setDojoSearchBusy(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchPublicDojosByPrefix(dbNullable!, term, 10);
        setDojoCandidates(rows);
      } catch {
        // ignore
      } finally {
        setDojoSearchBusy(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [form.dojoName, selectedDojo, authMode]);

  // ─────────────────────────────────────────────
  // 共通入力のバリデーション（A：Googleでもここは必須）
  // ─────────────────────────────────────────────
  const baseErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (authMode === "register") {
      if (!form.fullName.trim()) errors.fullName = "Please enter your name.";
      if (!form.dojoId) errors.dojoId = "Please search for a gym and select one from the list.";
    }
    return errors;
  }, [authMode, form.fullName, form.dojoId]);

  // Email/Password 用バリデーション
  const emailErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (authMethod !== "email") return errors;

    if (!form.email.trim()) errors.email = "Please enter your email address.";
    else if (!form.email.includes("@")) errors.email = "Please enter a valid email address.";
    else if (authMode === "register" && emailStatus === "taken") errors.email = "This email address is already registered.";

    if (!form.password) errors.password = "Please enter your password.";
    else if (form.password.length < 6) errors.password = "Password must be at least 6 characters.";

    if (authMode === "register") {
      if (form.password !== form.password2) errors.password2 = "Passwords do not match.";
    }
    return errors;
  }, [authMethod, authMode, form.email, form.password, form.password2, emailStatus]);

  // ✅ Google register可能条件（A）
  const canGoogleRegister = useMemo(() => {
    if (authMode !== "register") return true;
    if (!form.fullName.trim()) return false;
    if (!form.dojoId) return false;
    return true;
  }, [authMode, form.fullName, form.dojoId]);

  // ✅ Email submit可能条件
  const canEmailSubmit = useMemo(() => {
    const combined = { ...baseErrors, ...emailErrors };
    return Object.keys(combined).length === 0;
  }, [baseErrors, emailErrors]);

  // ─────────────────────────────────────────────
  // Form handlers
  // ─────────────────────────────────────────────
  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  }, []);

  const selectDojo = useCallback((d: DojoLite) => {
    setSelectedDojo(d);
    setDojoCandidates([]);
    setForm((prev) => ({ ...prev, dojoName: d.name ?? "", dojoId: d.id }));
  }, []);

  const clearDojo = useCallback(() => {
    setSelectedDojo(null);
    setForm((prev) => ({ ...prev, dojoId: null }));
  }, []);

  // ─────────────────────────────────────────────
  // Register (Email/Password)
  // ─────────────────────────────────────────────
  const handleRegister = async () => {
    if (busy) return;
    if (authMode !== "register") return;
    if (authMethod !== "email") return;
    if (!canEmailSubmit) return;

    setBusy(true);
    setError("");
    setSuccess("");

    let createdUser: { delete: () => Promise<void> } | null = null;

    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable) throw new Error("Auth is not ready.");
      if (!dbNullable) throw new Error("Firestore is not ready.");
      if (!form.dojoId) throw new Error("Please search for a gym and select one from the list.");

      const email = form.email.trim().toLowerCase();
      const password = form.password;
      const fullName = form.fullName.trim();

      const cred = await createUserWithEmailAndPassword(authNullable, email, password);
      createdUser = cred.user;
      const uid = cred.user.uid;

      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});

      const userRef = doc(dbNullable, "users", uid);
      await setDoc(
        userRef,
        {
          uid,
          email: cred.user.email ?? email,
          emailLower: email,
          displayName: fullName,
          displayNameLower: fullName.toLowerCase(),

          dojoId: form.dojoId,
          dojoName: form.dojoName.trim() || null,

          role: "student",
          roles: ["student"],
          accountType: "student",
          roleUi: "student",

          studentProfile: {
            fullName,
            email,
            phone: form.phone.trim() || null,
            belt: form.belt,
            dojoName: form.dojoName.trim() || null,
            dojoId: form.dojoId ?? null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },

          onboardingComplete: false,
          emailVerified: false,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      const verified = await verifyUserDocument(uid);
      if (!verified) throw new Error("Failed to create the user document.");

      await sendEmailVerification(cred.user).catch(() => {});
      setSuccess("Account created! Please complete email verification.");
      setTimeout(() => router.replace("/verify"), 1500);
    } catch (e) {
      const isAuthError = e instanceof FirebaseError && e.code?.startsWith("auth/");
      if (!isAuthError && createdUser) {
        try {
          await createdUser.delete();
        } catch {}
      }
      setError(formatAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // Login (Email/Password)
  // ─────────────────────────────────────────────
  const handleLogin = async () => {
    if (busy) return;
    if (authMode !== "login") return;
    if (authMethod !== "email") return;
    if (!canEmailSubmit) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!authNullable) throw new Error("Auth is not ready.");

      const email = form.email.trim().toLowerCase();
      const password = form.password;

      const cred = await signInWithEmailAndPassword(authNullable, email, password);

      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        setSuccess("Login successful! Please complete email verification.");
        setTimeout(() => router.replace("/verify"), 1500);
        return;
      }

      setSuccess("Login successful!");
      router.replace(next);
    } catch (e) {
      setError(formatAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // ✅ Google redirect start (register)  ※A：入力後に押す
  // ─────────────────────────────────────────────
  const startGoogleRegisterRedirect = async () => {
    if (busy) return;
    if (authMode !== "register") return;
    if (!canGoogleRegister) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable) throw new Error("Auth is not ready.");
      if (!form.dojoId) throw new Error("Please select a gym.");

      setStudentFlow("register");
      saveStudentDraft({
        next,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        belt: form.belt,
        dojoId: form.dojoId,
        dojoName: form.dojoName.trim(),
      });

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      await signInWithRedirect(authNullable, provider);
    } catch (e) {
      setError(formatGoogleAuthError(e));
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // ✅ Google redirect start (login)
  // ─────────────────────────────────────────────
  const startGoogleLoginRedirect = async () => {
    if (busy) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!authNullable) throw new Error("Auth is not ready.");

      setStudentFlow("login");

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      await signInWithRedirect(authNullable, provider);
    } catch (e) {
      setError(formatGoogleAuthError(e));
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // ✅ Google redirect: handle result on mount
  // ─────────────────────────────────────────────
  const redirectHandledRef = useRef(false);

  useEffect(() => {
    if (redirectHandledRef.current) return;
    redirectHandledRef.current = true;

    const run = async () => {
      try {
        if (!authNullable) return;
        if (!dbNullable) return;

        const cred: UserCredential | null = await getRedirectResult(authNullable);
        if (!cred) return;

        const flow = getStudentFlow();
        clearStudentFlow();

        const uid = cred.user.uid;
        const email = (cred.user.email ?? "").trim().toLowerCase();
        if (!email) throw new Error("Google account email is missing.");

        setBusy(true);
        setError("");
        setSuccess("");

        const userRef = doc(dbNullable, "users", uid);

        // ─────────────────────────────────────────
        // FLOW: register
        // ─────────────────────────────────────────
        if (flow === "register") {
          const draft = loadStudentDraft();
          clearStudentDraft();

          if (!draft) {
            setError("Signup data was missing after redirect. Please try again.");
            try {
              await signOut(authNullable);
            } catch {}
            return;
          }

          const fullName = (draft.fullName || cred.user.displayName || "").trim();
          if (fullName) {
            await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
          }

          // role衝突チェック
          const existing = await getDoc(userRef);
          if (existing.exists()) {
            const role = existing.data()?.role;
            if (role && role !== "student") {
              throw new Error("This Google account is already used for a different account type.");
            }
          }

          await setDoc(
            userRef,
            {
              uid,
              email,
              emailLower: email,
              displayName: fullName || cred.user.displayName || null,
              displayNameLower: (fullName || cred.user.displayName || "").toLowerCase() || null,

              dojoId: draft.dojoId,
              dojoName: draft.dojoName || null,

              role: "student",
              roles: ["student"],
              accountType: "student",
              roleUi: "student",

              studentProfile: {
                fullName: fullName || cred.user.displayName || "",
                email,
                phone: draft.phone || null,
                belt: draft.belt,
                dojoName: draft.dojoName || null,
                dojoId: draft.dojoId ?? null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },

              onboardingComplete: false,
              emailVerified: !!cred.user.emailVerified,

              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );

          const verified = await verifyUserDocument(uid);
          if (!verified) throw new Error("Failed to create the user document.");

          setSuccess("Account created with Google!");
          setTimeout(() => router.replace("/verify"), 800);
          return;
        }

        // ─────────────────────────────────────────
        // FLOW: login (default)
        // ─────────────────────────────────────────
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          throw new Error("No profile found. Please sign up first to select your gym.");
        }

        const role = snap.data()?.role;
        if (role && role !== "student") {
          throw new Error("This Google account is not a student account.");
        }

        await setDoc(userRef, { lastLoginAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });

        setSuccess("Login successful with Google!");
        router.replace(next);
      } catch (e) {
        console.error("[Student][GoogleRedirect] Error:", e);
        setError(formatGoogleAuthError(e));
        try {
          if (authNullable) await signOut(authNullable);
        } catch {}
      } finally {
        setBusy(false);
      }
    };

    run();
  }, [router, next]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (busy) return;
    if (authMethod !== "email") return; // ✅ GoogleモードではEnter送信しない

    authMode === "register" ? handleRegister() : handleLogin();
  };

  // ─────────────────────────────────────────────
  // Render（A：入力→Google を徹底）
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 mb-4">
            <span className="text-3xl">🥋</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {authMode === "register" ? "Create Student Account" : "Student Login"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {authMode === "register" ? "Fill in your profile first, then continue" : "Welcome back!"}
          </p>
        </div>

        {/* Auth Mode Toggle */}
        <div className="flex gap-2">
          <TabButton
            active={authMode === "register"}
            onClick={() => {
              setAuthMode("register");
              setError("");
              setSuccess("");
            }}
          >
            Sign up
          </TabButton>
          <TabButton
            active={authMode === "login"}
            onClick={() => {
              setAuthMode("login");
              setError("");
              setSuccess("");
            }}
          >
            Log in
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
            {/* ✅ A：registerでは先にプロフィール入力 */}
            {authMode === "register" && (
              <>
                <Input
                  label="Full Name"
                  placeholder="e.g., Taro Yamada"
                  value={form.fullName}
                  onChange={(v) => updateField("fullName", v)}
                  onKeyPress={handleKeyPress}
                  error={baseErrors.fullName}
                  required
                />

                <Input
                  label="Phone"
                  type="tel"
                  placeholder="optional"
                  value={form.phone}
                  onChange={(v) => updateField("phone", v)}
                />

                <Select
                  label="Current Belt"
                  value={form.belt}
                  onChange={(v) => updateField("belt", v as Belt)}
                  options={BELTS}
                />

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Gym <span className="text-rose-500">*</span>
                  </label>
                  <input
                    placeholder="Search gym name..."
                    value={form.dojoName}
                    onChange={(e) => {
                      updateField("dojoName", e.target.value);
                      updateField("dojoId", null);
                      setSelectedDojo(null);
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
                      baseErrors.dojoId ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
                    }`}
                  />
                  {dojoSearchBusy && <p className="text-xs text-slate-500">Searching...</p>}

                  {selectedDojo && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <span>✓ {selectedDojo.name}</span>
                      <button type="button" onClick={clearDojo} className="text-slate-500 hover:text-slate-700 underline">
                        Clear
                      </button>
                    </div>
                  )}

                  {baseErrors.dojoId && <p className="text-xs text-rose-600">{baseErrors.dojoId}</p>}

                  {dojoCandidates.length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-2xl border border-slate-200">
                      {dojoCandidates.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => selectDojo(d)}
                          className="w-full text-left px-4 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                        >
                          <div className="font-semibold text-sm text-slate-900">{d.name}</div>
                          <div className="text-xs text-slate-500">
                            {d.city} {d.country}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <hr className="border-slate-100" />
              </>
            )}

            {/* ✅ Googleボタン（A：フォームの後） */}
            {authMethod === "google" && (
              <>
                <GoogleSignInButton
                  onClick={authMode === "register" ? startGoogleRegisterRedirect : startGoogleLoginRedirect}
                  disabled={authMode === "register" ? !canGoogleRegister || busy : busy}
                  label={authMode === "register" ? "Continue with Google" : "Log in with Google"}
                />
                {authMode === "register" && (
                  <p className="text-xs text-slate-500">
                    * Your profile info above will be saved and linked to your Google account.
                  </p>
                )}
              </>
            )}

            {/* Email/Password UI */}
            {authMethod === "email" && (
              <>
                <Input
                  label="Email"
                  type="email"
                  placeholder="e.g., taro@email.com"
                  value={form.email}
                  onChange={(v) => updateField("email", v)}
                  onKeyPress={handleKeyPress}
                  error={emailErrors.email}
                  hint={authMode === "register" && emailStatus === "checking" ? "Checking..." : undefined}
                  success={authMode === "register" && emailStatus === "available" ? "Available" : undefined}
                  required
                />

                <Input
                  label="Password"
                  type="password"
                  placeholder={authMode === "register" ? "At least 6 characters" : "Password"}
                  value={form.password}
                  onChange={(v) => updateField("password", v)}
                  onKeyPress={handleKeyPress}
                  error={emailErrors.password}
                  required
                />

                {authMode === "register" && (
                  <Input
                    label="Confirm Password"
                    type="password"
                    placeholder="Re-enter your password"
                    value={form.password2}
                    onChange={(v) => updateField("password2", v)}
                    onKeyPress={handleKeyPress}
                    error={emailErrors.password2}
                    required
                  />
                )}

                {authMode === "login" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => router.push(`/forgot-password?email=${encodeURIComponent(form.email)}`)}
                      className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}

                <div className="pt-2">
                  <PrimaryBtn
                    onClick={authMode === "register" ? handleRegister : handleLogin}
                    disabled={!canEmailSubmit || busy}
                    variant={authMode === "register" ? "success" : "primary"}
                  >
                    {busy
                      ? authMode === "register"
                        ? "Creating..."
                        : "Logging in..."
                      : authMode === "register"
                      ? "Create Account"
                      : "Log in"}
                  </PrimaryBtn>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Footer Links */}
        <div className="text-center">
          <p className="text-sm text-slate-500">
            Sign up as staff?{" "}
            <button onClick={() => router.push("/signup/staff")} className="font-semibold text-slate-900 hover:underline">
              Click here
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
