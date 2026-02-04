"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <main style={{ padding: 16 }}>
      <h2>App Error</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{String(error?.message || error)}</pre>
      {error?.digest && <div>digest: {error.digest}</div>}
      <button onClick={reset} style={{ marginTop: 12, padding: "8px 12px" }}>
        Retry
      </button>
    </main>
  );
}
