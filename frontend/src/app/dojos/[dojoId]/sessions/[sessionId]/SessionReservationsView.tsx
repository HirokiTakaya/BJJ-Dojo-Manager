"use client";

import React, { useEffect, useMemo, useState } from "react";
import { db } from "@/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { STAFF_ROLES, normalizeRole } from "@/lib/roles";

// ============================================
// Types
// ============================================

type Reservation = {
  id: string;
  memberId: string;
  memberName: string;
  status: "confirmed" | "cancelled";
  createdAt: any;
};

type AttendanceStatus = "present" | "late" | "absent";

type AttendanceRecord = {
  uid: string;
  status: AttendanceStatus;
  displayName?: string;
};

type MemberInfo = {
  uid: string;
  displayName: string;
  email?: string;
  beltRank?: string;
  isKids?: boolean;
};

type SessionReservationsViewProps = {
  dojoId: string;
  sessionId: string;
  sessionTitle: string;
  sessionDateKey: string;
  isStaff: boolean;
};

// ============================================
// Belt Colors
// ============================================

const BELT_COLORS: Record<string, string> = {
  white: "#E5E7EB", blue: "#2563EB", purple: "#7C3AED", brown: "#92400E", black: "#1F2937",
  "kids-white": "#E5E7EB", "kids-grey": "#9CA3AF", "kids-yellow": "#FBBF24",
  "kids-orange": "#F97316", "kids-green": "#22C55E",
  "grey-white": "#9CA3AF", grey: "#6B7280", "grey-black": "#4B5563",
  "yellow-white": "#FDE047", yellow: "#FACC15", "yellow-black": "#EAB308",
  "orange-white": "#FDBA74", orange: "#F97316", "orange-black": "#EA580C",
  "green-white": "#86EFAC", green: "#22C55E", "green-black": "#16A34A",
};

// ============================================
// Component
// ============================================

