// app/visitor/complete/CompleteClient.tsx
"use client";

import React, { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export default function CompleteClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("visitor.complete");

  const dojoId = useMemo(() => sp.get("dojoId") ?? "", [sp]);
  const waiverId = useMemo(() => sp.get("waiverId") ?? "", [sp]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">{t("titleEmoji")}</h1>

      <div className="text-sm text-gray-600 space-y-1">
        <p>
          {t("dojoLabel")}: <span className="font-mono">{dojoId || t("noneLabel")}</span>
        </p>
        <p>
          {t("waiverLabel")}: <span className="font-mono">{waiverId || t("noneLabel")}</span>
        </p>
      </div>

      <button
        onClick={() => router.push("/")}
        className="w-full py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition"
      >
        {t("backToHome")}
      </button>
    </div>
  );
}
