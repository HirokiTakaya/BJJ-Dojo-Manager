/**
 * lib/profile-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由でプロフィールを操作
 */

import { apiGet, apiPut, apiPost, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  phone?: string;
  role: string;
  accountType: string;
  roles: string[];
  dojoId?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
  address?: {
    postalCode?: string;
    prefecture?: string;
    city?: string;
    line1?: string;
    line2?: string;
  };
  dateOfBirth?: string;
  gender?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateProfileInput = {
  displayName?: string;
  photoURL?: string;
  phone?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
  address?: {
    postalCode?: string;
    prefecture?: string;
    city?: string;
    line1?: string;
    line2?: string;
  };
  dateOfBirth?: string;
  gender?: string;
  language?: string;
};

// ============================================
// API Functions
// ============================================

export async function getUserProfile(uid?: string): Promise<UserProfile> {
  if (isUsingGoApi()) {
    // Go: GET /v1/profile?uid=xxx
    const url = uid ? buildUrl("/v1/profile", { uid }) : "/v1/profile";
    const data = await apiGet<{ uid: string; user: UserProfile }>(url);
    const { uid: _ignoredUid, ...userWithoutUid } = data.user;
    return { uid: data.uid, ...userWithoutUid };
  }

  // Functions: GET /getUserProfile?uid=xxx
  const url = uid ? buildUrl("/getUserProfile", { uid }) : "/getUserProfile";
  const data = await apiGet<{ uid: string; user: UserProfile }>(url);
  const { uid: _ignoredUid, ...userWithoutUid } = data.user;
  return { uid: data.uid, ...userWithoutUid };
}

export async function updateUserProfile(updates: UpdateProfileInput): Promise<void> {
  if (isUsingGoApi()) {
    // Go: PUT /v1/profile
    await apiPut("/v1/profile", { updates });
  } else {
    // Functions: PUT /updateUserProfile
    await apiPut("/updateUserProfile", { updates });
  }
}

export async function deactivateUser(userId: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: POST /v1/admin/deactivateUser
    await apiPost("/v1/admin/deactivateUser", { userId });
  } else {
    // Functions: POST /deactivateUser
    await apiPost("/deactivateUser", { userId });
  }
}

export async function reactivateUser(userId: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: POST /v1/admin/reactivateUser
    await apiPost("/v1/admin/reactivateUser", { userId });
  } else {
    // Functions: POST /reactivateUser
    await apiPost("/reactivateUser", { userId });
  }
}

// ============================================
// Utility Functions
// ============================================

export function getInitials(displayName: string | undefined | null): string {
  if (!displayName) return "?";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function formatPhoneNumber(phone: string | undefined | null): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");

  // 日本の携帯電話番号形式
  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10 && cleaned.startsWith("0")) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export function formatAddress(address: UserProfile["address"]): string {
  if (!address) return "";
  return [
    address.postalCode ? `〒${address.postalCode}` : "",
    address.prefecture,
    address.city,
    address.line1,
    address.line2,
  ]
    .filter(Boolean)
    .join(" ");
}

export function calculateAge(dateOfBirth: string | undefined | null): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
