
// app/dojos/[dojoId]/settings/billing/checkout/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import type { BillingPeriod, PlanType } from "@/lib/stripe/config";

import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || "";
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

const stripePromise = loadStripe(STRIPE_PK);

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const dojoId = typeof params?.dojoId === "string" ? params.dojoId : "";

  const plan = (searchParams.get("plan") || "pro") as PlanType;
  const period = (searchParams.get("period") || "monthly") as BillingPeriod;

  const [loading, setLoading] = useState(true);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/dojos/${dojoId}/settings/billing?success=true`;
  }, [dojoId]);

  useEffect(() => {
    if (!user || !dojoId) return;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const token = await user.getIdToken();

        // ✅ 互換設計：
        // - もし backend が embedded 対応していれば clientSecret を返す
        // - まだ従来通りなら url を返す → リダイレクトで継続可能
        const res = await fetch(`${GO_API_URL}/v1/stripe/create-checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            dojoId,
            plan,
            period,
            // 従来互換（既存実装が successUrl/cancelUrl を要求してても壊れない）
            successUrl: `${window.location.origin}/dojos/${dojoId}/settings/billing?success=true`,
            cancelUrl: `${window.location.origin}/dojos/${dojoId}/settings/billing?canceled=true`,
            // embedded 対応してる backend なら使える
            uiMode: "embedded",
            returnUrl,
          }),
        });

        if (!res.ok) throw new Error("Failed to create checkout session");

        const data = await res.json();

        // 1) Embedded Checkout 対応（clientSecretが返る）
        if (data?.clientSecret) {
          if (!STRIPE_PK) {
            throw new Error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
          }
          setClientSecret(data.clientSecret);
          return;
        }

        // 2) 従来方式（urlが返る）→ Stripeにリダイレクト
        if (data?.url) {
          window.location.href = data.url;
          return;
        }

        throw new Error("Invalid checkout response (no clientSecret or url)");
      } catch (e) {
        console.error(e);
        setError("Failed to start checkout. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [user, dojoId, plan, period, returnUrl]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <button
          onClick={() => router.push(`/dojos/${dojoId}/settings/billing`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Billing
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">Secure Checkout</h1>
          <p className="text-gray-600 mt-2">
            Plan: <span className="font-medium">{plan}</span> / Period: <span className="font-medium">{period}</span>
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mt-4">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}

          {/* ✅ Embedded Checkout (app内カード入力) */}
          {!loading && clientSecret && (
            <div className="mt-6">
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}

          {/* clientSecret も url も無い時の保険 */}
          {!loading && !clientSecret && !error && (
            <div className="mt-6 text-gray-600">
              Preparing checkout...
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
