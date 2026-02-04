'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { asDate, computeUiStatus, subscribeNoticesForStaff } from '@/lib/notices';
import type { NoticeRow } from '@/lib/noticesTypes';
import { NoticeListItem } from '@/components/notices/NoticeListItem';
import Navigation, { BottomNavigation } from '@/components/Navigation';

// ─────────────────────────────────────────────────────────────
// Constants & Utilities
// ─────────────────────────────────────────────────────────────
const TYPE_LABELS = {
  memo: 'Gym Update',
  notice: 'Announcement',
} as const;

const floorToDate = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ceilToDateEnd = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const formatDateRange = (s: Date, e: Date): string => {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
};

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TabType = 'active' | 'all';
type FilterType = 'all' | 'notice' | 'memo';
type FilterStatus = 'all' | 'active' | 'upcoming' | 'complete';

type ListItemData = {
  id: string;
  left: string;
  title: string;
  dateText: string;
  uiStatus: string;
};

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
const TabButton = React.memo(
  ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
);
TabButton.displayName = 'TabButton';

const FilterSelect = React.memo(
  ({
    value,
    onChange,
    options,
    className = '',
  }: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    className?: string;
  }) => (
    <select
      className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
);
FilterSelect.displayName = 'FilterSelect';

const EmptyState = React.memo(() => (
  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
    <div className="text-slate-500">No announcements found.</div>
  </div>
));
EmptyState.displayName = 'EmptyState';

