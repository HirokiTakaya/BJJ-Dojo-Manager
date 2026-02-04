"use client";

import React from "react";

export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  if (!message) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        padding: 12,
        borderRadius: 12,
        background: "rgba(0,0,0,0.75)",
        color: "white",
        zIndex: 9999,
      }}
    >
      <div style={{ textAlign: "center" }}>{message}</div>
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "#b2d3db",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