export default function SessionReservationsView({
  dojoId,
  sessionId,
  sessionTitle,
  sessionDateKey,
  isStaff,
}: SessionReservationsViewProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  // ─── Load all data in parallel ───
  useEffect(() => {
    if (!db || !dojoId || !sessionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const [reservSnap, attSnap, membersSnap] = await Promise.all([
          getDocs(collection(db, "dojos", dojoId, "sessions", sessionId, "reservations")),
          getDocs(collection(db, "dojos", dojoId, "sessions", sessionId, "attendance")),
          getDocs(collection(db, "dojos", dojoId, "members")),
        ]);

        if (cancelled) return;

        // Reservations
        const reservList: Reservation[] = [];
        for (const d of reservSnap.docs) {
          const data = d.data() as any;
          if (data.status !== "cancelled") {
            reservList.push({
              id: d.id,
              memberId: data.memberId || d.id,
              memberName: data.memberName || "Unknown",
              status: data.status || "confirmed",
              createdAt: data.createdAt,
            });
          }
        }
        reservList.sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return aTime - bTime;
        });

        // Attendance
        const attList: AttendanceRecord[] = attSnap.docs.map((d) => ({
          uid: d.id,
          status: (d.data().status || "absent") as AttendanceStatus,
          displayName: d.data().displayName,
        }));

        // Members
        const validStatuses = new Set(["approved", "active", "unknown", "", undefined, null]);
        const memberList: MemberInfo[] = membersSnap.docs
          .filter((d) => {
            const s = d.data().status || "";
            return !s || validStatuses.has(s);
          })
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              displayName: data.displayName || data.email || d.id.substring(0, 8) + "...",
              email: data.email,
              beltRank: data.beltRank || "white",
              isKids: data.isKids || false,
            };
          })
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

        if (!cancelled) {
          setReservations(reservList);
          setAttendance(attList);
          setMembers(memberList);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [dojoId, sessionId]);

  // ─── Computed ───
  const attendanceMap = useMemo(
    () => new Map(attendance.map((a) => [a.uid, a.status])),
    [attendance]
  );

  const reservedMemberIds = useMemo(
    () => new Set(reservations.map((r) => r.memberId)),
    [reservations]
  );

  // Enrich reservations with member info
  const enrichedReservations = useMemo(() => {
    const memberMap = new Map(members.map((m) => [m.uid, m]));
    return reservations.map((r) => ({
      ...r,
      member: memberMap.get(r.memberId) || null,
    }));
  }, [reservations, members]);

  const filteredReservations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enrichedReservations;
    return enrichedReservations.filter(
      (r) =>
        r.memberName.toLowerCase().includes(q) ||
        (r.member?.email || "").toLowerCase().includes(q)
    );
  }, [enrichedReservations, search]);

  const presentCount = useMemo(() => {
    let c = 0;
    for (const r of reservations) {
      const s = attendanceMap.get(r.memberId);
      if (s === "present" || s === "late") c++;
    }
    return c;
  }, [reservations, attendanceMap]);

  // Members not yet reserved (for add member modal)
  const availableMembers = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return members
      .filter((m) => !reservedMemberIds.has(m.uid))
      .filter(
        (m) =>
          !q ||
          m.displayName.toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q)
      );
  }, [members, reservedMemberIds, addSearch]);

  // ─── Actions ───
  const markAttendance = async (uid: string, status: AttendanceStatus) => {
    if (!db || !dojoId || !sessionId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const reservation = reservations.find((r) => r.memberId === uid);
      const member = members.find((m) => m.uid === uid);
      const displayName = member?.displayName || reservation?.memberName || uid;

      await setDoc(
        doc(db, "dojos", dojoId, "sessions", sessionId, "attendance", uid),
        {
          uid,
          status,
          displayName,
          checkedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setAttendance((prev) => {
        const exists = prev.find((a) => a.uid === uid);
        if (exists) return prev.map((a) => (a.uid === uid ? { ...a, status } : a));
        return [...prev, { uid, status, displayName }];
      });
      setSuccess(`${displayName}: ${status}`);
      setTimeout(() => setSuccess(""), 2000);
    } catch (e: any) {
      setError(e?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const markAllPresent = async () => {
    if (!db || !dojoId || !sessionId || reservations.length === 0) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await Promise.all(
        reservations.map((r) => {
          const member = members.find((m) => m.uid === r.memberId);
          return setDoc(
            doc(db, "dojos", dojoId, "sessions", sessionId, "attendance", r.memberId),
            {
              uid: r.memberId,
              status: "present",
              displayName: member?.displayName || r.memberName,
              checkedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        })
      );
      setAttendance(
        reservations.map((r) => ({
          uid: r.memberId,
          status: "present" as AttendanceStatus,
          displayName: r.memberName,
        }))
      );
      setSuccess("All marked present!");
      setTimeout(() => setSuccess(""), 2000);
    } catch (e: any) {
      setError(e?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const addProxyReservation = async (member: MemberInfo) => {
    if (!db || !dojoId || !sessionId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      // Ensure session doc exists
      const sessionRef = doc(db, "dojos", dojoId, "sessions", sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) {
        await setDoc(sessionRef, {
          dojoId,
          title: sessionTitle,
          dateKey: sessionDateKey,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }

      // Create reservation
      await setDoc(
        doc(db, "dojos", dojoId, "sessions", sessionId, "reservations", member.uid),
        {
          dojoId,
          sessionId,
          memberId: member.uid,
          memberName: member.displayName,
          status: "confirmed",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          addedByStaff: true,
        }
      );

      setReservations((prev) => [
        ...prev,
        {
          id: member.uid,
          memberId: member.uid,
          memberName: member.displayName,
          status: "confirmed",
          createdAt: { seconds: Date.now() / 1000 },
        },
      ]);
      setSuccess(`Added: ${member.displayName}`);
      setTimeout(() => setSuccess(""), 2000);
    } catch (e: any) {
      setError(e?.message || "Failed to add reservation.");
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async (reservation: Reservation) => {
    if (!db || !isStaff) return;
    setBusy(true);
    setError("");
    try {
      await deleteDoc(
        doc(db, "dojos", dojoId, "sessions", sessionId, "reservations", reservation.id)
      );
      setReservations((prev) => prev.filter((r) => r.id !== reservation.id));
      // Also remove attendance if exists
      try {
        await deleteDoc(
          doc(db, "dojos", dojoId, "sessions", sessionId, "attendance", reservation.memberId)
        );
        setAttendance((prev) => prev.filter((a) => a.uid !== reservation.memberId));
      } catch {}
      setSuccess(`Removed: ${reservation.memberName}`);
      setTimeout(() => setSuccess(""), 2000);
    } catch (e: any) {
      setError(e?.message || "Failed to cancel reservation.");
    } finally {
      setBusy(false);
    }
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900">
          📋 Reservations &amp; Attendance
          <span className="text-sm font-normal text-gray-500 ml-2">
            ({presentCount}/{reservations.length} present)
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {reservations.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-48 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          {isStaff && reservations.length > 0 && (
            <button
              onClick={markAllPresent}
              disabled={busy}
              className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50"
            >
              ✓ All Present
            </button>
          )}
          {isStaff && (
            <button
              onClick={() => { setAddMemberOpen(true); setAddSearch(""); }}
              disabled={busy}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              + Add Member
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}

      {/* Reservation + Attendance List */}
      {reservations.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">
          No reservations yet.
          {isStaff && (
            <span className="block mt-1">
              Click <span className="font-semibold text-blue-600">&quot;+ Add Member&quot;</span> to add members.
            </span>
          )}
        </div>
      ) : filteredReservations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">
          No reservations match &quot;{search}&quot;.
        </p>
      ) : (
        <div className="space-y-2">
          {filteredReservations.map((r, index) => {
            const attStatus = attendanceMap.get(r.memberId);
            const beltRank = r.member?.beltRank || "white";
            const beltCol = BELT_COLORS[beltRank] || "#E5E7EB";
            const isKids = r.member?.isKids || false;

            return (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50"
              >
                {/* Left: member info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      isKids
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {r.memberName?.charAt(0).toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 font-mono">
                        #{index + 1}
                      </span>
                      <span className="font-medium text-gray-900 truncate">
                        {r.memberName}
                      </span>
                      {isKids && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          Kids
                        </span>
                      )}
                      {/* Attendance badge */}
                      {attStatus && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            attStatus === "present"
                              ? "bg-green-100 text-green-700"
                              : attStatus === "late"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {attStatus === "present"
                            ? "✓ Present"
                            : attStatus === "late"
                            ? "⏰ Late"
                            : "✗ Absent"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div
                        className="w-5 h-2 rounded-sm"
                        style={{
                          backgroundColor: beltCol,
                          border: "1px solid rgba(0,0,0,0.1)",
                        }}
                      />
                      {r.member?.email && (
                        <span className="text-xs text-gray-400 truncate">
                          {r.member.email}
                        </span>
                      )}
                      {r.createdAt?.toDate ? (
                        <span className="text-xs text-gray-300">
                          {r.createdAt.toDate().toLocaleDateString("en-CA")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Right: attendance buttons + cancel */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isStaff && (
                    <>
                      {(["present", "late", "absent"] as const).map((s) => {
                        const isActive = attStatus === s;
                        const styles = {
                          present: isActive
                            ? "bg-green-500 text-white ring-2 ring-green-300"
                            : "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100",
                          late: isActive
                            ? "bg-amber-500 text-white ring-2 ring-amber-300"
                            : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100",
                          absent: isActive
                            ? "bg-red-500 text-white ring-2 ring-red-300"
                            : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
                        };
                        const icons = { present: "✓", late: "⏰", absent: "✗" };
                        return (
                          <button
                            key={s}
                            onClick={() => markAttendance(r.memberId, s)}
                            disabled={busy}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${styles[s]}`}
                          >
                            {icons[s]}
                            <span className="hidden sm:inline ml-1">
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </span>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => cancelReservation(r)}
                        disabled={busy}
                        className="ml-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition disabled:opacity-50"
                        title="Remove reservation"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-50 border border-blue-100">
        <span className="text-sm text-blue-700">
          Total: <span className="font-bold">{reservations.length}</span> reserved
        </span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-700 font-semibold">
            ✓ {presentCount}
          </span>
          <span className="text-amber-700 font-semibold">
            ⏰{" "}
            {
              reservations.filter(
                (r) => attendanceMap.get(r.memberId) === "late"
              ).length
            }
          </span>
          <span className="text-red-700 font-semibold">
            ✗{" "}
            {
              reservations.filter(
                (r) => attendanceMap.get(r.memberId) === "absent"
              ).length
            }
          </span>
          <span className="text-gray-400">
            —{" "}
            {
              reservations.filter((r) => !attendanceMap.has(r.memberId))
                .length
            }{" "}
            unmarked
          </span>
        </div>
      </div>

      {/* ─── Add Member Modal ─── */}
      {addMemberOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setAddMemberOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 pb-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">
                  Add Member to Session
                </h3>
                <button
                  onClick={() => setAddMemberOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <input
                type="search"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="Search members by name or email..."
                autoFocus
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {availableMembers.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  {members.length === reservations.length
                    ? "All members are already added."
                    : "No members match your search."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {availableMembers.map((m) => {
                    const beltCol =
                      BELT_COLORS[m.beltRank || "white"] || "#E5E7EB";
                    return (
                      <button
                        key={m.uid}
                        onClick={() => addProxyReservation(m)}
                        disabled={busy}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition text-left disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                              m.isKids
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-200 text-gray-700"
                            }`}
                          >
                            {m.displayName?.charAt(0).toUpperCase() || "?"}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 truncate">
                                {m.displayName}
                              </span>
                              {m.isKids && (
                                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                  Kids
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <div
                                className="w-4 h-1.5 rounded-sm"
                                style={{
                                  backgroundColor: beltCol,
                                  border: "1px solid rgba(0,0,0,0.1)",
                                }}
                              />
                              {m.email && (
                                <span className="text-xs text-gray-400 truncate">
                                  {m.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-blue-600 text-sm font-semibold flex-shrink-0">
                          + Add
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}