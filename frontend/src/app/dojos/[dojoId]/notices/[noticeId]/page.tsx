'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '@/providers/AuthProvider';
import { dbNullable } from '@/firebase';

import { getNotice, asDate, computeUiStatus } from '@/lib/notices';
import { StatusBadge } from '@/components/notices/StatusBadge';

// ─────────────────────────────────────────────────────────────
// Utilities (memoized outside component)
// ─────────────────────────────────────────────────────────────
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
  return (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions')
  );
};

// BJJ-friendly labels
const TYPE_LABELS = {
  memo: 'Gym Update',
  notice: 'Announcement',
} as const;

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

// ─────────────────────────────────────────────────────────────
// Sub-components (prevent re-renders)
// ─────────────────────────────────────────────────────────────
const SectionTitle = React.memo(({ children }: { children: string }) => (
  <div className="text-sm font-semibold text-slate-700">{children}</div>
));
SectionTitle.displayName = 'SectionTitle';

const BackButton = React.memo(({ onClick }: { onClick: () => void }) => (
  <button
    className="px-4 py-2 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 transition text-sm font-semibold"
    onClick={onClick}
  >
    Back
  </button>
));
BackButton.displayName = 'BackButton';

const LoadingCard = React.memo(() => (
  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-6 text-slate-700 shadow-sm">
    Loading…
  </div>
));
LoadingCard.displayName = 'LoadingCard';

const NotFoundCard = React.memo(() => (
  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-6 text-slate-700 shadow-sm">
    Not found.
  </div>
));
NotFoundCard.displayName = 'NotFoundCard';

type AttachmentItemProps = {
  a: { url?: string; name?: string; type?: string; size?: number };
  index: number;
};

