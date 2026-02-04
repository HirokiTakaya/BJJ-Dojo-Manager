// app/login/page.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { authNullable } from "@/firebase";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { handleGoogleRedirectResult } from "@/lib/google";

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);

const Alert = ({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) => {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";
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
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onKeyPress?: (e: React.KeyboardEvent) => void;
  error?: string;
  autoComplete?: string;
}) => (
  <label className="block space-y-1">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyPress={onKeyPress}
      autoComplete={autoComplete}
      className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
        error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
      }`}
    />
    {error && <p className="text-xs text-rose-600">{error}</p>}
  </label>
);

const Divider = ({ text }: { text: string }) => (
  <div className="relative my-6">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full border-t border-slate-200" />
    </div>
    <div className="relative flex justify-center text-sm">
      <span className="bg-white px-4 text-slate-500">{text}</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="text-slate-500">Loading...</div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Handle Google redirect result on mount
  useEffect(() => {
    handleGoogleRedirectResult().then((result) => {
      if (result?.success) {
        if (result.needsRoleSelection) {
          router.push("/register/select");
        } else {
          router.push(next);
        }
      } else if (result?.error) {
        setError(result.error);
      }
    });
  }, [router, next]);

  const handleLogin = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Please enter email and password.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!authNullable) throw new Error("Auth is not ready.");

      const cred = await signInWithEmailAndPassword(
        authNullable,
        email.trim().toLowerCase(),
        password
      );

      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        setSuccess("Please verify your email first.");
        setTimeout(() => router.push("/verify"), 1500);
        return;
      }

      setSuccess("Login successful!");
      router.push(next);
    } catch (err: any) {
      console.error("[Login] Error:", err);

      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setError("Invalid email or password.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else {
        setError(err.message || "Login failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <img
            src="/assets/jiujitsu-samurai-Logo.png"
            alt="Logo"
            className="w-16 h-16 mx-auto mb-4 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold text-slate-900">Welcome Back</h1>
          <p className="mt-2 text-slate-500">Sign in to continue</p>
        </div>

        {/* Alerts */}
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        {/* Form Card */}
        <Card>
          <div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
            {/* Google Sign In */}
            <GoogleSignInButton
              redirectTo={next}
              onError={(err) => setError(err)}
            />

            <Divider text="or sign in with email" />

            {/* Email */}
            <Input
              label="Email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={setEmail}
              onKeyPress={handleKeyPress}
              autoComplete="email"
            />

            {/* Password */}
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={setPassword}
              onKeyPress={handleKeyPress}
              autoComplete="current-password"
            />

            {/* Forgot Password */}
            <div className="text-right">
              <button
                type="button"
                onClick={() => router.push(`/forgot-password?email=${encodeURIComponent(email)}`)}
                className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {/* Login Button */}
            <button
              type="button"
              onClick={handleLogin}
              disabled={busy}
              className="w-full rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </Card>

        {/* Sign Up Link */}
        <p className="text-center text-sm text-slate-500">
          Don't have an account?{" "}
          <button
            onClick={() => router.push("/register/select")}
            className="font-semibold text-slate-900 hover:underline"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}