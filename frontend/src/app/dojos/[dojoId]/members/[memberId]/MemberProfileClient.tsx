"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { useDojoName } from "@/hooks/useDojoName";
import { resolveIsStaff, type UserDocBase } from "@/lib/roles";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  deleteField,
  collection,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Belt =
  | "white" | "blue" | "purple" | "brown" | "black"
  | "kids-white" | "kids-grey" | "kids-yellow" | "kids-orange" | "kids-green"
  | "kids-grey-white" | "kids-grey-black"
  | "kids-yellow-white" | "kids-yellow-black"
  | "kids-orange-white" | "kids-orange-black"
  | "kids-green-white" | "kids-green-black";

type StripeToken = "none" | "white" | "red" | "yellow" | "black";
type StripePattern = [StripeToken, StripeToken, StripeToken, StripeToken];

type MemberProfile = {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  roleInDojo: string;
  status: string;
  beltRank?: Belt | string;
  stripes?: number;
  stripePattern?: StripeToken[];
  kidsDegree?: number;
  joinedAt?: any;
  emergencyContact?: { name: string; phone: string; relationship: string };
  address?: { postalCode?: string; prefecture?: string; city?: string; line1?: string };
  notes?: string;
};

type AttendanceRecord = {
  sessionId: string;
  dateKey: string;
  title: string;
  status: "present" | "absent" | "late";
};

type RankHistory = {
  id: string;
  previousBelt: string;
  newBelt: string;
  previousStripes: number;
  newStripes: number;
  previousStripePattern?: StripeToken[];
  newStripePattern?: StripeToken[];
  previousKidsDegree?: number | null;
  newKidsDegree?: number | null;
  promotedBy: string;
  notes?: string;
  createdAt: any;
};

// ─────────────────────────────────────────────
// Belt Config
// ─────────────────────────────────────────────

const BELT_OPTIONS: { value: Belt; label: string; color: string; group: "adult" | "kids" }[] = [
  { value: "white", label: "White", color: "#E5E7EB", group: "adult" },
  { value: "blue", label: "Blue", color: "#2563EB", group: "adult" },
  { value: "purple", label: "Purple", color: "#7C3AED", group: "adult" },
  { value: "brown", label: "Brown", color: "#92400E", group: "adult" },
  { value: "black", label: "Black", color: "#1F2937", group: "adult" },
  { value: "kids-white", label: "Kids White", color: "#E5E7EB", group: "kids" },
  { value: "kids-grey", label: "Kids Grey", color: "#9CA3AF", group: "kids" },
  { value: "kids-yellow", label: "Kids Yellow", color: "#FBBF24", group: "kids" },
  { value: "kids-orange", label: "Kids Orange", color: "#F97316", group: "kids" },
  { value: "kids-green", label: "Kids Green", color: "#22C55E", group: "kids" },
  { value: "kids-grey-white", label: "Kids Grey/White", color: "#9CA3AF", group: "kids" },
  { value: "kids-grey-black", label: "Kids Grey/Black", color: "#9CA3AF", group: "kids" },
  { value: "kids-yellow-white", label: "Kids Yellow/White", color: "#FBBF24", group: "kids" },
  { value: "kids-yellow-black", label: "Kids Yellow/Black", color: "#FBBF24", group: "kids" },
  { value: "kids-orange-white", label: "Kids Orange/White", color: "#F97316", group: "kids" },
  { value: "kids-orange-black", label: "Kids Orange/Black", color: "#F97316", group: "kids" },
  { value: "kids-green-white", label: "Kids Green/White", color: "#22C55E", group: "kids" },
  { value: "kids-green-black", label: "Kids Green/Black", color: "#22C55E", group: "kids" },
];

