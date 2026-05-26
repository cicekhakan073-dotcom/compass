import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { embeddings, files } from "@/db/schema";
import { embedQuery } from "@/lib/embeddings/embed";

export interface SearchHit {
  fileId: number;
  path: string;
  lang: string;
  chunkIndex: number;
  symbolName: string | null;
  kind: typeof embeddings.$inferSelect.kind;
  content: string;
  startLine: number | null;
  endLine: number | null;
  /** Lower = more similar (cosine distance). UI converts to "97%" etc. */
  distance: number;
}

const DEFAULT_K = 5;
const MAX_K = 20;
/** Hard upper bound on the snippet sent back over the wire. */
const SNIPPET_MAX_CHARS = 1_500;

/**
 * Semantic search over a single repo's chunks.
 *
 * 1. Embed the query text once.
 * 2. ORDER BY embedding `<=>` query (pgvector cosine distance — uses our
 *    HNSW index from Prompt 3, no full scan).
 * 3. Join `files` for path + language so callers don't have to round-trip.
 *
 * Returns at most `k` hits, capped at MAX_K to keep payloads small.
 */
export async function searchRepo(
  repoId: number,
  query: string,
  k = DEFAULT_K,
): Promise<SearchHit[]> {
  const limit = Math.min(MAX_K, Math.max(1, Math.floor(k)));
  const trimmed = query.trim();
  if (!trimmed) return [];

  const vector = await embedQuery(trimmed);
  // pgvector wants the vector as a Postgres array literal string like `[0.1, …]`.
  const vectorLiteral = `[${vector.join(",")}]`;

  const rows = await db
    .select({
      fileId: embeddings.fileId,
      path: files.path,
      lang: files.lang,
      chunkIndex: embeddings.chunkIndex,
      symbolName: embeddings.symbolName,
      kind: embeddings.kind,
      content: embeddings.content,
      startLine: embeddings.startLine,
      endLine: embeddings.endLine,
      distance: sql<number>`${embeddings.embedding} <=> ${vectorLiteral}::vector`.as(
        "distance",
      ),
    })
    .from(embeddings)
    .innerJoin(files, eq(files.id, embeddings.fileId))
    .where(and(eq(embeddings.repoId, repoId)))
    .orderBy(sql`distance`)
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    content:
      r.content.length > SNIPPET_MAX_CHARS
        ? r.content.slice(0, SNIPPET_MAX_CHARS) + "\n…"
        : r.content,
  }));
}
