
// src/app/dojos/[dojoId]/members/[memberId]/page.tsx
import MemberProfileClient from "./MemberProfileClient";

type AnyParams = Record<string, string | string[] | undefined>;

function normalizeParam(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function pickParam(params: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = normalizeParam((params as any)?.[k]);
    if (val) return val;
  }
  return "";
}

type PageProps = {
  // ✅ Next.js 15+ だと params が Promise のことがある
  params: AnyParams | Promise<AnyParams>;
};

export default async function Page({ params }: PageProps) {
  // ✅ PromiseでもObjectでも両対応（awaitしてから読む）
  const resolvedParams = await Promise.resolve(params);

  // ✅ Id / ld 両対応も残しておく（フォルダ名が紛らわしくても動く）
  const dojoId = pickParam(resolvedParams as any, ["dojoId", "dojold"]);
  const memberId = pickParam(resolvedParams as any, ["memberId", "memberld"]);

  if (!dojoId || !memberId) {
    return (
      <main style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Missing params (main route)</h2>
        {!dojoId && <div>❌ Missing dojoId（期待URL: /dojos/&lt;dojoId&gt;/members/&lt;memberId&gt;）</div>}
        {!memberId && <div>❌ Missing memberId（期待URL: /dojos/&lt;dojoId&gt;/members/&lt;memberId&gt;）</div>}

        <div style={{ marginTop: 12, opacity: 0.8 }}>
          Debug params keys:
          <pre>{JSON.stringify(Object.keys(resolvedParams ?? {}), null, 2)}</pre>
          Debug params raw:
          <pre>{JSON.stringify(resolvedParams ?? {}, null, 2)}</pre>
        </div>
      </main>
    );
  }

  return <MemberProfileClient dojoId={dojoId} memberId={memberId} />;
}
