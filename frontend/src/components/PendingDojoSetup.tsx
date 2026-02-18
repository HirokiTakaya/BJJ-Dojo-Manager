// components/PendingDojoSetup.tsx
"use client";

import React from "react";
import { usePendingDojoAction } from "@/lib/usePendingDojoAction";

/**
 * ダッシュボード（/home 等）に配置するコンポーネント。
 * pendingDojoAction が残っていれば自動的に実行し、結果を表示する。
 *
 * 使い方:
 * ```tsx
 * // app/home/page.tsx 等
 * <PendingDojoSetup />
 * ```
 */
export default function PendingDojoSetup() {
  const { pending, executing, result, error } = usePendingDojoAction();

  // 何もなければ何も表示しない
  if (!pending && !executing && !result && !error) return null;

  return (
    <div className="w-full max-w-lg mx-auto mb-4">
      {/* 実行中 */}
      {executing && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>
            {pending?.type === "staff_create_dojo" && "Creating your dojo..."}
            {pending?.type === "staff_join_dojo" && "Sending join request..."}
            {pending?.type === "student_join_dojo" && "Joining gym..."}
            {!pending?.type && "Completing setup..."}
          </span>
        </div>
      )}

      {/* 成功 */}
      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✅ {result}
        </div>
      )}

      {/* エラー（手動リトライボタン付き） */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 space-y-2">
          <div>❌ {error}</div>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}