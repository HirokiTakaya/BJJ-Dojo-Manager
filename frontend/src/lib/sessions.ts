import {
  type Firestore,
  type Timestamp,
  type FieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

/**
 * Firestore Timestamp は「書き込み時(FieldValue) / 読み取り後(Timestamp)」で型が変わるので両対応
 */
type FireTs = Timestamp | FieldValue;

export type DojoSession = {
  id: string; // sessionId (doc id)
  dojoId: string;

  // timetable class snapshot
  timetableClassId: string;
  title: string;
  weekday: number; // 0..6
  startMinute: number; // 0..1439
  durationMinute: number;

  // ✅ Added: instructor field
  instructor?: string | null;

  /**
   * その日の開催を表すキー（YYYY-MM-DD）
   * ※ timezone は「その環境のローカル日付」基準。後で dojoTimezone を入れたくなったら拡張できる。
   */
  dateKey: string;

  /**
   * 検索/並び替え用（例: dateKey + startMinute）
   * 既存データを壊さないため optional にしている
   */
  sortKey?: string;

  createdBy?: string | null;

  createdAt?: FireTs;
  updatedAt?: FireTs;
};

export type AttendanceMark = {
  id: string; // studentId (doc id)
  studentId: string;

  present: boolean;

  /**
   * スタッフがチェックした情報
   */
  checkedBy?: string | null;
  checkedAt?: FireTs;

  note?: string | null;

  createdAt?: FireTs;
  updatedAt?: FireTs;
};

const MINUTES_PER_DAY = 24 * 60;

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(min, Math.min(max, x));
}

function normalizeWeekday(weekday: number) {
  return clampInt(weekday, 0, 6);
}

function normalizeStartMinute(startMinute: number) {
  return clampInt(startMinute, 0, MINUTES_PER_DAY - 1);
}

function normalizeDurationMinute(durationMinute: number) {
  // 1..480 (8h) くらいで制限（必要なら変更OK）
  return clampInt(durationMinute, 1, 8 * 60);
}

export function toDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function isValidDateKey(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s ?? "").trim());
}

/**
 * セッション docId を決定的にする（同じ日・同じクラスなら重複作成しない）
 * ※ Firestore doc id に "/" は使えないので安全策として replace
 */
export function makeSessionId(dateKey: string, timetableClassId: string) {
  const dk = (dateKey ?? "").trim();
  const cid = (timetableClassId ?? "").trim().replaceAll("/", "_");
  return `${dk}__${cid}`;
}

export function sessionsRef(db: Firestore, dojoId: string) {
  return collection(db, "dojos", dojoId, "sessions");
}

export function sessionDocRef(db: Firestore, dojoId: string, sessionId: string) {
  return doc(db, "dojos", dojoId, "sessions", sessionId);
}

export function attendanceRef(db: Firestore, dojoId: string, sessionId: string) {
  return collection(db, "dojos", dojoId, "sessions", sessionId, "attendance");
}

export function attendanceDocRef(
  db: Firestore,
  dojoId: string,
  sessionId: string,
  studentId: string
) {
  // 出席の docId は studentId 固定にして upsert を簡単にする
  return doc(db, "dojos", dojoId, "sessions", sessionId, "attendance", studentId);
}

function computeSessionSortKey(dateKey: string, startMinute: number) {
  // 例: 2026-01-05#0360 みたいに並び替えやすいキー
  const sm = String(normalizeStartMinute(startMinute)).padStart(4, "0");
  return `${dateKey}#${sm}`;
}

export type CreateSessionInput = {
  dojoId: string;
  timetableClassId: string;

  title: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;

  // ✅ Added: instructor field
  instructor?: string | null;

  dateKey: string;

  createdBy?: string | null;
};

/**
 * セッションを「存在すれば取得、なければ作成」する
 * - docId を決定的にして重複作成を防ぐ
 */
