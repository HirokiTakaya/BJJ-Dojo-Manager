"use client";

import React, { useEffect, useMemo, useState } from "react";

import { dbNullable, firebaseEnabled, firebaseDisabledReason } from "@/firebase";
import { formatFirebaseErr } from "@/lib/errors";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { countPresent } from "@/lib/attendance";
import { LoadingInline } from "@/components/ui/LoadingInline";

type SessionRow = {
  id: string;
  title: string;
  dateKey: string;
  classId: string;
};

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoKey(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AttendanceDashboardClient({ dojoId }: { dojoId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Last 7 days
  const [fromKey, setFromKey] = useState(() => daysAgoKey(7));
  const [toKey, setToKey] = useState(() => todayKey());

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [presentCounts, setPresentCounts] = useState<Record<string, number>>({});

  const totalPresent = useMemo(() => {
    return Object.values(presentCounts).reduce((a, b) => a + b, 0);
  }, [presentCounts]);

  const load = async () => {
    if (!firebaseEnabled) {
      setErr(firebaseDisabledReason ?? "Firebase is disabled.");
      return;
    }
    if (!dbNullable) {
      setErr("Firestore is not ready.");
      return;
    }

    setBusy(true);
    setErr("");

    try {
      const sessionsCol = collection(dbNullable, "dojos", dojoId, "sessions");

      // dateKey range
      const q = query(
        sessionsCol,
        where("dateKey", ">=", fromKey),
        where("dateKey", "<=", toKey),
        orderBy("dateKey", "desc"),
        limit(60)
      );

      const snap = await getDocs(q);
      const rows: SessionRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: String(data.title ?? ""),
          dateKey: String(data.dateKey ?? ""),
          classId: String(data.classId ?? ""),
        };
      });

      setSessions(rows);

      const counts: Record<string, number> = {};
      // MVP: get present count per session (move to Cloud Function aggregation later if heavy)
      for (const s of rows) {
        counts[s.id] = await countPresent(dbNullable, dojoId, s.id);
      }
      setPresentCounts(counts);
    } catch (e) {
      setErr(formatFirebaseErr(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dojoId, dbNullable]);

  return (
    <div style={{ padding: 6 }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Attendance Dashboard</h1>
      <p style={{ opacity: 0.8, marginBottom: 14 }}>
        Visualize attendance counts per recent session (MVP).
      </p>

      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(255,0,0,0.25)",
            background: "rgba(255,0,0,0.06)",
          }}
        >
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>From</div>
        <input
          type="date"
          value={fromKey}
          onChange={(e) => setFromKey(e.target.value)}
          style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)" }}
        />

        <div style={{ fontWeight: 900 }}>To</div>
        <input
          type="date"
          value={toKey}
          onChange={(e) => setToKey(e.target.value)}
          style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)" }}
        />

        <button
          type="button"
          onClick={load}
          disabled={busy}
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            fontWeight: 900,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Loading..." : "Refresh"}
        </button>

        {busy && <LoadingInline />}
      </div>

      <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}>
        <div style={{ fontWeight: 900 }}>Summary</div>
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          Sessions: <b>{sessions.length}</b> / Total present marks: <b>{totalPresent}</b>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Sessions</div>

        {sessions.length === 0 && <div style={{ opacity: 0.7 }}>No sessions in this range.</div>}

        <div style={{ display: "grid", gap: 10 }}>
          {sessions.map((s) => (
            <a
              key={s.id}
              href={`/dojos/${dojoId}/sessions/${s.id}`}
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: 12,
                background: "white",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>{s.title || "(no title)"}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  {s.dateKey} · present: <b>{presentCounts[s.id] ?? 0}</b>
                </div>
              </div>
              <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>sessionId: {s.id}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
