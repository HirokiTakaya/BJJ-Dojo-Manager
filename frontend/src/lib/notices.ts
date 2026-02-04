// src/lib/notices.ts
'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';

import { dbNullable, storageNullable } from '@/firebase';
import type {
  AttachmentMeta,
  NoticeDoc,
  NoticeRow,
  NoticeStatus,
  NoticeType,
  AudienceType,
} from './noticesTypes';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const DEFAULT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const MEMBER_INBOX_SUBCOL = 'noticeInbox';
const BATCH_SIZE = 400;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type MemberInboxNotice = Pick<
  NoticeDoc,
  'type' | 'title' | 'status' | 'startTime' | 'endTime' | 'sendAt'
> & {
  dojoId: string;
  noticeId: string;
  createdAt?: any;
  updatedAt?: any;
};

export type CreateNoticeInput = {
  type: NoticeType;
  title: string;
  body?: string;
  audienceType: AudienceType;
  audienceUids?: string[];
  startAt?: Date;
  endAt?: Date | null;
  sendAt?: Date | null;
  status: NoticeStatus;
};

// ─────────────────────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────────────────────
function db() {
  const x = dbNullable;
  if (!x) throw new Error('Firestore not initialized');
  return x;
}

function storage() {
  const x = storageNullable;
  if (!x) throw new Error('Storage not initialized');
  return x;
}

export function asDate(v: any): Date {
  try {
    if (!v) return new Date('1900-01-01');
    if (v instanceof Timestamp) return v.toDate();
    if (v && typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(+d) ? new Date('1900-01-01') : d;
  } catch {
    return new Date('1900-01-01');
  }
}

export function computeUiStatus(
  n: Pick<NoticeDoc, 'startTime' | 'endTime' | 'status'>
): 'upcoming' | 'active' | 'complete' {
  const now = Date.now();
  const s = asDate(n.startTime).getTime();
  const e = asDate(n.endTime).getTime();

  if (!isNaN(s) && now < s) return 'upcoming';

  if (
    !isNaN(s) &&
    !isNaN(e) &&
    now >= s &&
    now <= e &&
    (n.status === 'sent' || n.status === 'scheduled')
  ) {
    return 'active';
  }

  return 'complete';
}

function nowForQuery(): Timestamp {
  return Timestamp.fromMillis(Date.now() - CLOCK_SKEW_MS);
}

function isPermissionDenied(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? err ?? '');
  return (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions')
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sanitize(name: string) {
  return name.replace(/[^\w.\-()+\s]/g, '_');
}

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'mp4': return 'video/mp4';
    default: return 'application/octet-stream';
  }
}

// ─────────────────────────────────────────────────────────────
// Inbox Fanout Helpers
// ─────────────────────────────────────────────────────────────
function inboxDocRef(dojoId: string, memberUid: string, noticeId: string) {
  return doc(db(), 'dojos', dojoId, 'members', memberUid, MEMBER_INBOX_SUBCOL, noticeId);
}

function memberDocRef(dojoId: string, memberUid: string) {
  return doc(db(), 'dojos', dojoId, 'members', memberUid);
}

