"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, dbNullable } from "@/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  getFirestore,
} from "firebase/firestore";

// ============================================
// Types
// ============================================

type UserProfile = {
  displayName?: string;
  email?: string;
  dojoId?: string;
  dojoName?: string;
  role?: string;
  staffProfile?: {
    dojoId?: string;
    dojoName?: string;
    roleInDojo?: string;
  };
  studentProfile?: {
    dojoId?: string;
    dojoName?: string;
    fullName?: string;
    belt?: string;
  };
};

type MemberProfile = {
  displayName?: string;
  email?: string;
  beltRank?: string;
  stripes?: number;
  isKids?: boolean;
  emergencyContact?: string;
  emergencyPhone?: string;
  notes?: string;
};

// ============================================
// Constants
// ============================================

const ADULT_BELTS = [
  { value: "white", label: "White", color: "#FFFFFF" },
  { value: "blue", label: "Blue", color: "#0066CC" },
  { value: "purple", label: "Purple", color: "#6B3FA0" },
  { value: "brown", label: "Brown", color: "#8B4513" },
  { value: "black", label: "Black", color: "#1A1A1A" },
];

const KIDS_BELTS = [
  { value: "white", label: "White", color: "#FFFFFF" },
  { value: "grey-white", label: "Grey/White", color: "#9CA3AF" },
  { value: "grey", label: "Grey", color: "#6B7280" },
  { value: "grey-black", label: "Grey/Black", color: "#4B5563" },
  { value: "yellow-white", label: "Yellow/White", color: "#FDE047" },
  { value: "yellow", label: "Yellow", color: "#FACC15" },
  { value: "yellow-black", label: "Yellow/Black", color: "#EAB308" },
  { value: "orange-white", label: "Orange/White", color: "#FDBA74" },
  { value: "orange", label: "Orange", color: "#F97316" },
  { value: "orange-black", label: "Orange/Black", color: "#EA580C" },
  { value: "green-white", label: "Green/White", color: "#86EFAC" },
  { value: "green", label: "Green", color: "#22C55E" },
  { value: "green-black", label: "Green/Black", color: "#16A34A" },
];

const STRIPE_OPTIONS = [0, 1, 2, 3, 4];

// ============================================
// Helpers
// ============================================

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
  } catch {
    // ignore
  }
  const start = Date.now();
  while (!dbNullable) {
    if (Date.now() - start > maxMs) return null;
    await sleep(80);
  }
  __dbCache = dbNullable;
  return __dbCache;
}

// ============================================
// Sub-components
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

// ============================================
// Main Component
// ============================================

