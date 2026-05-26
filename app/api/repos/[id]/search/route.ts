import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repos } from "@/db/schema";
import { searchRepo } from "@/lib/search/semantic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/repos/:id/search?q=<query>&k=5
 *
 * Returns the top-k semantic matches for `q` from the repo's embeddings.
 * Used as a test/diagnostic surface today; Prompt 7's chat agent will call
 * `searchRepo()` directly as a tool, bypassing the HTTP hop.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const repoId = Number.parseInt(id, 10);
  if (!Number.isFinite(repoId)) {
    return NextResponse.json({ error: "Invalid repo id." }, { status: 400 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const k = Number.parseInt(url.searchParams.get("k") ?? "5", 10);

  if (!q) {
    return NextResponse.json(
      { error: "Provide a query with ?q=…" },
      { status: 400 },
    );
  }

  const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) {
    return NextResponse.json({ error: "Repo not found." }, { status: 404 });
  }
  if (repo.embeddingCount === 0) {
    return NextResponse.json(
      {
        error:
          "Bu repo henüz embed edilmemiş. /api/repos/[id]/ingest çağır (OPENAI_API_KEY gerekli).",
      },
      { status: 409 },
    );
  }

  try {
    const t0 = Date.now();
    const hits = await searchRepo(repoId, q, Number.isFinite(k) ? k : 5);
    return NextResponse.json({
      ok: true,
      query: q,
      k: hits.length,
      latencyMs: Date.now() - t0,
      hits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
