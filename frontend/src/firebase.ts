// src/firebase.ts
'use client';

import {
  initializeApp,
  getApps,
  getApp,
  setLogLevel,
  type FirebaseOptions,
  type FirebaseApp,
} from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  type Auth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from 'firebase/functions';
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
  ref as storageRef,
  listAll as listAllSdk,
  getDownloadURL,
  getMetadata,
} from 'firebase/storage';
import type { AppCheck } from 'firebase/app-check';

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

type FirebaseLogLevel = 'debug' | 'verbose' | 'info' | 'warn' | 'error';

const DEV = process.env.NODE_ENV !== 'production';
const isBrowser = typeof window !== 'undefined';

const cleanStr = (v?: string | null, fallback = '') => {
  const s = String(v ?? fallback).trim();
  const unquoted =
    (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
      ? s.slice(1, -1).trim()
      : s;
  return unquoted || '';
};

const cleanBool = (v?: string | null, fallback = false) => {
  const s = cleanStr(v, '').toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
};

/* ─────────────────────────────────────────────────────────────
   ✅ IMPORTANT: Next.js client env must be statically referenced
   ───────────────────────────────────────────────────────────── */

const USE_EMU = cleanBool(process.env.NEXT_PUBLIC_USE_EMU, false);
const EMU_AUTO_ANON = USE_EMU && cleanBool(process.env.NEXT_PUBLIC_EMU_AUTO_ANON, false);

const ENABLE_APPCHECK = cleanBool(process.env.NEXT_PUBLIC_ENABLE_APPCHECK, false);
const AUTH_BYPASS_RECAPTCHA_RAW = cleanBool(process.env.NEXT_PUBLIC_AUTH_BYPASS_RECAPTCHA, false);
const USE_TEST_PHONE_RAW = cleanStr(process.env.NEXT_PUBLIC_USE_TEST_PHONE, '') === '1';
const SHOULD_ENABLE_TEST_BYPASS = (DEV || USE_EMU) && (AUTH_BYPASS_RECAPTCHA_RAW || USE_TEST_PHONE_RAW);

/* ─────────────────────────────────────────────────────────────
   Project config (dojo-manager defaults)
   ───────────────────────────────────────────────────────────── */

// API KEY（どれを採用したか追跡できるようにする）
const API_KEY_WEB = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_API_KEY_WEB, '');
const API_KEY_LEGACY = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_API_KEY, '');
const API_KEY_WEB2 = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_API_KEY_WEB, ''); // 再参照（Next が静的参照を好むため）
const API_KEY = cleanStr(API_KEY_WEB || API_KEY_WEB2 || API_KEY_LEGACY, '');

const API_KEY_SOURCE =
  API_KEY_WEB ? 'NEXT_PUBLIC_FIREBASE_API_KEY_WEB'
  : API_KEY_WEB2 ? 'NEXT_PUBLIC_FIREBASE_API_KEY_WEB'
  : API_KEY_LEGACY ? 'NEXT_PUBLIC_FIREBASE_API_KEY'
  : 'missing';

const PROJECT_ID =
  cleanStr(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'dojo-manager-94b96') || 'dojo-manager-94b96';

const AUTH_DOMAIN = cleanStr(
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  `${PROJECT_ID}.firebaseapp.com`
);

// ✅ Storage bucket は通常 `${projectId}.appspot.com`
// env が `.firebasestorage.app` のホストだった場合でも、安全に bucketName を作る
const RAW_BUCKET = cleanStr(
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  `${PROJECT_ID}.appspot.com`
);

const STORAGE_LIST_FALLBACK_FN = cleanStr(process.env.NEXT_PUBLIC_STORAGE_LIST_FALLBACK_FN, '');

