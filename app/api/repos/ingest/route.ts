import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { repos } from "@/db/schema";
import { parseRepoUrl } from "@/lib/parseRepoUrl";
import { fetchRepoMetadata, getOctokit } from "@/lib/github";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IngestRequest {
  url: string;
}

export async function POST(request: Request) {
  // Ingest is expensive (tree walk + GitHub API + LLM); 10/h per IP is plenty
  // for normal demo usage but still trips bots.
  const ip = clientIp(request);
  const rl = await rateLimit("ingest", ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: `Çok hızlı ingest isteği. ${Math.ceil(rl.resetMs / 1000)}s sonra tekrar dene.`,
      },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseRepoUrl(body.url ?? "");
  if (!parsed) {
    return NextResponse.json(
      { error: "Geçerli bir GitHub repo URL'si gir." },
      { status: 400 },
    );
  }

  const session = await auth();
  const requestedBy = session?.user?.id ?? null;

  // 1. Pull repo metadata from GitHub (auth'd if signed in, anon otherwise).
  let meta;
  try {
    const octokit = await getOctokit();
    meta = await fetchRepoMetadata(octokit, parsed.owner, parsed.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // 2. Upsert the repo row. We re-queue on HEAD change so re-ingesting later
  //    picks up new commits; otherwise we return the existing row untouched.
  const existing = await db.query.repos.findFirst({
    where: (r, { and, eq: e }) =>
      and(e(r.owner, meta.owner), e(r.name, meta.name)),
  });

  if (existing) {
    if (existing.headSha === meta.headSha && existing.status !== "failed") {
      return NextResponse.json({
        ok: true,
        repoId: existing.id,
        status: existing.status,
        fullName: existing.fullName,
        owner: existing.owner,
        name: existing.name,
        message:
          existing.status === "ready"
            ? "Bu repo zaten indekslenmiş."
            : "Bu repo zaten kuyruğa alınmış.",
      });
    }
    // HEAD moved or last attempt failed — reset to queued.
    const [updated] = await db
      .update(repos)
      .set({
        headSha: meta.headSha,
        defaultBranch: meta.defaultBranch,
        description: meta.description,
        isPrivate: meta.isPrivate,
        status: "queued",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(repos.id, existing.id))
      .returning();
    return NextResponse.json({
      ok: true,
      repoId: updated.id,
      status: updated.status,
      fullName: updated.fullName,
      owner: updated.owner,
      name: updated.name,
      message: "Repo yeniden kuyruğa alındı (HEAD değişmiş).",
    });
  }

  const [created] = await db
    .insert(repos)
    .values({
      owner: meta.owner,
      name: meta.name,
      fullName: meta.fullName,
      defaultBranch: meta.defaultBranch,
      headSha: meta.headSha,
      description: meta.description,
      isPrivate: meta.isPrivate,
      status: "queued",
      requestedBy,
    })
    .returning();

  // Touch updatedAt so callers can poll status changes cleanly.
  void sql;
  return NextResponse.json({
    ok: true,
    repoId: created.id,
    status: created.status,
    fullName: created.fullName,
    owner: created.owner,
    name: created.name,
    message: "Repo kuyruğa alındı. Prompt 4'te worker indeksleyecek.",
  });
}
