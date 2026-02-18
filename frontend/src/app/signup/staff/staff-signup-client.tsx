// app/signup/staff/page.tsx
"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  fetchSignInMethodsForEmail,
  signOut,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  type UserCredential,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc, getDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";
import { navigateAfterAuth } from "@/lib/navigateAfterAuth";
import type { PendingDojoAction } from "@/lib/completePendingDojoAction";

import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

// ─────────────────────────────────────────────────────────────
// Types & Sub-components (省略なし — 前回と同一のため簡潔に)
// ─────────────────────────────────────────────────────────────
type FormState = {
  dojoName: string; country: string; city: string; website: string; phone: string;
  ownerDisplayName: string; email: string; password: string; password2: string;
};
type Mode = "create" | "select";
type AuthMethod = "google" | "email";

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);
const Alert = ({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) => {
  const cls = kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
};
const Input = ({ label, type = "text", placeholder, value, onChange, error, hint, success, required }: {
  label: string; type?: string; placeholder?: string; value: string; onChange: (v: string) => void;
  error?: string; hint?: string; success?: string; required?: boolean;
}) => (
  <label className="block space-y-1">
    <span className="text-sm font-semibold text-slate-700">{label} {required && <span className="text-rose-500">*</span>}</span>
    <input type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`} />
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
    {success && <p className="text-xs text-emerald-600">✓ {success}</p>}
    {error && <p className="text-xs text-rose-600">{error}</p>}
  </label>
);
const PrimaryBtn = ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="w-full rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
);
const TabButton = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>
);
const MethodButton = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function formatErr(e: unknown) {
  if (e instanceof FirebaseError) {
    if (e.code === "auth/email-already-in-use") return "This email address is already in use.";
    if (e.code === "auth/invalid-email") return "Invalid email format.";
    if (e.code === "auth/weak-password") return "Password too weak (at least 6 characters).";
    if (e.code === "auth/network-request-failed") return "Network error.";
    if (e.code === "permission-denied") return "Firestore permission error.";
    return `${e.code}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return "Signup failed.";
}

async function waitForFirebaseReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (authNullable && dbNullable) return { auth: authNullable, db: dbNullable };
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// Google redirect draft
const STAFF_GOOGLE_DRAFT_KEY = "staff_google_signup_draft_v1";
type StaffGoogleDraft =
  | { mode: "create"; next: string; dojoName: string; country: string; city: string; website: string; phone: string; ownerDisplayName: string }
  | { mode: "select"; next: string; selectedDojo: DojoLite; ownerDisplayName: string };
function saveStaffDraft(d: StaffGoogleDraft) { sessionStorage.setItem(STAFF_GOOGLE_DRAFT_KEY, JSON.stringify(d)); }
function loadStaffDraft(): StaffGoogleDraft | null { try { return JSON.parse(sessionStorage.getItem(STAFF_GOOGLE_DRAFT_KEY) ?? "null"); } catch { return null; } }
function clearStaffDraft() { sessionStorage.removeItem(STAFF_GOOGLE_DRAFT_KEY); }

// ✅ NEW: pendingDojoAction builders
function buildPendingFromForm(mode: Mode, f: FormState, selectedDojo: DojoLite | null): PendingDojoAction {
  if (mode === "create") {
    return { type: "staff_create_dojo", dojoName: f.dojoName.trim(), country: f.country.trim() || "Canada", city: f.city.trim() || "Vancouver", website: f.website.trim() || null, phone: f.phone.trim() || null };
  }
  return { type: "staff_join_dojo", dojoId: selectedDojo!.id, dojoName: selectedDojo?.name ?? "", country: selectedDojo?.country ?? null, city: selectedDojo?.city ?? null, website: selectedDojo?.website ?? null, phone: selectedDojo?.phone ?? null };
}

function buildPendingFromDraft(draft: StaffGoogleDraft): PendingDojoAction {
  if (draft.mode === "create") {
    return { type: "staff_create_dojo", dojoName: draft.dojoName.trim(), country: draft.country.trim() || "Canada", city: draft.city.trim() || "Vancouver", website: draft.website.trim() || null, phone: draft.phone.trim() || null };
  }
  return { type: "staff_join_dojo", dojoId: draft.selectedDojo.id, dojoName: draft.selectedDojo?.name ?? "", country: draft.selectedDojo?.country ?? null, city: draft.selectedDojo?.city ?? null, website: draft.selectedDojo?.website ?? null, phone: draft.selectedDojo?.phone ?? null };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
export default function StaffSignupPage() {
  return (<Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center"><div className="text-slate-500">Loading...</div></div>}><StaffSignupInner /></Suspense>);
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

  const [f, setF] = useState<FormState>({ dojoName: "", country: "Canada", city: "Vancouver", website: "", phone: "", ownerDisplayName: "", email: "", password: "", password2: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [candidates, setCandidates] = useState<DojoLite[]>([]);
  const [selectedDojo, setSelectedDojo] = useState<DojoLite | null>(null);

  const onChange = (k: keyof FormState) => (value: string) => { setF((p) => ({ ...p, [k]: value })); setError(""); };

  // Email check
  useEffect(() => {
    if (authMethod !== "email") { setEmailCheckResult(""); return; }
    const email = f.email.trim().toLowerCase();
    if (!email || !email.includes("@")) { setEmailCheckResult(""); return; }
    setEmailCheckResult("checking");
    const timer = setTimeout(async () => {
      if (!authNullable) { setEmailCheckResult(""); return; }
      try { const m = await fetchSignInMethodsForEmail(authNullable, email); setEmailCheckResult(m.length > 0 ? "taken" : "available"); } catch { setEmailCheckResult(""); }
    }, 500);
    return () => clearTimeout(timer);
  }, [f.email, authMethod]);

  // Dojo search
  useEffect(() => {
    if (mode !== "select") return;
    const t = setTimeout(async () => {
      setSearchErr(""); setCandidates([]);
      const s = searchTerm.trim(); if (!s || !dbNullable) return;
      setSearchBusy(true);
      try { setCandidates(await searchPublicDojosByPrefix(dbNullable!, s, 20)); } catch (e: any) { setSearchErr(e?.message || "Search failed."); } finally { setSearchBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [mode, searchTerm]);

  // Validation
  const baseErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!f.ownerDisplayName.trim()) e.ownerDisplayName = "Please enter your name.";
    if (mode === "create" && !f.dojoName.trim()) e.dojoName = "Please enter gym name.";
    if (mode === "select" && !selectedDojo?.id) e.selectedDojo = "Please select an existing dojo.";
    return e;
  }, [f.ownerDisplayName, f.dojoName, mode, selectedDojo]);

  const emailErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMethod !== "email") return e;
    if (!f.email.trim()) e.email = "Email is required."; else if (!f.email.includes("@")) e.email = "Invalid email."; else if (emailCheckResult === "taken") e.email = "Already registered.";
    if (!f.password) e.password = "Password is required."; else if (f.password.length < 6) e.password = "At least 6 characters.";
    if (f.password !== f.password2) e.password2 = "Passwords do not match.";
    return e;
  }, [authMethod, f.email, f.password, f.password2, emailCheckResult]);

  const canGoogleSubmit = useMemo(() => Object.keys(baseErrors).length === 0, [baseErrors]);
  const canEmailSubmit = useMemo(() => Object.keys({ ...baseErrors, ...emailErrors }).length === 0, [baseErrors, emailErrors]);

  // ─────────────────────────────────────────
  // Google redirect
  // ─────────────────────────────────────────
  const startGoogleRedirect = async () => {
    if (busy || !canGoogleSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable) throw new Error("Auth is not ready.");
      if (mode === "create") saveStaffDraft({ mode: "create", next, dojoName: f.dojoName.trim(), country: f.country.trim(), city: f.city.trim(), website: f.website.trim(), phone: f.phone.trim(), ownerDisplayName: f.ownerDisplayName.trim() });
      else saveStaffDraft({ mode: "select", next, selectedDojo: selectedDojo!, ownerDisplayName: f.ownerDisplayName.trim() });
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(authNullable, provider);
    } catch (e) { setError(formatGoogleAuthError(e)); setBusy(false); }
  };

  // ✅ CHANGED: Google redirect handler — users/{uid} + pendingDojoAction のみ
  const redirectHandledRef = useRef(false);
  useEffect(() => {
    if (redirectHandledRef.current) return; redirectHandledRef.current = true;
    let cancelled = false;
    const run = async () => {
      try {
        const ready = await waitForFirebaseReady(8000); if (cancelled) return;
        if (!ready) { redirectHandledRef.current = false; return; }
        const { auth, db } = ready;
        const cred: UserCredential | null = await getRedirectResult(auth); if (!cred) return;
        const draft = loadStaffDraft();
        if (!draft) { setError("Signup data missing. Please try again."); try { await signOut(auth); } catch {} return; }
        setBusy(true); setError(""); setSuccess("");
        const uid = cred.user.uid;
        const email = (cred.user.email ?? "").trim().toLowerCase();
        if (!email) throw new Error("Google account email is missing.");
        const displayName = (draft.ownerDisplayName || cred.user.displayName || "").trim();
        if (displayName) await updateProfile(cred.user, { displayName }).catch(() => {});
        const userRef = doc(db, "users", uid);
        const existing = await getDoc(userRef);
        if (existing.exists()) { const role = existing.data()?.role; if (role && role !== "staff_member") throw new Error("This Google account is already used for a different account type."); }

        await setDoc(userRef, {
          uid, email, emailLower: email,
          displayName: displayName || null, displayNameLower: displayName ? displayName.toLowerCase() : null,
          roleUi: "staff", role: "staff_member", roles: ["staff_member"], accountType: "staff_member",
          staffProfile: draft.mode === "create"
            ? { dojoName: draft.dojoName, country: draft.country || "Canada", city: draft.city || "Vancouver", website: draft.website.trim() || null, phone: draft.phone.trim() || null }
            : { dojoName: draft.selectedDojo?.name ?? "", country: draft.selectedDojo?.country ?? null, city: draft.selectedDojo?.city ?? null, website: draft.selectedDojo?.website ?? null, phone: draft.selectedDojo?.phone ?? null },
          emailVerified: !!cred.user.emailVerified,
          pendingDojoAction: buildPendingFromDraft(draft),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
        }, { merge: true });

        clearStaffDraft();
        setSuccess("Account created! Verify your email to complete setup.");
        setTimeout(() => navigateAfterAuth(cred.user, router, draft.next || next), 800);
      } catch (e) { console.error("[StaffSignup][Google]", e); setError(formatGoogleAuthError(e)); try { if (authNullable) await signOut(authNullable); } catch {} }
      finally { setBusy(false); }
    };
    run(); return () => { cancelled = true; };
  }, [router, next]);

  // ✅ CHANGED: Email/Password — users/{uid} + pendingDojoAction のみ
  const handleSubmit = async () => {
    if (busy || authMethod !== "email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    let createdUser: { delete: () => Promise<void> } | null = null;
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable || !dbNullable) throw new Error("Firebase is not ready.");
      if (mode === "select" && !selectedDojo?.id) throw new Error("Please select a dojo.");
      const email = f.email.trim().toLowerCase();
      const displayName = f.ownerDisplayName.trim();
      const cred = await createUserWithEmailAndPassword(authNullable, email, f.password);
      createdUser = cred.user;
      if (displayName) await updateProfile(cred.user, { displayName }).catch(() => {});
      const userRef = doc(dbNullable, "users", cred.user.uid);
      await setDoc(userRef, {
        uid: cred.user.uid, email: cred.user.email ?? email, emailLower: email,
        displayName: displayName || null, displayNameLower: displayName ? displayName.toLowerCase() : null,
        roleUi: "staff", role: "staff_member", roles: ["staff_member"], accountType: "staff_member",
        staffProfile: mode === "create"
          ? { dojoName: f.dojoName.trim(), country: f.country.trim(), city: f.city.trim(), website: f.website.trim() || null, phone: f.phone.trim() || null }
          : { dojoName: selectedDojo?.name ?? "", country: selectedDojo?.country ?? null, city: selectedDojo?.city ?? null, website: selectedDojo?.website ?? null, phone: selectedDojo?.phone ?? null },
        pendingDojoAction: buildPendingFromForm(mode, f, selectedDojo),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
      }, { merge: true });
      // メール認証は /verify ページで sendSignInLinkToEmail() が送信するため、ここでは不要
      setSuccess("Account created! Verify your email to complete setup.");
      setTimeout(() => router.replace("/verify"), 1500);
    } catch (e) {
      const isAuth = e instanceof FirebaseError && e.code?.startsWith("auth/");
      if (!isAuth && createdUser) { try { await createdUser.delete(); } catch {} }
      setError(formatErr(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-100 mb-4"><span className="text-3xl">🏢</span></div>
          <h1 className="text-2xl font-bold text-slate-900">Staff Signup</h1>
          <p className="mt-2 text-sm text-slate-500">Create a new gym or join an existing one</p>
        </div>
        <div className="flex gap-2">
          <TabButton active={mode === "create"} onClick={() => { setMode("create"); setSearchTerm(""); setCandidates([]); setSelectedDojo(null); setError(""); setSuccess(""); }}>🆕 Create a Gym</TabButton>
          <TabButton active={mode === "select"} onClick={() => { setMode("select"); setError(""); setSuccess(""); }}>🔍 Join Existing</TabButton>
        </div>
        <div className="flex gap-2">
          <MethodButton active={authMethod === "google"} onClick={() => { setAuthMethod("google"); setError(""); setSuccess(""); }}>Google</MethodButton>
          <MethodButton active={authMethod === "email"} onClick={() => { setAuthMethod("email"); setError(""); setSuccess(""); }}>Email/Password</MethodButton>
        </div>
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}
        <Card><div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
          {mode === "create" && (<>
            <div className="text-sm font-semibold text-slate-700 mb-2">Gym Information</div>
            <Input label="Gym Name" placeholder="Enter gym name" value={f.dojoName} onChange={onChange("dojoName")} required error={!f.dojoName.trim() ? "Required." : undefined} />
            <div className="grid grid-cols-2 gap-3"><Input label="Country" value={f.country} onChange={onChange("country")} /><Input label="City" value={f.city} onChange={onChange("city")} /></div>
            <div className="grid grid-cols-2 gap-3"><Input label="Website" placeholder="https://..." value={f.website} onChange={onChange("website")} /><Input label="Phone" value={f.phone} onChange={onChange("phone")} /></div>
            <hr className="border-slate-100" />
          </>)}
          {mode === "select" && (<>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Search Gym</label>
              <input placeholder="Type gym name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300" />
              {searchBusy && <p className="text-xs text-slate-500">Searching...</p>}
              {searchErr && <p className="text-xs text-rose-600">{searchErr}</p>}
            </div>
            {candidates.length > 0 && (<div className="max-h-48 overflow-y-auto space-y-2">{candidates.map((d) => (
              <button key={d.id} type="button" onClick={() => setSelectedDojo(d)} className={`w-full text-left rounded-2xl border px-4 py-3 transition ${selectedDojo?.id === d.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <div className="font-semibold text-slate-900">{d.name ?? "(no name)"}</div><div className="text-sm text-slate-500">{d.city} {d.country}</div>
              </button>))}</div>)}
            {selectedDojo && (<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-emerald-800">Selected</div><div className="text-emerald-700">{selectedDojo.name}</div></div><button type="button" onClick={() => setSelectedDojo(null)} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">Clear</button></div></div>)}
            <p className="text-xs text-slate-500">* Join request will be sent after email verification.</p>
            <hr className="border-slate-100" />
          </>)}
          <div className="text-sm font-semibold text-slate-700 mb-2">Account Information</div>
          <Input label="Your Name" placeholder="Display name" value={f.ownerDisplayName} onChange={onChange("ownerDisplayName")} required error={!f.ownerDisplayName.trim() ? "Required." : undefined} />
          {authMethod === "google" && (<><GoogleSignInButton onClick={startGoogleRedirect} disabled={!canGoogleSubmit || busy} label="Continue with Google" /><p className="text-xs text-slate-500">* Gym setup completes after email verification.</p></>)}
          {authMethod === "email" && (<>
            <Input label="Email" type="email" placeholder="Email" value={f.email} onChange={onChange("email")} required hint={emailCheckResult === "checking" ? "Checking..." : undefined} success={emailCheckResult === "available" ? "Available" : undefined} error={emailErrors.email} />
            <Input label="Password" type="password" placeholder="At least 6 characters" value={f.password} onChange={onChange("password")} required error={emailErrors.password} />
            <Input label="Confirm Password" type="password" placeholder="Re-enter" value={f.password2} onChange={onChange("password2")} required error={emailErrors.password2} />
            <div className="pt-2"><PrimaryBtn onClick={handleSubmit} disabled={!canEmailSubmit || busy}>{busy ? "Creating..." : "Create Account"}</PrimaryBtn></div>
          </>)}
        </div></Card>
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">Already have an account? <button onClick={() => router.push("/login")} className="font-semibold text-slate-900 hover:underline">Log in</button></p>
          <p className="text-sm text-slate-500">Sign up as a student? <button onClick={() => router.push("/signup/student-profile")} className="font-semibold text-slate-900 hover:underline">Click here</button></p>
        </div>
      </div>
    </div>
  );
}