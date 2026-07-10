"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";
import { dbNullable } from "@/firebase";
import { getCachedUserDoc } from "@/lib/user-doc-cache";
import { resolveIsStaff, type UserDocBase } from "@/lib/roles";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type WaiverRecord = {
  id: string;
  source: "waiverSubmissions" | "waivers";
  signerType: "member" | "visitor" | "unknown";
  name: string;
  email?: string;
  phone?: string;
  authUid?: string;
  memberUid?: string;
  templateTitle?: string;
  templateVersion?: string;
  status: string;
  signedAt: any;
  createdAt: any;
  isMinor?: boolean;
  guardianName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  confirmationCode?: string;
  locale?: string;
  signature?: {
    type?: string;
    strokesJson?: string;
    strokeCount?: number;
  };
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatDateTime(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timestampSeconds(ts: any): number {
  if (!ts) return 0;
  if (ts.seconds) return ts.seconds;
  if (ts.toDate) return Math.floor(ts.toDate().getTime() / 1000);
  return 0;
}

// ─────────────────────────────────────────────
// Signature Preview
// ─────────────────────────────────────────────

type StrokePoint = [number, number] | { x: number; y: number };

function getXY(pt: StrokePoint): [number, number] {
  if (Array.isArray(pt)) return [pt[0], pt[1]];
  return [pt.x, pt.y];
}

function SignaturePreview({ strokesJson, maxHeight = "max-h-32" }: { strokesJson?: string; maxHeight?: string }) {
  if (!strokesJson || strokesJson === "[]") return null;

  let strokes: StrokePoint[][] = [];
  try {
    strokes = JSON.parse(strokesJson);
  } catch {
    return null;
  }

  if (!Array.isArray(strokes) || strokes.length === 0) return null;

  let maxCoord = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke)) continue;
    for (const pt of stroke) {
      const [x, y] = getXY(pt);
      if (x > maxCoord) maxCoord = x;
      if (y > maxCoord) maxCoord = y;
    }
  }

  const isNormalized = maxCoord <= 1.5;
  const scale = isNormalized ? 400 : 1;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke)) continue;
    for (const pt of stroke) {
      const [x, y] = getXY(pt);
      const sx = x * scale;
      const sy = y * scale;
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
  }

  if (!isFinite(minX)) return null;

  const padding = 10;
  const width = Math.max(maxX - minX + padding * 2, 100);
  const height = Math.max(maxY - minY + padding * 2, 50);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full h-auto ${maxHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {strokes.map((stroke, i) => {
          if (!Array.isArray(stroke) || stroke.length < 2) return null;
          const d = stroke
            .map((pt, j) => {
              const [x, y] = getXY(pt);
              const sx = x * scale - minX + padding;
              const sy = y * scale - minY + padding;
              return `${j === 0 ? "M" : "L"}${sx.toFixed(2)},${sy.toFixed(2)}`;
            })
            .join(" ");
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#1F2937"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function WaiversClient(props: { dojoId?: string } = {}) {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const t = useTranslations("waiver");

  const dojoId = useMemo(() => {
    const p = params as any;
    return props.dojoId || p?.dojoId || p?.dojold || "";
  }, [props.dojoId, params]);

  const { dojoName } = useDojoName(dojoId);

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [waivers, setWaivers] = useState<WaiverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "reviewed">("new");
  const [signerFilter, setSignerFilter] = useState<"all" | "member" | "visitor">("all");
  const [selectedWaiver, setSelectedWaiver] = useState<WaiverRecord | null>(null);

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);

  // Auth
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load
  useEffect(() => {
    if (authLoading || !user || !dojoId) {
      if (!authLoading) setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const db = dbNullable;
        if (!db) throw new Error("Firestore not initialized");

        // Load user doc to check staff BEFORE fetching any waiver data.
        const userSnap = await getCachedUserDoc(user.uid);
        const uData = userSnap.exists() ? (userSnap.data() as UserDocBase) : null;
        if (!cancelled && uData) {
          setUserDoc(uData);
        }

        // Staff-only page: never pull the dojo-wide waiver list for non-staff.
        // Firestore rules enforce this server-side too (waiverSubmissions
        // `list` is limited to staff / own docs); this early return avoids
        // firing queries that would be denied and lets the render-side
        // `if (!isStaff)` gate show its access message.
        if (!resolveIsStaff(uData)) {
          if (!cancelled) setLoading(false);
          return;
        }

        const all: WaiverRecord[] = [];

        // 1) waiverSubmissions (new system)
        try {
          const wsSnap = await getDocs(query(
            collection(db, "dojos", dojoId, "waiverSubmissions"),
            orderBy("createdAt", "desc")
          ));
          for (const d of wsSnap.docs) {
            const data = d.data() as any;
            all.push({
              id: d.id,
              source: "waiverSubmissions",
              signerType: data.signerType || "unknown",
              name: data.visitorName || data.fullName || "—",
              email: data.visitorEmail || data.email,
              phone: data.visitorPhone,
              authUid: data.authUid,
              memberUid: data.memberUid,
              templateTitle: data.templateTitle || "Liability Waiver",
              templateVersion: data.templateVersion,
              status: data.status || "new",
              signedAt: data.signedAt,
              createdAt: data.createdAt,
              isMinor: data.isMinor,
              guardianName: data.guardianName,
              emergencyContactName: data.emergencyContactName,
              emergencyContactPhone: data.emergencyContactPhone,
              confirmationCode: data.confirmationCode,
              locale: data.locale,
              signature: data.signature,
            });
          }
        } catch (e) {
          console.warn("[waivers] waiverSubmissions failed:", e);
        }

        // 2) waivers (legacy)
        try {
          const wSnap = await getDocs(collection(db, "dojos", dojoId, "waivers"));
          for (const d of wSnap.docs) {
            const data = d.data() as any;
            all.push({
              id: d.id,
              source: "waivers",
              signerType: "member",
              name: data.fullName || "—",
              email: data.email,
              phone: data.phone,
              authUid: data.uid,
              memberUid: data.uid,
              templateTitle: "Liability Waiver (Legacy)",
              templateVersion: data.waiverVersion,
              status: "signed",
              signedAt: data.signedAt,
              createdAt: data.signedAt,
              isMinor: data.isMinor,
              guardianName: data.guardianName,
              emergencyContactName: data.emergencyContactName,
              emergencyContactPhone: data.emergencyContactPhone,
              locale: data.locale,
            });
          }
        } catch (e) {
          console.warn("[waivers] waivers legacy failed:", e);
        }

        all.sort((a, b) => timestampSeconds(b.createdAt) - timestampSeconds(a.createdAt));

        if (!cancelled) {
          setWaivers(all);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load waivers");
          setLoading(false);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [authLoading, user, dojoId]);

  // Filtered list
  const filtered = useMemo(() => {
    return waivers.filter((w) => {
      if (filter === "new" && w.status !== "new") return false;
      if (filter === "reviewed" && w.status !== "reviewed") return false;
      if (signerFilter !== "all" && w.signerType !== signerFilter) return false;
      return true;
    });
  }, [waivers, filter, signerFilter]);

  const counts = useMemo(() => {
    const newCount = waivers.filter((w) => w.status === "new").length;
    const reviewedCount = waivers.filter((w) => w.status === "reviewed").length;
    const memberCount = waivers.filter((w) => w.signerType === "member").length;
    const visitorCount = waivers.filter((w) => w.signerType === "visitor").length;
    return { newCount, reviewedCount, memberCount, visitorCount, total: waivers.length };
  }, [waivers]);

  // Mark as reviewed
  const markReviewed = async (waiver: WaiverRecord) => {
    if (waiver.source !== "waiverSubmissions") {
      setError("Legacy waivers cannot be marked as reviewed.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const db = dbNullable;
      if (!db) throw new Error("Firestore not initialized");

      await updateDoc(
        doc(db, "dojos", dojoId, "waiverSubmissions", waiver.id),
        {
          status: "reviewed",
          reviewedBy: user?.uid,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      // Update local state
      setWaivers((prev) =>
        prev.map((w) => (w.id === waiver.id ? { ...w, status: "reviewed" } : w))
      );
      setSelectedWaiver((prev) => (prev?.id === waiver.id ? { ...prev, status: "reviewed" } : prev));
      setSuccess(`Marked ${waiver.name}'s waiver as reviewed.`);
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    } finally {
      setBusy(false);
    }
  };

  // ─── Render ───
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-5xl mx-auto px-4 py-8 pb-24">
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
        <main className="max-w-5xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            Staff access required.
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-5xl mx-auto px-4 py-8 pb-24">
        {/* Back */}
        <button
          onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/timetable`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("back")}
        </button>

        {/* Header */}
        <div className="mb-8">
          {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
          <h1 className="text-3xl font-bold text-gray-900">{t("manageTitle")}</h1>
          <p className="text-gray-600 mt-2">
            {t("summary", { total: counts.total, members: counts.memberCount, visitors: counts.visitorCount })}
            {counts.newCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                {t("pendingReviewBadge", { count: counts.newCount })}
              </span>
            )}
          </p>
        </div>

        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4">
            {success}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <div className="flex gap-1">
            <button
              onClick={() => setFilter("new")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                filter === "new" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterPending", { count: counts.newCount })}
            </button>
            <button
              onClick={() => setFilter("reviewed")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                filter === "reviewed" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterReviewed", { count: counts.reviewedCount })}
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                filter === "all" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterAll", { count: counts.total })}
            </button>
          </div>

          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => setSignerFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                signerFilter === "all" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterAllSimple")}
            </button>
            <button
              onClick={() => setSignerFilter("member")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                signerFilter === "member" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterMembers")}
            </button>
            <button
              onClick={() => setSignerFilter("visitor")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                signerFilter === "visitor" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {t("filterVisitors")}
            </button>
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-500">
            {t("noWaiversToShow")}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((w) => (
              <div
                key={`${w.source}-${w.id}`}
                onClick={() => setSelectedWaiver(w)}
                className="bg-white rounded-2xl border border-gray-200 p-5 cursor-pointer hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900">{w.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        w.signerType === "member" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      }`}>
                        {w.signerType === "member" ? t("labelMember") : t("labelVisitor")}
                      </span>
                      {w.isMinor && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {t("labelMinor")}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        w.status === "new" ? "bg-blue-100 text-blue-700" :
                        w.status === "reviewed" ? "bg-green-100 text-green-700" :
                        w.status === "signed" ? "bg-green-100 text-green-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {w.status === "new" ? t("statusPendingReview") :
                         w.status === "reviewed" ? t("statusReviewed") :
                         w.status === "signed" ? t("statusSigned") : w.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {w.email || w.phone || "—"} · {formatDateTime(w.createdAt)}
                    </p>
                  </div>

                  {w.signature?.strokesJson && w.signature.strokesJson !== "[]" && (
                    <div className="w-32 flex-shrink-0">
                      <SignaturePreview strokesJson={w.signature.strokesJson} maxHeight="max-h-16" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNavigation />

      {/* Detail Modal */}
      {selectedWaiver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setSelectedWaiver(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedWaiver.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedWaiver.templateTitle} {selectedWaiver.templateVersion && `v${selectedWaiver.templateVersion}`}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedWaiver(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("type")}</p>
                  <p className="text-sm font-medium text-gray-900 capitalize">{selectedWaiver.signerType}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("status")}</p>
                  <p className="text-sm font-medium text-gray-900 capitalize">{selectedWaiver.status}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("email")}</p>
                  <p className="text-sm text-gray-900">{selectedWaiver.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("phone")}</p>
                  <p className="text-sm text-gray-900">{selectedWaiver.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("signedAt")}</p>
                  <p className="text-sm text-gray-900">{formatDateTime(selectedWaiver.signedAt || selectedWaiver.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">{t("confirmation")}</p>
                  <p className="text-sm font-mono text-gray-900">{selectedWaiver.confirmationCode || "—"}</p>
                </div>
                {selectedWaiver.isMinor && (
                  <>
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wider text-gray-500">{t("guardian")}</p>
                      <p className="text-sm text-gray-900">{selectedWaiver.guardianName || "—"}</p>
                    </div>
                  </>
                )}
                {(selectedWaiver.emergencyContactName || selectedWaiver.emergencyContactPhone) && (
                  <div className="col-span-2">
                    <p className="text-xs uppercase tracking-wider text-gray-500">{t("emergencyContact")}</p>
                    <p className="text-sm text-gray-900">
                      {selectedWaiver.emergencyContactName || "—"}
                      {selectedWaiver.emergencyContactPhone && ` · ${selectedWaiver.emergencyContactPhone}`}
                    </p>
                  </div>
                )}
              </div>

              {/* Signature */}
              {selectedWaiver.signature?.strokesJson && selectedWaiver.signature.strokesJson !== "[]" ? (
                <div className="mb-6">
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t("signature")}</p>
                  <SignaturePreview strokesJson={selectedWaiver.signature.strokesJson} maxHeight="max-h-48" />
                </div>
              ) : (
                <div className="mb-6">
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t("signature")}</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center text-xs text-gray-500">
                    {t("noSignatureData")}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {selectedWaiver.signerType === "member" && selectedWaiver.memberUid && (
                  <button
                    onClick={() => {
                      router.push(`/dojos/${encodeURIComponent(dojoId)}/members/${encodeURIComponent(selectedWaiver.memberUid!)}`);
                    }}
                    className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
                  >
                    {t("viewMember")}
                  </button>
                )}
                {selectedWaiver.status === "new" && selectedWaiver.source === "waiverSubmissions" && (
                  <button
                    onClick={() => markReviewed(selectedWaiver)}
                    disabled={busy}
                    className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
                  >
                    {busy ? t("saving") : t("markAsReviewed")}
                  </button>
                )}
                {selectedWaiver.status !== "new" && (
                  <button
                    onClick={() => setSelectedWaiver(null)}
                    className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition"
                  >
                    {t("close")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}