
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/providers/AuthProvider';
import { db } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useDojoName } from '@/hooks/useDojoName';
import Navigation, { BottomNavigation } from '@/components/Navigation';

import { asDate, computeUiStatus, subscribeNoticesForMember } from '@/lib/notices';
import type { NoticeRow } from '@/lib/noticesTypes';
import { NoticeListItem } from '@/components/notices/NoticeListItem';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

type UserDoc = {
  dojoId?: string | null;
  staffProfile?: { dojoId?: string | null };
  studentProfile?: { dojoId?: string | null };
};

function pickDojoId(u: UserDoc | null): string | null {
  return u?.dojoId || u?.staffProfile?.dojoId || u?.studentProfile?.dojoId || null;
}

function getParamStr(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function resolveNoticeId(n: NoticeRow): string {
  const maybe = (n as any)?.noticeId;
  return typeof maybe === 'string' && maybe.length > 0 ? maybe : n.id;
}

function isPermissionDenied(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return code.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function InboxPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const t = useTranslations('notices');

  const dojoIdParam = useMemo(() => getParamStr((params as any)?.dojoId), [params]);

  // Resolve dojoId from user doc if not in URL
  const [resolvedDojoId, setResolvedDojoId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!uid || dojoIdParam) { setResolving(false); return; }
    let cancelled = false;
    setResolving(true);

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!cancelled && snap.exists()) {
          setResolvedDojoId(pickDojoId(snap.data() as UserDoc));
        }
      } catch {} finally {
        if (!cancelled) setResolving(false);
      }
    })();

    return () => { cancelled = true; };
  }, [uid, dojoIdParam]);

  const dojoId = dojoIdParam || resolvedDojoId || '';
  const { dojoName } = useDojoName(dojoId);

  // Access check (simplified)
  const [accessOk, setAccessOk] = useState(false);
  const [accessChecking, setAccessChecking] = useState(false);

  useEffect(() => {
    if (!uid || !dojoId) { setAccessOk(false); setAccessChecking(false); return; }
    let cancelled = false;
    setAccessChecking(true);

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'dojos', dojoId, 'members', uid));
        if (!cancelled) setAccessOk(snap.exists());
      } catch {
        if (!cancelled) setAccessOk(false);
      } finally {
        if (!cancelled) setAccessChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, [uid, dojoId]);

  // Subscribe to notices
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid || !dojoId || accessChecking || !accessOk) {
      setLoading(!accessChecking && !!dojoId);
      setRows([]);
      return;
    }

    setLoading(true);
    setError('');

    const unsub = subscribeNoticesForMember(
      dojoId, uid,
      (r) => { setRows(r); setLoading(false); },
      () => { setRows([]); setLoading(false); setError(t('couldNotLoad')); }
    );

    return unsub;
  }, [dojoId, uid, accessChecking, accessOk, t]);

  // Filters
  const [tab, setTab] = useState<'all' | 'notice' | 'memo'>('all');
  const [searchText, setSearchText] = useState('');

  const filtered = useMemo(() => {
    let r = rows.slice();
    if (tab !== 'all') r = r.filter((n) => n.type === tab);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      r = r.filter((n) => [n.title, n.body ?? '', n.type].join(' ').toLowerCase().includes(q));
    }
    return r;
  }, [rows, tab, searchText]);

  const items = useMemo(() => {
    return filtered.map((n) => {
      const s = asDate(n.startTime);
      const e = asDate(n.endTime);
      return {
        id: n.id,
        noticeId: resolveNoticeId(n),
        title: n.title,
        left: n.type === 'memo' ? t('typeMemo') : t('typeNotice'),
        dateText: `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
        uiStatus: computeUiStatus(n),
      };
    });
  }, [filtered, t]);

  // Open detail (with permission check)
  const openDetail = useCallback(async (noticeId: string) => {
    if (!dojoId) return;
    setError('');

    try {
      await getDoc(doc(db, 'dojos', dojoId, 'notices', noticeId));
      router.push(`/dojos/${dojoId}/notices/${noticeId}`);
    } catch (e: any) {
      if (isPermissionDenied(e)) {
        // Try inbox fallback route anyway — detail page handles it
        router.push(`/dojos/${dojoId}/notices/${noticeId}`);
      } else {
        setError(t('couldNotOpen'));
      }
    }
  }, [dojoId, router, t]);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (!uid) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-gray-500">
            {t('pleaseSignIn')}
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  const isLoading = loading || resolving || accessChecking;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
              <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
              <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            {(['all', 'notice', 'memo'] as const).map((tabKey) => {
              const labels: Record<string, string> = {
                all: t('tabAll'),
                notice: t('tabNotices'),
                memo: t('tabMemos'),
              };
              return (
                <button key={tabKey} onClick={() => setTab(tabKey)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                    tab === tabKey ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  {labels[tabKey]}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="mt-3">
            <input
              type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Error */}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

        {/* No dojo */}
        {!dojoId && !resolving && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
            {t('noDojoFound')}
          </div>
        )}

        {/* No access */}
        {dojoId && !accessChecking && !accessOk && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
            {t('noAccess')}
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="text-3xl mb-2">📢</div>
            <p className="text-gray-500">{t('empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <NoticeListItem
                key={it.id}
                titleLeft={it.left}
                titleMain={it.title}
                dateText={it.dateText}
                status={it.uiStatus}
                onClick={() => openDetail(it.noticeId)}
              />
            ))}
          </div>
        )}
      </main>

      <BottomNavigation />
    </div>
  );
}