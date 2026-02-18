"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, db } from "@/firebase";
import { useDojoName } from "@/hooks/useDojoName";
import { useWaiverStatus } from "@/hooks/useWaiverStatus";
import { resolveDojoId, resolveIsStaff, type UserDocBase } from "@/lib/roles";
import { doc, getDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [userDoc, setUserDoc] = useState<UserDocBase | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState("");

  // Load user profile
  useEffect(() => {
    if (!user) {
      setUserDoc(null);
      return;
    }

    if (!db) {
      setProfileErr("Firebase is not ready.");
      return;
    }

    let mounted = true;
    setProfileBusy(true);
    setProfileErr("");

    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (mounted) {
          setUserDoc(snap.exists() ? (snap.data() as UserDocBase) : null);
        }
      })
      .catch((e: Error) => {
        if (mounted) {
          setProfileErr(e?.message || "Failed to load profile.");
        }
      })
      .finally(() => {
        if (mounted) setProfileBusy(false);
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  // Computed values
  const dojoId = useMemo(() => resolveDojoId(userDoc), [userDoc]);
  const { dojoName } = useDojoName(dojoId ?? "");
  const isStaff = useMemo(() => resolveIsStaff(userDoc), [userDoc]);
  const isStudent = useMemo(() => userDoc && !isStaff, [userDoc, isStaff]);

  // ★ Waiver status check (students only)
  const { loading: waiverLoading, signed: waiverSigned } = useWaiverStatus(
    isStudent ? dojoId : null,
    user?.uid
  );

  // Navigation handlers
  const handleSignOut = useCallback(async () => {
    await auth.signOut();
    router.replace("/login");
  }, [router]);

  const gotoTimetable = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/timetable`);
  }, [router, dojoId]);

  const gotoMembers = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/members`);
  }, [router, dojoId]);

  const gotoStaffNotices = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/notices`);
  }, [router, dojoId]);

  const gotoStudentInbox = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/inbox`);
  }, [router, dojoId]);

  const gotoBilling = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/settings/billing`);
  }, [router, dojoId]);

  const gotoStaffSignup = useCallback(() => {
    router.push(`/signup/staff?next=/home`);
  }, [router]);

  const gotoStudentSignup = useCallback(() => {
    router.push(`/signup/student?next=/home`);
  }, [router]);

  const gotoWaiver = useCallback(() => {
    if (dojoId) router.push(`/visitor/${dojoId}/waiver?next=/home`);
  }, [router, dojoId]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
      </div>
    );
  }

  // Redirect if not logged in
  if (!user) {
    router.replace("/login");
    return null;
  }

  const roleLabel = isStaff ? "Staff" : isStudent ? "Member" : "User";

  const roleBadgeClass =
    roleLabel === "Staff"
      ? "bg-purple-100 text-purple-800"
      : roleLabel === "Member"
      ? "bg-blue-100 text-blue-800"
      : "bg-gray-100 text-gray-700";

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              {dojoName && (
                <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>
              )}
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">Home</h1>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleBadgeClass}`}>
                  {roleLabel}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                Signed in as <span className="font-medium text-gray-900">{user.email ?? "Anonymous"}</span>
              </p>
            </div>

            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* ★ Waiver unsigned banner (students only) */}
        {isStudent && dojoId && !waiverLoading && !waiverSigned && (
          <button
            onClick={gotoWaiver}
            className="w-full mb-6 flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition text-left group"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-200 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <span className="text-2xl">📝</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900">
                Waiver not signed yet
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                Please sign the liability waiver before joining class.
              </p>
            </div>
            <svg
              className="w-5 h-5 text-amber-500 group-hover:text-amber-700 group-hover:translate-x-0.5 transition flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Profile loading/error */}
        {profileBusy && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          </div>
        )}

        {profileErr && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {profileErr}
          </div>
        )}

        {/* Staff Menu */}
        {isStaff && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Staff Menu</h2>
              <p className="text-sm text-gray-400 mt-1">Manage your dojo operations</p>
            </div>

            <div className="space-y-3">
              {dojoId ? (
                <>
                  <MenuButton
                    onClick={gotoTimetable}
                    icon="📅"
                    title="Class Schedule"
                    description="Build timetable, manage sessions and attendance"
                  />
                  <MenuButton
                    onClick={gotoMembers}
                    icon="👥"
                    title="Members"
                    description="View and manage dojo members"
                  />
                  <MenuButton
                    onClick={gotoStaffNotices}
                    icon="📣"
                    title="Announcements"
                    description="Send updates and announcements to members"
                  />
                  <MenuButton
                    onClick={gotoBilling}
                    icon="💳"
                    title="Billing & Plans"
                    description="Manage your subscription and payments"
                  />
                </>
              ) : (
                <MenuButton
                  onClick={gotoStaffSignup}
                  icon="🏢"
                  title="Create or Select a Dojo"
                  description="Set up your dojo to get started"
                />
              )}
            </div>
          </div>
        )}

        {/* Student Menu */}
        {isStudent && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Member Menu</h2>
              <p className="text-sm text-gray-400 mt-1">Check schedules and updates</p>
            </div>

            <div className="space-y-3">
              {dojoId ? (
                <>
                  <MenuButton
                    onClick={gotoTimetable}
                    icon="📅"
                    title="Class Schedule"
                    description="View classes and make reservations"
                  />
                  <MenuButton
                    onClick={gotoStudentInbox}
                    icon="✉️"
                    title="Inbox"
                    description="View announcements and important messages"
                  />
                </>
              ) : (
                <MenuButton
                  onClick={gotoStudentSignup}
                  icon="🥋"
                  title="Join a Dojo"
                  description="Search and join a dojo to view class schedules"
                />
              )}
            </div>
          </div>
        )}

        {/* No profile state */}
        {!isStaff && !isStudent && !profileBusy && userDoc === null && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-gray-500">
            No profile found. Please complete your registration.
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Menu Button
// ─────────────────────────────────────────────────────────────
function MenuButton({
  onClick,
  icon,
  title,
  description,
}: {
  onClick: () => void;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-4 px-4 py-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm transition group"
    >
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900">{title}</p>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      <svg
        className="w-5 h-5 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-0.5 transition flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}