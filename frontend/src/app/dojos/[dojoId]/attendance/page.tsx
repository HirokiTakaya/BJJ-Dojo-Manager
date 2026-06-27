
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { useDojoName } from "@/hooks/useDojoName";
import { resolveIsStaff, type UserDocBase } from "@/lib/roles";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import {
  doc,
  getDoc,
  getDocs,
  collection,
} from "firebase/firestore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type MemberDoc = {
  uid: string;
  displayName: string;
  beltRank?: string;
  stripes?: number;
  createdAt?: any;
  status?: string;
};

type SessionDoc = {
  id: string;
  title: string;
  dateKey: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  classType?: string;
  timetableClassId?: string;
};

type AttendanceEntry = {
  sessionId: string;
  dateKey: string;
  title: string;
  uid: string;
  displayName: string;
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function getWeekStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

function getWeekLabel(dk: string) {
  const d = new Date(dk + "T00:00:00");
  const ws = getWeekStart(d);
  return `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const BELT_COLORS: Record<string, string> = {
  white: "bg-gray-200 text-gray-700",
  blue: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
  brown: "bg-amber-100 text-amber-900",
  black: "bg-gray-800 text-white",
};

// ─────────────────────────────────────────────
// Bar Chart Component
// ─────────────────────────────────────────────

function BarChart({
  data,
  maxBarHeight = 120,
}: {
  data: { label: string; value: number; highlight?: boolean }[];
  maxBarHeight?: number;
}) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-1.5 justify-between">
      {data.map((d, i) => {
        const h = (d.value / maxVal) * maxBarHeight;
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-xs font-medium text-gray-700">{d.value || ""}</span>
            <div
              className={`w-full rounded-t-md transition-all duration-500 ${
                d.highlight ? "bg-blue-500" : "bg-blue-200"
              }`}
              style={{ height: `${Math.max(h, 2)}px`, minWidth: "12px" }}
            />
            <span className="text-xs text-gray-500 truncate max-w-full">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  sub,
  color = "text-gray-900",
}: {
  icon: string;
  value: string | number;
  label: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
          {sub && <p className="text-xs text-gray-400">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function AttendanceDashboard() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const t = useTranslations("attendance");

  const dojoId = (params?.dojoId as string) || "";
  const { dojoName } = useDojoName(dojoId);

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [allAttendance, setAllAttendance] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"4w" | "8w" | "12w">("4w");

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);

  // Load all data
  useEffect(() => {
    if (authLoading || !user) return;
    if (!dojoId) {
      setError("No dojo selected.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // User doc
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!cancelled && userSnap.exists()) setUserDoc(userSnap.data() as UserDocBase);

        // Check staff
        const staffCheck = resolveIsStaff(
          userSnap.exists() ? (userSnap.data() as UserDocBase) : null
        );
        if (!staffCheck) {
          setError(t("staffAccessRequired"));
          setLoading(false);
          return;
        }

        // Members
        const membersSnap = await getDocs(collection(db, "dojos", dojoId, "members"));
        const memberList = membersSnap.docs.map((d) => ({
          uid: d.id,
          ...d.data(),
        })) as MemberDoc[];
        if (!cancelled) setMembers(memberList);

        // Sessions
        const sessionsSnap = await getDocs(collection(db, "dojos", dojoId, "sessions"));
        const sessionList = sessionsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as SessionDoc[];
        if (!cancelled) setSessions(sessionList);

        // Attendance: check both attendees and reservations subcollections
        const entries: AttendanceEntry[] = [];
        const batchPromises = sessionList.map(async (s) => {
          // Try attendees first (new check-in system)
          try {
            const attendeesSnap = await getDocs(
              collection(db, "dojos", dojoId, "sessions", s.id, "attendees")
            );
            for (const aDoc of attendeesSnap.docs) {
              const data = aDoc.data();
              entries.push({
                sessionId: s.id,
                dateKey: s.dateKey,
                title: s.title,
                uid: aDoc.id,
                displayName: data.displayName || "Unknown",
              });
            }
          } catch {}

          // Also check reservations (legacy / backup)
          try {
            const resSnap = await getDocs(
              collection(db, "dojos", dojoId, "sessions", s.id, "reservations")
            );
            for (const rDoc of resSnap.docs) {
              const data = rDoc.data();
              if (data.status === "cancelled") continue;
              // Avoid duplicates
              const already = entries.some(
                (e) => e.sessionId === s.id && e.uid === rDoc.id
              );
              if (!already) {
                entries.push({
                  sessionId: s.id,
                  dateKey: s.dateKey,
                  title: s.title,
                  uid: rDoc.id,
                  displayName: data.memberName || "Unknown",
                });
              }
            }
          } catch {}
        });

        await Promise.all(batchPromises);
        if (!cancelled) setAllAttendance(entries);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [authLoading, user, dojoId]);

  // Computed analytics
  const periodWeeks = period === "4w" ? 4 : period === "8w" ? 8 : 12;
  const periodStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return addDays(d, -periodWeeks * 7);
  }, [periodWeeks]);

  const periodStartKey = toDateKey(periodStart);

  const filteredAttendance = useMemo(
    () => allAttendance.filter((a) => a.dateKey >= periodStartKey),
    [allAttendance, periodStartKey]
  );

  // Weekly trend
  const weeklyTrend = useMemo(() => {
    const weeks = new Map<string, number>();
    const thisWeekStart = getWeekStart(new Date());

    for (let i = 0; i < periodWeeks; i++) {
      const ws = addDays(thisWeekStart, -i * 7);
      weeks.set(toDateKey(ws), 0);
    }

    for (const a of filteredAttendance) {
      const d = new Date(a.dateKey + "T00:00:00");
      const ws = getWeekStart(d);
      const key = toDateKey(ws);
      if (weeks.has(key)) weeks.set(key, (weeks.get(key) || 0) + 1);
    }

    const thisWeekKey = toDateKey(thisWeekStart);
    return Array.from(weeks.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dk, count]) => ({
        label: getWeekLabel(dk),
        value: count,
        highlight: dk === thisWeekKey,
      }));
  }, [filteredAttendance, periodWeeks]);

  // Weekday distribution
  const weekdayDist = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const a of filteredAttendance) {
      const d = new Date(a.dateKey + "T00:00:00");
      counts[d.getDay()]++;
    }
    const maxVal = Math.max(...counts, 1);
    return counts.map((c, i) => ({
      label: WEEKDAY_LABELS[i],
      value: c,
      highlight: c === maxVal,
    }));
  }, [filteredAttendance]);

  // Top members
  const topMembers = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; uid: string }>();
    for (const a of filteredAttendance) {
      const prev = counts.get(a.uid) || { name: a.displayName, count: 0, uid: a.uid };
      prev.count++;
      counts.set(a.uid, prev);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredAttendance]);

  // Popular classes
  const popularClasses = useMemo(() => {
    const counts = new Map<string, { title: string; count: number }>();
    for (const a of filteredAttendance) {
      const key = a.title;
      const prev = counts.get(key) || { title: a.title, count: 0 };
      prev.count++;
      counts.set(key, prev);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredAttendance]);

  // Retention alerts: members who haven't attended in 14+ days
  const retentionAlerts = useMemo(() => {
    const today = new Date();
    const lastSeen = new Map<string, { name: string; uid: string; lastDate: string }>();

    for (const a of allAttendance) {
      const prev = lastSeen.get(a.uid);
      if (!prev || a.dateKey > prev.lastDate) {
        lastSeen.set(a.uid, { name: a.displayName, uid: a.uid, lastDate: a.dateKey });
      }
    }

    const activeMembers = members.filter((m) => m.status !== "inactive" && m.status !== "cancelled");
    const alerts: { uid: string; name: string; daysMissing: number; beltRank?: string }[] = [];

    for (const m of activeMembers) {
      const seen = lastSeen.get(m.uid);
      if (!seen) {
        // Never attended
        const daysSinceJoin = m.createdAt
          ? Math.floor((today.getTime() - (m.createdAt.toDate?.() || new Date(m.createdAt)).getTime()) / 86400000)
          : 999;
        if (daysSinceJoin > 14) {
          alerts.push({ uid: m.uid, name: m.displayName, daysMissing: daysSinceJoin, beltRank: m.beltRank });
        }
      } else {
        const lastDate = new Date(seen.lastDate + "T00:00:00");
        const daysMissing = Math.floor((today.getTime() - lastDate.getTime()) / 86400000);
        if (daysMissing >= 14) {
          alerts.push({ uid: m.uid, name: seen.name || m.displayName, daysMissing, beltRank: m.beltRank });
        }
      }
    }

    return alerts.sort((a, b) => b.daysMissing - a.daysMissing);
  }, [allAttendance, members]);

  // Summary stats
  const totalAttendancePeriod = filteredAttendance.length;
  const uniqueAttendersPeriod = new Set(filteredAttendance.map((a) => a.uid)).size;
  const avgPerWeek = periodWeeks > 0 ? Math.round(totalAttendancePeriod / periodWeeks) : 0;
  const activeMembers = members.filter((m) => m.status !== "inactive").length;

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

  if (!isStaff) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {t("staffAccessRequired")}
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 py-8 pb-24">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/home`)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t("backToHome")}
          </button>

          <div className="flex items-start justify-between gap-4">
            <div>
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(["4w", "8w", "12w"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    period === p ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {p === "4w" ? t("weeks4") : p === "8w" ? t("weeks8") : t("weeks12")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard icon="📊" value={totalAttendancePeriod} label={t("totalCheckIns")} sub={t("lastWeeks", { weeks: periodWeeks })} />
          <StatCard icon="👥" value={uniqueAttendersPeriod} label={t("uniqueMembers")} sub={t("ofActive", { count: activeMembers })} />
          <StatCard icon="📈" value={avgPerWeek} label={t("avgPerWeek")} color="text-blue-600" />
          <StatCard
            icon="⚠️"
            value={retentionAlerts.length}
            label={t("atRisk")}
            sub={t("daysAbsent")}
            color={retentionAlerts.length > 0 ? "text-red-600" : "text-green-600"}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Weekly Trend */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              {t("weeklyTrend")}
            </h3>
            {weeklyTrend.length > 0 ? (
              <BarChart data={weeklyTrend} maxBarHeight={100} />
            ) : (
              <p className="text-gray-400 text-sm text-center py-8">{t("noData")}</p>
            )}
          </div>

          {/* Weekday Distribution */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              {t("busiestDays")}
            </h3>
            <BarChart data={weekdayDist} maxBarHeight={100} />
          </div>
        </div>

        {/* Rankings Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Top Members */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              {t("topMembers")}
            </h3>
            {topMembers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">{t("noAttendance")}</p>
            ) : (
              <div className="space-y-2">
                {topMembers.map((m, i) => {
                  const member = members.find((x) => x.uid === m.uid);
                  const beltClass = BELT_COLORS[member?.beltRank || "white"] || BELT_COLORS.white;
                  return (
                    <div key={m.uid} className="flex items-center gap-3">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          i < 3 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${beltClass}`}>
                        {member?.beltRank || "white"}
                      </span>
                      <span className="text-sm font-bold text-gray-700 w-12 text-right">
                        {m.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Popular Classes */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              {t("popularClasses")}
            </h3>
            {popularClasses.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">{t("noClasses")}</p>
            ) : (
              <div className="space-y-3">
                {popularClasses.map((c, i) => {
                  const pct = popularClasses[0]?.count
                    ? Math.round((c.count / popularClasses[0].count) * 100)
                    : 0;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.title}</p>
                        <span className="text-sm text-gray-500">{c.count}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 rounded-full h-2 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Retention Alerts */}
        {retentionAlerts.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-red-500 mb-4">
              {t("retentionAlertsTitle")}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {t("retentionAlertsDesc")}
            </p>
            <div className="space-y-2">
              {retentionAlerts.map((a) => {
                const beltClass = BELT_COLORS[a.beltRank || "white"] || BELT_COLORS.white;
                return (
                  <div
                    key={a.uid}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-100"
                  >
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-sm font-bold text-red-700 flex-shrink-0">
                      {a.name?.charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{a.name}</p>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${beltClass}`}>
                        {a.beltRank || "white"}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-red-600">{t("daysCount", { count: a.daysMissing })}</p>
                      <p className="text-xs text-gray-400">{t("absent")}</p>
                    </div>
                    <button
                      onClick={() =>
                        router.push(
                          `/dojos/${encodeURIComponent(dojoId)}/members/${encodeURIComponent(a.uid)}`
                        )
                      }
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
                    >
                      {t("view")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <BottomNavigation />
    </div>
  );
}