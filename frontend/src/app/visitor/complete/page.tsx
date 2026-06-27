"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  authNullable,
  dbNullable,
  firebaseEnabled,
  firebaseDisabledReason,
} from "@/firebase";

import { signInAnonymously } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";

type DojoInfo = {
  id: string;
  name: string;
  city?: string;
  address?: string;
  logoUrl?: string;
};

async function ensureGuestAuth() {
  if (!firebaseEnabled) {
    throw new Error(firebaseDisabledReason ?? "Firebase is disabled.");
  }
  if (!authNullable) {
    throw new Error("Auth is not initialized.");
  }
  if (authNullable.currentUser) return authNullable.currentUser;
  const cred = await signInAnonymously(authNullable);
  return cred.user;
}

function VisitorSelectDojoContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("visitor.selectDojo");

  const next = sp.get("next") || "/visitor/complete";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dojos, setDojos] = useState<DojoInfo[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        await ensureGuestAuth();

        const db = dbNullable;
        if (!db) throw new Error(t("errors.firestoreNotInit"));

        const q = query(collection(db, "dojos"), where("isPublic", "==", true));
        const snap = await getDocs(q);

        if (cancelled) return;

        const list: DojoInfo[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || data.displayName || data.dojoName || "Dojo",
            city: data.city,
            address: data.address || data.location,
            logoUrl: data.logoUrl || data.logo || data.imageUrl,
          };
        });

        list.sort((a, b) => a.name.localeCompare(b.name));

        setDojos(list);
      } catch (e: any) {
        setError(e?.message || t("errors.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dojos;
    return dojos.filter((d) => {
      const hay = `${d.name} ${d.city ?? ""} ${d.address ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [dojos, search]);

  const goDojo = async (dojoId: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await ensureGuestAuth();
      const qs = new URLSearchParams();
      qs.set("next", next);
      router.push(`/visitor/${encodeURIComponent(dojoId)}/waiver?${qs.toString()}`);
    } catch (e: any) {
      setError(e?.message || t("errors.continueFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <main className="max-w-xl mx-auto px-4 py-8 space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            {t("title")}
          </h1>
          <p className="text-slate-500 text-sm">
            {t("subtitle")}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex justify-center">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-500 text-sm">
            {t("noResults")}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => goDojo(d.id)}
                disabled={busy}
                className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 text-left hover:border-sky-300 hover:shadow-md transition disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {d.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.logoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">🥋</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {d.name}
                    </div>
                    <div className="text-sm text-slate-500 truncate">
                      {[d.city, d.address].filter(Boolean).join(" • ")}
                    </div>
                  </div>

                  <div className="ml-auto text-slate-400 font-semibold">→</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="text-center pt-4">
          <button
            onClick={() => router.push("/signup")}
            className="text-sm text-slate-600 hover:underline"
          >
            {t("createAccountInstead")}
          </button>
        </div>
      </main>
    </div>
  );
}

export default function VisitorSelectDojoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-600" />
        </div>
      }
    >
      <VisitorSelectDojoContent />
    </Suspense>
  );
}
