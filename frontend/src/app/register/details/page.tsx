"use client";

import React, { Suspense, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth, db } from "@/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";

export default function RegisterDetailsPage() {
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
  const [toastMsg, setToastMsg] = useState("");

  const didNavRef = useRef(false);
  const goVerify = () => {
    if (didNavRef.current) return;
    didNavRef.current = true;
    router.replace("/verify");
  };

  const handleSignUp = async () => {
    if (loading) return;
    if (!role) {
      setToastMsg(t("errors.roleMissing"));
      return;
    }
    if (!name.trim() || !email.trim() || !password || password !== confirmPassword) {
      setToastMsg(t("errors.fillAllFields"));
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const displayName = name.trim();
      const displayNameLower = displayName.toLowerCase();

      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      goVerify();

      const tasks: Promise<any>[] = [];

      tasks.push(updateProfile(cred.user, { displayName }).catch(() => undefined));

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

      Promise.allSettled(tasks);
    } catch (err: any) {
      if (err?.code === "auth/email-already-in-use") setToastMsg(t("errors.emailInUse"));
      else if (err?.code === "auth/weak-password") setToastMsg(t("errors.weakPassword"));
      else setToastMsg(err?.message || t("errors.signupFailed"));
      setLoading(false);
    }
  };

  const canSubmit = !!role && !!name.trim() && !!email.trim() && !!password && password === confirmPassword;

  return (
    <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 30 }}>
        <img src={LOGO_SRC} alt={tCommon("appName")} style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }} />
        <h2 style={{ textAlign: "center", marginBottom: 18 }}>{t("createTitle")}</h2>

        <input
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value ?? "")}
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "white", marginBottom: 10 }}
          autoComplete="name"
        />

        <input
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail((e.target.value ?? "").trim())}
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "white", marginBottom: 10 }}
          autoComplete="email"
        />

        <input
          type="password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value ?? "")}
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "white", marginBottom: 10 }}
          autoComplete="new-password"
        />

        <input
          type="password"
          placeholder={t("confirmPasswordPlaceholder")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value ?? "")}
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "white" }}
          autoComplete="new-password"
        />

        <button
          onClick={handleSignUp}
          disabled={loading || !canSubmit}
          style={{ width: "100%", height: 44, borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)", background: "transparent", color: "white", marginTop: 14, cursor: "pointer" }}
        >
          {loading ? t("submitting") : t("submit")}
        </button>

        <div style={{ marginTop: 12, textAlign: "center", opacity: 0.85 }}>
          {t("roleLabel")}: <strong>{roleUi || t("roleMissingLabel")}</strong>
        </div>
      </div>

      {toastMsg && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.7)" }}>
          <div style={{ textAlign: "center" }}>{toastMsg}</div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <button onClick={() => setToastMsg("")} style={{ background: "transparent", border: 0, color: "#b2d3db", cursor: "pointer" }}>
              {tCommon("close")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
