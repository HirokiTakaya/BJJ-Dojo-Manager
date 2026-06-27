"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import { useTranslations } from "next-intl";
import { auth } from "@/firebase";

const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
          <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 30, textAlign: "center" }}>
            Loading...
          </div>
        </main>
      }
    >
      <ForgotPasswordInner />
    </Suspense>
  );
}

function ForgotPasswordInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialEmail = useMemo(() => sp.get("email") || "", [sp]);
  const t = useTranslations("forgotPassword");
  const tCommon = useTranslations("common");

  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  const handleSend = async () => {
    if (!email) {
      setToastMsg(t("errors.invalidEmail"));
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setToastMsg(t("sentBody"));
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") {
        setToastMsg(t("errors.userNotFound"));
      } else if (e?.code === "auth/invalid-email") {
        setToastMsg(t("errors.invalidEmail"));
      } else {
        setToastMsg(t("errors.generic"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 30 }}>
        <img
          src={LOGO_SRC}
          alt={tCommon("appName")}
          style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
        />
        <h2 style={{ textAlign: "center" }}>{t("title")}</h2>

        <p style={{ textAlign: "center", marginTop: 8, opacity: 0.9 }}>{t("subtitle")}</p>

        <input
          type="email"
          placeholder={t("emailPlaceholder")}
          aria-label={t("emailLabel")}
          value={email}
          onChange={(e) => setEmail(e.target.value ?? "")}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
            marginTop: 12,
          }}
          autoComplete="email"
        />

        <button
          onClick={handleSend}
          disabled={loading}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.35)",
            background: "transparent",
            color: "white",
            marginTop: 14,
            cursor: "pointer",
          }}
        >
          {loading ? tCommon("submitting") : t("submit")}
        </button>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            onClick={() => router.replace("/login")}
            style={{ background: "transparent", border: 0, color: "#b2d3db", cursor: "pointer" }}
          >
            {t("backToLogin")}
          </button>
        </div>
      </div>

      {toastMsg && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ textAlign: "center" }}>{toastMsg}</div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <button
              onClick={() => setToastMsg("")}
              style={{ background: "transparent", border: 0, color: "#b2d3db", cursor: "pointer" }}
            >
              {tCommon("close")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
