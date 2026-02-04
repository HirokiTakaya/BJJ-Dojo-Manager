'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '@/providers/AuthProvider';
import { dbNullable } from '@/firebase';
import { createNotice } from '@/lib/notices';
import type { AudienceType, NoticeStatus, NoticeType } from '@/lib/noticesTypes';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const DEFAULT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const TYPE_LABELS = {
  notice: 'Announcement',
  memo: 'Gym Update',
} as const;

const AUDIENCE_LABELS = {
  all: 'All Members',
  uids: 'Selected Members',
} as const;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type MemberInfo = {
  uid: string;
  displayName: string;
  email?: string;
};

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
const toLocalDatetimeString = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const localDatetimeStringToDate = (v: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return new Date(NaN);
  const [, ys, ms, ds, hs, mins] = m;
  return new Date(Number(ys), Number(ms) - 1, Number(ds), Number(hs), Number(mins), 0, 0);
};

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
const FormLabel = React.memo(({ children }: { children: React.ReactNode }) => (
  <div className="text-sm font-semibold text-slate-700">{children}</div>
));
FormLabel.displayName = 'FormLabel';

const StepButton = React.memo(({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) => (
  <button
    className={[
      'px-4 py-2 rounded-full text-sm font-semibold transition',
      active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    ].join(' ')}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
));
StepButton.displayName = 'StepButton';

const ActionButton = React.memo(({
  variant = 'secondary',
  onClick,
  disabled,
  children,
}: {
  variant?: 'primary' | 'secondary' | 'outline';
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) => {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  };
  return (
    <button
      className={`px-4 py-2 rounded-full text-sm font-semibold transition ${styles[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
});
ActionButton.displayName = 'ActionButton';

const ErrorList = React.memo(({ problems }: { problems: string[] }) => {
  if (problems.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="font-semibold text-amber-900">Fix these:</div>
      <ul className="list-disc ml-5 mt-2 text-amber-900">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
});
ErrorList.displayName = 'ErrorList';

// Member search result item
const MemberSearchItem = React.memo(({
  member,
  isSelected,
  onToggle,
}: {
  member: MemberInfo;
  isSelected: boolean;
  onToggle: (uid: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onToggle(member.uid)}
    className={[
      'w-full text-left px-4 py-3 rounded-xl border transition',
      isSelected
        ? 'border-slate-900 bg-slate-50'
        : 'border-slate-200 bg-white hover:bg-slate-50',
    ].join(' ')}
  >
    <div className="flex items-center justify-between">
      <div>
        <div className="font-semibold text-slate-900">{member.displayName}</div>
        {member.email && (
          <div className="text-xs text-slate-500">{member.email}</div>
        )}
      </div>
      <div className={[
        'w-5 h-5 rounded-full border-2 flex items-center justify-center transition',
        isSelected ? 'border-slate-900 bg-slate-900' : 'border-slate-300',
      ].join(' ')}>
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  </button>
));
MemberSearchItem.displayName = 'MemberSearchItem';

// Selected member chip
const SelectedMemberChip = React.memo(({
  member,
  onRemove,
}: {
  member: MemberInfo;
  onRemove: (uid: string) => void;
}) => (
  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm">
    {member.displayName}
    <button
      type="button"
      onClick={() => onRemove(member.uid)}
      className="ml-1 hover:text-slate-900"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </span>
));
SelectedMemberChip.displayName = 'SelectedMemberChip';

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function ComposeNoticePage() {
  const { dojoId } = useParams<{ dojoId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [type, setType] = useState<NoticeType>('notice');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [startLocal, setStartLocal] = useState(() => toLocalDatetimeString(new Date()));
  const [endLocal, setEndLocal] = useState('');
  const [sendAtLocal, setSendAtLocal] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Member search state
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<MemberInfo[]>([]);

  // Load members when audience type changes to 'uids'
  useEffect(() => {
    if (audienceType !== 'uids' || !dojoId || !dbNullable) return;
    if (allMembers.length > 0) return; // Already loaded

    let mounted = true;
    setMembersLoading(true);

    const loadMembers = async () => {
      try {
        // Query members collection for this dojo
        const membersRef = collection(dbNullable, 'dojos', dojoId, 'members');
        const snapshot = await getDocs(membersRef);
        
        const members: MemberInfo[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          members.push({
            uid: doc.id,
            displayName: data.displayName || data.name || data.email || doc.id,
            email: data.email,
          });
        });

        // Sort by displayName
        members.sort((a, b) => a.displayName.localeCompare(b.displayName));

        if (mounted) {
          setAllMembers(members);
        }
      } catch (e) {
        console.error('Failed to load members:', e);
      } finally {
        if (mounted) {
          setMembersLoading(false);
        }
      }
    };

    loadMembers();
    return () => { mounted = false; };
  }, [audienceType, dojoId, allMembers.length]);

  // Filtered members based on search
  const filteredMembers = useMemo(() => {
    if (!memberSearchQuery.trim()) return allMembers;
    const q = memberSearchQuery.toLowerCase();
    return allMembers.filter((m) =>
      m.displayName.toLowerCase().includes(q) ||
      (m.email && m.email.toLowerCase().includes(q))
    );
  }, [allMembers, memberSearchQuery]);

  // Selected UIDs for submission
  const selectedUids = useMemo(() => selectedMembers.map((m) => m.uid), [selectedMembers]);

  // Computed values
  const parsedStart = useMemo(() => localDatetimeStringToDate(startLocal), [startLocal]);
  const parsedEnd = useMemo(() => {
    if (endLocal) return localDatetimeStringToDate(endLocal);
    return new Date(parsedStart.getTime() + DEFAULT_DURATION_MS);
  }, [endLocal, parsedStart]);

  const parsedSendAtForPreview = useMemo(() => {
    return sendAtLocal ? localDatetimeStringToDate(sendAtLocal) : parsedStart;
  }, [sendAtLocal, parsedStart]);

  const problems = useMemo(() => {
    const ps: string[] = [];
    if (!user?.uid) ps.push('Please sign in.');
    if (!title.trim()) ps.push('Title is required.');

    if (audienceType === 'uids' && selectedMembers.length === 0) {
      ps.push('Please select at least one member.');
    }

    if (isNaN(parsedStart.getTime())) ps.push('Start time is invalid.');
    if (isNaN(parsedEnd.getTime())) ps.push('End time is invalid.');
    if (!isNaN(parsedEnd.getTime()) && !isNaN(parsedStart.getTime()) && parsedEnd < parsedStart) {
      ps.push('End time must be after start time.');
    }

    if (sendAtLocal) {
      const d = localDatetimeStringToDate(sendAtLocal);
      if (isNaN(d.getTime())) ps.push('SendAt is invalid.');
    }

    return ps;
  }, [user?.uid, title, audienceType, selectedMembers.length, parsedStart, parsedEnd, sendAtLocal]);

  // Handlers
  const handleBack = useCallback(() => router.back(), [router]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.currentTarget.files ?? []);
    setFiles(picked);
    try { e.currentTarget.value = ''; } catch {}
  }, []);

  const handleToggleMember = useCallback((uid: string) => {
    setSelectedMembers((prev) => {
      const exists = prev.find((m) => m.uid === uid);
      if (exists) {
        return prev.filter((m) => m.uid !== uid);
      }
      const member = allMembers.find((m) => m.uid === uid);
      if (member) {
        return [...prev, member];
      }
      return prev;
    });
  }, [allMembers]);

  const handleRemoveMember = useCallback((uid: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.uid !== uid));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedMembers(filteredMembers);
  }, [filteredMembers]);

  const handleClearAll = useCallback(() => {
    setSelectedMembers([]);
  }, []);

  const handleCreate = useCallback(async (mode: 'draft' | 'send') => {
    if (!user?.uid || problems.length > 0) return;

    setBusy(true);
    setErr('');

    try {
      const now = new Date();
      const resolvedSendAt =
        mode === 'send'
          ? (sendAtLocal ? localDatetimeStringToDate(sendAtLocal) : now)
          : (sendAtLocal ? localDatetimeStringToDate(sendAtLocal) : parsedStart);

      const willSchedule = mode === 'send' && resolvedSendAt.getTime() > now.getTime();
      const status: NoticeStatus = mode === 'draft' ? 'draft' : willSchedule ? 'scheduled' : 'sent';

      const payload = {
        type,
        title,
        body,
        audienceType,
        audienceUids: audienceType === 'uids' ? selectedUids : [],
        startAt: parsedStart,
        endAt: parsedEnd,
        sendAt: resolvedSendAt,
        status,
        startTime: parsedStart,
        endTime: parsedEnd,
      } as any;

      const id = await createNotice(dojoId, user.uid, payload, files);
      router.replace(`/dojos/${dojoId}/notices/${id}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [user?.uid, problems, sendAtLocal, parsedStart, parsedEnd, type, title, body, audienceType, selectedUids, files, dojoId, router]);

  // Auth check
  if (!user?.uid) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
            Please sign in.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
                  Create Announcement
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Post an announcement or gym update to your members
                </p>
              </div>
              <ActionButton variant="secondary" onClick={handleBack} disabled={busy}>
                Back
              </ActionButton>
            </div>

            <div className="mt-4 flex gap-2">
              <StepButton active={step === 'form'} onClick={() => setStep('form')} disabled={busy}>
                Edit
              </StepButton>
              <StepButton active={step === 'preview'} onClick={() => setStep('preview')} disabled={busy}>
                Review
              </StepButton>
            </div>
          </div>
        </div>

        {/* Errors */}
        {err && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
            {err}
          </div>
        )}
        <ErrorList problems={problems} />

        {/* Form */}
        {step === 'form' && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-5">
              {/* Type & Audience */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <FormLabel>Category</FormLabel>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={type}
                    onChange={(e) => setType(e.target.value as NoticeType)}
                    disabled={busy}
                  >
                    <option value="notice">Announcement</option>
                    <option value="memo">Gym Update</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <FormLabel>Audience</FormLabel>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={audienceType}
                    onChange={(e) => setAudienceType(e.target.value as AudienceType)}
                    disabled={busy}
                  >
                    <option value="all">All Members</option>
                    <option value="uids">Selected Members</option>
                  </select>
                </label>
              </div>

              {/* Member Selection */}
              {audienceType === 'uids' && (
                <div className="space-y-3">
                  <FormLabel>Select Members</FormLabel>
                  
                  {/* Selected members chips */}
                  {selectedMembers.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedMembers.map((m) => (
                        <SelectedMemberChip
                          key={m.uid}
                          member={m}
                          onRemove={handleRemoveMember}
                        />
                      ))}
                    </div>
                  )}

                  {/* Search input */}
                  <input
                    type="text"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Search members by name or email..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    disabled={busy}
                  />

                  {/* Quick actions */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-sm text-slate-600 hover:text-slate-900 underline"
                      disabled={busy}
                    >
                      Select all ({filteredMembers.length})
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-sm text-slate-600 hover:text-slate-900 underline"
                      disabled={busy}
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Member list */}
                  <div className="max-h-64 overflow-y-auto space-y-2 rounded-2xl border border-slate-200 p-3">
                    {membersLoading ? (
                      <div className="text-center py-4 text-slate-500">Loading members...</div>
                    ) : filteredMembers.length === 0 ? (
                      <div className="text-center py-4 text-slate-500">
                        {memberSearchQuery ? 'No members found' : 'No members in this gym'}
                      </div>
                    ) : (
                      filteredMembers.map((member) => (
                        <MemberSearchItem
                          key={member.uid}
                          member={member}
                          isSelected={selectedMembers.some((m) => m.uid === member.uid)}
                          onToggle={handleToggleMember}
                        />
                      ))
                    )}
                  </div>

                  <div className="text-sm text-slate-500">
                    {selectedMembers.length} member(s) selected
                  </div>
                </div>
              )}

              {/* Title */}
              <label className="space-y-1 block">
                <FormLabel>Title</FormLabel>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short, clear headline"
                  disabled={busy}
                />
              </label>

              {/* Body */}
              <label className="space-y-1 block">
                <FormLabel>Message</FormLabel>
                <textarea
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 min-h-[160px] focus:outline-none focus:ring-2 focus:ring-slate-300"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write the details here…"
                  disabled={busy}
                />
              </label>

              {/* Times */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <FormLabel>Visible from</FormLabel>
                  <input
                    type="datetime-local"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <label className="space-y-1">
                  <FormLabel>Visible until (optional)</FormLabel>
                  <input
                    type="datetime-local"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <label className="space-y-1">
                  <FormLabel>Send time (optional)</FormLabel>
                  <input
                    type="datetime-local"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={sendAtLocal}
                    onChange={(e) => setSendAtLocal(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>

              {/* Attachments */}
              <div className="space-y-2">
                <FormLabel>Attachments (optional)</FormLabel>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="flex items-center gap-3">
                  <ActionButton
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    Add files
                  </ActionButton>
                  <div className="text-sm text-slate-600">
                    {files.length > 0 ? `${files.length} file(s) selected` : 'No files selected'}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                <ActionButton variant="secondary" onClick={() => setStep('preview')} disabled={busy}>
                  Review
                </ActionButton>
                <div className="flex-1" />
                <ActionButton
                  variant="outline"
                  onClick={() => handleCreate('draft')}
                  disabled={busy || problems.length > 0}
                >
                  Save draft
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={() => handleCreate('send')}
                  disabled={busy || problems.length > 0}
                >
                  Publish
                </ActionButton>
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        {step === 'preview' && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-5 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-slate-900 text-white px-3 py-1 text-xs font-semibold">
                    {TYPE_LABELS[type]}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-xs font-semibold">
                    {AUDIENCE_LABELS[audienceType]}
                  </span>
                  <div className="ml-auto text-xs text-slate-500">
                    Gym: <span className="font-medium text-slate-700">{dojoId}</span>
                  </div>
                </div>

                <div className="mt-3 text-xl font-semibold text-slate-900">
                  {title || '(Untitled)'}
                </div>

                <div className="mt-2 text-sm text-slate-600">
                  Visible window: {parsedStart.toLocaleString()} – {parsedEnd.toLocaleString()}
                </div>

                <div className="mt-1 text-xs text-slate-500">
                  SendAt (preview): {parsedSendAtForPreview.toLocaleString()}
                  {sendAtLocal ? '' : ' (default = Visible from)'}
                </div>

                {!sendAtLocal && (
                  <div className="mt-1 text-xs text-slate-500">
                    Note: If you press <b>Publish</b> with empty Send time, it will be sent <b>now</b>.
                  </div>
                )}

                {audienceType === 'uids' && (
                  <div className="mt-3">
                    <div className="text-xs text-slate-600 mb-2">
                      Recipients ({selectedMembers.length}):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedMembers.map((m) => (
                        <span
                          key={m.uid}
                          className="inline-flex items-center px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs"
                        >
                          {m.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 whitespace-pre-wrap text-slate-900">{body}</div>

                {files.length > 0 && (
                  <div className="mt-4 text-sm text-slate-600">
                    Attachments: <span className="font-semibold">{files.length}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <ActionButton variant="secondary" onClick={() => setStep('form')} disabled={busy}>
                  Back to edit
                </ActionButton>
                <div className="flex-1" />
                <ActionButton
                  variant="outline"
                  onClick={() => handleCreate('draft')}
                  disabled={busy || problems.length > 0}
                >
                  Save draft
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={() => handleCreate('send')}
                  disabled={busy || problems.length > 0}
                >
                  Publish {TYPE_LABELS[type]}
                </ActionButton>
              </div>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {busy && (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
            <div className="rounded-2xl bg-white px-6 py-4 shadow-xl">
              <div className="text-slate-900 font-semibold">Processing…</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}