const AttachmentItem = React.memo(({ a }: AttachmentItemProps) => (
  <li className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
    <div className="min-w-0">
      <a
        className="font-semibold text-slate-900 underline underline-offset-2 break-words"
        href={a.url}
        target="_blank"
        rel="noreferrer"
      >
        {a.name || a.url}
      </a>
      <div className="mt-1 text-xs text-slate-500">
        {a.type ? String(a.type) : 'file'}
        {a.size ? ` · ${formatBytes(a.size)}` : ''}
      </div>
    </div>
    <span className="shrink-0 inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
      Open
    </span>
  </li>
));
AttachmentItem.displayName = 'AttachmentItem';

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function NoticeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const dojoId = useMemo(() => getParamAsString((params as Record<string, unknown>)?.dojoId), [params]);
  const noticeId = useMemo(() => getParamAsString((params as Record<string, unknown>)?.noticeId), [params]);

  const [row, setRow] = useState<unknown>(undefined);
  const [errText, setErrText] = useState('');
  const [source, setSource] = useState<'notices' | 'inbox' | ''>('');

  const handleBack = useCallback(() => router.back(), [router]);

  // Fetch notice data
  useEffect(() => {
    let mounted = true;

    const fetchNotice = async () => {
      setErrText('');
      setSource('');
      setRow(undefined);

      if (!dojoId || !noticeId) {
        if (mounted) {
          setRow(null);
          setErrText('Invalid URL params (dojoId/noticeId is missing).');
        }
        return;
      }

      if (!dbNullable) {
        if (mounted) {
          setRow(undefined);
          setErrText('Firestore is not ready (dbNullable is null).');
        }
        return;
      }

      try {
        const notice = await getNotice(dojoId, noticeId);
        if (!mounted) return;

        if (notice) {
          setRow(notice);
          setSource('notices');
          return;
        }

        setRow(null);
        setSource('');
      } catch (e: unknown) {
        if (!mounted) return;

        if (isPermissionDenied(e)) {
          if (!uid) {
            setRow(null);
            setErrText('Permission denied (and not signed in).');
            return;
          }

          try {
            const inboxRef = doc(dbNullable, 'dojos', dojoId, 'members', uid, 'noticeInbox', noticeId);
            const snap = await getDoc(inboxRef);

            if (!mounted) return;

            if (snap.exists()) {
              const data = snap.data() as InboxNotice;
              const patched = {
                id: noticeId,
                audienceType: 'uids',
                audienceUids: [],
                attachments: Array.isArray(data?.attachments) ? data.attachments : [],
                ...data,
              };
              setRow(patched);
              setSource('inbox');
              setErrText(
                'This update is shown from your inbox cache (noticeInbox) because the main document is not readable by your current Firestore Rules.'
              );
              return;
            }

            setRow(null);
            setErrText(
              'Permission denied. Inbox fallback doc also not found. ' +
                '(Not distributed to your inbox OR inbox read rule is missing.)'
            );
          } catch (e2: unknown) {
            setRow(null);
            setErrText((e2 as Error)?.message || 'Inbox fallback failed.');
          }
        } else {
          setRow(null);
          setErrText((e as Error)?.message || String(e));
        }
      }
    };

    fetchNotice();
    return () => { mounted = false; };
  }, [dojoId, noticeId, uid]);

  const uiStatus = useMemo(() => (row ? computeUiStatus(row as any) : 'upcoming'), [row]);
  const rowData = row as Record<string, unknown> | null | undefined;

  // Early returns for loading states
  if (row === undefined) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
          <HeaderSection
            title="Loading…"
            subtitle="Gym announcement details"
            source=""
            uiStatus={uiStatus}
            type={undefined}
            onBack={handleBack}
          />
          <LoadingCard />
        </div>
      </div>
    );
  }

  if (row === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
          <HeaderSection
            title="Announcement"
            subtitle="Gym announcement details"
            source=""
            uiStatus={uiStatus}
            type={undefined}
            onBack={handleBack}
          />
          {errText && <ErrorBanner errText={errText} isWarning={false} />}
          <NotFoundCard />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
        <HeaderSection
          title={rowData?.title as string || 'Announcement'}
          subtitle="Gym announcement details"
          source={source}
          uiStatus={uiStatus}
          type={rowData?.type as string}
          onBack={handleBack}
        />

        {errText && <ErrorBanner errText={errText} isWarning={source === 'inbox'} />}

        <NoticeContent rowData={rowData!} source={source} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components for main content
// ─────────────────────────────────────────────────────────────
type HeaderSectionProps = {
  title: string;
  subtitle: string;
  source: string;
  uiStatus: string;
  type?: string;
  onBack: () => void;
};

const HeaderSection = React.memo(({ title, subtitle, source, uiStatus, type, onBack }: HeaderSectionProps) => (
  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
    <div className="px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <BackButton onClick={onBack} />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            {typeLabel(type)}
          </span>
          <StatusBadge status={uiStatus} />
        </div>
      </div>
      <div className="mt-4">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {subtitle}
          {source === 'inbox' ? ' (inbox cache)' : ''}
        </p>
      </div>
    </div>
  </div>
));
HeaderSection.displayName = 'HeaderSection';

type ErrorBannerProps = {
  errText: string;
  isWarning: boolean;
};

const ErrorBanner = React.memo(({ errText, isWarning }: ErrorBannerProps) => (
  <div
    className={[
      'rounded-3xl border px-5 py-4 whitespace-pre-wrap shadow-sm',
      isWarning
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-rose-200 bg-rose-50 text-rose-900',
    ].join(' ')}
  >
    <div className="font-semibold">Heads up</div>
    <div className="mt-1 text-sm">{errText}</div>
  </div>
));
ErrorBanner.displayName = 'ErrorBanner';

type NoticeContentProps = {
  rowData: Record<string, unknown>;
  source: string;
};

const NoticeContent = React.memo(({ rowData, source }: NoticeContentProps) => {
  const startTime = asDate(rowData.startTime);
  const endTime = asDate(rowData.endTime);
  const attachments = rowData.attachments as Array<{ url?: string; name?: string; type?: string; size?: number }> | undefined;

  return (
    <div className="space-y-4">
      {/* Metadata grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4">
            <SectionTitle>Category</SectionTitle>
            <div className="mt-2 text-slate-900 font-semibold">{typeLabel(rowData.type as string)}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4">
            <SectionTitle>Audience</SectionTitle>
            <div className="mt-2 text-slate-900 font-semibold">
              {rowData.audienceType === 'all' ? 'All Members' : rowData.audienceType === 'uids' ? 'Selected Members' : String(rowData.audienceType || '—')}
            </div>
            {rowData.audienceType === 'uids' && Array.isArray(rowData.audienceUids) && (
              <div className="mt-1 text-sm text-slate-500">
                Recipients: {(rowData.audienceUids as string[]).length}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4">
            <SectionTitle>Window</SectionTitle>
            <div className="mt-2 text-sm text-slate-700">
              {startTime.toLocaleString()} – {endTime.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-5">
          <SectionTitle>Message</SectionTitle>
          {rowData.body ? (
            <div className="mt-3 whitespace-pre-wrap text-slate-900 leading-relaxed">
              {String(rowData.body)}
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-500">
              {source === 'inbox' ? 'Body is not available in inbox cache.' : 'No message body.'}
            </div>
          )}
        </div>
      </div>

      {/* Attachments */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-5">
          <SectionTitle>Attachments</SectionTitle>
          {attachments && attachments.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {attachments.map((a, i) => (
                <AttachmentItem key={i} a={a} index={i} />
              ))}
            </ul>
          ) : (
            <div className="mt-3 text-sm text-slate-500">No attachments.</div>
          )}
        </div>
      </div>

      {/* Inbox note */}
      {source === 'inbox' && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
          <div className="font-semibold">Inbox cache view</div>
          <div className="mt-1 text-sm">
            This page is rendering from <code className="px-1 rounded bg-amber-100">noticeInbox</code>.
            If you need full body / attachments from the main document, adjust Firestore Rules for
            <code className="px-1 rounded bg-amber-100">/dojos/{'{dojoId}'}/notices/{'{noticeId}'}</code>.
          </div>
        </div>
      )}
    </div>
  );
});
NoticeContent.displayName = 'NoticeContent';