"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase";
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

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

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function RegisterDetailsClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const roleUi = (sp.get("role") || "").toLowerCase(); // student | staff
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
      setError("Role is missing. Please go back and select your account type.");
      return;
    }
    if (!name.trim() || !email.trim() || !password || password !== confirmPassword) {
      setError("Please fill all fields and match passwords.");
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const displayName = name.trim();
      const displayNameLower = displayName.toLowerCase();

      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      // UIをブロックしないため先に遷移
      goVerify();

      const tasks: Promise<any>[] = [];

      tasks.push(updateProfile(cred.user, { displayName }).catch(() => undefined));

      // roles map（roles.student = true みたいに検索可能）
      const rolesMap: Record<string, boolean> = {};
      rolesMap[role] = true;

      tasks.push(
        setDoc(
          doc(db, "users", cred.user.uid),
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

      tasks.push(sendEmailVerification(cred.user).catch(() => undefined));
      Promise.allSettled(tasks);
    } catch (err: any) {
      if (err?.code === "auth/email-already-in-use") setError("This email is already registered.");
      else if (err?.code === "auth/weak-password") setError("Password must be at least 6 characters.");
      else setError(err?.message || "Signup failed.");
      setLoading(false);
    }
  };

  const canSubmit = !!role && !!name.trim() && !!email.trim() && !!password && password === confirmPassword;

  const roleLabel = roleUi === "staff" ? "Staff" : roleUi === "student" ? "Student" : "Unknown";
  const roleColor = roleUi === "staff" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-md p-4 sm:p-6 space-y-4 pt-8 sm:pt-12">
        {/* Logo & Header */}
        <div className="text-center mb-6">
          <img
            src="/assets/jiujitsu-samurai-Logo.png"
            alt="Logo"
            className="w-16 h-16 mx-auto mb-4 rounded-2xl"
          />
          <h1 className="text-2xl font-bold text-slate-900">Create Your Account</h1>
          <p className="mt-2 text-sm text-slate-500">Sign up to get started</p>
        </div>

        {/* Role Badge */}
        <div className="flex justify-center">
          <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ${roleColor}`}>
            {roleLabel} Account
          </span>
        </div>

        {/* Alerts */}
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        {/* Form Card */}
        <Card>
          <div className="px-5 py-6 sm:px-6 sm:py-8 space-y-4">
            <Input
              label="Name"
              placeholder="Enter your full name"
              value={name}
              onChange={setName}
              autoComplete="name"
            />

            <Input
              label="Email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />

            <Input
              label="Password"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              error={password && password.length < 6 ? "Password must be at least 6 characters" : undefined}
            />

            <Input
              label="Confirm Password"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              error={confirmPassword && password !== confirmPassword ? "Passwords do not match" : undefined}
            />

            <div className="pt-2">
              <PrimaryBtn onClick={handleSignUp} disabled={loading || !canSubmit}>
                {loading ? "Creating account…" : "Sign Up & Verify Email"}
              </PrimaryBtn>
            </div>
          </div>
        </Card>

        {/* Footer Links */}
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="font-semibold text-slate-900 hover:underline"
            >
              Log in
            </button>
          </p>

          <GhostBtn onClick={() => router.back()}>← Back</GhostBtn>
        </div>
      </div>
    </div>
  );
}