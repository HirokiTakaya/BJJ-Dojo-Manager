
// app/dojos/[dojoId]/settings/billing/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { PLANS, FEATURE_COMPARISON, PlanType, BillingPeriod } from "@/lib/stripe/config";
import {
  SubscriptionInfo,
  getUsagePercentage,
  formatLimit,
  getUpgradeRecommendation,
} from "@/lib/stripe/plan-limits";

// ✅ FIX: NEXT_PUBLIC_GO_API_URL が無い場合 NEXT_PUBLIC_API_URL にフォールバック
const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || process.env.NEXT_PUBLIC_API_URL || "";

// ✅ デフォルトの usage（安全なフォールバック）
const DEFAULT_USAGE = { current: 0, limit: 0 };

// ✅ priceId fallback 用（古いバックエンド互換）
// NOTE: priceId は秘密情報ではないのでフロントに置いてOK（Secret key は絶対NG）
function getPriceIdFromEnv(plan: PlanType, period: BillingPeriod): string | null {
  if (plan === "free") return null;

  const key =
    plan === "pro"
      ? period === "monthly"
        ? "NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY"
        : "NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY"
      : period === "monthly"
      ? "NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY"
      : "NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_YEARLY";

  // Next.js client ではビルド時に置換される想定
  const val = (process.env as Record<string, string | undefined>)[key];
  return val ?? null;
}

