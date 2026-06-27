"use client";

import React, { Suspense, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authNullable, dbNullable } from "@/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

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
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
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
      autoComplete={autoComplete}
      className={`w-full rounded-2xl border px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
        error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
      }`}
    />
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

const GhostBtn = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
  >
    {children}
  </button>
);

export default function RegisterDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="text-slate-500">Loading...</div>
        </div>
      }
    >
      <RegisterDetailsInner />
    </Suspense>
  );
}

function RegisterDetailsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("register.details");
  const tCommon = useTranslations("common");

  const roleUi = (sp.get("role") || "").toLowerCase();
  const role = useMemo(() => {
    if (roleUi === "staff") return "staff_member";
    if (roleUi === "student") return "student";
    return "";
  }, [roleUi]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const didNavRef = useRef(false);
  const goVerify = () => {
    if (didNavRef.current) return;
    didNavRef.current = true;
    router.replace("/verify");
  };

  const handleSignUp = async () => {
    if (loading) return;
    setError("");
    setSuccess("");

    if (!role) {
      setError(t("errors.roleMissing"));
      return;
    }
    if (!name.trim() || !email.trim() || !password || password !== confirmPassword) {
      setError(t("errors.fillAllFields"));
      return;
    }

    setLoading(true);
    try {
      if (!authNullable) throw new Error(t("errors.authNotReady"));
      if (!dbNullable) throw new Error(t("errors.dbNotReady"));

      const normalizedEmail = email.trim().toLowerCase();
      const displayName = name.trim();
      const displayNameLower = displayName.toLowerCase();

      const cred = await createUserWithEmailAndPassword(authNullable, normalizedEmail, password);

      goVerify();

      const tasks: Promise<any>[] = [];

      tasks.push(updateProfile(cred.user, { displayName }).catch(() => undefined));

      const rolesMap: Record<string, boolean> = {};
      rolesMap[role] = true;

      tasks.push(
        setDoc(
          doc(dbNullable, "users", cred.user.uid),
          {
            role,
            roles: rolesMap,
            roleUi,
            email: cred.user.email ?? normalizedEmail,
            emailLower: normalizedEmail,
            emailIndex: normalizedEmail,
            displayName,
            displayNameLower,
            nameIndex: displayNameLower,
            onboardingComplete: false,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => undefined)
      );

      await Promise.allSettled(tasks);
    } catch (err: any) {
      if (err?.code === "auth/email-already-in-use") setError(t("errors.emailInUse"));
      else if (err?.code === "auth/weak-password") setError(t("errors.weakPassword"));
      else setError(err?.message || t("errors.signupFailed"));
      setLoading(false);
    }
  };

  const canSubmit = !!role && !!name.trim() && !!email.trim() && !!password && password === confirmPassword;

  const roleLabel = roleUi === "staff" ? t("staffAccount") : roleUi === "student" ? t("studentAccount") : t("unknownAccount");
  const roleColor = roleUi === "staff" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-md p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        <div className="text-center mb-6">
          <img
            src="/assets/jiujitsu-samurai-Logo.png"
            alt={tCommon("appName")}
            className="w-16 h-16 mx-auto mb-4 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold text-slate-900">{t("createTitle")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("createSubtitle")}</p>
        </div>

        <div className="flex justify-center">
          <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ${roleColor}`}>
            {roleLabel}
          </span>
        </div>

        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        <Card>
          <div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
            <Input
              label={t("nameLabel")}
              placeholder={t("namePlaceholderLong")}
              value={name}
              onChange={setName}
              autoComplete="name"
            />

            <Input
              label={t("emailLabel")}
              type="email"
              placeholder={t("emailPlaceholderLong")}
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />

            <Input
              label={t("passwordLabel")}
              type="password"
              placeholder={t("passwordPlaceholderLong")}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              error={password && password.length < 6 ? t("passwordTooShortHint") : undefined}
            />

            <Input
              label={t("confirmPasswordLabel")}
              type="password"
              placeholder={t("confirmPasswordPlaceholderLong")}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              error={confirmPassword && password !== confirmPassword ? t("passwordsMismatch") : undefined}
            />

            <div className="pt-2">
              <PrimaryBtn onClick={handleSignUp} disabled={loading || !canSubmit}>
                {loading ? t("creatingAccount") : t("submit")}
              </PrimaryBtn>
            </div>
          </div>
        </Card>

        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">
            {t("alreadyHaveAccount")}{" "}
            <button
              onClick={() => router.push("/login")}
              className="font-semibold text-slate-900 hover:underline"
            >
              {t("logIn")}
            </button>
          </p>

          <GhostBtn onClick={() => router.back()}>{t("back")}</GhostBtn>
        </div>
      </div>
    </div>
  );
}
