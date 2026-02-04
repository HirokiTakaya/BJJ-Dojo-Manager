import { Suspense } from "react";
import ProfileClient from "./ProfileClient";

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <div className="text-slate-900 text-lg font-semibold">Loading…</div>
            <div className="mt-1 text-sm text-slate-500">Fetching your profile</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ProfileClient />
    </Suspense>
  );
}