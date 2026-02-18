"use client";

import React, { Suspense, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase";
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth";
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
      setToastMsg("Role is missing. Please go back and select your account type.");
      return;
    }
    if (!name.trim() || !email.trim() || !password || password !== confirmPassword) {
      setToastMsg("Please fill all fields and match passwords.");
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

      // tasks.push(sendEmailVerification(cred.user).catch(() => undefined));
      Promise.allSettled(tasks);
    } catch (err: any) {
      if (err?.code === "auth/email-already-in-use") setToastMsg("This email is already registered.");
      else if (err?.code === "auth/weak-password") setToastMsg("Password must be at least 6 characters.");
      else setToastMsg(err?.message || "Signup failed.");
      setLoading(false);
    }
  };

  const canSubmit = !!role && !!name.trim() && !!email.trim() && !!password && password === confirmPassword;

  return (
    <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 30 }}>
        <img src={LOGO_SRC} alt="Logo" style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }} />
        <h2 style={{ textAlign: "center", marginBottom: 18 }}>Create Your Account</h2>

        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value ?? "")}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
            marginBottom: 10,
          }}
          autoComplete="name"
        />

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail((e.target.value ?? "").trim())}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
            marginBottom: 10,
          }}
          autoComplete="email"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value ?? "")}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
            marginBottom: 10,
          }}
          autoComplete="new-password"
        />

        <input
          type="password"
          placeholder="Confirm Password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value ?? "")}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
          }}
          autoComplete="new-password"
        />

        <button
          onClick={handleSignUp}
          disabled={loading || !canSubmit}
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
          {loading ? "Signing up…" : "Sign Up & Verify Email"}
        </button>

        <div style={{ marginTop: 12, textAlign: "center", opacity: 0.85 }}>
          Role: <strong>{roleUi || "(missing)"}</strong>
        </div>
      </div>

      {toastMsg && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.7)" }}>
          <div style={{ textAlign: "center" }}>{toastMsg}</div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <button onClick={() => setToastMsg("")} style={{ background: "transparent", border: 0, color: "#b2d3db", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
