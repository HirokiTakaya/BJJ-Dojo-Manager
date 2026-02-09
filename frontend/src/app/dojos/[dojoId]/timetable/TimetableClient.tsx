"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, db as dbNullable } from "@/firebase";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
      writeBatch,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  getFirestore,
} from "firebase/firestore";

import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";

import WeeklyScheduleGrid, {
  type WeeklyClassItem,
  type WeeklyScheduleGridRef,
  type ClassType,
  CLASS_TYPE_CONFIG,
} from "@/app/dojos/[dojoId]/timetable/WeeklyScheduleGrid";
import {
  WEEKDAYS,
  createTimetableClass,
  updateTimetableClass,
  deleteTimetableClass,
  listTimetable,
  minutesToHHMM,
  hhmmToMinutes,
  type TimetableClass,
} from "@/lib/timetable-api";
import { getOrCreateSession, toDateKey } from "@/lib/sessions";
import { DojoLite, searchPublicDojosByPrefix } from "@/lib/searchDojos";
import {
  STAFF_ROLES,
  normalizeRole,
  resolveRole,
  resolveDojoId,
  resolveIsStaff,
  type UserDocBase,
} from "@/lib/roles";

// Extended user doc type (adds fields specific to Timetable)
type UserDoc = UserDocBase & {
  dojoName?: string | null;
  staffProfile?: { dojoId?: string | null; dojoName?: string | null; roleInDojo?: string };
  studentProfile?: { dojoId?: string | null; dojoName?: string | null; fullName?: string; belt?: string };
  displayName?: string;
  email?: string;
};

type Session = {
  id: string;
  timetableClassId: string;
  title: string;
  dateKey: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  instructor?: string;
  classType?: ClassType;
};

type Reservation = {
  dojoId: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  status: "confirmed" | "cancelled";
  createdAt: any;
};

type InstructorInfo = {
  uid: string;
  displayName: string;
  email?: string;
  roleInDojo?: string;
};

// Helpers
function startOfToday(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function minuteToHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function parseDateKeyLocal(dk: string) {
  const [y, m, d] = dk.split("-").map(Number);
  return !y || !m || !d ? new Date() : new Date(y, m - 1, d);
}
function isDateInPast(dk: string) {
  const sd = parseDateKeyLocal(dk);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return sd < t;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let __dbCache: any = null;
async function waitForDb(maxMs = 5000) {
  if (__dbCache) return __dbCache;
  if (dbNullable) {
    __dbCache = dbNullable;
    return __dbCache;
  }
  try {
    const db = getFirestore(auth.app);
    __dbCache = db;
    return __dbCache;
  } catch {}
  const start = Date.now();
  while (!dbNullable) {
    if (Date.now() - start > maxMs) return null;
    await sleep(80);
  }
  __dbCache = dbNullable;
  return __dbCache;
}

function buildPlannedSessionsForWeek(classes: TimetableClass[], weekStart: Date): Session[] {
  const out: Session[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const dateKey = toDateKey(day);
    const weekday = day.getDay();
    for (const c of classes) {
      if (c.weekday !== weekday) continue;
      out.push({
        id: `${dateKey}__${c.id}`,
        timetableClassId: c.id,
        title: c.title || "Class",
        dateKey,
        weekday,
        startMinute: c.startMinute ?? 0,
        durationMinute: c.durationMinute ?? 60,
        instructor: (c as any).instructor,
        classType: ((c as any).classType || "adult") as ClassType,
      });
    }
  }
  return out.sort((a, b) =>
    a.dateKey !== b.dateKey ? a.dateKey.localeCompare(b.dateKey) : a.startMinute - b.startMinute
  );
}

// Export dependency loader (CDN UMD)
declare global {
  interface Window {
    html2canvas?: any;
    jspdf?: any;
  }
}

async function loadScriptOnce(src: string, globalCheck: () => any, maxWaitMs = 10000): Promise<any> {
  if (typeof window === "undefined") throw new Error("Client only");

  const existing = globalCheck();
  if (existing) return existing;

  const normalize = (u: string) => {
    try {
      return new URL(u, window.location.href).href;
    } catch {
      return u;
    }
  };

  const target = normalize(src);
  const existingScript = Array.from(document.getElementsByTagName("script")).find((s) => normalize(s.src) === target);

  if (!existingScript) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(s);
    });
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const val = globalCheck();
    if (val) return val;
    await sleep(50);
  }

  throw new Error(`Timeout waiting for global after loading: ${src}`);
}

async function getHtml2Canvas(): Promise<any> {
  return await loadScriptOnce(
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    () => window.html2canvas
  );
}

async function getJsPDF(): Promise<any> {
  await loadScriptOnce(
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    () => window.jspdf
  );
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error("jsPDF is not available on window.jspdf.jsPDF");
  return jsPDF;
}

