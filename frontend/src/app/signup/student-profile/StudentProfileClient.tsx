// app/signup/student-profile/page.tsx
// ✅ CHANGED: 登録時に dojoId をセットする代わりに pendingDojoAction に保存
//    メール認証完了後に verify/success で completePendingDojoAction() が実行される
//
// 変更箇所は "✅ CHANGED" で検索してください。
// ログインフローは変更なし（既存ユーザーは pendingDojoAction 不要）。

"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authNullable, dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  fetchSignInMethodsForEmail, signOut, GoogleAuthProvider, signInWithRedirect, getRedirectResult, type UserCredential,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import { formatGoogleAuthError } from "@/lib/google-auth";
import { navigateAfterAuth } from "@/lib/navigateAfterAuth";
import type { PendingDojoAction } from "@/lib/completePendingDojoAction";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Belt = "white"|"blue"|"purple"|"brown"|"black"|"kids-white"|"kids-grey"|"kids-yellow"|"kids-orange"|"kids-green";
const BELTS: { value: Belt; label: string }[] = [
  { value: "white", label: "White" },{ value: "blue", label: "Blue" },{ value: "purple", label: "Purple" },
  { value: "brown", label: "Brown" },{ value: "black", label: "Black" },{ value: "kids-white", label: "Kids - White" },
  { value: "kids-grey", label: "Kids - Grey" },{ value: "kids-yellow", label: "Kids - Yellow" },
  { value: "kids-orange", label: "Kids - Orange" },{ value: "kids-green", label: "Kids - Green" },
];
type AuthMode = "register" | "login";
type AuthMethod = "google" | "email";
interface FormState { fullName: string; email: string; password: string; password2: string; phone: string; belt: Belt; dojoName: string; dojoId: string | null; }

