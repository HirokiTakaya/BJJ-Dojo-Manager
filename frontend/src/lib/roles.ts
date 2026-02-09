/**
 * Shared role resolution utilities.
 *
 * Single source of truth for staff/student detection, role normalization,
 * and dojoId resolution. Used by HomePage, MembersClient, TimetableClient, etc.
 *
 * Place at: src/lib/roles.ts
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Minimal shape of the Firestore `users/{uid}` document
 * that role utilities need. Pages can extend this type locally
 * with additional fields they care about.
 */
export type UserDocBase = {
  role?: string;
  roleUi?: string;
  roles?: string[] | Record<string, boolean>;
  accountType?: string;
  dojoId?: string | null;
  staffProfile?: { dojoId?: string | null; roleInDojo?: string };
  studentProfile?: { dojoId?: string | null };
};

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const STAFF_ROLES = new Set([
  "owner",
  "staff",
  "staff_member",
  "coach",
  "admin",
  "instructor",
]);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Trim + lowercase a role string. Returns "" for nullish input. */
export function normalizeRole(r?: string | null): string {
  return (r ?? "").trim().toLowerCase();
}

/** Check if a single role string is a staff-level role. */
export function isStaffRole(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r ? STAFF_ROLES.has(r) : false;
}

/**
 * Check if a user doc has a specific role name
 * (handles both array and Record<string, boolean> shapes).
 */
export function hasRole(ud: UserDocBase | null, roleName: string): boolean {
  const roles = ud?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleName);
  return !!roles[roleName];
}

// ─────────────────────────────────────────────────────────────
// Resolution functions
// ─────────────────────────────────────────────────────────────

/**
 * Pick the "best" role string from a user doc.
 * Prefers a staff role if one exists; otherwise returns the first found.
 */
export function resolveRole(ud: UserDocBase | null): string | null {
  if (!ud) return null;

  const candidates: string[] = [];

  if (typeof ud.role === "string" && ud.role.trim())
    candidates.push(ud.role.trim());

  if (Array.isArray(ud.roles)) {
    for (const r of ud.roles) {
      if (typeof r === "string" && r.trim()) candidates.push(r.trim());
    }
  } else if (ud.roles && typeof ud.roles === "object") {
    for (const [key, val] of Object.entries(ud.roles)) {
      if (val && key.trim()) candidates.push(key.trim());
    }
  }

  if (typeof ud.roleUi === "string" && ud.roleUi.trim())
    candidates.push(ud.roleUi.trim());

  if (typeof ud.accountType === "string" && ud.accountType.trim())
    candidates.push(ud.accountType.trim());

  if (candidates.length === 0) return null;
  return candidates.find((r) => isStaffRole(r)) || candidates[0];
}

/**
 * Extract the dojoId from a user doc.
 * Checks top-level, then staffProfile, then studentProfile.
 */
export function resolveDojoId(ud: UserDocBase | null): string | null {
  if (!ud) return null;
  return ud.dojoId || ud.staffProfile?.dojoId || ud.studentProfile?.dojoId || null;
}

/**
 * Determine whether a user should see the "Staff" experience.
 *
 * Logic priority:
 * 1. If role/roleUi is explicitly "student" → staff only if staffProfile.dojoId exists
 * 2. If only staffProfile has a dojoId → staff
 * 3. If only studentProfile has a dojoId → not staff
 * 4. Otherwise → check resolved role against STAFF_ROLES
 */
export function resolveIsStaff(ud: UserDocBase | null): boolean {
  if (!ud) return false;

  const role = normalizeRole(ud.role);
  const roleUi = normalizeRole(ud.roleUi);

  // Explicit student role — only staff if they also have a staffProfile
  if (role === "student" || roleUi === "student") {
    return !!ud.staffProfile?.dojoId;
  }

  const staffDojoId = ud.staffProfile?.dojoId || null;
  const studentDojoId = ud.studentProfile?.dojoId || null;

  if (staffDojoId && !studentDojoId) return true;
  if (studentDojoId && !staffDojoId) return false;

  return isStaffRole(resolveRole(ud));
}