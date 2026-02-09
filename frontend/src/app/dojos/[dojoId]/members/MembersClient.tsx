"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";
import { dbNullable, auth } from "@/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

// ============================================
// Types
// ============================================

type Member = {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  roleInDojo: string;
  status: string;
  beltRank?: string;
  stripes?: number;
};

type CreateMemberResponse = {
  success: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
  temporaryPassword?: string;
  error?: string;
};

// ============================================
// Constants
// ============================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const BELT_COLORS: Record<string, string> = {
  white: "#E5E7EB",
  blue: "#2563EB",
  purple: "#7C3AED",
  brown: "#92400E",
  black: "#1F2937",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
  coach: "Coach",
  student: "Student",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  staff: "bg-blue-100 text-blue-800",
  coach: "bg-purple-100 text-purple-800",
  student: "bg-gray-100 text-gray-700",
};

// ============================================
// Helpers
// ============================================

function normalizeParam(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function pickFromParams(params: unknown, keys: string[]): string {
  const obj = params as any;
  for (const k of keys) {
    const val = normalizeParam(obj?.[k]);
    if (val) return val;
  }
  return "";
}

function readDojoIdFromPathname(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("dojos");
  if (i >= 0 && parts[i + 1]) return parts[i + 1] || "";
  return "";
}

// ============================================
// API
// ============================================

async function createMemberApi(data: {
  dojoId: string;
  email: string;
  password: string;
  displayName: string;
  roleInDojo: string;
}): Promise<CreateMemberResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken(true);

  const res = await fetch(`${API_BASE}/createMember`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  let json: any = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return json;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 12; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

// ============================================
// Component
// ============================================

export default function MembersClient(props: { dojoId?: string } = {}) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const dojoId = useMemo(() => {
    const fromProps = (props?.dojoId || "").trim();
    if (fromProps) return fromProps;

    const fromParams = pickFromParams(params, ["dojoId", "dojold", "dojoID", "dojoid"]);
    if (fromParams) return fromParams;

    const fromQuery =
      (searchParams.get("dojoId") || "").trim() ||
      (searchParams.get("dojold") || "").trim();
    if (fromQuery) return fromQuery;

    return readDojoIdFromPathname();
  }, [props?.dojoId, params, searchParams]);

  // Fetch dojo name
  const { dojoName } = useDojoName(dojoId);

  const [members, setMembers] = useState<Member[]>([]);
  const [pendingMembers, setPendingMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [showTab, setShowTab] = useState<"active" | "pending">("active");

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    displayName: "",
    email: "",
    password: "",
    roleInDojo: "student",
  });
  const [busy, setBusy] = useState(false);
  const [createdMember, setCreatedMember] = useState<CreateMemberResponse | null>(null);

  // Auth check
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  // dojoId missing
  useEffect(() => {
    if (authLoading || !user) return;
    if (!dojoId) {
      setLoading(false);
      setError("Could not load dojo. Please try again from the dashboard.");
    }
  }, [authLoading, user, dojoId]);

  // Load members
  useEffect(() => {
    const load = async () => {
      if (authLoading || !user) return;

      if (!dbNullable) {
        setError("Firebase is not initialized.");
        setLoading(false);
        return;
      }
      if (!dojoId) return;

      setLoading(true);
      setError("");
      setSuccess("");

      try {
        const snap = await getDocs(collection(dbNullable, "dojos", dojoId, "members"));

        const activeList: Member[] = [];
        const pendingList: Member[] = [];

        for (const d of snap.docs) {
          const data = d.data();
          let userData: any = {};
          try {
            const userSnap = await getDoc(doc(dbNullable, "users", d.id));
            if (userSnap.exists()) userData = userSnap.data();
          } catch {}

          const member: Member = {
            uid: d.id,
            displayName: (data as any).displayName || (userData as any).displayName || "Unknown",
            email: (data as any).email || (userData as any).email,
            photoURL: (data as any).photoURL || (userData as any).photoURL,
            roleInDojo: (data as any).roleInDojo || "student",
            status: (data as any).status || "active",
            beltRank: (data as any).beltRank || "white",
            stripes: (data as any).stripes || 0,
          };

          if (member.status === "pending") pendingList.push(member);
          else activeList.push(member);
        }

        const roleOrder = ["owner", "staff", "coach", "student"];
        activeList.sort(
          (a, b) =>
            roleOrder.indexOf(a.roleInDojo) - roleOrder.indexOf(b.roleInDojo) ||
            a.displayName.localeCompare(b.displayName)
        );
        pendingList.sort((a, b) => a.displayName.localeCompare(b.displayName));

        setMembers(activeList);
        setPendingMembers(pendingList);
      } catch (e: any) {
        setError(e?.message || "Failed to load members.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authLoading, user, dojoId]);

  // Filter
  const filtered = members.filter((m) => {
    if (
      search &&
      !m.displayName?.toLowerCase().includes(search.toLowerCase()) &&
      !m.email?.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterRole !== "all" && m.roleInDojo !== filterRole) return false;
    return true;
  });

  const goMemberDetail = (uid: string) => {
    if (!dojoId) return;
    router.push(`/dojos/${encodeURIComponent(dojoId)}/members/${encodeURIComponent(uid)}`);
  };

  // Approve
  const approveRequest = async (member: Member) => {
    if (!dbNullable || !dojoId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", member.uid);
      await updateDoc(memberRef, {
        status: "active",
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const userRef = doc(dbNullable, "users", member.uid);
      await updateDoc(userRef, {
        dojoId: dojoId,
        pendingDojoId: null,
        updatedAt: serverTimestamp(),
      });

      setPendingMembers((prev) => prev.filter((m) => m.uid !== member.uid));
      setMembers((prev) => [...prev, { ...member, status: "active" }]);
      setSuccess(`Approved ${member.displayName}!`);
    } catch (e: any) {
      setError(e?.message || "Failed to approve.");
    } finally {
      setBusy(false);
    }
  };

  // Reject
  const rejectRequest = async (member: Member) => {
    if (!dbNullable || !dojoId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", member.uid);
      await updateDoc(memberRef, {
        status: "rejected",
        updatedAt: serverTimestamp(),
      });

      setPendingMembers((prev) => prev.filter((m) => m.uid !== member.uid));
      setSuccess(`Rejected ${member.displayName}'s request.`);
    } catch (e: any) {
      setError(e?.message || "Failed to reject.");
    } finally {
      setBusy(false);
    }
  };

  // Add member
  const addMember = async () => {
    if (!dojoId || !newMember.displayName.trim() || !newMember.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!newMember.email.includes("@")) {
      setError("Invalid email address.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    setCreatedMember(null);

    try {
      const password = newMember.password.trim() || generatePassword();
      const result = await createMemberApi({
        dojoId,
        email: newMember.email.trim(),
        password,
        displayName: newMember.displayName.trim(),
        roleInDojo: newMember.roleInDojo,
      });

      if (result.success && result.uid) {
        setMembers((prev) => [
          ...prev,
          {
            uid: result.uid!,
            displayName: newMember.displayName.trim(),
            email: newMember.email.trim(),
            roleInDojo: newMember.roleInDojo,
            status: "active",
            beltRank: "white",
            stripes: 0,
          },
        ]);
        setCreatedMember({ ...result, temporaryPassword: password });
        setSuccess(`Member "${newMember.displayName}" created!`);
      } else {
        throw new Error(result.error || "Failed to create member.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to create member.");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setAddModalOpen(false);
    setNewMember({ displayName: "", email: "", password: "", roleInDojo: "student" });
    setCreatedMember(null);
    setError("");
  };

  const copyInviteLink = () => {
    if (!dojoId) {
      setError("Cannot create invite link.");
      return;
    }
    if (typeof window === "undefined") return;
    const link = `${window.location.origin}/signup/student-profile?dojoId=${encodeURIComponent(dojoId)}`;
    navigator.clipboard.writeText(link);
    setSuccess("Invite link copied to clipboard!");
  };

  const goBack = () => {
    if (!dojoId) {
      router.push("/dojos/timetable");
      return;
    }
    router.push(`/dojos/${encodeURIComponent(dojoId)}/timetable`);
  };

  // ============================================
  // Loading / Auth states
  // ============================================

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  if (!user) return null;

  if (!dojoId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            Could not load dojo. Please try again from the dashboard.
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  // ============================================
  // Main Render
  // ============================================

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
        {/* Back */}
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dojo
        </button>

        {/* Header with dojo name */}
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            {dojoName && (
              <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>
            )}
            <h1 className="text-3xl font-bold text-gray-900">Members</h1>
            <p className="text-gray-600 mt-2">
              {members.length} active member{members.length !== 1 && "s"}
              {pendingMembers.length > 0 && ` · ${pendingMembers.length} pending`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyInviteLink}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700 font-medium"
            >
              <span className="mr-1.5">🔗</span>Copy Invite Link
            </button>
            <button
              onClick={() => setAddModalOpen(true)}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-medium"
            >
              + Add Member
            </button>
          </div>
        </div>

        {/* Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setShowTab("active")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              showTab === "active"
                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            Active ({members.length})
          </button>
          <button
            onClick={() => setShowTab("pending")}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition ${
              showTab === "pending"
                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            Pending ({pendingMembers.length})
            {pendingMembers.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border-2 border-gray-50" />
            )}
          </button>
        </div>

        {/* Active Members */}
        {showTab === "active" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            {/* Search & Filter */}
            <div className="px-6 py-4 border-b border-gray-200 flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  placeholder="Search members..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Roles</option>
                <option value="student">Students</option>
                <option value="coach">Coaches</option>
                <option value="staff">Staff</option>
                <option value="owner">Owners</option>
              </select>
            </div>

            {/* Member List */}
            {filtered.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">
                {members.length === 0 ? "No members yet. Add your first member above." : "No results found."}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filtered.map((m) => (
                  <div
                    key={m.uid}
                    onClick={() => goMemberDetail(m.uid)}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                      {m.displayName?.charAt(0).toUpperCase() || "?"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{m.displayName}</p>
                      {m.email && (
                        <p className="text-sm text-gray-500 truncate">{m.email}</p>
                      )}
                    </div>

                    <div
                      className="w-8 h-2.5 rounded-sm border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: BELT_COLORS[m.beltRank || "white"] }}
                      title={`${m.beltRank || "white"} belt${m.stripes ? ` (${m.stripes} stripe${m.stripes !== 1 ? "s" : ""})` : ""}`}
                    />

                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                        ROLE_BADGE_COLORS[m.roleInDojo] || "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {ROLE_LABELS[m.roleInDojo] || m.roleInDojo}
                    </span>

                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pending Requests */}
        {showTab === "pending" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            {pendingMembers.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">No pending requests.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {pendingMembers.map((m) => (
                  <div key={m.uid} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-10 h-10 rounded-full bg-yellow-100 text-yellow-700 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                      {m.displayName?.charAt(0).toUpperCase() || "?"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{m.displayName}</p>
                      {m.email && (
                        <p className="text-sm text-gray-500 truncate">{m.email}</p>
                      )}
                    </div>

                    <button
                      onClick={() => approveRequest(m)}
                      disabled={busy}
                      className="px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm font-medium hover:bg-green-100 transition disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectRequest(m)}
                      disabled={busy}
                      className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 transition disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNavigation />

      {/* Add Member Modal */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {createdMember?.success ? (
              <div className="p-6">
                <div className="text-center mb-6">
                  <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Member Created!</h3>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3 mb-6">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Name</p>
                    <p className="font-medium text-gray-900">{createdMember.displayName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Email</p>
                    <p className="font-medium text-gray-900">{createdMember.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Temporary Password</p>
                    <p className="font-mono text-lg font-bold text-green-700">{createdMember.temporaryPassword}</p>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-6">
                  <p className="text-sm text-yellow-800">
                    Save this password and share it securely with the member.
                  </p>
                </div>

                <button
                  onClick={closeModal}
                  className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900">Add New Member</h3>
                  <button
                    onClick={closeModal}
                    className="text-gray-400 hover:text-gray-600 transition"
                    aria-label="Close"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={newMember.displayName}
                      onChange={(e) => setNewMember((p) => ({ ...p, displayName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="John Doe"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={newMember.email}
                      onChange={(e) => setNewMember((p) => ({ ...p, email: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password <span className="text-gray-400 font-normal">(auto-generated if empty)</span>
                    </label>
                    <input
                      value={newMember.password}
                      onChange={(e) => setNewMember((p) => ({ ...p, password: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Leave empty to auto-generate"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <select
                      value={newMember.roleInDojo}
                      onChange={(e) => setNewMember((p) => ({ ...p, roleInDojo: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="student">Student</option>
                      <option value="coach">Coach</option>
                      <option value="staff">Staff</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={closeModal}
                    className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addMember}
                    disabled={busy || !newMember.displayName.trim() || !newMember.email.trim()}
                    className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy ? "Creating..." : "Create Member"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}