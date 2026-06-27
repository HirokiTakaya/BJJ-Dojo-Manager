"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { resolveDojoId, resolveIsStaff } from "@/lib/roles";
import { useDojoName } from "@/hooks/useDojoName";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import {
  getRetentionAlerts,
  updateRetentionSettings,
  type AlertsSummary,
  type MemberAlert,
  type RiskLevel,
} from "@/lib/retention-api";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const BELT_COLORS: Record<string, string> = {
  white: "#E5E7EB", blue: "#2563EB", purple: "#7C3AED", brown: "#92400E", black: "#1F2937",
  "kids-white": "#E5E7EB", "kids-grey": "#9CA3AF", "kids-yellow": "#FBBF24",
  "kids-orange": "#F97316", "kids-green": "#22C55E",
  "grey-white": "#9CA3AF", grey: "#6B7280", "grey-black": "#4B5563",
  "yellow-white": "#FDE047", yellow: "#FACC15", "yellow-black": "#EAB308",
  "orange-white": "#FDBA74", orange: "#F97316", "orange-black": "#EA580C",
  "green-white": "#86EFAC", green: "#22C55E", "green-black": "#16A34A",
};

type SortKey = "days" | "name" | "belt" | "sessions";
type SortDir = "asc" | "desc";
type FilterRisk = "all" | RiskLevel;
type FilterBelt = "all" | "white" | "blue" | "purple" | "brown" | "black" | "kids";

const BELT_ORDER = [
  "white", "grey-white", "grey", "grey-black",
  "yellow-white", "yellow", "yellow-black",
  "orange-white", "orange", "orange-black",
  "green-white", "green", "green-black",
  "blue", "purple", "brown", "black",
];

function beltIndex(belt: string): number {
  const idx = BELT_ORDER.indexOf(belt);
  return idx >= 0 ? idx : 0;
}

// ─────────────────────────────────────────────
// Sub Components
// ─────────────────────────────────────────────