export async function getOrCreateSession(db: Firestore, input: CreateSessionInput) {
  const dojoId = input.dojoId;
  const dateKey = (input.dateKey ?? "").trim();
  const timetableClassId = (input.timetableClassId ?? "").trim();

  if (!dojoId) throw new Error("dojoId is required.");
  if (!isValidDateKey(dateKey)) throw new Error("dateKey must be YYYY-MM-DD.");
  if (!timetableClassId) throw new Error("timetableClassId is required.");

  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required.");

  const weekday = normalizeWeekday(input.weekday);
  const startMinute = normalizeStartMinute(input.startMinute);
  const durationMinute = normalizeDurationMinute(input.durationMinute);

  // ✅ Added: instructor
  const instructor = (input.instructor ?? "").trim() || null;

  const sessionId = makeSessionId(dateKey, timetableClassId);
  const ref = sessionDocRef(db, dojoId, sessionId);

  const snap = await getDoc(ref);
  if (snap.exists()) {
    return {
      id: snap.id,
      ...(snap.data() as any),
    } as DojoSession;
  }

  const payload: Omit<DojoSession, "id"> = {
    dojoId,
    timetableClassId,
    title,
    weekday,
    startMinute,
    durationMinute,
    instructor, // ✅ Added
    dateKey,
    sortKey: computeSessionSortKey(dateKey, startMinute),
    createdBy: input.createdBy ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, payload);
  return { id: sessionId, ...payload } as DojoSession;
}

/**
 * セッション1件取得
 */
export async function getSession(db: Firestore, dojoId: string, sessionId: string) {
  const ref = sessionDocRef(db, dojoId, sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as any) } as DojoSession;
}

/**
 * 特定日のセッション一覧（dateKey で取得）
 * - startMinute 順に並べる
 * - インデックスが必要になる場合あり（Firestore が案内してくるはず）
 */
export async function listSessionsByDate(db: Firestore, dojoId: string, dateKey: string) {
  const dk = (dateKey ?? "").trim();
  if (!isValidDateKey(dk)) throw new Error("dateKey must be YYYY-MM-DD.");

  const q = query(sessionsRef(db, dojoId), where("dateKey", "==", dk), orderBy("startMinute", "asc"));

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DojoSession[];
}

/**
 * 期間でセッション一覧（dateKey の範囲）
 * - 例: 2026-01-01 .. 2026-01-31
 */