const LoadingState = React.memo(() => (
  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
    <div className="text-slate-500">Loading…</div>
  </div>
));
LoadingState.displayName = 'LoadingState';

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function StaffNoticesPage() {
  const { dojoId } = useParams<{ dojoId: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();

  const initialTab = (sp.get('filter') as TabType) || 'active';

  const [tab, setTab] = useState<TabType>(initialTab);
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');

  // Subscribe to notices
  useEffect(() => {
    if (!dojoId || !user?.uid) return;

    setLoading(true);
    const unsub = subscribeNoticesForStaff(
      dojoId,
      (r) => {
        setRows(r);
        setLoading(false);
      },
      (err) => {
        console.error('[StaffNoticesPage] subscribe error', err);
        setRows([]);
        setLoading(false);
      }
    );

    return unsub;
  }, [dojoId, user?.uid]);

  // Memoized date filter
  const dateFilter = useMemo(() => {
    const s = dateStart ? floorToDate(new Date(dateStart)) : null;
    const e = dateEnd ? ceilToDateEnd(new Date(dateEnd)) : null;
    if (s && isNaN(+s)) return { start: null, end: null };
    if (e && isNaN(+e)) return { start: null, end: null };
    return { start: s, end: e };
  }, [dateStart, dateEnd]);

  // Filtered rows with optimized filtering
  const filteredRows = useMemo(() => {
    const now = Date.now();
    let result = rows;

    // Tab filter
    if (tab === 'active') {
      result = result.filter((n) => {
        if (!['sent', 'scheduled'].includes(n.status)) return false;
        const endMs = asDate(n.endTime).getTime();
        const startMs = asDate(n.startTime).getTime();
        return endMs >= now && startMs <= now;
      });
    }

    // Date range filter
    if (dateFilter.start && dateFilter.end) {
      const s = dateFilter.start.getTime();
      const e = dateFilter.end.getTime();
      result = result.filter((n) => {
        const ns = asDate(n.startTime).getTime();
        const ne = asDate(n.endTime).getTime();
        return ns <= e && ne >= s;
      });
    }

    // Type filter
    if (filterType !== 'all') {
      result = result.filter((n) => n.type === filterType);
    }

    // Status filter
    if (filterStatus !== 'all') {
      result = result.filter((n) => computeUiStatus(n) === filterStatus);
    }

    // Search filter
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter((n) => {
        const hay = `${n.title} ${n.body ?? ''} ${n.type} ${n.audienceType}`.toLowerCase();
        return hay.includes(q);
      });
    }

    return result;
  }, [rows, tab, dateFilter, filterType, filterStatus, searchText]);

  // Transform to list items
  const items: ListItemData[] = useMemo(() => {
    return filteredRows.map((n) => ({
      id: n.id,
      left: TYPE_LABELS[n.type as keyof typeof TYPE_LABELS] ?? 'Announcement',
      title: n.title,
      dateText: formatDateRange(asDate(n.startTime), asDate(n.endTime)),
      uiStatus: computeUiStatus(n),
    }));
  }, [filteredRows]);

  // Callbacks
  const handleTabChange = useCallback((newTab: TabType) => {
    startTransition(() => setTab(newTab));
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => setSearchText(e.target.value));
  }, []);

  const handleTypeChange = useCallback((v: string) => {
    startTransition(() => setFilterType(v as FilterType));
  }, []);

  const handleStatusChange = useCallback((v: string) => {
    startTransition(() => setFilterStatus(v as FilterStatus));
  }, []);

  const handleDateStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => setDateStart(e.target.value));
  }, []);

  const handleDateEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => setDateEnd(e.target.value));
  }, []);

  const handleCompose = useCallback(() => {
    router.push(`/dojos/${dojoId}/notices/compose`);
  }, [router, dojoId]);

  const handleItemClick = useCallback(
    (id: string) => {
      router.push(`/dojos/${dojoId}/notices/${id}`);
    },
    [router, dojoId]
  );

  // Auth check
  if (!user?.uid) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-4xl p-4 sm:p-6">
          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
            Please sign in.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <Navigation dojoId={dojoId} isStaff={true} userEmail={user?.email || undefined} />

      <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4 pb-20 md:pb-6">
        {/* Header */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">Gym Announcements</h1>
                <p className="mt-1 text-sm text-slate-500">Manage updates and announcements for your members</p>
              </div>
              <button
                className="px-4 py-2 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition text-sm font-semibold"
                onClick={handleCompose}
              >
                Compose
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4 flex gap-2">
              <TabButton active={tab === 'active'} onClick={() => handleTabChange('active')}>
                Active
              </TabButton>
              <TabButton active={tab === 'all'} onClick={() => handleTabChange('all')}>
                All
              </TabButton>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Search"
                value={searchText}
                onChange={handleSearchChange}
              />
              <FilterSelect
                value={filterType}
                onChange={handleTypeChange}
                options={[
                  { value: 'all', label: 'All types' },
                  { value: 'notice', label: 'Announcement' },
                  { value: 'memo', label: 'Gym Update' },
                ]}
              />
              <FilterSelect
                value={filterStatus}
                onChange={handleStatusChange}
                options={[
                  { value: 'all', label: 'All status' },
                  { value: 'active', label: 'Active' },
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'complete', label: 'Complete' },
                ]}
              />

              {/* ✅ Date range (fixed: never overflow) */}
              <div className="flex flex-col gap-2 lg:flex-row">
                <input
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  type="date"
                  value={dateStart}
                  onChange={handleDateStartChange}
                />
                <input
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  type="date"
                  value={dateEnd}
                  onChange={handleDateEndChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            items.map((it) => (
              <NoticeListItem
                key={it.id}
                titleLeft={it.left}
                titleMain={it.title}
                dateText={it.dateText}
                status={it.uiStatus}
                onClick={() => handleItemClick(it.id)}
              />
            ))
          )}
        </div>

        {/* Loading indicator for filter changes */}
        {isPending && (
          <div className="fixed bottom-20 md:bottom-4 right-4 rounded-full bg-slate-900 text-white px-4 py-2 text-sm shadow-lg">
            Updating…
          </div>
        )}
      </div>

      {/* Bottom Navigation for Mobile */}
      <BottomNavigation dojoId={dojoId} isStaff={true} />
    </div>
  );
}
