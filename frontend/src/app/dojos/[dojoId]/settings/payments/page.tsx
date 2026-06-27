// app/dojos/[dojoId]/settings/payments/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";
import {
  getConnectStatus,
  startConnectOnboarding,
  type ConnectStatus,
} from "@/lib/tuition-api";

export default function PaymentsSettingsPage() {
  const t = useTranslations("tuition.payments");
  const router = useRouter();
  const params = useParams<{ dojoId?: string }>();
  const searchParams = useSearchParams();
  const dojoId = (params?.dojoId as string) ?? "";
  const { user, loading: authLoading } = useAuth();
  const { dojoName } = useDojoName(dojoId);

  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [country, setCountry] = useState<"CA" | "JP" | "US">("CA");

  const justOnboarded = searchParams?.get("onboarded") === "1";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const fetchStatus = useCallback(async () => {
    if (!dojoId || !user) return;
    setLoading(true);
    setError("");
    try {
      const st = await getConnectStatus(dojoId);
      setStatus(st);
    } catch (e: any) {
      setError(e?.message || t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [dojoId, user, t]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleOnboard = async () => {
    setSubmitting(true);
    setError("");
    try {
      const { url } = await startConnectOnboarding(dojoId, { country });
      window.location.href = url;
    } catch (e: any) {
      setError(e?.message || t("errors.onboardFailed"));
      setSubmitting(false);
    }
  };

  const isActive = status?.status === "active";
  const isPending = status?.status === "pending";

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <button
          onClick={() => router.push(`/dojos/${dojoId}/settings`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("back")}
        </button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <p className="text-gray-500 mt-1">
            {dojoName ? `${dojoName} — ` : ""}
            {t("subtitle")}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {justOnboarded && isActive && (
          <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            {t("onboardedSuccess")}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            {t("loading")}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            {/* Status badge */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("statusTitle")}</h2>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  isActive
                    ? "bg-green-100 text-green-700"
                    : isPending
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {isActive ? t("status.active") : isPending ? t("status.pending") : t("status.none")}
              </span>
            </div>

            {isActive ? (
              <>
                <ul className="space-y-2 text-sm text-gray-600 mb-6">
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span> {t("checks.charges")}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={status?.payoutsEnabled ? "text-green-500" : "text-amber-500"}>
                      {status?.payoutsEnabled ? "✓" : "…"}
                    </span>
                    {t("checks.payouts")}
                  </li>
                </ul>
                <div className="flex gap-3">
                  <button
                    onClick={() => router.push(`/dojos/${dojoId}/settings/tuition`)}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700"
                  >
                    {t("managePlans")}
                  </button>
                  <button
                    onClick={handleOnboard}
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t("updateAccount")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">{t("explainer")}</p>

                {!isPending && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("countryLabel")}
                    </label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value as "CA" | "JP" | "US")}
                      className="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-300 text-sm"
                    >
                      <option value="CA">{t("countries.CA")}</option>
                      <option value="JP">{t("countries.JP")}</option>
                      <option value="US">{t("countries.US")}</option>
                    </select>
                  </div>
                )}

                <button
                  onClick={handleOnboard}
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                >
                  {submitting
                    ? t("redirecting")
                    : isPending
                    ? t("continueOnboarding")
                    : t("startOnboarding")}
                </button>

                <p className="text-xs text-gray-400 mt-4">{t("stripeNote")}</p>
              </>
            )}
          </div>
        )}
      </main>
      <BottomNavigation />
    </div>
  );
}
