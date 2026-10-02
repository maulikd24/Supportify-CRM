"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort error screen for failures outside any route's error boundary
 * (e.g. a layout). Replaces Next's unbranded "This page couldn't load".
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f2e7", color: "#0b0d26" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <div
              style={{
                margin: "0 auto 16px",
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#4b4fcc",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
              }}
            >
              S
            </div>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: "#5b5f7a", margin: "0 0 20px" }}>
              This page couldn&apos;t load. Try again — if it keeps happening, contact support with the reference below.
            </p>
            <button
              onClick={() => reset()}
              style={{ background: "#4b4fcc", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
            {error.digest && <p style={{ marginTop: 20, fontSize: 12, color: "#5b5f7a" }}>Reference {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
