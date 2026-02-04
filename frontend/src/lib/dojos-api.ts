/**
 * lib/dojos-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由で道場を操作
 */

import { apiGet, apiPost, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type Dojo = {
  name: string;
  slug: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
  logoURL?: string;
  isPublic: boolean;
  ownerUid?: string;
  ownerIds?: string[];
  searchTokens?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DojoWithId = { dojoId: string; dojo: Dojo };

export type CreateDojoInput = {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  isPublic?: boolean;
};

export type JoinRequestInput = {
  dojoId: string;
  message?: string;
};

// ============================================
// API Functions
// ============================================

export async function getDojo(dojoId: string): Promise<DojoWithId> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId} (not implemented yet, use search)
    // For now, search by ID
    const data = await apiGet<{ items: DojoWithId[] }>(buildUrl("/v1/dojos/search", { q: dojoId }));
    const found = (data.items || []).find((d) => d.dojoId === dojoId);
    if (!found) throw new Error("Dojo not found");
    return found;
  }

  // Functions: GET /dojos?id=xxx
  return apiGet<DojoWithId>(buildUrl("/dojos", { id: dojoId }));
}

export async function searchDojos(query: string, limit?: number): Promise<DojoWithId[]> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/search?q=xxx&limit=xxx
    const data = await apiGet<{ items: DojoWithId[] }>(
      buildUrl("/v1/dojos/search", { q: query, limit: limit || 20 })
    );
    return data.items || [];
  }

  // Functions: GET /dojos?q=xxx&limit=xxx
  const data = await apiGet<{ items: DojoWithId[] }>(
    buildUrl("/dojos", { q: query, limit: limit || 20 })
  );
  return data.items || [];
}

export async function createDojo(input: CreateDojoInput): Promise<DojoWithId> {
  if (isUsingGoApi()) {
    // Go: POST /v1/dojos
    return apiPost<DojoWithId>("/v1/dojos", input);
  }

  // Functions: POST /dojos
  return apiPost<DojoWithId>("/dojos", input);
}

export async function sendJoinRequest(input: JoinRequestInput): Promise<{ status: string }> {
  const { dojoId, ...body } = input;

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/joinRequests
    return apiPost<{ status: string }>(`/v1/dojos/${dojoId}/joinRequests`, body);
  }

  // Functions: POST /joinRequests
  return apiPost<{ status: string }>("/joinRequests", input);
}

export async function approveJoinRequest(
  dojoId: string,
  studentUid: string
): Promise<{ status: string }> {
  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/joinRequests/{studentUid}/approve
    return apiPost<{ status: string }>(
      `/v1/dojos/${dojoId}/joinRequests/${studentUid}/approve`,
      {}
    );
  }

  // Functions: POST /approveJoinRequest
  return apiPost<{ status: string }>("/approveJoinRequest", { dojoId, studentUid });
}

// ============================================
// Utility Functions
// ============================================

export function formatDojoAddress(dojo: Dojo): string {
  return [dojo.address, dojo.city, dojo.country].filter(Boolean).join(", ");
}

export function getDojoDisplayName(dojo: Dojo): string {
  return dojo.name || dojo.slug || "道場";
}
