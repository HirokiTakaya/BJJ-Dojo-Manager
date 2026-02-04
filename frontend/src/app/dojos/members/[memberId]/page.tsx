// src/app/dojos/members/[memberId]/page.tsx
import { redirect } from "next/navigation";

type SearchParams = {
  dojoId?: string | string[];
};

type PageProps = {
  params: { memberId?: string | string[] };
  searchParams: SearchParams;
};

function normalizeParam(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

export default function Page({ params, searchParams }: PageProps) {
  const memberId = normalizeParam(params?.memberId);
  const dojoId = normalizeParam(searchParams?.dojoId);

  if (!memberId || !dojoId) {
    return (
      <main style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Missing params (legacy route)</h2>
        {!memberId && <div>❌ Missing memberId（期待URL: /dojos/members/&lt;memberId&gt;?dojoId=...）</div>}
        {!dojoId && <div>❌ Missing dojoId（期待: ?dojoId=...）</div>}
        <div style={{ marginTop: 12, opacity: 0.8 }}>
          Debug params: <pre>{JSON.stringify(params, null, 2)}</pre>
          Debug searchParams: <pre>{JSON.stringify(searchParams, null, 2)}</pre>
        </div>
      </main>
    );
  }

  // ✅ 正しいルートへ寄せる
  redirect(`/dojos/${encodeURIComponent(dojoId)}/members/${encodeURIComponent(memberId)}`);
}
