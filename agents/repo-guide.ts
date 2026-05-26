import "server-only";
import { stepCountIs, streamText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { and, asc, desc, eq, gte, like, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import type { ModelMessage } from "ai";
import { db } from "@/db";
import {
  embeddings,
  files,
  repos,
  symbolDefinitions,
  symbolReferences,
  type Repo,
} from "@/db/schema";
import { searchRepo } from "@/lib/search/semantic";

const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-7";

/**
 * Keywords that bump the request to Opus 4.7 — designed for "why / how /
 * tradeoff / architecture" style questions that need cross-file reasoning,
 * not just a search hit.
 */
const ESCALATION_KEYWORDS = [
  "neden",
  "niçin",
  "niye",
  "why",
  "nasıl çalış",
  "how does",
  "how is",
  "architecture",
  "mimari",
  "explain",
  "açıkla",
  "compare",
  "karşılaştır",
  "trade-off",
  "tradeoff",
  "design",
  "tasarım",
  "analyze",
  "analiz",
  "review",
  "değerlendir",
  "refactor",
  "alternatif",
  "alternative",
];

const ESCALATION_MIN_LENGTH = 220;

export type ModelTier = "sonnet" | "opus";

export interface RoutingDecision {
  tier: ModelTier;
  reason: string;
}

/**
 * Picks the model tier based on the last user turn. Sonnet 4.6 by default
 * (cheap + fast); Opus 4.7 when the question is long or hits keywords that
 * imply cross-file architectural reasoning.
 */
export function chooseModel(text: string): RoutingDecision {
  const t = text.toLowerCase();
  if (t.length >= ESCALATION_MIN_LENGTH) {
    return { tier: "opus", reason: `long prompt (${t.length} chars)` };
  }
  for (const kw of ESCALATION_KEYWORDS) {
    if (t.includes(kw)) {
      return { tier: "opus", reason: `matches "${kw}"` };
    }
  }
  return { tier: "sonnet", reason: "default" };
}

/**
 * Stream a repo-guide conversation. Six tools:
 *   searchCode, openFile, findReferences (Prompt 7)
 *   whoCalls, whatDoesThisCall, moduleOverview (Prompt 8)
 *
 * The model is picked via chooseModel() based on the last user turn.
 */
export function streamRepoChat(args: {
  repo: Repo;
  modelMessages: ModelMessage[];
  octokit: Octokit;
  tier: ModelTier;
}) {
  const { repo, modelMessages, octokit, tier } = args;
  const modelId = tier === "opus" ? OPUS : SONNET;

  return streamText({
    model: anthropic(modelId),
    system: buildSystemPrompt(repo, tier),
    messages: modelMessages,
    tools: buildTools(repo, octokit),
    stopWhen: stepCountIs(8),
    temperature: 0.3,
  });
}

function buildSystemPrompt(repo: Repo, tier: ModelTier): string {
  const summaryHint = repo.summary
    ? `Pre-computed architecture summary:\n${JSON.stringify(repo.summary, null, 2)}`
    : "(no architecture summary available — investigate via tools)";

  return [
    `You are *compass*, an AI guide for the GitHub repository ${repo.fullName}.`,
    `Running on **${tier === "opus" ? "Claude Opus 4.7" : "Claude Sonnet 4.6"}**.`,
    `Your job: help a developer understand this codebase quickly. Be concise,`,
    `cite file paths inline like \`path/to/file.ts:42-58\`, prefer using tools`,
    `over guessing. Default to one short paragraph plus a follow-up question.`,
    tier === "opus"
      ? "You can take more steps and write longer answers — the user asked a hard question."
      : "",
    "",
    `Default branch: ${repo.defaultBranch} · HEAD: ${repo.headSha?.slice(0, 7) ?? "n/a"}`,
    repo.description ? `Description: ${repo.description}` : "",
    "",
    summaryHint,
    "",
    "Tools:",
    "- searchCode(query): semantic top-k. Start here for 'where is X' / 'how does Y'.",
    "- openFile(path): full file content (10 KB cap). Use after searchCode picks one.",
    "- findReferences(symbol): literal ILIKE across chunks. Quick + fuzzy.",
    "- whoCalls(symbol): AST-precise list of every call/reference site. Use over findReferences when accuracy matters.",
    "- whatDoesThisCall(symbol): for a known function/class, the other symbols it touches inside its body.",
    "- moduleOverview(path): outline of a file or directory — definitions + lines. Use before openFile when the user names a folder.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTools(repo: Repo, octokit: Octokit) {
  return {
    searchCode: tool({
      description:
        "Semantic search over indexed code chunks. Returns top-k snippets with path + line numbers + cosine distance. Use natural-language queries like 'auth middleware' or 'rate limit handler'.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language search query."),
        k: z.number().int().min(1).max(10).optional().default(5),
      }),
      async execute({ query, k }) {
        const hits = await searchRepo(repo.id, query, k);
        if (hits.length === 0) {
          return { hits: [], note: "No matching chunks. Re-phrase the query." };
        }
        return {
          hits: hits.map((h) => ({
            path: h.path,
            lang: h.lang,
            symbol: h.symbolName,
            kind: h.kind,
            lines: h.startLine && h.endLine ? `${h.startLine}-${h.endLine}` : null,
            preview: h.content.slice(0, 400),
            distance: Number(h.distance.toFixed(3)),
          })),
        };
      },
    }),

    openFile: tool({
      description:
        "Fetch the full text of a single indexed file by repo-relative path. Use after searchCode or moduleOverview locates a candidate.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative path, e.g. 'src/auth/middleware.ts'."),
      }),
      async execute({ path }) {
        const file = await db.query.files.findFirst({
          where: and(eq(files.repoId, repo.id), eq(files.path, path)),
        });
        if (!file) {
          return {
            error:
              "Not in the indexed set. The walker skips binary/lock/min files and caps at 120 entries.",
          };
        }
        try {
          const blob = await octokit.git.getBlob({
            owner: repo.owner,
            repo: repo.name,
            file_sha: file.sha,
          });
          const content =
            blob.data.encoding === "base64"
              ? Buffer.from(blob.data.content, "base64").toString("utf8")
              : blob.data.content;
          return {
            path: file.path,
            lang: file.lang,
            size: file.size,
            truncated: content.length > 10_000,
            content: content.slice(0, 10_000),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    findReferences: tool({
      description:
        "Fuzzy text search for a symbol across indexed chunk content (ILIKE). Faster than whoCalls when you want approximate hits including comments + strings.",
      inputSchema: z.object({
        symbol: z.string().min(2).max(80),
        k: z.number().int().min(1).max(15).optional().default(8),
      }),
      async execute({ symbol, k }) {
        const rows = await db
          .select({
            path: files.path,
            lang: files.lang,
            symbolName: embeddings.symbolName,
            kind: embeddings.kind,
            startLine: embeddings.startLine,
            endLine: embeddings.endLine,
            content: embeddings.content,
          })
          .from(embeddings)
          .innerJoin(files, eq(files.id, embeddings.fileId))
          .where(
            and(
              eq(embeddings.repoId, repo.id),
              sql`${embeddings.content} ILIKE ${"%" + symbol + "%"}`,
            ),
          )
          .limit(k);
        return {
          symbol,
          matches: rows.map((r) => ({
            path: r.path,
            lang: r.lang,
            symbol: r.symbolName,
            kind: r.kind,
            lines:
              r.startLine && r.endLine ? `${r.startLine}-${r.endLine}` : null,
            snippet: extractSnippetAround(r.content, symbol),
          })),
        };
      },
    }),

    whoCalls: tool({
      description:
        "AST-precise list of every place `symbol` is referenced in this repo. Returns paths + line numbers. Use this over findReferences when you want call sites without false positives from comments or strings.",
      inputSchema: z.object({
        symbol: z.string().min(2).max(80),
        k: z.number().int().min(1).max(40).optional().default(20),
      }),
      async execute({ symbol, k }) {
        const rows = await db
          .select({
            path: files.path,
            lang: files.lang,
            line: symbolReferences.line,
          })
          .from(symbolReferences)
          .innerJoin(files, eq(files.id, symbolReferences.fileId))
          .where(
            and(
              eq(symbolReferences.repoId, repo.id),
              eq(symbolReferences.name, symbol),
            ),
          )
          .orderBy(asc(files.path), asc(symbolReferences.line))
          .limit(k);
        if (rows.length === 0) {
          return { symbol, total: 0, note: "No references found. Symbol name is case-sensitive." };
        }
        // Group by file for compactness.
        const byFile = new Map<string, { lang: string; lines: number[] }>();
        for (const r of rows) {
          const hit = byFile.get(r.path);
          if (hit) hit.lines.push(r.line);
          else byFile.set(r.path, { lang: r.lang, lines: [r.line] });
        }
        return {
          symbol,
          total: rows.length,
          files: Array.from(byFile, ([path, info]) => ({ path, ...info })),
        };
      },
    }),

    whatDoesThisCall: tool({
      description:
        "Given a defined symbol (function/class/method), list other symbols it touches inside its body. Use to map a function's dependencies.",
      inputSchema: z.object({
        symbol: z.string().min(2).max(80),
      }),
      async execute({ symbol }) {
        const defs = await db
          .select({
            id: symbolDefinitions.id,
            fileId: symbolDefinitions.fileId,
            path: files.path,
            kind: symbolDefinitions.kind,
            startLine: symbolDefinitions.startLine,
            endLine: symbolDefinitions.endLine,
            startByte: symbolDefinitions.startByte,
            endByte: symbolDefinitions.endByte,
          })
          .from(symbolDefinitions)
          .innerJoin(files, eq(files.id, symbolDefinitions.fileId))
          .where(
            and(
              eq(symbolDefinitions.repoId, repo.id),
              eq(symbolDefinitions.name, symbol),
            ),
          )
          .limit(5);

        if (defs.length === 0) {
          return {
            symbol,
            note: "Symbol not defined in this repo (or its file wasn't indexed).",
          };
        }

        const results = [];
        for (const def of defs) {
          const inside = await db
            .select({
              name: symbolReferences.name,
              line: symbolReferences.line,
            })
            .from(symbolReferences)
            .where(
              and(
                eq(symbolReferences.fileId, def.fileId),
                gte(symbolReferences.byteOffset, def.startByte),
                lte(symbolReferences.byteOffset, def.endByte),
                ne(symbolReferences.name, symbol),
              ),
            )
            .limit(80);
          // Dedupe + sort by first occurrence.
          const seen = new Map<string, number>();
          for (const r of inside) {
            if (!seen.has(r.name)) seen.set(r.name, r.line);
          }
          results.push({
            symbol,
            path: def.path,
            kind: def.kind,
            lines: `${def.startLine}-${def.endLine}`,
            references: Array.from(seen, ([name, firstLine]) => ({ name, line: firstLine })),
          });
        }
        return { definitions: results };
      },
    }),

    moduleOverview: tool({
      description:
        "Outline of a file or directory. For a file: lists every defined symbol with kind + line range. For a directory: lists files under it with their top symbols. Use before openFile when the user names a folder.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative path (file or directory)."),
      }),
      async execute({ path }) {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        // First try as a file.
        const file = await db.query.files.findFirst({
          where: and(eq(files.repoId, repo.id), eq(files.path, normalized)),
        });
        if (file) {
          const defs = await db
            .select({
              name: symbolDefinitions.name,
              kind: symbolDefinitions.kind,
              startLine: symbolDefinitions.startLine,
              endLine: symbolDefinitions.endLine,
            })
            .from(symbolDefinitions)
            .where(eq(symbolDefinitions.fileId, file.id))
            .orderBy(asc(symbolDefinitions.startLine));
          return {
            kind: "file" as const,
            path: file.path,
            lang: file.lang,
            size: file.size,
            symbols: defs,
          };
        }
        // Treat as a directory prefix.
        const prefix = normalized + "/";
        const filesUnder = await db
          .select({ id: files.id, path: files.path, lang: files.lang })
          .from(files)
          .where(
            and(
              eq(files.repoId, repo.id),
              like(files.path, prefix + "%"),
            ),
          )
          .orderBy(asc(files.path))
          .limit(50);
        if (filesUnder.length === 0) {
          return { error: "No file or directory matches that path." };
        }
        // Top-3 symbols per file for compactness.
        const fileIds = filesUnder.map((f) => f.id);
        const topPerFile = await db
          .select({
            fileId: symbolDefinitions.fileId,
            name: symbolDefinitions.name,
            kind: symbolDefinitions.kind,
            startLine: symbolDefinitions.startLine,
          })
          .from(symbolDefinitions)
          .where(
            and(
              eq(symbolDefinitions.repoId, repo.id),
              sql`${symbolDefinitions.fileId} = ANY(${sql.raw(`ARRAY[${fileIds.join(",")}]::int[]`)})`,
            ),
          )
          .orderBy(asc(symbolDefinitions.fileId), asc(symbolDefinitions.startLine));
        const symbolsByFile = new Map<number, Array<{ name: string; kind: string; line: number }>>();
        for (const s of topPerFile) {
          const list = symbolsByFile.get(s.fileId) ?? [];
          if (list.length < 3) {
            list.push({ name: s.name, kind: s.kind, line: s.startLine });
            symbolsByFile.set(s.fileId, list);
          }
        }
        return {
          kind: "directory" as const,
          path: normalized,
          files: filesUnder.map((f) => ({
            path: f.path,
            lang: f.lang,
            symbols: symbolsByFile.get(f.id) ?? [],
          })),
        };
      },
    }),
  };
}

/** Pull the line containing the symbol + 2 lines of context on each side. */
function extractSnippetAround(content: string, symbol: string): string {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) =>
    l.toLowerCase().includes(symbol.toLowerCase()),
  );
  if (idx < 0) return lines.slice(0, 5).join("\n");
  const from = Math.max(0, idx - 2);
  const to = Math.min(lines.length, idx + 3);
  return lines.slice(from, to).join("\n");
}

/** Re-export for the route to load repo + check status without a 2nd import. */
export async function loadRepoForChat(repoId: number) {
  return db.query.repos.findFirst({ where: eq(repos.id, repoId) });
}

// Unused-import guards (kept available for future tools).
void desc;
