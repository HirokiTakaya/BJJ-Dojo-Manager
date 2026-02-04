// app/dojos/search/page.tsx
"use client";

import React, { useEffect, useState } from "react";
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
        setErr("Firestore is not ready.");
        return;
      }

      setBusy(true);
      try {
        const result = await searchPublicDojosByPrefix(dbNullable, s, 30);
        setRows(result as DojoRow[]);
      } catch (e: any) {
        setErr(e?.message || "Search failed.");
      } finally {
        setBusy(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Search Dojos</h1>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Dojo名の前方一致で検索します（public dojos）。
      </p>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="例: Gracie / Roll / Alliance ..."
        style={{ width: "100%", padding: 12, borderRadius: 12, marginTop: 12 }}
      />

      {busy && <div style={{ marginTop: 10, opacity: 0.7 }}>Searching...</div>}

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ffb4b4", borderRadius: 10 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rows.map((d) => (
          <div key={d.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontWeight: 700 }}>{d.name ?? "(no name)"}</div>
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
          <div style={{ marginTop: 10, opacity: 0.7 }}>No results.</div>
        )}
      </div>
    </div>
  );
}
