/**
 * lib/ranks-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由で帯/ランクを操作
 */

import { apiGet, apiPost, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type RankHistory = {
  id: string;
  previousBelt: string;
  previousStripes: number;
  newBelt: string;
  newStripes: number;
  promotedBy: string;
  notes?: string;
  createdAt: string;
};

export type BeltDistribution = {
  belt: string;
  count: number;
  stripes: Record<number, number>;
};

export type BeltDistributionResponse = {
  total: number;
  distribution: BeltDistribution[];
};

export type UpdateRankInput = {
  dojoId: string;
  memberUid: string;
  beltRank: string;
  stripes?: number;
  notes?: string;
};

export type AddStripeInput = {
  dojoId: string;
  memberUid: string;
  notes?: string;
};

// ============================================
// API Functions
// ============================================

export async function updateMemberRank(input: UpdateRankInput) {
  const { dojoId, memberUid, ...body } = input;

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/members/{memberUid}/rank
    return apiPost<{ previousBelt: string; previousStripes: number; newBelt: string; newStripes: number }>(
      `/v1/dojos/${dojoId}/members/${memberUid}/rank`,
      body
    );
  }

  // Functions: POST /updateMemberRank
  return apiPost<{ previousBelt: string; previousStripes: number; newBelt: string; newStripes: number }>(
    "/updateMemberRank",
    input
  );
}

export async function addStripe(input: AddStripeInput) {
  const { dojoId, memberUid, ...body } = input;

  if (isUsingGoApi()) {
    // Go: POST /v1/dojos/{dojoId}/members/{memberUid}/stripe
    return apiPost<{ previousStripes: number; newStripes: number }>(
      `/v1/dojos/${dojoId}/members/${memberUid}/stripe`,
      body
    );
  }

  // Functions: POST /addStripe
  return apiPost<{ previousStripes: number; newStripes: number }>("/addStripe", input);
}

export async function getRankHistory(dojoId: string, memberUid: string): Promise<RankHistory[]> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/members/{memberUid}/rankHistory
    const data = await apiGet<{ history: RankHistory[] }>(
      `/v1/dojos/${dojoId}/members/${memberUid}/rankHistory`
    );
    return data.history || [];
  }

  // Functions: GET /getRankHistory?dojoId=xxx&memberUid=xxx
  const data = await apiGet<{ history: RankHistory[] }>(
    buildUrl("/getRankHistory", { dojoId, memberUid })
  );
  return data.history || [];
}

export async function getBeltDistribution(dojoId: string): Promise<BeltDistributionResponse> {
  if (isUsingGoApi()) {
    // Go: GET /v1/dojos/{dojoId}/beltDistribution
    return apiGet<BeltDistributionResponse>(`/v1/dojos/${dojoId}/beltDistribution`);
  }

  // Functions: GET /getBeltDistribution?dojoId=xxx
  return apiGet<BeltDistributionResponse>(buildUrl("/getBeltDistribution", { dojoId }));
}

// ============================================
// Constants
// ============================================

export const BELT_ORDER = ["white", "blue", "purple", "brown", "black", "red_black", "red"];

export const KIDS_BELT_ORDER = [
  "white",
  "grey_white",
  "grey",
  "grey_black",
  "yellow_white",
  "yellow",
  "yellow_black",
  "orange_white",
  "orange",
  "orange_black",
  "green_white",
  "green",
  "green_black",
];

export const BELT_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  blue: "#0066CC",
  purple: "#6B3FA0",
  brown: "#8B4513",
  black: "#1A1A1A",
  red_black: "#8B0000",
  red: "#CC0000",
  grey_white: "#D3D3D3",
  grey: "#808080",
  grey_black: "#4A4A4A",
  yellow_white: "#FFFACD",
  yellow: "#FFD700",
  yellow_black: "#DAA520",
  orange_white: "#FFDAB9",
  orange: "#FF8C00",
  orange_black: "#CC5500",
  green_white: "#98FB98",
  green: "#228B22",
  green_black: "#006400",
};

// ============================================
// Utility Functions
// ============================================

export function getBeltLabel(belt: string): string {
  const labels: Record<string, string> = {
    white: "白帯",
    blue: "青帯",
    purple: "紫帯",
    brown: "茶帯",
    black: "黒帯",
    red_black: "赤黒帯",
    red: "赤帯",
    grey_white: "灰白帯",
    grey: "灰帯",
    grey_black: "灰黒帯",
    yellow_white: "黄白帯",
    yellow: "黄帯",
    yellow_black: "黄黒帯",
    orange_white: "橙白帯",
    orange: "橙帯",
    orange_black: "橙黒帯",
    green_white: "緑白帯",
    green: "緑帯",
    green_black: "緑黒帯",
  };
  return labels[belt] || belt;
}

export function getBeltColor(belt: string): string {
  return BELT_COLORS[belt] || "#CCCCCC";
}

export function formatStripes(stripes: number): string {
  if (stripes <= 0) return "";
  return "⬜".repeat(Math.min(stripes, 4));
}

export function formatBeltWithStripes(belt: string, stripes: number): string {
  return `${getBeltLabel(belt)}${stripes > 0 ? ` ${stripes}本ストライプ` : ""}`;
}

export function isKidsBelt(belt: string): boolean {
  return KIDS_BELT_ORDER.includes(belt);
}

export function getNextBelt(currentBelt: string, isKids: boolean): string | null {
  const order = isKids ? KIDS_BELT_ORDER : BELT_ORDER;
  const index = order.indexOf(currentBelt);
  if (index === -1 || index >= order.length - 1) return null;
  return order[index + 1];
}
