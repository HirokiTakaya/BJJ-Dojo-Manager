"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { dbNullable } from "@/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  deleteField,
} from "firebase/firestore";

// ============================================
// Types
// ============================================

type Belt =
  | "white"
  | "blue"
  | "purple"
  | "brown"
  | "black"
  // Kids belts (basic)
  | "kids-white"
  | "kids-grey"
  | "kids-yellow"
  | "kids-orange"
  | "kids-green"
  // Kids belts (IBJJF-style groups / mixed)
  | "kids-grey-white"
  | "kids-grey-black"
  | "kids-yellow-white"
  | "kids-yellow-black"
  | "kids-orange-white"
  | "kids-orange-black"
  | "kids-green-white"
  | "kids-green-black";

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
  beltRank?: Belt | string; // keep string for backwards compatibility with existing data
  stripes?: number; // legacy: 0..4 (we keep this)
  stripePattern?: StripeToken[]; // NEW: manual 4-slot stripe colors (optional)
  kidsDegree?: number; // NEW: optional 0..11 (IBJJF convenience), can be unused
  joinedAt?: any;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  address?: {
    postalCode?: string;
    prefecture?: string;
    city?: string;
    line1?: string;
  };
  notes?: string;
};

type AttendanceHistory = {
  sessionId: string;
  dateKey: string;
  title: string;
  status: "present" | "absent" | "late";
  checkedAt?: any;
};

