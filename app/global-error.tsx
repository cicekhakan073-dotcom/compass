"use client";

/**
 * Last-resort error boundary: when the root layout itself crashes Next will
 * unmount the entire tree and render this component. Because layout.tsx is
 * gone we must include our own <html>/<body> and use inline styles (Tailwind
 * may not be injected at this point).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0e14",
          color: "#e6edf3",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p
            style={{
              color: "#00d9ff",
              fontWeight: 800,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            kritik hata
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0" }}>
            compass yüklenemedi
          </h1>
          <p style={{ color: "#a8b3c2", fontSize: "0.875rem" }}>
            Root layout patladı — bu sık olmaz. Sayfayı tazelemen genelde yeter.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 12,
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                background: "#161b22",
                padding: "4px 8px",
                borderRadius: 6,
                display: "inline-block",
              }}
            >
              {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              background: "#00d9ff",
              color: "#0a0e14",
              border: 0,
              borderRadius: 8,
              padding: "8px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Yeniden dene
          </button>
        </div>
      </body>
    </html>
  );
}