/** 入力（envやURL/gs://）から「ホスト名だけ」を抽出 */
function extractBucketHost(input?: string, fallbackProjectId?: string) {
  let s = (input ?? '').trim();
  if (!s) return `${fallbackProjectId}.appspot.com`;
  s = s.replace(/^gs:\/\//i, '');
  const m = s.match(/^https?:\/\/([^/]+)/i);
  if (m) s = m[1];
  return s.split('/')[0].split('?')[0];
}

/**
 * ✅ bucket を安全に決める
 * - bucketName: Firebase/SDK が期待する “バケット名” 例: xxxx.appspot.com
 * - downloadHost: ダウンロードURL側のホスト（firebasestorage.app を使いたい場合はここ）
 */
function deriveBucket(input: string | undefined, projectId: string) {
  const host = extractBucketHost(input, projectId);

  // host が firebasestorage.app の場合、bucketName は appspot.com に寄せるのが安全
  // （カスタムバケットを使ってる人は env を正しい bucketName にしてね）
  const base = host
    .replace(/\.appspot\.com$/i, '')
    .replace(/\.firebasestorage\.app$/i, '');

  const bucketName =
    host.endsWith('.appspot.com') ? host
    : host.endsWith('.firebasestorage.app') ? `${base}.appspot.com`
    : host; // custom

  const downloadHost =
    host.endsWith('.firebasestorage.app') ? host
    : `${base}.firebasestorage.app`;

  return { bucketName, downloadHost } as const;
}

const { bucketName: BUCKET_NAME, downloadHost: DOWNLOAD_HOST } = deriveBucket(RAW_BUCKET, PROJECT_ID);

const BUCKET_GS_URI = `gs://${BUCKET_NAME}`;

export const storageBucketId = BUCKET_NAME;
export const storageBucketDownloadHost = DOWNLOAD_HOST;
export const storageBucketGsUri = BUCKET_GS_URI;
export const storageRestBase = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}`;

/* ─────────────────────────────────────────────────────────────
   Firebase enable/disable
   ───────────────────────────────────────────────────────────── */

export const firebaseDisabledReason: string | null = (() => {
  if (!API_KEY) return 'Missing API key. Set NEXT_PUBLIC_FIREBASE_API_KEY_WEB in .env.local';
  if (!/^AIza[0-9A-Za-z\-_]{20,}$/.test(API_KEY)) {
    return `API key looks invalid: "${API_KEY.slice(0, 12)}..." (check quotes/spaces in .env.local)`;
  }
  if (!PROJECT_ID) return 'Missing PROJECT_ID. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local';
  return null;
})();

export const firebaseEnabled = firebaseDisabledReason == null;

/* ─────────────────────────────────────────────────────────────
   app init
   ───────────────────────────────────────────────────────────── */

const messagingSenderId = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, '');
const appId = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_APP_ID, '');
const measurementId = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, '');

let app: FirebaseApp | null = null;

if (firebaseEnabled) {
  const firebaseConfig: FirebaseOptions = {
    apiKey: API_KEY,
    authDomain: AUTH_DOMAIN,
    projectId: PROJECT_ID,
    storageBucket: BUCKET_NAME,
    ...(messagingSenderId ? { messagingSenderId } : {}),
    ...(appId ? { appId } : {}),
    ...(measurementId ? { measurementId } : {}),
  };

  app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  if (isBrowser) {
    // ✅ どの env を採用したか・bucket の扱いを明確化
    console.info('[firebase] enabled config', {
      projectId: PROJECT_ID,
      authDomain: AUTH_DOMAIN,
      bucketName: BUCKET_NAME,
      downloadHost: DOWNLOAD_HOST,
      apiKeySource: API_KEY_SOURCE,
      apiKeyHead: API_KEY.slice(0, 8),
      useEmu: USE_EMU,
    });

    // env が変な時に気づけるように追加警告
    if (!API_KEY_WEB && !API_KEY_LEGACY) {
      console.warn('[firebase] API KEY env not found. Check .env.local + Next root (workspace root warning).');
    }
    if (RAW_BUCKET.includes('.firebasestorage.app')) {
      console.warn('[firebase] storage bucket env looks like a download host (.firebasestorage.app). Using appspot.com as bucketName:', BUCKET_NAME);
    }
  }

  // ✅（デバッグ用）window から設定確認できるようにする
  if (isBrowser) {
    (globalThis as any).__FIREBASE_ENV__ = {
      PROJECT_ID,
      AUTH_DOMAIN,
      BUCKET_NAME,
      DOWNLOAD_HOST,
      API_KEY_SOURCE,
      USE_EMU,
    };
  }
} else {
  if (isBrowser) {
    console.warn('[firebase] disabled:', firebaseDisabledReason, {
      apiKeySource: API_KEY_SOURCE,
      projectId: PROJECT_ID,
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   AppCheck (optional)
   ───────────────────────────────────────────────────────────── */

let appCheckInstance: AppCheck | null = null;

function initAppCheck() {
  if (!firebaseEnabled) return;
  if (!isBrowser) return;
  if (!ENABLE_APPCHECK) return;
  if (!app) return;

  const SITE_KEY = cleanStr(process.env.NEXT_PUBLIC_APPCHECK_SITE_KEY, '');
  const PROVIDER =
    (cleanStr(process.env.NEXT_PUBLIC_APPCHECK_PROVIDER, 'v3') as 'v3' | 'enterprise') ?? 'v3';

  if (DEV || cleanBool(process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN, false) || USE_EMU) {
    (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  if (!SITE_KEY) return;

  import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider }) => {
      const provider =
        PROVIDER === 'enterprise'
          ? new ReCaptchaEnterpriseProvider(SITE_KEY)
          : new ReCaptchaV3Provider(SITE_KEY);

      appCheckInstance = initializeAppCheck(app!, { provider, isTokenAutoRefreshEnabled: true });
    })
    .catch(() => {});
}
initAppCheck();

/* ─────────────────────────────────────────────────────────────
   log level
   ───────────────────────────────────────────────────────────── */

const RAW_LOG_LEVEL = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_LOG_LEVEL, '');
const ALLOWED: readonly FirebaseLogLevel[] = ['debug', 'verbose', 'info', 'warn', 'error'] as const;

// ✅ dev は warn をデフォルト、prod は error をデフォルト
const DEFAULT_LEVEL: FirebaseLogLevel = DEV ? 'warn' : 'error';

const LOG_LEVEL: FirebaseLogLevel =
  (ALLOWED as readonly string[]).includes(RAW_LOG_LEVEL as any)
    ? (RAW_LOG_LEVEL as FirebaseLogLevel)
    : DEFAULT_LEVEL;

setLogLevel(LOG_LEVEL);

/* ─────────────────────────────────────────────────────────────
   Services (nullable + backward compatible exports)
   ───────────────────────────────────────────────────────────── */

let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _functions: Functions | null = null;
let _storage: FirebaseStorage | null = null;

const FUNCTIONS_REGION = cleanStr(process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION, 'us-central1');
const FUNCTIONS_BASE = cleanStr(process.env.NEXT_PUBLIC_FUNCTION_BASE, '');

if (firebaseEnabled && app) {
  _auth = getAuth(app);
  _auth.useDeviceLanguage();

  // ✅ デバッグ：Auth の変化を dev だけ出す（問題切り分け）
  if (isBrowser && DEV) {
    onAuthStateChanged(_auth, (u) => {
      console.info('[firebase][auth] state', u ? { uid: u.uid, email: u.email } : null);
    });
  }

  _db = getFirestore(app);

  _functions =
    FUNCTIONS_BASE && /^https?:\/\//i.test(FUNCTIONS_BASE)
      ? getFunctions(app, FUNCTIONS_BASE)
      : getFunctions(app, FUNCTIONS_REGION);

  // ✅ getStorage は gs://bucketName が安全
  _storage = getStorage(app, BUCKET_GS_URI);
}

// ✅ safe nullable exports
export const authNullable = _auth;
export const dbNullable = _db;
export const functionsNullable = _functions;
export const storageNullable = _storage;

// ✅ backward compatible exports (types stay non-null)
export const auth: Auth = (_auth as unknown) as Auth;
export const db: Firestore = (_db as unknown) as Firestore;
export const functions: Functions = (_functions as unknown) as Functions;
export const storage: FirebaseStorage = (_storage as unknown) as FirebaseStorage;

export const callable = <T = any, R = any>(name: string) => {
  if (!_functions) throw new Error(`[firebase] functions unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  return httpsCallable<T, R>(_functions, name);
};