type RankHistory = {
  id: string;
  previousBelt: Belt | string;
  newBelt: Belt | string;
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

// ============================================
// Constants
// ============================================

const BELT_OPTIONS: { value: Belt; label: string; color: string }[] = [
  // Adult belts
  { value: "white", label: "White", color: "#FFFFFF" },
  { value: "blue", label: "Blue", color: "#0066CC" },
  { value: "purple", label: "Purple", color: "#6B3FA0" },
  { value: "brown", label: "Brown", color: "#8B4513" },
  { value: "black", label: "Black", color: "#1A1A1A" },

  // Kids belts (basic)
  { value: "kids-white", label: "Kids - White", color: "#FFFFFF" },
  { value: "kids-grey", label: "Kids - Grey", color: "#9CA3AF" },
  { value: "kids-yellow", label: "Kids - Yellow", color: "#FBBF24" },
  { value: "kids-orange", label: "Kids - Orange", color: "#F97316" },
  { value: "kids-green", label: "Kids - Green", color: "#22C55E" },

  // Kids belts (IBJJF-style mixed)
  { value: "kids-grey-white", label: "Kids - Grey/White", color: "#9CA3AF" },
  { value: "kids-grey-black", label: "Kids - Grey/Black", color: "#9CA3AF" },
  { value: "kids-yellow-white", label: "Kids - Yellow/White", color: "#FBBF24" },
  { value: "kids-yellow-black", label: "Kids - Yellow/Black", color: "#FBBF24" },
  { value: "kids-orange-white", label: "Kids - Orange/White", color: "#F97316" },
  { value: "kids-orange-black", label: "Kids - Orange/Black", color: "#F97316" },
  { value: "kids-green-white", label: "Kids - Green/White", color: "#22C55E" },
  { value: "kids-green-black", label: "Kids - Green/Black", color: "#22C55E" },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
  staff_member: "Staff",
  coach: "Coach",
  student: "Student",
};

const STRIPE_SLOT_LABELS: Record<StripeToken, string> = {
  none: "(none)",
  white: "White",
  red: "Red",
  yellow: "Yellow",
  black: "Black",
};

const STRIPE_SLOT_COLOR: Record<Exclude<StripeToken, "none">, string> = {
  white: "#FFFFFF",
  red: "#EF4444",
  yellow: "#FACC15",
  black: "#111111",
};

// legacy quick select (adult-like)
const STRIPE_COUNT_OPTIONS = [0, 1, 2, 3, 4];

// kids degree (optional)
const KIDS_DEGREE_OPTIONS = Array.from({ length: 12 }, (_, i) => i); // 0..11

// ============================================
// Helpers
// ============================================

function firstString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function readIdsFromPathname(): { dojoId?: string; memberId?: string } {
  if (typeof window === "undefined") return {};
  const parts = window.location.pathname.split("/").filter(Boolean);

  // Expected: /dojos/<dojoId>/members/<memberId>
  const i = parts.indexOf("dojos");
  if (i >= 0 && parts[i + 1] && parts[i + 2] === "members" && parts[i + 3]) {
    return { dojoId: parts[i + 1], memberId: parts[i + 3] };
  }

  // Legacy: /dojos/members/<memberId> (dojoId might be in query)
  const j = parts.indexOf("members");
  if (j >= 0 && parts[j + 1]) {
    return { memberId: parts[j + 1] };
  }

  return {};
}

function snapshotParams(p: any): { keys: string[]; raw: Record<string, unknown> } {
  const keys = Object.keys(p ?? {});
  const raw: Record<string, unknown> = {};
  for (const k of keys) raw[k] = (p as any)?.[k];
  return { keys, raw };
}

function isKidsBeltValue(v?: string): boolean {
  return String(v || "").startsWith("kids-");
}

function beltLabel(value?: string): string {
  if (!value) return "White";
  return BELT_OPTIONS.find((b) => b.value === value)?.label ?? value;
}

function beltColor(value?: string): string {
  if (!value) return BELT_OPTIONS[0].color;
  return BELT_OPTIONS.find((b) => b.value === value)?.color ?? BELT_OPTIONS[0].color;
}

function defaultStripeTokenForBelt(beltRank?: string): StripeToken {
  // white belt: black stripe is visible
  if (beltRank === "white" || beltRank === "kids-white") return "black";
  // others: white stripe is typical
  return "white";
}

function clampStripePattern(raw?: unknown, fallbackCount = 0, fallbackToken: StripeToken = "white"): StripePattern {
  const safeToken = (t: any): StripeToken => {
    if (t === "white" || t === "red" || t === "yellow" || t === "black" || t === "none") return t;
    return "none";
  };

  // if array exists, normalize to 4 slots
  if (Array.isArray(raw) && raw.length > 0) {
    const slots = raw.slice(0, 4).map(safeToken) as StripeToken[];
    while (slots.length < 4) slots.push("none");
    return [slots[0], slots[1], slots[2], slots[3]];
  }

  // legacy fallback: fill first N with fallbackToken
  const slots: StripeToken[] = [];
  for (let i = 0; i < 4; i++) {
    slots.push(i < Math.max(0, Math.min(4, fallbackCount)) ? fallbackToken : "none");
  }
  return [slots[0], slots[1], slots[2], slots[3]];
}

function stripeCountFromPattern(p: StripePattern): number {
  return p.filter((x) => x !== "none").length;
}

// IBJJF kids degree mapping (0..11) -> 4 slots pattern
// Based on the provided chart:
// 0:none
// 1: W
// 2: WW
// 3: WWW
// 4: WWWW
// 5: RWWW
// 6: RRWW
// 7: RRRW
// 8: RRRR
// 9: YRRR
// 10: YYRR
// 11: YYYR
function kidsDegreeToPattern(deg: number): StripePattern {
  const d = Math.max(0, Math.min(11, Math.floor(deg)));
  const fill = (a: StripeToken, b: StripeToken, c: StripeToken, e: StripeToken): StripePattern => [a, b, c, e];

  if (d === 0) return fill("none", "none", "none", "none");
  if (d === 1) return fill("white", "none", "none", "none");
  if (d === 2) return fill("white", "white", "none", "none");
  if (d === 3) return fill("white", "white", "white", "none");
  if (d === 4) return fill("white", "white", "white", "white");
  if (d === 5) return fill("red", "white", "white", "white");
  if (d === 6) return fill("red", "red", "white", "white");
  if (d === 7) return fill("red", "red", "red", "white");
  if (d === 8) return fill("red", "red", "red", "red");
  if (d === 9) return fill("yellow", "red", "red", "red");
  if (d === 10) return fill("yellow", "yellow", "red", "red");
  return fill("yellow", "yellow", "yellow", "red"); // 11
}

// ============================================
// Component
// ============================================

export default function MemberProfileClient(props: { dojoId?: string; memberId?: string }) {
  // ✅ Keep hook order stable
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  // ✅ Resolve in order: props → params → search → pathname (keep existing logic intact)
  const dojoId = useMemo(() => {
    const fromProps = props.dojoId;

    // ✅ Support both dojoId / dojold
    const fromParams = firstString((params as any)?.dojoId) || firstString((params as any)?.dojold);

    // ✅ Support both dojoId / dojold in search (fallback)
    const fromSearch = searchParams.get("dojoId") || searchParams.get("dojold") || "";

    const fromPath = readIdsFromPathname().dojoId || "";
    return (fromProps || fromParams || fromSearch || fromPath || "") as string;
  }, [props.dojoId, params, searchParams]);

  const memberId = useMemo(() => {
    const fromProps = props.memberId;

    // ✅ Support both memberId / memberld
    const fromParams = firstString((params as any)?.memberId) || firstString((params as any)?.memberld);

    const fromPath = readIdsFromPathname().memberId || "";
    return (fromProps || fromParams || fromPath || "") as string;
  }, [props.memberId, params]);

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceHistory[]>([]);
  const [rankHistory, setRankHistory] = useState<RankHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<MemberProfile>>({});

  const [rankModalOpen, setRankModalOpen] = useState(false);
  const [newBelt, setNewBelt] = useState<Belt>("white");

  // legacy stripe count (keep)
  const [newStripes, setNewStripes] = useState(0);

  // ✅ NEW: manual 4-slot stripe pattern (any dojo)
  const [newStripePattern, setNewStripePattern] = useState<StripePattern>(["none", "none", "none", "none"]);

  // ✅ NEW: optional kids degree 0..11 (IBJJF convenience)
  const [kidsDegree, setKidsDegree] = useState<number>(0);

  // ✅ NEW: mode selector
  const [stripeMode, setStripeMode] = useState<"manual" | "ibjjf_degree">("manual");

  const [rankNotes, setRankNotes] = useState("");

  const beltInfo = useMemo(() => {
    const current = String(profile?.beltRank || "white");
    const found = BELT_OPTIONS.find((b) => b.value === current);
    return found || BELT_OPTIONS[0];
  }, [profile?.beltRank]);

  const attendanceRate = useMemo(() => {
    if (attendanceHistory.length === 0) return 0;
    const ok = attendanceHistory.filter((a) => a.status === "present" || a.status === "late").length;
    return Math.round((ok / attendanceHistory.length) * 100);
  }, [attendanceHistory]);

  // Profile stripe pattern for display (fallback to legacy stripes)
  const displayStripePattern: StripePattern = useMemo(() => {
    const belt = String(profile?.beltRank || "white");
    const fallbackToken = defaultStripeTokenForBelt(belt);
    const legacyCount = Number(profile?.stripes || 0);
    return clampStripePattern(profile?.stripePattern, legacyCount, fallbackToken);
  }, [profile?.beltRank, profile?.stripes, profile?.stripePattern]);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load profile (keep existing logic)
  useEffect(() => {
    const load = async () => {
      if (authLoading) return;
      if (!user) return;

      if (!dbNullable || !dojoId || !memberId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const memberRef = doc(dbNullable, "dojos", dojoId, "members", memberId);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) {
          setError("Member not found");
          setLoading(false);
          return;
        }

        const memberData = memberSnap.data();

        const userRef = doc(dbNullable, "users", memberId);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};

        const beltRank = (memberData as any).beltRank || "white";
        const legacyStripes = (memberData as any).stripes || 0;

        const profileData: MemberProfile = {
          uid: memberId,
          displayName: (memberData as any).displayName || (userData as any).displayName || "Unknown",
          email: (memberData as any).email || (userData as any).email,
          photoURL: (memberData as any).photoURL || (userData as any).photoURL,
          phone: (memberData as any).phone || (userData as any).phone,
          dateOfBirth: (memberData as any).dateOfBirth || (userData as any).dateOfBirth,
          gender: (memberData as any).gender || (userData as any).gender,
          roleInDojo: (memberData as any).roleInDojo || "student",
          status: (memberData as any).status || "active",
          beltRank,
          stripes: legacyStripes,
          // ✅ NEW optional fields (safe)
          stripePattern: Array.isArray((memberData as any).stripePattern) ? (memberData as any).stripePattern : undefined,
          kidsDegree:
            typeof (memberData as any).kidsDegree === "number" ? (memberData as any).kidsDegree : undefined,
          joinedAt: (memberData as any).joinedAt || (memberData as any).createdAt,
          emergencyContact: (memberData as any).emergencyContact,
          address: (memberData as any).address,
          notes: (memberData as any).notes,
        };

        setProfile(profileData);
        setEditData(profileData);

        // Initialize rank modal defaults
        const initialBelt = (String(profileData.beltRank || "white") as Belt) || "white";
        setNewBelt(initialBelt);

        const fallbackToken = defaultStripeTokenForBelt(initialBelt);
        const initialPattern = clampStripePattern(profileData.stripePattern, profileData.stripes || 0, fallbackToken);
        setNewStripePattern(initialPattern);
        setNewStripes(stripeCountFromPattern(initialPattern));

        const initialKidsDegree =
          typeof profileData.kidsDegree === "number" ? Math.max(0, Math.min(11, profileData.kidsDegree)) : 0;
        setKidsDegree(initialKidsDegree);

        // default mode:
        // - if kids & has kidsDegree => IBJJF mode
        // - else manual
        if (isKidsBeltValue(initialBelt) && typeof profileData.kidsDegree === "number") {
          setStripeMode("ibjjf_degree");
          const p = kidsDegreeToPattern(initialKidsDegree);
          setNewStripePattern(p);
          setNewStripes(stripeCountFromPattern(p));
        } else {
          setStripeMode("manual");
        }

        // Attendance history
        const sessionsRef = collection(dbNullable, "dojos", dojoId, "sessions");
        const sessionsSnap = await getDocs(sessionsRef);

        const attHistory: AttendanceHistory[] = [];
        for (const sessionDoc of sessionsSnap.docs) {
          const attRef = doc(dbNullable, "dojos", dojoId, "sessions", sessionDoc.id, "attendance", memberId);
          const attSnap = await getDoc(attRef);
          if (attSnap.exists()) {
            const attData = attSnap.data();
            const sessionData = sessionDoc.data();
            attHistory.push({
              sessionId: sessionDoc.id,
              dateKey: (sessionData as any).dateKey || "",
              title: (sessionData as any).title || "Session",
              status: ((attData as any).status || "absent") as "present" | "absent" | "late",
              checkedAt: (attData as any).checkedAt,
            });
          }
        }
        attHistory.sort((a, b) => (b.dateKey || "").localeCompare(a.dateKey || ""));
        setAttendanceHistory(attHistory.slice(0, 20));

        // Rank history
        const rankRef = collection(dbNullable, "dojos", dojoId, "members", memberId, "rankHistory");
        const rankQuery = query(rankRef, orderBy("createdAt", "desc"), limit(10));
        const rankSnap = await getDocs(rankQuery);
        const rankList: RankHistory[] = rankSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as RankHistory));
        setRankHistory(rankList);
      } catch (e: any) {
        console.error("[MemberProfile] load error:", e);
        setError(e?.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authLoading, user, dojoId, memberId]);

  const saveProfile = async () => {
    if (!dbNullable || !dojoId || !memberId) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", memberId);
      await updateDoc(memberRef, {
        displayName: editData.displayName,
        phone: editData.phone,
        dateOfBirth: editData.dateOfBirth,
        gender: editData.gender,
        emergencyContact: editData.emergencyContact,
        address: editData.address,
        notes: editData.notes,
        updatedAt: serverTimestamp(),
      });

      setProfile((prev) => (prev ? { ...prev, ...editData } : null));
      setEditMode(false);
      setSuccess("Profile updated!");
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const openRankModal = () => {
    if (!profile) return;

    const currentBelt = String(profile.beltRank || "white") as Belt;
    setNewBelt(currentBelt);

    const fallbackToken = defaultStripeTokenForBelt(currentBelt);
    const basePattern = clampStripePattern(profile.stripePattern, profile.stripes || 0, fallbackToken);

    setNewStripePattern(basePattern);
    setNewStripes(stripeCountFromPattern(basePattern));

    const kd = typeof profile.kidsDegree === "number" ? Math.max(0, Math.min(11, profile.kidsDegree)) : 0;
    setKidsDegree(kd);

    if (isKidsBeltValue(currentBelt) && typeof profile.kidsDegree === "number") {
      setStripeMode("ibjjf_degree");
      const p = kidsDegreeToPattern(kd);
      setNewStripePattern(p);
      setNewStripes(stripeCountFromPattern(p));
    } else {
      setStripeMode("manual");
    }

    setRankNotes("");
    setRankModalOpen(true);
  };

  const updateRank = async () => {
    if (!dbNullable || !dojoId || !memberId || !user || !profile) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", memberId);

      const isKids = isKidsBeltValue(newBelt);
      const finalPattern: StripePattern =
        stripeMode === "ibjjf_degree" && isKids ? kidsDegreeToPattern(kidsDegree) : newStripePattern;

      const finalStripeCount = stripeCountFromPattern(finalPattern);

      // stripePattern field: store only if used (any non-none)
      const hasAny = finalPattern.some((x) => x !== "none");

      await updateDoc(memberRef, {
        beltRank: newBelt,
        // ✅ keep legacy field (0..4)
        stripes: finalStripeCount,
        // ✅ new optional
        stripePattern: hasAny ? finalPattern : deleteField(),
        kidsDegree: stripeMode === "ibjjf_degree" && isKids ? kidsDegree : deleteField(),
        updatedAt: serverTimestamp(),
      });

      const historyRef = doc(collection(dbNullable, "dojos", dojoId, "members", memberId, "rankHistory"));
      await setDoc(historyRef, {
        previousBelt: (profile.beltRank || "white") as any,
        previousStripes: profile.stripes || 0,
        previousStripePattern: Array.isArray(profile.stripePattern) ? profile.stripePattern : null,
        previousKidsDegree: typeof profile.kidsDegree === "number" ? profile.kidsDegree : null,
        newBelt,
        newStripes: finalStripeCount,
        newStripePattern: hasAny ? finalPattern : null,
        newKidsDegree: stripeMode === "ibjjf_degree" && isKids ? kidsDegree : null,
        promotedBy: user.uid,
        notes: rankNotes,
        createdAt: serverTimestamp(),
      });

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              beltRank: newBelt,
              stripes: finalStripeCount,
              stripePattern: hasAny ? finalPattern : undefined,
              kidsDegree: stripeMode === "ibjjf_degree" && isKids ? kidsDegree : undefined,
            }
          : null
      );

      setRankHistory((prev) => [
        {
          id: historyRef.id,
          previousBelt: (profile.beltRank || "white") as any,
          previousStripes: profile.stripes || 0,
          previousStripePattern: Array.isArray(profile.stripePattern) ? profile.stripePattern : undefined,
          previousKidsDegree: typeof profile.kidsDegree === "number" ? profile.kidsDegree : undefined,
          newBelt,
          newStripes: finalStripeCount,
          newStripePattern: hasAny ? finalPattern : undefined,
          newKidsDegree: stripeMode === "ibjjf_degree" && isKids ? kidsDegree : undefined,
          promotedBy: user.uid,
          notes: rankNotes,
          createdAt: { seconds: Math.floor(Date.now() / 1000) },
        },
        ...prev,
      ]);

      setRankModalOpen(false);
      setRankNotes("");
      setSuccess("Rank updated!");
    } catch (e: any) {
      setError(e?.message || "Failed to update rank");
    } finally {
      setBusy(false);
    }
  };

  // ============================================
  // ✅ Debug UI: show missing params (early return)
  // ============================================
  if (!dojoId || !memberId) {
    const pathIds = typeof window !== "undefined" ? readIdsFromPathname() : {};
    const snap = snapshotParams(params as any);

    return (
      <main style={{ padding: 24, background: "#0b1b22", minHeight: "100vh", color: "white" }}>
        <h2 style={{ marginTop: 0 }}>Missing dojoId or memberId (MemberProfileClient)</h2>
        <div style={{ opacity: 0.85, marginTop: 8 }}>
          <div>
            props.dojoId: <b>{String(props?.dojoId || "(empty)")}</b>
          </div>
          <div>
            props.memberId: <b>{String(props?.memberId || "(empty)")}</b>
          </div>
          <div style={{ marginTop: 8 }}>
            params keys: <b>{JSON.stringify(snap.keys)}</b>
          </div>
          <div>
            params raw:{" "}
            <pre style={{ margin: 0 }}>{JSON.stringify(snap.raw, null, 2)}</pre>
          </div>
          <div style={{ marginTop: 8 }}>
            pathname dojoId: <b>{String(pathIds.dojoId || "(empty)")}</b>
          </div>
          <div>
            pathname memberId: <b>{String(pathIds.memberId || "(empty)")}</b>
          </div>
          <div style={{ marginTop: 12 }}>Current URL:</div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "rgba(255,255,255,0.1)",
              padding: 8,
              borderRadius: 8,
            }}
          >
            {typeof window !== "undefined" ? window.location.href : "(server)"}
          </pre>
        </div>
        <button
          onClick={() => router.back()}
          style={{
            marginTop: 16,
            padding: "10px 16px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
            cursor: "pointer",
          }}
        >
          ← Go Back
        </button>
      </main>
    );
  }

  // ============================================
  // Loading state
  // ============================================
  if (authLoading || loading) {
    return (
      <main style={{ padding: 24, background: "#0b1b22", minHeight: "100vh", color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 24,
              height: 24,
              border: "3px solid rgba(255,255,255,0.2)",
              borderTopColor: "#11a8ff",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          Loading...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  if (!user) return null;

  // ============================================
  // Profile not found
  // ============================================
  if (!profile) {
    return (
      <main style={{ padding: 24, background: "#0b1b22", minHeight: "100vh", color: "white" }}>
        <button
          onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/members`)}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
            marginBottom: 16,
          }}
        >
          ← Back to Members
        </button>
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", color: "#f87171" }}>❌ Member Not Found</h3>
          <p style={{ margin: 0, opacity: 0.8 }}>
            The member with ID "{memberId}" could not be found in this dojo.
          </p>
        </div>
      </main>
    );
  }

  // ============================================
  // ✅ Main Profile View
  // ============================================
  return (
    <main style={{ padding: 24, background: "#0b1b22", minHeight: "100vh", color: "white" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => router.push(`/dojos/${encodeURIComponent(dojoId)}/members`)}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
          }}
        >
          ← Back to Members
        </button>

        {!editMode && (
          <button
            onClick={() => setEditMode(true)}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              background: "rgba(17, 168, 255, 0.15)",
              border: "1px solid rgba(17, 168, 255, 0.3)",
              color: "white",
              fontWeight: 700,
            }}
          >
            ✏️ Edit Profile
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#3b1f1f", color: "#ffd2d2" }}>
          ❌ {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#1f3b2f", color: "#d2ffd2" }}>
          ✅ {success}
        </div>
      )}

      {/* Profile Header */}
      <section
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          padding: 24,
          borderRadius: 16,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "rgba(17, 168, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {profile?.photoURL ? (
            <img
              src={profile.photoURL}
              alt=""
              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            profile?.displayName?.charAt(0).toUpperCase() || "?"
          )}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{profile?.displayName}</h1>
          <div style={{ opacity: 0.7, marginTop: 4 }}>{profile?.email}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: "rgba(255,255,255,0.1)", fontSize: 13 }}>
              {ROLE_LABELS[profile?.roleInDojo || "student"] || profile?.roleInDojo}
            </span>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                background: profile?.status === "active" ? "rgba(74, 222, 128, 0.2)" : "rgba(250, 204, 21, 0.2)",
                color: profile?.status === "active" ? "#4ade80" : "#facc15",
                fontSize: 13,
              }}
            >
              {profile?.status}
            </span>
          </div>
        </div>

        {/* Belt Display */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 16,
              borderRadius: 4,
              background: beltColor(String(profile?.beltRank || "white")),
              border: "1px solid rgba(255,255,255,0.3)",
              marginBottom: 8,
            }}
          >
            {/* Stripes (4 slots) */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingRight: 4,
                gap: 2,
                height: "100%",
                alignItems: "center",
              }}
            >
              {displayStripePattern.map((token, i) => {
                if (token === "none") return null;
                const bg = STRIPE_SLOT_COLOR[token as Exclude<StripeToken, "none">];
                return <div key={i} style={{ width: 3, height: 10, background: bg, borderRadius: 1 }} />;
              })}
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 700 }}>{beltLabel(String(profile?.beltRank || "white"))}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {isKidsBeltValue(String(profile?.beltRank || "")) && typeof profile?.kidsDegree === "number"
              ? `kids degree: ${profile.kidsDegree} (0-11)`
              : `${profile?.stripes || 0} stripe(s)`}
          </div>

          <button
            onClick={openRankModal}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "white",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            🥋 Change Rank
          </button>
        </div>
      </section>

      {/* Edit Mode / View Mode */}
      {editMode ? (
        <section
          style={{
            padding: 24,
            borderRadius: 16,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: "0 0 20px 0", fontSize: 18 }}>✏️ Edit Profile</h2>

          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, opacity: 0.8 }}>Display Name</label>
              <input
                value={editData.displayName || ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, displayName: e.target.value }))}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  marginTop: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "white",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, opacity: 0.8 }}>Phone</label>
                <input
                  value={editData.phone || ""}
                  onChange={(e) => setEditData((prev) => ({ ...prev, phone: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    marginTop: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, opacity: 0.8 }}>Date of Birth</label>
                <input
                  type="date"
                  value={editData.dateOfBirth || ""}
                  onChange={(e) => setEditData((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    marginTop: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, opacity: 0.8 }}>Gender</label>
              <select
                value={editData.gender || ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, gender: e.target.value }))}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  marginTop: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "white",
                  boxSizing: "border-box",
                }}
              >
                <option value="">Select...</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Emergency Contact */}
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.05)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#fca5a5" }}>🚨 Emergency Contact</div>
              <div style={{ display: "grid", gap: 12 }}>
                <input
                  placeholder="Name"
                  value={editData.emergencyContact?.name || ""}
                  onChange={(e) =>
                    setEditData((prev) => ({
                      ...prev,
                      emergencyContact: {
                        ...prev.emergencyContact,
                        name: e.target.value,
                        phone: prev.emergencyContact?.phone || "",
                        relationship: prev.emergencyContact?.relationship || "",
                      },
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
                <input
                  placeholder="Phone"
                  value={editData.emergencyContact?.phone || ""}
                  onChange={(e) =>
                    setEditData((prev) => ({
                      ...prev,
                      emergencyContact: {
                        ...prev.emergencyContact,
                        name: prev.emergencyContact?.name || "",
                        phone: e.target.value,
                        relationship: prev.emergencyContact?.relationship || "",
                      },
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
                <input
                  placeholder="Relationship"
                  value={editData.emergencyContact?.relationship || ""}
                  onChange={(e) =>
                    setEditData((prev) => ({
                      ...prev,
                      emergencyContact: {
                        ...prev.emergencyContact,
                        name: prev.emergencyContact?.name || "",
                        phone: prev.emergencyContact?.phone || "",
                        relationship: e.target.value,
                      },
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, opacity: 0.8 }}>Notes</label>
              <textarea
                value={editData.notes || ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  marginTop: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "white",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setEditMode(false);
                  setEditData(profile || {});
                }}
                style={{
                  padding: "12px 18px",
                  borderRadius: 10,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={busy}
                style={{
                  padding: "12px 20px",
                  borderRadius: 10,
                  background: "rgba(17, 168, 255, 0.2)",
                  border: "1px solid rgba(17, 168, 255, 0.4)",
                  color: "white",
                  fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Stats */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                padding: 20,
                borderRadius: 14,
                background: "rgba(74, 222, 128, 0.1)",
                border: "1px solid rgba(74, 222, 128, 0.2)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 900, color: "#4ade80" }}>{attendanceRate}%</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>Attendance Rate</div>
            </div>
            <div
              style={{
                padding: 20,
                borderRadius: 14,
                background: "rgba(17, 168, 255, 0.1)",
                border: "1px solid rgba(17, 168, 255, 0.2)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 900, color: "#11a8ff" }}>{attendanceHistory.length}</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>Total Sessions</div>
            </div>
            <div
              style={{
                padding: 20,
                borderRadius: 14,
                background: "rgba(168, 85, 247, 0.1)",
                border: "1px solid rgba(168, 85, 247, 0.2)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 900, color: "#a855f7" }}>{rankHistory.length}</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>Promotions</div>
            </div>
          </section>

          {/* Contact Info */}
          {(profile?.phone || profile?.emergencyContact) && (
            <section
              style={{
                padding: 20,
                borderRadius: 14,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.1)",
                marginBottom: 24,
              }}
            >
              <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>📞 Contact Info</h3>
              {profile?.phone && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ opacity: 0.7 }}>Phone:</span> {profile.phone}
                </div>
              )}
              {profile?.emergencyContact && (
                <div style={{ padding: 12, borderRadius: 10, background: "rgba(239, 68, 68, 0.05)", marginTop: 12 }}>
                  <div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 8 }}>🚨 Emergency Contact</div>
                  <div>
                    {profile.emergencyContact.name} ({profile.emergencyContact.relationship})
                  </div>
                  <div style={{ opacity: 0.8 }}>{profile.emergencyContact.phone}</div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* Attendance History */}
      <section
        style={{
          padding: 20,
          borderRadius: 14,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.1)",
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>📊 Recent Attendance</h3>
        {attendanceHistory.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No attendance records yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {attendanceHistory.map((att) => (
              <div
                key={att.sessionId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{att.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{att.dateKey}</div>
                </div>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    background:
                      att.status === "present"
                        ? "rgba(74, 222, 128, 0.2)"
                        : att.status === "late"
                        ? "rgba(250, 204, 21, 0.2)"
                        : "rgba(239, 68, 68, 0.2)",
                    color: att.status === "present" ? "#4ade80" : att.status === "late" ? "#facc15" : "#f87171",
                  }}
                >
                  {att.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rank History */}
      <section
        style={{
          padding: 20,
          borderRadius: 14,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>🥋 Rank History</h3>
        {rankHistory.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No rank changes recorded.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {rankHistory.map((rh) => {
              const prevBelt = String(rh.previousBelt || "white");
              const nextBelt = String(rh.newBelt || "white");
              return (
                <div key={rh.id} style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: beltColor(prevBelt),
                        fontSize: 12,
                        color: prevBelt === "white" || prevBelt === "kids-white" ? "#333" : "#fff",
                      }}
                      title={prevBelt}
                    >
                      {beltLabel(prevBelt)}
                    </span>
                    <span>→</span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: beltColor(nextBelt),
                        fontSize: 12,
                        color: nextBelt === "white" || nextBelt === "kids-white" ? "#333" : "#fff",
                      }}
                      title={nextBelt}
                    >
                      {beltLabel(nextBelt)}
                    </span>
                    <span style={{ opacity: 0.7, fontSize: 12 }}>
                      ({rh.previousStripes} → {rh.newStripes} stripe(s))
                      {typeof rh.newKidsDegree === "number" ? ` / kidsDegree: ${rh.newKidsDegree}` : ""}
                    </span>
                  </div>
                  {rh.notes && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{rh.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rank Change Modal */}
      {rankModalOpen && (
        <div
          onClick={() => setRankModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              borderRadius: 16,
              background: "#0b1b22",
              border: "1px solid rgba(255,255,255,0.14)",
              padding: 24,
            }}
          >
            <h3 style={{ margin: "0 0 20px 0" }}>🥋 Change Rank</h3>

            <div style={{ display: "grid", gap: 16 }}>
              {/* Belt */}
              <div>
                <label style={{ fontSize: 13, opacity: 0.8 }}>Belt</label>
                <select
                  value={newBelt}
                  onChange={(e) => {
                    const nextBelt = e.target.value as Belt;
                    setNewBelt(nextBelt);

                    // keep pattern stable, but refresh legacy default if empty
                    const fallbackToken = defaultStripeTokenForBelt(nextBelt);
                    const base = clampStripePattern(newStripePattern, stripeCountFromPattern(newStripePattern), fallbackToken);
                    setNewStripePattern(base);
                    setNewStripes(stripeCountFromPattern(base));

                    // if switched to non-kids belt, force manual mode & clear kidsDegree
                    if (!isKidsBeltValue(nextBelt)) {
                      setStripeMode("manual");
                      setKidsDegree(0);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    marginTop: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                >
                  <optgroup label="Adult">
                    {BELT_OPTIONS.filter((b) => !b.value.startsWith("kids-")).map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Kids">
                    {BELT_OPTIONS.filter((b) => b.value.startsWith("kids-")).map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Stripe mode */}
              {isKidsBeltValue(newBelt) && (
                <div>
                  <label style={{ fontSize: 13, opacity: 0.8 }}>Kids system (optional)</label>
                  <select
                    value={stripeMode}
                    onChange={(e) => {
                      const mode = e.target.value as "manual" | "ibjjf_degree";
                      setStripeMode(mode);
                      if (mode === "ibjjf_degree") {
                        const p = kidsDegreeToPattern(kidsDegree);
                        setNewStripePattern(p);
                        setNewStripes(stripeCountFromPattern(p));
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      marginTop: 6,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      color: "white",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="manual">Manual (any dojo)</option>
                    <option value="ibjjf_degree">IBJJF degree (0-11)</option>
                  </select>
                  <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                    道場ごとに違うので、基本は Manual でOK。IBJJF運用なら degree を使えます。
                  </div>
                </div>
              )}

              {/* IBJJF kids degree */}
              {isKidsBeltValue(newBelt) && stripeMode === "ibjjf_degree" && (
                <div>
                  <label style={{ fontSize: 13, opacity: 0.8 }}>Kids degree (0-11) ※ 12は昇格</label>
                  <select
                    value={kidsDegree}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      setKidsDegree(d);
                      const p = kidsDegreeToPattern(d);
                      setNewStripePattern(p);
                      setNewStripes(stripeCountFromPattern(p));
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      marginTop: 6,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      color: "white",
                      boxSizing: "border-box",
                    }}
                  >
                    {KIDS_DEGREE_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Manual stripe pattern (works for ALL dojos) */}
              <div>
                <label style={{ fontSize: 13, opacity: 0.8 }}>Stripes (manual / 4 slots)</label>

                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  {newStripePattern.map((slot, idx) => (
                    <div key={idx} style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>Slot {idx + 1}</div>
                      <select
                        value={slot}
                        onChange={(e) => {
                          const next = e.target.value as StripeToken;
                          const copy: StripePattern = [...newStripePattern] as StripePattern;
                          copy[idx] = next;
                          setNewStripePattern(copy);
                          setNewStripes(stripeCountFromPattern(copy));
                          // if user edits manually while in IBJJF mode, auto switch to manual
                          if (stripeMode === "ibjjf_degree") setStripeMode("manual");
                        }}
                        style={{
                          width: "100%",
                          padding: 10,
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "white",
                          boxSizing: "border-box",
                        }}
                      >
                        {(Object.keys(STRIPE_SLOT_LABELS) as StripeToken[]).map((k) => (
                          <option key={k} value={k}>
                            {STRIPE_SLOT_LABELS[k]}
                          </option>
                        ))}
                      </select>

                      <div
                        style={{
                          height: 10,
                          borderRadius: 6,
                          background:
                            slot === "none" ? "rgba(255,255,255,0.08)" : STRIPE_SLOT_COLOR[slot as Exclude<StripeToken, "none">],
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      const cleared: StripePattern = ["none", "none", "none", "none"];
                      setNewStripePattern(cleared);
                      setNewStripes(0);
                      if (stripeMode === "ibjjf_degree") setStripeMode("manual");
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.14)",
                      color: "white",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Clear
                  </button>

                  {/* legacy quick count (keeps old mental model) */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Quick count:</div>
                    <select
                      value={newStripes}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        const token = defaultStripeTokenForBelt(newBelt);
                        const p = clampStripePattern(undefined, n, token);
                        setNewStripePattern(p);
                        setNewStripes(n);
                        if (stripeMode === "ibjjf_degree") setStripeMode("manual");
                      }}
                      style={{
                        padding: 8,
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "white",
                        fontSize: 12,
                      }}
                    >
                      {STRIPE_COUNT_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 8 }}>
                  「黄色ストライプ無し」の道場なら yellow を使わなければOK。完全手動なのでどの道場でも対応できます。
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: 13, opacity: 0.8 }}>Notes (optional)</label>
                <textarea
                  value={rankNotes}
                  onChange={(e) => setRankNotes(e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    marginTop: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                  placeholder="e.g. Promoted at competition"
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setRankModalOpen(false)}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 10,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={updateRank}
                  disabled={busy}
                  style={{
                    padding: "12px 20px",
                    borderRadius: 10,
                    background: "rgba(168, 85, 247, 0.2)",
                    border: "1px solid rgba(168, 85, 247, 0.4)",
                    color: "#a855f7",
                    fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? "Saving..." : "Update Rank"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
