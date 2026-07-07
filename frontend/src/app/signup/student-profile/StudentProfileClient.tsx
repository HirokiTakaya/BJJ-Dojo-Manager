"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  fetchSignInMethodsForEmail, signOut, GoogleAuthProvider, signInWithPopup,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";
import { navigateAfterAuth } from "@/lib/navigateAfterAuth";
import type { PendingDojoAction } from "@/lib/completePendingDojoAction";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Belt = "white"|"blue"|"purple"|"brown"|"black"|"kids-white"|"kids-grey"|"kids-yellow"|"kids-orange"|"kids-green";

const BELT_KEYS: { value: Belt; key: string }[] = [
  { value: "white", key: "beltWhite" }, { value: "blue", key: "beltBlue" }, { value: "purple", key: "beltPurple" },
  { value: "brown", key: "beltBrown" }, { value: "black", key: "beltBlack" },
  { value: "kids-white", key: "beltKidsWhite" }, { value: "kids-grey", key: "beltKidsGrey" },
  { value: "kids-yellow", key: "beltKidsYellow" }, { value: "kids-orange", key: "beltKidsOrange" }, { value: "kids-green", key: "beltKidsGreen" },
];

type AuthMode = "register" | "login";
type AuthMethod = "google" | "email";
interface FormState { fullName: string; email: string; password: string; password2: string; phone: string; belt: Belt; dojoName: string; dojoId: string | null; }