function inboxPayloadCreate(dojoId: string, noticeId: string, n: NoticeDoc): MemberInboxNotice {
  return {
    dojoId,
    noticeId,
    type: n.type,
    title: n.title,
    status: n.status,
    startTime: n.startTime,
    endTime: n.endTime,
    sendAt: n.sendAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function inboxPayloadUpdate(dojoId: string, noticeId: string, n: NoticeDoc): Partial<MemberInboxNotice> {
  return {
    dojoId,
    noticeId,
    type: n.type,
    title: n.title,
    status: n.status,
    startTime: n.startTime,
    endTime: n.endTime,
    sendAt: n.sendAt,
    updatedAt: serverTimestamp(),
  };
}

/**
 * ✅ メンバードキュメントが存在しない場合は最小限のドキュメントを作成
 */
async function ensureMemberDocExists(dojoId: string, memberUid: string): Promise<boolean> {
  try {
    const ref = memberDocRef(dojoId, memberUid);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) {
      // 親ドキュメントが存在しない場合、最小限のドキュメントを作成
      // （これによりサブコレクションへの書き込みが安定する）
      console.warn(`[notices] Member doc missing for ${memberUid}, creating placeholder...`);
      await setDoc(ref, {
        uid: memberUid,
        createdAt: serverTimestamp(),
        createdBy: 'system:notice-fanout',
        status: 'pending', // 正式な登録はまだ
      }, { merge: true });
    }
    return true;
  } catch (e) {
    console.error(`[notices] Failed to ensure member doc for ${memberUid}:`, e);
    return false;
  }
}

/**
 * ✅ 存在するメンバーのUIDのみをフィルタリング
 */
async function filterExistingMembers(dojoId: string, uids: string[]): Promise<string[]> {
  const existing: string[] = [];
  
  // バッチでチェック（大量のUIDがある場合に効率化）
  for (const uid of uids) {
    try {
      const ref = memberDocRef(dojoId, uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        existing.push(uid);
      } else {
        console.warn(`[notices] Member ${uid} does not exist in dojos/${dojoId}/members`);
      }
    } catch (e) {
      console.error(`[notices] Error checking member ${uid}:`, e);
    }
  }
  
  return existing;
}

/**
 * ✅ 改善版: Fanout with better error handling and logging
 */
async function fanoutInboxForUidsCreate(
  dojoId: string,
  noticeId: string,
  notice: NoticeDoc,
  uids: string[]
): Promise<{ success: string[]; failed: string[] }> {
  const result = { success: [] as string[], failed: [] as string[] };
  
  if (!uids.length) return result;

  console.log(`[notices] Starting fanout for ${uids.length} members...`);

  for (const part of chunk(uids, BATCH_SIZE)) {
    try {
      const b = writeBatch(db());
      
      for (const u of part) {
        const r = inboxDocRef(dojoId, u, noticeId);
        b.set(r, inboxPayloadCreate(dojoId, noticeId, notice) as any, { merge: true });
      }
      
      await b.commit();
      result.success.push(...part);
      console.log(`[notices] Fanout batch success: ${part.length} members`);
    } catch (e: any) {
      console.error(`[notices] Fanout batch failed:`, e);
      result.failed.push(...part);
      
      // バッチが失敗した場合、個別に試行
      for (const u of part) {
        try {
          const r = inboxDocRef(dojoId, u, noticeId);
          await setDoc(r, inboxPayloadCreate(dojoId, noticeId, notice) as any, { merge: true });
          
          // 成功したら failed から削除して success に追加
          const idx = result.failed.indexOf(u);
          if (idx > -1) result.failed.splice(idx, 1);
          result.success.push(u);
        } catch (e2) {
          console.error(`[notices] Individual fanout failed for ${u}:`, e2);
        }
      }
    }
  }

  console.log(`[notices] Fanout complete: ${result.success.length} success, ${result.failed.length} failed`);
  return result;
}

async function fanoutInboxForUidsUpdate(
  dojoId: string,
  noticeId: string,
  notice: NoticeDoc,
  uids: string[]
): Promise<void> {
  if (!uids.length) return;

  for (const part of chunk(uids, BATCH_SIZE)) {
    try {
      const b = writeBatch(db());
      for (const u of part) {
        const r = inboxDocRef(dojoId, u, noticeId);
        b.set(r, inboxPayloadUpdate(dojoId, noticeId, notice) as any, { merge: true });
      }
      await b.commit();
    } catch (e) {
      console.error(`[notices] Fanout update batch failed:`, e);
      // 個別リトライ
      for (const u of part) {
        try {
          const r = inboxDocRef(dojoId, u, noticeId);
          await setDoc(r, inboxPayloadUpdate(dojoId, noticeId, notice) as any, { merge: true });
        } catch (e2) {
          console.error(`[notices] Individual fanout update failed for ${u}:`, e2);
        }
      }
    }
  }
}

async function deleteInboxForUids(dojoId: string, noticeId: string, uids: string[]): Promise<void> {
  if (!uids.length) return;

  for (const part of chunk(uids, BATCH_SIZE)) {
    try {
      const b = writeBatch(db());
      for (const u of part) {
        const r = inboxDocRef(dojoId, u, noticeId);
        b.delete(r);
      }
      await b.commit();
    } catch (e) {
      console.error(`[notices] Delete inbox batch failed:`, e);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Attachment Upload
// ─────────────────────────────────────────────────────────────
export async function uploadNoticeAttachments(
  dojoId: string,
  noticeId: string,
  files: File[]
): Promise<AttachmentMeta[]> {
  if (!files.length) return [];
  const metas: AttachmentMeta[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.size > MAX_FILE_BYTES) {
      throw new Error(`"${f.name}" exceeds 25MB.`);
    }
    const clean = sanitize(f.name);
    const objectPath = `dojos/${dojoId}/notices/${noticeId}/attachments/${Date.now()}-${i}-${clean}`;
    const ref = sRef(storage(), objectPath);
    const contentType = f.type || guessContentType(f.name);

    await uploadBytes(ref, f, { contentType });
    const url = await getDownloadURL(ref);
    metas.push({ name: f.name, size: f.size, type: contentType, url });
  }

  return metas;
}

// ─────────────────────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────────────────────
export async function createNotice(
  dojoId: string,
  staffUid: string,
  input: CreateNoticeInput,
  files: File[] = []
): Promise<string> {
  const col = collection(db(), 'dojos', dojoId, 'notices');
  const ref = doc(col);

  const start = input.startAt ?? new Date();
  const end = input.endAt ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
  const sendAt = input.sendAt ?? start;

  const base: NoticeDoc = {
    type: input.type,
    title: input.title.trim(),
    body: (input.body ?? '').trim(),
    audienceType: input.audienceType,
    audienceUids: input.audienceType === 'uids' ? (input.audienceUids ?? []) : [],
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    sendAt: Timestamp.fromDate(sendAt),
    status: input.status,
    attachments: [],
    createdBy: staffUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 1) Create notice document
  await setDoc(ref, base as any);
  console.log(`[notices] Created notice ${ref.id}`);

  // 2) Fanout to inbox for selected members
  if (input.audienceType === 'uids' && (input.audienceUids?.length ?? 0) > 0) {
    const targetUids = input.audienceUids ?? [];
    console.log(`[notices] Fanout to ${targetUids.length} members:`, targetUids);
    
    try {
      const fanoutResult = await fanoutInboxForUidsCreate(dojoId, ref.id, base, targetUids);
      
      if (fanoutResult.failed.length > 0) {
        console.warn(`[notices] Some fanouts failed:`, fanoutResult.failed);
      }
      
      // Update notice with fanout status (optional, for debugging)
      await updateDoc(ref, {
        _fanoutSuccess: fanoutResult.success.length,
        _fanoutFailed: fanoutResult.failed.length,
        updatedAt: serverTimestamp(),
      } as any);
    } catch (e) {
      console.error(`[notices] Fanout failed completely:`, e);
      // Don't throw - notice is created, fanout can be retried
    }
  }

  // 3) Upload attachments
  if (files.length) {
    const metas = await uploadNoticeAttachments(dojoId, ref.id, files);
    await updateDoc(ref, { attachments: metas, updatedAt: serverTimestamp() } as any);
  }

  return ref.id;
}

export async function updateNotice(
  dojoId: string,
  noticeId: string,
  patch: Partial<
    Pick<
      NoticeDoc,
      'title' | 'body' | 'audienceType' | 'audienceUids' | 'startTime' | 'endTime' | 'sendAt' | 'status'
    >
  >
): Promise<void> {
  const ref = doc(db(), 'dojos', dojoId, 'notices', noticeId);

  const beforeSnap = await getDoc(ref);
  const before = beforeSnap.exists() ? (beforeSnap.data() as NoticeDoc) : null;

  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() } as any);

  const afterSnap = await getDoc(ref);
  if (!afterSnap.exists()) return;
  const after = afterSnap.data() as NoticeDoc;

  const beforeType = before?.audienceType;
  const beforeUids = Array.isArray(before?.audienceUids) ? before!.audienceUids : [];
  const afterType = after.audienceType;
  const afterUids = Array.isArray(after.audienceUids) ? after.audienceUids : [];

  // Handle audience changes
  if (beforeType === 'uids' && afterType === 'uids') {
    const beforeSet = new Set(beforeUids);
    const afterSet = new Set(afterUids);

    const removed = beforeUids.filter((u) => !afterSet.has(u));
    if (removed.length) await deleteInboxForUids(dojoId, noticeId, removed);

    if (afterUids.length) await fanoutInboxForUidsUpdate(dojoId, noticeId, after, afterUids);
  } else if (beforeType !== 'uids' && afterType === 'uids') {
    if (afterUids.length) await fanoutInboxForUidsCreate(dojoId, noticeId, after, afterUids);
  } else if (beforeType === 'uids' && afterType !== 'uids') {
    if (beforeUids.length) await deleteInboxForUids(dojoId, noticeId, beforeUids);
  }
}

export async function getNotice(dojoId: string, noticeId: string): Promise<NoticeRow | null> {
  const ref = doc(db(), 'dojos', dojoId, 'notices', noticeId);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as NoticeRow) : null;
}

