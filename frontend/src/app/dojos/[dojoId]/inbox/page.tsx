'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { dbNullable } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';

import { asDate, computeUiStatus, subscribeNoticesForMember } from '@/lib/notices';
import type { NoticeRow } from '@/lib/noticesTypes';
import { NoticeListItem } from '@/components/notices/NoticeListItem';

type UserDoc = {
  dojoId?: string | null;
  staffProfile?: { dojoId?: string | null };
  studentProfile?: { dojoId?: string | null };
};

function pickDojoIdFromUserDoc(u: UserDoc | null): string | null {
  return u?.dojoId || u?.staffProfile?.dojoId || u?.studentProfile?.dojoId || null;
}

function getParamAsString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function userDocHasDojo(u: UserDoc | null, dojoId: string): boolean {
  if (!u) return false;
  return (
    u.dojoId === dojoId ||
    u.staffProfile?.dojoId === dojoId ||
    u.studentProfile?.dojoId === dojoId
  );
}

function isPermissionDeniedMessage(msg: string): boolean {
  return msg.includes('Missing or insufficient permissions');
}

// ✅ FirebaseError.code も見る版（message だけより確実）
function isPermissionDeniedError(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? err ?? '');
  return (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    isPermissionDeniedMessage(msg)
  );
}

// ✅ inbox fallback で noticeId が別フィールドに入ってても対応
function resolveNoticeId(n: NoticeRow): string {
  const maybe = (n as any)?.noticeId;
  return typeof maybe === 'string' && maybe.length > 0 ? maybe : n.id;
}

function formatDateTime(d: Date): string {
  if (!d || isNaN(+d)) return '(invalid date)';
  return d.toLocaleString();
}

