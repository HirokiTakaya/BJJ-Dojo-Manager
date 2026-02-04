/**
 * lib/api-client.ts
 * Firebase Functions / Go Cloud Run バックエンド用の汎用APIクライアント
 * 
 * 環境変数:
 * - NEXT_PUBLIC_API_URL: Cloud Functions URL (従来)
 * - NEXT_PUBLIC_GO_API_URL: Go Cloud Run URL (新規)
 * - NEXT_PUBLIC_USE_GO_API: "true" で Go API を使用
 */

import { auth } from "@/firebase";

// ============================================
// Configuration
// ============================================

const FUNCTIONS_API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const GO_API_BASE = (process.env.NEXT_PUBLIC_GO_API_URL || "").trim().replace(/\/+$/, "");
const USE_GO_API = process.env.NEXT_PUBLIC_USE_GO_API === "true";

// 使用するAPI Base URLを決定
const API_BASE = USE_GO_API && GO_API_BASE ? GO_API_BASE : FUNCTIONS_API_BASE;

if (process.env.NODE_ENV === "development") {
  console.log("[api-client] Configuration:", {
    FUNCTIONS_API_BASE,
    GO_API_BASE,
    USE_GO_API,
    API_BASE: API_BASE || "(empty)",
  });
}

// ============================================
// Types
// ============================================

export type ApiError = { status: number; message: string; code?: string };
export type ApiRequestOptions = { forceRefreshToken?: boolean; timeout?: number };

// ============================================
// Helpers
// ============================================

function assertApiBase() {
  if (!API_BASE) {
    throw new Error(
      "API URL is not set. Configure NEXT_PUBLIC_API_URL or NEXT_PUBLIC_GO_API_URL in .env.local"
    );
  }
}

export async function getIdToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  const result = await user.getIdTokenResult(forceRefresh);
  if (process.env.NODE_ENV === "development") {
    console.log("[auth] uid:", user.uid, "claims:", result.claims);
  }
  return result.token;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid || null;
}

async function readErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const json = await res.json();
      return json?.message || json?.error || JSON.stringify(json) || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
  return (await res.text().catch(() => "")) || `HTTP ${res.status}`;
}

function normalizeHeaders(h?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
    return out;
  }
  return { ...(h as Record<string, string>) };
}

// ============================================
// Core API Functions
// ============================================

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<T> {
  assertApiBase();
  const token = await getIdToken(!!options.forceRefreshToken);
  const headers: Record<string, string> = {
    ...normalizeHeaders(init.headers),
    Authorization: `Bearer ${token}`,
  };
  if (init.body && typeof init.body === "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

  // パスの正規化
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${normalizedPath}`;

  if (process.env.NODE_ENV === "development") {
    console.log("[api-client] fetch:", init.method || "GET", url);
  }

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const msg = await readErrorMessage(res);
      console.error(`[API Error] ${res.status} ${path}:`, msg);
      throw { status: res.status, message: msg } as ApiError;
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") throw { status: 408, message: "Request timeout" } as ApiError;
    throw e;
  }
}

export async function apiGet<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { method: "GET" }, options);
}

export async function apiPost<T = any>(
  path: string,
  body?: any,
  options?: ApiRequestOptions
): Promise<T> {
  return apiFetch<T>(
    path,
    { method: "POST", body: body ? JSON.stringify(body) : undefined },
    { forceRefreshToken: true, ...options }
  );
}

export async function apiPut<T = any>(
  path: string,
  body?: any,
  options?: ApiRequestOptions
): Promise<T> {
  return apiFetch<T>(
    path,
    { method: "PUT", body: body ? JSON.stringify(body) : undefined },
    { forceRefreshToken: true, ...options }
  );
}

export async function apiDelete<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" }, { forceRefreshToken: true, ...options });
}

export function buildUrl(
  basePath: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  if (!params) return basePath;
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) searchParams.append(key, String(value));
  }
  const qs = searchParams.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "status" in e && "message" in e;
}

export function getErrorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "An unexpected error occurred";
}

// ============================================
// Exports for configuration check
// ============================================

export function isUsingGoApi(): boolean {
  return USE_GO_API && !!GO_API_BASE;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}
