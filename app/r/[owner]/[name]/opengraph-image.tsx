import { ImageResponse } from "next/og";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { repos } from "@/db/schema";

export const alt = "compass — AI codebase guide";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Dynamic OpenGraph image for /r/[owner]/[name].
 *
 * Renders at request time via the next/og edge image renderer. Reads the
 * repo + summary from the DB so the image matches the most recent state.
 * Every leaf <div> with more than one child explicitly sets `display: flex`
 * (ImageResponse refuses to render otherwise).
 *
 * Hidden private repos still get an image, but with a generic body — we
 * don't want to leak the summary in a shareable preview.
 */
export default async function OpenGraphImage(props: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await props.params;
  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.owner, owner), eq(repos.name, name)),
  });

  const fullName = repo?.fullName ?? `${owner}/${name}`;
  const purpose =
    repo && !repo.isPrivate
      ? repo.summary?.purpose ??
        repo.description ??
        "AI-guided codebase tour."
      : "Private repository — sign in to view the guide.";
  const techStack =
    repo && !repo.isPrivate ? repo.summary?.techStack?.slice(0, 6) ?? [] : [];
  const fileCount = repo?.fileCount ?? 0;
  const embeddingCount = repo?.embeddingCount ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0e14",
          color: "#e6edf3",
          padding: 64,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          backgroundImage:
            "radial-gradient(circle at top right, rgba(0,217,255,0.15) 0%, transparent 50%)",
        }}
      >
        {/* Header: brand mark + label */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 60,
              height: 60,
              borderRadius: 14,
              background: "#00d9ff",
              color: "#0a0e14",
              fontSize: 36,
            }}
          >
            🧭
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              compass
            </span>
            <span
              style={{
                fontSize: 14,
                color: "#8b949e",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              AI codebase guide
            </span>
          </div>
        </div>

        {/* Body: repo name + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            marginTop: 72,
            maxWidth: 980,
          }}
        >
          <span
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: "#e6edf3",
            }}
          >
            {fullName}
          </span>
          <span
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              color: "#a8b3c2",
              fontWeight: 400,
            }}
          >
            {purpose.length > 180 ? purpose.slice(0, 177) + "…" : purpose}
          </span>
        </div>

        {/* Footer: tech stack pills + stats */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "auto",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {techStack.map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 16px",
                  borderRadius: 9999,
                  border: "1px solid rgba(0,217,255,0.4)",
                  background: "rgba(0,217,255,0.08)",
                  color: "#00d9ff",
                  fontSize: 20,
                  fontWeight: 600,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {t}
              </div>
            ))}
          </div>
          {fileCount > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                color: "#8b949e",
                fontSize: 20,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              <span style={{ color: "#e6edf3", fontWeight: 700 }}>
                {fileCount}
              </span>
              <span>files</span>
              <span style={{ opacity: 0.4, margin: "0 8px" }}>·</span>
              <span style={{ color: "#e6edf3", fontWeight: 700 }}>
                {embeddingCount}
              </span>
              <span>chunks</span>
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
