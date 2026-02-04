/**
 * lib/timetable-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由でtimetable（session）を操作
 *
 * 環境変数:
 * - NEXT_PUBLIC_API_URL: Cloud Functions URL
 * - NEXT_PUBLIC_GO_API_URL: Go Cloud Run URL
 * - NEXT_PUBLIC_USE_GO_API: "true" で Go API を使用
 */

import { apiGet, apiPost, apiPut, apiDelete, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type ClassType = "adult" | "kids" | "mixed";

export type TimetableClass = {
  id: string;
  title: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  description?: string;
  instructor?: string;
  classType?: ClassType;
  maxCapacity?: number;
  location?: string;
  isActive?: boolean;
  sortKey?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateTimetableInput = {
  title: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  description?: string;
  instructor?: string;
  classType?: ClassType;
  maxCapacity?: number;
  location?: string;
};

export type UpdateTimetableInput = Partial<CreateTimetableInput> & { isActive?: boolean };

type BackendSession = {
  id: string;
  dojoId: string;
  title: string;
  description?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  instructor?: string;
  classType?: ClassType;
  maxCapacity?: number;
  location?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// Helpers
// ============================================

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hhmmToMinutesOrNull(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function addMinutesToHHMM(hhmm: string, minutes: number): string {
  return minutesToHHMM(Math.min(hhmmToMinutes(hhmm) + minutes, 23 * 60 + 59));
}

function toTimetableClass(s: BackendSession): TimetableClass {
  const startMinute = hhmmToMinutes(s.startTime);
  const endMinute = hhmmToMinutes(s.endTime);

  return {
    id: s.id,
    title: s.title,
    weekday: s.dayOfWeek,
    startMinute,
    durationMinute: Math.max(endMinute - startMinute, 60),
    description: s.description,
    instructor: s.instructor,
    classType: s.classType,
    maxCapacity: s.maxCapacity,
    location: s.location,
    isActive: s.isActive,
    sortKey: s.dayOfWeek * 10000 + startMinute,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// ============================================
// URL Builders (Go vs Functions)
// ============================================

function getSessionsListUrl(dojoId: string, params?: Record<string, any>): string {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/sessions
    return buildUrl(`/v1/dojos/${dojoId}/sessions`, params);
  }
  // Functions: GET /sessions?dojoId=xxx
  return buildUrl("/sessions", { dojoId, ...params });
}

function getSessionUrl(dojoId: string, sessionId: string): string {
  if (isUsingGoApi()) {
    // Go: /v1/dojos/{dojoId}/sessions/{sessionId}
    return `/v1/dojos/${dojoId}/sessions/${sessionId}`;
  }
  // Functions: /sessions?dojoId=xxx&id=yyy
  return buildUrl("/sessions", { dojoId, id: sessionId });
}

// ============================================
// API Functions
// ============================================

export async function listTimetable(
  dojoId: string,
  options?: { activeOnly?: boolean; dayOfWeek?: number; limit?: number }
): Promise<TimetableClass[]> {
  const url = getSessionsListUrl(dojoId, {
    activeOnly: options?.activeOnly,
    dayOfWeek: options?.dayOfWeek,
    limit: options?.limit,
  });

  const data = await apiGet<{ sessions: BackendSession[] }>(url);
  return (data.sessions || []).map(toTimetableClass);
}

export async function getTimetableClass(dojoId: string, classId: string): Promise<TimetableClass> {
  const url = getSessionUrl(dojoId, classId);
  const data = await apiGet<BackendSession>(url);
  return toTimetableClass(data);
}

export async function createTimetableClass(
  dojoId: string,
  input: CreateTimetableInput
): Promise<string> {
  const startTime = minutesToHHMM(input.startMinute);

  const body = {
    title: input.title,
    dayOfWeek: input.weekday,
    startTime,
    endTime: addMinutesToHHMM(startTime, input.durationMinute),
    description: input.description,
    instructor: input.instructor,
    classType: input.classType ?? "adult",
    maxCapacity: input.maxCapacity,
    location: input.location,
  };

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/sessions
    const data = await apiPost<BackendSession>(`/v1/dojos/${dojoId}/sessions`, body);
    return data.id;
  }

  // Functions: POST /sessions (with dojoId in body)
  const data = await apiPost<{ id: string }>("/sessions", { dojoId, ...body });
  return data.id;
}

export async function updateTimetableClass(
  dojoId: string,
  classId: string,
  input: UpdateTimetableInput
): Promise<void> {
  const body: Record<string, any> = {};

  if (input.title !== undefined) body.title = input.title;
  if (input.weekday !== undefined) body.dayOfWeek = input.weekday;
  if (input.description !== undefined) body.description = input.description;
  if (input.instructor !== undefined) body.instructor = input.instructor;
  if (input.classType !== undefined) body.classType = input.classType;
  if (input.maxCapacity !== undefined) body.maxCapacity = input.maxCapacity;
  if (input.location !== undefined) body.location = input.location;
  if (input.isActive !== undefined) body.isActive = input.isActive;

  if (input.startMinute !== undefined) {
    body.startTime = minutesToHHMM(input.startMinute);
  }

  if (input.durationMinute !== undefined) {
    let startHHMM: string;
    if (input.startMinute !== undefined) {
      startHHMM = minutesToHHMM(input.startMinute);
    } else {
      const cur = await getTimetableClass(dojoId, classId);
      startHHMM = minutesToHHMM(cur.startMinute);
    }
    body.endTime = addMinutesToHHMM(startHHMM, input.durationMinute);
  }

  if (isUsingGoApi()) {
    // Go: PUT /v1/dojos/{dojoId}/sessions/{sessionId}
    await apiPut(`/v1/dojos/${dojoId}/sessions/${classId}`, body);
  } else {
    // Functions: PUT /sessions (with dojoId and id in body)
    await apiPut("/sessions", { dojoId, id: classId, ...body });
  }
}

export async function deleteTimetableClass(dojoId: string, classId: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: DELETE /v1/dojos/{dojoId}/sessions/{sessionId}
    await apiDelete(`/v1/dojos/${dojoId}/sessions/${classId}`);
  } else {
    // Functions: DELETE /sessions?dojoId=xxx&id=yyy
    const url = buildUrl("/sessions", { dojoId, id: classId });
    await apiDelete(url);
  }
}

// ============================================
// Constants
// ============================================

export const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export const WEEKDAYS_JA = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];
