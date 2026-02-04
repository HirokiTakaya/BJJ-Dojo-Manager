"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { dbNullable } from "@/firebase";
import { doc, getDoc, collection, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { updateTimetableClass, deleteTimetableClass, minutesToHHMM, hhmmToMinutes, WEEKDAYS } from "@/lib/timetable-api";

// ✅ Added: import reservation list component
import SessionReservationsView from "./SessionReservationsView";

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

type AttendanceRecord = {
  uid: string;
  status: "present" | "absent" | "late";
  displayName?: string;
};

type MemberInfo = {
  uid: string;
  displayName: string;
  email?: string;
  beltRank?: string;
  stripes?: number;
  isKids?: boolean;
  status?: string;
};

// ✅ Instructor info type
type InstructorInfo = {
  uid: string;
  displayName: string;
  email?: string;
  roleInDojo?: string;
};

// 大人用帯色
const ADULT_BELT_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  blue: "#0066CC",
  purple: "#6B3FA0",
  brown: "#8B4513",
  black: "#1A1A1A",
};

// キッズ用帯色
const KIDS_BELT_COLORS: Record<string, string> = {
  "grey-white": "#9CA3AF",
  grey: "#6B7280",
  "grey-black": "#4B5563",
  "yellow-white": "#FDE047",
  yellow: "#FACC15",
  "yellow-black": "#EAB308",
  "orange-white": "#FDBA74",
  orange: "#F97316",
  "orange-black": "#EA580C",
  "green-white": "#86EFAC",
  green: "#22C55E",
  "green-black": "#16A34A",
};

const ALL_BELT_COLORS: Record<string, string> = {
  ...ADULT_BELT_COLORS,
  ...KIDS_BELT_COLORS,
};

// ============================================
// Sub-components (TimetableClientと同様)
// ============================================

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">{children}</div>
);

const Alert = ({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: React.ReactNode;
}) => {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
};

const PrimaryBtn = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {children}
  </button>
);

const GhostBtn = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {children}
  </button>
);

const OutlineBtn = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {children}
  </button>
);

// ✅ Role判定ヘルパー
const STAFF_ROLE_SET = new Set(["owner", "staff", "staff_member", "coach", "admin", "instructor"]);

function normalizeRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

// ✅ Instructor一覧を取得
async function loadInstructors(db: any, dojoId: string): Promise<InstructorInfo[]> {
  const instructors: InstructorInfo[] = [];

  try {
    const membersRef = collection(db, "dojos", dojoId, "members");
    const snap = await getDocs(membersRef);

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const role = normalizeRole(data.roleInDojo || data.role);

      if (STAFF_ROLE_SET.has(role)) {
        instructors.push({
          uid: docSnap.id,
          displayName: data.displayName || data.name || data.email || docSnap.id,
          email: data.email,
          roleInDojo: data.roleInDojo || data.role,
        });
      }
    }

    instructors.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (e) {
    console.error("[loadInstructors] error:", e);
  }

  return instructors;
}