async function readErrorMessage(res: Response): Promise<string> {
  // { error: "..."} / { message: "..."} どちらでも拾う + JSONでなければ text
  try {
    const data = await res.json();
    if (typeof data?.error === "string" && data.error) return data.error;
    if (typeof data?.message === "string" && data.message) return data.message;
    return `Request failed (${res.status})`;
  } catch {
    try {
      const t = await res.text();
      return t || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  }
}

export default function BillingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const dojoId = typeof params?.dojoId === "string" ? params.dojoId : "";

  const [loading, setLoading] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<PlanType | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Query param banners
  const banner = useMemo(() => {
    const success = searchParams?.get("success");
    const canceled = searchParams?.get("canceled");
    const pmUpdated = searchParams?.get("pm_updated");

    if (pmUpdated === "1") return { kind: "success" as const, text: "Card updated successfully." };
    if (success === "true") return { kind: "success" as const, text: "Checkout completed successfully." };
    if (canceled === "true") return { kind: "info" as const, text: "Checkout was canceled." };
    return null;
  }, [searchParams]);

  // Fetch subscription info
  useEffect(() => {
    if (!user || !dojoId) return;

    const fetchSubscription = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!GO_API_URL) {
          throw new Error("API URL is not configured (NEXT_PUBLIC_GO_API_URL / NEXT_PUBLIC_API_URL).");
        }

        const token = await user.getIdToken();
        const res = await fetch(`${GO_API_URL}/v1/dojos/${dojoId}/subscription`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          // ✅ FIX: usage が無い場合でもクラッシュしないようにデフォルト値をマージ
          setSubscription({
            plan: data.plan || "free",
            status: data.status || "none",
            periodEnd: data.periodEnd,
            cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
            usage: {
              members: data.usage?.members || { current: 0, limit: 20 },
              staff: data.usage?.staff || { current: 0, limit: 2 },
              announcements: data.usage?.announcements || { current: 0, limit: 3 },
              classes: data.usage?.classes || { current: 0, limit: 5 },
            },
          });
        } else {
          // Default to free plan if no subscription
          setSubscription({
            plan: "free",
            status: "none",
            usage: {
              members: { current: 0, limit: 20 },
              staff: { current: 0, limit: 2 },
              announcements: { current: 0, limit: 3 },
              classes: { current: 0, limit: 5 },
            },
          });
        }
      } catch (err) {
        console.error("Failed to fetch subscription:", err);
        setError(err instanceof Error ? err.message : "Failed to load subscription info");

        // ✅ FIX: エラー時もデフォルトの subscription をセットしてクラッシュ防止
        setSubscription({
          plan: "free",
          status: "none",
          usage: {
            members: { current: 0, limit: 20 },
            staff: { current: 0, limit: 2 },
            announcements: { current: 0, limit: 3 },
            classes: { current: 0, limit: 5 },
          },
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, [user, dojoId]);

  // ✅ Handle plan selection: Stripe Checkout へリダイレクト
  // 既存: plan + period を送る
  // 互換: priceId が required と返されたら priceId を env から作って再送
  const handleSelectPlan = async (plan: PlanType) => {
    if (!user || !dojoId || plan === "free") return;

    try {
      setCheckoutLoading(plan);
      setError(null);

      if (!GO_API_URL) {
        throw new Error("API URL is not configured (NEXT_PUBLIC_GO_API_URL / NEXT_PUBLIC_API_URL).");
      }

      const token = await user.getIdToken();

      const successUrl = `${window.location.origin}/dojos/${dojoId}/settings/billing?success=true`;
      const cancelUrl = `${window.location.origin}/dojos/${dojoId}/settings/billing?canceled=true`;

      // 1) まずは既存の送信（plan + period）
      const firstRes = await fetch(`${GO_API_URL}/v1/stripe/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dojoId,
          plan,
          period: billingPeriod,
          successUrl,
          cancelUrl,
        }),
      });

      // OKならそのままリダイレクト
      if (firstRes.ok) {
        const { url } = await firstRes.json();
        window.location.href = url;
        return;
      }

      // NGなら理由を見る
      const firstErr = await readErrorMessage(firstRes);

      // 2) 古いバックエンド互換：priceId 必須なら priceId で再試行
      if (firstErr.toLowerCase().includes("priceid is required")) {
        const priceId = getPriceIdFromEnv(plan, billingPeriod);

        if (!priceId) {
          throw new Error(
            `priceId is required by backend, but missing env for ${plan} ${billingPeriod}. ` +
              `Please set NEXT_PUBLIC_STRIPE_PRICE_* for this plan/period.`
          );
        }

        const secondRes = await fetch(`${GO_API_URL}/v1/stripe/create-checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            // dojoId は backend によって必要な場合があるので残す（互換のため）
            dojoId,
            priceId,
            quantity: 1,
            successUrl,
            cancelUrl,
            // ついでに plan/period も残しておく（新旧どっちでも受けられるように）
            plan,
            period: billingPeriod,
          }),
        });

        if (!secondRes.ok) {
          const secondErr = await readErrorMessage(secondRes);
          throw new Error(secondErr || "Failed to create checkout session");
        }

        const { url } = await secondRes.json();
        window.location.href = url;
        return;
      }

      // priceId 以外の理由ならそのまま表示
      throw new Error(firstErr || "Failed to create checkout session");
    } catch (err) {
      console.error("Checkout error:", err);
      setError(err instanceof Error ? err.message : "Failed to start checkout. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  };

  // Handle manage billing (Stripe customer portal)
  const handleManageBilling = async () => {
    if (!user || !dojoId) return;

    try {
      setPortalLoading(true);
      setError(null);

      if (!GO_API_URL) {
        throw new Error("API URL is not configured (NEXT_PUBLIC_GO_API_URL / NEXT_PUBLIC_API_URL).");
      }

      const token = await user.getIdToken();

      const res = await fetch(`${GO_API_URL}/v1/stripe/create-portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dojoId,
          returnUrl: `${window.location.origin}/dojos/${dojoId}/settings/billing`,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        throw new Error(msg || "Failed to create portal session");
      }

      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      console.error("Portal error:", err);
      setError(err instanceof Error ? err.message : "Failed to open billing portal. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  };

  // ✅ Navigate to in-app payment method page
  const handleUpdateCard = () => {
    if (!dojoId) return;
    router.push(`/dojos/${dojoId}/settings/billing/payment-method`);
  };

  const currentPlan = subscription?.plan || "free";
  const upgradeRecommendation = subscription ? getUpgradeRecommendation(subscription) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
        {/* Back button */}
        <button
          onClick={() => router.push(`/dojos/${dojoId}/timetable`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dojo
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Billing & Plans</h1>
          <p className="text-gray-600 mt-2">Manage your subscription and view usage</p>
        </div>

        {/* ✅ Banner */}
        {banner && (
          <div
            className={[
              "px-4 py-3 rounded-lg mb-6 border",
              banner.kind === "success" ? "bg-green-50 border-green-200 text-green-800" : "",
              banner.kind === "info" ? "bg-blue-50 border-blue-200 text-blue-800" : "",
            ].join(" ")}
          >
            {banner.text}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            {/* Current Plan Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-8">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <p className="text-sm text-gray-500">Current Plan</p>
                  <div className="flex items-center gap-3 mt-1">
                    <h2 className="text-2xl font-bold text-gray-900">{PLANS[currentPlan]?.name ?? "Free"}</h2>

                    {currentPlan !== "free" && subscription?.status === "active" && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                        Active
                      </span>
                    )}

                    {subscription?.cancelAtPeriodEnd && (
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
                        Cancels at period end
                      </span>
                    )}
                  </div>

                  {subscription?.periodEnd && currentPlan !== "free" && (
                    <p className="text-sm text-gray-500 mt-1">
                      {subscription.cancelAtPeriodEnd ? "Access until" : "Renews"}{" "}
                      {new Date(subscription.periodEnd).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* ✅ Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUpdateCard}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Add / Update Card
                  </button>

                  {currentPlan !== "free" && (
                    <button
                      onClick={handleManageBilling}
                      disabled={portalLoading}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                    >
                      {portalLoading ? "Loading..." : "Manage Billing"}
                    </button>
                  )}
                </div>
              </div>

              {/* ✅ FIX: Usage Stats — safe access with fallback */}
              {subscription?.usage && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
                  {(["members", "staff", "announcements", "classes"] as const).map((resource) => {
                    const usage = subscription.usage?.[resource] ?? DEFAULT_USAGE;
                    const percentage = getUsagePercentage(usage.current, usage.limit);
                    const isNearLimit = percentage >= 80;

                    return (
                      <div key={resource} className="text-center">
                        <p className="text-sm text-gray-500 capitalize">{resource}</p>
                        <p className={`text-xl font-semibold ${isNearLimit ? "text-orange-600" : "text-gray-900"}`}>
                          {usage.current} / {formatLimit(usage.limit)}
                        </p>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                          <div
                            className={`h-1.5 rounded-full transition-all ${isNearLimit ? "bg-orange-500" : "bg-blue-600"}`}
                            style={{ width: `${Math.min(100, percentage)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Upgrade recommendation */}
              {upgradeRecommendation && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-blue-800">
                    <span className="font-medium">You&apos;re approaching your limits!</span>{" "}
                    Consider upgrading to {PLANS[upgradeRecommendation]?.name ?? "a higher plan"} for more capacity.
                  </p>
                </div>
              )}
            </div>

            {/* Billing Period Toggle */}
            <div className="flex justify-center mb-8">
              <div className="bg-gray-100 p-1 rounded-lg inline-flex">
                <button
                  onClick={() => setBillingPeriod("monthly")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    billingPeriod === "monthly" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingPeriod("yearly")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    billingPeriod === "yearly" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Yearly <span className="ml-1 text-green-600 text-xs">Save 17%</span>
                </button>
              </div>
            </div>

            {/* Pricing Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-12">
              {(["free", "pro", "business"] as const).map((plan) => {
                const config = PLANS[plan];
                const isCurrentPlan = currentPlan === plan;
                const price = billingPeriod === "yearly" ? config.yearlyPrice : config.monthlyPrice;
                const isPopular = config.popular;

                return (
                  <div
                    key={plan}
                    className={`relative bg-white rounded-2xl border-2 p-6 ${
                      isPopular ? "border-blue-500 shadow-lg" : "border-gray-200"
                    } ${isCurrentPlan ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                  >
                    {isPopular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">MOST POPULAR</span>
                      </div>
                    )}

                    <div className="text-center mb-6">
                      <h3 className="text-xl font-bold text-gray-900">{config.name}</h3>
                      <p className="text-gray-500 text-sm mt-1">{config.description}</p>

                      <div className="mt-4">
                        <span className="text-4xl font-bold text-gray-900">
                          {price === 0 ? "Free" : `$${billingPeriod === "yearly" ? Math.round(price / 12) : price}`}
                        </span>
                        {price > 0 && <span className="text-gray-500">/mo</span>}
                      </div>

                      {billingPeriod === "yearly" && price > 0 && <p className="text-sm text-gray-500 mt-1">${price} billed yearly</p>}
                    </div>

                    <ul className="space-y-3 mb-6">
                      {config.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-gray-600 text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      onClick={() => handleSelectPlan(plan)}
                      disabled={isCurrentPlan || checkoutLoading !== null || plan === "free"}
                      className={`w-full py-3 rounded-lg font-medium transition ${
                        isCurrentPlan
                          ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                          : plan === "free"
                          ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                          : isPopular
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-gray-900 text-white hover:bg-gray-800"
                      } disabled:opacity-50`}
                    >
                      {checkoutLoading === plan ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          Processing...
                        </span>
                      ) : isCurrentPlan ? (
                        "Current Plan"
                      ) : plan === "free" ? (
                        "Free Plan"
                      ) : currentPlan !== "free" && plan !== "business" ? (
                        "Downgrade"
                      ) : (
                        "Upgrade"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Feature Comparison Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Feature Comparison</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">Feature</th>
                      <th className="px-6 py-3 text-center text-sm font-medium text-gray-500">Free</th>
                      <th className="px-6 py-3 text-center text-sm font-medium text-gray-500">Pro</th>
                      <th className="px-6 py-3 text-center text-sm font-medium text-gray-500">Business</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {FEATURE_COMPARISON.map((feature, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-6 py-4 text-sm text-gray-900">{feature.name}</td>

                        {(["free", "pro", "business"] as const).map((plan) => (
                          <td key={plan} className="px-6 py-4 text-center">
                            {typeof feature[plan] === "boolean" ? (
                              feature[plan] ? (
                                <svg className="w-5 h-5 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )
                            ) : (
                              <span className="text-sm text-gray-600">{feature[plan]}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* FAQ Section */}
            <div className="mt-12">
              <h3 className="text-xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h3>
              <div className="space-y-4">
                <details className="bg-white rounded-lg border border-gray-200 p-4">
                  <summary className="font-medium text-gray-900 cursor-pointer">Can I change plans anytime?</summary>
                  <p className="mt-3 text-gray-600 text-sm">
                    Yes! You can upgrade or downgrade your plan at any time. When upgrading, you&apos;ll be charged the prorated difference.
                    When downgrading, the credit will be applied to future invoices.
                  </p>
                </details>

                <details className="bg-white rounded-lg border border-gray-200 p-4">
                  <summary className="font-medium text-gray-900 cursor-pointer">What happens when I exceed my plan limits?</summary>
                  <p className="mt-3 text-gray-600 text-sm">
                    You won&apos;t be able to add more resources (members, staff, etc.) until you upgrade your plan. Your existing data is always safe and accessible.
                  </p>
                </details>

                <details className="bg-white rounded-lg border border-gray-200 p-4">
                  <summary className="font-medium text-gray-900 cursor-pointer">Is there a free trial for paid plans?</summary>
                  <p className="mt-3 text-gray-600 text-sm">
                    The Free plan lets you try all core features with limited capacity. This way, you can evaluate the platform before committing to a paid plan.
                  </p>
                </details>

                <details className="bg-white rounded-lg border border-gray-200 p-4">
                  <summary className="font-medium text-gray-900 cursor-pointer">How do I cancel my subscription?</summary>
                  <p className="mt-3 text-gray-600 text-sm">
                    Click &quot;Manage Billing&quot; above to access the Stripe customer portal where you can cancel your subscription.
                    Your access continues until the end of the billing period.
                  </p>
                </details>
              </div>
            </div>
          </>
        )}
      </main>

      <BottomNavigation />
    </div>
  );
}