const STRIPE_TOKENS: StripeToken[] = ["none", "white", "red", "yellow", "black"];
const STRIPE_LABELS: Record<StripeToken, string> = { none: "None", white: "White", red: "Red", yellow: "Yellow", black: "Black" };
const STRIPE_COLORS: Record<Exclude<StripeToken, "none">, string> = { white: "#FFFFFF", red: "#EF4444", yellow: "#FACC15", black: "#111827" };
const ROLE_LABELS: Record<string, string> = { owner: "Owner", staff: "Staff", staff_member: "Staff", coach: "Coach", instructor: "Instructor", student: "Student" };

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isKidsBelt(v?: string): boolean { return (v || "").startsWith("kids-"); }
function beltLabel(v?: string): string { return BELT_OPTIONS.find((b) => b.value === v)?.label ?? v ?? "White"; }
function beltColor(v?: string): string { return BELT_OPTIONS.find((b) => b.value === v)?.color ?? "#E5E7EB"; }

function defaultStripeToken(belt?: string): StripeToken {
  return belt === "white" || belt === "kids-white" ? "black" : "white";
}

function clampPattern(raw?: unknown, count = 0, fallback: StripeToken = "white"): StripePattern {
  const safe = (t: any): StripeToken => STRIPE_TOKENS.includes(t) ? t : "none";
  if (Array.isArray(raw) && raw.length > 0) {
    const s = raw.slice(0, 4).map(safe);
    while (s.length < 4) s.push("none");
    return [s[0], s[1], s[2], s[3]];
  }
  const s: StripeToken[] = [];
  for (let i = 0; i < 4; i++) s.push(i < Math.min(4, Math.max(0, count)) ? fallback : "none");
  return [s[0], s[1], s[2], s[3]];
}

function patternCount(p: StripePattern): number { return p.filter((x) => x !== "none").length; }

