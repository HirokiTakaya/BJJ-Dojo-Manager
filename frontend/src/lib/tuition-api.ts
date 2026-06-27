/**
 * lib/tuition-api.ts
 * 道場の月謝(会員→道場)決済 API クライアント
 * Stripe Connect ベース。Go Cloud Run バックエンド経由。
 */

import { apiGet, apiPost, apiDelete } from "./api-client";

// ============================================
// Types
// ============================================

export type ConnectStatus = {
  accountId?: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** "none" | "pending" | "active" */
  status: "none" | "pending" | "active";
};

export type TuitionPlan = {
  id: string;
  name: string;
  description?: string;
  /**
   * 最小通貨単位 (Stripe準拠):
   * - cad/usd: セント (12000 = $120.00)
   * - jpy: 円そのまま (12000 = ¥12,000)
   */
  amount: number;
  currency: string; // "cad" | "jpy" | ...
  interval: "week" | "month" | "year";
  stripeProductId: string;
  stripePriceId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TuitionStatus =
  | "none"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export type MemberTuition = {
  uid: string;
  displayName?: string;
  email?: string;
  customerId?: string;
  subscriptionId?: string;
  status: TuitionStatus;
  planId?: string;
  periodEnd?: string;
  cancelAtPeriodEnd: boolean;
};

export type CreateTuitionPlanInput = {
  name: string;
  description?: string;
  amount: number;
  currency: string;
  interval: "week" | "month" | "year";
};

// ============================================
// Connect (道場オーナー向け)
// ============================================

/** Connectオンボーディング開始。返ってきたURLにリダイレクトする。owner専用 */
export async function startConnectOnboarding(
  dojoId: string,
  opts?: { country?: string }
): Promise<{ url: string }> {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return apiPost(`/v1/dojos/${dojoId}/connect/onboard`, {
    dojoId,
    country: opts?.country ?? "CA",
    refreshUrl: `${origin}/dojos/${dojoId}/settings/payments?refresh=1`,
    returnUrl: `${origin}/dojos/${dojoId}/settings/payments?onboarded=1`,
  });
}

/** Connectアカウントの状態取得(Stripe実態と同期される) */
export async function getConnectStatus(dojoId: string): Promise<ConnectStatus> {
  return apiGet(`/v1/dojos/${dojoId}/connect/status`);
}

// ============================================
// 月謝プラン (owner/staff向け)
// ============================================

export async function createTuitionPlan(
  dojoId: string,
  input: CreateTuitionPlanInput
): Promise<TuitionPlan> {
  return apiPost(`/v1/dojos/${dojoId}/tuition-plans`, { dojoId, ...input });
}

export async function listTuitionPlans(dojoId: string): Promise<TuitionPlan[]> {
  const res = await apiGet<{ plans: TuitionPlan[] }>(
    `/v1/dojos/${dojoId}/tuition-plans`
  );
  return res.plans ?? [];
}

/** プランのアーカイブ(既存サブスクは継続、新規受付のみ停止) */
export async function deactivateTuitionPlan(
  dojoId: string,
  planId: string
): Promise<void> {
  await apiDelete(`/v1/dojos/${dojoId}/tuition-plans/${planId}`);
}

// ============================================
// プロモコード (道場ごと・月謝割引)
// ============================================

export type TuitionPromoCode = {
  id: string;
  code: string;
  stripeCouponId: string;
  stripePromoId: string;
  /** 割引額(最小通貨単位)。例: 3500 = -$35.00 */
  amountOff: number;
  currency: string;
  maxRedemptions: number;
  timesRedeemed: number;
  note?: string;
  active: boolean;
  createdAt: string;
};

export type CreateTuitionPromoInput = {
  /** 任意。空ならStripeが自動生成 */
  code?: string;
  /** 割引額(最小通貨単位)。例: 3500 = -$35.00 */
  amountOff: number;
  /** 任意。デフォルト1(1回使われたら閉じる) */
  maxRedemptions?: number;
  /** 任意のメモ(オーナーのみ閲覧)。例: "田中さん 週1" */
  note?: string;
};

/** プロモコードを作成(オーナーのみ)。amountOff の通貨は道場の月謝プランに自動追従 */
export async function createTuitionPromo(
  dojoId: string,
  input: CreateTuitionPromoInput
): Promise<TuitionPromoCode> {
  return apiPost<TuitionPromoCode>(`/v1/dojos/${dojoId}/tuition-promos`, input);
}

/** プロモコード一覧(オーナー/スタッフ) */
export async function listTuitionPromos(
  dojoId: string
): Promise<TuitionPromoCode[]> {
  return apiGet<TuitionPromoCode[]>(`/v1/dojos/${dojoId}/tuition-promos`);
}

/** プロモコードを無効化(オーナーのみ)。既存の割引中サブスクには影響しない */
export async function deactivateTuitionPromo(
  dojoId: string,
  promoId: string
): Promise<void> {
  await apiDelete(`/v1/dojos/${dojoId}/tuition-promos/${promoId}`);
}

// ============================================
// 会員向け (Checkout / Portal)
// ============================================

/** 月謝サブスク開始。返ってきたURL(Stripe Checkout)にリダイレクトする */
export async function startTuitionCheckout(
  dojoId: string,
  planId: string
): Promise<{ url: string }> {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return apiPost(`/v1/dojos/${dojoId}/tuition/checkout`, {
    dojoId,
    planId,
    successUrl: `${origin}/dojos/${dojoId}/tuition?success=1`,
    cancelUrl: `${origin}/dojos/${dojoId}/tuition?canceled=1`,
  });
}

/** Billing Portal(カード変更・解約・領収書)。返ってきたURLにリダイレクト */
export async function openTuitionPortal(
  dojoId: string
): Promise<{ url: string }> {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return apiPost(`/v1/dojos/${dojoId}/tuition/portal`, {
    dojoId,
    returnUrl: `${origin}/dojos/${dojoId}/tuition`,
  });
}

// ============================================
// 支払い状況 (owner/staff/coach向け)
// ============================================

export async function listMemberTuitionStatus(
  dojoId: string
): Promise<MemberTuition[]> {
  const res = await apiGet<{ members: MemberTuition[] }>(
    `/v1/dojos/${dojoId}/tuition/status`
  );
  return res.members ?? [];
}

/** オーナーによる会員サブスクの期末解約 */
export async function cancelMemberTuition(
  dojoId: string,
  memberUid: string
): Promise<void> {
  await apiPost(`/v1/dojos/${dojoId}/tuition/cancel`, { memberUid });
}

// ============================================
// 表示ヘルパー
// ============================================

const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd"]);

/** Stripeの最小通貨単位 → 表示用文字列 */
export function formatTuitionAmount(amount: number, currency: string): string {
  const cur = currency.toLowerCase();
  const value = ZERO_DECIMAL.has(cur) ? amount : amount / 100;
  return new Intl.NumberFormat(cur === "jpy" ? "ja-JP" : "en-CA", {
    style: "currency",
    currency: cur.toUpperCase(),
  }).format(value);
}

export const TUITION_STATUS_LABEL: Record<TuitionStatus, string> = {
  none: "未加入",
  active: "支払い中",
  past_due: "支払い遅延",
  canceled: "解約済み",
  incomplete: "手続き中",
};