// ✅ Instructor選択コンポーネント
const InstructorSelect = ({
  instructors,
  value,
  onChange,
  disabled,
  allowManualInput = true,
}: {
  instructors: InstructorInfo[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allowManualInput?: boolean;
}) => {
  const [mode, setMode] = useState<"select" | "manual">(
    value && !instructors.find((i) => i.displayName === value) ? "manual" : "select"
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as "select" | "manual");
            if (e.target.value === "select") onChange("");
          }}
          disabled={disabled}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="select">Select from list</option>
          {allowManualInput && <option value="manual">Enter manually</option>}
        </select>
      </div>

      {mode === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="">(No instructor / Hidden)</option>
          {instructors.map((inst) => (
            <option key={inst.uid} value={inst.displayName}>
              {inst.displayName}
              {inst.roleInDojo ? ` (${inst.roleInDojo})` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter instructor name..."
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      )}
    </div>
  );
};

type Props = {
  dojoId?: string;
  sessionId?: string;
};

export default function SessionDetailClient(props: Props) {
  const router = useRouter();
  const params = useParams<{ dojoId?: string; sessionId?: string }>();
  const sp = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  // ✅ Resolve dojoId/sessionId in priority order: props → query → params
  const dojoId = useMemo(() => {
    return props.dojoId ?? sp.get("dojoId") ?? params?.dojoId ?? "";
  }, [props.dojoId, sp, params?.dojoId]);

  const sessionId = useMemo(() => {
    return props.sessionId ?? sp.get("sessionId") ?? params?.sessionId ?? "";
  }, [props.sessionId, sp, params?.sessionId]);

  // ✅ Back先：dojoId があれば /dojos/{dojoId}/timetable を優先
  const timetableHref = useMemo(() => {
    const did = (dojoId || "").trim();
    if (did) return `/dojos/${encodeURIComponent(did)}/timetable`;
    return "/dojos/timetable";
  }, [dojoId]);

  const [session, setSession] = useState<SessionData | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [instructors, setInstructors] = useState<InstructorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ✅ Search
  const [search, setSearch] = useState("");

  // ✅ Debug info
  const [debugInfo, setDebugInfo] = useState<{
    totalMembersInFirestore: number;
    skippedMembers: { uid: string; status: string; displayName: string }[];
    loadedMembers: number;
  } | null>(null);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editWeekday, setEditWeekday] = useState(0);
  const [editStartHHMM, setEditStartHHMM] = useState("07:00");
  const [editDurationMin, setEditDurationMin] = useState(60);
  const [editInstructor, setEditInstructor] = useState("");

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Processing
  const [busy, setBusy] = useState(false);

  // ✅ Instructor表示用
  const [instructorDisplayName, setInstructorDisplayName] = useState<string>("");

  // ✅ Instructor UIDから名前を解決する関数
  const resolveInstructorName = (instructorValue: string): string => {
    if (!instructorValue) return "";
    
    // instructorDisplayNameが設定されていればそれを使う
    if (instructorDisplayName && session?.instructor === instructorValue) {
      return instructorDisplayName;
    }
    
    // まずinstructorsリストからUIDで探す
    const foundInstructor = instructors.find((i) => i.uid === instructorValue);
    if (foundInstructor) return foundInstructor.displayName;
    
    // instructorsリストからdisplayNameで探す（すでに名前の場合）
    const foundByName = instructors.find((i) => i.displayName === instructorValue);
    if (foundByName) return foundByName.displayName;
    
    // membersリストからUIDで探す
    const memberFound = members.find((m) => m.uid === instructorValue);
    if (memberFound) return memberFound.displayName;
    
    // membersリストからdisplayNameで探す
    const memberByName = members.find((m) => m.displayName === instructorValue);
    if (memberByName) return memberByName.displayName;
    
    // UIDっぽい文字列かどうかチェック（20文字以上でスペースなし）
    const looksLikeUid = instructorValue.length >= 20 && !instructorValue.includes(" ");
    if (looksLikeUid) {
      // 見つからない場合はUIDの短縮版を表示
      return instructorValue.substring(0, 8) + "...";
    }
    
    // UIDでない場合はそのまま表示（displayNameが保存されている場合）
    return instructorValue;
  };

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load session & attendance & members & instructors
  useEffect(() => {
    const load = async () => {
      if (!dbNullable) return;

      if (!dojoId || !sessionId) {
        setLoading(false);
        setError("Missing dojoId / sessionId (route params or query string).");
        return;
      }

      setLoading(true);
      setError("");

      try {
        // Fetch session
        const sessionRef = doc(dbNullable, "dojos", dojoId, "sessions", sessionId);
        const sessionSnap = await getDoc(sessionRef);

        if (sessionSnap.exists()) {
          const data = sessionSnap.data();
          let instructorName = data.instructor || "";
          let sessionTitle = data.title || "Session";
          let sessionWeekday = data.weekday ?? 0;
          let sessionStartMinute = data.startMinute ?? 0;
          let sessionDurationMinute = data.durationMinute ?? 60;
          
          // ✅ セッションにinstructorがない場合、sessionsコレクションのクラスドキュメントから取得
          // sessionsコレクションには "dateKey__classId" 形式と "classId" 形式の両方がある
          const timetableClassId = data.timetableClassId;
          if (timetableClassId) {
            try {
              // sessionsコレクション内のクラステンプレートから取得
              const classRef = doc(dbNullable, "dojos", dojoId, "sessions", timetableClassId);
              const classSnap = await getDoc(classRef);
              if (classSnap.exists()) {
                const classData = classSnap.data();
                console.log("[SessionDetail] Class template data:", classData);
                if (!instructorName) {
                  instructorName = classData.instructor || "";
                }
                // タイトルなども補完
                if (!sessionTitle || sessionTitle === "Session") {
                  sessionTitle = classData.title || sessionTitle;
                }
              }
            } catch (e) {
              console.warn("[SessionDetail] Failed to fetch class template:", e);
            }
          }
          
          console.log("[SessionDetail] Final instructor:", instructorName);
          
          setSession({
            id: sessionSnap.id,
            dojoId: data.dojoId || dojoId,
            title: sessionTitle,
            dateKey: data.dateKey || "",
            weekday: sessionWeekday,
            startMinute: sessionStartMinute,
            durationMinute: sessionDurationMinute,
            timetableClassId: timetableClassId,
            instructor: instructorName,
          });
          setEditTitle(sessionTitle);
          setEditWeekday(sessionWeekday);
          setEditStartHHMM(minutesToHHMM(sessionStartMinute));
          setEditDurationMin(sessionDurationMinute);
          setEditInstructor(instructorName);
        } else {
          // Parse from sessionId: "YYYY-MM-DD__classId"
          const [dateKey, classId] = sessionId.split("__");
          let instructorName = "";
          let sessionTitle = "Session";
          let sessionWeekday = dateKey ? new Date(dateKey).getDay() : 0;
          let sessionStartMinute = 0;
          let sessionDurationMinute = 60;
          
          // ✅ sessionsコレクションのクラステンプレートからinstructorを取得
          if (classId) {
            try {
              const classRef = doc(dbNullable, "dojos", dojoId, "sessions", classId);
              const classSnap = await getDoc(classRef);
              if (classSnap.exists()) {
                const classData = classSnap.data();
                console.log("[SessionDetail] Class template data (from classId):", classData);
                instructorName = classData.instructor || "";
                sessionTitle = classData.title || sessionTitle;
                // dayOfWeek は API形式、weekday はフロント形式
                if (classData.dayOfWeek !== undefined) {
                  sessionWeekday = classData.dayOfWeek;
                }
                // startTime を分に変換
                if (classData.startTime) {
                  sessionStartMinute = hhmmToMinutes(classData.startTime);
                }
                // endTime - startTime で duration計算
                if (classData.startTime && classData.endTime) {
                  const startMin = hhmmToMinutes(classData.startTime);
                  const endMin = hhmmToMinutes(classData.endTime);
                  sessionDurationMinute = Math.max(endMin - startMin, 60);
                }
              }
            } catch (e) {
              console.warn("[SessionDetail] Failed to fetch class template:", e);
            }
          }
          
          console.log("[SessionDetail] Final instructor (no session doc):", instructorName);
          
          setSession({
            id: sessionId,
            dojoId,
            title: sessionTitle,
            dateKey: dateKey || "",
            weekday: sessionWeekday,
            startMinute: sessionStartMinute,
            durationMinute: sessionDurationMinute,
            timetableClassId: classId,
            instructor: instructorName,
          });
          setEditTitle(sessionTitle);
          setEditWeekday(sessionWeekday);
          setEditStartHHMM(minutesToHHMM(sessionStartMinute));
          setEditDurationMin(sessionDurationMinute);
          setEditInstructor(instructorName);
        }

        // Fetch attendance data
        const attRef = collection(dbNullable, "dojos", dojoId, "sessions", sessionId, "attendance");
        const attSnap = await getDocs(attRef);
        const attList: AttendanceRecord[] = attSnap.docs.map((d) => ({
          uid: d.id,
          status: d.data().status || "absent",
          displayName: d.data().displayName,
        }));
        setAttendance(attList);

        // Fetch member list + supplement displayName from users
        const membersRef = collection(dbNullable, "dojos", dojoId, "members");
        const membersSnap = await getDocs(membersRef);

        const memberList: MemberInfo[] = [];
        const skippedList: { uid: string; status: string; displayName: string }[] = [];

        for (const memberDoc of membersSnap.docs) {
          const memberData = memberDoc.data();
          const memberStatus = memberData.status || "unknown";

          const validStatuses = ["approved", "active", "unknown", undefined, null, ""];
          const isValidStatus = validStatuses.includes(memberStatus) || !memberStatus;

          if (!isValidStatus) {
            skippedList.push({
              uid: memberDoc.id,
              status: memberStatus,
              displayName: memberData.displayName || "(no name)",
            });
            continue;
          }

          let displayName = memberData.displayName;
          let email = memberData.email;

          // ユーザードキュメントから名前を取得
          if (!displayName || displayName === memberDoc.id) {
            try {
              const userRef = doc(dbNullable, "users", memberDoc.id);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                const userData = userSnap.data();
                displayName = userData.displayName || displayName;
                email = email || userData.email;
              }
            } catch (e) {
              console.warn(`Failed to fetch user data for ${memberDoc.id}:`, e);
            }
          }

          memberList.push({
            uid: memberDoc.id,
            displayName: displayName || email || memberDoc.id.substring(0, 8) + "...",
            email,
            beltRank: memberData.beltRank || "white",
            stripes: memberData.stripes || 0,
            isKids: memberData.isKids || false,
            status: memberStatus,
          });
        }

        memberList.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setMembers(memberList);

        // ✅ Load instructors
        const instructorList = await loadInstructors(dbNullable, dojoId);
        setInstructors(instructorList);

        // ✅ instructorがUIDの場合、usersコレクションから名前を取得
        const finalInstructorValue = sessionSnap.exists() 
          ? (sessionSnap.data().instructor || "") 
          : "";
        
        if (finalInstructorValue && finalInstructorValue.length >= 20 && !finalInstructorValue.includes(" ")) {
          // UIDっぽい場合、まずmembersから探す
          let foundName = "";
          const memberMatch = memberList.find((m) => m.uid === finalInstructorValue);
          if (memberMatch) {
            foundName = memberMatch.displayName;
          } else {
            // instructorsから探す
            const instructorMatch = instructorList.find((i) => i.uid === finalInstructorValue);
            if (instructorMatch) {
              foundName = instructorMatch.displayName;
            } else {
              // usersコレクションから取得
              try {
                const userRef = doc(dbNullable, "users", finalInstructorValue);
                const userSnap = await getDoc(userRef);
                if (userSnap.exists()) {
                  const userData = userSnap.data();
                  foundName = userData.displayName || userData.email || finalInstructorValue.substring(0, 8) + "...";
                }
              } catch (e) {
                console.warn("[SessionDetail] Failed to fetch instructor user:", e);
              }
            }
          }
          if (foundName) {
            setInstructorDisplayName(foundName);
          }
        }

        // デバッグ情報を設定
        setDebugInfo({
          totalMembersInFirestore: membersSnap.docs.length,
          skippedMembers: skippedList,
          loadedMembers: memberList.length,
        });

        console.log("[SessionDetail] Members loaded:", {
          total: membersSnap.docs.length,
          loaded: memberList.length,
          skipped: skippedList,
          members: memberList.map((m) => ({ uid: m.uid, name: m.displayName, status: m.status })),
        });
      } catch (e: any) {
        console.error("[SessionDetail] load error:", e);
        setError(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [dojoId, sessionId]);

  // ✅ Convert attendance to Map
  const attendanceMap = useMemo(() => {
    return new Map<string, AttendanceRecord["status"]>(attendance.map((a) => [a.uid, a.status]));
  }, [attendance]);

  // ✅ Filter members by search
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = (m.displayName || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [members, search]);

  const presentCountTotal = useMemo(() => {
    let c = 0;
    for (const m of members) {
      const st = attendanceMap.get(m.uid);
      if (st === "present" || st === "late") c++;
    }
    return c;
  }, [members, attendanceMap]);

  const presentCountFiltered = useMemo(() => {
    let c = 0;
    for (const m of filteredMembers) {
      const st = attendanceMap.get(m.uid);
      if (st === "present" || st === "late") c++;
    }
    return c;
  }, [filteredMembers, attendanceMap]);

  const getAttendanceStatus = (uid: string) => attendanceMap.get(uid);

  // Record attendance
  const markAttendance = async (memberUid: string, status: "present" | "absent" | "late") => {
    if (!dbNullable || !dojoId || !sessionId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const attDocRef = doc(dbNullable, "dojos", dojoId, "sessions", sessionId, "attendance", memberUid);
      const member = members.find((m) => m.uid === memberUid);

      await setDoc(
        attDocRef,
        {
          uid: memberUid,
          status,
          displayName: member?.displayName || memberUid,
          checkedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setAttendance((prev) => {
        const exists = prev.find((a) => a.uid === memberUid);
        if (exists) {
          return prev.map((a) => (a.uid === memberUid ? { ...a, status } : a));
        }
        return [...prev, { uid: memberUid, status, displayName: member?.displayName }];
      });

      setSuccess(`Marked ${member?.displayName || memberUid} as ${status}`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (e: any) {
      console.error("[SessionDetail] markAttendance error:", e);
      setError(e?.message || "Failed to mark attendance");
    } finally {
      setBusy(false);
    }
  };

  // Mark all as present
  const markAllPresent = async () => {
    if (!dbNullable || !dojoId || !sessionId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      for (const member of members) {
        const attDocRef = doc(dbNullable, "dojos", dojoId, "sessions", sessionId, "attendance", member.uid);
        await setDoc(
          attDocRef,
          {
            uid: member.uid,
            status: "present",
            displayName: member.displayName,
            checkedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setAttendance(members.map((m) => ({ uid: m.uid, status: "present", displayName: m.displayName })));
      setSuccess("All members marked as present!");
    } catch (e: any) {
      setError(e?.message || "Failed to mark all");
    } finally {
      setBusy(false);
    }
  };

  // Update class (template)
  const onSaveEdit = async () => {
    if (!session?.timetableClassId || !dojoId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await updateTimetableClass(dojoId, session.timetableClassId, {
        title: editTitle.trim(),
        weekday: editWeekday,
        startMinute: hhmmToMinutes(editStartHHMM),
        durationMinute: editDurationMin,
        instructor: editInstructor || undefined,
      } as any);
      setEditOpen(false);
      setSuccess("Class updated!");
      setSession((prev) =>
        prev
          ? {
              ...prev,
              title: editTitle.trim(),
              weekday: editWeekday,
              startMinute: hhmmToMinutes(editStartHHMM),
              durationMinute: editDurationMin,
              instructor: editInstructor,
            }
          : null
      );
    } catch (e: any) {
      setError(e?.message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Delete class (template)
  const onConfirmDelete = async () => {
    if (!session?.timetableClassId || !dojoId) return;
    setBusy(true);
    setError("");
    try {
      await deleteTimetableClass(dojoId, session.timetableClassId);
      setDeleteOpen(false);
      setSuccess("Class deleted!");
      setTimeout(() => router.push(timetableHref), 1000);
    } catch (e: any) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  // ============================================
  // Render
  // ============================================

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-5xl p-4 sm:p-6">
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <div className="text-slate-900 text-lg font-semibold">Loading…</div>
              <div className="mt-1 text-sm text-slate-500">Fetching session details</div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
        {/* Header */}
        <Card>
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <GhostBtn onClick={() => router.push(timetableHref)}>← Back to Timetable</GhostBtn>
                <h1 className="mt-3 text-xl sm:text-2xl font-semibold text-slate-900">
                  {session?.title || "Session"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                    📅 {session?.dateKey} ({WEEKDAYS.find((w) => w.value === session?.weekday)?.label})
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                    ⏰ {minutesToHHMM(session?.startMinute ?? 0)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                    ⏱ {session?.durationMinute} min
                  </span>
                  {session?.instructor && (
                    <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-700">
                      👤 {resolveInstructorName(session.instructor)}
                    </span>
                  )}
                </div>
              </div>

              {/* Edit / Delete / Profile buttons */}
              <div className="flex flex-wrap gap-2">
                <OutlineBtn onClick={() => router.push("/profile")}>👤 Profile</OutlineBtn>
                <OutlineBtn onClick={() => setEditOpen(true)}>✏️ Edit</OutlineBtn>
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* Messages */}
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        {/* ✅ Debug Info Section */}
        {debugInfo && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <div className="font-semibold mb-1">🔍 Debug Info</div>
            <div>Firestore total members: <span className="font-semibold">{debugInfo.totalMembersInFirestore}</span></div>
            <div>Loaded members: <span className="font-semibold">{debugInfo.loadedMembers}</span></div>
            {debugInfo.skippedMembers.length > 0 && (
              <div className="mt-2">
                <div className="text-rose-700">Skipped members (invalid status):</div>
                {debugInfo.skippedMembers.map((m) => (
                  <div key={m.uid} className="ml-3 opacity-80">
                    • {m.displayName} (status: "{m.status}")
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ✅ Reservation list section */}
        {dojoId && sessionId && session && (
          <SessionReservationsView
            dojoId={dojoId}
            sessionId={sessionId}
            sessionTitle={session.title}
            sessionDateKey={session.dateKey}
            isStaff={true}
          />
        )}

        {/* Attendance Section */}
        <Card>
          <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  ✅ Attendance ({presentCountTotal}/{members.length})
                  {search.trim() && (
                    <span className="ml-2 text-sm font-medium text-slate-500">
                      • Filtered ({presentCountFiltered}/{filteredMembers.length})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search box */}
                {members.length > 0 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search members (name/email)"
                      className="w-64 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    {search.trim() && (
                      <OutlineBtn onClick={() => setSearch("")}>Clear</OutlineBtn>
                    )}
                  </div>
                )}

                {members.length > 0 && (
                  <button
                    type="button"
                    onClick={markAllPresent}
                    disabled={busy}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✓ Mark All Present
                  </button>
                )}
              </div>
            </div>

            {members.length === 0 ? (
              <div className="text-sm text-slate-500">
                No members found.{" "}
                <button
                  type="button"
                  onClick={() => {
                    const qs = dojoId ? `?dojoId=${encodeURIComponent(dojoId)}` : "";
                    router.push(`/dojos/members${qs}`);
                  }}
                  className="text-violet-600 underline hover:text-violet-700"
                >
                  Add members
                </button>{" "}
                to your dojo first.
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="text-sm text-slate-500">
                No members match "<span className="font-semibold">{search}</span>".
              </div>
            ) : (
              <div className="grid gap-2">
                {filteredMembers.map((member) => {
                  const status = getAttendanceStatus(member.uid);
                  const beltColor = ALL_BELT_COLORS[member.beltRank || "white"] || "#FFFFFF";
                  return (
                    <div
                      key={member.uid}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                            member.isKids
                              ? "bg-violet-100 text-violet-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {member.displayName?.charAt(0).toUpperCase() || "?"}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 font-semibold text-slate-900">
                            {member.displayName}
                            {member.isKids && (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                キッズ
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                            {/* Belt color indicator */}
                            <div
                              className="h-2 w-6 rounded"
                              style={{
                                backgroundColor: beltColor,
                                border: "1px solid rgba(0,0,0,0.1)",
                              }}
                            />
                            {member.email && <span>{member.email}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Attendance buttons */}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => markAttendance(member.uid, "present")}
                          disabled={busy}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            status === "present"
                              ? "bg-emerald-500 text-white ring-2 ring-emerald-300"
                              : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          }`}
                        >
                          ✓ Present
                        </button>
                        <button
                          type="button"
                          onClick={() => markAttendance(member.uid, "late")}
                          disabled={busy}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            status === "late"
                              ? "bg-amber-500 text-white ring-2 ring-amber-300"
                              : "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          }`}
                        >
                          ⏰ Late
                        </button>
                        <button
                          type="button"
                          onClick={() => markAttendance(member.uid, "absent")}
                          disabled={busy}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            status === "absent"
                              ? "bg-rose-500 text-white ring-2 ring-rose-300"
                              : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                          }`}
                        >
                          ✗ Absent
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Session Info */}
        <Card>
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="text-sm font-semibold text-slate-700 mb-2">📋 Session Info</div>
            <div className="text-xs text-slate-500 space-y-1 font-mono">
              <div>Session ID: {sessionId}</div>
              <div>Class ID: {session?.timetableClassId || "N/A"}</div>
              <div>Dojo ID: {dojoId}</div>
              {session?.instructor && <div>Instructor: {resolveInstructorName(session.instructor)}</div>}
            </div>
          </div>
        </Card>

        {/* Edit Modal */}
        {editOpen && (
          <div
            onClick={() => setEditOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-xl"
            >
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">✏️ Edit Class</div>
                    <div className="mt-1 text-sm text-slate-500">Update title/time/duration/instructor</div>
                  </div>
                  <OutlineBtn onClick={() => setEditOpen(false)}>✕</OutlineBtn>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Title</div>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">Weekday</div>
                      <select
                        value={editWeekday}
                        onChange={(e) => setEditWeekday(Number(e.target.value))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        {WEEKDAYS.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">Start Time</div>
                      <input
                        value={editStartHHMM}
                        onChange={(e) => setEditStartHHMM(e.target.value)}
                        placeholder="07:00"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">Duration (min)</div>
                      <input
                        value={editDurationMin}
                        onChange={(e) => setEditDurationMin(Number(e.target.value || "0"))}
                        type="number"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                    </label>
                  </div>

                  {/* ✅ Instructor selection */}
                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Instructor (optional)</div>
                    <InstructorSelect
                      instructors={instructors}
                      value={editInstructor}
                      onChange={setEditInstructor}
                      disabled={busy}
                    />
                  </label>

                  <div className="flex justify-end gap-2 mt-4">
                    <OutlineBtn onClick={() => setEditOpen(false)}>Cancel</OutlineBtn>
                    <PrimaryBtn disabled={busy} onClick={onSaveEdit}>
                      {busy ? "Saving..." : "Save Changes"}
                    </PrimaryBtn>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {deleteOpen && (
          <div
            onClick={() => setDeleteOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-rose-200 bg-white shadow-xl"
            >
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="text-lg font-semibold text-rose-700">🗑️ Delete Class?</div>
                <div className="mt-3 text-sm text-slate-700">
                  Are you sure you want to delete <span className="font-semibold">"{session?.title}"</span>?
                </div>

                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  ⚠️ This will delete the class template. Existing sessions will remain.
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <OutlineBtn onClick={() => setDeleteOpen(false)}>Cancel</OutlineBtn>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onConfirmDelete}
                    className="rounded-full border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}