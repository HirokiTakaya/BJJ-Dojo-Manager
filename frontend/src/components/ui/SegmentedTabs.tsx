"use client";

import React from "react";

export type TabItem<T extends string> = {
  value: T;
  label: string;
};

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.15)",
              background: active ? "rgba(0,0,0,0.07)" : "white",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
