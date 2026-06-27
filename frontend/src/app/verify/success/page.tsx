// app/verify/success/page.tsx

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth, db, waitForUser } from "@/firebase";
import { isSessionVerified } from "@/lib/sessionVerification";
import { completePendingDojoAction } from "@/lib/completePendingDojoAction";

const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";

const Alert = ({ kind, children }: { kind: "error"|"success"|"info"; children: React.ReactNode }) => {
  const cls = kind==="error"?"border-rose-200 bg-rose-50 text-rose-800":kind==="success"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
};

export default function VerifySuccessPage() {
  const router = useRouter();
  const t = useTranslations("verify");
  const tCommon = useTranslations("common");
  const [busy, setBusy] = useState(true);
  const [verified, setVerified] = useState(false);
  const [pendingResult, setPendingResult] = useState("");
  const [error, setError] = useState("");
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    (async () => {
      const u = auth.currentUser ?? (await waitForUser(8000));
      if (!u) { router.replace("/login"); setBusy(false); return; }

      try {
        const sv = await isSessionVerified(db, u.uid);
        setVerified(sv);

        if (!sv) {
          setBusy(false);
          return;
        }

        try {
          const result = await completePendingDojoAction(db, u.uid, u.displayName || null);
          if (result) {
            setPendingResult(result);
          }
        } catch (err) {
          console.error("[VerifySuccess] Pending action failed:", err);
          setError(t("setupIncomplete"));
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [router, t]);

  const goHome = useCallback(() => router.replace("/home"), [router]);
  const goBack = useCallback(() => router.replace("/verify"), [router]);

  if (busy) return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-4">
        <img src={LOGO_SRC} alt={tCommon("appName")} className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
        <div className="flex items-center justify-center gap-2 text-slate-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          <span>{t("completingSetup")}</span>
        </div>
      </div>
    </div>
  );

  if (!verified) return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <img src={LOGO_SRC} alt={tCommon("appName")} className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
        <h1 className="text-2xl font-bold text-slate-900">{t("verificationPending")}</h1>
        <p className="text-slate-500">{t("verificationPendingBody")}</p>
        <button onClick={goBack} className="w-full max-w-xs mx-auto rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800">
          {t("backToVerification")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <img src={LOGO_SRC} alt={tCommon("appName")} className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto"><span className="text-4xl text-emerald-600">✓</span></div>
        <h1 className="text-2xl font-bold text-emerald-600">{t("identityVerified")}</h1>
        {pendingResult && <Alert kind="success">✅ {pendingResult}</Alert>}
        {error && <Alert kind="error">⚠️ {error}</Alert>}
        <p className="text-slate-500">{t("allSet")}</p>
        <button onClick={goHome} className="w-full max-w-xs mx-auto rounded-full bg-emerald-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-emerald-700">
          {t("continueToApp")}
        </button>
      </div>
    </div>
  );
}
