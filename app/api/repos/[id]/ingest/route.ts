import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repos } from "@/db/schema";
import { getOctokit } from "@/lib/github";
import { runIngestion } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// tree-sitter init + 100 blob fetches + parsing easily takes 20-40s
// for a medium-size repo. vercel.json upgrades this to 60s in prod.
export const maxDuration = 60;

/**
 * Manually kick off the ingestion worker for a repo. POST-only.
 * Flow:
 *   1. Load repo row, ensure it exists + has a head_sha.
 *   2. Flip status to "indexing" so the UI shows progress.
 *   3. Walk + parse + persist via runIngestion().
 *   4. On failure, mark "failed" + last_error so the user sees it.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const repoId = Number.parseInt(id, 10);
  if (!Number.isFinite(repoId)) {
    return NextResponse.json({ error: "Invalid repo id." }, { status: 400 });
  }

  const repo = await db.query.repos.findFirst({
    where: eq(repos.id, repoId),
  });
  if (!repo) {
    return NextResponse.json({ error: "Repo not found." }, { status: 404 });
  }
  if (!repo.headSha) {
    return NextResponse.json(
      { error: "Repo has no recorded head_sha. Re-ingest from the landing page first." },
      { status: 400 },
    );
  }

  // Mark as indexing immediately so concurrent pollers don't try to start
  // a second pipeline.
  await db
    .update(repos)
    .set({ status: "indexing", lastError: null, updatedAt: new Date() })
    .where(eq(repos.id, repoId));

  try {
    const octokit = await getOctokit();
    const report = await runIngestion(octokit, repoId);
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] ${repo.fullName} failed:`, err);
    await db
      .update(repos)
      .set({
        status: "failed",
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(repos.id, repoId));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