export async function listSessionsInDateRange(
  db: Firestore,
  dojoId: string,
  fromDateKey: string,
  toDateKey: string
) {
  const from = (fromDateKey ?? "").trim();
  const to = (toDateKey ?? "").trim();
  if (!isValidDateKey(from) || !isValidDateKey(to)) throw new Error("dateKey must be YYYY-MM-DD.");

  const q = query(
    sessionsRef(db, dojoId),
    where("dateKey", ">=", from),
    where("dateKey", "<=", to),
    orderBy("dateKey", "asc"),
    orderBy("startMinute", "asc")
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DojoSession[];
}

/**
 * セッションの情報を部分更新
 * - weekday/startMinute を変えたら sortKey も更新する
 */
export async function updateSession(
  db: Firestore,
  dojoId: string,
  sessionId: string,
  patch: Partial<Omit<DojoSession, "id" | "dojoId" | "timetableClassId" | "createdAt">>
) {
  const ref = sessionDocRef(db, dojoId, sessionId);

  // 現在値も見て sortKey を正しく更新したい
  const curSnap = await getDoc(ref);
  const cur = (curSnap.exists() ? (curSnap.data() as any) : {}) as any;

  const next: any = { ...patch };

  if (typeof next.title === "string") next.title = next.title.trim();

  // ✅ Added: instructor handling
  if (typeof next.instructor === "string") {
    next.instructor = next.instructor.trim() || null;
  }

  const dateKey = typeof next.dateKey === "string" ? next.dateKey.trim() : cur.dateKey ?? "";
  const weekday =
    typeof next.weekday === "number"
      ? normalizeWeekday(next.weekday)
      : normalizeWeekday(cur.weekday ?? 0);

  const startMinute =
    typeof next.startMinute === "number"
      ? normalizeStartMinute(next.startMinute)
      : normalizeStartMinute(cur.startMinute ?? 0);

  if (typeof next.weekday === "number") next.weekday = weekday;
  if (typeof next.startMinute === "number") next.startMinute = startMinute;
  if (typeof next.durationMinute === "number")
    next.durationMinute = normalizeDurationMinute(next.durationMinute);

  // dateKey も更新されるなら、形式チェック
  if (typeof next.dateKey === "string") {
    if (!isValidDateKey(dateKey)) throw new Error("dateKey must be YYYY-MM-DD.");
    next.dateKey = dateKey;
  }

  // sortKey 再計算（存在しなくてもOK）
  if (isValidDateKey(dateKey)) {
    next.sortKey = computeSessionSortKey(dateKey, startMinute);
  }

  await updateDoc(ref, {
    ...next,
    updatedAt: serverTimestamp(),
  });
}

/**
 * セッション削除
 * - 注意: subcollection(attendance) は残るので、本気で削除するなら Cloud Functions で再帰削除が必要
 */
export async function deleteSession(db: Firestore, dojoId: string, sessionId: string) {
  const ref = sessionDocRef(db, dojoId, sessionId);
  await deleteDoc(ref);
}

/**
 * 出席一覧
 */
export async function listAttendance(db: Firestore, dojoId: string, sessionId: string) {
  const q = query(attendanceRef(db, dojoId, sessionId), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AttendanceMark[];
}

export type MarkAttendanceInput = {
  studentId: string;
  present: boolean;
  checkedBy?: string | null;
  note?: string | null;
};

/**
 * 出席を付ける（upsert）
 * - docId=studentId なので「チェックON/OFF」が同じ doc に上書きされる
 */
export async function markAttendance(
  db: Firestore,
  dojoId: string,
  sessionId: string,
  input: MarkAttendanceInput
) {
  const studentId = (input.studentId ?? "").trim();
  if (!studentId) throw new Error("studentId is required.");

  const ref = attendanceDocRef(db, dojoId, sessionId, studentId);

  const payload: Omit<AttendanceMark, "id"> = {
    studentId,
    present: !!input.present,
    checkedBy: input.checkedBy ?? null,
    note: (input.note ?? "").trim() || null,
    checkedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(), // merge:true なので初回だけ意味がある
  };

  await setDoc(ref, payload, { merge: true });
}

/**
 * 出席を消す（その生徒の attendance doc を削除）
 */
export async function unmarkAttendance(
  db: Firestore,
  dojoId: string,
  sessionId: string,
  studentId: string
) {
  const sid = (studentId ?? "").trim();
  if (!sid) throw new Error("studentId is required.");
  const ref = attendanceDocRef(db, dojoId, sessionId, sid);
  await deleteDoc(ref);
}

/**
 * 便利：その日付・そのクラスの sessionId を作れるようにする
 */
export function buildSessionIdForClass(dateKey: string, timetableClassId: string) {
  if (!isValidDateKey((dateKey ?? "").trim())) throw new Error("dateKey must be YYYY-MM-DD.");
  if (!(timetableClassId ?? "").trim()) throw new Error("timetableClassId is required.");
  return makeSessionId(dateKey, timetableClassId);
}

/**
 * ✅ Timetable 側で使う class の最小形
 */
export type TimetableClassLike = {
  id: string;
  title: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
  instructor?: string | null; // ✅ Added
};

/**
 * ✅ TimetableClient が期待する返り値（{ sessionId }）
 */
export type EnsureSessionResult = {
  sessionId: string;
  session: DojoSession;
};

/**
 * ✅ 互換用 ensureSession
 *
 * 既存のロジックを壊さないために「3パターン」対応します:
 *
 * A) ensureSession(db, input: CreateSessionInput) -> DojoSession
 *    （あなたが書いていたパターン。既存維持）
 *
 * B) ensureSession(db, dojoId, dateKey, cls, createdBy?) -> DojoSession
 *    （あなたが書いていた "旧 Pattern B"。既存維持）
 *
 * C) ensureSession(db, dojoId, cls, dateOrDateKey, createdBy?) -> { sessionId, session }
 *    （TimetableClient.tsx が期待してる形）
 */

// A
export function ensureSession(db: Firestore, input: CreateSessionInput): Promise<DojoSession>;

// B（旧）
export function ensureSession(
  db: Firestore,
  dojoId: string,
  dateKey: string,
  cls: TimetableClassLike,
  createdBy?: string | null
): Promise<DojoSession>;

// C（TimetableClient 用：db, dojoId, klass, Date）
export function ensureSession(
  db: Firestore,
  dojoId: string,
  cls: TimetableClassLike,
  date: Date,
  createdBy?: string | null
): Promise<EnsureSessionResult>;

// C（TimetableClient 用：db, dojoId, klass, dateKey）
export function ensureSession(
  db: Firestore,
  dojoId: string,
  cls: TimetableClassLike,
  dateKey: string,
  createdBy?: string | null
): Promise<EnsureSessionResult>;

export async function ensureSession(
  db: Firestore,
  a: CreateSessionInput | string,
  b?: string | TimetableClassLike,
  c?: TimetableClassLike | Date | string,
  d?: string | null,
  e?: string | null
): Promise<DojoSession | EnsureSessionResult> {
  // Pattern A: ensureSession(db, input)
  if (typeof a !== "string") {
    return getOrCreateSession(db, a);
  }

  const dojoId = a;

  // Pattern B（旧）: ensureSession(db, dojoId, dateKey, cls, createdBy?)
  // → 第2引数が string の場合は dateKey とみなす
  if (typeof b === "string") {
    const dateKey = b.trim();
    const cls = c as TimetableClassLike | undefined;
    const createdBy = (d ?? null) as string | null;

    if (!dojoId) throw new Error("dojoId is required.");
    if (!isValidDateKey(dateKey)) throw new Error("dateKey must be YYYY-MM-DD.");
    if (!cls?.id) throw new Error("timetable class is required.");

    return getOrCreateSession(db, {
      dojoId,
      dateKey,
      timetableClassId: cls.id,
      title: cls.title,
      weekday: cls.weekday,
      startMinute: cls.startMinute,
      durationMinute: cls.durationMinute,
      instructor: cls.instructor ?? null, // ✅ Added
      createdBy,
    });
  }

  // Pattern C（TimetableClient）: ensureSession(db, dojoId, cls, dateOrDateKey, createdBy?)
  const cls = b as TimetableClassLike | undefined;
  const dateOrDateKey = c as Date | string | undefined;
  const createdBy = (typeof d === "string" ? d : d ?? null) as string | null;

  if (!dojoId) throw new Error("dojoId is required.");
  if (!cls?.id) throw new Error("timetable class is required.");
  if (!dateOrDateKey) throw new Error("date/dateKey is required.");

  const dateKey =
    typeof dateOrDateKey === "string" ? dateOrDateKey.trim() : toDateKey(dateOrDateKey);

  if (!isValidDateKey(dateKey)) throw new Error("dateKey must be YYYY-MM-DD.");

  const session = await getOrCreateSession(db, {
    dojoId,
    dateKey,
    timetableClassId: cls.id,
    title: cls.title,
    weekday: cls.weekday,
    startMinute: cls.startMinute,
    durationMinute: cls.durationMinute,
    instructor: cls.instructor ?? null, // ✅ Added
    createdBy,
  });

  // ✅ TimetableClient が欲しい { sessionId } を返す
  return { sessionId: session.id, session };
}