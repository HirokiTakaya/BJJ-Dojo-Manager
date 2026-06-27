// app/login/page.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useTranslations } from "next-intl";
import { authNullable } from "@/firebase";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { handleGoogleRedirectResult } from "@/lib/google";
import { navigateAfterAuth } from "@/lib/navigateAfterAuth";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";

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
  const t = useTranslations("login");
  const tCommon = useTranslations("common");

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
          // Even on Google sign-in, enforce emailVerified.
          // Use the user from result if available; otherwise fall back to authNullable.currentUser.
          const user =
            (result as any).user ??
            (authNullable ? authNullable.currentUser : null);
          if (user) {
            navigateAfterAuth(user, router, next);
          } else {
            router.push(next);
          }
        }
      } else if (result?.error) {
        setError(result.error);
      }
    });
  }, [router, next]);

  const handleLogin = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError(t("errors.invalidCredential"));
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

      // Email verification is required — sendSignInLinkToEmail() lives in /verify.
      if (!cred.user.emailVerified) {
        setSuccess(t("errors.generic"));
        setTimeout(() => router.push("/verify"), 1500);
        return;
      }

      navigateAfterAuth(cred.user, router, next);
    } catch (err: any) {
      console.error("[Login] Error:", err);

      if (
        err.code === "auth/user-not-found" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-credential"
      ) {
        setError(t("errors.invalidCredential"));
      } else if (err.code === "auth/too-many-requests") {
        setError(t("errors.tooManyRequests"));
      } else if (err.code === "auth/user-disabled") {
        setError(t("errors.userDisabled"));
      } else if (err.code === "auth/network-request-failed") {
        setError(t("errors.networkRequestFailed"));
      } else {
        setError(t("errors.generic"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6 relative">
      {/* Language switcher — pinned top-right */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <img
            src="/assets/jiujitsu-samurai-Logo.png"
            alt={tCommon("appName")}
            className="w-16 h-16 mx-auto mb-4 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
          <p className="mt-2 text-slate-500">{t("subtitle")}</p>
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

            <Divider text={t("orDivider")} />

            {/* Email */}
            <Input
              label={t("emailLabel")}
              type="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={setEmail}
              onKeyPress={handleKeyPress}
              autoComplete="email"
            />

            {/* Password */}
            <Input
              label={t("passwordLabel")}
              type="password"
              placeholder={t("passwordPlaceholder")}
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
                {t("forgotPassword")}
              </button>
            </div>

            {/* Login Button */}
            <button
              type="button"
              onClick={handleLogin}
              disabled={busy}
              className="w-full rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? tCommon("loading") : t("submit")}
            </button>
          </div>
        </Card>

        {/* Sign Up Link */}
        <p className="text-center text-sm text-slate-500">
          {t("noAccount")}{" "}
          <button
            onClick={() => router.push("/register/select")}
            className="font-semibold text-slate-900 hover:underline"
          >
            {t("createAccount")}
          </button>
        </p>
      </div>
    </div>
  );
}