"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, dbNullable } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type UserDoc = {
  role?: string;
  roleUi?: string;
  roles?: string[] | Record<string, boolean>;
  dojoId?: string | null;
  staffProfile?: { dojoId?: string | null };
  studentProfile?: { dojoId?: string | null };
};

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
const STAFF_ROLES = ["owner", "staff", "staff_member", "coach", "admin"];

const hasRole = (u: UserDoc | null, roleName: string): boolean => {
  const roles = u?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleName);
  return !!roles[roleName];
};

const isStaffRole = (role?: string | null): boolean => {
  if (!role) return false;
  return STAFF_ROLES.includes(role.toLowerCase().trim());
};

const checkIsStaff = (u: UserDoc | null): boolean => {
  if (!u) return false;
  if (u.staffProfile?.dojoId) return true;
  if (isStaffRole(u.role) || isStaffRole(u.roleUi)) return true;
  return STAFF_ROLES.some((r) => hasRole(u, r));
};

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
const MenuButton = React.memo(({
  onClick,
  icon,
  title,
  description,
  accentColor,
}: {
  onClick: () => void;
  icon: string;
  title: string;
  description: string;
  accentColor: string;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full text-left bg-white rounded-xl overflow-hidden transition-all duration-200"
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr auto',
        border: '1px solid #e2e8f0',
        boxShadow: isHovered
          ? '0 8px 24px -4px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)'
          : '0 1px 3px rgba(0,0,0,0.04)',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* Left Accent Line */}
      <div style={{ background: accentColor, borderRadius: '12px 0 0 12px' }} />

      {/* Content */}
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px' }}>{icon}</span>
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: '#0f172a',
          }}>
            {title}
          </span>
        </div>
        <p style={{
          fontSize: '14px',
          color: '#64748b',
          margin: 0,
          lineHeight: 1.5,
        }}>
          {description}
        </p>
      </div>

      {/* Arrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '20px',
      }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: isHovered ? '#f1f5f9' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{
              transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
              transition: 'transform 0.2s ease',
            }}
          >
            <path
              d="M6 3L11 8L6 13"
              stroke={isHovered ? '#0f172a' : '#94a3b8'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </button>
  );
});
MenuButton.displayName = 'MenuButton';

const InfoChip = React.memo(({ label, value }: { label: string; value: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      borderRadius: '8px',
      background: '#f1f5f9',
      fontSize: '13px',
      color: '#64748b',
    }}
  >
    {label}:
    <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>
      {value}
    </span>
  </span>
));
InfoChip.displayName = 'InfoChip';

const ProfileCard = React.memo(({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      padding: '16px 20px',
      background: '#fff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
    }}
  >
    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginBottom: '4px' }}>
      {label}
    </div>
    <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>
      {value}
    </div>
  </div>
));
ProfileCard.displayName = 'ProfileCard';

const RoleBadge = React.memo(({ role }: { role: string }) => {
  const config: Record<string, { bg: string; text: string; dot: string }> = {
    Staff: { bg: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' },
    Member: { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
    User: { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
  };
  const { bg, text, dot } = config[role] || config.User;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '20px',
        background: bg,
        fontSize: '12px',
        fontWeight: 600,
        color: text,
      }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot }} />
      {role}
    </span>
  );
});
RoleBadge.displayName = 'RoleBadge';

const SectionHeader = React.memo(({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div style={{ marginBottom: '16px' }}>
    <h2 style={{
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
      color: '#64748b',
      margin: 0,
    }}>
      {title}
    </h2>
    {subtitle && (
      <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
        {subtitle}
      </p>
    )}
  </div>
));
SectionHeader.displayName = 'SectionHeader';

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState("");

  // Load user profile
  useEffect(() => {
    if (!user) {
      setUserDoc(null);
      return;
    }

    if (!dbNullable) {
      setProfileErr("Firestore is not ready (dbNullable is null).");
      return;
    }

    let mounted = true;
    setProfileBusy(true);
    setProfileErr("");

    getDoc(doc(dbNullable, "users", user.uid))
      .then((snap) => {
        if (mounted) {
          setUserDoc(snap.exists() ? (snap.data() as UserDoc) : null);
        }
      })
      .catch((e: Error) => {
        if (mounted) {
          setProfileErr(e?.message || "Failed to load user profile.");
        }
      })
      .finally(() => {
        if (mounted) setProfileBusy(false);
      });

    return () => { mounted = false; };
  }, [user]);

  // Computed values
  const dojoId = useMemo(() => {
    return userDoc?.dojoId || userDoc?.staffProfile?.dojoId || userDoc?.studentProfile?.dojoId || null;
  }, [userDoc]);

  const isStaff = useMemo(() => checkIsStaff(userDoc), [userDoc]);
  const isStudent = useMemo(() => userDoc && !isStaff, [userDoc, isStaff]);

  // Navigation handlers
  const handleSignOut = useCallback(async () => {
    await auth.signOut();
    router.replace("/login");
  }, [router]);

  const gotoTimetable = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/timetable`);
  }, [router, dojoId]);

  const gotoStaffNotices = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/notices`);
  }, [router, dojoId]);

  const gotoStudentInbox = useCallback(() => {
    if (dojoId) router.push(`/dojos/${dojoId}/inbox`);
  }, [router, dojoId]);

  const gotoStaffSignup = useCallback(() => {
    const qs = new URLSearchParams();
    qs.set("next", "/home");
    router.push(`/signup/staff?${qs.toString()}`);
  }, [router]);

  const gotoStudentSignup = useCallback(() => {
    const qs = new URLSearchParams();
    qs.set("next", "/home");
    router.push(`/signup/student?${qs.toString()}`);
  }, [router]);

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          padding: '32px 24px',
        }}
      >
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <div
            style={{
              padding: '24px',
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>Loading…</div>
            <div style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>
              Checking your session
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Redirect if not logged in
  if (!user) {
    router.replace("/login");
    return null;
  }

  const roleLabel = isStaff ? "Staff" : isStudent ? "Member" : "User";

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        padding: '32px 24px',
      }}
    >
      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header */}
        <header
          style={{
            padding: '24px',
            background: '#fff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <h1 style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: 0,
                  letterSpacing: '-0.5px',
                }}>
                  Home
                </h1>
                <RoleBadge role={roleLabel} />
              </div>
              <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
                Signed in as <span style={{ fontWeight: 600, color: '#0f172a' }}>{user.email ?? user.uid}</span>
              </p>
            </div>

            <button
              onClick={handleSignOut}
              style={{
                padding: '10px 20px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
            <InfoChip label="dojoId" value={dojoId ?? "(none)"} />
            <InfoChip label="role" value={userDoc?.role ?? "(none)"} />
          </div>
        </header>

        {/* Profile Section */}
        <section
          style={{
            padding: '24px',
            background: '#fff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Profile</h2>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0', fontFamily: 'monospace' }}>
                users/{user.uid}
              </p>
            </div>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: profileBusy ? '#f59e0b' : profileErr ? '#ef4444' : '#22c55e',
              }}
            >
              {profileBusy ? "Loading…" : profileErr ? "Error" : "Ready"}
            </span>
          </div>

          {profileBusy ? (
            <div
              style={{
                padding: '16px 20px',
                background: '#f8fafc',
                borderRadius: '12px',
                color: '#64748b',
              }}
            >
              Loading profile…
            </div>
          ) : profileErr ? (
            <div
              style={{
                padding: '16px 20px',
                background: '#fef2f2',
                borderRadius: '12px',
                border: '1px solid #fecaca',
                color: '#dc2626',
              }}
            >
              {profileErr}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <ProfileCard label="role" value={userDoc?.role ?? "(none)"} />
              <ProfileCard label="roleUi" value={userDoc?.roleUi ?? "(none)"} />
              <ProfileCard label="dojoId" value={dojoId ?? "(none)"} />
            </div>
          )}
        </section>

        {/* Staff Menu */}
        {isStaff && (
          <section
            style={{
              padding: '24px',
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <SectionHeader title="Staff Menu" subtitle="Manage gym operations" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {dojoId ? (
                <>
                  <MenuButton
                    onClick={gotoTimetable}
                    icon="📅"
                    title="Class Schedule (Staff)"
                    description="Build timetable / class → session → attendance check"
                    accentColor="#8b5cf6"
                  />
                  <MenuButton
                    onClick={gotoStaffNotices}
                    icon="📣"
                    title="Gym Announcements (Staff)"
                    description="Send announcements to members, schedule, and manage attachments"
                    accentColor="#0ea5e9"
                  />
                </>
              ) : (
                <MenuButton
                  onClick={gotoStaffSignup}
                  icon="🏢"
                  title="Create / Select Gym"
                  description="No dojoId yet. Please create a gym or select an existing one first."
                  accentColor="#94a3b8"
                />
              )}
            </div>
          </section>
        )}

        {/* Student Menu */}
        {isStudent && (
          <section
            style={{
              padding: '24px',
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <SectionHeader title="Member Menu" subtitle="Check schedules & updates" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {dojoId ? (
                <>
                  <MenuButton
                    onClick={gotoTimetable}
                    icon="📅"
                    title="Class Schedule"
                    description="View classes and make reservations"
                    accentColor="#22c55e"
                  />
                  <MenuButton
                    onClick={gotoStudentInbox}
                    icon="✉️"
                    title="Inbox (Announcements)"
                    description="View gym announcements, updates, and important messages"
                    accentColor="#f59e0b"
                  />
                </>
              ) : (
                <MenuButton
                  onClick={gotoStudentSignup}
                  icon="🥋"
                  title="Join a Gym"
                  description="Search and join a gym to view class schedules"
                  accentColor="#22c55e"
                />
              )}
            </div>
          </section>
        )}

        {/* No profile state */}
        {!isStaff && !isStudent && !profileBusy && userDoc === null && (
          <section
            style={{
              padding: '24px',
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              color: '#64748b',
            }}
          >
            No profile found. Please complete your registration.
          </section>
        )}
      </div>
    </div>
  );
}