/**
 * lib/retention-api.ts
 * Retention Alerts API client — calls Go Cloud Run backend
 */

import { apiGet, apiPut } from "./api-client";

// ============================================
// Types
// ============================================

export type RiskLevel = "critical" | "warning" | "watch";

export type RetentionSettings = {
  thresholdDays: number;
  criticalMultiplier: number;
  watchRatio: number;
  emailEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type MemberAlert = {
  memberUid: string;
  displayName: string;
  email?: string;
  beltRank: string;
  stripes: number;
  isKids: boolean;
  lastAttendedDate: string;       // "YYYY-MM-DD" or ""
  lastAttendedSessionTitle?: string;
  daysSinceLastAttendance: number; // -1 = never
  totalSessions: number;
  riskLevel: RiskLevel;
};

export type AlertStats = {
  totalMembers: number;
  totalAtRisk: number;
  critical: number;
  warning: number;
  watch: number;
};

export type AlertsSummary = {
  dojoId: string;
  settings: RetentionSettings;
  alerts: MemberAlert[];
  stats: AlertStats;
  scannedAt: string;
};

export type UpdateSettingsInput = {
  thresholdDays?: number;
  criticalMultiplier?: number;
  watchRatio?: number;
  emailEnabled?: boolean;
};

// ============================================
// API Functions
// ============================================

/**
 * Get retention alerts for a dojo (staff only)
 * GET /v1/dojos/{dojoId}/retention/alerts
 */
export async function getRetentionAlerts(dojoId: string): Promise<AlertsSummary> {
  return apiGet<AlertsSummary>(`/v1/dojos/${dojoId}/retention/alerts`);
}

/**
 * Get retention settings for a dojo
 * GET /v1/dojos/{dojoId}/retention/settings
 */
export async function getRetentionSettings(dojoId: string): Promise<RetentionSettings> {
  return apiGet<RetentionSettings>(`/v1/dojos/${dojoId}/retention/settings`);
}

/**
 * Update retention settings (staff only)
 * PUT /v1/dojos/{dojoId}/retention/settings
 */
export async function updateRetentionSettings(
  dojoId: string,
  input: UpdateSettingsInput
): Promise<RetentionSettings> {
  return apiPut<RetentionSettings>(`/v1/dojos/${dojoId}/retention/settings`, input);
}