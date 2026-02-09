"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, db } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useDojoName } from "@/hooks/useDojoName";
import { resolveIsStaff, type UserDocBase } from "@/lib/roles";
import Navigation, { BottomNavigation } from "@/components/Navigation";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type UserProfile = {
  displayName?: string;
  email?: string;
  dojoId?: string;
  dojoName?: string;
  role?: string;
  staffProfile?: { dojoId?: string; dojoName?: string; roleInDojo?: string };
  studentProfile?: { dojoId?: string; dojoName?: string; fullName?: string; belt?: string };
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

// ─────────────────────────────────────────────
// Belt Config
// ─────────────────────────────────────────────

const ADULT_BELTS = [
  { value: "white", label: "White", color: "#E5E7EB" },
  { value: "blue", label: "Blue", color: "#2563EB" },
  { value: "purple", label: "Purple", color: "#7C3AED" },
  { value: "brown", label: "Brown", color: "#92400E" },
  { value: "black", label: "Black", color: "#1F2937" },
];

const KIDS_BELTS = [
  { value: "white", label: "White", color: "#E5E7EB" },
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

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

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
  const dojoId = userProfile?.dojoId || userProfile?.staffProfile?.dojoId || userProfile?.studentProfile?.dojoId || "";
  const { dojoName } = useDojoName(dojoId);

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
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load profile
  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));

        if (userSnap.exists()) {
          const userData = userSnap.data() as UserProfile;
          setUserProfile(userData);
          setDisplayName(userData.displayName || userData.studentProfile?.fullName || "");

          const did = userData.dojoId || userData.staffProfile?.dojoId || userData.studentProfile?.dojoId;
          if (did) {
            const memberSnap = await getDoc(doc(db, "dojos", did, "members", user.uid));

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
            } else if (userData.studentProfile?.belt) {
              setBeltRank(userData.studentProfile.belt);
            }
          }
        } else {
          setDisplayName(user.email || "");
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load profile.");
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
      const now = serverTimestamp();
      const userPatch: any = { displayName: displayName.trim(), updatedAt: now };

      if (userProfile?.studentProfile) {
        userPatch.studentProfile = { ...userProfile.studentProfile, fullName: displayName.trim() };
        if (isStaff) userPatch.studentProfile.belt = beltRank;
      }

      await setDoc(doc(db, "users", user.uid), userPatch, { merge: true });

      if (dojoId) {
        const memberPatch: any = {
          displayName: displayName.trim(),
          emergencyContact: emergencyContact.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          notes: notes.trim() || null,
          updatedAt: now,
        };
        if (isStaff) {
          memberPatch.beltRank = beltRank;
          memberPatch.stripes = stripes;
          memberPatch.isKids = isKids;
        }
        await setDoc(doc(db, "dojos", dojoId, "members", user.uid), memberPatch, { merge: true });
      }

      setSuccess("Profile saved!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e: any) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // Belt options
  const beltOptions = isKids ? KIDS_BELTS : ADULT_BELTS;

  useEffect(() => {
    const valid = beltOptions.map((b) => b.value);
    if (!valid.includes(beltRank)) setBeltRank("white");
  }, [isKids, beltOptions, beltRank]);

  const currentBeltColor = [...ADULT_BELTS, ...KIDS_BELTS].find((b) => b.value === beltRank)?.color || "#E5E7EB";

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-8 pb-24">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
              <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                  ✉️ {user.email}
                </span>
                {dojoName && (
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    🥋 {dojoName}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={async () => { await auth.signOut(); router.replace("/login"); }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">{success}</div>}

        {/* Basic Info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Basic Information</h2>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Displayed to instructors and other members.</p>
          </div>

          {/* Kids Toggle */}
          <div className="flex items-center gap-3">
            {isStaff ? (
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={isKids} onChange={(e) => setIsKids(e.target.checked)} className="peer sr-only" />
                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-purple-500 peer-checked:after:translate-x-full peer-checked:after:border-white" />
              </label>
            ) : (
              <div className={`h-6 w-11 rounded-full ${isKids ? "bg-purple-500" : "bg-gray-200"} flex items-center`}>
                <div className={`h-5 w-5 rounded-full bg-white border transition-transform ${isKids ? "translate-x-5 border-white" : "translate-x-0.5 border-gray-300"}`} />
              </div>
            )}
            <span className="text-sm font-medium text-gray-700">Kids Program</span>
            {isKids && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">Kids</span>}
            {!isStaff && <span className="text-xs text-gray-400">(Managed by staff)</span>}
          </div>

          {/* Belt Rank */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Belt Rank</label>
            <div className="flex items-center gap-3">
              <div className="w-16 h-4 rounded-sm" style={{ backgroundColor: currentBeltColor, border: "1px solid #D1D5DB" }} />
              {isStaff ? (
                <select value={beltRank} onChange={(e) => setBeltRank(e.target.value)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {beltOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              ) : (
                <>
                  <span className="text-sm font-medium text-gray-900">{beltOptions.find((b) => b.value === beltRank)?.label || "White"}</span>
                  <span className="text-xs text-gray-400">(Managed by staff)</span>
                </>
              )}
            </div>
          </div>

          {/* Stripes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Stripes</label>
            <div className="flex items-center gap-2">
              {STRIPE_OPTIONS.map((n) => (
                isStaff ? (
                  <button key={n} onClick={() => setStripes(n)}
                    className={`w-10 h-10 rounded-lg text-sm font-bold transition ${stripes === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                    {n}
                  </button>
                ) : (
                  <div key={n} className={`w-10 h-10 rounded-lg text-sm font-bold flex items-center justify-center ${stripes === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-300"}`}>
                    {n}
                  </div>
                )
              ))}
              <div className="ml-2 flex items-center gap-1">
                {Array.from({ length: stripes }).map((_, i) => (
                  <div key={i} className="h-4 w-1.5 rounded-sm bg-white border border-gray-400" />
                ))}
              </div>
              {!isStaff && <span className="text-xs text-gray-400 ml-2">(Managed by staff)</span>}
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Emergency Contact</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
              <input type="text" value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="e.g. Parent, Guardian"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="e.g. 123-456-7890"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Medical Info</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Allergies, medical conditions, etc."
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-3">
          <button onClick={() => router.back()} disabled={saving}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !displayName.trim()}
            className="px-4 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50">
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}