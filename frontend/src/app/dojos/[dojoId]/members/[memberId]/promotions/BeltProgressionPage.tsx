"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { db, auth } from "@/firebase";
import { useDojoName } from "@/hooks/useDojoName";
import { resolveDojoId, resolveIsStaff, type UserDocBase } from "@/lib/roles";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type MemberDoc = {
  uid: string;
  displayName: string;
  email?: string;
  beltRank: string;
  stripes: number;
  isKids: boolean;
  roleInDojo: string;
  status: string;
  createdAt?: any;
};

type Promotion = {
  id: string;
  fromBelt: string;
  fromStripes: number;
  toBelt: string;
  toStripes: number;
  promotedAt: any;
  promotedBy: string;
  promotedByName?: string;
  note?: string;
};

type AttendanceRecord = {
  sessionId: string;
  dateKey: string;
  title: string;
  checkedInAt?: any;
};

// ─────────────────────────────────────────────
// Belt Config
// ─────────────────────────────────────────────

const BELT_ORDER = ["white", "blue", "purple", "brown", "black"] as const;
type BeltColor = (typeof BELT_ORDER)[number];

const BELT_CONFIG: Record<
  string,
  { color: string; bg: string; border: string; text: string; label: string; maxStripes: number }
> = {
  white: { color: "#E5E7EB", bg: "bg-gray-100", border: "border-gray-300", text: "text-gray-700", label: "White", maxStripes: 4 },
  blue: { color: "#2563EB", bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-800", label: "Blue", maxStripes: 4 },
  purple: { color: "#7C3AED", bg: "bg-purple-100", border: "border-purple-400", text: "text-purple-800", label: "Purple", maxStripes: 4 },
  brown: { color: "#92400E", bg: "bg-amber-100", border: "border-amber-600", text: "text-amber-900", label: "Brown", maxStripes: 4 },
  black: { color: "#1F2937", bg: "bg-gray-900", border: "border-gray-700", text: "text-white", label: "Black", maxStripes: 6 },
};

function getBeltIndex(belt: string): number {
  return BELT_ORDER.indexOf(belt as BeltColor);
}

function getNextPromotion(belt: string, stripes: number): { belt: string; stripes: number } | null {
  const config = BELT_CONFIG[belt];
  if (!config) return null;
  if (stripes < config.maxStripes) return { belt, stripes: stripes + 1 };
  const idx = getBeltIndex(belt);
  if (idx < BELT_ORDER.length - 1) return { belt: BELT_ORDER[idx + 1], stripes: 0 };
  if (belt === "black" && stripes < 6) return { belt: "black", stripes: stripes + 1 };
  return null;
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function daysSince(ts: any): number {
  if (!ts) return 0;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────
// Belt Visual Component
// ─────────────────────────────────────────────

function BeltVisual({ belt, stripes, size = "lg" }: { belt: string; stripes: number; size?: "sm" | "lg" }) {
  const config = BELT_CONFIG[belt] || BELT_CONFIG.white;
  const isLg = size === "lg";

  return (
    <div className={`flex flex-col items-center gap-2 ${isLg ? "py-6" : "py-2"}`}>
      {/* Belt bar */}
      <div
        className={`relative rounded-md ${isLg ? "w-48 h-8" : "w-24 h-4"}`}
        style={{ backgroundColor: config.color, border: `2px solid ${belt === "white" ? "#D1D5DB" : config.color}` }}
      >
        {/* Black tip (except black belt) */}
        {belt !== "black" && (
          <div
            className={`absolute right-0 top-0 bottom-0 bg-gray-900 rounded-r-sm ${isLg ? "w-10" : "w-5"}`}
          />
        )}
        {/* Stripes */}
        {stripes > 0 && (
          <div className={`absolute right-0 top-0 bottom-0 flex items-center ${isLg ? "pr-12 gap-1" : "pr-6 gap-0.5"}`}>
            {Array.from({ length: stripes }).map((_, i) => (
              <div
                key={i}
                className={`bg-white rounded-sm ${isLg ? "w-1.5 h-5" : "w-1 h-2.5"}`}
                style={{ boxShadow: "0 0 2px rgba(0,0,0,0.3)" }}
              />
            ))}
          </div>
        )}
      </div>
      {/* Label */}
      {isLg && (
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{config.label} Belt</p>
          <p className="text-sm text-gray-500">
            {stripes} stripe{stripes !== 1 && "s"}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Progress Ring
// ─────────────────────────────────────────────

function ProgressRing({ value, max, label, sublabel }: { value: number; max: number; label: string; sublabel?: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#E5E7EB" strokeWidth="6" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke="#2563EB"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="text-center -mt-1">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
        {sublabel && <p className="text-xs text-gray-400">{sublabel}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Promotion Modal (Staff only)
// ─────────────────────────────────────────────

function PromotionModal({
  member,
  onClose,
  onPromote,
  busy,
}: {
  member: MemberDoc;
  onClose: () => void;
  onPromote: (toBelt: string, toStripes: number, note: string) => Promise<void>;
  busy: boolean;
}) {
  const next = getNextPromotion(member.beltRank, member.stripes);
  const [toBelt, setToBelt] = useState(next?.belt || member.beltRank);
  const [toStripes, setToStripes] = useState(next?.stripes ?? member.stripes);
  const [note, setNote] = useState("");

  const config = BELT_CONFIG[toBelt] || BELT_CONFIG.white;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">Promote {member.displayName}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Current */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Current Rank</p>
            <BeltVisual belt={member.beltRank} stripes={member.stripes} size="sm" />
          </div>

          {/* Target */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Promote to Belt</label>
              <select
                value={toBelt}
                onChange={(e) => { setToBelt(e.target.value); setToStripes(0); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BELT_ORDER.map((b) => (
                  <option key={b} value={b}>{BELT_CONFIG[b].label} Belt</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stripes</label>
              <div className="flex gap-2">
                {Array.from({ length: (BELT_CONFIG[toBelt]?.maxStripes || 4) + 1 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setToStripes(i)}
                    className={`w-10 h-10 rounded-lg text-sm font-bold transition ${
                      toStripes === i
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Excellent guard passing skills"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Preview */}
          <div className={`${config.bg} rounded-lg p-4 mb-6 border ${config.border}`}>
            <p className="text-xs uppercase tracking-wide mb-2 opacity-70">Preview</p>
            <BeltVisual belt={toBelt} stripes={toStripes} size="sm" />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => onPromote(toBelt, toStripes, note)}
              disabled={busy || (toBelt === member.beltRank && toStripes === member.stripes)}
              className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Promoting..." : "Confirm Promotion"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function BeltProgressionPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();

  const dojoId = (params?.dojoId as string) || "";
  const memberId = (params?.memberId as string) || "";

  const { dojoName } = useDojoName(dojoId);

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [member, setMember] = useState<MemberDoc | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [attendanceThisMonth, setAttendanceThisMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPromoteModal, setShowPromoteModal] = useState(false);

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);
  const isOwnProfile = memberId === user?.uid;

  // Load data
  useEffect(() => {
    if (authLoading || !user) return;
    if (!dojoId || !memberId) {
      setError("Missing dojo or member ID.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // Load user doc for role check
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!cancelled && userSnap.exists()) {
          setUserDoc(userSnap.data() as UserDocBase);
        }

        // Load member
        const memberSnap = await getDoc(doc(db, "dojos", dojoId, "members", memberId));
        if (!memberSnap.exists()) {
          setError("Member not found.");
          setLoading(false);
          return;
        }
        const memberData = { uid: memberId, ...memberSnap.data() } as MemberDoc;
        if (!cancelled) setMember(memberData);

        // Load promotion history
        try {
          const promoSnap = await getDocs(
            query(collection(db, "dojos", dojoId, "members", memberId, "promotions"), orderBy("promotedAt", "desc"))
          );
          if (!cancelled) {
            setPromotions(promoSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Promotion)));
          }
        } catch {
          // promotions subcollection may not exist yet — that's fine
        }

        // Count attendance from sessions
        try {
          const sessionsSnap = await getDocs(collection(db, "dojos", dojoId, "sessions"));
          let total = 0;
          let thisMonth = 0;
          const now = new Date();
          const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

          const checks = sessionsSnap.docs.map(async (sessionDoc) => {
            try {
              const resSnap = await getDoc(
                doc(db, "dojos", dojoId, "sessions", sessionDoc.id, "reservations", memberId)
              );
              if (resSnap.exists()) {
                const data = resSnap.data();
                if (data?.status !== "cancelled") {
                  total++;
                  const sessionData = sessionDoc.data();
                  if (sessionData?.dateKey?.startsWith(monthKey)) thisMonth++;
                }
              }
            } catch {}
          });

          await Promise.all(checks);
          if (!cancelled) {
            setAttendanceCount(total);
            setAttendanceThisMonth(thisMonth);
          }
        } catch {}
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [authLoading, user, dojoId, memberId]);

  // Promote handler
  const handlePromote = useCallback(
    async (toBelt: string, toStripes: number, note: string) => {
      if (!member || !user || !dojoId) return;
      setBusy(true);
      setError("");
      setSuccess("");

      try {
        // Save promotion record
        const promoData = {
          fromBelt: member.beltRank,
          fromStripes: member.stripes,
          toBelt,
          toStripes,
          promotedAt: serverTimestamp(),
          promotedBy: user.uid,
          promotedByName: user.displayName || user.email || user.uid,
          note: note.trim() || null,
        };

        await addDoc(collection(db, "dojos", dojoId, "members", memberId, "promotions"), promoData);

        // Update member document
        await updateDoc(doc(db, "dojos", dojoId, "members", memberId), {
          beltRank: toBelt,
          stripes: toStripes,
          updatedAt: serverTimestamp(),
        });

        // Update local state
        setMember((prev) => prev ? { ...prev, beltRank: toBelt, stripes: toStripes } : prev);
        setPromotions((prev) => [
          { id: "new-" + Date.now(), ...promoData, promotedAt: new Date() } as Promotion,
          ...prev,
        ]);
        setShowPromoteModal(false);
        setSuccess(`Promoted ${member.displayName} to ${BELT_CONFIG[toBelt]?.label || toBelt} belt (${toStripes} stripes)!`);
      } catch (e: any) {
        setError(e?.message || "Failed to promote.");
      } finally {
        setBusy(false);
      }
    },
    [member, user, dojoId, memberId]
  );

  const goBack = () => {
    router.push(`/dojos/${encodeURIComponent(dojoId)}/members`);
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!user) return null;

  if (error && !member) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!member) return null;

  const beltConfig = BELT_CONFIG[member.beltRank] || BELT_CONFIG.white;
  const beltIdx = getBeltIndex(member.beltRank);
  const totalBeltSteps = BELT_ORDER.length;
  const daysSinceJoined = daysSince(member.createdAt);
  const lastPromotion = promotions.length > 0 ? promotions[0] : null;
  const daysSinceLastPromo = lastPromotion ? daysSince(lastPromotion.promotedAt) : daysSinceJoined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        {/* Back */}
        <button onClick={goBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Members
        </button>

        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6">{success}</div>
        )}

        {/* Profile Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-2xl flex-shrink-0">
                {member.displayName?.charAt(0).toUpperCase() || "?"}
              </div>
              <div>
                {dojoName && <p className="text-sm font-medium text-blue-600 mb-0.5">{dojoName}</p>}
                <h1 className="text-2xl font-bold text-gray-900">{member.displayName}</h1>
                {member.email && <p className="text-sm text-gray-500">{member.email}</p>}
                <p className="text-sm text-gray-400 mt-1">
                  Member for {daysSinceJoined} day{daysSinceJoined !== 1 && "s"}
                </p>
              </div>
            </div>

            {isStaff && (
              <button
                onClick={() => setShowPromoteModal(true)}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition"
              >
                🥋 Promote
              </button>
            )}
          </div>
        </div>

        {/* Belt Display */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Current Rank</h2>
          <BeltVisual belt={member.beltRank} stripes={member.stripes} size="lg" />

          {/* Belt progress bar */}
          <div className="mt-4">
            <div className="flex justify-between mb-2">
              {BELT_ORDER.map((b, i) => (
                <div key={b} className="flex flex-col items-center">
                  <div
                    className={`w-6 h-3 rounded-sm border ${i <= beltIdx ? "opacity-100" : "opacity-30"}`}
                    style={{
                      backgroundColor: BELT_CONFIG[b].color,
                      borderColor: b === "white" ? "#D1D5DB" : BELT_CONFIG[b].color,
                    }}
                  />
                  <p className={`text-xs mt-1 ${i === beltIdx ? "font-bold text-gray-900" : "text-gray-400"}`}>
                    {BELT_CONFIG[b].label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
            <p className="text-3xl font-bold text-gray-900">{attendanceCount}</p>
            <p className="text-xs text-gray-500 mt-1">Total Classes</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
            <p className="text-3xl font-bold text-blue-600">{attendanceThisMonth}</p>
            <p className="text-xs text-gray-500 mt-1">This Month</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
            <p className="text-3xl font-bold text-gray-900">{daysSinceLastPromo}</p>
            <p className="text-xs text-gray-500 mt-1">Days at Rank</p>
          </div>
        </div>

        {/* Promotion Timeline */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Promotion History</h2>

          {promotions.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🥋</div>
              <p className="text-gray-500">No promotions yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                {isOwnProfile
                  ? "Keep training — your journey is just beginning!"
                  : "Promote this member to start tracking their progress."}
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />

              <div className="space-y-6">
                {promotions.map((p, i) => {
                  const toConfig = BELT_CONFIG[p.toBelt] || BELT_CONFIG.white;
                  return (
                    <div key={p.id} className="relative flex gap-4">
                      {/* Dot */}
                      <div
                        className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm"
                        style={{ backgroundColor: toConfig.color }}
                      >
                        <span className="text-white text-xs font-bold">
                          {p.toStripes > 0 ? `${p.toStripes}` : "🥋"}
                        </span>
                      </div>

                      {/* Content */}
                      <div className={`flex-1 pb-2 ${i === 0 ? "" : ""}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">
                            {BELT_CONFIG[p.toBelt]?.label || p.toBelt} Belt
                          </span>
                          {p.toStripes > 0 && (
                            <span className="text-sm text-gray-500">
                              ({p.toStripes} stripe{p.toStripes !== 1 && "s"})
                            </span>
                          )}
                          {i === 0 && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {formatDate(p.promotedAt)}
                          {p.promotedByName && ` · by ${p.promotedByName}`}
                        </p>
                        {p.note && (
                          <p className="text-sm text-gray-600 mt-1 italic">"{p.note}"</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          From {BELT_CONFIG[p.fromBelt]?.label || p.fromBelt} ({p.fromStripes} stripes)
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Joined event */}
                <div className="relative flex gap-4">
                  <div className="relative z-10 w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm">
                    <span className="text-gray-500 text-sm">⭐</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-700">Joined the Dojo</p>
                    <p className="text-sm text-gray-500">{formatDate(member.createdAt)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />

      {/* Promote Modal */}
      {showPromoteModal && member && (
        <PromotionModal
          member={member}
          onClose={() => setShowPromoteModal(false)}
          onPromote={handlePromote}
          busy={busy}
        />
      )}
    </div>
  );
}