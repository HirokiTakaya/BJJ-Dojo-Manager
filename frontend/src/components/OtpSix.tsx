"use client";

import React, { useEffect, useMemo, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  name?: string;
};

export default function OtpSix({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
  name = "otp",
}: Props) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const digits = useMemo(() => {
    const v = (value || "").replace(/\D/g, "").slice(0, 6);
    const arr = v.split("");
    while (arr.length < 6) arr.push("");
    return arr;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    inputs.current[0]?.focus();
  }, [autoFocus]);

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = (d || "").replace(/\D/g, "").slice(-1);
    const joined = next.join("").replace(/\s/g, "");
    onChange(joined);
    if (joined.length === 6) onComplete?.(joined);
  };

  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "14px 0" }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el; }}
          name={`${name}-${i}`}
          inputMode="numeric"
          pattern="\d*"
          value={d}
          disabled={disabled}
          onChange={(e) => {
            setAt(i, e.target.value);
            if (e.target.value && i < 5) inputs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              inputs.current[i - 1]?.focus();
            }
          }}
          style={{
            width: 44,
            height: 52,
            fontSize: 22,
            textAlign: "center",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
          }}
        />
      ))}
    </div>
  );
}
