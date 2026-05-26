import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Octokit } from "@octokit/rest";
import { db } from "@/db";
import {
  embeddings,
  files,
  repos,
  symbolDefinitions,
  symbolReferences,
} from "@/db/schema";
import { embedTexts } from "@/lib/embeddings/embed";
import { generateRepoSummary } from "@/lib/summary/architect";
import {
  parseFile,
  type ParseResult,
  type SemanticChunk,
  type SymbolDefinitionLite,
  type SymbolReferenceLite,
} from "./parser";
import { walkRepoFiles, type WalkedFile } from "./walker";

export interface IngestReport {
  repoId: number;
  filesIndexed: number;
  chunksExtracted: number;
  embeddingsCreated: number;
  symbolsExtracted: { definitions: number; references: number };
  summaryGenerated: boolean;
  totalCandidates: number;
  skipped: { binary: number; tooLarge: number; unsupported: number };
  truncated: boolean;
}

const BLOB_CONCURRENCY = 8;
const DEFAULT_FILE_LIMIT = 120;
const SYMBOL_INSERT_BATCH = 1_000;

interface ParsedFile {
  entry: WalkedFile;
  source: string;
  chunks: SemanticChunk[];
  definitions: SymbolDefinitionLite[];
  references: SymbolReferenceLite[];
}

/**
 * Full repo ingestion: walk → fetch + parse → save files → embed chunks
 * → save embeddings. All four phases run inside the same request so the
 * UI can show a single "ready" state without polling a job queue.
 *
 * If embedding fails (no API key, network), files are still saved and the
 * repo is marked ready with embedding_count=0 — search will just return
 * empty until embeddings are re-run.
 */
