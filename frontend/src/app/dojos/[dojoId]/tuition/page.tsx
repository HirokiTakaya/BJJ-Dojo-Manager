// app/dojos/[dojoId]/tuition/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import { db } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";
import {
  listTuitionPlans,
  startTuitionCheckout,
  openTuitionPortal,
  formatTuitionAmount,
  type TuitionPlan,
  type TuitionStatus,
} from "@/lib/tuition-api";

type MyTuition = {
  status: TuitionStatus;
  planId?: string;
  periodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

export default function MemberTuitionPage() {
  const t = useTranslations("tuition.member");
  const router = useRouter();
  const params = useParams<{ dojoId?: string }>();
  const searchParams = useSearchParams();
  const dojoId = (params?.dojoId as string) ?? "";
  const { user, loading: authLoading } = useAuth();
  const { dojoName } = useDojoName(dojoId);

  const [plans, setPlans] = useState<TuitionPlan[]>([]);
  const [mine, setMine] = useState<MyTuition>({ status: "none" });
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState<string | null>(null); // planId or "portal"
  const [error, setError] = useState("");

  const justSucceeded = searchParams?.get("success") === "1";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const fetchAll = useCallback(async () => {
    if (!dojoId || !user) return;
    setLoading(true);
    setError("");
    try {
      // 自分のmemberドキュメントを直接読む(既存ページと同じFirestore直読みパターン)
      const [planList, memberSnap] = await Promise.all([
        listTuitionPlans(dojoId),
        getDoc(doc(db, "dojos", dojoId, "members", user.uid)),
      ]);
      setPlans(planList);

      const data = memberSnap.exists() ? memberSnap.data() : null;
      setMine({
        status: (data?.tuitionStatus as TuitionStatus) || "none",
        planId: data?.tuitionPlanId,
        periodEnd: data?.tuitionPeriodEnd?.toDate?.() ?? null,
        cancelAtPeriodEnd: !!data?.tuitionCancelAtPeriodEnd,
      });
    } catch (e: any) {
      setError(e?.message || t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [dojoId, user, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Checkout完了直後はwebhook反映に数秒かかることがあるので一度リロード
  useEffect(() => {
    if (justSucceeded && mine.status === "none" && !loading) {
      const timer = setTimeout(fetchAll, 3000);
      return () => clearTimeout(timer);
    }
  }, [justSucceeded, mine.status, loading, fetchAll]);

  const handleSubscribe = async (plan: TuitionPlan) => {
    setRedirecting(plan.id);
    setError("");
    try {
      const { url } = await startTuitionCheckout(dojoId, plan.id);
      window.location.href = url;
    } catch (e: any) {
      setError(e?.message || t("errors.checkoutFailed"));
      setRedirecting(null);
    }
  };

  const handlePortal = async () => {
    setRedirecting("portal");
    setError("");
    try {
      const { url } = await openTuitionPortal(dojoId);
      window.location.href = url;
    } catch (e: any) {
      setError(e?.message || t("errors.portalFailed"));
      setRedirecting(null);
    }
  };

  const hasSubscription = mine.status === "active" || mine.status === "past_due";
  const myPlan = plans.find((p) => p.id === mine.planId);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <p className="text-gray-500 mt-1">{dojoName}</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {justSucceeded && (
          <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            {t("checkoutSuccess")}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            {t("loading")}
          </div>
        ) : hasSubscription ? (
          /* ─── 加入済み: ステータスカード ─── */
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t("currentPlan")}</h2>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  mine.status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {mine.status === "active" ? t("statusActive") : t("statusPastDue")}
              </span>
            </div>

            {myPlan && (
              <div className="mb-4">
                <div className="font-semibold text-gray-900">{myPlan.name}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">
                  {formatTuitionAmount(myPlan.amount, myPlan.currency)}
                  <span className="text-sm font-normal text-gray-500">
                    {" / "}
                    {t(`intervals.${myPlan.interval}`)}
                  </span>
                </div>
              </div>
            )}

            {mine.periodEnd && (
              <p className="text-sm text-gray-600 mb-1">
                {mine.cancelAtPeriodEnd
                  ? t("endsOn", { date: mine.periodEnd.toLocaleDateString() })
                  : t("renewsOn", { date: mine.periodEnd.toLocaleDateString() })}
              </p>
            )}

            {mine.status === "past_due" && (
              <p className="text-sm text-red-600 mb-4">{t("pastDueNotice")}</p>
            )}

            <button
              onClick={handlePortal}
              disabled={redirecting === "portal"}
              className="mt-3 px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              {redirecting === "portal" ? t("redirecting") : t("manageBilling")}
            </button>
            <p className="text-xs text-gray-400 mt-3">{t("portalHint")}</p>
          </div>
        ) : (
          /* ─── 未加入: プラン選択 ─── */
          <>
            {plans.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
                {t("noPlans")}
              </div>
            ) : (
              <div className="space-y-3">
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="font-semibold text-gray-900">{p.name}</div>
                      {p.description && (
                        <div className="text-sm text-gray-500 mt-0.5">{p.description}</div>
                      )}
                      <div className="text-xl font-bold text-gray-900 mt-1">
                        {formatTuitionAmount(p.amount, p.currency)}
                        <span className="text-sm font-normal text-gray-500">
                          {" / "}
                          {t(`intervals.${p.interval}`)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSubscribe(p)}
                      disabled={redirecting !== null}
                      className="shrink-0 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {redirecting === p.id ? t("redirecting") : t("subscribe")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {mine.status === "canceled" && (
              <button
                onClick={handlePortal}
                disabled={redirecting === "portal"}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
              >
                {t("viewPastInvoices")}
              </button>
            )}
          </>
        )}
      </main>
      <BottomNavigation />
    </div>
  );
}
