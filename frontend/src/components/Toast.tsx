/**
 * Toast notification component
 * ファイル: /components/Toast.tsx
 */

"use client";

import React, { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
  position?: "top" | "bottom";
}

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

const COLORS: Record<ToastType, { bg: string; border: string }> = {
  success: {
    bg: "rgba(34, 197, 94, 0.95)",
    border: "#22c55e",
  },
  error: {
    bg: "rgba(239, 68, 68, 0.95)",
    border: "#ef4444",
  },
  info: {
    bg: "rgba(59, 130, 246, 0.95)",
    border: "#3b82f6",
  },
  warning: {
    bg: "rgba(245, 158, 11, 0.95)",
    border: "#f59e0b",
  },
};

export default function Toast({
  message,
  type = "info",
  duration = 5000,
  onClose,
  position = "bottom",
}: ToastProps) {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, 200);
  };

  if (!visible) return null;

  const colors = COLORS[type];

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        [position]: 12,
        zIndex: 9999,
        animation: exiting
          ? "toastSlideOut 0.2s ease-out forwards"
          : "toastSlideIn 0.3s ease-out",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "12px 16px",
          borderRadius: 12,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          color: "white",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {/* Icon */}
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {ICONS[type]}
          </span>

          {/* Message */}
          <span style={{ flex: 1, fontSize: 14 }}>{message}</span>

          {/* Close button */}
          <button
            onClick={handleClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: 6,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              cursor: "pointer",
              fontSize: 16,
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <style>{`
        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateY(${position === "bottom" ? "20px" : "-20px"});
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes toastSlideOut {
          from {
            opacity: 1;
            transform: translateY(0);
          }
          to {
            opacity: 0;
            transform: translateY(${position === "bottom" ? "20px" : "-20px"});
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Toast hook for managing multiple toasts
// ─────────────────────────────────────────────
interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (message: string, type: ToastType = "info", duration = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  };

  const hideToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const ToastContainer = () => (
    <>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 12 + index * 70,
            zIndex: 9999 - index,
          }}
        >
          <Toast
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => hideToast(toast.id)}
          />
        </div>
      ))}
    </>
  );

  return {
    showToast,
    hideToast,
    ToastContainer,
    success: (msg: string, duration?: number) => showToast(msg, "success", duration),
    error: (msg: string, duration?: number) => showToast(msg, "error", duration),
    info: (msg: string, duration?: number) => showToast(msg, "info", duration),
    warning: (msg: string, duration?: number) => showToast(msg, "warning", duration),
  };
}