export default function ProfileClient() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [beltRank, setBeltRank] = useState("white");
  const [stripes, setStripes] = useState(0);
  const [isKids, setIsKids] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [notes, setNotes] = useState("");

  // Derived
  const dojoId = userProfile?.dojoId || userProfile?.staffProfile?.dojoId || userProfile?.studentProfile?.dojoId || null;
  const dojoName = userProfile?.dojoName || userProfile?.staffProfile?.dojoName || userProfile?.studentProfile?.dojoName || null;
  
  // ✅ スタッフかどうか判定（スタッフは自分の帯等も編集可能）
  const isStaff = Boolean(
    userProfile?.staffProfile?.dojoId ||
    userProfile?.role === "owner" ||
    userProfile?.role === "staff" ||
    userProfile?.role === "coach" ||
    userProfile?.role === "instructor" ||
    userProfile?.role === "admin"
  );

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load profile
  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const db = await waitForDb();
        if (!db) {
          setError("Database not available");
          setLoading(false);
          return;
        }

        // Load user profile
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data() as UserProfile;
          setUserProfile(userData);
          setDisplayName(userData.displayName || userData.studentProfile?.fullName || "");

          // Load member profile if dojoId exists
          const did = userData.dojoId || userData.staffProfile?.dojoId || userData.studentProfile?.dojoId;
          if (did) {
            const memberRef = doc(db, "dojos", did, "members", user.uid);
            const memberSnap = await getDoc(memberRef);
            
            if (memberSnap.exists()) {
              const memberData = memberSnap.data() as MemberProfile;
              setMemberProfile(memberData);
              setDisplayName(memberData.displayName || userData.displayName || "");
              setBeltRank(memberData.beltRank || "white");
              setStripes(memberData.stripes || 0);
              setIsKids(memberData.isKids || false);
              setEmergencyContact(memberData.emergencyContact || "");
              setEmergencyPhone(memberData.emergencyPhone || "");
              setNotes(memberData.notes || "");
            } else {
              // Use studentProfile data if available
              if (userData.studentProfile?.belt) {
                setBeltRank(userData.studentProfile.belt);
              }
            }
          }
        } else {
          // New user - set email as display name
          setDisplayName(user.email || "");
        }
      } catch (e: any) {
        console.error("[Profile] load error:", e);
        setError(e?.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  // Save profile
  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const db = await waitForDb();
      if (!db) throw new Error("Database not available");

      const now = serverTimestamp();

      // Update user document
      const userRef = doc(db, "users", user.uid);
      const userPatch: any = {
        displayName: displayName.trim(),
        updatedAt: now,
      };

      // Update studentProfile if exists
      if (userProfile?.studentProfile) {
        userPatch.studentProfile = {
          ...userProfile.studentProfile,
          fullName: displayName.trim(),
        };
        // ✅ スタッフのみ帯を更新可能
        if (isStaff) {
          userPatch.studentProfile.belt = beltRank;
        }
      }

      await setDoc(userRef, userPatch, { merge: true });

      // Update member document if dojoId exists
      // Note: beltRank, stripes, isKids are only updated for staff
      if (dojoId) {
        const memberRef = doc(db, "dojos", dojoId, "members", user.uid);
        const memberPatch: any = {
          displayName: displayName.trim(),
          emergencyContact: emergencyContact.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          notes: notes.trim() || null,
          updatedAt: now,
        };

        // ✅ スタッフのみ帯・ストライプ・キッズを更新可能
        if (isStaff) {
          memberPatch.beltRank = beltRank;
          memberPatch.stripes = stripes;
          memberPatch.isKids = isKids;
        }

        await setDoc(memberRef, memberPatch, { merge: true });
      }

      setSuccess("Profile saved successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e: any) {
      console.error("[Profile] save error:", e);
      setError(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  // Get belt options based on isKids
  const beltOptions = isKids ? KIDS_BELTS : ADULT_BELTS;

  // Reset belt if switching between adult/kids and current belt is invalid
  useEffect(() => {
    const validBelts = beltOptions.map((b) => b.value);
    if (!validBelts.includes(beltRank)) {
      setBeltRank("white");
    }
  }, [isKids, beltOptions, beltRank]);

  // Get current belt color
  const currentBeltColor = [...ADULT_BELTS, ...KIDS_BELTS].find((b) => b.value === beltRank)?.color || "#FFFFFF";

  // ============================================
  // Render
  // ============================================

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-2xl p-4 sm:p-6">
          <Card>
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <div className="text-slate-900 text-lg font-semibold">Loading…</div>
              <div className="mt-1 text-sm text-slate-500">Fetching your profile</div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-4">
        {/* Header */}
        <Card>
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <GhostBtn onClick={() => router.back()}>← Back</GhostBtn>
                <h1 className="mt-3 text-xl sm:text-2xl font-semibold text-slate-900">
                  My Profile
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                    ✉️ {user.email}
                  </span>
                  {dojoName && (
                    <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-700">
                      🥋 {dojoName}
                    </span>
                  )}
                </div>
              </div>

              <OutlineBtn
                onClick={async () => {
                  await auth.signOut();
                  router.replace("/login");
                }}
              >
                Sign Out
              </OutlineBtn>
            </div>
          </div>
        </Card>

        {/* Messages */}
        {error && <Alert kind="error">❌ {error}</Alert>}
        {success && <Alert kind="success">✅ {success}</Alert>}

        {/* Profile Form */}
        <Card>
          <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-5">
            <div className="text-base font-semibold text-slate-900">Basic Information</div>

            {/* Display Name */}
            <label className="block space-y-1">
              <div className="text-sm font-semibold text-slate-700">Display Name *</div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <div className="text-xs text-slate-500">
                This name will be displayed to instructors and other members.
              </div>
            </label>

            {/* Kids Toggle - Editable for staff, display only for students */}
            {isStaff ? (
              <div className="flex items-center gap-3">
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={isKids}
                    onChange={(e) => setIsKids(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-violet-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-300"></div>
                </label>
                <span className="text-sm font-semibold text-slate-700">Kids Program</span>
                {isKids && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                    キッズ
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className={`flex h-6 w-11 items-center rounded-full ${isKids ? 'bg-violet-500' : 'bg-slate-200'}`}>
                  <div className={`h-5 w-5 rounded-full border bg-white transition-transform ${isKids ? 'translate-x-5 border-white' : 'translate-x-0.5 border-slate-300'}`} />
                </div>
                <span className="text-sm font-semibold text-slate-700">Kids Program</span>
                {isKids && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                    キッズ
                  </span>
                )}
                <span className="text-xs text-slate-500">(Managed by staff)</span>
              </div>
            )}

            {/* Belt Rank - Editable for staff, display only for students */}
            {isStaff ? (
              <label className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Belt Rank</div>
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-16 rounded border border-slate-300"
                    style={{ backgroundColor: currentBeltColor }}
                  />
                  <select
                    value={beltRank}
                    onChange={(e) => setBeltRank(e.target.value)}
                    className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    {beltOptions.map((belt) => (
                      <option key={belt.value} value={belt.value}>
                        {belt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            ) : (
              <div className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Belt Rank</div>
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-16 rounded border border-slate-300"
                    style={{ backgroundColor: currentBeltColor }}
                  />
                  <span className="text-slate-900 font-medium">
                    {beltOptions.find((b) => b.value === beltRank)?.label || "White"}
                  </span>
                  <span className="text-xs text-slate-500">(Managed by staff)</span>
                </div>
              </div>
            )}

            {/* Stripes - Editable for staff, display only for students */}
            {isStaff ? (
              <label className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Stripes</div>
                <div className="flex items-center gap-2">
                  {STRIPE_OPTIONS.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setStripes(num)}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition ${
                        stripes === num
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                  <div className="ml-2 flex items-center gap-1">
                    {Array.from({ length: stripes }).map((_, i) => (
                      <div
                        key={i}
                        className="h-4 w-1 rounded bg-white border border-slate-400"
                      />
                    ))}
                  </div>
                </div>
              </label>
            ) : (
              <div className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Stripes</div>
                <div className="flex items-center gap-2">
                  {STRIPE_OPTIONS.map((num) => (
                    <div
                      key={num}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                        stripes === num
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {num}
                    </div>
                  ))}
                  <div className="ml-2 flex items-center gap-1">
                    {Array.from({ length: stripes }).map((_, i) => (
                      <div
                        key={i}
                        className="h-4 w-1 rounded bg-white border border-slate-400"
                      />
                    ))}
                  </div>
                  <span className="text-xs text-slate-500 ml-2">(Managed by staff)</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-5">
            <div className="text-base font-semibold text-slate-900">Emergency Contact (Optional)</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Contact Name</div>
                <input
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="e.g. Parent, Guardian"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>

              <label className="block space-y-1">
                <div className="text-sm font-semibold text-slate-700">Phone Number</div>
                <input
                  type="tel"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  placeholder="e.g. 123-456-7890"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <div className="text-sm font-semibold text-slate-700">Notes / Medical Info</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any allergies, medical conditions, or other notes..."
                rows={3}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </label>
          </div>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          <GhostBtn onClick={() => router.back()} disabled={saving}>
            Cancel
          </GhostBtn>
          <PrimaryBtn onClick={handleSave} disabled={saving || !displayName.trim()}>
            {saving ? "Saving..." : "Save Profile"}
          </PrimaryBtn>
        </div>

        {/* Debug Info */}
        {dojoId && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <div className="font-mono">
              User ID: {user.uid}
              <br />
              Dojo ID: {dojoId}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}