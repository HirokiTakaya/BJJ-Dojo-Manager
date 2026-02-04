/**
 * lib/stripe-api.ts
 * Firebase Functions バックエンド経由でStripe決済を操作
 */

import { getFunctions, httpsCallable } from "firebase/functions";

export type PaymentIntent = { clientSecret: string };
export type CheckoutSession = { sessionId: string; url: string };
export type PaymentRecord = { id: string; uid: string; dojoId?: string; amount: number; currency: string; type: string; status: string; createdAt: string };

const functions = getFunctions();

export async function createPaymentIntent(amount: number, metadata?: Record<string, string>): Promise<PaymentIntent> {
  const fn = httpsCallable<{ amount: number; metadata?: Record<string, string> }, PaymentIntent>(functions, "createPaymentIntent");
  const result = await fn({ amount, metadata });
  return result.data;
}

export async function createCheckoutSession(params: {
  amount: number; productName?: string; successPath?: string; cancelPath?: string; metadata?: Record<string, string>;
}): Promise<CheckoutSession> {
  const fn = httpsCallable<typeof params, CheckoutSession>(functions, "createCheckoutSession");
  const result = await fn(params);
  return result.data;
}

export async function getPaymentHistory(limit?: number): Promise<PaymentRecord[]> {
  const fn = httpsCallable<{ limit?: number }, { payments: PaymentRecord[] }>(functions, "getPaymentHistory");
  const result = await fn({ limit });
  return result.data.payments || [];
}

export function formatCurrency(amount: number, currency: string = "jpy"): string {
  if (currency.toLowerCase() === "jpy") return `¥${amount.toLocaleString()}`;
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

export function getPaymentStatusLabel(status: string): string {
  return { pending: "処理中", completed: "完了", failed: "失敗", refunded: "返金済み" }[status] || status;
}

export function getPaymentStatusColor(status: string): string {
  return { pending: "yellow", completed: "green", failed: "red", refunded: "blue" }[status] || "gray";
}
