"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/firebase";
import { sendEmailVerification, type ActionCodeSettings, type User } from "firebase/auth";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const POLL_MS = 3000;
const COOLDOWN_MS = 60_000;
const MAX_RESEND_ATTEMPTS = 5;
const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";

export default function VerifyPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(auth.currentUser);

  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");
  const [cooldown, setCooldown] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COOLDOWN_MS / 1000);
  const [resendCount, setResendCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);

  const cdTimer = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSentAuto = useRef(false);

  const ACTION_CODE_SETTINGS: ActionCodeSettings = {
    url: `${typeof window !== "undefined" ? window.location.origin : ""}/verify/success`,
    handleCodeInApp: false,
  };

  // ─────────────────────────────────────────────
  // Online/Offline detection
  // ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast("Back online", "success");
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast("You are offline. Verification may not work.", "error");
    };

    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  // ─────────────────────────────────────────────
  // Auth state listener
  // ─────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
      // If user becomes verified, redirect
      if (u?.emailVerified) {
        router.replace("/verify/success");
      }
    });
    return () => unsubscribe();
  }, [router]);

  // ─────────────────────────────────────────────
  // Toast helper
  // ─────────────────────────────────────────────
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      setToast(message);
      setToastType(type);
    },
    []
  );

  // ─────────────────────────────────────────────
  // Cooldown timer
  // ─────────────────────────────────────────────
  const startCooldown = useCallback(() => {
    setCooldown(true);
    setSecondsLeft(COOLDOWN_MS / 1000);

    if (cdTimer.current) window.clearInterval(cdTimer.current);

    cdTimer.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (cdTimer.current) window.clearInterval(cdTimer.current);
          setCooldown(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  // ─────────────────────────────────────────────
  // Auto-send verification email on mount
  // ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!user || user.emailVerified || !user.email || hasSentAuto.current) return;
      hasSentAuto.current = true;

      try {
        await user.reload();

        // Check again after reload
        if (user.emailVerified) {
          router.replace("/verify/success");
          return;
        }

        await sendEmailVerification(user, ACTION_CODE_SETTINGS);
        showToast("Verification email sent to " + user.email, "success");
        setResendCount((c) => c + 1);
        startCooldown();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to send verification email.";
        showToast(message, "error");
      }
    })();
  }, [user, router, startCooldown, showToast, ACTION_CODE_SETTINGS]);

  // ─────────────────────────────────────────────
  // Poll for email verification
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        await user.reload();
        if (user.emailVerified) {
          if (pollRef.current) clearInterval(pollRef.current);
          showToast("Email verified!", "success");
          setTimeout(() => {
            router.replace("/verify/success");
          }, 500);
        }
      } catch {
        // Ignore reload errors during polling
      }
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, router, showToast]);

  // ─────────────────────────────────────────────
  // Resend handler
  // ─────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (!user || sending || cooldown || user.emailVerified) return;

    if (!isOnline) {
      showToast("Cannot send email while offline.", "error");
      return;
    }

    if (resendCount >= MAX_RESEND_ATTEMPTS) {
      showToast(
        "Maximum resend attempts reached. Please wait a few minutes or contact support.",
        "error"
      );
      return;
    }

    setSending(true);
    try {
      await user.reload();

      if (user.emailVerified) {
        router.replace("/verify/success");
        return;
      }

      await sendEmailVerification(user, ACTION_CODE_SETTINGS);
      showToast("Verification email sent!", "success");
      setResendCount((c) => c + 1);
      startCooldown();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to send verification email.";

      // Handle specific Firebase errors
      if (message.includes("too-many-requests")) {
        showToast(
          "Too many requests. Please wait a few minutes before trying again.",
          "error"
        );
      } else {
        showToast(message, "error");
      }
    } finally {
      setSending(false);
    }
  }, [
    user,
    sending,
    cooldown,
    isOnline,
    resendCount,
    router,
    startCooldown,
    showToast,
    ACTION_CODE_SETTINGS,
  ]);

  // ─────────────────────────────────────────────
  // Check verification manually
  // ─────────────────────────────────────────────
  const checkVerification = useCallback(async () => {
    if (!user) return;

    try {
      await user.reload();
      if (user.emailVerified) {
        showToast("Email verified!", "success");
        router.replace("/verify/success");
      } else {
        showToast("Not verified yet. Please check your email.", "info");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to check status.";
      showToast(message, "error");
    }
  }, [user, router, showToast]);

  // ─────────────────────────────────────────────
  // Sign out and go to login
  // ─────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    try {
      await auth.signOut();
      router.replace("/login");
    } catch {
      router.replace("/login");
    }
  }, [router]);

  // ─────────────────────────────────────────────
  // Not signed in state
  // ─────────────────────────────────────────────
  if (!user) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#0b1b22",
          color: "white",
          padding: 24,
        }}
      >
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <img
            src={LOGO_SRC}
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              display: "block",
              margin: "0 auto 24px",
            }}
          />
          <h2 style={{ marginBottom: 12 }}>Not Signed In</h2>
          <p style={{ opacity: 0.8, marginBottom: 20 }}>
            Please sign in to verify your email.
          </p>
          <button
            onClick={() => router.replace("/login")}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.35)",
              color: "white",
              borderRadius: 999,
              height: 44,
              padding: "0 24px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Go to Login
          </button>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b1b22",
        color: "white",
        padding: 24,
      }}
    >
      <div
        style={{ maxWidth: 520, margin: "0 auto", paddingTop: 30, textAlign: "center" }}
      >
        <img
          src={LOGO_SRC}
          alt="Logo"
          style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
        />

        <h1 style={{ marginBottom: 10 }}>Verify Your Email Address</h1>

        {/* Email display */}
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>Verification email sent to:</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{user.email}</div>
        </div>

        <p style={{ opacity: 0.9, marginBottom: 20 }}>
          Check your email and click the link to activate your account.
        </p>

        {/* Offline warning */}
        {!isOnline && (
          <div
            style={{
              background: "#fef3c7",
              color: "#92400e",
              padding: 12,
              borderRadius: 12,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>⚠️</span>
            <span>You are offline</span>
          </div>
        )}

        {/* Instructions */}
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            textAlign: "left",
          }}
        >
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 14 }}>
            Didn't receive the email?
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.9 }}>
            <li style={{ marginBottom: 6 }}>Check your spam/junk folder</li>
            <li style={{ marginBottom: 6 }}>
              Make sure {user.email} is correct
            </li>
            <li style={{ marginBottom: 6 }}>Wait a few minutes for delivery</li>
            <li>Click "Resend Email" below if needed</li>
          </ul>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={sending || cooldown || user.emailVerified || !isOnline}
            style={{
              width: "100%",
              maxWidth: 360,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.35)",
              background:
                sending || cooldown || !isOnline ? "transparent" : "rgba(37, 99, 235, 0.3)",
              color: "white",
              cursor:
                sending || cooldown || !isOnline ? "not-allowed" : "pointer",
              fontWeight: 600,
              margin: "0 auto",
              opacity: sending || cooldown || !isOnline ? 0.6 : 1,
            }}
          >
            {sending
              ? "Sending…"
              : cooldown
                ? `Resend in ${secondsLeft}s`
                : `Resend Email${resendCount > 0 ? ` (${resendCount}/${MAX_RESEND_ATTEMPTS})` : ""}`}
          </button>

          {/* Check verification button */}
          <button
            onClick={checkVerification}
            style={{
              width: "100%",
              maxWidth: 360,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              margin: "0 auto",
            }}
          >
            I've Verified - Check Now
          </button>

          {/* Sign out link */}
          <button
            onClick={handleSignOut}
            style={{
              background: "transparent",
              border: 0,
              color: "#b2d3db",
              cursor: "pointer",
              marginTop: 8,
              fontSize: 13,
            }}
          >
            Use a different account
          </button>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 12,
            padding: 12,
            borderRadius: 12,
            background:
              toastType === "success"
                ? "rgba(34, 197, 94, 0.9)"
                : toastType === "error"
                  ? "rgba(239, 68, 68, 0.9)"
                  : "rgba(0, 0, 0, 0.8)",
            color: "white",
            zIndex: 1000,
          }}
        >
          <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {toastType === "success" && <span>✓</span>}
            {toastType === "error" && <span>✕</span>}
            {toast}
          </div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <button
              onClick={() => setToast("")}
              style={{
                background: "transparent",
                border: 0,
                color: "rgba(255,255,255,0.8)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </main>
  );
}