// ─────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────
function snapToRows(snap: any): NoticeRow[] {
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) as NoticeRow[];
}

function mergeRows(a: NoticeRow[], b: NoticeRow[]): NoticeRow[] {
  const m = new Map<string, NoticeRow>();
  for (const r of a) m.set(r.id, r);
  for (const r of b) m.set(r.id, r);

  const out = Array.from(m.values());
  out.sort((x, y) => asDate(y.sendAt).getTime() - asDate(x.sendAt).getTime());
  return out;
}

// Staff: realtime list (all docs)
export function subscribeNoticesForStaff(
  dojoId: string,
  onRows: (rows: NoticeRow[]) => void,
  onError?: (err: any) => void,
  n = 200
): Unsubscribe {
  const col = collection(db(), 'dojos', dojoId, 'notices');
  const q = query(col, orderBy('endTime', 'desc'), limit(n));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as NoticeRow[];
      onRows(rows);
    },
    onError
  );
}

// Inbox fallback subscription
function subscribeMemberInboxFallback(
  dojoId: string,
  uid: string,
  onRows: (rows: NoticeRow[]) => void,
  onError?: (err: any) => void,
  n = 100
): Unsubscribe {
  const col = collection(db(), 'dojos', dojoId, 'members', uid, MEMBER_INBOX_SUBCOL);

  const now = nowForQuery();
  const minTs = Timestamp.fromMillis(0);

  const qInbox = query(
    col,
    where('status', 'in', ['sent', 'scheduled']),
    where('sendAt', '>=', minTs),
    where('sendAt', '<=', now),
    orderBy('sendAt', 'desc'),
    limit(n)
  );

  return onSnapshot(
    qInbox,
    (snap) => {
      const rows = snap.docs.map((d: any) => {
        const data = d.data() as any;
        return { id: d.id, ...(data ?? {}) } as NoticeRow;
      });
      onRows(rows);
    },
    onError
  );
}

