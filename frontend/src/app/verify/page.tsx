// app/verify/page.tsx
//
// 毎回ログイン時のメール認証ページ。
//
// フロー:
//   1. ログイン → navigateAfterAuth() → Go API /v1/auth/reset-email-verified で
//      emailVerified=false にリセット → /verify へリダイレクト
//   2. /verify → sendEmailVerification() でメール送信
//   3. ユーザーがどのデバイスでもリンクをクリック → Firebase Auth が emailVerified=true に
//   4. このページで user.reload() をポーリング → emailVerified==true を検知
//   5. sessionVerified=true にして /verify/success → /home

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  sendEmailVerification,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { authNullable, dbNullable } from "@/firebase";
import { markSessionVerified } from "@/lib/sessionVerification";

const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";
const COOLDOWN_SECONDS = 60;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);
const Alert = ({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) => {
  const cls = kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
};

export default function VerifyPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSentRef = useRef(false);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Auth state
  useEffect(() => {
    if (!authNullable) return;
    const unsub = onAuthStateChanged(authNullable, u => {
      if (!u) { router.replace("/login"); return; }
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ─────────────────────────────────────────
  // Polling: check emailVerified
  // ─────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return; // already polling
    setPolling(true);
    let attempts = 0;

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setPolling(false);
        setError("Verification timed out. Please resend the email.");
        return;
      }

      try {
        const u = authNullable?.currentUser;
        if (!u) return;

        await u.reload();
        const refreshed = authNullable?.currentUser;

        if (refreshed?.emailVerified) {
          // ✅ Email verified!
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPolling(false);

          // Force token refresh so Firestore rules see updated emailVerified
          await refreshed.getIdToken(true);

          // Mark session as verified in Firestore
          if (dbNullable) {
            await markSessionVerified(dbNullable, refreshed.uid);
          }

          setSuccess("Email verified! Redirecting...");
          setTimeout(() => router.replace("/verify/success"), 1000);
        }
      } catch (err) {
        console.error("[Verify] Polling error:", err);
      }
    }, POLL_INTERVAL_MS);
  }, [router]);

  // ─────────────────────────────────────────
  // Send verification email
  // ─────────────────────────────────────────
  const sendVerification = useCallback(async () => {
    if (!user || !authNullable || sending || cooldown > 0) return;
    setSending(true); setError(""); setSuccess("");
    try {
      console.log("[Verify] Sending verification email...");
      await sendEmailVerification(user);
      console.log("[Verify] Verification email sent");
      setSent(true);
      setCooldown(COOLDOWN_SECONDS);
      setSuccess(`Verification email sent to ${user.email}`);

      // Start polling for emailVerified
      startPolling();
    } catch (err: any) {
      console.error("[Verify] sendEmailVerification error:", err?.code, err?.message);
      if (err?.code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a few minutes.");
        setCooldown(COOLDOWN_SECONDS * 2);
        // Still start polling - email may have been sent before
        startPolling();
      } else {
        setError(err?.message || "Failed to send verification email.");
      }
    } finally { setSending(false); }
  }, [user, sending, cooldown, startPolling]);

  // Auto-send on first load
  useEffect(() => {
    if (autoSentRef.current || !user || loading) return;
    autoSentRef.current = true;
    sendVerification();
  }, [user, loading, sendVerification]);

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-4">
        <img src={LOGO_SRC} alt="Logo" className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
        <div className="flex items-center justify-center gap-2 text-slate-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <span>Loading...</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <img src={LOGO_SRC} alt="Logo" className="w-16 h-16 mx-auto mb-4 rounded-2xl shadow-lg" />
          <h1 className="text-2xl font-bold text-slate-900">Verify Your Identity</h1>
          <p className="mt-2 text-slate-500">For security, please verify your email each time you log in.</p>
        </div>

        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        <Card><div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">Verification email {sent ? "sent" : "will be sent"} to</div>
            <div className="font-semibold text-slate-900">{user?.email || "..."}</div>
          </div>

          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">1</div>
              <span>Check your email inbox (and spam folder)</span>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">2</div>
              <span>Click the verification link (works on any device)</span>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">3</div>
              <span>This page will automatically detect and redirect you</span>
            </div>
          </div>

          {polling && (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span>Waiting for verification...</span>
            </div>
          )}

          <button onClick={sendVerification} disabled={sending || cooldown > 0}
            className="w-full rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">
            {sending ? "Sending..." : cooldown > 0 ? `Resend in ${cooldown}s` : sent ? "Resend Verification Email" : "Send Verification Email"}
          </button>
        </div></Card>

        <div className="text-center">
          <button onClick={async () => {
            if (pollRef.current) clearInterval(pollRef.current);
            try { if (authNullable) await signOut(authNullable); } catch {}
            router.replace("/login");
          }} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  );
}