export default function InboxPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  // ① URL から dojoId（入ってればそれを使う）
  const dojoIdParam = useMemo(() => {
    return getParamAsString((params as any)?.dojoId);
  }, [params]);

  // ② URL に dojoId が無い時のために users/{uid} から補完
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState('');

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!uid) {
        if (mounted) {
          setUserDoc(null);
          setProfileErr('');
          setProfileBusy(false);
        }
        return;
      }

      // dojoId がURLにあるなら、補完は不要（既存挙動を壊さない）
      if (dojoIdParam) {
        if (mounted) {
          setProfileBusy(false);
          setProfileErr('');
        }
        return;
      }

      if (!dbNullable) {
        if (mounted) setProfileErr('Firestore is not ready (dbNullable is null).');
        return;
      }

      setProfileBusy(true);
      setProfileErr('');

      try {
        const snap = await getDoc(doc(dbNullable, 'users', uid));
        const data = snap.exists() ? (snap.data() as any) : null;
        if (mounted) setUserDoc((data ?? null) as UserDoc | null);
      } catch (e: any) {
        if (mounted) setProfileErr(e?.message || 'Failed to load user profile.');
      } finally {
        if (mounted) setProfileBusy(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [uid, dojoIdParam]);

  // ③ 最終的に使う dojoId（URL優先、無ければ userDoc から）
  const dojoId = useMemo(() => {
    return dojoIdParam || pickDojoIdFromUserDoc(userDoc);
  }, [dojoIdParam, userDoc]);

  const userDocDojoId = useMemo(() => pickDojoIdFromUserDoc(userDoc), [userDoc]);

  // ---- existing states (keep) ----
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<'all' | 'notice' | 'memo'>('all');
  const [searchText, setSearchText] = useState('');

  // ✅ 購読エラーを画面にも出す
  const [subErr, setSubErr] = useState<string>('');

  // ✅ クリック時のエラー（permission-denied を Not found にしない）
  const [clickErr, setClickErr] = useState<string>('');

  // ✅ dojoId へのアクセス判定（permission error の無限ループを止める）
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessOk, setAccessOk] = useState<boolean>(false);
  const [accessMsg, setAccessMsg] = useState<string>('');
  const [memberDocExists, setMemberDocExists] = useState<boolean | null>(null);

  const projectId = useMemo(() => {
    const pid = (dbNullable as any)?.app?.options?.projectId;
    return typeof pid === 'string' ? pid : '(unknown)';
  }, []);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setMemberDocExists(null);
      setAccessMsg('');
      setAccessOk(false);

      if (!uid) {
        setAccessBusy(false);
        return;
      }

      if (!dojoId) {
        setAccessBusy(false);
        return;
      }

      if (!dbNullable) {
        setAccessMsg('Firestore is not ready (dbNullable is null).');
        setAccessOk(false);
        setAccessBusy(false);
        return;
      }

      setAccessBusy(true);

      try {
        // 1) userDoc で所属 dojo が一致するなら OK
        if (userDocHasDojo(userDoc, dojoId)) {
          if (!mounted) return;
          setAccessOk(true);
          setAccessMsg('');
          setMemberDocExists(null);
          return;
        }

        // 2) members/{uid} が存在するか確認
        const memberRef = doc(dbNullable, 'dojos', dojoId, 'members', uid);
        const snap = await getDoc(memberRef);

        if (!mounted) return;

        setMemberDocExists(snap.exists());

        if (snap.exists()) {
          setAccessOk(true);
          setAccessMsg('');
          return;
        }

        const hint =
          dojoIdParam && userDocDojoId && dojoIdParam !== userDocDojoId
            ? `URL の dojoId (${dojoIdParam}) と、あなたの users/{uid} の dojoId (${userDocDojoId}) が一致していません。`
            : 'この dojoId に対する members/{uid} が存在しないか、ユーザープロファイル上の所属道場と一致していません。';

        setAccessOk(false);
        setAccessMsg(
          [
            'Missing or insufficient permissions になる典型パターンです。',
            hint,
            '',
            '対処:',
            `- この dojoId (${dojoId}) にあなたを /dojos/${dojoId}/members/${uid} として追加する（roleInDojo と status を設定）`,
            `- もしくは users/${uid} の dojoId / staffProfile.dojoId / studentProfile.dojoId をこの dojoId に合わせる`,
          ].join('\n')
        );
      } catch (e: any) {
        if (!mounted) return;
        setAccessOk(false);
        setAccessMsg(e?.message || 'Failed to check access.');
      } finally {
        if (mounted) setAccessBusy(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [uid, dojoId, dojoIdParam, userDoc, userDocDojoId]);

  // ④ subscribe（accessOk のときだけ）
  useEffect(() => {
    if (!uid) {
      setLoading(false);
      setRows([]);
      setSubErr('');
      return;
    }

    if (!dojoId || accessBusy) {
      setLoading(true);
      setRows([]);
      setSubErr('');
      return;
    }

    if (!accessOk) {
      setLoading(false);
      setRows([]);
      setSubErr('');
      return;
    }

    setLoading(true);
    setSubErr('');

    const unsub = subscribeNoticesForMember(
      dojoId,
      uid,
      (r) => {
        setRows(r);
        setLoading(false);
      },
      (err) => {
        console.error('[InboxPage] subscribe error', err);
        setRows([]);
        setLoading(false);
        const msg = err?.message ? String(err.message) : String(err);
        setSubErr(msg);
      }
    );

    return () => unsub();
  }, [dojoId, uid, accessBusy, accessOk]);

  const filtered = useMemo(() => {
    let r = rows.slice();

    if (tab !== 'all') r = r.filter((n) => n.type === tab);

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      r = r.filter((n) =>
        [n.title, n.body ?? '', n.type].join(' ').toLowerCase().includes(q)
      );
    }

    return r;
  }, [rows, tab, searchText]);

  const items = useMemo(() => {
    const fmtRange = (s: Date, e: Date) =>
      `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

    return filtered.map((n) => {
      const s = asDate(n.startTime);
      const e = asDate(n.endTime);

      // ✅ 追加：正しい noticeId と sendAt を保持
      const resolvedNoticeId = resolveNoticeId(n);
      const sendAt = asDate((n as any)?.sendAt);

      return {
        id: n.id, // 表示用キーとしてはそのまま
        noticeId: resolvedNoticeId, // ✅ ルーティングはこっちを使う
        row: n, // ✅ クリック時に sendAt 等を参照できるよう保持
        sendAt,

        // ✅ 表示文字だけ変更
        left: n.type === 'memo' ? 'Note' : 'Announcement',
        title: n.title,
        dateText: fmtRange(s, e),
        uiStatus: computeUiStatus(n),
      };
    });
  }, [filtered]);

  if (!uid) return <div className="p-6">Please sign in.</div>;

  const dojoIdStatus = dojoId
    ? null
    : profileBusy
      ? 'Resolving dojo…'
      : profileErr
        ? profileErr
        : 'dojoId is missing. Please complete registration (set dojoId in users/{uid}).';

  const debugText = [
    `projectId: ${projectId}`,
    `uid: ${uid}`,
    `dojoIdParam: ${dojoIdParam ?? '(none)'}`,
    `resolved dojoId: ${dojoId ?? '(none)'}`,
    `userDoc dojoId: ${userDocDojoId ?? '(none)'}`,
    `memberDocExists: ${memberDocExists === null ? '(not checked)' : String(memberDocExists)}`,
    `accessOk: ${String(accessOk)}`,
  ].join('\n');

  const extraHintForPermissions =
    subErr && isPermissionDeniedMessage(subErr)
      ? [
          '',
          'Hint:',
          '- If fallback (members/{uid}/noticeInbox) is also permission-denied, rules may be missing:',
          '  match /dojos/{dojoId}/members/{memberUid}/noticeInbox/{noticeId} { allow read: ... }',
        ].join('\n')
      : '';

  // ✅ 追加：クリックで “読めるか” を先に確認して、permission-denied を Inbox 上で説明する
  const openDetailSafely = async (it: (typeof items)[number]) => {
    const did = dojoIdParam || dojoId;
    if (!did) return;

    setClickErr('');

    // db が無いなら何もできない
    if (!dbNullable) {
      setClickErr('Firestore is not ready (dbNullable is null).');
      return;
    }

    const nid = it.noticeId;

    try {
      // ✅ ここで get 権限が無いなら例外になる（= 詳細に飛ぶ前に検知できる）
      await getDoc(doc(dbNullable, 'dojos', did, 'notices', nid));

      // 読めるなら遷移
      router.push(`/dojos/${did}/notices/${nid}`);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);

      if (isPermissionDeniedError(e)) {
        setClickErr(
          [
            'You can’t open this yet (blocked by Firestore Rules).',
            '',
            `sendAt: ${formatDateTime(it.sendAt)}`,
            '',
            'Common reasons:',
            '- sendAt is in the future (scheduled)',
            '- audience / membership link (members/users mapping)',
            '',
            `raw error: ${msg}`,
          ].join('\n')
        );
        return;
      }

      setClickErr(`Failed to open detail.\n${msg}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
                  Updates
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Announcements and notes from your dojo
                </p>
              </div>

              <div className="text-xs text-slate-500 text-right">
                <div className="font-medium text-slate-600">Dojo</div>
                <div className="truncate max-w-[180px]">{dojoId ?? '—'}</div>
              </div>
            </div>

            {/* Tabs (文字だけ変更) */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={[
                  'px-4 py-2 rounded-full text-sm font-semibold transition',
                  tab === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                ].join(' ')}
                onClick={() => setTab('all')}
              >
                All
              </button>

              <button
                className={[
                  'px-4 py-2 rounded-full text-sm font-semibold transition',
                  tab === 'notice'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                ].join(' ')}
                onClick={() => setTab('notice')}
              >
                Announcements
              </button>

              <button
                className={[
                  'px-4 py-2 rounded-full text-sm font-semibold transition',
                  tab === 'memo'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                ].join(' ')}
                onClick={() => setTab('memo')}
              >
                Notes
              </button>
            </div>

            {/* Search */}
            <div className="mt-3">
              <input
                className="
                  w-full rounded-2xl border border-slate-200 bg-white
                  px-4 py-3
                  text-slate-900 placeholder:text-slate-400
                  focus:outline-none focus:ring-2 focus:ring-slate-300
                "
                placeholder="Search announcements or notes"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Status banners */}
        {dojoIdStatus && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            {dojoIdStatus}
          </div>
        )}

        {!accessBusy && dojoId && !accessOk && accessMsg && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 whitespace-pre-wrap">
            {accessMsg}
          </div>
        )}

        {subErr && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 whitespace-pre-wrap">
            {subErr}
            {extraHintForPermissions}
          </div>
        )}

        {clickErr && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 whitespace-pre-wrap">
            {clickErr}
          </div>
        )}

        {/* Debug (折りたたみで見た目を邪魔しない) */}
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Debug
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{debugText}</pre>
        </details>

        {/* List */}
        <div className="space-y-2">
          {loading && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-700">
              Loading updates…
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500">
              Nothing new yet.
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="space-y-3">
              {items.map((it) => (
                <NoticeListItem
                  key={it.id}
                  titleLeft={it.left}     // Announcement / Note
                  titleMain={it.title}
                  dateText={it.dateText}
                  status={it.uiStatus}
                  onClick={() => openDetailSafely(it)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
