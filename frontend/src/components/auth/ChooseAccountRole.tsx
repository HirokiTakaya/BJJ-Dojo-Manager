"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

import {
  authNullable,
  dbNullable,
  firebaseEnabled,
  firebaseDisabledReason,
} from "@/firebase";

import { doc, setDoc } from "firebase/firestore";

type RoleKey = "student" | "staff";

type Props = {
  redirectBase?: string;
  onContinue?: (role: RoleKey) => Promise<void>;
  loginPath?: string;
  studentProfilePath?: string;
  staffSignupPath?: string;
};

export default function ChooseAccountRole({
  redirectBase = "/signup/details",
  onContinue,
  loginPath = "/login",
  studentProfilePath = "/signup/student-profile",
  staffSignupPath = "/signup/staff",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const router = useRouter();

  const toStoredRole = (role: RoleKey) =>
    role === "staff" ? "staff_member" : "student";

  const buildFinalDestination = (role: RoleKey) => {
    const isOnboarding = redirectBase.startsWith("/onboarding");
    if (isOnboarding) {
      return role === "staff"
        ? "/onboarding/role/staff/setup"
        : "/onboarding/role/student/setup";
    }
    return `${redirectBase}?role=${role}`;
  };

  const safeNavigate = (target: string) => {
    console.log("[ChooseAccountRole] navigate ->", target);
    try {
      router.push(target);
    } catch (e) {
      console.warn("[ChooseAccountRole] router.push failed, fallback", e);
      if (typeof window !== "undefined") window.location.assign(target);
    }
  };

  const handleSelect = async (role: RoleKey) => {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      if (!firebaseEnabled) {
        setError(firebaseDisabledReason ?? "Firebase is disabled.");
        return;
      }

      const finalDestination = buildFinalDestination(role);

      // Student flow
      if (role === "student") {
        const qs = new URLSearchParams();
        qs.set("next", finalDestination);
        qs.set("role", role);

        const target = `${studentProfilePath}?${qs.toString()}`;
        safeNavigate(target);
        return;
      }

      // Staff flow
      if (typeof window !== "undefined") {
        sessionStorage.setItem("pendingRole", "staff");
        sessionStorage.setItem("pendingNext", finalDestination);
        sessionStorage.setItem("pendingStoredRole", toStoredRole("staff"));
      }

      const qs = new URLSearchParams();
      qs.set("next", finalDestination);
      qs.set("role", "staff");

      const target = `${staffSignupPath}?${qs.toString()}`;
      safeNavigate(target);

      // Optional: onContinue callback (non-blocking)
      if (onContinue) {
        void onContinue(role).catch((e) => {
          console.warn("[ChooseAccountRole] onContinue failed (ignored)", e);
        });
      }

      // Optional: users write (non-blocking)
      const current = authNullable?.currentUser;
      if (current && dbNullable) {
        void setDoc(
          doc(dbNullable, "users", current.uid),
          {
            roleUi: "staff",
            requestedRole: toStoredRole("staff"),
            requestedAt: Date.now(),
          },
          { merge: true }
        ).catch((e) => {
          console.warn("[ChooseAccountRole] optional users write failed (ignored)", e);
        });
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to continue.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-white p-6">
      {/* Logo */}
      <img
         src="/assets/jiujitsu-samurai-Logo.png"
        alt="Logo"
        className="w-20 h-20 mb-8 rounded-2xl shadow-lg"
      />

      {/* Question */}
      <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 text-center">
        Who are you?
      </h1>
      <p className="text-slate-500 mb-10 text-center">
        Tap to select
      </p>

      {/* Role Buttons - Side by Side */}
      <div className="flex gap-4 w-full max-w-sm">
        {/* Student */}
        <button
          onClick={() => handleSelect("student")}
          disabled={busy}
          className="flex-1 group rounded-3xl bg-white border-2 border-slate-200 p-5 transition-all hover:border-emerald-400 hover:shadow-lg active:scale-95 disabled:opacity-50"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-3xl">🥋</span>
            </div>
            <span className="text-lg font-bold text-slate-900">Student</span>
          </div>
        </button>

        {/* Staff */}
        <button
          onClick={() => handleSelect("staff")}
          disabled={busy}
          className="flex-1 group rounded-3xl bg-white border-2 border-slate-200 p-5 transition-all hover:border-violet-400 hover:shadow-lg active:scale-95 disabled:opacity-50"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-3xl">🏢</span>
            </div>
            <span className="text-lg font-bold text-slate-900">Staff</span>
          </div>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm text-center max-w-sm">
          {error}
        </div>
      )}

      {/* Loading indicator */}
      {busy && (
        <div className="mt-6 text-slate-500 text-sm">
          Loading...
        </div>
      )}

      {/* Login Link */}
      <p className="mt-10 text-sm text-slate-500">
        Already have an account?{" "}
        <button
          onClick={() => safeNavigate(loginPath)}
          className="font-semibold text-slate-900 hover:underline"
        >
          Log in
        </button>
      </p>
    </div>
  );
}