/* ─────────────────────────────────────────────────────────────
   Emulators (browser only)
   ───────────────────────────────────────────────────────────── */

if (firebaseEnabled && USE_EMU && isBrowser && _auth && _db && _functions && _storage) {
  const USE_AUTH_EMU = cleanStr(process.env.NEXT_PUBLIC_USE_AUTH_EMU, 'true') === 'true';
  if (USE_AUTH_EMU) connectAuthEmulator(_auth, 'http://localhost:9099', { disableWarnings: true });

  connectFirestoreEmulator(_db, 'localhost', 8080);
  connectFunctionsEmulator(_functions, 'localhost', 5001);

  const STORAGE_EMU_HOST = cleanStr(process.env.NEXT_PUBLIC_STORAGE_EMU_HOST, 'localhost');
  connectStorageEmulator(_storage, STORAGE_EMU_HOST, 9199);

  if (USE_AUTH_EMU && EMU_AUTO_ANON) {
    onAuthStateChanged(_auth, async (u) => {
      if (!u) await signInAnonymously(_auth!).catch(() => undefined);
    });
  }

  if (isBrowser) {
    console.info('[firebase] emulators connected', {
      auth: USE_AUTH_EMU ? 'http://localhost:9099' : 'disabled',
      firestore: 'localhost:8080',
      functions: 'localhost:5001',
      storage: `${cleanStr(process.env.NEXT_PUBLIC_STORAGE_EMU_HOST, 'localhost')}:9199`,
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   helpers
   ───────────────────────────────────────────────────────────── */

export function buildFunctionUrl(name: string): string {
  if (!firebaseEnabled) throw new Error(`[firebase] buildFunctionUrl unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  const clean = name.replace(/^\//, '');
  if (USE_EMU) return `http://localhost:5001/${PROJECT_ID}/${FUNCTIONS_REGION}/${clean}`;
  if (FUNCTIONS_BASE && /^https?:\/\//i.test(FUNCTIONS_BASE)) return `${FUNCTIONS_BASE.replace(/\/+$/, '')}/${clean}`;
  return `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net/${clean}`;
}

function normalizePath(p: string) {
  return (p || '').replace(/^\/+/, '');
}

export function buildStorageRef(path: string) {
  if (!_storage) throw new Error(`[firebase] storage unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  return storageRef(_storage, normalizePath(path));
}

export async function getFileUrl(path: string): Promise<string> {
  if (!_storage) throw new Error(`[firebase] storage unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  return getDownloadURL(storageRef(_storage, normalizePath(path)));
}

export async function getFileMetadata(path: string) {
  if (!_storage) throw new Error(`[firebase] storage unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  return getMetadata(storageRef(_storage, normalizePath(path)));
}

export async function listAllCompat(prefixOrRef: string | ReturnType<typeof storageRef>) {
  if (!_storage) throw new Error(`[firebase] storage unavailable: ${firebaseDisabledReason ?? 'disabled'}`);
  const r = typeof prefixOrRef === 'string' ? storageRef(_storage, normalizePath(prefixOrRef)) : prefixOrRef;
  return listAllSdk(r);
}

/** ✅ waitForUser を復活（赤線対策） */
export async function waitForUser(timeoutMs = 5000): Promise<User | null> {
  if (!_auth) return null;
  if (_auth.currentUser) return _auth.currentUser;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(_auth.currentUser ?? null);
    }, timeoutMs);

    const unsub = onAuthStateChanged(_auth!, (u) => {
      clearTimeout(timer);
      unsub();
      resolve(u ?? null);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   ENV export / default app
   ───────────────────────────────────────────────────────────── */

export const ENV = {
  DEV,
  USE_EMU,
  USE_TEST_PHONE_RAW,
  AUTH_BYPASS_RECAPTCHA_RAW,
  SHOULD_ENABLE_TEST_BYPASS,
  FUNCTIONS_REGION,
  FUNCTIONS_BASE: FUNCTIONS_BASE || null,
  LOG_LEVEL,
  EMU_AUTO_ANON,
  IS_NATIVE: false,
  STORAGE_BUCKET: BUCKET_NAME,
  STORAGE_DOWNLOAD_HOST: DOWNLOAD_HOST,
  ENABLE_APPCHECK,
  STORAGE_LIST_FALLBACK_FN,
  firebaseEnabled,
  firebaseDisabledReason,
  API_KEY_SOURCE,
  PROJECT_ID,
  AUTH_DOMAIN,
};

export const firebaseApp = app;
export default app;
