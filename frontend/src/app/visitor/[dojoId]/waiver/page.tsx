
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import SignaturePad, { type Stroke } from "@/components/SignaturePad";

import {
  authNullable,
  dbNullable,
  firebaseEnabled,
  firebaseDisabledReason,
} from "@/firebase";

import { signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import {
  type Locale,
  getWaiverTitle,
  getWaiverIntro,
  getWaiverSections,
  getAcknowledgment,
  getMinorConsent,
  BJJ_WAIVER,
} from "@/lib/bjj-waiver-content";

// ── Types ────────────────────────────────────────────────────
type WaiverTemplate = {
  id: string;
  title: string;
  body: string;
  version?: string;
  bodyHash?: string;
};

// ── Helpers ──────────────────────────────────────────────────
async function ensureGuestAuth() {
  if (!firebaseEnabled)
    throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
  if (!authNullable) throw new Error("Auth is not initialized.");
  if (authNullable.currentUser) return authNullable.currentUser;
  const cred = await signInAnonymously(authNullable);
  return cred.user;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // @ts-ignore
    return crypto.randomUUID();
  }
  return `w_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function randomCode6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Main Page ────────────────────────────────────────────────
export default function VisitorWaiverPage() {
  const router = useRouter();
  const params = useParams<{ dojoId: string }>();
  const sp = useSearchParams();

  const dojoId = params?.dojoId || "";
  const next = sp.get("next") || "/visitor/complete";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [dojoName, setDojoName] = useState<string>("");
  const [firestoreTemplate, setFirestoreTemplate] = useState<WaiverTemplate | null>(null);
  const [useBuiltIn, setUseBuiltIn] = useState(false);

  // Locale (only used for built-in waiver)
  const [locale, setLocale] = useState<Locale>("en");

  // Form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [guardianName, setGuardianName] = useState("");
  const [agree, setAgree] = useState(false);
  const [agreedMinor, setAgreedMinor] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  // ── Load dojo + template ─────────────────────────────────
  useEffect(() => {
    if (!dojoId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        await ensureGuestAuth();
        const db = dbNullable;
        if (!db) throw new Error("Firestore is not initialized.");

        // Dojo name
        const dojoSnap = await getDoc(doc(db, "dojos", dojoId));
        if (dojoSnap.exists()) {
          const d = dojoSnap.data() as any;
          setDojoName(d.name || d.displayName || d.dojoName || "");
        }

        // Try Firestore template first
        const tQuery = query(
          collection(db, "dojos", dojoId, "waiverTemplates"),
          where("active", "==", true),
          limit(1)
        );
        const tSnap = await getDocs(tQuery);

        if (!tSnap.empty) {
          const doc0 = tSnap.docs[0];
          const td = doc0.data() as any;
          if (!cancelled) {
            setFirestoreTemplate({
              id: doc0.id,
              title: td.title || "Liability Waiver",
              body: td.body || td.text || "",
              version: td.version,
              bodyHash: td.bodyHash,
            });
            setUseBuiltIn(false);
          }
        } else {
          // No Firestore template → use built-in BJJ waiver
          if (!cancelled) {
            setFirestoreTemplate(null);
            setUseBuiltIn(true);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load waiver.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [dojoId]);

  // ── Derived built-in content ─────────────────────────────
  const builtInTitle = getWaiverTitle(locale);
  const builtInIntro = getWaiverIntro(locale);
  const builtInSections = getWaiverSections(locale);
  const builtInAcknowledgment = getAcknowledgment(locale);
  const builtInMinorConsent = getMinorConsent(locale);

  // ── Can submit ───────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!name.trim()) return false;
    if (!agree) return false;
    if (!email.trim() && !phone.trim()) return false;
    if (isMinor && !guardianName.trim()) return false;
    if (isMinor && useBuiltIn && !agreedMinor) return false;
    if (!strokes || strokes.length === 0) return false;
    return true;
  }, [busy, name, agree, email, phone, isMinor, guardianName, agreedMinor, useBuiltIn, strokes]);

  // ── Submit ───────────────────────────────────────────────
  const onSubmit = async () => {
    if (!dojoId || !canSubmit) return;
    setBusy(true);
    setError("");

    try {
      const user = await ensureGuestAuth();
      const db = dbNullable;
      if (!db) throw new Error("Firestore is not initialized.");

      const submissionId = randomId();
      const confirmationCode = randomCode6();

      await setDoc(doc(db, "dojos", dojoId, "waiverSubmissions", submissionId), {
        dojoId,
        signerType: "visitor",
        authUid: user.uid,

        // Visitor info
        visitorName: name.trim(),
        visitorEmail: email.trim() || null,
        visitorPhone: phone.trim() || null,
        emergencyContactName: emergencyName.trim() || null,
        emergencyContactPhone: emergencyPhone.trim() || null,
        isMinor: isMinor || false,
        guardianName: isMinor ? guardianName.trim() : null,

        // Template info
        templateSource: useBuiltIn ? "built-in" : "firestore",
        templateId: useBuiltIn ? "bjj-waiver-default" : firestoreTemplate?.id ?? null,
        templateVersion: useBuiltIn ? BJJ_WAIVER.version : firestoreTemplate?.version ?? null,
        templateHash: useBuiltIn ? null : firestoreTemplate?.bodyHash ?? null,
        templateTitle: useBuiltIn ? builtInTitle : firestoreTemplate?.title ?? null,
        locale: useBuiltIn ? locale : null,

        // Consent
        agreed: true,
        agreedMinorConsent: isMinor ? agreedMinor : null,

        // Signature (Firestore does not support nested arrays,
        // so strokes are serialized as a JSON string)
        signature: { type: "strokes", strokesJson: JSON.stringify(strokes), strokeCount: strokes.length },

        // Staff ops
        status: "new",
        confirmationCode,

        signedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const qs = new URLSearchParams();
      qs.set("dojoId", dojoId);
      qs.set("id", submissionId);
      qs.set("next", next);
      router.push(`/visitor/complete?${qs.toString()}`);
    } catch (e: any) {
      setError(e?.message || "Failed to submit waiver.");
    } finally {
      setBusy(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full max-w-xl flex justify-center">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-600" />
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <button
          onClick={() => router.push("/visitor/select-dojo")}
          className="text-sm text-slate-600 hover:underline"
        >
          ← Back to dojo selection
        </button>

        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="space-y-2">
            {dojoName && (
              <p className="text-sm font-semibold text-sky-700">{dojoName}</p>
            )}
            <h1 className="text-2xl font-bold text-slate-900">
              {useBuiltIn ? builtInTitle : firestoreTemplate?.title || "Waiver"}
            </h1>
            <p className="text-sm text-slate-500">
              Please read and sign before joining the class.
            </p>
          </div>
        </div>

        {/* Language toggle (built-in only) */}
        {useBuiltIn && (
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
        )}

        {error && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* ─── Waiver body ─── */}
        {useBuiltIn ? (
          /* Built-in BJJ Waiver with sections */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 max-h-[60vh] overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed">
            <p>{builtInIntro}</p>
            {builtInSections.map((s) => (
              <div key={s.id}>
                <h2 className="font-semibold text-slate-900 mb-1">{s.title}</h2>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        ) : firestoreTemplate ? (
          /* Firestore template */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-sm text-slate-700 leading-6">
                {firestoreTemplate.body || "(No waiver text)"}
              </div>
            </div>
          </div>
        ) : null}

        {/* ─── Acknowledgment (built-in only) ─── */}
        {useBuiltIn && (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 text-xs text-slate-700 leading-relaxed font-medium">
            {builtInAcknowledgment}
          </div>
        )}

        {/* ─── Form ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-semibold text-slate-900">
            {useBuiltIn && locale === "ja" ? "参加者情報" : "Participant Information"}
          </h3>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {useBuiltIn && locale === "ja" ? "氏名（フルネーム）" : "Full name"}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={useBuiltIn && locale === "ja" ? "山田 太郎" : "Your name"}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {useBuiltIn && locale === "ja" ? "メールアドレスまたは電話番号" : "Email or phone"}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <div className="space-y-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={useBuiltIn && locale === "ja" ? "メールアドレス" : "Email"}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={useBuiltIn && locale === "ja" ? "電話番号" : "Phone"}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-slate-500">
                  {useBuiltIn && locale === "ja"
                    ? "少なくとも1つを入力してください。"
                    : "Provide at least one."}
                </p>
              </div>
            </div>
          </div>

          {/* Emergency contact */}
          <h4 className="font-medium text-slate-800 text-sm pt-2">
            {useBuiltIn && locale === "ja" ? "緊急連絡先" : "Emergency Contact"}
          </h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {useBuiltIn && locale === "ja" ? "氏名" : "Name"}
              </label>
              <input
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {useBuiltIn && locale === "ja" ? "電話番号" : "Phone"}
              </label>
              <input
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Minor */}
          <div className="flex items-start gap-3">
            <input
              id="minor"
              type="checkbox"
              checked={isMinor}
              onChange={(e) => setIsMinor(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="minor" className="text-sm text-slate-700">
              {useBuiltIn && locale === "ja"
                ? "参加者は18歳未満です（親権者の氏名が必要です）"
                : "Participant is a minor (needs parent/guardian name)"}
            </label>
          </div>

          {isMinor && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {useBuiltIn && locale === "ja"
                    ? "親権者・法定後見人の氏名"
                    : "Parent / guardian full name"}{" "}
                  <span className="text-rose-600">*</span>
                </label>
                <input
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder={
                    useBuiltIn && locale === "ja"
                      ? "親権者の氏名"
                      : "Parent / guardian name"
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {useBuiltIn && (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
                    {builtInMinorConsent}
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
                </>
              )}
            </div>
          )}

          {/* Agree */}
          <div className="flex items-start gap-3">
            <input
              id="agree"
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="agree" className="text-sm text-slate-700">
              {useBuiltIn && locale === "ja"
                ? "上記の免責同意書の内容をすべて読み、理解し、自発的に同意します。"
                : "I have read and agree to the waiver above."}{" "}
              <span className="text-rose-600">*</span>
            </label>
          </div>

          {/* Signature */}
          <SignaturePad disabled={busy} onChange={(s) => setStrokes(s)} />

          {/* Submit */}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full py-3 rounded-2xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition disabled:opacity-50"
          >
            {busy
              ? useBuiltIn && locale === "ja"
                ? "送信中..."
                : "Submitting..."
              : useBuiltIn && locale === "ja"
              ? "同意して署名する"
              : "Submit waiver"}
          </button>

          <p className="text-xs text-slate-500 text-center">
            {useBuiltIn
              ? `Waiver v${BJJ_WAIVER.version} • ${BJJ_WAIVER.lastUpdated}`
              : "This waiver will be sent to dojo staff."}
          </p>
        </div>
      </main>
    </div>
  );
}