// Sub-components
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (<div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>);
const Alert = ({ kind, children }: { kind: "error"|"success"|"info"; children: React.ReactNode }) => { const cls = kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"; return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>; };
const Input = ({ label, type="text", placeholder, value, onChange, onKeyPress, error, hint, success, required }: { label: string; type?: string; placeholder?: string; value: string; onChange: (v:string)=>void; onKeyPress?: (e:React.KeyboardEvent)=>void; error?: string; hint?: string; success?: string; required?: boolean; }) => (<label className="block space-y-1"><span className="text-sm font-semibold text-slate-700">{label} {required && <span className="text-rose-500">*</span>}</span><input type={type} placeholder={placeholder} value={value} onChange={(e)=>onChange(e.target.value)} onKeyPress={onKeyPress} className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${error?"border-rose-300 bg-rose-50":"border-slate-200 bg-white"}`}/>{hint&&<p className="text-xs text-slate-500">{hint}</p>}{success&&<p className="text-xs text-emerald-600">✓ {success}</p>}{error&&<p className="text-xs text-rose-600">{error}</p>}</label>);
const Select = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v:string)=>void; options: {value:string;label:string}[] }) => (<label className="block space-y-1"><span className="text-sm font-semibold text-slate-700">{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300">{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>);
const PrimaryBtn = ({ children, onClick, disabled, variant="primary" }: { children: React.ReactNode; onClick?: ()=>void; disabled?: boolean; variant?: "primary"|"success" }) => { const bg = variant==="success"?"bg-emerald-600 hover:bg-emerald-700":"bg-slate-900 hover:bg-slate-800"; return <button type="button" onClick={onClick} disabled={disabled} className={`w-full rounded-full px-6 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${bg}`}>{children}</button>; };
const TabButton = ({ active, onClick, children }: { active: boolean; onClick: ()=>void; children: React.ReactNode }) => (<button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active?"bg-slate-900 text-white":"bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>);
const MethodButton = ({ active, onClick, children }: { active: boolean; onClick: ()=>void; children: React.ReactNode }) => (<button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active?"bg-emerald-600 text-white":"bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>);
const GoogleBtn = ({ onClick, disabled, label }: { onClick: ()=>void; disabled?: boolean; label: string }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className="w-full flex items-center justify-center gap-3 rounded-full px-6 py-3 text-base font-semibold transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
    <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
    {label}
  </button>
);

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
export default function StudentProfileClient() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    }>
      <StudentSignupInner />
    </Suspense>
  );
}

function StudentSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";
  const t = useTranslations("signup.studentProfile");

  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("google");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [emailStatus, setEmailStatus] = useState<""|"checking"|"available"|"taken">("");
  const [form, setForm] = useState<FormState>({ fullName: "", email: "", password: "", password2: "", phone: "", belt: "white", dojoName: "", dojoId: null });
  const [dojoSearchBusy, setDojoSearchBusy] = useState(false);
  const [dojoCandidates, setDojoCandidates] = useState<DojoLite[]>([]);
  const [selectedDojo, setSelectedDojo] = useState<DojoLite | null>(null);

  // Belt options translated
  const BELTS = useMemo(() => BELT_KEYS.map(b => ({ value: b.value, label: t(b.key as any) })), [t]);

  function formatAuthError(e: unknown): string {
    if (e instanceof FirebaseError) {
      switch(e.code) {
        case "auth/email-already-in-use": return t("errors.emailInUse");
        case "auth/invalid-email": return t("errors.invalidEmailFormat");
        case "auth/weak-password": return t("errors.weakPassword");
        case "auth/user-not-found": case "auth/wrong-password": case "auth/invalid-credential": return t("errors.invalidCredentials");
        case "auth/too-many-requests": return t("errors.tooManyAttempts");
        case "auth/network-request-failed": return t("errors.networkError");
        default: return `${e.code}: ${e.message}`;
      }
    }
    if (e instanceof Error) return e.message;
    return t("errors.anError");
  }

  // Email check
  useEffect(() => {
    if (authMode !== "register" || authMethod !== "email") { setEmailStatus(""); return; }
    const email = form.email.trim().toLowerCase();
    if (!email || !email.includes("@")) { setEmailStatus(""); return; }
    setEmailStatus("checking");
    const tt = setTimeout(async () => {
      if (!authNullable) { setEmailStatus(""); return; }
      try { const m = await fetchSignInMethodsForEmail(authNullable, email); setEmailStatus(m.length>0?"taken":"available"); } catch { setEmailStatus(""); }
    }, 500);
    return () => clearTimeout(tt);
  }, [form.email, authMode, authMethod]);

  // Dojo search
  useEffect(() => {
    if (authMode !== "register") { setDojoCandidates([]); return; }
    const term = form.dojoName.trim();
    if (!term || term.length < 2 || selectedDojo || !dbNullable) { setDojoCandidates([]); return; }
    setDojoSearchBusy(true);
    const tt = setTimeout(async () => {
      try { setDojoCandidates(await searchPublicDojosByPrefix(dbNullable!, term, 10)); } catch {} finally { setDojoSearchBusy(false); }
    }, 300);
    return () => clearTimeout(tt);
  }, [form.dojoName, selectedDojo, authMode]);

  // Validation
  const baseErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMode === "register") {
      if (!form.fullName.trim()) e.fullName = t("errors.nameRequired");
      if (!form.dojoId) e.dojoId = t("errors.gymRequired");
    }
    return e;
  }, [authMode, form.fullName, form.dojoId, t]);

  const emailErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMethod !== "email") return e;
    if (!form.email.trim()) e.email = t("errors.emailRequired");
    else if (!form.email.includes("@")) e.email = t("errors.emailInvalid");
    else if (authMode==="register" && emailStatus==="taken") e.email = t("alreadyRegistered");
    if (!form.password) e.password = t("errors.passwordRequired");
    else if (form.password.length<6) e.password = t("errors.passwordTooShort");
    if (authMode==="register" && form.password!==form.password2) e.password2 = t("errors.passwordMismatch");
    return e;
  }, [authMethod, authMode, form.email, form.password, form.password2, emailStatus, t]);

  const canGoogleRegister = useMemo(() => authMode !== "register" || (!!form.fullName.trim() && !!form.dojoId), [authMode, form.fullName, form.dojoId]);
  const canEmailSubmit = useMemo(() => Object.keys({...baseErrors,...emailErrors}).length===0, [baseErrors, emailErrors]);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => { setForm(p => ({...p,[key]:value})); setError(""); }, []);
  const selectDojo = useCallback((d: DojoLite) => { setSelectedDojo(d); setDojoCandidates([]); setForm(p=>({...p,dojoName:d.name??"",dojoId:d.id})); }, []);
  const clearDojo = useCallback(() => { setSelectedDojo(null); setForm(p=>({...p,dojoId:null})); }, []);

  // Register (Email/Password)
  const handleRegister = async () => {
    if (busy || authMode!=="register" || authMethod!=="email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    let createdUser: { delete: () => Promise<void> } | null = null;
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? t("errors.firebaseDisabled"));
      if (!authNullable || !dbNullable) throw new Error(t("errors.firebaseNotReady"));
      if (!form.dojoId) throw new Error(t("errors.gymRequired"));
      const email = form.email.trim().toLowerCase();
      const fullName = form.fullName.trim();
      const cred = await createUserWithEmailAndPassword(authNullable, email, form.password);
      createdUser = cred.user;
      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});

      const pendingDojoAction: PendingDojoAction = {
        type: "student_join_dojo",
        dojoId: form.dojoId,
        dojoName: form.dojoName.trim(),
      };

      const userRef = doc(dbNullable, "users", cred.user.uid);
      await setDoc(userRef, {
        uid: cred.user.uid,
        email: cred.user.email ?? email, emailLower: email,
        displayName: fullName, displayNameLower: fullName.toLowerCase(),
        role: "student", roles: ["student"], accountType: "student", roleUi: "student",
        studentProfile: {
          fullName, email,
          phone: form.phone.trim() || null, belt: form.belt,
          dojoName: form.dojoName.trim() || null, dojoId: form.dojoId ?? null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        },
        onboardingComplete: false, emailVerified: false,
        pendingDojoAction,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
      }, { merge: true });

      setSuccess(t("successCreated"));
      setTimeout(() => router.replace("/verify"), 1500);
    } catch (e) {
      const isAuth = e instanceof FirebaseError && e.code?.startsWith("auth/");
      if (!isAuth && createdUser) { try { await createdUser.delete(); } catch {} }
      setError(formatAuthError(e));
    } finally { setBusy(false); }
  };

  // Login (Email/Password)
  const handleLogin = async () => {
    if (busy || authMode!=="login" || authMethod!=="email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!authNullable) throw new Error(t("errors.authNotReady"));
      const cred = await signInWithEmailAndPassword(authNullable, form.email.trim().toLowerCase(), form.password);
      if (!cred.user.emailVerified) {
        setSuccess(t("successLoginVerifyFirst"));
        setTimeout(() => router.replace("/verify"), 1500);
        return;
      }
      setSuccess(t("successLogin"));
      navigateAfterAuth(cred.user, router, next);
    } catch (e) { setError(formatAuthError(e)); } finally { setBusy(false); }
  };

  // Google sign-up via popup. Popup keeps us on this page, so the form values
  // stay in memory and we write users/{uid} immediately — no sessionStorage
  // draft that could be lost across a redirect round-trip (which was bouncing
  // users back to the signup screen).
  const startGoogleRegisterRedirect = async () => {
    if (busy || authMode!=="register" || !canGoogleRegister) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!firebaseEnabled || !authNullable || !dbNullable) throw new Error(t("errors.firebaseNotReady"));
      if (!form.dojoId) throw new Error(t("errors.gymRequired"));

      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(authNullable, provider);

      const uid = cred.user.uid;
      const email = (cred.user.email??"").trim().toLowerCase();
      if (!email) throw new Error(t("errors.googleEmailMissing"));
      const fullName = (form.fullName.trim() || cred.user.displayName || "").trim();
      if (fullName) await updateProfile(cred.user, { displayName: fullName }).catch(() => {});

      const userRef = doc(dbNullable, "users", uid);
      const existing = await getDoc(userRef);
      if (existing.exists()) { const role = existing.data()?.role; if (role && role !== "student") throw new Error(t("errors.googleAccountConflict")); }

      const pendingDojoAction: PendingDojoAction = {
        type: "student_join_dojo",
        dojoId: form.dojoId,
        dojoName: form.dojoName.trim(),
      };

      await setDoc(userRef, {
        uid, email, emailLower: email,
        displayName: fullName || cred.user.displayName || null,
        displayNameLower: (fullName || cred.user.displayName || "").toLowerCase() || null,
        role: "student", roles: ["student"], accountType: "student", roleUi: "student",
        studentProfile: {
          fullName: fullName || cred.user.displayName || "", email,
          phone: form.phone.trim() || null, belt: form.belt,
          dojoName: form.dojoName.trim() || null, dojoId: form.dojoId ?? null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        },
        onboardingComplete: false, emailVerified: !!cred.user.emailVerified,
        pendingDojoAction,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
      }, { merge: true });

      setSuccess(t("successCreatedJoin"));
      setTimeout(() => navigateAfterAuth(cred.user, router, next), 800);
    } catch (e) {
      console.error("[Student][Google]", e); setError(formatGoogleAuthError(e));
      try { if (authNullable) await signOut(authNullable); } catch {}
    } finally { setBusy(false); }
  };

  const startGoogleLoginRedirect = async () => {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!authNullable || !dbNullable) throw new Error(t("errors.authNotReady"));
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(authNullable, provider);

      const email = (cred.user.email??"").trim().toLowerCase();
      if (!email) throw new Error(t("errors.googleEmailMissing"));

      const userRef = doc(dbNullable, "users", cred.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) throw new Error(t("errors.noProfileFound"));
      const role = snap.data()?.role;
      if (role && role !== "student") throw new Error(t("errors.notStudentAccount"));
      await setDoc(userRef, { lastLoginAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      setSuccess(t("successLogin"));
      navigateAfterAuth(cred.user, router, next);
    } catch (e) {
      console.error("[Student][Google]", e); setError(formatGoogleAuthError(e));
      try { if (authNullable) await signOut(authNullable); } catch {}
    } finally { setBusy(false); }
  };

  // (Google now uses signInWithPopup above — no redirect handler needed)

  const handleKeyPress = (e: React.KeyboardEvent) => { if (e.key==="Enter" && !busy && authMethod==="email") authMode==="register"?handleRegister():handleLogin(); };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 mb-4"><span className="text-3xl">🥋</span></div>
          <h1 className="text-2xl font-bold text-slate-900">{authMode==="register" ? t("createTitle") : t("loginTitle")}</h1>
          <p className="mt-2 text-sm text-slate-500">{authMode==="register" ? t("createSubtitle") : t("loginSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <TabButton active={authMode==="register"} onClick={()=>{setAuthMode("register");setError("");setSuccess("");}}>{t("tabSignUp")}</TabButton>
          <TabButton active={authMode==="login"} onClick={()=>{setAuthMode("login");setError("");setSuccess("");}}>{t("tabLogIn")}</TabButton>
        </div>
        <div className="flex gap-2">
          <MethodButton active={authMethod==="google"} onClick={()=>{setAuthMethod("google");setError("");setSuccess("");}}>{t("methodGoogle")}</MethodButton>
          <MethodButton active={authMethod==="email"} onClick={()=>{setAuthMethod("email");setError("");setSuccess("");}}>{t("methodEmail")}</MethodButton>
        </div>
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}
        <Card><div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
          {authMode==="register" && (<>
            <Input label={t("nameLabel")} placeholder={t("namePlaceholder")} value={form.fullName} onChange={v=>updateField("fullName",v)} onKeyPress={handleKeyPress} error={baseErrors.fullName} required />
            <Input label={t("phoneLabel")} type="tel" placeholder={t("phonePlaceholderOptional")} value={form.phone} onChange={v=>updateField("phone",v)} />
            <Select label={t("beltLabel")} value={form.belt} onChange={v=>updateField("belt",v as Belt)} options={BELTS} />
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">{t("gymLabel")} <span className="text-rose-500">*</span></label>
              <input placeholder={t("gymSearchPlaceholder")} value={form.dojoName} onChange={e=>{updateField("dojoName",e.target.value);updateField("dojoId",null);setSelectedDojo(null);}}
                className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${baseErrors.dojoId?"border-rose-300 bg-rose-50":"border-slate-200 bg-white"}`} />
              {dojoSearchBusy && <p className="text-xs text-slate-500">{t("searching")}</p>}
              {selectedDojo && <div className="flex items-center gap-2 text-sm text-emerald-600"><span>✓ {selectedDojo.name}</span><button type="button" onClick={clearDojo} className="text-slate-500 hover:text-slate-700 underline">{t("clear")}</button></div>}
              {baseErrors.dojoId && <p className="text-xs text-rose-600">{baseErrors.dojoId}</p>}
              {dojoCandidates.length>0 && <div className="max-h-32 overflow-y-auto rounded-2xl border border-slate-200">{dojoCandidates.map(d=>(<button key={d.id} type="button" onClick={()=>selectDojo(d)} className="w-full text-left px-4 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"><div className="font-semibold text-sm text-slate-900">{d.name}</div><div className="text-xs text-slate-500">{d.city} {d.country}</div></button>))}</div>}
            </div>
            <hr className="border-slate-100" />
          </>)}
          {authMethod==="google" && (<>
            <GoogleBtn
              onClick={authMode==="register"?startGoogleRegisterRedirect:startGoogleLoginRedirect}
              disabled={authMode==="register"?!canGoogleRegister||busy:busy}
              label={authMode==="register"?t("continueWithGoogle"):t("loginWithGoogle")}
            />
            {authMode==="register" && <p className="text-xs text-slate-500">{t("googleNoteAfterVerify")}</p>}
          </>)}
          {authMethod==="email" && (<>
            <Input label={t("emailLabel")} type="email" placeholder={t("emailPlaceholder")} value={form.email} onChange={v=>updateField("email",v)} onKeyPress={handleKeyPress} error={emailErrors.email}
              hint={authMode==="register"&&emailStatus==="checking"?t("checking"):undefined} success={authMode==="register"&&emailStatus==="available"?t("available"):undefined} required />
            <Input label={t("passwordLabel")} type="password" placeholder={authMode==="register"?t("passwordPlaceholderRegister"):t("passwordPlaceholderLogin")} value={form.password} onChange={v=>updateField("password",v)} onKeyPress={handleKeyPress} error={emailErrors.password} required />
            {authMode==="register" && <Input label={t("confirmPasswordLabel")} type="password" placeholder={t("confirmPasswordPlaceholder")} value={form.password2} onChange={v=>updateField("password2",v)} onKeyPress={handleKeyPress} error={emailErrors.password2} required />}
            {authMode==="login" && <div className="text-right"><button type="button" onClick={()=>router.push(`/forgot-password?email=${encodeURIComponent(form.email)}`)} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">{t("forgotPassword")}</button></div>}
            <div className="pt-2"><PrimaryBtn onClick={authMode==="register"?handleRegister:handleLogin} disabled={!canEmailSubmit||busy} variant={authMode==="register"?"success":"primary"}>{busy?(authMode==="register"?t("creating"):t("loggingIn")):(authMode==="register"?t("createAccount"):t("logIn"))}</PrimaryBtn></div>
          </>)}
        </div></Card>
        <div className="text-center"><p className="text-sm text-slate-500">{t("signUpAsStaff")} <button onClick={()=>router.push("/signup/staff")} className="font-semibold text-slate-900 hover:underline">{t("clickHere")}</button></p></div>
      </div>
    </div>
  );
}