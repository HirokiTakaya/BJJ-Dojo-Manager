
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '@/providers/AuthProvider';
import { db } from '@/firebase';
import { useDojoName } from '@/hooks/useDojoName';
import Navigation, { BottomNavigation } from '@/components/Navigation';

import { getNotice, asDate, computeUiStatus } from '@/lib/notices';
import { StatusBadge } from '@/components/notices/StatusBadge';

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

const formatBytes = (n?: number): string => {
  if (n === undefined || n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const getParamAsString = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
};

const isPermissionDenied = (err: unknown): boolean => {
  const code = String((err as any)?.code ?? '');
  const msg = String((err as any)?.message ?? '');
  return code.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
};

const TYPE_LABELS = { memo: 'Gym Update', notice: 'Announcement' } as const;
const typeLabel = (t?: string): string => TYPE_LABELS[t as keyof typeof TYPE_LABELS] ?? 'Announcement';

type InboxNotice = {
  dojoId?: string;
  noticeId?: string;
  type?: string;
  title?: string;
  status?: string;
  startTime?: unknown;
  endTime?: unknown;
  sendAt?: unknown;
  body?: string;
  attachments?: unknown[];
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

const SectionTitle = React.memo(({ children }: { children: string }) => (
  <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{children}</div>
));
SectionTitle.displayName = 'SectionTitle';

type AttachmentItemProps = { a: { url?: string; name?: string; type?: string; size?: number }; index: number };

const AttachmentItem = React.memo(({ a }: AttachmentItemProps) => (
  <li className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
    <div className="min-w-0">
      <a className="font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2 break-words" href={a.url} target="_blank" rel="noreferrer">
        {a.name || a.url}
      </a>
      <div className="mt-1 text-xs text-gray-500">
        {a.type ? String(a.type) : 'file'}{a.size ? ` · ${formatBytes(a.size)}` : ''}
      </div>
    </div>
    <span className="shrink-0 px-3 py-1 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg bg-white">Open</span>
  </li>
));
AttachmentItem.displayName = 'AttachmentItem';

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function NoticeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const dojoId = useMemo(() => getParamAsString((params as Record<string, unknown>)?.dojoId), [params]);
  const noticeId = useMemo(() => getParamAsString((params as Record<string, unknown>)?.noticeId), [params]);

  const { dojoName } = useDojoName(dojoId || '');

  const [row, setRow] = useState<unknown>(undefined);
  const [errText, setErrText] = useState('');
  const [source, setSource] = useState<'notices' | 'inbox' | ''>('');

  const handleBack = useCallback(() => router.back(), [router]);

  // Fetch notice
  useEffect(() => {
    let mounted = true;

    const fetchNotice = async () => {
      setErrText('');
      setSource('');
      setRow(undefined);

      if (!dojoId || !noticeId) {
        if (mounted) { setRow(null); setErrText('Announcement not found.'); }
        return;
      }

      try {
        const notice = await getNotice(dojoId, noticeId);
        if (!mounted) return;
        if (notice) { setRow(notice); setSource('notices'); return; }
        setRow(null);
        setSource('');
      } catch (e: unknown) {
        if (!mounted) return;

        if (isPermissionDenied(e) && uid) {
          // Try inbox fallback
          try {
            const inboxRef = doc(db, 'dojos', dojoId, 'members', uid, 'noticeInbox', noticeId);
            const snap = await getDoc(inboxRef);
            if (!mounted) return;

            if (snap.exists()) {
              const data = snap.data() as InboxNotice;
              setRow({
                id: noticeId,
                audienceType: 'uids',
                audienceUids: [],
                attachments: Array.isArray(data?.attachments) ? data.attachments : [],
                ...data,
              });
              setSource('inbox');
              return;
            }

            setRow(null);
            setErrText('This announcement is no longer available.');
          } catch {
            setRow(null);
            setErrText('Could not load announcement.');
          }
        } else {
          setRow(null);
          setErrText('Could not load announcement.');
        }
      }
    };

    fetchNotice();
    return () => { mounted = false; };
  }, [dojoId, noticeId, uid]);

  const uiStatus = useMemo(() => (row ? computeUiStatus(row as any) : 'upcoming'), [row]);
  const rowData = row as Record<string, unknown> | null | undefined;

  // ─── Loading ───
  if (row === undefined) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  // ─── Not Found ───
  if (row === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
          <button onClick={handleBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          {errText && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{errText}</div>}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-gray-500">
            Announcement not found.
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  // ─── Main View ───
  const startTime = asDate(rowData?.startTime);
  const endTime = asDate(rowData?.endTime);
  const attachments = rowData?.attachments as Array<{ url?: string; name?: string; type?: string; size?: number }> | undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <button onClick={handleBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>

          {dojoName && <p className="text-sm font-medium text-blue-600 mb-1">{dojoName}</p>}
          <h1 className="text-2xl font-bold text-gray-900">{(rowData?.title as string) || 'Announcement'}</h1>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
              {typeLabel(rowData?.type as string)}
            </span>
            <StatusBadge status={uiStatus} />
          </div>
        </div>

        {/* Error */}
        {errText && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{errText}</div>}

        {/* Metadata */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <SectionTitle>Category</SectionTitle>
            <p className="mt-2 font-semibold text-gray-900">{typeLabel(rowData?.type as string)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <SectionTitle>Audience</SectionTitle>
            <p className="mt-2 font-semibold text-gray-900">
              {rowData?.audienceType === 'all' ? 'All Members' : rowData?.audienceType === 'uids' ? 'Selected Members' : String(rowData?.audienceType || '—')}
            </p>
            {rowData?.audienceType === 'uids' && Array.isArray(rowData?.audienceUids) && (
              <p className="text-sm text-gray-500 mt-1">Recipients: {(rowData.audienceUids as string[]).length}</p>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <SectionTitle>Period</SectionTitle>
            <p className="mt-2 text-sm text-gray-700">
              {startTime.toLocaleString()} – {endTime.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <SectionTitle>Message</SectionTitle>
          {rowData?.body ? (
            <div className="mt-3 whitespace-pre-wrap text-gray-900 leading-relaxed">{String(rowData.body)}</div>
          ) : (
            <p className="mt-3 text-sm text-gray-400">No message body.</p>
          )}
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <SectionTitle>Attachments</SectionTitle>
          {attachments && attachments.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {attachments.map((a, i) => <AttachmentItem key={i} a={a} index={i} />)}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-400">No attachments.</p>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}