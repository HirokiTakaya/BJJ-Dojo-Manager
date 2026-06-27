// app/signup/staff/page.tsx
"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  fetchSignInMethodsForEmail,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc, getDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";
import { navigateAfterAuth } from "@/lib/navigateAfterAuth";
import type { PendingDojoAction } from "@/lib/completePendingDojoAction";

// ─────────────────────────────────────────────────────────────
// Types & Sub-components
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

function buildPendingFromForm(mode: Mode, f: FormState, selectedDojo: DojoLite | null): PendingDojoAction {
  if (mode === "create") {
    return { type: "staff_create_dojo", dojoName: f.dojoName.trim(), country: f.country.trim() || "Canada", city: f.city.trim() || "Vancouver", website: f.website.trim() || null, phone: f.phone.trim() || null };
  }
  return { type: "staff_join_dojo", dojoId: selectedDojo!.id, dojoName: selectedDojo?.name ?? "", country: selectedDojo?.country ?? null, city: selectedDojo?.city ?? null, website: selectedDojo?.website ?? null, phone: selectedDojo?.phone ?? null };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
export default function StaffSignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    }>
      <StaffSignupInner />
    </Suspense>
  );
}

function StaffSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";
  const t = useTranslations("signup.staff");

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

  function formatErr(e: unknown) {
    if (e instanceof FirebaseError) {
      if (e.code === "auth/email-already-in-use") return t("errors.emailInUse");
      if (e.code === "auth/invalid-email") return t("errors.invalidEmail");
      if (e.code === "auth/weak-password") return t("errors.weakPassword");
      if (e.code === "auth/network-request-failed") return t("errors.networkError");
      if (e.code === "permission-denied") return t("errors.permissionError");
      return `${e.code}: ${e.message}`;
    }
    if (e instanceof Error) return e.message;
    return t("errors.signupFailed");
  }

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
    const tt = setTimeout(async () => {
      setSearchErr(""); setCandidates([]);
      const s = searchTerm.trim(); if (!s || !dbNullable) return;
      setSearchBusy(true);
      try { setCandidates(await searchPublicDojosByPrefix(dbNullable!, s, 20)); } catch (e: any) { setSearchErr(e?.message || t("errors.searchFailed")); } finally { setSearchBusy(false); }
    }, 250);
    return () => clearTimeout(tt);
  }, [mode, searchTerm, t]);

  // Validation
  const baseErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!f.ownerDisplayName.trim()) e.ownerDisplayName = t("errors.ownerNameRequired");
    if (mode === "create" && !f.dojoName.trim()) e.dojoName = t("errors.dojoNameRequired");
    if (mode === "select" && !selectedDojo?.id) e.selectedDojo = t("errors.selectDojoRequired");
    return e;
  }, [f.ownerDisplayName, f.dojoName, mode, selectedDojo, t]);

  const emailErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMethod !== "email") return e;
    if (!f.email.trim()) e.email = t("errors.emailRequired"); else if (!f.email.includes("@")) e.email = t("errors.emailInvalid"); else if (emailCheckResult === "taken") e.email = t("alreadyRegistered");
    if (!f.password) e.password = t("errors.passwordRequired"); else if (f.password.length < 6) e.password = t("errors.passwordTooShort");
    if (f.password !== f.password2) e.password2 = t("errors.passwordMismatch");
    return e;
  }, [authMethod, f.email, f.password, f.password2, emailCheckResult, t]);

  const canGoogleSubmit = useMemo(() => Object.keys(baseErrors).length === 0, [baseErrors]);
  const canEmailSubmit = useMemo(() => Object.keys({ ...baseErrors, ...emailErrors }).length === 0, [baseErrors, emailErrors]);

  // Google sign-up via popup. Popup keeps us on the same page, so the form
  // values stay in memory and we can write the user doc immediately. This
  // avoids the sessionStorage draft being lost across a redirect round-trip
  // (which is what was bouncing users back to the signup screen).
  const startGoogleRedirect = async () => {
    if (busy || !canGoogleSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? t("errors.firebaseDisabled"));
      if (!authNullable || !dbNullable) throw new Error(t("errors.firebaseNotReady"));
      if (mode === "select" && !selectedDojo?.id) throw new Error(t("errors.selectDojoRequiredAlt"));

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(authNullable, provider);

      const uid = cred.user.uid;
      const email = (cred.user.email ?? "").trim().toLowerCase();
      if (!email) throw new Error(t("errors.googleEmailMissing"));
      const displayName = (f.ownerDisplayName.trim() || cred.user.displayName || "").trim();
      if (displayName) await updateProfile(cred.user, { displayName }).catch(() => {});

      const userRef = doc(dbNullable, "users", uid);
      const existing = await getDoc(userRef);
      if (existing.exists()) { const role = existing.data()?.role; if (role && role !== "staff_member") throw new Error(t("errors.googleAccountConflict")); }

      await setDoc(userRef, {
        uid, email, emailLower: email,
        displayName: displayName || null, displayNameLower: displayName ? displayName.toLowerCase() : null,
        roleUi: "staff", role: "staff_member", roles: ["staff_member"], accountType: "staff_member",
        staffProfile: mode === "create"
          ? { dojoName: f.dojoName.trim(), country: f.country.trim() || "Canada", city: f.city.trim() || "Vancouver", website: f.website.trim() || null, phone: f.phone.trim() || null }
          : { dojoName: selectedDojo?.name ?? "", country: selectedDojo?.country ?? null, city: selectedDojo?.city ?? null, website: selectedDojo?.website ?? null, phone: selectedDojo?.phone ?? null },
        emailVerified: !!cred.user.emailVerified,
        pendingDojoAction: buildPendingFromForm(mode, f, selectedDojo),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
      }, { merge: true });

      setSuccess(t("successCreated"));
      setTimeout(() => navigateAfterAuth(cred.user, router, next), 800);
    } catch (e) {
      console.error("[StaffSignup][Google]", e);
      setError(formatGoogleAuthError(e));
      try { if (authNullable) await signOut(authNullable); } catch {}
    } finally { setBusy(false); }
  };

  // (Google now uses signInWithPopup above — no redirect handler needed)


  const handleSubmit = async () => {
    if (busy || authMethod !== "email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    let createdUser: { delete: () => Promise<void> } | null = null;
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? t("errors.firebaseDisabled"));
      if (!authNullable || !dbNullable) throw new Error(t("errors.firebaseNotReady"));
      if (mode === "select" && !selectedDojo?.id) throw new Error(t("errors.selectDojoRequiredAlt"));
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
      setSuccess(t("successCreated"));
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
          <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <TabButton active={mode === "create"} onClick={() => { setMode("create"); setSearchTerm(""); setCandidates([]); setSelectedDojo(null); setError(""); setSuccess(""); }}>{t("tabCreate")}</TabButton>
          <TabButton active={mode === "select"} onClick={() => { setMode("select"); setError(""); setSuccess(""); }}>{t("tabJoin")}</TabButton>
        </div>
        <div className="flex gap-2">
          <MethodButton active={authMethod === "google"} onClick={() => { setAuthMethod("google"); setError(""); setSuccess(""); }}>{t("methodGoogle")}</MethodButton>
          <MethodButton active={authMethod === "email"} onClick={() => { setAuthMethod("email"); setError(""); setSuccess(""); }}>{t("methodEmail")}</MethodButton>
        </div>
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}
        <Card><div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
          {mode === "create" && (<>
            <div className="text-sm font-semibold text-slate-700 mb-2">{t("gymInformation")}</div>
            <Input label={t("gymNameLabel")} placeholder={t("gymNamePlaceholder")} value={f.dojoName} onChange={onChange("dojoName")} required error={!f.dojoName.trim() ? t("required") : undefined} />
            <div className="grid grid-cols-2 gap-3"><Input label={t("countryLabel")} value={f.country} onChange={onChange("country")} /><Input label={t("cityLabel")} value={f.city} onChange={onChange("city")} /></div>
            <div className="grid grid-cols-2 gap-3"><Input label={t("websiteLabel")} placeholder={t("websitePlaceholder")} value={f.website} onChange={onChange("website")} /><Input label={t("phoneLabel")} value={f.phone} onChange={onChange("phone")} /></div>
            <hr className="border-slate-100" />
          </>)}
          {mode === "select" && (<>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">{t("searchGym")}</label>
              <input placeholder={t("searchGymPlaceholder")} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300" />
              {searchBusy && <p className="text-xs text-slate-500">{t("searching")}</p>}
              {searchErr && <p className="text-xs text-rose-600">{searchErr}</p>}
            </div>
            {candidates.length > 0 && (<div className="max-h-48 overflow-y-auto space-y-2">{candidates.map((d) => (
              <button key={d.id} type="button" onClick={() => setSelectedDojo(d)} className={`w-full text-left rounded-2xl border px-4 py-3 transition ${selectedDojo?.id === d.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <div className="font-semibold text-slate-900">{d.name ?? t("noName")}</div><div className="text-sm text-slate-500">{d.city} {d.country}</div>
              </button>))}</div>)}
            {selectedDojo && (<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-emerald-800">{t("selected")}</div><div className="text-emerald-700">{selectedDojo.name}</div></div><button type="button" onClick={() => setSelectedDojo(null)} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">{t("clear")}</button></div></div>)}
            <p className="text-xs text-slate-500">{t("joinNoteAfterVerify")}</p>
            <hr className="border-slate-100" />
          </>)}
          <div className="text-sm font-semibold text-slate-700 mb-2">{t("accountInformation")}</div>
          <Input label={t("yourNameLabel")} placeholder={t("yourNamePlaceholder")} value={f.ownerDisplayName} onChange={onChange("ownerDisplayName")} required error={!f.ownerDisplayName.trim() ? t("required") : undefined} />
          {authMethod === "google" && (<>
            <button type="button" onClick={startGoogleRedirect} disabled={!canGoogleSubmit || busy}
              className="w-full flex items-center justify-center gap-3 rounded-full px-6 py-3 text-base font-semibold transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              {t("continueWithGoogle")}
            </button>
            <p className="text-xs text-slate-500">{t("googleNoteAfterVerify")}</p>
          </>)}
          {authMethod === "email" && (<>
            <Input label={t("emailLabel")} type="email" placeholder={t("emailPlaceholder")} value={f.email} onChange={onChange("email")} required hint={emailCheckResult === "checking" ? t("checking") : undefined} success={emailCheckResult === "available" ? t("available") : undefined} error={emailErrors.email} />
            <Input label={t("passwordLabel")} type="password" placeholder={t("passwordPlaceholder")} value={f.password} onChange={onChange("password")} required error={emailErrors.password} />
            <Input label={t("confirmPasswordLabel")} type="password" placeholder={t("confirmPasswordPlaceholder")} value={f.password2} onChange={onChange("password2")} required error={emailErrors.password2} />
            <div className="pt-2"><PrimaryBtn onClick={handleSubmit} disabled={!canEmailSubmit || busy}>{busy ? t("creating") : t("createAccount")}</PrimaryBtn></div>
          </>)}
        </div></Card>
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">{t("alreadyHaveAccount")} <button onClick={() => router.push("/login")} className="font-semibold text-slate-900 hover:underline">{t("logIn")}</button></p>
          <p className="text-sm text-slate-500">{t("signUpAsStudent")} <button onClick={() => router.push("/signup/student-profile")} className="font-semibold text-slate-900 hover:underline">{t("clickHere")}</button></p>
        </div>
      </div>
    </div>
  );
}