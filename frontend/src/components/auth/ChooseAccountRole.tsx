"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  authNullable,
  dbNullable,
  firebaseEnabled,
  firebaseDisabledReason,
} from "@/firebase";

import { doc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";

type RoleKey = "student" | "staff" | "visitor";

type Props = {
  redirectBase?: string;
  onContinue?: (role: RoleKey) => Promise<void>;
  loginPath?: string;
  studentProfilePath?: string;
  staffSignupPath?: string;

  // ✅ 追加：ビジター導線の開始地点（道場選択ページなど）
  visitorStartPath?: string; // default: "/visitor/select-dojo"
};

export default function ChooseAccountRole({
  redirectBase = "/signup/details",
  onContinue,
  loginPath = "/login",
  studentProfilePath = "/signup/student-profile",
  staffSignupPath = "/signup/staff",
  visitorStartPath = "/visitor/select-dojo",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const router = useRouter();
  const t = useTranslations("auth.chooseRole");
  const tCommon = useTranslations("common");

  const toStoredRole = (role: RoleKey) => {
    if (role === "staff") return "staff_member";
    if (role === "student") return "student";
    return "visitor";
  };

  const buildFinalDestination = (role: RoleKey) => {
    const isOnboarding = redirectBase.startsWith("/onboarding");
    if (isOnboarding) {
      // visitor は onboarding ルートに入れない（想定）
      if (role === "visitor") return visitorStartPath;

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

  const ensureGuestAuth = async () => {
    // Firebase未設定なら何もしない
    if (!firebaseEnabled) {
      throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
    }
    if (!authNullable) {
      throw new Error("Auth is not initialized.");
    }

    const current = authNullable.currentUser;
    if (current) return current;

    // ✅ “アカウント無し体験”の正体：匿名ログイン
    const cred = await signInAnonymously(authNullable);
    return cred.user;
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

      // ───────────────────────────────
      // Visitor flow（アカウント不要→道場選択→Waiver）
      // ───────────────────────────────
      if (role === "visitor") {
        // 1) 匿名ログイン（Firestore Rulesで書けるようにする）
        await ensureGuestAuth();

        // 2) 遷移（必要なら next を渡す）
        const qs = new URLSearchParams();
        qs.set("from", "signup");
        // “署名後に戻す/進ませる”導線が欲しければ next を使う
        qs.set("next", "/visitor/complete"); // 例：完了ページ
        const target = `${visitorStartPath}?${qs.toString()}`;

        if (typeof window !== "undefined") {
          sessionStorage.setItem("pendingRole", "visitor");
          sessionStorage.setItem("pendingNext", target);
          sessionStorage.setItem("pendingStoredRole", toStoredRole("visitor"));
        }

        safeNavigate(target);

        // Optional: onContinue callback（非同期・失敗しても止めない）
        if (onContinue) {
          void onContinue(role).catch((e) => {
            console.warn("[ChooseAccountRole] onContinue failed (ignored)", e);
          });
        }

        return;
      }

      // ───────────────────────────────
      // Student flow
      // ───────────────────────────────
      if (role === "student") {
        const qs = new URLSearchParams();
        qs.set("next", finalDestination);
        qs.set("role", role);

        const target = `${studentProfilePath}?${qs.toString()}`;
        safeNavigate(target);
        return;
      }

      // ───────────────────────────────
      // Staff flow
      // ───────────────────────────────
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
        e instanceof Error ? e.message : typeof e === "string" ? e : t("errorGeneric");
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
        alt={tCommon("appName")}
        className="w-20 h-20 mb-8 rounded-2xl shadow-lg"
      />

      {/* Question */}
      <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 text-center">
        {t("title")}
      </h1>
      <p className="text-slate-500 mb-10 text-center">{t("subtitle")}</p>

      {/* Role Buttons */}
      <div className="w-full max-w-sm space-y-4">
        {/* Student + Staff (row) */}
        <div className="flex gap-4">
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
              <span className="text-lg font-bold text-slate-900">{t("student")}</span>
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
              <span className="text-lg font-bold text-slate-900">{t("staff")}</span>
            </div>
          </button>
        </div>

        {/* ✅ Visitor (full width) */}
        <button
          onClick={() => handleSelect("visitor")}
          disabled={busy}
          className="w-full group rounded-3xl bg-white border-2 border-slate-200 p-5 transition-all hover:border-sky-400 hover:shadow-lg active:scale-95 disabled:opacity-50"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-sky-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-3xl">📝</span>
              </div>
              <div className="text-left">
                <div className="text-lg font-bold text-slate-900">{t("visitor")}</div>
                <div className="text-sm text-slate-500">{t("visitorDesc")}</div>
              </div>
            </div>
            <div className="text-slate-400 text-sm font-semibold">→</div>
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
      {busy && <div className="mt-6 text-slate-500 text-sm">{t("loading")}</div>}

      {/* Login Link */}
      <p className="mt-10 text-sm text-slate-500">
        {t("alreadyHaveAccount")}{" "}
        <button
          onClick={() => safeNavigate(loginPath)}
          className="font-semibold text-slate-900 hover:underline"
        >
          {t("logIn")}
        </button>
      </p>
    </div>
  );
}
