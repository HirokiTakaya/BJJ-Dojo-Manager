"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { useDojoName } from "@/hooks/useDojoName";
import { resolveDojoId, resolveIsStaff, type UserDocBase } from "@/lib/roles";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type SessionDoc = {
  id: string;
  title: string;
  dateKey: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  instructor?: string;
  classType?: string;
  timetableClassId?: string;
};

type MemberDoc = {
  uid: string;
  displayName: string;
  email?: string;
  beltRank?: string;
  stripes?: number;
  roleInDojo?: string;
  status?: string;
};

type AttendeeDoc = {
  uid: string;
  displayName: string;
  checkedInAt: any;
  checkedInBy: string;
  method: "self" | "staff";
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function minuteToHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTimestamp(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const BELT_COLORS: Record<string, string> = {
  white: "bg-gray-200 text-gray-700",
  blue: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
  brown: "bg-amber-100 text-amber-900",
  black: "bg-gray-800 text-white",
};

// ─────────────────────────────────────────────
// QR Code Display (for kiosk mode)
// ─────────────────────────────────────────────

function QRSection({ sessionId, dojoId }: { sessionId: string; dojoId: string }) {
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/dojos/${dojoId}/checkin?session=${sessionId}`;

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-center">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Share check-in link</p>
      <div className="bg-white rounded-lg p-3 inline-block border border-gray-200 mb-2">
        <div className="w-32 h-32 bg-gray-100 flex items-center justify-center text-gray-400 text-xs rounded">
          QR Code<br />(add qrcode.react)
        </div>
      </div>
      <p className="text-xs text-gray-500 break-all">{url}</p>
      <button
        onClick={() => navigator.clipboard?.writeText(url)}
        className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
      >
        📋 Copy Link
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main: CheckInPage
// ─────────────────────────────────────────────

export default function CheckInPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();

  const dojoId = (params?.dojoId as string) || "";
  const sessionId = (params?.sessionId as string) || "";

  const { dojoName } = useDojoName(dojoId);

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [attendees, setAttendees] = useState<AttendeeDoc[]>([]);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);
  const isCheckedIn = useMemo(
    () => user ? attendees.some((a) => a.uid === user.uid) : false,
    [attendees, user]
  );
  const todayKey = useMemo(() => toDateKey(new Date()), []);

  // Load data
  useEffect(() => {
    if (authLoading || !user) return;
    if (!dojoId || !sessionId) {
      setError("Missing dojo or session ID.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // User doc for role
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!cancelled && userSnap.exists()) setUserDoc(userSnap.data() as UserDocBase);

        // Session
        const sessionSnap = await getDoc(doc(db, "dojos", dojoId, "sessions", sessionId));
        if (!sessionSnap.exists()) {
          setError("Session not found.");
          setLoading(false);
          return;
        }
        const sData = { id: sessionId, ...sessionSnap.data() } as SessionDoc;
        if (!cancelled) setSession(sData);

        // Attendees
        await refreshAttendees(cancelled);

        // Members (for staff check-in)
        const staffCheck = resolveIsStaff(
          userSnap.exists() ? (userSnap.data() as UserDocBase) : null
        );
        if (staffCheck) {
          const membersSnap = await getDocs(collection(db, "dojos", dojoId, "members"));
          if (!cancelled) {
            setMembers(
              membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as MemberDoc))
                .filter((m) => m.status !== "inactive")
                .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))
            );
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [authLoading, user, dojoId, sessionId]);

  const refreshAttendees = async (cancelled = false) => {
    try {
      const snap = await getDocs(collection(db, "dojos", dojoId, "sessions", sessionId, "attendees"));
      if (!cancelled) {
        setAttendees(
          snap.docs
            .map((d) => ({ uid: d.id, ...d.data() } as AttendeeDoc))
            .sort((a, b) => {
              const tA = a.checkedInAt?.toDate?.() || new Date(0);
              const tB = b.checkedInAt?.toDate?.() || new Date(0);
              return tB.getTime() - tA.getTime();
            })
        );
      }
    } catch {}
  };

  // Self check-in
  const handleSelfCheckIn = useCallback(async () => {
    if (!user || !dojoId || !sessionId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      // Get member name
      const memberSnap = await getDoc(doc(db, "dojos", dojoId, "members", user.uid));
      const displayName =
        memberSnap.exists()
          ? memberSnap.data()?.displayName || user.displayName || user.email || "Unknown"
          : user.displayName || user.email || "Unknown";

      await setDoc(doc(db, "dojos", dojoId, "sessions", sessionId, "attendees", user.uid), {
        uid: user.uid,
        displayName,
        checkedInAt: serverTimestamp(),
        checkedInBy: user.uid,
        method: "self",
      });

      await refreshAttendees();
      setSuccess("Checked in! 🥋");
    } catch (e: any) {
      setError(e?.message || "Check-in failed.");
    } finally {
      setBusy(false);
    }
  }, [user, dojoId, sessionId]);

  // Staff check-in a member
  const handleStaffCheckIn = useCallback(
    async (member: MemberDoc) => {
      if (!user || !dojoId || !sessionId) return;
      setBusy(true);
      setError("");
      setSuccess("");

      try {
        const alreadyIn = attendees.some((a) => a.uid === member.uid);
        if (alreadyIn) {
          setError(`${member.displayName} is already checked in.`);
          setBusy(false);
          return;
        }

        await setDoc(doc(db, "dojos", dojoId, "sessions", sessionId, "attendees", member.uid), {
          uid: member.uid,
          displayName: member.displayName || "Unknown",
          checkedInAt: serverTimestamp(),
          checkedInBy: user.uid,
          method: "staff",
        });

        await refreshAttendees();
        setSuccess(`${member.displayName} checked in!`);
      } catch (e: any) {
        setError(e?.message || "Check-in failed.");
      } finally {
        setBusy(false);
      }
    },
    [user, dojoId, sessionId, attendees]
  );

  // Remove attendee (staff only)
  const handleRemoveAttendee = useCallback(
    async (uid: string) => {
      if (!dojoId || !sessionId) return;
      setBusy(true);
      setError("");

      try {
        await deleteDoc(doc(db, "dojos", dojoId, "sessions", sessionId, "attendees", uid));
        await refreshAttendees();
        setSuccess("Removed.");
      } catch (e: any) {
        setError(e?.message || "Remove failed.");
      } finally {
        setBusy(false);
      }
    },
    [dojoId, sessionId]
  );

  // Filter members not yet checked in
  const uncheckedMembers = useMemo(() => {
    const checkedUids = new Set(attendees.map((a) => a.uid));
    const filtered = members.filter((m) => !checkedUids.has(m.uid));
    if (!searchTerm.trim()) return filtered;
    const q = searchTerm.toLowerCase();
    return filtered.filter(
      (m) =>
        m.displayName?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
    );
  }, [members, attendees, searchTerm]);

  const isToday = session?.dateKey === todayKey;
  const isPast = session ? session.dateKey < todayKey : false;

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

  if (!user || !session) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4">{success}</div>
        )}

        {/* Session Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{session.title}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
                <span>📆 {session.dateKey}</span>
                <span>
                  ⏰ {minuteToHHMM(session.startMinute)} –{" "}
                  {minuteToHHMM(session.startMinute + session.durationMinute)}
                </span>
                {session.instructor && <span>👤 {session.instructor}</span>}
              </div>

              <div className="flex items-center gap-2 mt-3">
                {isToday ? (
                  <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                    Today
                  </span>
                ) : isPast ? (
                  <span className="px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold">
                    Past
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    Upcoming
                  </span>
                )}
                <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold">
                  {attendees.length} checked in
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Student Self Check-in */}
        {!isStaff && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            {isCheckedIn ? (
              <div className="text-center py-4">
                <div className="text-5xl mb-3">✅</div>
                <p className="text-xl font-bold text-green-700">You're checked in!</p>
                <p className="text-sm text-gray-500 mt-1">Enjoy your training 🥋</p>
              </div>
            ) : isPast ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">⏰</div>
                <p className="text-gray-500">This session has passed.</p>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-gray-600 mb-4">Ready to train?</p>
                <button
                  onClick={handleSelfCheckIn}
                  disabled={busy}
                  className="px-8 py-4 bg-green-600 text-white rounded-2xl text-lg font-bold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-200"
                >
                  {busy ? "Checking in..." : "✋ Check In"}
                </button>
                {!isToday && (
                  <p className="text-xs text-amber-600 mt-3">
                    Note: This session is not today ({session.dateKey})
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Staff: Check in members */}
        {isStaff && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Check In Members
              </h2>
              <span className="text-sm text-gray-400">{uncheckedMembers.length} remaining</span>
            </div>

            {/* Search */}
            <div className="mb-4">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search members..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Quick check-in buttons */}
            {uncheckedMembers.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-sm">
                {members.length === 0 ? "No members loaded." : "Everyone is checked in! 🎉"}
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {uncheckedMembers.map((m) => {
                  const beltClass = BELT_COLORS[m.beltRank || "white"] || BELT_COLORS.white;
                  return (
                    <button
                      key={m.uid}
                      onClick={() => handleStaffCheckIn(m)}
                      disabled={busy}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50 transition text-left disabled:opacity-50"
                    >
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                        {m.displayName?.charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{m.displayName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${beltClass}`}>
                            {m.beltRank || "white"}
                          </span>
                          {m.stripes ? (
                            <span className="text-xs text-gray-400">
                              {m.stripes} stripe{m.stripes !== 1 && "s"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-green-600 flex-shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* QR / Share Link */}
            <div className="mt-6">
              <QRSection sessionId={sessionId} dojoId={dojoId} />
            </div>
          </div>
        )}

        {/* Attendance List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Attendance ({attendees.length})
            </h2>
          </div>

          {attendees.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-gray-400 text-sm">No one checked in yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {attendees.map((a, i) => (
                <div
                  key={a.uid}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-100"
                >
                  <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center text-sm font-bold text-green-800 flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{a.displayName}</p>
                    <p className="text-xs text-gray-500">
                      {formatTimestamp(a.checkedInAt)}
                      {a.method === "staff" && " · by staff"}
                    </p>
                  </div>
                  {isStaff && (
                    <button
                      onClick={() => handleRemoveAttendee(a.uid)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-600 transition flex-shrink-0 disabled:opacity-50"
                      title="Remove"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}