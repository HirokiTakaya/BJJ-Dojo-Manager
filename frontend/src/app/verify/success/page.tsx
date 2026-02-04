"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, waitForUser } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  RecaptchaVerifier,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  multiFactor,
  type ApplicationVerifier,
} from "firebase/auth";
import OtpSix from "@/components/OtpSix";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const LOGO_SRC = "/assets/jiujitsu-samurai-Logo.png";
const RECAPTCHA_CONTAINER_ID = "recaptcha-container";
const DEV_VISIBLE_RECAPTCHA = process.env.NODE_ENV !== "production";
const USE_TEST_PHONE = process.env.NEXT_PUBLIC_USE_TEST_PHONE === "1";
const MAX_RELOAD_ATTEMPTS = 8;
const RELOAD_DELAY_MS = 600;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toE164 = (raw: string): string | null => {
  const s = (raw || "").trim();
  if (s.startsWith("+")) return /^\+\d{7,15}$/.test(s) ? s : null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (USE_TEST_PHONE && digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return null;
};

const getOrCreateRecaptchaContainer = (): HTMLDivElement => {
  let el = document.getElementById(RECAPTCHA_CONTAINER_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = RECAPTCHA_CONTAINER_ID;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.overflow = "hidden";
    document.body.appendChild(el);
  }
  return el;
};

declare global {
  interface Window {
    __APP_RECAPTCHA__?: RecaptchaVerifier | null;
  }
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function VerifySuccessPage() {
  const router = useRouter();

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  const [busy, setBusy] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);
  const [needsMfaEnroll, setNeedsMfaEnroll] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [vId, setVId] = useState("");
  const [code, setCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");

  const processedRef = useRef(false);

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
      showToast("You are offline", "error");
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
  // Recaptcha setup
  // ─────────────────────────────────────────────
  const ensureRecaptcha = useCallback(
    async (reset = false): Promise<ApplicationVerifier> => {
      // ✅ FIX: auth.settings の型が環境によって無い/readonly なので最小限の any で安全に設定
      // Phone Auth (MFA enroll) をテストするための設定
      try {
        const a = auth as unknown as {
          settings?: { appVerificationDisabledForTesting?: boolean };
        };
        if (a.settings) {
          a.settings.appVerificationDisabledForTesting = !!USE_TEST_PHONE;
        } else {
          // settings 自体が存在しない型/実装の場合もあるので、存在する時だけにしておく
          // （実装によっては auth as any で settings を作れるが、ここでは安全寄り）
        }
      } catch {
        // Ignore settings errors
      }

      const container = getOrCreateRecaptchaContainer();
      if (DEV_VISIBLE_RECAPTCHA) container.style.minHeight = "86px";

      let inst = window.__APP_RECAPTCHA__ ?? null;

      if (reset && inst) {
        try {
          inst.clear();
        } catch {
          // Ignore clear errors
        }
        inst = null;
        window.__APP_RECAPTCHA__ = null;
      }

      if (!inst) {
        inst = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, {
          size: DEV_VISIBLE_RECAPTCHA ? "normal" : "invisible",
          "expired-callback": () => {
            showToast("Recaptcha expired. Please try again.", "error");
          },
          "error-callback": () => {
            showToast("Recaptcha error. Please try again.", "error");
          },
        });
        await (inst as unknown as { render: () => Promise<void> }).render();
        window.__APP_RECAPTCHA__ = inst;
      }

      return inst as unknown as ApplicationVerifier;
    },
    [showToast]
  );

  // ─────────────────────────────────────────────
  // Initial verification check and user doc creation
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    (async () => {
      const u = auth.currentUser ?? (await waitForUser(8000));
      if (!u) {
        router.replace("/login");
        setBusy(false);
        return;
      }

      setBusy(true);

      try {
        // Poll for email verification (iOS/delay handling)
        for (let i = 0; i < MAX_RELOAD_ATTEMPTS; i++) {
          await u.reload().catch(() => {});
          if (u.emailVerified) break;
          await sleep(RELOAD_DELAY_MS);
        }

        setEmailVerified(!!u.emailVerified);

        // Ensure user document exists
        if (u.emailVerified) {
          try {
            const userRef = doc(db, "users", u.uid);
            const snap = await getDoc(userRef);

            if (!snap.exists()) {
              await setDoc(
                userRef,
                {
                  email: u.email ?? "",
                  emailVerified: true,
                  onboardingComplete: false,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            } else {
              // Update emailVerified status
              await setDoc(
                userRef,
                {
                  emailVerified: true,
                  updatedAt: serverTimestamp(),
                  lastLoginAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          } catch (err) {
            console.error("Failed to update user document:", err);
            // Don't block the flow for this error
          }
        }

        const alreadyEnrolled = multiFactor(u).enrolledFactors.length > 0;
        setNeedsMfaEnroll(!!u.emailVerified && !alreadyEnrolled);
      } finally {
        setBusy(false);
      }
    })();
  }, [router]);

  // ─────────────────────────────────────────────
  // Navigation handlers
  // ─────────────────────────────────────────────
  const goHome = useCallback(() => {
    router.replace("/home");
  }, [router]);

  const goBack = useCallback(() => {
    router.replace("/verify");
  }, [router]);

  // ─────────────────────────────────────────────
  // Phone validation
  // ─────────────────────────────────────────────
  const validatePhone = useCallback((value: string) => {
    const e164 = toE164(value);
    if (!value.trim()) {
      setPhoneError("");
      return false;
    }
    if (!e164) {
      setPhoneError("Please enter a valid phone number (e.g., 604-555-0123)");
      return false;
    }
    setPhoneError("");
    return true;
  }, []);

  // ─────────────────────────────────────────────
  // Send MFA enrollment code
  // ─────────────────────────────────────────────
  const sendEnrollCode = useCallback(
    async (resetCaptcha: boolean) => {
      if (!isOnline) {
        showToast("Cannot send code while offline", "error");
        return;
      }

      const u = auth.currentUser ?? (await waitForUser(8000));
      if (!u) {
        showToast("Please sign in again", "error");
        router.replace("/login");
        return;
      }

      if (!validatePhone(phone)) {
        return;
      }

      const e164 = toE164(phone);
      if (!e164) {
        setPhoneError("Please enter a valid phone number");
        return;
      }

      setEnrolling(true);
      setPhoneError("");

      try {
        const session = await multiFactor(u).getSession();
        const verifier = await ensureRecaptcha(resetCaptcha);

        // Pre-verify token for stability
        try {
          await (verifier as unknown as { verify?: () => Promise<void> }).verify?.();
        } catch {
          // Ignore pre-verify errors
        }

        const provider = new PhoneAuthProvider(auth);
        const verificationId = await provider.verifyPhoneNumber(
          { phoneNumber: e164, session },
          verifier
        );

        setVId(verificationId);
        showToast("Verification code sent to " + e164, "success");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to send code";

        if (message.includes("invalid-phone-number")) {
          setPhoneError("Invalid phone number format");
        } else if (message.includes("too-many-requests")) {
          showToast("Too many requests. Please wait a few minutes.", "error");
        } else if (message.includes("captcha-check-failed")) {
          showToast("Security check failed. Please try again.", "error");
        } else {
          showToast(message, "error");
        }
      } finally {
        setEnrolling(false);
      }
    },
    [isOnline, phone, validatePhone, ensureRecaptcha, router, showToast]
  );

  // ─────────────────────────────────────────────
  // Verify code and enroll MFA
  // ─────────────────────────────────────────────
  const verifyAndEnroll = useCallback(async () => {
    if (!isOnline) {
      showToast("Cannot verify while offline", "error");
      return;
    }

    const u = auth.currentUser ?? (await waitForUser(8000));
    if (!u || !vId) {
      showToast("Session expired. Please start over.", "error");
      setVId("");
      setCode("");
      return;
    }

    setEnrolling(true);

    try {
      const six = (code || "").replace(/\D/g, "").slice(0, 6);

      if (six.length !== 6) {
        showToast("Please enter the 6-digit code", "error");
        setEnrolling(false);
        return;
      }

      const cred = PhoneAuthProvider.credential(vId, six);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(u).enroll(assertion, "My phone");

      // Update user document with MFA status
      try {
        const userRef = doc(db, "users", u.uid);
        await setDoc(
          userRef,
          {
            mfaEnabled: true,
            mfaEnabledAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch {
        // Don't block flow for this
      }

      setNeedsMfaEnroll(false);
      showToast("Two-step verification enabled!", "success");

      setTimeout(() => {
        router.replace("/home");
      }, 1500);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid verification code";

      if (message.includes("invalid-verification-code")) {
        showToast("Invalid code. Please check and try again.", "error");
      } else if (message.includes("session-expired")) {
        showToast("Session expired. Please request a new code.", "error");
        setVId("");
        setCode("");
      } else {
        showToast(message, "error");
      }
    } finally {
      setEnrolling(false);
    }
  }, [isOnline, vId, code, router, showToast]);

  // ─────────────────────────────────────────────
  // Render: Loading state
  // ─────────────────────────────────────────────
  if (busy) {
    return (
      <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 30, textAlign: "center" }}>
          <img
            src={LOGO_SRC}
            alt="Logo"
            style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div
              style={{
                width: 20,
                height: 20,
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "white",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span>Checking verification status...</span>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  // ─────────────────────────────────────────────
  // Render: Not verified
  // ─────────────────────────────────────────────
  if (!emailVerified) {
    return (
      <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 30, textAlign: "center" }}>
          <img
            src={LOGO_SRC}
            alt="Logo"
            style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
          />
          <h1 style={{ marginBottom: 12 }}>Verification Pending</h1>
          <p style={{ opacity: 0.9, marginBottom: 20 }}>
            We couldn't confirm your email verification yet. Please check your email and click
            the verification link.
          </p>
          <button
            onClick={goBack}
            style={{
              width: "100%",
              maxWidth: 300,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Back to Verification
          </button>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────
  // Render: Verified, no MFA needed
  // ─────────────────────────────────────────────
  if (!needsMfaEnroll) {
    return (
      <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 30, textAlign: "center" }}>
          <img
            src={LOGO_SRC}
            alt="Logo"
            style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
          />
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "rgba(34, 197, 94, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <span style={{ fontSize: 40 }}>✓</span>
          </div>

          <h1 style={{ marginBottom: 12, color: "#22c55e" }}>Email Verified!</h1>
          <p style={{ opacity: 0.9, marginBottom: 24 }}>
            Your email has been verified successfully. You can now continue to the app.
          </p>

          <button
            onClick={goHome}
            style={{
              width: "100%",
              maxWidth: 300,
              height: 48,
              borderRadius: 999,
              border: "none",
              background: "#22c55e",
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            Continue to App
          </button>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────
  // Render: MFA enrollment
  // ─────────────────────────────────────────────
  return (
    <main style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 30 }}>
        <img
          src={LOGO_SRC}
          alt="Logo"
          style={{ width: 64, height: 64, display: "block", margin: "0 auto 14px" }}
        />

        <div
          style={{
            background: "rgba(34, 197, 94, 0.15)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          <span style={{ color: "#22c55e" }}>✓ Email Verified</span>
        </div>

        <h2 style={{ textAlign: "center", marginBottom: 8 }}>Protect Your Account</h2>
        <p style={{ textAlign: "center", opacity: 0.9, marginBottom: 24 }}>
          Add an extra layer of security with SMS verification.
        </p>

        {!isOnline && (
          <div
            style={{
              background: "#fef3c7",
              color: "#92400e",
              padding: 12,
              borderRadius: 12,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            ⚠️ You are offline. MFA setup requires an internet connection.
          </div>
        )}

        {!vId ? (
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14 }}>Phone Number</label>
            <input
              type="tel"
              placeholder="e.g., 604-555-0123"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError("");
              }}
              onBlur={() => validatePhone(phone)}
              style={{
                width: "100%",
                padding: 14,
                borderRadius: 12,
                border: phoneError ? "2px solid #ef4444" : "1px solid rgba(255,255,255,0.25)",
                background: "transparent",
                color: "white",
                fontSize: 16,
              }}
            />
            {phoneError && (
              <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{phoneError}</div>
            )}

            <button
              onClick={() => sendEnrollCode(false)}
              disabled={!phone.trim() || enrolling || !isOnline}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 999,
                border: "none",
                background:
                  !phone.trim() || enrolling || !isOnline
                    ? "rgba(255,255,255,0.1)"
                    : "#2563eb",
                color: "white",
                marginTop: 16,
                cursor: !phone.trim() || enrolling || !isOnline ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              {enrolling ? "Sending..." : "Send Verification Code"}
            </button>

            <button
              onClick={goHome}
              style={{
                width: "100%",
                background: "transparent",
                border: 0,
                color: "#b2d3db",
                marginTop: 16,
                cursor: "pointer",
                padding: 12,
              }}
            >
              Skip for now
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "rgba(255,255,255,0.05)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>Code sent to</div>
              <div style={{ fontWeight: 600 }}>{phone}</div>
            </div>

            <label style={{ display: "block", marginBottom: 12, textAlign: "center", fontSize: 14 }}>
              Enter the 6-digit code
            </label>

            <OtpSix value={code} onChange={setCode} />

            <button
              onClick={verifyAndEnroll}
              disabled={code.replace(/\D/g, "").length !== 6 || enrolling || !isOnline}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 999,
                border: "none",
                background:
                  code.replace(/\D/g, "").length !== 6 || enrolling || !isOnline
                    ? "rgba(255,255,255,0.1)"
                    : "#22c55e",
                color: "white",
                marginTop: 20,
                cursor:
                  code.replace(/\D/g, "").length !== 6 || enrolling || !isOnline
                    ? "not-allowed"
                    : "pointer",
                fontWeight: 600,
              }}
            >
              {enrolling ? "Verifying..." : "Verify & Enable"}
            </button>

            <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "center" }}>
              <button
                onClick={() => sendEnrollCode(true)}
                disabled={enrolling}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "#b2d3db",
                  cursor: enrolling ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                Resend Code
              </button>
              <span style={{ opacity: 0.3 }}>|</span>
              <button
                onClick={() => {
                  setVId("");
                  setCode("");
                }}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "#b2d3db",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Change Number
              </button>
            </div>

            <button
              onClick={goHome}
              style={{
                width: "100%",
                background: "transparent",
                border: 0,
                color: "rgba(255,255,255,0.5)",
                marginTop: 20,
                cursor: "pointer",
                padding: 12,
                fontSize: 13,
              }}
            >
              Skip for now
            </button>
          </div>
        )}
      </div>

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
          <div
            style={{
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
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
