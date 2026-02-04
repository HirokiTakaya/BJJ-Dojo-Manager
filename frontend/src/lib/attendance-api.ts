/**
 * lib/attendance-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由で出席を操作
 */

import { apiGet, apiPost, apiPut, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type AttendanceRecord = {
  id: string;
  dojoId: string;
  sessionInstanceId: string;
  memberUid: string;
  status: AttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  notes?: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RecordAttendanceInput = {
  dojoId: string;
  sessionInstanceId: string;
  memberUid: string;
  status: AttendanceStatus;
  notes?: string;
};

export type BulkAttendanceInput = {
  dojoId: string;
  sessionInstanceId: string;
  records: Array<{ memberUid: string; status: AttendanceStatus; notes?: string }>;
};

export type BulkAttendanceResult = {
  success: boolean;
  processed: number;
  results: Array<{ memberUid: string; action: "created" | "updated" }>;
};

// ============================================
// API Functions
// ============================================

export async function listAttendanceBySession(
  dojoId: string,
  sessionInstanceId: string
): Promise<AttendanceRecord[]> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/attendance?sessionInstanceId=xxx
    const url = buildUrl(`/v1/dojos/${dojoId}/attendance`, { sessionInstanceId });
    const data = await apiGet<{ attendance: AttendanceRecord[] }>(url);
    return data.attendance || [];
  }

  // Functions: GET /attendance?dojoId=xxx&sessionInstanceId=xxx
  const data = await apiGet<{ attendance: AttendanceRecord[] }>(
    buildUrl("/attendance", { dojoId, sessionInstanceId })
  );
  return data.attendance || [];
}

export async function listAttendanceByMember(
  dojoId: string,
  memberUid: string,
  options?: { limit?: number }
): Promise<AttendanceRecord[]> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/attendance?memberUid=xxx&limit=xxx
    const url = buildUrl(`/v1/dojos/${dojoId}/attendance`, {
      memberUid,
      limit: options?.limit,
    });
    const data = await apiGet<{ attendance: AttendanceRecord[] }>(url);
    return data.attendance || [];
  }

  // Functions: GET /attendance?dojoId=xxx&memberUid=xxx&limit=xxx
  const data = await apiGet<{ attendance: AttendanceRecord[] }>(
    buildUrl("/attendance", { dojoId, memberUid, limit: options?.limit })
  );
  return data.attendance || [];
}

export async function recordAttendance(input: RecordAttendanceInput): Promise<AttendanceRecord> {
  const { dojoId, ...body } = input;

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/attendance
    return apiPost<AttendanceRecord>(`/v1/dojos/${dojoId}/attendance`, body);
  }

  // Functions: POST /attendance (with dojoId in body)
  return apiPost<AttendanceRecord>("/attendance", input);
}

export async function updateAttendance(
  dojoId: string,
  attendanceId: string,
  input: { status?: AttendanceStatus; notes?: string }
): Promise<AttendanceRecord> {
  if (isUsingGoApi()) {
    // Go: PUT /v1/dojos/{dojoId}/attendance/{attendanceId}
    return apiPut<AttendanceRecord>(`/v1/dojos/${dojoId}/attendance/${attendanceId}`, input);
  }

  // Functions: PUT /attendance (with dojoId and id in body)
  return apiPut<AttendanceRecord>("/attendance", { dojoId, id: attendanceId, ...input });
}

export async function recordBulkAttendance(input: BulkAttendanceInput): Promise<BulkAttendanceResult> {
  const { dojoId, ...body } = input;

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/attendance/bulk
    return apiPost<BulkAttendanceResult>(`/v1/dojos/${dojoId}/attendance/bulk`, body);
  }

  // Functions: POST /bulkAttendance
  return apiPost<BulkAttendanceResult>("/bulkAttendance", input);
}

// ============================================
// Utility Functions
// ============================================

export function getAttendanceStatusLabel(status: AttendanceStatus): string {
  return { present: "出席", absent: "欠席", late: "遅刻", excused: "公欠" }[status] || status;
}

export function getAttendanceStatusColor(status: AttendanceStatus): string {
  return { present: "green", absent: "red", late: "yellow", excused: "blue" }[status] || "gray";
}

export function calculateAttendanceRate(records: AttendanceRecord[]): number {
  if (records.length === 0) return 0;
  const present = records.filter((r) => r.status === "present" || r.status === "late").length;
  return Math.round((present / records.length) * 100);
}

export function calculateAttendanceStats(records: AttendanceRecord[]) {
  const stats = { total: records.length, present: 0, absent: 0, late: 0, excused: 0, rate: 0 };
  for (const r of records) {
    if (r.status === "present") stats.present++;
    else if (r.status === "absent") stats.absent++;
    else if (r.status === "late") stats.late++;
    else if (r.status === "excused") stats.excused++;
  }
  if (stats.total > 0) {
    stats.rate = Math.round(((stats.present + stats.late) / stats.total) * 100);
  }
  return stats;
}
