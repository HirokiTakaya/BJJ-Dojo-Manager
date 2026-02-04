"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/firebase";

const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";

export default function ForgotPasswordClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialEmail = useMemo(() => sp.get("email") || "", [sp]);

  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  const handleSend = async () => {
    if (!email) {
      setToastMsg("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setToastMsg("We have sent a password reset email. Please check your inbox.");
    } catch (e: any) {
      setToastMsg(e?.message || "Failed to send the reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 30 }}>
        <img
          src={LOGO_SRC}
          alt="Logo"
          style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
        />
        <h2 style={{ textAlign: "center" }}>Reset Password</h2>

        <p style={{ textAlign: "center", marginTop: 8, opacity: 0.9 }}>
          Enter your registered email address and we will send you a link to reset your password.
        </p>

        <input
          type="email"
          placeholder="Email"
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
          {loading ? "Sending…" : "Send Reset Password Link"}
        </button>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            onClick={() => router.replace("/login")}
            style={{ background: "transparent", border: 0, color: "#b2d3db", cursor: "pointer" }}
          >
            Back to Login
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
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