function RiskBadge({ level, labels }: { level: RiskLevel; labels: Record<RiskLevel, string> }) {
  const config = {
    critical: { bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
    warning: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" },
    watch: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  };
  const c = config[level];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {labels[level]}
    </span>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${color}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function RetentionAlertsClient() {
  const router = useRouter();
  const params = useParams<{ dojoId?: string }>();
  const { user, loading: authLoading } = useAuth();
  const t = useTranslations("retention");

  const riskLabels: Record<RiskLevel, string> = {
    critical: t("riskCritical"),
    warning: t("riskWarning"),
    watch: t("riskWatch"),
  };

  const [userDoc, setUserDoc] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [dojoId, setDojoId] = useState<string | null>(null);
  const { dojoName } = useDojoName(dojoId ?? "");

  const [data, setData] = useState<AlertsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tempThreshold, setTempThreshold] = useState(10);
  const [tempCriticalMult, setTempCriticalMult] = useState(2.0);
  const [tempWatchRatio, setTempWatchRatio] = useState(0.7);
  const [savingSettings, setSavingSettings] = useState(false);

  const [filterRisk, setFilterRisk] = useState<FilterRisk>("all");
  const [filterBelt, setFilterBelt] = useState<FilterBelt>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) { setProfileLoading(false); return; }
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const ud = snap.exists() ? snap.data() : null;
        if (!cancelled) { setUserDoc(ud); setDojoId(params?.dojoId || resolveDojoId(ud)); }
      } catch (e: any) { if (!cancelled) setError(e?.message || "Failed to load profile."); }
      finally { if (!cancelled) setProfileLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user, params?.dojoId]);

  const loadAlerts = useCallback(async () => {
    if (!dojoId) return;
    setLoading(true); setError("");
    try {
      const result = await getRetentionAlerts(dojoId);
      setData(result);
      setTempThreshold(result.settings.thresholdDays);
      setTempCriticalMult(result.settings.criticalMultiplier);
      setTempWatchRatio(result.settings.watchRatio);
    } catch (e: any) { setError(e?.message || t("errors.loadFailed")); }
    finally { setLoading(false); }
  }, [dojoId, t]);

  useEffect(() => { if (dojoId && isStaff) loadAlerts(); }, [dojoId, isStaff, loadAlerts]);

  const filteredAlerts = useMemo(() => {
    if (!data) return [];
    let list = data.alerts;
    if (filterRisk !== "all") list = list.filter((m) => m.riskLevel === filterRisk);
    if (filterBelt !== "all") {
      if (filterBelt === "kids") list = list.filter((m) => m.isKids);
      else list = list.filter((m) => m.beltRank === filterBelt || m.beltRank.startsWith(filterBelt));
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => m.displayName.toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q));
    const sorted = [...list];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "days": { const ad = a.daysSinceLastAttendance < 0 ? 9999 : a.daysSinceLastAttendance; const bd = b.daysSinceLastAttendance < 0 ? 9999 : b.daysSinceLastAttendance; cmp = ad - bd; break; }
        case "name": cmp = a.displayName.localeCompare(b.displayName); break;
        case "belt": cmp = beltIndex(a.beltRank) - beltIndex(b.beltRank); break;
        case "sessions": cmp = a.totalSessions - b.totalSessions; break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [data, filterRisk, filterBelt, search, sortKey, sortDir]);

  const saveSettings = async () => {
    if (!dojoId || tempThreshold < 1) return;
    setSavingSettings(true); setError("");
    try {
      await updateRetentionSettings(dojoId, { thresholdDays: tempThreshold, criticalMultiplier: tempCriticalMult, watchRatio: tempWatchRatio });
      setSettingsOpen(false); setSuccess(t("settingsSaved"));
      await loadAlerts();
      setTimeout(() => setSuccess(""), 2000);
    } catch (e: any) { setError(e?.message || t("errors.saveFailed")); }
    finally { setSavingSettings(false); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  if (authLoading || profileLoading) {
    return (<div className="min-h-screen bg-gray-50"><Navigation /><main className="max-w-5xl mx-auto px-4 py-8 pb-24"><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div></main><BottomNavigation /></div>);
  }
  if (!user) return null;
  if (!isStaff) {
    return (<div className="min-h-screen bg-gray-50"><Navigation /><main className="max-w-5xl mx-auto px-4 py-8 pb-24"><div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{t("staffOnly")}</div></main><BottomNavigation /></div>);
  }

  const stats = data?.stats;
  const settings = data?.settings;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-8 pb-24 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
              <p className="mt-1 text-sm text-gray-500">{t("subtitleDetail")} <span className="font-semibold text-gray-700">{t("subtitleDays", { days: settings?.thresholdDays ?? 10 })}</span> {t("subtitleSuffix")}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSettingsOpen(true)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">{t("settings")}</button>
              <button onClick={loadAlerts} disabled={loading} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition disabled:opacity-50">{loading ? t("loading") : t("refresh")}</button>
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">{success}</div>}

        {!loading && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label={t("statTotalAtRisk")} value={stats.totalAtRisk} color="bg-gray-100" icon="📊" />
            <StatCard label={t("statCritical")} value={stats.critical} color="bg-red-100" icon="🚨" />
            <StatCard label={t("statWarning")} value={stats.warning} color="bg-amber-100" icon="⚠️" />
            <StatCard label={t("statWatch")} value={stats.watch} color="bg-blue-100" icon="👀" />
          </div>
        )}

        {!loading && data && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")} className="w-56 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1">
                {([{ key: "all", label: t("filterAll") }, { key: "critical", label: t("filterCritical") }, { key: "warning", label: t("filterWarning") }, { key: "watch", label: t("filterWatch") }] as const).map((opt) => (
                  <button key={opt.key} onClick={() => setFilterRisk(opt.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${filterRisk === opt.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{opt.label}</button>
                ))}
              </div>
              <select value={filterBelt} onChange={(e) => setFilterBelt(e.target.value as FilterBelt)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">{t("filterAllBelts")}</option>
                <option value="white">{t("filterWhiteBelt")}</option>
                <option value="blue">{t("filterBlueBelt")}</option>
                <option value="purple">{t("filterPurpleBelt")}</option>
                <option value="brown">{t("filterBrownBelt")}</option>
                <option value="black">{t("filterBlackBelt")}</option>
                <option value="kids">{t("filterKids")}</option>
              </select>
              <div className="flex gap-1 ml-auto">
                {([{ key: "days", label: t("sortDaysAway") }, { key: "name", label: t("sortName") }, { key: "belt", label: t("sortBelt") }, { key: "sessions", label: t("sortSessions") }] as const).map((opt) => (
                  <button key={opt.key} onClick={() => toggleSort(opt.key)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${sortKey === opt.key ? "bg-blue-100 text-blue-700" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                    {opt.label}{sortKey === opt.key && <span className="ml-0.5">{sortDir === "desc" ? "↓" : "↑"}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <p className="text-sm text-gray-500">{t("analyzing")}</p>
            </div>
          </div>
        )}

        {!loading && data && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            {filteredAlerts.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🎉</div>
                <p className="text-lg font-semibold text-gray-900">{data.alerts.length === 0 ? t("noAlertsAllGood") : t("noResults")}</p>
                <p className="text-sm text-gray-500 mt-1">{data.alerts.length === 0 ? t("noAlertsAllGoodDesc") : t("noResultsDesc")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAlerts.map((m) => {
                  const beltCol = BELT_COLORS[m.beltRank] || "#E5E7EB";
                  return (
                    <div key={m.memberUid} className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition ${m.riskLevel === "critical" ? "border-red-200 bg-red-50/50" : m.riskLevel === "warning" ? "border-amber-200 bg-amber-50/50" : "border-blue-100 bg-blue-50/30"}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${m.isKids ? "bg-purple-100 text-purple-700" : "bg-gray-200 text-gray-700"}`}>{m.displayName?.charAt(0).toUpperCase() || "?"}</div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 truncate">{m.displayName}</span>
                            <RiskBadge level={m.riskLevel} labels={riskLabels} />
                            {m.isKids && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{t("kids")}</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            <div className="flex items-center gap-1">
                              <div className="w-5 h-2 rounded-sm" style={{ backgroundColor: beltCol, border: "1px solid rgba(0,0,0,0.1)" }} />
                              <span className="text-xs text-gray-500 capitalize">{m.beltRank.replace("-", " ")}{m.stripes > 0 && ` (${m.stripes > 1 ? t("stripePlural", { count: m.stripes }) : t("stripeSingular", { count: m.stripes })})`}</span>
                            </div>
                            {m.email && <span className="text-xs text-gray-400 truncate">{m.email}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-lg font-bold ${m.riskLevel === "critical" ? "text-red-600" : m.riskLevel === "warning" ? "text-amber-600" : "text-blue-600"}`}>
                          {m.daysSinceLastAttendance < 0 ? t("never") : t("daysShort", { days: m.daysSinceLastAttendance })}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{m.daysSinceLastAttendance < 0 ? t("noAttendanceRecorded") : t("lastAttendedDate", { date: m.lastAttendedDate })}</div>
                        {m.lastAttendedSessionTitle && m.daysSinceLastAttendance >= 0 && <div className="text-xs text-gray-400 truncate max-w-[160px]">{m.lastAttendedSessionTitle}</div>}
                        <div className="text-xs text-gray-300 mt-0.5">{m.totalSessions !== 1 ? t("sessionsTotal", { count: m.totalSessions }) : t("sessionsTotalSingular", { count: m.totalSessions })}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
      <BottomNavigation />

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setSettingsOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">{t("modalTitle")}</h3>
                <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("thresholdLabel")}</label>
                  <p className="text-xs text-gray-500 mb-2">{t("thresholdDesc")}</p>
                  <input type="number" value={tempThreshold} min={1} onChange={(e) => setTempThreshold(Math.max(1, Number(e.target.value || "1")))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{t("riskWatch")}</span>
                    <span>{t("riskWatchRange", { from: Math.floor(tempThreshold * tempWatchRatio), to: tempThreshold - 1 })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{t("riskWarning")}</span>
                    <span>{t("riskWarningRange", { from: tempThreshold, to: Math.floor(tempThreshold * tempCriticalMult) - 1 })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{t("riskCritical")}</span>
                    <span>{t("riskCriticalRange", { from: Math.floor(tempThreshold * tempCriticalMult) })}</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setSettingsOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition">{t("cancel")}</button>
                  <button onClick={saveSettings} disabled={savingSettings} className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50">{savingSettings ? t("saving") : t("save")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}