// Sub-components (same as before)
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (<div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>);
const Alert = ({ kind, children }: { kind: "error"|"success"|"info"; children: React.ReactNode }) => { const cls = kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"; return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>; };
const Input = ({ label, type="text", placeholder, value, onChange, onKeyPress, error, hint, success, required }: { label: string; type?: string; placeholder?: string; value: string; onChange: (v:string)=>void; onKeyPress?: (e:React.KeyboardEvent)=>void; error?: string; hint?: string; success?: string; required?: boolean; }) => (<label className="block space-y-1"><span className="text-sm font-semibold text-slate-700">{label} {required && <span className="text-rose-500">*</span>}</span><input type={type} placeholder={placeholder} value={value} onChange={(e)=>onChange(e.target.value)} onKeyPress={onKeyPress} className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${error?"border-rose-300 bg-rose-50":"border-slate-200 bg-white"}`}/>{hint&&<p className="text-xs text-slate-500">{hint}</p>}{success&&<p className="text-xs text-emerald-600">✓ {success}</p>}{error&&<p className="text-xs text-rose-600">{error}</p>}</label>);
const Select = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v:string)=>void; options: {value:string;label:string}[] }) => (<label className="block space-y-1"><span className="text-sm font-semibold text-slate-700">{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300">{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>);
const PrimaryBtn = ({ children, onClick, disabled, variant="primary" }: { children: React.ReactNode; onClick?: ()=>void; disabled?: boolean; variant?: "primary"|"success" }) => { const bg = variant==="success"?"bg-emerald-600 hover:bg-emerald-700":"bg-slate-900 hover:bg-slate-800"; return <button type="button" onClick={onClick} disabled={disabled} className={`w-full rounded-full px-6 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${bg}`}>{children}</button>; };
const TabButton = ({ active, onClick, children }: { active: boolean; onClick: ()=>void; children: React.ReactNode }) => (<button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active?"bg-slate-900 text-white":"bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>);
const MethodButton = ({ active, onClick, children }: { active: boolean; onClick: ()=>void; children: React.ReactNode }) => (<button type="button" onClick={onClick} className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active?"bg-emerald-600 text-white":"bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>);

function formatAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch(e.code) {
      case "auth/email-already-in-use": return "This email is already registered.";
      case "auth/invalid-email": return "Invalid email format.";
      case "auth/weak-password": return "Password too weak (at least 6 characters).";
      case "auth/user-not-found": case "auth/wrong-password": case "auth/invalid-credential": return "Invalid email or password.";
      case "auth/too-many-requests": return "Too many attempts. Try again later.";
      case "auth/network-request-failed": return "Network error.";
      default: return `${e.code}: ${e.message}`;
    }
  }
  if (e instanceof Error) return e.message;
  return "An error occurred.";
}

// Google redirect draft
const STUDENT_DRAFT_KEY = "student_google_signup_draft_v1";
const STUDENT_FLOW_KEY = "student_google_flow_v1";
type StudentDraft = { next: string; fullName: string; phone: string; belt: Belt; dojoId: string; dojoName: string; };
function saveDraft(d: StudentDraft) { sessionStorage.setItem(STUDENT_DRAFT_KEY, JSON.stringify(d)); }
function loadDraft(): StudentDraft | null { try { return JSON.parse(sessionStorage.getItem(STUDENT_DRAFT_KEY)??"null"); } catch { return null; } }
function clearDraft() { sessionStorage.removeItem(STUDENT_DRAFT_KEY); }
function setFlow(f: "register"|"login") { sessionStorage.setItem(STUDENT_FLOW_KEY, f); }
function getFlow(): "register"|"login"|null { const v=sessionStorage.getItem(STUDENT_FLOW_KEY); return v==="register"||v==="login"?v:null; }
function clearFlow() { sessionStorage.removeItem(STUDENT_FLOW_KEY); }

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
export default function StudentProfileClient() {
  return (<Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center"><div className="text-slate-500">Loading...</div></div>}><StudentSignupInner /></Suspense>);
}

function StudentSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";

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

  // Email check
  useEffect(() => {
    if (authMode !== "register" || authMethod !== "email") { setEmailStatus(""); return; }
    const email = form.email.trim().toLowerCase();
    if (!email || !email.includes("@")) { setEmailStatus(""); return; }
    setEmailStatus("checking");
    const t = setTimeout(async () => {
      if (!authNullable) { setEmailStatus(""); return; }
      try { const m = await fetchSignInMethodsForEmail(authNullable, email); setEmailStatus(m.length>0?"taken":"available"); } catch { setEmailStatus(""); }
    }, 500);
    return () => clearTimeout(t);
  }, [form.email, authMode, authMethod]);

  // Dojo search
  useEffect(() => {
    if (authMode !== "register") { setDojoCandidates([]); return; }
    const term = form.dojoName.trim();
    if (!term || term.length < 2 || selectedDojo || !dbNullable) { setDojoCandidates([]); return; }
    setDojoSearchBusy(true);
    const t = setTimeout(async () => {
      try { setDojoCandidates(await searchPublicDojosByPrefix(dbNullable!, term, 10)); } catch {} finally { setDojoSearchBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [form.dojoName, selectedDojo, authMode]);

  // Validation
  const baseErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMode === "register") { if (!form.fullName.trim()) e.fullName = "Please enter your name."; if (!form.dojoId) e.dojoId = "Please select a gym."; }
    return e;
  }, [authMode, form.fullName, form.dojoId]);

  const emailErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (authMethod !== "email") return e;
    if (!form.email.trim()) e.email = "Email is required."; else if (!form.email.includes("@")) e.email = "Invalid email."; else if (authMode==="register" && emailStatus==="taken") e.email = "Already registered.";
    if (!form.password) e.password = "Password is required."; else if (form.password.length<6) e.password = "At least 6 characters.";
    if (authMode==="register" && form.password!==form.password2) e.password2 = "Passwords do not match.";
    return e;
  }, [authMethod, authMode, form.email, form.password, form.password2, emailStatus]);

  const canGoogleRegister = useMemo(() => authMode !== "register" || (!!form.fullName.trim() && !!form.dojoId), [authMode, form.fullName, form.dojoId]);
  const canEmailSubmit = useMemo(() => Object.keys({...baseErrors,...emailErrors}).length===0, [baseErrors, emailErrors]);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => { setForm(p => ({...p,[key]:value})); setError(""); }, []);
  const selectDojo = useCallback((d: DojoLite) => { setSelectedDojo(d); setDojoCandidates([]); setForm(p=>({...p,dojoName:d.name??"",dojoId:d.id})); }, []);
  const clearDojo = useCallback(() => { setSelectedDojo(null); setForm(p=>({...p,dojoId:null})); }, []);

  // ─────────────────────────────────────────
  // ✅ CHANGED: Register (Email/Password)
  //    dojoId は pendingDojoAction に保存、users/{uid}.dojoId はセットしない
  // ─────────────────────────────────────────
  const handleRegister = async () => {
    if (busy || authMode!=="register" || authMethod!=="email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    let createdUser: { delete: () => Promise<void> } | null = null;
    try {
      if (!firebaseEnabled) throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
      if (!authNullable || !dbNullable) throw new Error("Firebase is not ready.");
      if (!form.dojoId) throw new Error("Please select a gym.");
      const email = form.email.trim().toLowerCase();
      const fullName = form.fullName.trim();
      const cred = await createUserWithEmailAndPassword(authNullable, email, form.password);
      createdUser = cred.user;
      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});

      // ✅ CHANGED: pendingDojoAction を保存、dojoId はまだセットしない
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
        // ✅ CHANGED: dojoId を直接セットしない（verify後に設定）
        // dojoId: form.dojoId,       ← 削除
        // dojoName: form.dojoName,   ← 削除
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

      // メール認証は /verify で sendSignInLinkToEmail() が送信するため不要
      setSuccess("Account created! Please verify your email.");
      setTimeout(() => router.replace("/verify"), 1500);
    } catch (e) {
      const isAuth = e instanceof FirebaseError && e.code?.startsWith("auth/");
      if (!isAuth && createdUser) { try { await createdUser.delete(); } catch {} }
      setError(formatAuthError(e));
    } finally { setBusy(false); }
  };

  // Login (Email/Password) — 変更なし
  const handleLogin = async () => {
    if (busy || authMode!=="login" || authMethod!=="email" || !canEmailSubmit) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!authNullable) throw new Error("Auth is not ready.");
      const cred = await signInWithEmailAndPassword(authNullable, form.email.trim().toLowerCase(), form.password);
      if (!cred.user.emailVerified) {
        // メール認証は /verify で sendSignInLinkToEmail() が送信するため不要
        setSuccess("Please verify your email first.");
        setTimeout(() => router.replace("/verify"), 1500);
        return;
      }
      setSuccess("Login successful!");
      navigateAfterAuth(cred.user, router, next);
    } catch (e) { setError(formatAuthError(e)); } finally { setBusy(false); }
  };

  // ✅ CHANGED: Google register redirect
  const startGoogleRegisterRedirect = async () => {
    if (busy || authMode!=="register" || !canGoogleRegister) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!firebaseEnabled || !authNullable) throw new Error("Firebase is not ready.");
      if (!form.dojoId) throw new Error("Please select a gym.");
      setFlow("register");
      saveDraft({ next, fullName: form.fullName.trim(), phone: form.phone.trim(), belt: form.belt, dojoId: form.dojoId, dojoName: form.dojoName.trim() });
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(authNullable, provider);
    } catch (e) { setError(formatGoogleAuthError(e)); setBusy(false); }
  };

  // Google login redirect — 変更なし
  const startGoogleLoginRedirect = async () => {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!authNullable) throw new Error("Auth is not ready.");
      setFlow("login");
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(authNullable, provider);
    } catch (e) { setError(formatGoogleAuthError(e)); setBusy(false); }
  };

  // ✅ CHANGED: Google redirect result handler
  const redirectHandledRef = useRef(false);
  useEffect(() => {
    if (redirectHandledRef.current) return; redirectHandledRef.current = true;
    const run = async () => {
      try {
        if (!authNullable || !dbNullable) return;
        const cred: UserCredential | null = await getRedirectResult(authNullable); if (!cred) return;
        const flow = getFlow(); clearFlow();
        const uid = cred.user.uid;
        const email = (cred.user.email??"").trim().toLowerCase();
        if (!email) throw new Error("Google account email is missing.");
        setBusy(true); setError(""); setSuccess("");
        const userRef = doc(dbNullable, "users", uid);

        if (flow === "register") {
          const draft = loadDraft(); clearDraft();
          if (!draft) { setError("Signup data missing. Please try again."); try { await signOut(authNullable); } catch {} return; }
          const fullName = (draft.fullName || cred.user.displayName || "").trim();
          if (fullName) await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
          const existing = await getDoc(userRef);
          if (existing.exists()) { const role = existing.data()?.role; if (role && role !== "student") throw new Error("This Google account is already used for a different account type."); }

          // ✅ CHANGED: pendingDojoAction を保存、dojoId はまだセットしない
          const pendingDojoAction: PendingDojoAction = {
            type: "student_join_dojo",
            dojoId: draft.dojoId,
            dojoName: draft.dojoName,
          };

          await setDoc(userRef, {
            uid, email, emailLower: email,
            displayName: fullName || cred.user.displayName || null,
            displayNameLower: (fullName || cred.user.displayName || "").toLowerCase() || null,
            // ✅ CHANGED: dojoId を直接セットしない
            role: "student", roles: ["student"], accountType: "student", roleUi: "student",
            studentProfile: {
              fullName: fullName || cred.user.displayName || "", email,
              phone: draft.phone || null, belt: draft.belt,
              dojoName: draft.dojoName || null, dojoId: draft.dojoId ?? null,
              createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            },
            onboardingComplete: false, emailVerified: !!cred.user.emailVerified,
            pendingDojoAction,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
          }, { merge: true });

          setSuccess("Account created! Verify your email to join the gym.");
          setTimeout(() => navigateAfterAuth(cred.user, router, next), 800);
          return;
        }

        // Login flow — 変更なし
        const snap = await getDoc(userRef);
        if (!snap.exists()) throw new Error("No profile found. Please sign up first.");
        const role = snap.data()?.role;
        if (role && role !== "student") throw new Error("This Google account is not a student account.");
        await setDoc(userRef, { lastLoginAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        setSuccess("Login successful!");
        navigateAfterAuth(cred.user, router, next);
      } catch (e) {
        console.error("[Student][Google]", e); setError(formatGoogleAuthError(e));
        try { if (authNullable) await signOut(authNullable); } catch {}
      } finally { setBusy(false); }
    };
    run();
  }, [router, next]);

  const handleKeyPress = (e: React.KeyboardEvent) => { if (e.key==="Enter" && !busy && authMethod==="email") authMode==="register"?handleRegister():handleLogin(); };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 mb-4"><span className="text-3xl">🥋</span></div>
          <h1 className="text-2xl font-bold text-slate-900">{authMode==="register"?"Create Student Account":"Student Login"}</h1>
          <p className="mt-2 text-sm text-slate-500">{authMode==="register"?"Fill in your profile first":"Welcome back!"}</p>
        </div>
        <div className="flex gap-2">
          <TabButton active={authMode==="register"} onClick={()=>{setAuthMode("register");setError("");setSuccess("");}}>Sign up</TabButton>
          <TabButton active={authMode==="login"} onClick={()=>{setAuthMode("login");setError("");setSuccess("");}}>Log in</TabButton>
        </div>
        <div className="flex gap-2">
          <MethodButton active={authMethod==="google"} onClick={()=>{setAuthMethod("google");setError("");setSuccess("");}}>Google</MethodButton>
          <MethodButton active={authMethod==="email"} onClick={()=>{setAuthMethod("email");setError("");setSuccess("");}}>Email/Password</MethodButton>
        </div>
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}
        <Card><div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
          {authMode==="register" && (<>
            <Input label="Full Name" placeholder="e.g., Taro Yamada" value={form.fullName} onChange={v=>updateField("fullName",v)} onKeyPress={handleKeyPress} error={baseErrors.fullName} required />
            <Input label="Phone" type="tel" placeholder="optional" value={form.phone} onChange={v=>updateField("phone",v)} />
            <Select label="Current Belt" value={form.belt} onChange={v=>updateField("belt",v as Belt)} options={BELTS} />
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Gym <span className="text-rose-500">*</span></label>
              <input placeholder="Search gym name..." value={form.dojoName} onChange={e=>{updateField("dojoName",e.target.value);updateField("dojoId",null);setSelectedDojo(null);}}
                className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${baseErrors.dojoId?"border-rose-300 bg-rose-50":"border-slate-200 bg-white"}`} />
              {dojoSearchBusy && <p className="text-xs text-slate-500">Searching...</p>}
              {selectedDojo && <div className="flex items-center gap-2 text-sm text-emerald-600"><span>✓ {selectedDojo.name}</span><button type="button" onClick={clearDojo} className="text-slate-500 hover:text-slate-700 underline">Clear</button></div>}
              {baseErrors.dojoId && <p className="text-xs text-rose-600">{baseErrors.dojoId}</p>}
              {dojoCandidates.length>0 && <div className="max-h-32 overflow-y-auto rounded-2xl border border-slate-200">{dojoCandidates.map(d=>(<button key={d.id} type="button" onClick={()=>selectDojo(d)} className="w-full text-left px-4 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"><div className="font-semibold text-sm text-slate-900">{d.name}</div><div className="text-xs text-slate-500">{d.city} {d.country}</div></button>))}</div>}
            </div>
            <hr className="border-slate-100" />
          </>)}
          {authMethod==="google" && (<>
            <GoogleSignInButton onClick={authMode==="register"?startGoogleRegisterRedirect:startGoogleLoginRedirect} disabled={authMode==="register"?!canGoogleRegister||busy:busy} label={authMode==="register"?"Continue with Google":"Log in with Google"} />
            {authMode==="register" && <p className="text-xs text-slate-500">* Gym join completes after email verification.</p>}
          </>)}
          {authMethod==="email" && (<>
            <Input label="Email" type="email" placeholder="e.g., taro@email.com" value={form.email} onChange={v=>updateField("email",v)} onKeyPress={handleKeyPress} error={emailErrors.email}
              hint={authMode==="register"&&emailStatus==="checking"?"Checking...":undefined} success={authMode==="register"&&emailStatus==="available"?"Available":undefined} required />
            <Input label="Password" type="password" placeholder={authMode==="register"?"At least 6 characters":"Password"} value={form.password} onChange={v=>updateField("password",v)} onKeyPress={handleKeyPress} error={emailErrors.password} required />
            {authMode==="register" && <Input label="Confirm Password" type="password" placeholder="Re-enter" value={form.password2} onChange={v=>updateField("password2",v)} onKeyPress={handleKeyPress} error={emailErrors.password2} required />}
            {authMode==="login" && <div className="text-right"><button type="button" onClick={()=>router.push(`/forgot-password?email=${encodeURIComponent(form.email)}`)} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">Forgot password?</button></div>}
            <div className="pt-2"><PrimaryBtn onClick={authMode==="register"?handleRegister:handleLogin} disabled={!canEmailSubmit||busy} variant={authMode==="register"?"success":"primary"}>{busy?authMode==="register"?"Creating...":"Logging in...":authMode==="register"?"Create Account":"Log in"}</PrimaryBtn></div>
          </>)}
        </div></Card>
        <div className="text-center"><p className="text-sm text-slate-500">Sign up as staff? <button onClick={()=>router.push("/signup/staff")} className="font-semibold text-slate-900 hover:underline">Click here</button></p></div>
      </div>
    </div>
  );
}