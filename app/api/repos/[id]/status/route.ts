import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { embeddings, files, repos } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/repos/[id]/status
 *
 * Lightweight polling endpoint for the indexing UI — returns the live row
 * counts plus repo status so the dashboard can render "2,456 / 4,801 chunks
 * embedded" without a full page reload.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const repoId = Number.parseInt(id, 10);
  if (!Number.isFinite(repoId)) {
    return NextResponse.json({ error: "Invalid repo id." }, { status: 400 });
  }
  const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) {
    return NextResponse.json({ error: "Repo not found." }, { status: 404 });
  }
  // Live row counts beat the cached repo.fileCount / repo.embeddingCount
  // while the worker is mid-flight (those columns are only stamped at the
  // end of runIngestion).
  const [filesNow] = await db
    .select({ n: count() })
    .from(files)
    .where(eq(files.repoId, repoId));
  const [embsNow] = await db
    .select({ n: count() })
    .from(embeddings)
    .where(eq(embeddings.repoId, repoId));
  return NextResponse.json({
    ok: true,
    status: repo.status,
    fileCount: filesNow.n,
    embeddingCount: embsNow.n,
    finalFileCount: repo.fileCount,
    finalEmbeddingCount: repo.embeddingCount,
    indexedAt: repo.indexedAt,
    lastError: repo.lastError,
  });
}