function kidsDegreeToPattern(deg: number): StripePattern {
  const d = Math.max(0, Math.min(11, Math.floor(deg)));
  const map: StripePattern[] = [
    ["none","none","none","none"], ["white","none","none","none"], ["white","white","none","none"],
    ["white","white","white","none"], ["white","white","white","white"], ["red","white","white","white"],
    ["red","red","white","white"], ["red","red","red","white"], ["red","red","red","red"],
    ["yellow","red","red","red"], ["yellow","yellow","red","red"], ["yellow","yellow","yellow","red"],
  ];
  return map[d];
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────
// Belt Visual
// ─────────────────────────────────────────────

function BeltVisual({ belt, pattern, size = "lg" }: { belt?: string; pattern: StripePattern; size?: "sm" | "lg" }) {
  const color = beltColor(belt);
  const isWhite = belt === "white" || belt === "kids-white";
  const isLg = size === "lg";

  return (
    <div className={`flex flex-col items-center ${isLg ? "py-4" : "py-1"}`}>
      <div
        className={`relative rounded-md ${isLg ? "w-48 h-8" : "w-20 h-4"}`}
        style={{ backgroundColor: color, border: `2px solid ${isWhite ? "#D1D5DB" : color}` }}
      >
        {belt !== "black" && (
          <div className={`absolute right-0 top-0 bottom-0 bg-gray-900 rounded-r-sm ${isLg ? "w-10" : "w-5"}`} />
        )}
        <div className={`absolute right-0 top-0 bottom-0 flex items-center ${isLg ? "pr-12 gap-1" : "pr-6 gap-0.5"}`}>
          {pattern.map((t, i) => {
            if (t === "none") return null;
            return (
              <div
                key={i}
                className={`rounded-sm ${isLg ? "w-1.5 h-5" : "w-1 h-2.5"}`}
                style={{ backgroundColor: STRIPE_COLORS[t as Exclude<StripeToken, "none">] || "#FFF", boxShadow: "0 0 2px rgba(0,0,0,0.3)" }}
              />
            );
          })}
        </div>
      </div>
      {isLg && (
        <div className="text-center mt-2">
          <p className="text-lg font-bold text-gray-900">{beltLabel(belt)}</p>
          <p className="text-sm text-gray-500">{patternCount(pattern)} stripe{patternCount(pattern) !== 1 && "s"}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function MemberProfileClient(props: { dojoId?: string; memberId?: string }) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  // Resolve IDs
  const dojoId = useMemo(() => {
    return props.dojoId || (params as any)?.dojoId || searchParams.get("dojoId") || "";
  }, [props.dojoId, params, searchParams]);

  const memberId = useMemo(() => {
    return props.memberId || (params as any)?.memberId || "";
  }, [props.memberId, params]);

  const { dojoName } = useDojoName(dojoId);

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [rankHistory, setRankHistory] = useState<RankHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Edit state
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<MemberProfile>>({});

  // Rank modal state
  const [rankModalOpen, setRankModalOpen] = useState(false);
  const [newBelt, setNewBelt] = useState<Belt>("white");
  const [newPattern, setNewPattern] = useState<StripePattern>(["none","none","none","none"]);
  const [stripeMode, setStripeMode] = useState<"manual" | "ibjjf">("manual");
  const [kidsDegree, setKidsDegree] = useState(0);
  const [rankNotes, setRankNotes] = useState("");

  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);

  const displayPattern = useMemo<StripePattern>(() => {
    return clampPattern(profile?.stripePattern, profile?.stripes || 0, defaultStripeToken(profile?.beltRank));
  }, [profile?.beltRank, profile?.stripes, profile?.stripePattern]);

  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return 0;
    const ok = attendance.filter((a) => a.status === "present" || a.status === "late").length;
    return Math.round((ok / attendance.length) * 100);
  }, [attendance]);

  // ─── Auth Gate ───
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // ─── Load Data (OPTIMIZED: parallel queries, no N+1) ───
  useEffect(() => {
    if (authLoading || !user || !dojoId || !memberId) {
      if (!authLoading) setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const load = async () => {
      try {
        // ✅ Parallel: load user doc, member doc, user doc (for merge), rank history ALL at once
        const [userSnap, memberSnap, memberUserSnap, rankSnap] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDoc(doc(db, "dojos", dojoId, "members", memberId)),
          getDoc(doc(db, "users", memberId)),
          getDocs(query(
            collection(db, "dojos", dojoId, "members", memberId, "rankHistory"),
            orderBy("createdAt", "desc"),
            limit(10)
          )).catch(() => null), // rankHistory may not exist yet
        ]); // ✅ FIX: close Promise.all(...)

        if (cancelled) return;

        if (userSnap.exists()) setUserDoc(userSnap.data() as UserDocBase);

        if (!memberSnap.exists()) {
          setError("Member not found.");
          setLoading(false);
          return;
        }

        const md = memberSnap.data() as any;
        const ud = memberUserSnap.exists() ? memberUserSnap.data() as any : {};

        const profileData: MemberProfile = {
          uid: memberId,
          displayName: md.displayName || ud.displayName || "Unknown",
          email: md.email || ud.email,
          photoURL: md.photoURL || ud.photoURL,
          phone: md.phone || ud.phone,
          dateOfBirth: md.dateOfBirth || ud.dateOfBirth,
          gender: md.gender || ud.gender,
          roleInDojo: md.roleInDojo || "student",
          status: md.status || "active",
          beltRank: md.beltRank || "white",
          stripes: md.stripes || 0,
          stripePattern: Array.isArray(md.stripePattern) ? md.stripePattern : undefined,
          kidsDegree: typeof md.kidsDegree === "number" ? md.kidsDegree : undefined,
          joinedAt: md.joinedAt || md.createdAt,
          emergencyContact: md.emergencyContact,
          address: md.address,
          notes: md.notes,
        };

        if (!cancelled) {
          setProfile(profileData);
          setEditData(profileData);
        }

        // Rank history
        if (rankSnap && !cancelled) {
          setRankHistory(rankSnap.docs.map((d) => ({ id: d.id, ...d.data() } as RankHistory)));
        }

        // ✅ OPTIMIZED: Load attendance from attendees subcollections
        // Instead of looping through ALL sessions × 1 getDoc each (N+1),
        // we load sessions list first, then batch-check attendees in parallel (max 20 concurrent)
        try {
          const sessionsSnap = await getDocs(collection(db, "dojos", dojoId, "sessions"));
          const sessionDocs = sessionsSnap.docs;

          // Build a map of session metadata
          const sessionMeta = new Map<string, { dateKey: string; title: string }>();
          for (const sd of sessionDocs) {
            const d = sd.data() as any;
            sessionMeta.set(sd.id, { dateKey: d.dateKey || "", title: d.title || "Session" });
          }

          // ✅ Parallel: check attendees + reservations for this member across all sessions
          // Use batches of 20 to avoid overloading
          const BATCH_SIZE = 20;
          const records: AttendanceRecord[] = [];

          for (let i = 0; i < sessionDocs.length; i += BATCH_SIZE) {
            const batch = sessionDocs.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
              batch.map(async (sd) => {
                const meta = sessionMeta.get(sd.id)!;
                // Check attendees first (new system)
                try {
                  const attSnap = await getDoc(doc(db, "dojos", dojoId, "sessions", sd.id, "attendees", memberId));
                  if (attSnap.exists()) {
                    return { sessionId: sd.id, dateKey: meta.dateKey, title: meta.title, status: "present" as const };
                  }
                } catch {}
                // Check reservations (legacy)
                try {
                  const resSnap = await getDoc(doc(db, "dojos", dojoId, "sessions", sd.id, "reservations", memberId));
                  if (resSnap.exists() && resSnap.data()?.status !== "cancelled") {
                    return { sessionId: sd.id, dateKey: meta.dateKey, title: meta.title, status: "present" as const };
                  }
                } catch {}
                // Check attendance subcollection (original system)
                try {
                  const attSnap2 = await getDoc(doc(db, "dojos", dojoId, "sessions", sd.id, "attendance", memberId));
                  if (attSnap2.exists()) {
                    const s = (attSnap2.data() as any)?.status || "present";
                    return { sessionId: sd.id, dateKey: meta.dateKey, title: meta.title, status: s };
                  }
                } catch {}
                return null;
              })
            );
            for (const r of results) if (r) records.push(r);
          }

          records.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
          if (!cancelled) setAttendance(records.slice(0, 30));
        } catch {}
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [authLoading, user, dojoId, memberId]);

  // ─── Save Profile ───
  const saveProfile = useCallback(async () => {
    if (!dojoId || !memberId) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await updateDoc(doc(db, "dojos", dojoId, "members", memberId), {
        displayName: editData.displayName,
        phone: editData.phone || null,
        dateOfBirth: editData.dateOfBirth || null,
        gender: editData.gender || null,
        emergencyContact: editData.emergencyContact || null,
        address: editData.address || null,
        notes: editData.notes || null,
        updatedAt: serverTimestamp(),
      });
      setProfile((p) => p ? { ...p, ...editData } : null);
      setEditMode(false);
      setSuccess("Profile updated!");
    } catch (e: any) { setError(e?.message || "Save failed."); }
    finally { setBusy(false); }
  }, [dojoId, memberId, editData]);

  // ─── Open Rank Modal ───
  const openRankModal = useCallback(() => {
    if (!profile) return;
    const belt = (profile.beltRank || "white") as Belt;
    setNewBelt(belt);
    const ft = defaultStripeToken(belt);
    const p = clampPattern(profile.stripePattern, profile.stripes || 0, ft);
    setNewPattern(p);
    const kd = typeof profile.kidsDegree === "number" ? profile.kidsDegree : 0;
    setKidsDegree(kd);
    if (isKidsBelt(belt) && typeof profile.kidsDegree === "number") {
      setStripeMode("ibjjf");
      setNewPattern(kidsDegreeToPattern(kd));
    } else {
      setStripeMode("manual");
    }
    setRankNotes("");
    setRankModalOpen(true);
  }, [profile]);

  // ─── Update Rank ───
  const updateRank = useCallback(async () => {
    if (!dojoId || !memberId || !user || !profile) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const isKids = isKidsBelt(newBelt);
      const finalPattern = stripeMode === "ibjjf" && isKids ? kidsDegreeToPattern(kidsDegree) : newPattern;
      const count = patternCount(finalPattern);
      const hasAny = finalPattern.some((x) => x !== "none");

      await updateDoc(doc(db, "dojos", dojoId, "members", memberId), {
        beltRank: newBelt,
        stripes: count,
        stripePattern: hasAny ? finalPattern : deleteField(),
        kidsDegree: stripeMode === "ibjjf" && isKids ? kidsDegree : deleteField(),
        updatedAt: serverTimestamp(),
      });

      const histRef = doc(collection(db, "dojos", dojoId, "members", memberId, "rankHistory"));
      await setDoc(histRef, {
        previousBelt: profile.beltRank || "white",
        previousStripes: profile.stripes || 0,
        previousStripePattern: Array.isArray(profile.stripePattern) ? profile.stripePattern : null,
        previousKidsDegree: typeof profile.kidsDegree === "number" ? profile.kidsDegree : null,
        newBelt,
        newStripes: count,
        newStripePattern: hasAny ? finalPattern : null,
        newKidsDegree: stripeMode === "ibjjf" && isKids ? kidsDegree : null,
        promotedBy: user.uid,
        notes: rankNotes || null,
        createdAt: serverTimestamp(),
      });

      setProfile((p) => p ? { ...p, beltRank: newBelt, stripes: count, stripePattern: hasAny ? finalPattern : undefined, kidsDegree: stripeMode === "ibjjf" && isKids ? kidsDegree : undefined } : null);
      setRankHistory((prev) => [{ id: histRef.id, previousBelt: profile.beltRank || "white", previousStripes: profile.stripes || 0, newBelt, newStripes: count, newStripePattern: hasAny ? finalPattern : undefined, newKidsDegree: stripeMode === "ibjjf" && isKids ? kidsDegree : undefined, promotedBy: user.uid, notes: rankNotes, createdAt: { seconds: Math.floor(Date.now() / 1000) } } as RankHistory, ...prev]);
      setRankModalOpen(false);
      setSuccess("Rank updated!");
    } catch (e: any) { setError(e?.message || "Update failed."); }
    finally { setBusy(false); }
  }, [dojoId, memberId, user, profile, newBelt, newPattern, stripeMode, kidsDegree, rankNotes]);

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

  if (!dojoId || !memberId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            Missing dojo or member ID.
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <button onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/members`)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Members
          </button>
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error || "Member not found."}</div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        {/* Back + Edit */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/members`)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Members
          </button>
          {isStaff && !editMode && (
            <button onClick={() => setEditMode(true)} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition">
              ✏️ Edit Profile
            </button>
          )}
        </div>

        {/* Banners */}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4">{success}</div>}

        {/* Profile Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-2xl flex-shrink-0">
              {profile.photoURL ? (
                <img src={profile.photoURL} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                profile.displayName?.charAt(0).toUpperCase() || "?"
              )}
            </div>

            <div className="flex-1 min-w-0">
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-0.5">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{profile.displayName}</h1>
              {profile.email && <p className="text-sm text-gray-500">{profile.email}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                  {ROLE_LABELS[profile.roleInDojo] || profile.roleInDojo}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  profile.status === "active" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                }`}>
                  {profile.status}
                </span>
              </div>
            </div>

            {/* Belt Display */}
            <div className="text-center flex-shrink-0">
              <BeltVisual belt={profile.beltRank} pattern={displayPattern} size="sm" />
              {isKidsBelt(profile.beltRank) && typeof profile.kidsDegree === "number" ? (
                <p className="text-xs text-gray-500 mt-1">Degree {profile.kidsDegree}/11</p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">{profile.stripes || 0} stripe{(profile.stripes || 0) !== 1 && "s"}</p>
              )}
              {isStaff && (
                <button onClick={openRankModal} className="mt-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition">
                  🥋 Change Rank
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Edit Mode */}
        {editMode ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Edit Profile</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input value={editData.displayName || ""} onChange={(e) => setEditData((p) => ({ ...p, displayName: e.target.value }))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input value={editData.phone || ""} onChange={(e) => setEditData((p) => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                  <input type="date" value={editData.dateOfBirth || ""} onChange={(e) => setEditData((p) => ({ ...p, dateOfBirth: e.target.value }))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                <select value={editData.gender || ""} onChange={(e) => setEditData((p) => ({ ...p, gender: e.target.value }))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Emergency Contact */}
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-700 mb-3">🚨 Emergency Contact</p>
                <div className="space-y-2">
                  <input placeholder="Name" value={editData.emergencyContact?.name || ""} onChange={(e) => setEditData((p) => ({ ...p, emergencyContact: { name: e.target.value, phone: p.emergencyContact?.phone || "", relationship: p.emergencyContact?.relationship || "" } }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input placeholder="Phone" value={editData.emergencyContact?.phone || ""} onChange={(e) => setEditData((p) => ({ ...p, emergencyContact: { name: p.emergencyContact?.name || "", phone: e.target.value, relationship: p.emergencyContact?.relationship || "" } }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input placeholder="Relationship" value={editData.emergencyContact?.relationship || ""} onChange={(e) => setEditData((p) => ({ ...p, emergencyContact: { name: p.emergencyContact?.name || "", phone: p.emergencyContact?.phone || "", relationship: e.target.value } }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={editData.notes || ""} onChange={(e) => setEditData((p) => ({ ...p, notes: e.target.value }))} rows={3} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => { setEditMode(false); setEditData(profile || {}); }} className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
                <button onClick={saveProfile} disabled={busy} className="px-4 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
                <p className="text-3xl font-bold text-green-600">{attendanceRate}%</p>
                <p className="text-xs text-gray-500 mt-1">Attendance</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
                <p className="text-3xl font-bold text-blue-600">{attendance.length}</p>
                <p className="text-xs text-gray-500 mt-1">Sessions</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
                <p className="text-3xl font-bold text-purple-600">{rankHistory.length}</p>
                <p className="text-xs text-gray-500 mt-1">Promotions</p>
              </div>
            </div>

            {/* Contact Info */}
            {(profile.phone || profile.emergencyContact) && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">Contact Info</h3>
                {profile.phone && <p className="text-sm text-gray-700 mb-2">📞 {profile.phone}</p>}
                {profile.emergencyContact && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2">
                    <p className="text-xs font-semibold text-red-700 mb-1">🚨 Emergency Contact</p>
                    <p className="text-sm text-gray-700">{profile.emergencyContact.name} ({profile.emergencyContact.relationship})</p>
                    <p className="text-sm text-gray-500">{profile.emergencyContact.phone}</p>
                  </div>
                )}
              </div>
            )}
            {profile.notes && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Notes</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{profile.notes}</p>
              </div>
            )}
          </>
        )}

        {/* Attendance History */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">Recent Attendance</h3>
          {attendance.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No attendance records yet.</p>
          ) : (
            <div className="space-y-2">
              {attendance.map((a) => (
                <div key={a.sessionId} className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-500">{a.dateKey}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    a.status === "present" ? "bg-green-100 text-green-700" :
                    a.status === "late" ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {a.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rank History */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">Rank History</h3>
          {rankHistory.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No rank changes recorded.</p>
          ) : (
            <div className="space-y-3">
              {rankHistory.map((rh) => (
                <div key={rh.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-white" style={{ backgroundColor: beltColor(rh.previousBelt) }}>
                      {beltLabel(rh.previousBelt)}
                    </span>
                    <span className="text-gray-400">→</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-white" style={{ backgroundColor: beltColor(rh.newBelt) }}>
                      {beltLabel(rh.newBelt)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-gray-500">
                      {rh.previousStripes} → {rh.newStripes} stripe(s)
                      {typeof rh.newKidsDegree === "number" && ` · deg ${rh.newKidsDegree}`}
                    </span>
                    {rh.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{rh.notes}</p>}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(rh.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />

      {/* ─── Rank Modal ─── */}
      {rankModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setRankModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">🥋 Change Rank</h3>
                <button onClick={() => setRankModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Belt Select */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Belt</label>
                  <select value={newBelt} onChange={(e) => {
                    const b = e.target.value as Belt;
                    setNewBelt(b);
                    const ft = defaultStripeToken(b);
                    setNewPattern(clampPattern(newPattern, patternCount(newPattern), ft));
                    if (!isKidsBelt(b)) { setStripeMode("manual"); setKidsDegree(0); }
                  }} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <optgroup label="Adult">
                      {BELT_OPTIONS.filter((b) => b.group === "adult").map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </optgroup>
                    <optgroup label="Kids">
                      {BELT_OPTIONS.filter((b) => b.group === "kids").map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </optgroup>
                  </select>
                </div>

                {/* Kids mode selector */}
                {isKidsBelt(newBelt) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kids System</label>
                    <select value={stripeMode} onChange={(e) => {
                      const m = e.target.value as "manual" | "ibjjf";
                      setStripeMode(m);
                      if (m === "ibjjf") setNewPattern(kidsDegreeToPattern(kidsDegree));
                    }} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="manual">Manual (any dojo)</option>
                      <option value="ibjjf">IBJJF Degree (0–11)</option>
                    </select>
                  </div>
                )}

                {/* IBJJF degree */}
                {isKidsBelt(newBelt) && stripeMode === "ibjjf" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kids Degree (0–11)</label>
                    <select value={kidsDegree} onChange={(e) => {
                      const d = Number(e.target.value);
                      setKidsDegree(d);
                      setNewPattern(kidsDegreeToPattern(d));
                    }} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                )}

                {/* Manual stripes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Stripes (4 slots)</label>
                  <div className="grid grid-cols-4 gap-3">
                    {newPattern.map((slot, idx) => (
                      <div key={idx}>
                        <p className="text-xs text-gray-500 mb-1">Slot {idx + 1}</p>
                        <select value={slot} onChange={(e) => {
                          const copy = [...newPattern] as StripePattern;
                          copy[idx] = e.target.value as StripeToken;
                          setNewPattern(copy);
                          if (stripeMode === "ibjjf") setStripeMode("manual");
                        }} className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {STRIPE_TOKENS.map((t) => <option key={t} value={t}>{STRIPE_LABELS[t]}</option>)}
                        </select>
                        <div className="h-2 rounded mt-1" style={{ backgroundColor: slot === "none" ? "#E5E7EB" : STRIPE_COLORS[slot as Exclude<StripeToken, "none">], border: "1px solid #D1D5DB" }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <button onClick={() => { setNewPattern(["none","none","none","none"]); if (stripeMode === "ibjjf") setStripeMode("manual"); }} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">Clear</button>
                    <span className="text-xs text-gray-500">Quick:</span>
                    {[0,1,2,3,4].map((n) => (
                      <button key={n} onClick={() => {
                        const t = defaultStripeToken(newBelt);
                        setNewPattern(clampPattern(undefined, n, t));
                        if (stripeMode === "ibjjf") setStripeMode("manual");
                      }} className={`w-8 h-8 rounded-lg text-xs font-bold ${patternCount(newPattern) === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Preview</p>
                  <BeltVisual belt={newBelt} pattern={stripeMode === "ibjjf" && isKidsBelt(newBelt) ? kidsDegreeToPattern(kidsDegree) : newPattern} size="lg" />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <textarea value={rankNotes} onChange={(e) => setRankNotes(e.target.value)} rows={2} placeholder="e.g. Promoted at competition" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => setRankModalOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition">Cancel</button>
                  <button onClick={updateRank} disabled={busy} className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50">{busy ? "Saving..." : "Update Rank"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
