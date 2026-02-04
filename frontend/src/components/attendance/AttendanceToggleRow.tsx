"use client";

import React from "react";
import type { AttendanceStatus } from "@/lib/attendance";

export function AttendanceToggleRow({
  status,
  onSet,
  disabled,
}: {
  status: AttendanceStatus | null;
  onSet: (s: AttendanceStatus) => void;
  disabled?: boolean;
}) {
  const btn = (label: string, s: AttendanceStatus) => {
    const active = status === s;
    return (
      <button
        type="button"
        onClick={() => onSet(s)}
        disabled={disabled}
        style={{
          padding: "8px 10px",
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.15)",
          background: active ? "rgba(0,0,0,0.08)" : "white",
          fontWeight: 800,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {btn("Present", "present")}
      {btn("Late", "late")}
      {btn("Absent", "absent")}
    </div>
  );
}
