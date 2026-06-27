// app/dojos/search/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { dbNullable } from "@/firebase";
import { searchPublicDojosByPrefix } from "@/lib/searchDojos";

type DojoRow = {
  id: string;
  name?: string;
  nameLower?: string;
  isPublic?: boolean;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
};

export default function DojoSearchPage() {
  const t = useTranslations("search");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<DojoRow[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const handle = setTimeout(async () => {
      setErr("");

      const s = term.trim();
      if (!s) {
        setRows([]);
        return;
      }

      if (!dbNullable) {
        setErr(t("firestoreNotReady"));
        return;
      }

      setBusy(true);
      try {
        const result = await searchPublicDojosByPrefix(dbNullable, s, 30);
        setRows(result as DojoRow[]);
      } catch (e: any) {
        setErr(e?.message || t("searchFailed"));
      } finally {
        setBusy(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [term, t]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t("title")}</h1>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        {t("subtitle")}
      </p>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t("placeholder")}
        style={{ width: "100%", padding: 12, borderRadius: 12, marginTop: 12 }}
      />

      {busy && <div style={{ marginTop: 10, opacity: 0.7 }}>{t("searching")}</div>}

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ffb4b4", borderRadius: 10 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rows.map((d) => (
          <div key={d.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontWeight: 700 }}>{d.name ?? t("noName")}</div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>
              {(d.city ?? "").toString()} {(d.country ?? "").toString()}
            </div>
            {(d.website || d.phone) && (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                {d.website ? <div>🌐 {d.website}</div> : null}
                {d.phone ? <div>☎️ {d.phone}</div> : null}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>id: {d.id}</div>
          </div>
        ))}

        {!busy && !err && term.trim() && rows.length === 0 && (
          <div style={{ marginTop: 10, opacity: 0.7 }}>{t("noResults")}</div>
        )}
      </div>
    </div>
  );
}
