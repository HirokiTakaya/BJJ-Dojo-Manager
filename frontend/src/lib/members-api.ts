/**
 * lib/members-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由でメンバーを操作
 */

import { apiGet, apiPost, apiPut, apiDelete, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type MemberRole = "owner" | "staff" | "staff_member" | "coach" | "student";
export type MemberStatus = "pending" | "approved" | "active" | "inactive";

export type DojoMember = {
  uid: string;
  status: MemberStatus;
  roleInDojo: MemberRole;
  dojoId?: string;
  beltRank?: string;
  stripes?: number;
  displayName?: string;
  email?: string;
  photoURL?: string;
  joinedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MemberWithUser = {
  uid: string;
  member: DojoMember;
  user: { displayName?: string; email?: string; photoURL?: string };
};

export type CreateMemberInput = {
  dojoId: string;
  email: string;
  password: string;
  displayName: string;
  roleInDojo?: MemberRole;
};

export type CreateMemberResponse = {
  success: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
  temporaryPassword?: string;
  error?: string;
};

export type UpdateMemberInput = {
  roleInDojo?: MemberRole;
  status?: MemberStatus;
  beltRank?: string;
  stripes?: number;
};

// ============================================
// API Functions
// ============================================

export async function listMembers(
  dojoId: string,
  options?: { status?: MemberStatus; limit?: number }
): Promise<MemberWithUser[]> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/members?status=xxx&limit=xxx
    const url = buildUrl(`/v1/dojos/${dojoId}/members`, {
      status: options?.status,
      limit: options?.limit,
    });
    const data = await apiGet<{ members: MemberWithUser[] }>(url);
    return data.members || [];
  }

  // Functions: GET /members?dojoId=xxx&status=xxx&limit=xxx
  const data = await apiGet<{ members: MemberWithUser[] }>(
    buildUrl("/members", { dojoId, status: options?.status, limit: options?.limit })
  );
  return data.members || [];
}

export async function getMember(dojoId: string, memberUid: string): Promise<MemberWithUser> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/members/{memberUid}
    return apiGet<MemberWithUser>(`/v1/dojos/${dojoId}/members/${memberUid}`);
  }

  // Functions: GET /members?dojoId=xxx&memberUid=xxx
  return apiGet<MemberWithUser>(buildUrl("/members", { dojoId, memberUid }));
}

export async function createMember(input: CreateMemberInput): Promise<CreateMemberResponse> {
  if (isUsingGoApi()) {
    // Go: POST /api/members/create (same endpoint)
    return apiPost<CreateMemberResponse>("/api/members/create", input);
  }

  // Functions: POST /createMember
  return apiPost<CreateMemberResponse>("/createMember", input);
}

export async function updateMember(
  dojoId: string,
  memberUid: string,
  input: UpdateMemberInput
): Promise<void> {
  if (isUsingGoApi()) {
    // Go: PUT /v1/dojos/{dojoId}/members/{memberUid}
    await apiPut(`/v1/dojos/${dojoId}/members/${memberUid}`, input);
  } else {
    // Functions: PUT /members (with dojoId and memberUid in body)
    await apiPut("/members", { dojoId, memberUid, ...input });
  }
}

export async function removeMember(dojoId: string, memberUid: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: DELETE /v1/dojos/{dojoId}/members/{memberUid}
    await apiDelete(`/v1/dojos/${dojoId}/members/${memberUid}`);
  } else {
    // Functions: DELETE /members?dojoId=xxx&memberUid=xxx
    await apiDelete(buildUrl("/members", { dojoId, memberUid }));
  }
}

export async function listStudents(
  dojoId: string,
  options?: { limit?: number }
): Promise<MemberWithUser[]> {
  const members = await listMembers(dojoId, { status: "active", limit: options?.limit || 500 });
  return members.filter((m) => m.member.roleInDojo === "student");
}

export async function listStaff(dojoId: string): Promise<MemberWithUser[]> {
  const members = await listMembers(dojoId, { status: "active" });
  return members.filter((m) =>
    ["owner", "staff", "staff_member", "coach"].includes(m.member.roleInDojo)
  );
}

export async function listPendingMembers(dojoId: string): Promise<MemberWithUser[]> {
  return listMembers(dojoId, { status: "pending" });
}

export async function approveJoinRequest(dojoId: string, studentUid: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/joinRequests/{studentUid}/approve
    await apiPost(`/v1/dojos/${dojoId}/joinRequests/${studentUid}/approve`, {});
  } else {
    // Functions: POST /approveJoinRequest
    await apiPost("/approveJoinRequest", { dojoId, studentUid });
  }
}

// ============================================
// Utility Functions
// ============================================

export function filterMembers(members: MemberWithUser[], searchText: string): MemberWithUser[] {
  const q = (searchText || "").trim().toLowerCase();
  if (!q) return members;
  return members.filter((m) => {
    const name = (m.user.displayName || "").toLowerCase();
    const email = (m.user.email || "").toLowerCase();
    return name.includes(q) || email.includes(q) || m.uid.toLowerCase().includes(q);
  });
}

export function getRoleLabel(role: MemberRole): string {
  return (
    { owner: "オーナー", staff: "スタッフ", staff_member: "スタッフ", coach: "コーチ", student: "生徒" }[
      role
    ] || role
  );
}

export function getStatusLabel(status: MemberStatus): string {
  return (
    { pending: "承認待ち", approved: "承認済み", active: "アクティブ", inactive: "非アクティブ" }[
      status
    ] || status
  );
}

export function isStaffRole(role: MemberRole): boolean {
  return ["owner", "staff", "staff_member", "coach"].includes(role);
}
