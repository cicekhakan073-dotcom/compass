import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { files, repos } from "@/db/schema";
import { getOctokit } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 200_000;

/**
 * GET /api/repos/[id]/files?path=<repo-relative>
 *
 * Returns one indexed file's content. Used by the code viewer pane.
 * 404s if the path isn't in the indexed set — we don't proxy arbitrary
 * GitHub files to avoid abuse vectors.
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
  const path = new URL(request.url).searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Provide ?path=" }, { status: 400 });
  }

  const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) {
    return NextResponse.json({ error: "Repo not found." }, { status: 404 });
  }
  const file = await db.query.files.findFirst({
    where: and(eq(files.repoId, repoId), eq(files.path, path)),
  });
  if (!file) {
    return NextResponse.json(
      { error: "File not in indexed set." },
      { status: 404 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes > ${MAX_BYTES}).` },
      { status: 413 },
    );
  }

  try {
    const octokit = await getOctokit();
    const blob = await octokit.git.getBlob({
      owner: repo.owner,
      repo: repo.name,
      file_sha: file.sha,
    });
    const content =
      blob.data.encoding === "base64"
        ? Buffer.from(blob.data.content, "base64").toString("utf8")
        : blob.data.content;

    return NextResponse.json({
      ok: true,
      path: file.path,
      lang: file.lang,
      size: file.size,
      sha: file.sha,
      content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
