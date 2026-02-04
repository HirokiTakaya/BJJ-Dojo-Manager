import { getAuth } from "firebase/auth";

/**
 * Go API を叩く共通関数
 * - Authorization: Bearer <Firebase ID Token> を付ける
 * - 本番は /api に統一（rewrites で Cloud Run に流す）想定
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: any } = {}
): Promise<T> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();

  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const body =
    init.json !== undefined ? JSON.stringify(init.json) : init.body;

  const res = await fetch(path, {
    ...init,
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}