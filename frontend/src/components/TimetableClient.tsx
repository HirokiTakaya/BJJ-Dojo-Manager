"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { auth, dbNullable } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";

import WeeklyScheduleGrid, { type WeeklyClassItem } from "@/app/dojos/[dojoId]/timetable/WeeklyScheduleGrid";

// ★ API版のみ使用
import {
  WEEKDAYS,
  createTimetableClass,
  updateTimetableClass,
  deleteTimetableClass,
  listTimetable,
  minutesToHHMM,
  hhmmToMinutes,
  type TimetableClass,
} from "@/lib/timetable-api";

type UserDoc = {
  dojoId?: string | null;
  staffProfile?: { dojoId?: string | null };
};

function startOfWeekSunday(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

function minuteToHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function TimetableClient() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [dojoId, setDojoId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(new Date()));

  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // create form
  const [title, setTitle] = useState("All Levels Gi");
  const [weekday, setWeekday] = useState<number>(1);
  const [startHHMM, setStartHHMM] = useState("07:00");
  const [durationMin, setDurationMin] = useState(60);

  // 作成モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDateKey, setModalDateKey] = useState<string>("");
  const [modalWeekday, setModalWeekday] = useState<number>(1);
  const [modalStartHHMM, setModalStartHHMM] = useState("07:00");
  const [modalDurationMin, setModalDurationMin] = useState(60);
  const [modalTitle, setModalTitle] = useState("All Levels Gi");

  // 編集モーダル
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<TimetableClass | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWeekday, setEditWeekday] = useState<number>(1);
  const [editStartHHMM, setEditStartHHMM] = useState("07:00");
  const [editDurationMin, setEditDurationMin] = useState(60);

  // 削除確認モーダル
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingClass, setDeletingClass] = useState<TimetableClass | null>(null);

  // 繰り返し作成設定
  const [repeatWeeks, setRepeatWeeks] = useState<number>(4);

  // auth gate
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // load user doc -> dojoId
  useEffect(() => {
    const run = async () => {
      if (!user) return;
      if (!dbNullable) return;

      try {
        const snap = await getDoc(doc(dbNullable, "users", user.uid));
        const ud = (snap.exists() ? (snap.data() as any) : null) as UserDoc | null;
        const did = (ud?.dojoId || ud?.staffProfile?.dojoId || null) ?? null;
        setDojoId(did);
      } catch (e: any) {
        setErr(e?.message || "Failed to load user profile.");
      }
    };
    run();
  }, [user]);

  // load timetable via API
  useEffect(() => {
    const run = async () => {
      if (!dojoId) return;

      setBusy(true);
      setErr("");
      try {
        const rows = await listTimetable(dojoId);
        setClasses(rows);
      } catch (e: any) {
        console.error("[TimetableClient] listTimetable error:", e);
        setErr(e?.message || "Failed to load timetable.");
      } finally {
        setBusy(false);
      }
    };
    run();
  }, [dojoId]);

  const canCreate = useMemo(() => {
    if (!dojoId) return false;
    if (!title.trim()) return false;
    if (!/^\d{1,2}:\d{2}$/.test(startHHMM.trim())) return false;
    if (durationMin < 15) return false;
    return true;
  }, [dojoId, title, startHHMM, durationMin]);

  const refresh = async () => {
    if (!dojoId) return;
    try {
      const rows = await listTimetable(dojoId);
      setClasses(rows);
    } catch (e: any) {
      console.error("[TimetableClient] refresh error:", e);
    }
  };

  // Quick create
  const onCreate = async () => {
    if (!dojoId) return;
    if (!canCreate) return;

    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      await createTimetableClass(dojoId, {
        title: title.trim(),
        weekday,
        startMinute: hhmmToMinutes(startHHMM),
        durationMinute: durationMin,
      });
      await refresh();
      setSuccessMsg("Class created!");
    } catch (e: any) {
      console.error("[TimetableClient] onCreate error:", e);
      setErr(e?.message || "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  // 削除確認を開く
  const openDeleteConfirm = (klass: TimetableClass) => {
    setDeletingClass(klass);
    setDeleteConfirmOpen(true);
  };

  // 削除実行
  const onConfirmDelete = async () => {
    if (!dojoId || !deletingClass) return;

    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      await deleteTimetableClass(dojoId, deletingClass.id);
      setDeleteConfirmOpen(false);
      setDeletingClass(null);
      setSuccessMsg(`Deleted class: ${deletingClass.title}`);
      await refresh();
    } catch (e: any) {
      console.error("[TimetableClient] onConfirmDelete error:", e);
      setErr(e?.message || "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  // 編集モーダルを開く
  const openEditModal = (klass: TimetableClass) => {
    setEditingClass(klass);
    setEditTitle(klass.title);
    setEditWeekday(klass.weekday);
    setEditStartHHMM(minutesToHHMM(klass.startMinute));
    setEditDurationMin(klass.durationMinute);
    setEditModalOpen(true);
  };

  // 編集実行
  const onEditSave = async () => {
    if (!dojoId || !editingClass) return;

    const t = editTitle.trim();
    if (!t) return setErr("Title is required.");
    if (!/^\d{1,2}:\d{2}$/.test(editStartHHMM.trim())) return setErr("Start time must be HH:MM.");
    if (editDurationMin < 15) return setErr("Duration must be >= 15.");

    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      await updateTimetableClass(dojoId, editingClass.id, {
        title: t,
        weekday: editWeekday,
        startMinute: hhmmToMinutes(editStartHHMM),
        durationMinute: editDurationMin,
      });
      setEditModalOpen(false);
      setEditingClass(null);
      setSuccessMsg(`Updated class: ${t}`);
      await refresh();
    } catch (e: any) {
      console.error("[TimetableClient] onEditSave error:", e);
      setErr(e?.message || "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  // クラスをクリック → セッション詳細ページへ遷移（セッションIDはクラスID + dateKey）
  const onClickClass = async (klass: WeeklyClassItem, dateKey: string) => {
    if (!dojoId || !user) return;

    // セッションIDを生成（バックエンドと同じロジック）
    const sessionId = `${dateKey}__${klass.id}`;
    router.push(`/dojos/${dojoId}/sessions/${sessionId}`);
  };

  // 空き時間クリック → モーダルを開く
  const onClickEmptySlot = (args: { weekday: number; startMinute: number; dateKey: string }) => {
    setModalWeekday(args.weekday);
    setModalStartHHMM(minuteToHHMM(args.startMinute));
    setModalDurationMin(60);
    setModalTitle("All Levels Gi");
    setModalDateKey(args.dateKey);
    setModalOpen(true);
  };

  // モーダル作成確定
  const onModalCreate = async () => {
    if (!dojoId || !user) return;

    const t = modalTitle.trim();
    if (!t) return setErr("Title is required.");
    if (!/^\d{1,2}:\d{2}$/.test(modalStartHHMM.trim())) return setErr("Start time must be HH:MM.");
    if (modalDurationMin < 15) return setErr("Duration must be >= 15.");

    setBusy(true);
    setErr("");
    setSuccessMsg("");
    try {
      // クラスを作成
      await createTimetableClass(dojoId, {
        title: t,
        weekday: modalWeekday,
        startMinute: hhmmToMinutes(modalStartHHMM),
        durationMinute: modalDurationMin,
      });

      setModalOpen(false);
      setSuccessMsg(`Created class: ${t}`);
      await refresh();
    } catch (e: any) {
      console.error("[TimetableClient] onModalCreate error:", e);
      setErr(e?.message || "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (!user) return null;

  if (!dojoId) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Timetable</h1>
        <p style={{ color: "#c33" }}>dojoId が見つかりません。まず staff signup で道場を作成/選択してください。</p>
        <button onClick={() => router.push("/signup/staff?next=/dojos/timetable")} style={{ marginTop: 10, padding: 10, borderRadius: 10 }}>
          Go to Staff Signup →
        </button>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#0b1b22", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Timetable</h1>
          <div style={{ opacity: 0.75, fontSize: 13 }}>dojoId: {dojoId}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setWeekStart((p) => new Date(p.getFullYear(), p.getMonth(), p.getDate() - 7))} style={{ padding: "10px 12px", borderRadius: 10 }}>
            ← Prev
          </button>
          <button onClick={() => setWeekStart(startOfWeekSunday(new Date()))} style={{ padding: "10px 12px", borderRadius: 10 }}>
            This Week
          </button>
          <button onClick={() => setWeekStart((p) => new Date(p.getFullYear(), p.getMonth(), p.getDate() + 7))} style={{ padding: "10px 12px", borderRadius: 10 }}>
            Next →
          </button>
          <button
            onClick={() => router.push(`/dojos/${dojoId}/members`)}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(74, 222, 128, 0.15)",
              border: "1px solid rgba(74, 222, 128, 0.3)",
            }}
          >
            👥 Members
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#3b1f1f", color: "#ffd2d2" }}>
          ❌ {err}
        </div>
      )}

      {successMsg && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#1f3b2f", color: "#d2ffd2" }}>
          ✅ {successMsg}
        </div>
      )}

      {/* Quick Create form */}
      <section style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Add class (quick)</div>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 140px 140px 140px", alignItems: "center" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ padding: 10, borderRadius: 10 }} />

          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={{ padding: 10, borderRadius: 10 }}>
            {WEEKDAYS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>

          <input value={startHHMM} onChange={(e) => setStartHHMM(e.target.value)} placeholder="07:00" style={{ padding: 10, borderRadius: 10 }} />

          <input
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value || "0"))}
            placeholder="60"
            type="number"
            style={{ padding: 10, borderRadius: 10 }}
          />
        </div>

        <button
          disabled={!canCreate || busy}
          onClick={onCreate}
          style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, fontWeight: 900, opacity: busy ? 0.7 : 1 }}
        >
          {busy ? "Working..." : "Create Class"}
        </button>
      </section>

      {/* Weekly grid */}
      <section style={{ marginTop: 16 }}>
        {busy && <div style={{ opacity: 0.75, marginBottom: 8 }}>Loading…</div>}

        <WeeklyScheduleGrid
          weekStart={weekStart}
          classes={classes.map((c) => ({
            id: c.id,
            title: c.title,
            weekday: c.weekday,
            startMinute: c.startMinute,
            durationMinute: c.durationMinute,
          }))}
          onClickClass={onClickClass}
          onClickEmptySlot={onClickEmptySlot}
          slotMin={30}
          minHour={6}
          maxHour={22}
        />
      </section>

      {/* class list + edit/delete */}
      <section style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Registered Classes ({classes.length})</div>
        <div style={{ display: "grid", gap: 8 }}>
          {classes.length === 0 && (
            <div style={{ opacity: 0.7, padding: 10 }}>No classes yet. Add one above!</div>
          )}
          {classes.map((c) => (
            <div
              key={c.id}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 900 }}>{c.title}</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  {WEEKDAYS.find((w) => w.value === c.weekday)?.label} / {minutesToHHMM(c.startMinute)} / {c.durationMinute}min
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => openEditModal(c)}
                  disabled={busy}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "rgba(17, 168, 255, 0.15)",
                    color: "white",
                    border: "1px solid rgba(17, 168, 255, 0.3)",
                    opacity: busy ? 0.5 : 1,
                    fontWeight: 700,
                  }}
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={() => openDeleteConfirm(c)}
                  disabled={busy}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "#fca5a5",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    opacity: busy ? 0.5 : 1,
                    fontWeight: 700,
                  }}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={async () => {
          await auth.signOut();
          router.replace("/login");
        }}
        style={{
          marginTop: 18,
          borderRadius: 10,
          padding: "10px 14px",
          border: "1px solid rgba(255,255,255,0.35)",
          background: "transparent",
          color: "white",
        }}
      >
        Sign Out
      </button>

      {/* 作成モーダル */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#0b1b22",
              color: "white",
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Create Class</div>
              <button
                onClick={() => setModalOpen(false)}
                style={{ padding: "6px 10px", borderRadius: 10, background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.25)" }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
              📅 Date: <b>{modalDateKey}</b> ({WEEKDAYS.find((w) => w.value === modalWeekday)?.label})
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Class Title</div>
                <input
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Weekday</div>
                  <select
                    value={modalWeekday}
                    onChange={(e) => setModalWeekday(Number(e.target.value))}
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  >
                    {WEEKDAYS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Start Time</div>
                  <input
                    value={modalStartHHMM}
                    onChange={(e) => setModalStartHHMM(e.target.value)}
                    placeholder="07:00"
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Duration (min)</div>
                  <input
                    value={modalDurationMin}
                    onChange={(e) => setModalDurationMin(Number(e.target.value || "0"))}
                    type="number"
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  onClick={() => setModalOpen(false)}
                  style={{ padding: "12px 16px", borderRadius: 12, background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.25)", fontWeight: 700 }}
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={onModalCreate}
                  style={{
                    padding: "12px 20px",
                    borderRadius: 12,
                    fontWeight: 900,
                    background: "rgba(17, 168, 255, 0.2)",
                    border: "1px solid rgba(17, 168, 255, 0.4)",
                    color: "white",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? "Creating..." : "Create Class"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editModalOpen && editingClass && (
        <div
          onClick={() => setEditModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(480px, 100%)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#0b1b22",
              color: "white",
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>✏️ Edit Class</div>
              <button
                onClick={() => setEditModalOpen(false)}
                style={{ padding: "6px 10px", borderRadius: 10, background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.25)" }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Class Title</div>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Weekday</div>
                  <select
                    value={editWeekday}
                    onChange={(e) => setEditWeekday(Number(e.target.value))}
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  >
                    {WEEKDAYS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Start Time</div>
                  <input
                    value={editStartHHMM}
                    onChange={(e) => setEditStartHHMM(e.target.value)}
                    placeholder="07:00"
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Duration (min)</div>
                  <input
                    value={editDurationMin}
                    onChange={(e) => setEditDurationMin(Number(e.target.value || "0"))}
                    type="number"
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "white" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  onClick={() => setEditModalOpen(false)}
                  style={{ padding: "12px 16px", borderRadius: 12, background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.25)", fontWeight: 700 }}
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={onEditSave}
                  style={{
                    padding: "12px 20px",
                    borderRadius: 12,
                    fontWeight: 900,
                    background: "rgba(17, 168, 255, 0.2)",
                    border: "1px solid rgba(17, 168, 255, 0.4)",
                    color: "white",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteConfirmOpen && deletingClass && (
        <div
          onClick={() => setDeleteConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(400px, 100%)",
              borderRadius: 16,
              border: "1px solid rgba(239, 68, 68, 0.3)",
              background: "#0b1b22",
              color: "white",
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 18, color: "#fca5a5" }}>🗑️ Delete Class?</div>

            <div style={{ marginTop: 16, opacity: 0.9 }}>
              Are you sure you want to delete <b>"{deletingClass.title}"</b>?
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                style={{ padding: "12px 16px", borderRadius: 12, background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.25)", fontWeight: 700 }}
              >
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={onConfirmDelete}
                style={{
                  padding: "12px 20px",
                  borderRadius: 12,
                  fontWeight: 900,
                  background: "rgba(239, 68, 68, 0.2)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "Deleting..." : "Delete Class"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
