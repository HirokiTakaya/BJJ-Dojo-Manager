"use client";

import React from "react";

export function StudentSearchBox({
  value,
  onChange,
  placeholder = "Search student name/email...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value ?? "")}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.15)",
      }}
    />
  );
}
