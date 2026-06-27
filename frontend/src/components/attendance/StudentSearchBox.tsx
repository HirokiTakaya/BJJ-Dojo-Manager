"use client";

import React from "react";
import { useTranslations } from "next-intl";

export function StudentSearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useTranslations("members");
  const effectivePlaceholder = placeholder ?? t("searchPlaceholder");
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value ?? "")}
      placeholder={effectivePlaceholder}
      style={{
        width: "100%",
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.15)",
      }}
    />
  );
}
