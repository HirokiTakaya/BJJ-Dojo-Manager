"use client";

import React from "react";
import type { StudentLite } from "@/lib/students";

export function StudentPickList({
  students,
  renderRight,
  emptyLabel = "No students found.",
}: {
  students: StudentLite[];
  renderRight?: (s: StudentLite) => React.ReactNode;
  emptyLabel?: string;
}) {
  if (!students.length) {
    return <div style={{ opacity: 0.7, marginTop: 10 }}>{emptyLabel}</div>;
  }

  return (
    <div
      style={{
        marginTop: 10,
        border: "1px solid rgba(0,0,0,0.15)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {students.map((s) => (
        <div
          key={s.uid}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            padding: 10,
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            background: "white",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800 }}>{s.displayName || "(no name)"}</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {s.email || ""} <span style={{ opacity: 0.5 }}>uid: {s.uid}</span>
            </div>
          </div>

          <div>{renderRight?.(s)}</div>
        </div>
      ))}
    </div>
  );
}
