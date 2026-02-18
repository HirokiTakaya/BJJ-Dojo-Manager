
import MembersClient from "./MembersClient";

type AnyParams = Record<string, string | string[] | undefined>;

function normalizeParam(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

export default async function Page({ params }: { params: AnyParams | Promise<AnyParams> }) {
  const resolvedParams = await Promise.resolve(params);

  const dojoId =
    normalizeParam((resolvedParams as any).dojoId) ||
    normalizeParam((resolvedParams as any).dojold) || // 保険（不要なら消してOK）
    "";

  return <MembersClient dojoId={dojoId} />;
}