export async function runIngestion(
  octokit: Octokit,
  repoId: number,
  options: { limit?: number; skipEmbeddings?: boolean } = {},
): Promise<IngestReport> {
  const repo = await db.query.repos.findFirst({
    where: eq(repos.id, repoId),
  });
  if (!repo) throw new Error(`Repo ${repoId} not found`);
  if (!repo.headSha) throw new Error(`Repo ${repoId} has no head_sha`);

  const limit = options.limit ?? DEFAULT_FILE_LIMIT;

  // 1. Walk the tree.
  const walk = await walkRepoFiles(
    octokit,
    repo.owner,
    repo.name,
    repo.headSha,
    limit,
  );

  // 2. Wipe stale rows for this repo. FK cascades drop embeddings too.
  await db.delete(files).where(eq(files.repoId, repoId));

  // 3. Fetch + parse all candidate files. We collect everything in memory
  //    before the next phase so we have file ids alongside chunks.
  const parsed: ParsedFile[] = [];
  for (let i = 0; i < walk.files.length; i += BLOB_CONCURRENCY) {
    const batch = walk.files.slice(i, i + BLOB_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (entry): Promise<ParsedFile> => {
        const blob = await octokit.git.getBlob({
          owner: repo.owner,
          repo: repo.name,
          file_sha: entry.sha,
        });
        const source = decodeBlob(blob.data.content, blob.data.encoding);
        const parseRes: ParseResult = await parseFile(source, entry.lang);
        return {
          entry,
          source,
          chunks: parseRes.chunks,
          definitions: parseRes.definitions,
          references: parseRes.references,
        };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") parsed.push(r.value);
      else console.warn(`[ingest] blob fetch/parse failed:`, r.reason);
    }
  }

  // 4. Insert file rows. We insert one batch and read ids back in the same
  //    insertion order so we can join them with `parsed[]` 1:1.
  let fileRowsInserted: { id: number }[] = [];
  if (parsed.length > 0) {
    const fileInserts: typeof files.$inferInsert[] = parsed.map((p) => ({
      repoId,
      path: p.entry.path,
      sha: p.entry.sha,
      lang: p.entry.lang.id,
      size: p.entry.size,
      contentHash: createHash("sha256")
        .update(p.source)
        .digest("hex")
        .slice(0, 32),
    }));
    fileRowsInserted = await db
      .insert(files)
      .values(fileInserts)
      .returning({ id: files.id });
  }

  const chunksExtracted = parsed.reduce((n, p) => n + p.chunks.length, 0);

  // 5. Embedding phase. Optional — if no API key, status still flips to
  //    "ready" but embedding_count stays 0 so the UI can prompt the user
  //    to configure a key + re-index.
  let embeddingsCreated = 0;
  let embedError: string | null = null;
  if (!options.skipEmbeddings && chunksExtracted > 0) {
    try {
      const allTexts: string[] = [];
      const allMeta: typeof embeddings.$inferInsert[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const fileId = fileRowsInserted[i].id;
        parsed[i].chunks.forEach((chunk, idx) => {
          allTexts.push(buildEmbeddingInput(parsed[i].entry.path, chunk));
          allMeta.push({
            repoId,
            fileId,
            chunkIndex: idx,
            content: chunk.content,
            embedding: [], // filled below
            kind: chunk.kind,
            symbolName: chunk.symbolName,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
          });
        });
      }

      const vectors = await embedTexts(allTexts);
      // Batched insert (single round-trip per ~500 rows to keep packets small).
      const INSERT_BATCH = 500;
      for (let i = 0; i < allMeta.length; i += INSERT_BATCH) {
        const slice = allMeta.slice(i, i + INSERT_BATCH).map((row, j) => ({
          ...row,
          embedding: vectors[i + j],
        }));
        await db.insert(embeddings).values(slice);
      }
      embeddingsCreated = vectors.length;
    } catch (err) {
      embedError = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] embedding phase failed: ${embedError}`);
    }
  }

  // 5b. Symbol graph (Prompt 8). Independent of embeddings — always runs
  //     once files are saved so tools like whoCalls() work even without
  //     an OpenAI key. Cascade-delete already cleared old rows when files
  //     were wiped above.
  let defsInserted = 0;
  let refsInserted = 0;
  if (parsed.length > 0) {
    const defRows: typeof symbolDefinitions.$inferInsert[] = [];
    const refRows: typeof symbolReferences.$inferInsert[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const fileId = fileRowsInserted[i].id;
      for (const d of parsed[i].definitions) {
        defRows.push({
          repoId,
          fileId,
          name: d.name,
          kind: d.kind,
          startLine: d.startLine,
          endLine: d.endLine,
          startByte: d.startByte,
          endByte: d.endByte,
        });
      }
      for (const r of parsed[i].references) {
        refRows.push({
          repoId,
          fileId,
          name: r.name,
          line: r.line,
          byteOffset: r.byteOffset,
        });
      }
    }
    for (let i = 0; i < defRows.length; i += SYMBOL_INSERT_BATCH) {
      await db
        .insert(symbolDefinitions)
        .values(defRows.slice(i, i + SYMBOL_INSERT_BATCH));
    }
    for (let i = 0; i < refRows.length; i += SYMBOL_INSERT_BATCH) {
      await db
        .insert(symbolReferences)
        .values(refRows.slice(i, i + SYMBOL_INSERT_BATCH));
    }
    defsInserted = defRows.length;
    refsInserted = refRows.length;
  }

  // 6. Architecture summary. Best-effort: failure does NOT mark the repo
  //    failed since search still works without it. We surface the error
  //    in last_error so the UI can prompt for an Anthropic key.
  let summary = null;
  let summaryError: string | null = null;
  if (parsed.length > 0) {
    try {
      summary = await generateRepoSummary(octokit, {
        fullName: repo.fullName,
        description: repo.description,
        defaultBranch: repo.defaultBranch,
        filePaths: parsed.map((p) => p.entry.path),
      });
    } catch (err) {
      summaryError = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] summary phase failed: ${summaryError}`);
    }
  }

  // 7. Finalize repo row. We keep separate error tracking but commit one
  //    last_error string — whichever phase failed last wins. Status stays
  //    "ready" because files + (possibly) embeddings are usable.
  const composedError =
    [embedError, summaryError].filter(Boolean).join(" · ") || null;
  await db
    .update(repos)
    .set({
      status: "ready",
      fileCount: parsed.length,
      embeddingCount: embeddingsCreated,
      summary,
      indexedAt: new Date(),
      lastError: composedError,
      updatedAt: new Date(),
    })
    .where(eq(repos.id, repoId));

  return {
    repoId,
    filesIndexed: parsed.length,
    chunksExtracted,
    embeddingsCreated,
    symbolsExtracted: { definitions: defsInserted, references: refsInserted },
    summaryGenerated: summary !== null,
    totalCandidates: walk.totalCandidates,
    skipped: walk.skipped,
    truncated: walk.files.length < walk.totalCandidates,
  };
}

/**
 * Prepend the file path to the chunk content before embedding. This is a
 * cheap retrieval boost — queries like "auth middleware" then match against
 * snippets whose path contains those words even when the symbol name doesn't.
 */
function buildEmbeddingInput(path: string, chunk: SemanticChunk): string {
  const header = chunk.symbolName ? `${path} :: ${chunk.symbolName}` : path;
  return `${header}\n\n${chunk.content}`;
}

function decodeBlob(content: string, encoding: string): string {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf8");
  }
  return content;
}
