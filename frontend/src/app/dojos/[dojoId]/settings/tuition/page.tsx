// app/dojos/[dojoId]/settings/tuition/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/providers/AuthProvider";
import Navigation, { BottomNavigation } from "@/components/Navigation";
import { useDojoName } from "@/hooks/useDojoName";
import {
  createTuitionPlan,
  deactivateTuitionPlan,
  listTuitionPlans,
  listMemberTuitionStatus,
  cancelMemberTuition,
  formatTuitionAmount,
  createTuitionPromo,
  listTuitionPromos,
  deactivateTuitionPromo,
  type TuitionPlan,
  type MemberTuition,
  type TuitionStatus,
  type TuitionPromoCode,
} from "@/lib/tuition-api";

// ─────────────────────────────────────────────
// Sub components
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: TuitionStatus }) {
  const t = useTranslations("tuition.status");
  const config: Record<TuitionStatus, string> = {
    active: "bg-green-100 text-green-700",
    past_due: "bg-red-100 text-red-700",
    canceled: "bg-gray-100 text-gray-500",
    incomplete: "bg-amber-100 text-amber-700",
    none: "bg-gray-100 text-gray-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${config[status]}`}>
      {t(status)}
    </span>
  );
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────

type PlanFormState = {
  name: string;
  description: string;
  displayAmount: string; // user-entered (e.g. "120.00" or "12000")
  currency: "cad" | "jpy" | "usd";
  interval: "month" | "week" | "year";
};

const EMPTY_FORM: PlanFormState = {
  name: "",
  description: "",
  displayAmount: "",
  currency: "cad",
  interval: "month",
};

const ZERO_DECIMAL = new Set(["jpy"]);

function toSmallestUnit(display: string, currency: string): number {
  const n = parseFloat(display);
  if (isNaN(n) || n <= 0) return 0;
  return ZERO_DECIMAL.has(currency) ? Math.round(n) : Math.round(n * 100);
}

export default function TuitionSettingsPage() {
  const t = useTranslations("tuition.manage");
  const router = useRouter();
  const params = useParams<{ dojoId?: string }>();
  const dojoId = (params?.dojoId as string) ?? "";
  const { user, loading: authLoading } = useAuth();
  const { dojoName } = useDojoName(dojoId);

  const [plans, setPlans] = useState<TuitionPlan[]>([]);
  const [members, setMembers] = useState<MemberTuition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Promo codes
  const [promos, setPromos] = useState<TuitionPromoCode[]>([]);
  const [promoFormOpen, setPromoFormOpen] = useState(false);
  const [promoAmount, setPromoAmount] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoNote, setPromoNote] = useState("");
  const [promoSubmitting, setPromoSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const fetchAll = useCallback(async () => {
    if (!dojoId || !user) return;
    setLoading(true);
    setError("");
    try {
      const [p, m, pr] = await Promise.all([
        listTuitionPlans(dojoId),
        listMemberTuitionStatus(dojoId),
        listTuitionPromos(dojoId).catch(() => [] as TuitionPromoCode[]),
      ]);
      setPlans(p);
      setMembers(m);
      setPromos(pr);
    } catch (e: any) {
      setError(e?.message || t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [dojoId, user, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const planById = useMemo(() => {
    const map = new Map<string, TuitionPlan>();
    plans.forEach((p) => map.set(p.id, p));
    return map;
  }, [plans]);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active").length;
    const pastDue = members.filter((m) => m.status === "past_due").length;
    const none = members.filter((m) => m.status === "none" || m.status === "canceled").length;
    return { active, pastDue, none };
  }, [members]);

  const handleCreatePlan = async () => {
    const amount = toSmallestUnit(form.displayAmount, form.currency);
    if (!form.name.trim() || amount <= 0) {
      setError(t("errors.invalidForm"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createTuitionPlan(dojoId, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        amount,
        currency: form.currency,
        interval: form.interval,
      });
      setSuccess(t("planCreated"));
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await fetchAll();
    } catch (e: any) {
      setError(e?.message || t("errors.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (plan: TuitionPlan) => {
    if (!window.confirm(t("confirmArchive", { name: plan.name }))) return;
    try {
      await deactivateTuitionPlan(dojoId, plan.id);
      await fetchAll();
    } catch (e: any) {
      setError(e?.message || t("errors.archiveFailed"));
    }
  };

  const handleCancelMember = async (m: MemberTuition) => {
    if (!window.confirm(t("confirmCancelMember", { name: m.displayName || m.uid }))) return;
    try {
      await cancelMemberTuition(dojoId, m.uid);
      setSuccess(t("memberCanceled"));
      await fetchAll();
    } catch (e: any) {
      setError(e?.message || t("errors.cancelFailed"));
    }
  };

  // Currency used by the dojo's plans (promo discount follows it). Default CAD.
  const promoCurrency = useMemo(() => {
    return plans[0]?.currency || "cad";
  }, [plans]);

  const handleCreatePromo = async () => {
    const amountOff = toSmallestUnit(promoAmount, promoCurrency);
    if (amountOff <= 0) {
      setError(t("promo.errors.invalidAmount"));
      return;
    }
    setPromoSubmitting(true);
    setError("");
    try {
      await createTuitionPromo(dojoId, {
        amountOff,
        code: promoCode.trim() || undefined,
        note: promoNote.trim() || undefined,
        maxRedemptions: 1,
      });
      setSuccess(t("promo.created"));
      setPromoAmount("");
      setPromoCode("");
      setPromoNote("");
      setPromoFormOpen(false);
      await fetchAll();
    } catch (e: any) {
      setError(e?.message || t("promo.errors.createFailed"));
    } finally {
      setPromoSubmitting(false);
    }
  };

  const handleDeactivatePromo = async (p: TuitionPromoCode) => {
    if (!window.confirm(t("promo.confirmDeactivate", { code: p.code }))) return;
    try {
      await deactivateTuitionPromo(dojoId, p.id);
      await fetchAll();
    } catch (e: any) {
      setError(e?.message || t("promo.errors.deactivateFailed"));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-8 pb-24">
        <button
          onClick={() => router.push(`/dojos/${dojoId}/settings`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("back")}
        </button>

        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
            <p className="text-gray-500 mt-1">{dojoName}</p>
          </div>
          <button
            onClick={() => router.push(`/dojos/${dojoId}/settings/payments`)}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            {t("connectSettings")} →
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            <div className="text-xs text-gray-500 mt-1">{t("stats.paying")}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-red-600">{stats.pastDue}</div>
            <div className="text-xs text-gray-500 mt-1">{t("stats.pastDue")}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-400">{stats.none}</div>
            <div className="text-xs text-gray-500 mt-1">{t("stats.notEnrolled")}</div>
          </div>
        </div>

        {/* Plans */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t("plansTitle")}</h2>
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700"
            >
              {formOpen ? t("closeForm") : t("newPlan")}
            </button>
          </div>

          {formOpen && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("form.name")}
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t("form.namePlaceholder")}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("form.amount")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={form.displayAmount}
                      onChange={(e) => setForm({ ...form, displayAmount: e.target.value })}
                      placeholder={form.currency === "jpy" ? "12000" : "120.00"}
                      inputMode="decimal"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm"
                    />
                    <select
                      value={form.currency}
                      onChange={(e) =>
                        setForm({ ...form, currency: e.target.value as PlanFormState["currency"] })
                      }
                      className="px-2 py-2 rounded-lg border border-gray-300 text-sm"
                    >
                      <option value="cad">CAD</option>
                      <option value="jpy">JPY</option>
                      <option value="usd">USD</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("form.interval")}
                  </label>
                  <select
                    value={form.interval}
                    onChange={(e) =>
                      setForm({ ...form, interval: e.target.value as PlanFormState["interval"] })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                  >
                    <option value="month">{t("intervals.month")}</option>
                    <option value="week">{t("intervals.week")}</option>
                    <option value="year">{t("intervals.year")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("form.description")}
                  </label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={t("form.descriptionPlaceholder")}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                  />
                </div>
              </div>
              <button
                onClick={handleCreatePlan}
                disabled={submitting}
                className="mt-4 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                {submitting ? t("form.creating") : t("form.create")}
              </button>
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              {t("loading")}
            </div>
          ) : plans.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              {t("noPlans")}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {plans.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleArchive(p)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      {t("archive")}
                    </button>
                  </div>
                  <div className="mt-2 text-lg font-bold text-gray-900">
                    {formatTuitionAmount(p.amount, p.currency)}
                    <span className="text-sm font-normal text-gray-500">
                      {" / "}
                      {t(`intervals.${p.interval}`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Promo codes */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">{t("promo.title")}</h2>
            <button
              onClick={() => setPromoFormOpen((v) => !v)}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700"
            >
              {promoFormOpen ? t("promo.closeForm") : t("promo.newCode")}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">{t("promo.desc")}</p>

          {promoFormOpen && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("promo.amountLabel")}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">−</span>
                    <input
                      value={promoAmount}
                      onChange={(e) => setPromoAmount(e.target.value)}
                      placeholder="35"
                      inputMode="decimal"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900"
                    />
                    <span className="text-gray-500 text-sm uppercase">{promoCurrency}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{t("promo.amountHint")}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("promo.codeLabel")}
                  </label>
                  <input
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder={t("promo.codePlaceholder")}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900 uppercase tracking-wider"
                  />
                  <p className="text-xs text-gray-400 mt-1">{t("promo.codeHint")}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("promo.noteLabel")}
                  </label>
                  <input
                    value={promoNote}
                    onChange={(e) => setPromoNote(e.target.value)}
                    placeholder={t("promo.notePlaceholder")}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleCreatePromo}
                  disabled={promoSubmitting}
                  className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                >
                  {promoSubmitting ? t("promo.creating") : t("promo.create")}
                </button>
              </div>
            </div>
          )}

          {promos.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              {t("promo.noCodes")}
            </div>
          ) : (
            <div className="space-y-2">
              {promos.map((p) => {
                const used = p.maxRedemptions > 0 && p.timesRedeemed >= p.maxRedemptions;
                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-xl border p-4 flex items-center justify-between ${
                      p.active && !used ? "border-gray-200" : "border-gray-200 opacity-60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-gray-900 tracking-wider">{p.code}</span>
                        <span className="text-sm font-medium text-green-700">
                          −{formatTuitionAmount(p.amountOff, p.currency)}/{t("promo.perMonth")}
                        </span>
                        {(!p.active || used) && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {used ? t("promo.used") : t("promo.inactive")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {p.note ? `${p.note} · ` : ""}
                        {t("promo.redeemed", { used: p.timesRedeemed, max: p.maxRedemptions })}
                      </div>
                    </div>
                    {p.active && !used && (
                      <button
                        onClick={() => handleDeactivatePromo(p)}
                        className="text-sm text-red-600 hover:text-red-500 flex-shrink-0 ml-3"
                      >
                        {t("promo.deactivate")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Member status table */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("membersTitle")}</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">{t("table.member")}</th>
                  <th className="px-4 py-3">{t("table.plan")}</th>
                  <th className="px-4 py-3">{t("table.status")}</th>
                  <th className="px-4 py-3">{t("table.nextPayment")}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((m) => (
                  <tr key={m.uid} className={m.status === "past_due" ? "bg-red-50/50" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{m.displayName || "—"}</div>
                      <div className="text-xs text-gray-400">{m.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {m.planId ? planById.get(m.planId)?.name ?? m.planId : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                      {m.cancelAtPeriodEnd && (
                        <div className="text-xs text-amber-600 mt-0.5">{t("cancelScheduled")}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {m.periodEnd ? new Date(m.periodEnd).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(m.status === "active" || m.status === "past_due") &&
                        !m.cancelAtPeriodEnd && (
                          <button
                            onClick={() => handleCancelMember(m)}
                            className="text-xs text-gray-400 hover:text-red-500"
                          >
                            {t("cancelMember")}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      {t("noMembers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}