"use client";

import React, { useEffect, useState } from "react";
import { dbNullable } from "@/firebase";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore";

// ============================================
// Types
// ============================================

type Reservation = {
  id: string;
  memberId: string;
  memberName: string;
  status: "confirmed" | "cancelled";
  createdAt: any;
};

type SessionReservationsViewProps = {
  dojoId: string;
  sessionId: string;
  sessionTitle: string;
  sessionDateKey: string;
  isStaff: boolean;
};

// ============================================
// Component
// ============================================

export default function SessionReservationsView({
  dojoId,
  sessionId,
  sessionTitle,
  sessionDateKey,
  isStaff,
}: SessionReservationsViewProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // ✅ Improvement: simply fetch reservations from the current sessionId only
  useEffect(() => {
    const load = async () => {
      if (!dbNullable || !dojoId || !sessionId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const reservationsRef = collection(dbNullable, "dojos", dojoId, "sessions", sessionId, "reservations");
        const snap = await getDocs(reservationsRef);

        const list: Reservation[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          if (data.status !== "cancelled") {
            list.push({
              id: d.id,
              memberId: data.memberId || d.id,
              memberName: data.memberName || "Unknown",
              status: data.status || "confirmed",
              createdAt: data.createdAt,
            });
          }
        }

        // Sort by creation time
        list.sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return aTime - bTime;
        });

        setReservations(list);
      } catch (e: any) {
        console.error("[Reservations] load error:", e);
        setError(e?.message || "Failed to load reservations");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [dojoId, sessionId]);

  // Cancel a reservation (staff only)
  const cancelReservation = async (reservation: Reservation) => {
    if (!dbNullable || !isStaff) return;

    setBusy(true);
    setError("");

    try {
      const reservationRef = doc(dbNullable, "dojos", dojoId, "sessions", sessionId, "reservations", reservation.id);

      await deleteDoc(reservationRef);
      setReservations((prev) => prev.filter((r) => r.id !== reservation.id));
    } catch (e: any) {
      console.error("[Cancel] error:", e);
      setError(e?.message || "Failed to cancel reservation");
    } finally {
      setBusy(false);
    }
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return <div style={{ padding: 16, opacity: 0.7 }}>Loading reservations...</div>;
  }

  return (
    <section
      style={{
        padding: 20,
        borderRadius: 14,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>
          📋 Reservations ({reservations.length})
        </h3>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            background: "#3b1f1f",
            color: "#ffd2d2",
            fontSize: 13,
          }}
        >
          ❌ {error}
        </div>
      )}

      {reservations.length === 0 ? (
        <div style={{ opacity: 0.6, padding: "20px 0", textAlign: "center" }}>
          No reservations yet
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {reservations.map((reservation, index) => (
            <div
              key={reservation.id}
              style={{
                padding: 12,
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgba(17, 168, 255, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>

                <div>
                  <div style={{ fontWeight: 600 }}>
                    {reservation.memberName || "Unknown"}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {reservation.createdAt?.toDate
                      ? reservation.createdAt.toDate().toLocaleString("en-CA")
                      : ""}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(74, 222, 128, 0.15)",
                    color: "#4ade80",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Confirmed
                </span>

                {isStaff && (
                  <button
                    onClick={() => cancelReservation(reservation)}
                    disabled={busy}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: "#f87171",
                      fontSize: 12,
                      cursor: "pointer",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 10,
          background: "rgba(17, 168, 255, 0.08)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ opacity: 0.8 }}>Total reservations</span>
        <span style={{ fontWeight: 900, fontSize: 18, color: "#11a8ff" }}>
          {reservations.length}
        </span>
      </div>
    </section>
  );
}