/**
 * ✅ Member: realtime list
 * 
 * Strategy:
 * 1. qAll: notices with audienceType='all' (everyone can see)
 * 2. inbox: notices in members/{uid}/noticeInbox (targeted notices via fanout)
 * 
 * Note: We don't query notices with audienceType='uids' directly because
 * Firestore Rules can't efficiently validate array-contains queries.
 * Instead, staff fanouts targeted notices to each member's inbox.
 */
export function subscribeNoticesForMember(
  dojoId: string,
  uid: string,
  onRows: (rows: NoticeRow[]) => void,
  onError?: (err: any) => void,
  n = 100
): Unsubscribe {
  const col = collection(db(), 'dojos', dojoId, 'notices');

  const now = nowForQuery();
  const minTs = Timestamp.fromMillis(0);

  // Query for notices visible to all members
  const qAll = query(
    col,
    where('status', 'in', ['sent', 'scheduled']),
    where('audienceType', '==', 'all'),
    where('sendAt', '>=', minTs),
    where('sendAt', '<=', now),
    orderBy('sendAt', 'desc'),
    limit(n)
  );

  let rowsAll: NoticeRow[] = [];
  let rowsInbox: NoticeRow[] = [];

  let readyAll = false;
  let readyInbox = false;

  let unsubAll: Unsubscribe | null = null;
  let unsubInbox: Unsubscribe | null = null;

  const emit = () => {
    if (!readyAll || !readyInbox) return;
    onRows(mergeRows(rowsAll, rowsInbox));
  };

  // Subscribe to qAll (notices for everyone)
  unsubAll = onSnapshot(
    qAll,
    (snap) => {
      rowsAll = snapToRows(snap);
      readyAll = true;
      console.log(`[subscribeNoticesForMember] qAll: ${rowsAll.length} notices`);
      emit();
    },
    (err) => {
      console.error('[subscribeNoticesForMember] qAll error', err);

      if (isPermissionDenied(err)) {
        rowsAll = [];
        readyAll = true;
        emit();
        return;
      }

      onError?.(err);
    }
  );

  // Subscribe to inbox (targeted notices via fanout)
  console.log(`[subscribeNoticesForMember] Subscribing to inbox for ${uid}`);
  unsubInbox = subscribeMemberInboxFallback(
    dojoId,
    uid,
    (rows) => {
      rowsInbox = rows;
      readyInbox = true;
      console.log(`[subscribeNoticesForMember] inbox: ${rowsInbox.length} notices`);
      emit();
    },
    (err) => {
      console.error('[subscribeNoticesForMember] inbox error', err);

      if (isPermissionDenied(err)) {
        rowsInbox = [];
        readyInbox = true;
        emit();
        onError?.(err);
        return;
      }

      onError?.(err);
    },
    n
  );

  return () => {
    try { unsubAll?.(); } catch {}
    try { unsubInbox?.(); } catch {}
  };
}