"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { doc, getDoc, collection, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { updateTimetableClass, deleteTimetableClass, minutesToHHMM, hhmmToMinutes, WEEKDAYS } from "@/lib/timetable-api";
import { STAFF_ROLES, normalizeRole } from "@/lib/roles";
import { useDojoName } from "@/hooks/useDojoName";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import SessionReservationsView from "./SessionReservationsView";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type SessionData = {
  id: string;
  dojoId: string;
  title: string;
  dateKey: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  timetableClassId?: string;
  instructor?: string;
};

type InstructorInfo = {
  uid: string;
  displayName: string;
  email?: string;
  roleInDojo?: string;
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadInstructors(dojoId: string): Promise<InstructorInfo[]> {
  const list: InstructorInfo[] = [];
  try {
    const snap = await getDocs(collection(db, "dojos", dojoId, "members"));
    for (const d of snap.docs) {
      const data = d.data();
      const role = normalizeRole(data.roleInDojo || data.role);
      if (STAFF_ROLES.has(role)) {
        list.push({
          uid: d.id,
          displayName: data.displayName || data.email || d.id,
          email: data.email,
          roleInDojo: data.roleInDojo || data.role,
        });
      }
    }
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {}
  return list;
}

// ─────────────────────────────────────────────
// Instructor Select
// ─────────────────────────────────────────────

function InstructorSelect({
  instructors, value, onChange, disabled,
}: {
  instructors: InstructorInfo[]; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const [mode, setMode] = useState<"select" | "manual">(
    value && !instructors.find((i) => i.displayName === value) ? "manual" : "select"
  );

  return (
    <div className="space-y-2">
      <select
        value={mode}
        onChange={(e) => { setMode(e.target.value as any); if (e.target.value === "select") onChange(""); }}
        disabled={disabled}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="select">Select from list</option>
        <option value="manual">Enter manually</option>
      </select>

      {mode === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">(No instructor)</option>
          {instructors.map((i) => (
            <option key={i.uid} value={i.displayName}>{i.displayName}{i.roleInDojo ? ` (${i.roleInDojo})` : ""}</option>
          ))}
        </select>
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter instructor name..."
          disabled={disabled}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

type Props = { dojoId?: string; sessionId?: string };

export default function SessionDetailClient(props: Props) {
  const router = useRouter();
  const params = useParams<{ dojoId?: string; sessionId?: string }>();
  const sp = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const dojoId = useMemo(() => props.dojoId ?? sp.get("dojoId") ?? params?.dojoId ?? "", [props.dojoId, sp, params?.dojoId]);
  const sessionId = useMemo(() => props.sessionId ?? sp.get("sessionId") ?? params?.sessionId ?? "", [props.sessionId, sp, params?.sessionId]);

  const { dojoName } = useDojoName(dojoId);

  const timetableHref = useMemo(() => {
    return dojoId ? `/dojos/${encodeURIComponent(dojoId)}/timetable` : "/dojos/timetable";
  }, [dojoId]);

  const [session, setSession] = useState<SessionData | null>(null);
  const [instructors, setInstructors] = useState<InstructorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editWeekday, setEditWeekday] = useState(0);
  const [editStartHHMM, setEditStartHHMM] = useState("07:00");
  const [editDurationMin, setEditDurationMin] = useState(60);
  const [editInstructor, setEditInstructor] = useState("");

  // Delete modal
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Resolve instructor name from UID or displayName
  const resolveInstructorName = (val: string): string => {
    if (!val) return "";
    const byUid = instructors.find((i) => i.uid === val);
    if (byUid) return byUid.displayName;
    const byName = instructors.find((i) => i.displayName === val);
    if (byName) return byName.displayName;
    if (val.length >= 20 && !val.includes(" ")) return val.substring(0, 8) + "...";
    return val;
  };

  // ─── Load Session + Instructors ───
  useEffect(() => {
    if (!dojoId || !sessionId) { setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const [sessionSnap, instructorList] = await Promise.all([
          getDoc(doc(db, "dojos", dojoId, "sessions", sessionId)),
          loadInstructors(dojoId),
        ]);

        if (cancelled) return;

        let sessionData: SessionData;
        if (sessionSnap.exists()) {
          const d = sessionSnap.data() as any;
          let instructorName = d.instructor || "";
          let title = d.title || "Session";

          if (d.timetableClassId && (!instructorName || title === "Session")) {
            try {
              const classSnap = await getDoc(doc(db, "dojos", dojoId, "timetableClasses", d.timetableClassId));
              if (classSnap.exists()) {
                const cd = classSnap.data() as any;
                if (!instructorName) instructorName = cd.instructor || "";
                if (title === "Session") title = cd.title || title;
              }
            } catch {}
          }

          sessionData = {
            id: sessionSnap.id, dojoId: d.dojoId || dojoId, title,
            dateKey: d.dateKey || "", weekday: d.weekday ?? 0,
            startMinute: d.startMinute ?? 0, durationMinute: d.durationMinute ?? 60,
            timetableClassId: d.timetableClassId, instructor: instructorName,
          };
        } else {
          const [dateKey, classId] = sessionId.split("__");
          let instructorName = "";
          let title = "Session";
          let weekday = dateKey ? new Date(dateKey + "T00:00:00").getDay() : 0;
          let startMinute = 0;
          let durationMinute = 60;

          if (classId) {
            try {
              const classSnap = await getDoc(doc(db, "dojos", dojoId, "timetableClasses", classId));
              if (classSnap.exists()) {
                const cd = classSnap.data() as any;
                instructorName = cd.instructor || "";
                title = cd.title || title;
                if (cd.startMinute != null) startMinute = cd.startMinute;
                else if (cd.startTime) startMinute = hhmmToMinutes(cd.startTime);
                if (cd.durationMinute) durationMinute = cd.durationMinute;
                else if (cd.startTime && cd.endTime) durationMinute = Math.max(hhmmToMinutes(cd.endTime) - hhmmToMinutes(cd.startTime), 30);
              }
            } catch {}
          }

          sessionData = { id: sessionId, dojoId, title, dateKey: dateKey || "", weekday, startMinute, durationMinute, timetableClassId: classId, instructor: instructorName };
        }

        if (!cancelled) {
          setSession(sessionData);
          setEditTitle(sessionData.title);
          setEditWeekday(sessionData.weekday);
          setEditStartHHMM(minutesToHHMM(sessionData.startMinute));
          setEditDurationMin(sessionData.durationMinute);
          setEditInstructor(sessionData.instructor || "");
          setInstructors(instructorList);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load session.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [dojoId, sessionId]);

  // ─── Actions ───
  const onSaveEdit = async () => {
    if (!session?.timetableClassId || !dojoId) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const newStartMinute = hhmmToMinutes(editStartHHMM);

      await updateTimetableClass(dojoId, session.timetableClassId, {
        title: editTitle.trim(), weekday: editWeekday,
        startMinute: newStartMinute, durationMinute: editDurationMin,
        instructor: editInstructor || undefined,
      } as any);

      await setDoc(doc(db, "dojos", dojoId, "sessions", sessionId), {
        title: editTitle.trim(),
        weekday: editWeekday,
        startMinute: newStartMinute,
        durationMinute: editDurationMin,
        instructor: editInstructor || null,
        updatedAt: serverTimestamp(),
        syncedFromTimetableAt: serverTimestamp(),
      }, { merge: true });

      setEditOpen(false);
      setSession((p) => p ? {
        ...p,
        title: editTitle.trim(),
        weekday: editWeekday,
        startMinute: newStartMinute,
        durationMinute: editDurationMin,
        instructor: editInstructor,
      } : null);
      setSuccess("Class updated!");
    } catch (e: any) { setError(e?.message || "Update failed."); }
    finally { setBusy(false); }
  };

  const onConfirmDelete = async () => {
    if (!session?.timetableClassId || !dojoId) return;
    setBusy(true); setError("");
    try {
      await deleteTimetableClass(dojoId, session.timetableClassId);
      setDeleteOpen(false);
      setSuccess("Class deleted!");
      setTimeout(() => router.push(timetableHref), 1000);
    } catch (e: any) { setError(e?.message || "Delete failed."); }
    finally { setBusy(false); }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 py-8 pb-24">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!user) return null;

  if (!dojoId || !sessionId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            Missing dojo or session ID.
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 py-8 pb-24 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <button onClick={() => router.push(timetableHref)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back to Timetable
              </button>
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{session?.title || "Session"}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                  📅 {session?.dateKey} ({WEEKDAYS.find((w) => w.value === session?.weekday)?.label})
                </span>
                <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                  ⏰ {minutesToHHMM(session?.startMinute ?? 0)}
                </span>
                <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                  ⏱ {session?.durationMinute} min
                </span>
                {session?.instructor && (
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                    👤 {resolveInstructorName(session.instructor)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEditOpen(true)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                ✏️ Edit
              </button>
              <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 border border-red-200 bg-red-50 rounded-lg text-sm font-medium text-red-700 hover:bg-red-100 transition">
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">{success}</div>}

        {/* ✅ Unified Reservations + Attendance */}
        {dojoId && sessionId && session && (
          <SessionReservationsView
            dojoId={dojoId}
            sessionId={sessionId}
            sessionTitle={session.title}
            sessionDateKey={session.dateKey}
            isStaff={true}
          />
        )}
      </main>

      <BottomNavigation />

      {/* Edit Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Edit Class</h3>
                <button onClick={() => setEditOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Weekday</label>
                    <select value={editWeekday} onChange={(e) => setEditWeekday(Number(e.target.value))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {WEEKDAYS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
                    <input value={editStartHHMM} onChange={(e) => setEditStartHHMM(e.target.value)} placeholder="07:00"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                    <input value={editDurationMin} onChange={(e) => setEditDurationMin(Number(e.target.value || "0"))} type="number"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instructor</label>
                  <InstructorSelect instructors={instructors} value={editInstructor} onChange={setEditInstructor} disabled={busy} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setEditOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition">Cancel</button>
                  <button onClick={onSaveEdit} disabled={busy} className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setDeleteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-xl font-bold text-red-700 mb-3">Delete Class?</h3>
              <p className="text-sm text-gray-700 mb-3">
                Are you sure you want to delete <span className="font-semibold">&quot;{session?.title}&quot;</span>?
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 mb-4">
                This will delete the class template. Existing sessions will remain.
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDeleteOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition">Cancel</button>
                <button onClick={onConfirmDelete} disabled={busy} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50">{busy ? "Deleting..." : "Delete"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}