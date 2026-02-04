"use client";

import React from "react";

export function LoadingInline({ label = "Loading..." }: { label?: string }) {
  return <span style={{ opacity: 0.75, fontSize: 13 }}>{label}</span>;
}
