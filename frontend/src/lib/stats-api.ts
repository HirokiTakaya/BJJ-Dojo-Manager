/**
 * lib/stats-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由で統計を取得
 */

import { apiGet, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type DojoStats = {
  members: {
    total: number;
    active: number;
    pending: number;
    roleDistribution: Record<string, number>;
  };
  sessions: { active: number };
  attendance: {
    thisMonth: {
      total: number;
      present: number;
      absent: number;
      late: number;
      rate: string;
    };
  };
};

export type MemberStats = {
  member: {
    beltRank: string;
    stripes: number;
    joinedAt: string;
    daysSinceJoined: number;
  };
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
    rate: string;
    thisMonth: {
      total: number;
      present: number;
      rate: string;
    };
  };
  recentPromotions: Array<{ newBelt: string; newStripes: number; createdAt: string }>;
};

export type AttendanceStats = {
  period: string;
  startDate: string;
  endDate: string;
  summary: {
    total: number;
    present: number;
    absent: number;
    late: number;
    rate: string;
  };
  daily: Array<{
    date: string;
    present: number;
    absent: number;
    late: number;
    total: number;
    rate: string;
  }>;
};

// ============================================
// API Functions
// ============================================

export async function getDojoStats(dojoId: string): Promise<DojoStats> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/stats
    return apiGet<DojoStats>(`/v1/dojos/${dojoId}/stats`);
  }

  // Functions: GET /getDojoStats?dojoId=xxx
  return apiGet<DojoStats>(buildUrl("/getDojoStats", { dojoId }));
}

export async function getMemberStats(dojoId: string, memberUid: string): Promise<MemberStats> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/members/{memberUid}/stats
    return apiGet<MemberStats>(`/v1/dojos/${dojoId}/members/${memberUid}/stats`);
  }

  // Functions: GET /getMemberStats?dojoId=xxx&memberUid=xxx
  return apiGet<MemberStats>(buildUrl("/getMemberStats", { dojoId, memberUid }));
}

export async function getAttendanceStats(
  dojoId: string,
  options?: { period?: "day" | "week" | "month"; sessionId?: string }
): Promise<AttendanceStats> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/attendanceStats?period=xxx&sessionId=xxx
    const url = buildUrl(`/v1/dojos/${dojoId}/attendanceStats`, {
      period: options?.period,
      sessionId: options?.sessionId,
    });
    return apiGet<AttendanceStats>(url);
  }

  // Functions: GET /getAttendanceStats?dojoId=xxx&period=xxx&sessionId=xxx
  return apiGet<AttendanceStats>(
    buildUrl("/getAttendanceStats", {
      dojoId,
      period: options?.period,
      sessionId: options?.sessionId,
    })
  );
}

// ============================================
// Utility Functions
// ============================================

export function formatPercentage(rate: string | number): string {
  const num = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${num.toFixed(1)}%`;
}

export function getAttendanceRateColor(rate: number): string {
  if (rate >= 80) return "green";
  if (rate >= 60) return "yellow";
  return "red";
}
