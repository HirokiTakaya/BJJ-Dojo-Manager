
"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";

import {
  authNullable,
  dbNullable,
  firebaseEnabled,
  firebaseDisabledReason,
} from "@/firebase";

import { signInAnonymously } from "firebase/auth";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

import {
  type Locale,
  getWaiverTitle,
  getWaiverIntro,
  getWaiverSections,
  getAcknowledgment,
  getMinorConsent,
  BJJ_WAIVER,
} from "@/lib/bjj-waiver-content";

// ── Auth helper ──────────────────────────────────────────────
async function ensureGuestAuth() {
  if (!firebaseEnabled)
    throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
  if (!authNullable) throw new Error("Auth is not initialized.");
  if (authNullable.currentUser) return authNullable.currentUser;
  const cred = await signInAnonymously(authNullable);
  return cred.user;
}

// ── Inner content (uses useSearchParams → must be in Suspense) ──
function WaiverContent() {
  const router = useRouter();
  const params = useParams();
  const sp = useSearchParams();

  const dojoId = params.dojoId as string;
  const next = sp.get("next") || "/visitor/complete";

  // ── State ────────────────────────────────────────────────
  const [locale, setLocale] = useState<Locale>("en");
  const [dojoName, setDojoName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [agreedMinor, setAgreedMinor] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [guardianName, setGuardianName] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Load dojo info ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await ensureGuestAuth();
        const db = dbNullable;
        if (!db) throw new Error("Firestore is not initialized.");
        const snap = await getDoc(doc(db, "dojos", dojoId));
        if (!cancelled && snap.exists()) {
          const data = snap.data() as any;
          setDojoName(
            data.name || data.displayName || data.dojoName || "Dojo"
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load dojo info.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dojoId]);

  // ── Scroll tracking ──────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // ── Submit ───────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!agreed) return;
    if (isMinor && !agreedMinor) return;
    if (!fullName.trim()) {
      setError(locale === "ja" ? "氏名を入力してください。" : "Please enter your full name.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const user = await ensureGuestAuth();
      const db = dbNullable;
      if (!db) throw new Error("Firestore is not initialized.");

      await addDoc(collection(db, "dojos", dojoId, "waivers"), {
        uid: user.uid,
        fullName: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        emergencyContactName: emergencyName.trim() || null,
        emergencyContactPhone: emergencyPhone.trim() || null,
        isMinor,
        guardianName: isMinor ? guardianName.trim() || null : null,
        agreedToWaiver: true,
        agreedToMinorConsent: isMinor ? agreedMinor : null,
        waiverVersion: BJJ_WAIVER.version,
        locale,
        signedAt: serverTimestamp(),
      });

      const qs = new URLSearchParams();
      qs.set("dojo", dojoId);
      router.push(`${next}?${qs.toString()}`);
    } catch (e: any) {
      setError(e?.message || "Failed to submit waiver.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────
  const title = getWaiverTitle(locale);
  const intro = getWaiverIntro(locale);
  const sections = getWaiverSections(locale);
  const acknowledgment = getAcknowledgment(locale);
  const minorConsent = getMinorConsent(locale);

  const canSubmit = agreed && (!isMinor || agreedMinor) && fullName.trim().length > 0;

  // ── Render ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            {title}
          </h1>
          {dojoName && (
            <p className="text-slate-600 font-medium">{dojoName}</p>
          )}
        </div>

        {/* Language toggle */}
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setLocale("en")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              locale === "en"
                ? "bg-sky-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-sky-300"
            }`}
          >
            English
          </button>
          <button
            onClick={() => setLocale("ja")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              locale === "ja"
                ? "bg-sky-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-sky-300"
            }`}
          >
            日本語
          </button>
        </div>

        {/* Waiver body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 max-h-[60vh] overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed"
        >
          <p>{intro}</p>

          {sections.map((s) => (
            <div key={s.id}>
              <h2 className="font-semibold text-slate-900 mb-1">{s.title}</h2>
              <p>{s.body}</p>
            </div>
          ))}
        </div>

        {!hasScrolledToBottom && (
          <p className="text-center text-xs text-amber-600">
            {locale === "ja"
              ? "↓ 内容をすべてスクロールしてお読みください"
              : "↓ Please scroll to read the entire waiver"}
          </p>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Form fields */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">
            {locale === "ja" ? "参加者情報" : "Participant Information"}
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {locale === "ja" ? "氏名（フルネーム）*" : "Full Name *"}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={locale === "ja" ? "山田 太郎" : "John Doe"}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {locale === "ja" ? "メールアドレス" : "Email"}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {locale === "ja" ? "電話番号" : "Phone"}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={locale === "ja" ? "090-1234-5678" : "+1 (555) 123-4567"}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <h4 className="font-medium text-slate-800 text-sm pt-2">
              {locale === "ja" ? "緊急連絡先" : "Emergency Contact"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {locale === "ja" ? "氏名" : "Name"}
                </label>
                <input
                  type="text"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {locale === "ja" ? "電話番号" : "Phone"}
                </label>
                <input
                  type="tel"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Minor toggle */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isMinor}
              onChange={(e) => setIsMinor(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span className="text-sm text-slate-700">
              {locale === "ja"
                ? "参加者は18歳未満です"
                : "The participant is under 18 years old"}
            </span>
          </label>

          {isMinor && (
            <div className="space-y-3 pl-8">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {locale === "ja"
                    ? "親権者・法定後見人の氏名 *"
                    : "Parent / Legal Guardian Name *"}
                </label>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
                {minorConsent}
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedMinor}
                  onChange={(e) => setAgreedMinor(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 mt-0.5"
                />
                <span className="text-sm text-slate-700">
                  {locale === "ja"
                    ? "親権者として上記に同意します"
                    : "I agree to the above as parent / legal guardian"}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Acknowledgment + agree */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 leading-relaxed font-medium">
            {acknowledgment}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 mt-0.5"
            />
            <span className="text-sm text-slate-700">
              {locale === "ja"
                ? "上記の免責同意書の内容をすべて読み、理解し、自発的に同意します。"
                : "I have read, understood, and voluntarily agree to the above Waiver and Release of Liability."}
            </span>
          </label>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full py-4 rounded-2xl font-semibold text-white transition
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-sky-600 hover:bg-sky-700 active:bg-sky-800"
        >
          {submitting
            ? locale === "ja"
              ? "送信中..."
              : "Submitting..."
            : locale === "ja"
            ? "同意して署名する"
            : "Agree & Sign"}
        </button>

        <p className="text-center text-xs text-slate-400">
          {locale === "ja"
            ? `Waiver v${BJJ_WAIVER.version} • ${BJJ_WAIVER.lastUpdated}`
            : `Waiver v${BJJ_WAIVER.version} • ${BJJ_WAIVER.lastUpdated}`}
        </p>
      </main>
    </div>
  );
}

// ── Page export (wrapped in Suspense) ────────────────────────
export default function WaiverPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-600" />
        </div>
      }
    >
      <WaiverContent />
    </Suspense>
  );
}