import {
  type Firestore,
  type Timestamp,
  type FieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

/**
 * Firestore では serverTimestamp() は FieldValue、
 * 読み出した後は Timestamp になるので両対応しておく。
 */
type FireTs = Timestamp | FieldValue;

export type TimetableClass = {
  id: string; // classId (doc id)
  title: string;
  weekday: number; // 0=Sun..6=Sat
  startMinute: number; // 0..1439
  durationMinute: number; // e.g. 60

  /**
   * 追加（既存データを壊さない）
   * - 並び替え/検索のためのキー
   * - (weekday*10000 + startMinute) みたいな安定した数値
   */
  sortKey?: number;

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
  // 1〜480（8時間）くらいに制限（好みで変更OK）
  return clampInt(durationMinute, 1, 8 * 60);
}

function computeSortKey(weekday: number, startMinute: number) {
  // 0..6 + 0..1439 → 0..61439（衝突しない）
  return normalizeWeekday(weekday) * 10000 + normalizeStartMinute(startMinute);
}

function normalizeClassInput(input: {
  title: string;
  weekday: number;
  startMinute: number;
  durationMinute: number;
}) {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required.");

  const weekday = normalizeWeekday(input.weekday);
  const startMinute = normalizeStartMinute(input.startMinute);
  const durationMinute = normalizeDurationMinute(input.durationMinute);

  return {
    title,
    weekday,
    startMinute,
    durationMinute,
    sortKey: computeSortKey(weekday, startMinute),
  };
}

export function timetableRef(db: Firestore, dojoId: string) {
  return collection(db, "dojos", dojoId, "timetable");
}

/**
 * Timetable 一覧（weekday → startMinute の順）
 * 既存と同じ並び順。追加で sortKey を「読み出し時に」補完もする。
 */
export async function listTimetable(db: Firestore, dojoId: string) {
  const q = query(
    timetableRef(db, dojoId),
    orderBy("weekday", "asc"),
    orderBy("startMinute", "asc")
  );
  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data() as any;
    const weekday = typeof data.weekday === "number" ? data.weekday : 0;
    const startMinute = typeof data.startMinute === "number" ? data.startMinute : 0;

    const row: TimetableClass = {
      id: d.id,
      ...data,
      // 既存データに sortKey が無くても壊れないように補完
      sortKey: typeof data.sortKey === "number" ? data.sortKey : computeSortKey(weekday, startMinute),
    };
    return row;
  }) as TimetableClass[];
}

export async function createTimetableClass(
  db: Firestore,
  dojoId: string,
  input: Omit<TimetableClass, "id" | "createdAt" | "updatedAt" | "sortKey">
) {
  const normalized = normalizeClassInput({
    title: input.title,
    weekday: input.weekday,
    startMinute: input.startMinute,
    durationMinute: input.durationMinute,
  });

  const ref = doc(timetableRef(db, dojoId)); // auto id
  await setDoc(ref, {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export async function updateTimetableClass(
  db: Firestore,
  dojoId: string,
  classId: string,
  patch: Partial<Omit<TimetableClass, "id">>
) {
  const ref = doc(db, "dojos", dojoId, "timetable", classId);

  // 既存データを読む（weekday/startMinute の片方だけ更新でも sortKey を正しく再計算するため）
  const snap = await getDoc(ref);
  const cur = (snap.exists() ? (snap.data() as any) : {}) as any;

  const nextWeekday =
    typeof patch.weekday === "number" ? normalizeWeekday(patch.weekday) : normalizeWeekday(cur.weekday ?? 0);

  const nextStartMinute =
    typeof patch.startMinute === "number"
      ? normalizeStartMinute(patch.startMinute)
      : normalizeStartMinute(cur.startMinute ?? 0);

  const update: any = { ...patch };

  // title を更新するなら trim
  if (typeof update.title === "string") update.title = update.title.trim();

  // weekday/startMinute/duration の正規化
  if (typeof update.weekday === "number") update.weekday = nextWeekday;
  if (typeof update.startMinute === "number") update.startMinute = nextStartMinute;
  if (typeof update.durationMinute === "number")
    update.durationMinute = normalizeDurationMinute(update.durationMinute);

  // sortKey 再計算（常に入れておくと後で便利）
  update.sortKey = computeSortKey(nextWeekday, nextStartMinute);

  await updateDoc(ref, { ...update, updatedAt: serverTimestamp() });
}

export async function deleteTimetableClass(db: Firestore, dojoId: string, classId: string) {
  const ref = doc(db, "dojos", dojoId, "timetable", classId);
  await deleteDoc(ref);
}

export function minutesToHHMM(min: number) {
  const m = clampInt(min, 0, MINUTES_PER_DAY - 1);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * 既存仕様維持：不正なら 0
 */
export function hhmmToMinutes(hhmm: string) {
  const parsed = hhmmToMinutesOrNull(hhmm);
  return parsed ?? 0;
}

/**
 * 追加：不正なら null（UIでバリデーションしたい時に便利）
 */
export function hhmmToMinutesOrNull(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];