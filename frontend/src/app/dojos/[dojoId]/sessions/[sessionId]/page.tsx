import { Suspense } from "react";
import SessionDetailClient from "./SessionDetailClient";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export default function SessionDetailPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            padding: 24,
            background: "#0b1b22",
            minHeight: "100vh",
            color: "white",
          }}
        >
          Loading...
        </div>
      }
    >
      <SessionDetailClient />
    </Suspense>
  );
}
