// app/visitor/complete/CompleteClient.tsx
"use client";

import React, { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CompleteClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // クエリ例: /visitor/complete?dojoId=xxx&waiverId=yyy
  const dojoId = useMemo(() => sp.get("dojoId") ?? "", [sp]);
  const waiverId = useMemo(() => sp.get("waiverId") ?? "", [sp]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">✅ Completed</h1>

      <div className="text-sm text-gray-600 space-y-1">
        <p>
          Dojo: <span className="font-mono">{dojoId || "(none)"}</span>
        </p>
        <p>
          Waiver: <span className="font-mono">{waiverId || "(none)"}</span>
        </p>
      </div>

      <button
        onClick={() => router.push("/")}
        className="w-full py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition"
      >
        Back to Home
      </button>
    </div>
  );
}