// Color sanitizer for html2canvas
function sanitizeColorsForHtml2Canvas(clonedDoc: Document) {
  const unsupportedColorPattern = /lab\(|lch\(|oklab\(|oklch\(/i;
  const dv = clonedDoc.defaultView || window;

  const allElements = clonedDoc.querySelectorAll("*");
  allElements.forEach((elem) => {
    try {
      const el = elem as HTMLElement;
      const computed = dv.getComputedStyle(elem);

      if (unsupportedColorPattern.test(computed.backgroundColor || "")) el.style.backgroundColor = "#ffffff";
      if (unsupportedColorPattern.test(computed.color || "")) el.style.color = "#000000";
      if (unsupportedColorPattern.test(computed.borderColor || "")) el.style.borderColor = "#cccccc";
    } catch {}
  });
}

// Firestore helpers

type TimetableSnapshot = {
  weekday: number;
  startMinute: number;
  durationMinute: number;
  title: string;
  instructor?: string;
  classType?: ClassType;
};

function normType(v: any): ClassType {
  return v === "kids" ? "kids" : "adult";
}

function parseSessionId(sessionId: string): { dateKey?: string; timetableClassId?: string } {
  const idx = sessionId.indexOf("__");
  if (idx <= 0) return {};
  const dateKey = sessionId.slice(0, idx);
  const timetableClassId = sessionId.slice(idx + 2);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey) || !timetableClassId) return {};
  return { dateKey, timetableClassId };
}

async function touchTimetableMeta(db: any, dojoId: string, by?: string) {
  // ✅ 生徒側でも監視しやすい場所に「更新フラグ」を書く（権限により失敗してもOK）
  const rootPatch = {
    timetableUpdatedAt: serverTimestamp(),
    timetableUpdatedBy: by || null,
  };

  const metaPatch = {
    updatedAt: serverTimestamp(),
    updatedBy: by || null,
  };

  const results = await Promise.allSettled([
    // staff が書ける想定
    setDoc(doc(db, "dojos", dojoId), rootPatch, { merge: true }),
    setDoc(doc(db, "dojos", dojoId, "meta", "timetable"), metaPatch, { merge: true }),

    // 生徒が read できる想定（検索にも使っている）
    setDoc(doc(db, "publicDojos", dojoId), rootPatch, { merge: true }),
    setDoc(doc(db, "publicDojos", dojoId, "meta", "timetable"), metaPatch, { merge: true }),
  ]);

  // すべて失敗した場合だけログ（permission-denied などはよくある）
  if (results.every((r) => r.status === "rejected")) {
    console.warn("Failed to touch timetable meta (all writes rejected)");
  }
}

async function syncUpcomingSessionsForTimetableEdit(
  db: any,
  args: {
    dojoId: string;
    timetableClassId: string;
    prev: TimetableSnapshot;
    next: TimetableSnapshot;
  }
): Promise<number> {
  const { dojoId, timetableClassId, prev, next } = args;

  // ✅ 今日以降のみ（ローカルタイム 기준）
  const todayKey = toDateKey(startOfToday(new Date()));

  const snap = await getDocs(collection(db, "dojos", dojoId, "sessions"));

  let batch = writeBatch(db);
  let ops = 0;
  let updated = 0;

  const commitIfNeeded = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (const d of snap.docs) {
    const sid = d.id;
    const data = d.data() as any;

    let dateKey = String(data.dateKey || "");
    let tcid = String(data.timetableClassId || "");

    // timetableClassId / dateKey が無い古いデータでも、ID から推測する
    if (!dateKey || !tcid) {
      const parsed = parseSessionId(sid);
      if (!dateKey && parsed.dateKey) dateKey = parsed.dateKey;
      if (!tcid && parsed.timetableClassId) tcid = parsed.timetableClassId;
    }

    if (!tcid || tcid !== timetableClassId) continue;
    if (!dateKey || dateKey < todayKey) continue;

    // 手動上書きが明示されているものは触らない
    if (data.manualOverride === true) continue;

    // ✅ まず「時間のフィールドだけ」同期できるか判定
    const timeOk =
      (data.weekday == null || Number(data.weekday) === Number(prev.weekday)) &&
      (data.startMinute == null || Number(data.startMinute) === Number(prev.startMinute)) &&
      (data.durationMinute == null || Number(data.durationMinute) === Number(prev.durationMinute));

    if (!timeOk) continue;

    // ✅ タイトル/インストラクター/種別は、古い値と一致している時だけ更新（個別カスタムを壊さない）
    const titleOk = data.title == null || String(data.title) === String(prev.title);
    const instructorOk =
      data.instructor == null || String(data.instructor || "") === String(prev.instructor || "");
    const classTypeOk = data.classType == null || normType(data.classType) === normType(prev.classType || "adult");

    const patch: any = {
      updatedAt: serverTimestamp(),
      syncedFromTimetableAt: serverTimestamp(),
      weekday: next.weekday,
      startMinute: next.startMinute,
      durationMinute: next.durationMinute,
    };

    if (titleOk) patch.title = next.title;
    if (instructorOk) patch.instructor = next.instructor || null;
    if (classTypeOk) patch.classType = next.classType || "adult";

    // 後方互換: 欠けてる場合は補完しておく
    if (data.timetableClassId == null) patch.timetableClassId = timetableClassId;
    if (data.dateKey == null && dateKey) patch.dateKey = dateKey;

    batch.set(d.ref, patch, { merge: true });
    ops += 1;
    updated += 1;

    // Firestore batch は 500 操作まで
    if (ops >= 450) await commitIfNeeded();
  }

  await commitIfNeeded();
  return updated;
}

async function ensureMemberRegistration(
  db: any,
  p: { dojoId: string; userId: string; displayName?: string; email?: string; roleInDojo?: string; beltRank?: string }
) {
  const { dojoId, userId, displayName, email, roleInDojo = "student", beltRank = "white" } = p;
  try {
    const ref = doc(db, "dojos", dojoId, "members", userId);
    if ((await getDoc(ref)).exists()) return false;
    await setDoc(ref, {
      uid: userId,
      dojoId,
      displayName: displayName || email || userId.substring(0, 8),
      email: email || null,
      roleInDojo,
      role: roleInDojo,
      status: "active",
      beltRank,
      stripes: 0,
      isKids: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

async function loadInstructors(db: any, dojoId: string) {
  const instructors: InstructorInfo[] = [];
  try {
    const snap = await getDocs(collection(db, "dojos", dojoId, "members"));
    for (const d of snap.docs) {
      const data = d.data();
      const role = normalizeRole(data.roleInDojo || data.role);
      if (STAFF_ROLES.has(role)) {
        instructors.push({
          uid: d.id,
          displayName: data.displayName || data.name || data.email || d.id,
          email: data.email,
          roleInDojo: data.roleInDojo || data.role,
        });
      }
    }
    instructors.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {}
  return instructors;
}

async function listTimetableFromFirestore(db: any, dojoId: string) {
  try {
    const snap = await getDocs(collection(db, "dojos", dojoId, "timetableClasses"));
    return snap.docs.map((d) => {
      const data = d.data() as any;

      const weekday = (data.weekday ?? data.dayOfWeek ?? 0) as number;

      let startMinute = (data.startMinute ?? 0) as number;
      if (data.startMinute == null && typeof data.startTime === "string" && data.startTime) {
        const match = data.startTime.match(/^(\d{1,2}):(\d{2})$/);
        if (match) {
          startMinute = Number(match[1]) * 60 + Number(match[2]);
        }
      }

      let durationMinute = (data.durationMinute ?? 60) as number;
      if (
        data.durationMinute == null &&
        typeof data.startTime === "string" &&
        data.startTime &&
        typeof data.endTime === "string" &&
        data.endTime
      ) {
        const startMatch = data.startTime.match(/^(\d{1,2}):(\d{2})$/);
        const endMatch = data.endTime.match(/^(\d{1,2}):(\d{2})$/);
        if (startMatch && endMatch) {
          const start = Number(startMatch[1]) * 60 + Number(startMatch[2]);
          const end = Number(endMatch[1]) * 60 + Number(endMatch[2]);
          durationMinute = Math.max(end - start, 30);
        }
      }

      return {
        id: d.id,
        title: data.title || "Class",
        weekday,
        startMinute,
        durationMinute,
        instructor: data.instructor,
        classType: data.classType || "adult",
      } as TimetableClass;
    });
  } catch {
    return [];
  }
}

async function loadTimetableClassesUnified(dojoId: string, db: any) {
  try {
    // ✅ 空配列でも「正常結果」として採用（0件はあり得る）
    const apiRows = await listTimetable(dojoId);
    return apiRows;
  } catch {
    // ✅ API が落ちた/エラーのときだけ Firestore fallback
    if (db) {
      try {
        return await listTimetableFromFirestore(db, dojoId);
      } catch {}
    }
    return [];
  }
}

async function loadSessionsFromFirestore(db: any, dojoId: string, startDK: string, endDK: string) {
  const m = new Map<string, any>();
  try {
    const snap = await getDocs(collection(db, "dojos", dojoId, "sessions"));
    for (const d of snap.docs) {
      const data = d.data();
      if (data.dateKey && data.dateKey >= startDK && data.dateKey <= endDK) m.set(d.id, { id: d.id, ...data });
    }
  } catch {}
  return m;
}

async function loadMyReservations(db: any, dojoId: string, userId: string, sessionIds: string[]) {
  const m = new Map<string, Reservation>();
  const results = await Promise.all(
    sessionIds.map(async (sid) => {
      try {
        const snap = await getDoc(doc(db, "dojos", dojoId, "sessions", sid, "reservations", userId));
        if (snap.exists()) {
          const d = snap.data() as any;
          if (d.status !== "cancelled")
            return {
              sessionId: sid,
              reservation: {
                dojoId,
                sessionId: sid,
                memberId: userId,
                memberName: d.memberName || "",
                status: d.status || "confirmed",
                createdAt: d.createdAt,
              } as Reservation,
            };
        }
      } catch {}
      return null;
    })
  );
  for (const r of results) if (r) m.set(r.sessionId, r.reservation);
  return m;
}

// Sub-components
const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">{children}</div>
);

const Alert = ({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) => {
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

const ClassTypeSelect = ({
  value,
  onChange,
  disabled,
}: {
  value: ClassType;
  onChange: (v: ClassType) => void;
  disabled?: boolean;
}) => (
  <div className="flex flex-wrap gap-2">
    {(["adult", "kids", "mixed"] as ClassType[]).map((type) => {
      const config = CLASS_TYPE_CONFIG[type];
      const isSelected = value === type;
      return (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          disabled={disabled}
          className={[
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            isSelected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            disabled ? "cursor-not-allowed opacity-50" : "",
          ].join(" ")}
        >
          {config.emoji} {config.label}
        </button>
      );
    })}
  </div>
);

const FilterTabs = ({ value, onChange }: { value: ClassType | "all"; onChange: (v: ClassType | "all") => void }) => {
  const options: Array<{ key: ClassType | "all"; label: string; emoji?: string }> = [
    { key: "all", label: "All" },
    { key: "adult", label: "Adult", emoji: "🥋" },
    { key: "kids", label: "Kids", emoji: "👶" },
    { key: "mixed", label: "Mixed", emoji: "👨‍👩‍👧" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={[
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            value === opt.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
          ].join(" ")}
        >
          {opt.emoji && <span className="mr-1">{opt.emoji}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
};

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
  const resolvedValue = useMemo(() => {
    if (!value) return "";
    const byName = instructors.find((i) => i.displayName === value);
    if (byName) return byName.displayName;
    const byUid = instructors.find((i) => i.uid === value);
    return byUid ? byUid.displayName : value;
  }, [value, instructors]);

  const [mode, setMode] = useState<"select" | "manual">(() => {
    if (!value) return "select";
    return instructors.find((i) => i.displayName === value) || instructors.find((i) => i.uid === value)
      ? "select"
      : "manual";
  });

  useEffect(() => {
    if (
      instructors.length > 0 &&
      value &&
      (instructors.find((i) => i.displayName === value) || instructors.find((i) => i.uid === value))
    )
      setMode("select");
  }, [instructors, value]);

  return (
    <div className="space-y-2">
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

      {mode === "select" ? (
        <select
          value={resolvedValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="">(No instructor)</option>
          {instructors.map((i) => (
            <option key={i.uid} value={i.displayName}>
              {i.displayName}
              {i.roleInDojo ? ` (${i.roleInDojo})` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={resolvedValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter instructor name..."
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function TimetableClient() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [dojoId, setDojoId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");

  const { dojoName } = useDojoName(dojoId ?? "");

  const [weekStart, setWeekStart] = useState(() => startOfToday(new Date()));
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [myReservations, setMyReservations] = useState<Map<string, Reservation>>(new Map());

  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [memberRegistered, setMemberRegistered] = useState(false);

  const [dojoSearchTerm, setDojoSearchTerm] = useState("");
  const [dojoSearchBusy, setDojoSearchBusy] = useState(false);
  const [dojoCandidates, setDojoCandidates] = useState<DojoLite[]>([]);

  const [instructors, setInstructors] = useState<InstructorInfo[]>([]);
  const [filterType, setFilterType] = useState<ClassType | "all">("all");

  const [exporting, setExporting] = useState(false);
  const gridRef = useRef<WeeklyScheduleGridRef>(null);

  // Quick add form
  const [title, setTitle] = useState("All Levels Gi");
  const [weekday, setWeekday] = useState<number>(1);
  const [startHHMM, setStartHHMM] = useState("07:00");
  const [durationMin, setDurationMin] = useState(60);
  const [instructor, setInstructor] = useState("");
  const [classType, setClassType] = useState<ClassType>("adult");

  // Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDateKey, setModalDateKey] = useState<string>("");
  const [modalWeekday, setModalWeekday] = useState<number>(1);
  const [modalStartHHMM, setModalStartHHMM] = useState("07:00");
  const [modalDurationMin, setModalDurationMin] = useState(60);
  const [modalTitle, setModalTitle] = useState("All Levels Gi");
  const [modalInstructor, setModalInstructor] = useState("");
  const [modalClassType, setModalClassType] = useState<ClassType>("adult");

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<TimetableClass | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWeekday, setEditWeekday] = useState<number>(1);
  const [editStartHHMM, setEditStartHHMM] = useState("07:00");
  const [editDurationMin, setEditDurationMin] = useState(60);
  const [editInstructor, setEditInstructor] = useState("");
  const [editClassType, setEditClassType] = useState<ClassType>("adult");

  // Delete modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingClass, setDeletingClass] = useState<TimetableClass | null>(null);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(4);

  // Reserve modal
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string>("");

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);

  const resolveInstructorName = (iv: string | undefined) => {
    if (!iv) return "";
    const byName = instructors.find((i) => i.displayName === iv);
    if (byName) return byName.displayName;
    const byUid = instructors.find((i) => i.uid === iv);
    return byUid ? byUid.displayName : iv;
  };

  // Export PNG
  const exportToPng = useCallback(async () => {
    const el = gridRef.current?.getGridElement();
    if (!el) {
      setErr("Grid element not found");
      return;
    }
    setExporting(true);
    setErr("");
    setSuccessMsg("");
    try {
      const html2canvas = await getHtml2Canvas();
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        onclone: (clonedDoc: Document) => {
          sanitizeColorsForHtml2Canvas(clonedDoc);
        },
      });

      canvas.toBlob((blob: Blob | null) => {
        if (!blob) {
          setErr("Failed to create PNG blob");
          setExporting(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `timetable-${toDateKey(weekStart)}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setSuccessMsg("PNG exported!");
        setExporting(false);
      }, "image/png");
    } catch (e: any) {
      setErr(e?.message || "Failed to export PNG");
      setExporting(false);
    }
  }, [weekStart]);

  // Export PDF
  const exportToPdf = useCallback(async () => {
    const el = gridRef.current?.getGridElement();
    if (!el) {
      setErr("Grid element not found");
      return;
    }
    setExporting(true);
    setErr("");
    setSuccessMsg("");
    try {
      const html2canvas = await getHtml2Canvas();
      const jsPDF = await getJsPDF();

      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        onclone: (clonedDoc: Document) => {
          sanitizeColorsForHtml2Canvas(clonedDoc);
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      const pdf = new jsPDF({
        orientation: imgWidth > imgHeight ? "landscape" : "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const margin = 10;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;

      const ratio = Math.min(availableWidth / imgWidth, availableHeight / imgHeight);
      const scaledWidth = imgWidth * ratio;
      const scaledHeight = imgHeight * ratio;

      const xOffset = (pageWidth - scaledWidth) / 2;
      const yOffset = (pageHeight - scaledHeight) / 2;

      pdf.addImage(imgData, "PNG", xOffset, yOffset, scaledWidth, scaledHeight);
      pdf.save(`timetable-${toDateKey(weekStart)}.pdf`);

      setSuccessMsg("PDF exported!");
    } catch (e: any) {
      setErr(e?.message || "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }, [weekStart]);

  // Effects
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setUserDoc(null);
        setDojoId(null);
        setUserRole(null);
        setUserName("");
        setProfileLoading(false);
        return;
      }
      setProfileLoading(true);
      try {
        const db = await waitForDb();
        if (!db || cancelled) return;
        const snap = await getDoc(doc(db, "users", user.uid));
        const ud = snap.exists() ? (snap.data() as UserDoc) : null;
        const did = resolveDojoId(ud);

        setUserDoc(ud);
        setDojoId(did);
        setUserRole(resolveRole(ud));
        setUserName(ud?.displayName || ud?.studentProfile?.fullName || ud?.email || "");

        if (did && !resolveIsStaff(ud) && !cancelled) {
          const registered = await ensureMemberRegistration(db, {
            dojoId: did,
            userId: user.uid,
            displayName: ud?.displayName || "",
            email: ud?.email || user.email || "",
            roleInDojo: "student",
            beltRank: ud?.studentProfile?.belt || "white",
          });
          if (registered) setMemberRegistered(true);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load profile.");
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!dojoId || !isStaff) return;
    let cancelled = false;
    (async () => {
      const db = await waitForDb();
      if (!db || cancelled) return;
      const list = await loadInstructors(db, dojoId);
      if (!cancelled) setInstructors(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [dojoId, isStaff]);

  useEffect(() => {
    if (dojoId) return;
    const term = dojoSearchTerm.trim();
    if (!term || term.length < 2) {
      setDojoCandidates([]);
      return;
    }
    setDojoSearchBusy(true);
    const timer = setTimeout(async () => {
      try {
        const db = await waitForDb();
        if (db) setDojoCandidates(await searchPublicDojosByPrefix(db, term, 10));
      } catch {} finally {
        setDojoSearchBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [dojoSearchTerm, dojoId]);

  const selectDojo = async (dojo: DojoLite) => {
    if (!user) return;
    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      const db = await waitForDb();
      if (!db) throw new Error("Firestore not ready.");
      const userRef = doc(db, "users", user.uid);

      const patch: any = { dojoId: dojo.id, dojoName: dojo.name ?? null, updatedAt: serverTimestamp() };
      const staffFlag = resolveIsStaff(userDoc);

      if (staffFlag) patch.staffProfile = { dojoId: dojo.id, dojoName: dojo.name ?? "" };
      else patch.studentProfile = { ...(userDoc?.studentProfile || {}), dojoId: dojo.id, dojoName: dojo.name ?? "" };

      await setDoc(userRef, patch, { merge: true });

      if (!staffFlag) {
        await ensureMemberRegistration(db, {
          dojoId: dojo.id,
          userId: user.uid,
          displayName: userName || user.email || "",
          email: user.email || "",
          roleInDojo: "student",
        });
      }

      setDojoId(dojo.id);
      setDojoCandidates([]);
      setDojoSearchTerm("");
      setSuccessMsg(`Selected gym: ${dojo.name}`);
    } catch (e: any) {
      setErr(e?.message || "Failed to select dojo.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dojoId) return;
      setBusy(true);
      setErr("");
      try {
        const db = await waitForDb();
        if (!db || cancelled) return;
        const rows = await loadTimetableClassesUnified(dojoId, db);
        if (!cancelled) setClasses(rows);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load timetable.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dojoId, isStaff]);

  const refresh = useCallback(async () => {
    if (!dojoId) return;
    const db = await waitForDb();
    if (db) setClasses(await loadTimetableClassesUnified(dojoId, db));
  }, [dojoId]);


// ✅ Timetable 更新シグナルを監視して、生徒側にも即反映
  useEffect(() => {
    if (!dojoId) return;

    let cancelled = false;
    const unsubs: Array<() => void> = [];
    let timer: any = null;

    const requestRefresh = () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        try {
          await refresh();
        } catch (e) {
          console.warn("timetable refresh failed:", e);
        }
      }, 150);
    };

    (async () => {
      const db = await waitForDb();
      if (!db || cancelled) return;

      // ✅ 生徒が read できる可能性が高い publicDojos を監視（最優先）
      const pubRef = doc(db, "publicDojos", dojoId);
      unsubs.push(
        onSnapshot(
          pubRef,
          () => requestRefresh(),
          (err) => console.warn("public dojo snapshot error:", err)
        )
      );

      // ✅ meta がある場合はそれも（permission-denied は無視でOK）
      const pubMetaRef = doc(db, "publicDojos", dojoId, "meta", "timetable");
      unsubs.push(
        onSnapshot(
          pubMetaRef,
          () => requestRefresh(),
          (err) => console.warn("public timetable meta snapshot error:", err)
        )
      );

      // ✅ 既存: dojos 側（読めるユーザーだけでOK）
      const dojoRef = doc(db, "dojos", dojoId);
      unsubs.push(
        onSnapshot(
          dojoRef,
          () => requestRefresh(),
          (err) => console.warn("dojo doc snapshot error:", err)
        )
      );

      const metaRef = doc(db, "dojos", dojoId, "meta", "timetable");
      unsubs.push(
        onSnapshot(
          metaRef,
          () => requestRefresh(),
          (err) => console.warn("timetable meta snapshot error:", err)
        )
      );

      // 初回も一度リフレッシュ（snapshot 前に UI を合わせる）
      requestRefresh();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const u of unsubs) {
        try {
          u();
        } catch {}
      }
    };
  }, [dojoId, refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dojoId || !user) return;
      if (isStaff) {
        setDataLoading(false);
        return;
      }
      setDataLoading(true);
      try {
        const db = await waitForDb();
        if (!db || cancelled) return;

        const weekEnd = addDays(weekStart, 6);
        const startDK = toDateKey(weekStart);
        const endDK = toDateKey(weekEnd);

        const planned = buildPlannedSessionsForWeek(classes, weekStart);
        const merged = new Map<string, Session>();
        for (const s of planned) merged.set(s.id, s);

        // ✅ 現在の timetable(template) に存在する classId だけ有効
        const activeClassIds = new Set(classes.map((c) => c.id));

        const dbSessions = await loadSessionsFromFirestore(db, dojoId, startDK, endDK);
        for (const [sid, data] of dbSessions) {
          // ✅ timetable で削除されたテンプレに紐づく session は生徒 UI から除外
          const parsed = parseSessionId(sid);
          const tcid = String((data as any).timetableClassId || parsed.timetableClassId || "");
          if (tcid && !activeClassIds.has(tcid)) continue;

          const prev = merged.get(sid);

          // ✅ Timetable の変更を生徒側に反映させるため、
          // manualOverride が true の session だけが timetable を上書きする。
          // （prev が無い＝ad-hoc session の場合は session を採用）
          const useSession = (data as any).manualOverride === true || !prev;

          merged.set(sid, {
            id: sid,
            timetableClassId: tcid || prev?.timetableClassId || "",
            title: useSession
              ? (data as any).title || prev?.title || "Class"
              : prev?.title || (data as any).title || "Class",
            dateKey: (data as any).dateKey || parsed.dateKey || prev?.dateKey || "",
            weekday: useSession ? (data as any).weekday ?? prev?.weekday ?? 0 : prev?.weekday ?? (data as any).weekday ?? 0,
            startMinute: useSession
              ? (data as any).startMinute ?? prev?.startMinute ?? 0
              : prev?.startMinute ?? (data as any).startMinute ?? 0,
            durationMinute: useSession
              ? (data as any).durationMinute ?? prev?.durationMinute ?? 60
              : prev?.durationMinute ?? (data as any).durationMinute ?? 60,
            instructor: useSession ? (data as any).instructor || prev?.instructor : prev?.instructor || (data as any).instructor,
            classType: (useSession
              ? (data as any).classType || prev?.classType || "adult"
              : prev?.classType || (data as any).classType || "adult") as ClassType,
          });
}

        const sessionList = Array.from(merged.values())
          .filter((s) => s.dateKey && s.dateKey >= startDK && s.dateKey <= endDK)
          .sort((a, b) => (a.dateKey !== b.dateKey ? a.dateKey.localeCompare(b.dateKey) : a.startMinute - b.startMinute));

        const reservationsMap = await loadMyReservations(
          db,
          dojoId,
          user.uid,
          sessionList.map((s) => s.id)
        );

        if (!cancelled) {
          setSessions(sessionList);
          setMyReservations(reservationsMap);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load sessions.");
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dojoId, user, weekStart, isStaff, classes]);

  const sessionById = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  const gridItems: WeeklyClassItem[] = useMemo(() => {
    if (isStaff)
      return classes.map((c) => ({
        id: c.id,
        title: c.title,
        weekday: c.weekday,
        startMinute: c.startMinute,
        durationMinute: c.durationMinute,
        status: "available" as const,
        instructor: (c as any).instructor,
        classType: ((c as any).classType || "adult") as ClassType,
      }));

    return sessions.map((s) => {
      const past = isDateInPast(s.dateKey);
      const reserved = myReservations.has(s.id);
      return {
        id: s.id,
        title: s.title,
        weekday: s.weekday,
        startMinute: s.startMinute,
        durationMinute: s.durationMinute,
        dateKey: s.dateKey,
        status: past ? ("past" as const) : reserved ? ("reserved" as const) : ("available" as const),
        instructor: s.instructor,
        classType: (s.classType || "adult") as ClassType,
      };
    });
  }, [isStaff, classes, sessions, myReservations]);

  const canCreate = useMemo(
    () => dojoId && title.trim() && /^\d{1,2}:\d{2}$/.test(startHHMM.trim()) && durationMin >= 15,
    [dojoId, title, startHHMM, durationMin]
  );

  const onCreate = async () => {
    if (!dojoId || !canCreate) return;
    setBusy(true);
    setErr("");
    try {
      await createTimetableClass(dojoId, {
        title: title.trim(),
        weekday,
        startMinute: hhmmToMinutes(startHHMM),
        durationMinute: durationMin,
        instructor: instructor || undefined,
        classType,
      } as any);

      const db = await waitForDb();
      if (db) await touchTimetableMeta(db, dojoId, user?.uid);

      await refresh();
      setSuccessMsg("Class created!");
    } catch (e: any) {
      setErr(e?.message || "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  const openDeleteConfirm = (k: TimetableClass) => {
    setDeletingClass(k);
    setDeleteConfirmOpen(true);
  };

  const onConfirmDelete = async () => {
    if (!dojoId || !deletingClass) return;
    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      await deleteTimetableClass(dojoId, deletingClass.id);
      setDeleteConfirmOpen(false);
      setDeletingClass(null);
      setSuccessMsg(`Deleted: ${deletingClass.title}`);

      const db = await waitForDb();
      if (db) await touchTimetableMeta(db, dojoId, user?.uid);

      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (k: TimetableClass) => {
    setEditingClass(k);
    setEditTitle(k.title);
    setEditWeekday(k.weekday);
    setEditStartHHMM(minutesToHHMM(k.startMinute));
    setEditDurationMin(k.durationMinute);
    setEditInstructor(resolveInstructorName((k as any).instructor || ""));
    setEditClassType(((k as any).classType || "adult") as ClassType);
    setEditModalOpen(true);
  };

  const onEditSave = async () => {
    if (!dojoId || !editingClass) return;
    const t = editTitle.trim();
    if (!t) return setErr("Title required.");
    if (!/^\d{1,2}:\d{2}$/.test(editStartHHMM.trim())) return setErr("Time must be HH:MM.");
    if (editDurationMin < 15) return setErr("Duration >= 15.");

    setBusy(true);
    setErr("");
    setSuccessMsg("");

    const prevSnapshot: TimetableSnapshot = {
      title: editingClass.title,
      weekday: editingClass.weekday,
      startMinute: editingClass.startMinute,
      durationMinute: editingClass.durationMinute,
      instructor: (editingClass as any).instructor || "",
      classType: (editingClass as any).classType || "adult",
    };

    const nextSnapshot: TimetableSnapshot = {
      title: t,
      weekday: editWeekday,
      startMinute: hhmmToMinutes(editStartHHMM),
      durationMinute: editDurationMin,
      instructor: editInstructor || "",
      classType: editClassType || "adult",
    };

    try {
      await updateTimetableClass(dojoId, editingClass.id, {
        title: t,
        weekday: editWeekday,
        startMinute: hhmmToMinutes(editStartHHMM),
        durationMinute: editDurationMin,
        instructor: editInstructor || undefined,
        classType: editClassType,
      } as any);
      setEditModalOpen(false);
      setEditingClass(null);

      const db = await waitForDb();
      if (db) {
        const synced = await syncUpcomingSessionsForTimetableEdit(db, {
          dojoId,
          timetableClassId: editingClass.id,
          prev: prevSnapshot,
          next: nextSnapshot,
        });

        await touchTimetableMeta(db, dojoId, user?.uid);

        if (synced > 0) {
          setSuccessMsg(`Updated: ${t} (synced ${synced} sessions)`);
        } else {
          setSuccessMsg(`Updated: ${t}`);
        }
      } else {
        setSuccessMsg(`Updated: ${t}`);
      }

      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const onClickClassStaff = async (klass: WeeklyClassItem, dateKey: string) => {
    const db = await waitForDb();
    if (!db || !dojoId || !user) return;
    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      const session = await getOrCreateSession(db, {
        dojoId,
        timetableClassId: klass.id,
        title: klass.title,
        weekday: klass.weekday,
        startMinute: klass.startMinute,
        durationMinute: klass.durationMinute,
        dateKey,
        createdBy: user.uid,
        instructor: klass.instructor,
        classType: klass.classType,
      });
      router.push(`/dojos/${encodeURIComponent(dojoId)}/sessions/${encodeURIComponent(session.id)}`);
    } catch (e: any) {
      setErr(e?.message || "Failed to open session.");
    } finally {
      setBusy(false);
    }
  };

  const onClickEmptySlot = (args: { weekday: number; startMinute: number; dateKey: string }) => {
    setModalWeekday(args.weekday);
    setModalStartHHMM(minuteToHHMM(args.startMinute));
    setModalDurationMin(60);
    setModalTitle("All Levels Gi");
    setModalInstructor("");
    setModalClassType("adult");
    setModalDateKey(args.dateKey);
    setModalOpen(true);
  };

  const onModalCreate = async () => {
    const db = await waitForDb();
    if (!db || !dojoId || !user) return;
    const t = modalTitle.trim();
    if (!t) return setErr("Title required.");
    if (!/^\d{1,2}:\d{2}$/.test(modalStartHHMM.trim())) return setErr("Time must be HH:MM.");
    if (modalDurationMin < 15) return setErr("Duration >= 15.");

    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      const classId = await createTimetableClass(dojoId, {
        title: t,
        weekday: modalWeekday,
        startMinute: hhmmToMinutes(modalStartHHMM),
        durationMinute: modalDurationMin,
        instructor: modalInstructor || undefined,
        classType: modalClassType,
      } as any);

      const baseDate = parseDateKeyLocal(modalDateKey);
      const created: string[] = [];

      for (let i = 0; i < repeatWeeks; i++) {
        const sessionDate = addDays(baseDate, i * 7);
        const sessionDK = toDateKey(sessionDate);
        await getOrCreateSession(db, {
          dojoId,
          timetableClassId: classId,
          title: t,
          weekday: modalWeekday,
          startMinute: hhmmToMinutes(modalStartHHMM),
          durationMinute: modalDurationMin,
          dateKey: sessionDK,
          createdBy: user.uid,
          instructor: modalInstructor || undefined,
          classType: modalClassType,
        });
        created.push(sessionDK);
      }

      setModalOpen(false);
      setSuccessMsg(`Created class + ${repeatWeeks} session(s): ${created.join(", ")}`);

      await touchTimetableMeta(db, dojoId, user?.uid);

      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  const onClickClassStudent = (klass: WeeklyClassItem, dateKey: string) => {
    const s = sessionById.get(klass.id);
    if (!s || isDateInPast(dateKey)) return;
    setSelectedSession(s);
    setSelectedDateKey(dateKey);
    setReserveModalOpen(true);
  };

  const makeReservation = async () => {
    const db = await waitForDb();
    if (!db || !dojoId || !user || !selectedSession) return;
    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      const sessionRef = doc(db, "dojos", dojoId, "sessions", selectedSession.id);
      if (!(await getDoc(sessionRef)).exists())
        await setDoc(sessionRef, {
          dojoId,
          timetableClassId: selectedSession.timetableClassId,
          title: selectedSession.title,
          dateKey: selectedSession.dateKey,
          weekday: selectedSession.weekday,
          startMinute: selectedSession.startMinute,
          durationMinute: selectedSession.durationMinute,
          instructor: selectedSession.instructor,
          classType: selectedSession.classType,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });

      await setDoc(doc(db, "dojos", dojoId, "sessions", selectedSession.id, "reservations", user.uid), {
        dojoId,
        sessionId: selectedSession.id,
        memberId: user.uid,
        memberName: userName,
        status: "confirmed",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setMyReservations((prev) => {
        const m = new Map(prev);
        m.set(selectedSession.id, {
          dojoId,
          sessionId: selectedSession.id,
          memberId: user.uid,
          memberName: userName,
          status: "confirmed",
          createdAt: new Date(),
        });
        return m;
      });

      setReserveModalOpen(false);
      setSelectedSession(null);
      setSuccessMsg(`Reserved: ${selectedSession.title} (${selectedDateKey || selectedSession.dateKey})`);
    } catch (e: any) {
      setErr((e as any)?.code === "permission-denied" ? "Permission denied." : (e as any)?.message || "Failed to reserve.");
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async (sessionId: string) => {
    const db = await waitForDb();
    if (!db || !dojoId || !user) return;
    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      await deleteDoc(doc(db, "dojos", dojoId, "sessions", sessionId, "reservations", user.uid));
      setMyReservations((prev) => {
        const m = new Map(prev);
        m.delete(sessionId);
        return m;
      });
      setSuccessMsg("Reservation cancelled.");
    } catch (e: any) {
      setErr(e?.code === "permission-denied" ? "Permission denied." : e?.message || "Failed to cancel.");
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (loading || profileLoading)
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-5xl p-4 sm:p-6">
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <div className="text-slate-900 text-lg font-semibold">Loading…</div>
            </div>
          </Card>
        </div>
      </div>
    );

  if (!user)
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Navigation dojoId={dojoId} isStaff={isStaff} userName={userName} userEmail={user?.email || undefined} />
        <div className="mx-auto max-w-5xl p-4 sm:p-6 pb-20 md:pb-6">
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <div className="text-slate-900 text-lg font-semibold">Redirecting…</div>
            </div>
          </Card>
        </div>
        <BottomNavigation dojoId={dojoId} isStaff={isStaff} />
      </div>
    );

  if (!dojoId)
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Navigation dojoId={dojoId} isStaff={isStaff} userName={userName} userEmail={user?.email || undefined} />
        <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-4 pb-20 md:pb-6">
          <Card>
            <div className="px-5 py-4 sm:px-6 sm:py-5">
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">Timetable</h1>
              <p className="mt-1 text-sm text-slate-500">Select a gym to view the schedule.</p>
            </div>
          </Card>

          {err && <Alert kind="error">{err}</Alert>}
          {successMsg && <Alert kind="success">{successMsg}</Alert>}

          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4">
              <label className="space-y-1 block">
                <div className="text-sm font-semibold text-slate-700">Search Gym</div>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Enter gym name..."
                  value={dojoSearchTerm}
                  onChange={(e) => setDojoSearchTerm(e.target.value)}
                />
              </label>

              {dojoSearchBusy && <div className="text-sm text-slate-500">Searching...</div>}

              {dojoCandidates.length > 0 && (
                <div className="grid gap-2">
                  {dojoCandidates.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => selectDojo(d)}
                      disabled={busy}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="font-semibold text-slate-900">{d.name ?? "(no name)"}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {d.city ?? ""} {d.country ?? ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {dojoSearchTerm.length >= 2 && dojoCandidates.length === 0 && !dojoSearchBusy && (
                <div className="text-sm text-slate-500">No gyms found.</div>
              )}
            </div>
          </Card>
        </div>
        <BottomNavigation dojoId={dojoId} isStaff={isStaff} />
      </div>
    );

  const viewPill = isStaff ? (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-xs font-extrabold text-violet-700">
      Staff View
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-700">
      Student View
    </span>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Navigation dojoId={dojoId} isStaff={isStaff} userName={userName} userEmail={user?.email || undefined} />

      <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4 pb-20 md:pb-6">
        {/* Header */}
        <Card>
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">Timetable</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  {viewPill}
                  {!isStaff && userName && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      {userName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <GhostBtn onClick={() => setWeekStart((p) => addDays(p, -7))}>← Prev</GhostBtn>
                <GhostBtn onClick={() => setWeekStart(startOfToday(new Date()))}>Today</GhostBtn>
                <GhostBtn onClick={() => setWeekStart((p) => addDays(p, 7))}>Next →</GhostBtn>
              </div>
            </div>
          </div>
        </Card>

        {memberRegistered && <Alert kind="success">Automatically registered as a member.</Alert>}
        {err && <Alert kind="error">{err}</Alert>}
        {successMsg && <Alert kind="success">{successMsg}</Alert>}

        {/* Filter + Export */}
        <Card>
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">Filter by Class Type</div>
                <FilterTabs value={filterType} onChange={setFilterType} />
              </div>
              <div className="flex flex-wrap gap-2">
                <OutlineBtn onClick={exportToPng} disabled={exporting}>
                  {exporting ? "Exporting..." : "📷 Export PNG"}
                </OutlineBtn>
                <OutlineBtn onClick={exportToPdf} disabled={exporting}>
                  {exporting ? "Exporting..." : "📄 Export PDF"}
                </OutlineBtn>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {(["adult", "kids", "mixed"] as ClassType[]).map((type) => {
                const config = CLASS_TYPE_CONFIG[type];
                return (
                  <div key={type} className="flex items-center gap-1">
                    <span
                      className="inline-block w-4 h-4 rounded"
                      style={{ backgroundColor: config.bgColor, border: `1px solid ${config.borderColor}` }}
                    />
                    <span className={`font-medium ${config.textColor}`}>
                      {config.emoji} {config.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Staff: Add class quick */}
        {isStaff && (
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">Add Class (Quick)</div>
                  <div className="mt-1 text-sm text-slate-500">
                    Tip: Click an empty slot on the grid to create a class and pre-create sessions.
                  </div>
                </div>
                <PrimaryBtn disabled={!canCreate || busy} onClick={onCreate}>
                  {busy ? "Working..." : "Create Class Only"}
                </PrimaryBtn>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <label className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Title</div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Weekday</div>
                  <select
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
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
                  <div className="text-sm font-semibold text-slate-700">Start</div>
                  <input
                    value={startHHMM}
                    onChange={(e) => setStartHHMM(e.target.value)}
                    placeholder="07:00"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Duration (min)</div>
                  <input
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value || "0"))}
                    type="number"
                    placeholder="60"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Instructor</div>
                  <InstructorSelect instructors={instructors} value={instructor} onChange={setInstructor} disabled={busy} />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Class Type</div>
                  <ClassTypeSelect value={classType} onChange={setClassType} disabled={busy} />
                </label>
              </div>
            </div>
          </Card>
        )}

        {/* Student: Reservations */}
        {!isStaff && (
          <>
            {dataLoading && (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm">
                Loading schedule...
              </div>
            )}

            {!dataLoading && myReservations.size > 0 && (
              <Card>
                <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-3">
                  <div className="text-base font-semibold text-slate-900">
                    My Reservations <span className="text-slate-500 font-medium">({myReservations.size})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(myReservations.entries()).map(([sid]) => {
                      const s = sessions.find((x) => x.id === sid);
                      if (!s) return null;
                      const past = isDateInPast(s.dateKey);
                      const typeConfig = CLASS_TYPE_CONFIG[s.classType || "adult"];
                      return (
                        <div
                          key={sid}
                          className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm text-emerald-800 border border-emerald-200"
                        >
                          <span className="font-semibold">
                            {typeConfig.emoji} {s.title}{" "}
                            <span className="font-normal text-emerald-700">({s.dateKey})</span>
                            {s.instructor && (
                              <span className="text-emerald-600 ml-1">• {resolveInstructorName(s.instructor)}</span>
                            )}
                          </span>
                          <button
                            onClick={() => cancelReservation(sid)}
                            disabled={busy || past}
                            className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}

            {!dataLoading && (
              <div className="text-sm text-slate-600">
                Status: <span className="font-semibold text-blue-700">Blue</span> = Available ·{" "}
                <span className="font-semibold text-emerald-700">Green</span> = Reserved ·{" "}
                <span className="text-slate-500">Gray</span> = Past
              </div>
            )}
          </>
        )}

        {/* Grid */}
        <Card>
          <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-3">
            {busy && <div className="text-sm text-slate-500">Loading…</div>}
            <WeeklyScheduleGrid
              ref={gridRef}
              weekStart={weekStart}
              classes={gridItems}
              onClickClass={isStaff ? onClickClassStaff : onClickClassStudent}
              onClickEmptySlot={isStaff ? onClickEmptySlot : undefined}
              slotMin={30}
              minHour={6}
              maxHour={22}
              filterType={filterType}
            />
          </div>
        </Card>

        {/* Staff: Registered Classes */}
        {isStaff && (
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-3">
              <div className="text-base font-semibold text-slate-900">Registered Classes</div>
              {classes.length === 0 && <div className="text-sm text-slate-500">No classes yet.</div>}

              <div className="grid gap-2">
                {classes.map((c) => {
                  const typeConfig = CLASS_TYPE_CONFIG[((c as any).classType || "adult") as ClassType];
                  return (
                    <div
                      key={c.id}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          <span>{typeConfig.emoji}</span>
                          <span>{c.title}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.textColor}`}
                            style={{ backgroundColor: typeConfig.bgColor }}
                          >
                            {typeConfig.label}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {WEEKDAYS.find((w) => w.value === c.weekday)?.label} / {minutesToHHMM(c.startMinute)} /{" "}
                          {c.durationMinute} min
                          {(c as any).instructor && (
                            <span className="ml-2 text-slate-700">
                              • Instructor: {resolveInstructorName((c as any).instructor)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <OutlineBtn disabled={busy} onClick={() => openEditModal(c)}>
                          ✏️ Edit
                        </OutlineBtn>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openDeleteConfirm(c)}
                          className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {/* Create Modal */}
        {isStaff && modalOpen && (
          <div onClick={() => setModalOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-xl">
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">Create Class + Sessions</div>
                    <div className="mt-1 text-sm text-slate-500">
                      Starting from: <span className="font-semibold text-slate-800">{modalDateKey}</span> (
                      {WEEKDAYS.find((w) => w.value === modalWeekday)?.label})
                    </div>
                  </div>
                  <OutlineBtn onClick={() => setModalOpen(false)}>✕</OutlineBtn>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Class Title</div>
                    <input
                      value={modalTitle}
                      onChange={(e) => setModalTitle(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">Weekday</div>
                      <select
                        value={modalWeekday}
                        onChange={(e) => setModalWeekday(Number(e.target.value))}
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
                        value={modalStartHHMM}
                        onChange={(e) => setModalStartHHMM(e.target.value)}
                        placeholder="07:00"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">Duration (min)</div>
                      <input
                        value={modalDurationMin}
                        onChange={(e) => setModalDurationMin(Number(e.target.value || "0"))}
                        type="number"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                    </label>
                  </div>

                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Class Type</div>
                    <ClassTypeSelect value={modalClassType} onChange={setModalClassType} disabled={busy} />
                  </label>

                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Instructor (optional)</div>
                    <InstructorSelect instructors={instructors} value={modalInstructor} onChange={setModalInstructor} disabled={busy} />
                  </label>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-sm font-semibold text-slate-800">🔁 Repeat Sessions</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>Create sessions for</span>
                      <select
                        value={repeatWeeks}
                        onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value={1}>1 week</option>
                        <option value={2}>2 weeks</option>
                        <option value={4}>4 weeks</option>
                        <option value={8}>8 weeks</option>
                        <option value={12}>12 weeks</option>
                      </select>
                      <span>starting {modalDateKey}</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <OutlineBtn onClick={() => setModalOpen(false)}>Cancel</OutlineBtn>
                    <PrimaryBtn disabled={busy} onClick={onModalCreate}>
                      {busy ? "Creating..." : `Create Class + ${repeatWeeks} Session(s)`}
                    </PrimaryBtn>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {isStaff && editModalOpen && editingClass && (
          <div onClick={() => setEditModalOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-xl">
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">Edit Class</div>
                    <div className="mt-1 text-sm text-slate-500">Update title, time, duration, instructor, or type</div>
                  </div>
                  <OutlineBtn onClick={() => setEditModalOpen(false)}>✕</OutlineBtn>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Class Title</div>
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

                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Class Type</div>
                    <ClassTypeSelect value={editClassType} onChange={setEditClassType} disabled={busy} />
                  </label>

                  <label className="space-y-1 block">
                    <div className="text-sm font-semibold text-slate-700">Instructor (optional)</div>
                    <InstructorSelect instructors={instructors} value={editInstructor} onChange={setEditInstructor} disabled={busy} />
                  </label>

                  <div className="flex justify-end gap-2">
                    <OutlineBtn onClick={() => setEditModalOpen(false)}>Cancel</OutlineBtn>
                    <PrimaryBtn disabled={busy} onClick={onEditSave}>
                      {busy ? "Saving..." : "Save Changes"}
                    </PrimaryBtn>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {isStaff && deleteConfirmOpen && deletingClass && (
          <div onClick={() => setDeleteConfirmOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-rose-200 bg-white shadow-xl">
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="text-lg font-semibold text-rose-700">Delete Class?</div>
                <div className="mt-3 text-sm text-slate-700">
                  Are you sure you want to delete <span className="font-semibold">"{deletingClass.title}"</span>?
                </div>
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  This will only delete the timetable template. Existing sessions will remain.
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <OutlineBtn onClick={() => setDeleteConfirmOpen(false)}>Cancel</OutlineBtn>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onConfirmDelete}
                    className="rounded-full border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "Deleting..." : "Delete Class"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reserve Modal (Student) */}
        {!isStaff && reserveModalOpen && selectedSession && (
          <div onClick={() => setReserveModalOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-xl">
              <div className="px-5 py-5 sm:px-6 sm:py-6">
                {(() => {
                  const reserved = myReservations.has(selectedSession.id);
                  const past = isDateInPast(selectedSession.dateKey);
                  const typeConfig = CLASS_TYPE_CONFIG[selectedSession.classType || "adult"];
                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-slate-900">{reserved ? "Reservation" : "Reserve Class"}</div>
                          <div className="mt-1 text-sm text-slate-500">Confirm or cancel your reservation</div>
                        </div>
                        <OutlineBtn onClick={() => setReserveModalOpen(false)}>✕</OutlineBtn>
                      </div>

                      <div
                        className={[
                          "mt-5 rounded-3xl border px-4 py-4",
                          reserved ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50",
                          past ? "opacity-75" : "",
                        ].join(" ")}
                      >
                        <div className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                          {typeConfig.emoji} {selectedSession.title}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 space-y-1">
                          <div>📆 {selectedSession.dateKey}</div>
                          <div>
                            ⏰ {minuteToHHMM(selectedSession.startMinute)} ~{" "}
                            {minuteToHHMM(selectedSession.startMinute + selectedSession.durationMinute)}
                          </div>
                          <div>⏱ {selectedSession.durationMinute} min</div>
                          {selectedSession.instructor && <div>👤 Instructor: {resolveInstructorName(selectedSession.instructor)}</div>}
                        </div>
                        {past && <div className="mt-3 text-xs text-slate-500">This class is in the past.</div>}
                      </div>

                      <div className="mt-5 flex justify-end gap-2">
                        <OutlineBtn onClick={() => setReserveModalOpen(false)}>Close</OutlineBtn>
                        {reserved ? (
                          <button
                            onClick={async () => {
                              await cancelReservation(selectedSession.id);
                              setReserveModalOpen(false);
                              setSelectedSession(null);
                            }}
                            disabled={busy || past}
                            className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? "Working..." : "Cancel Reservation"}
                          </button>
                        ) : (
                          <button
                            onClick={makeReservation}
                            disabled={busy || past}
                            className="rounded-full border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? "Reserving..." : "Reserve"}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomNavigation dojoId={dojoId} isStaff={isStaff} />
    </div>
  );
}
