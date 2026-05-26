import "server-only";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

/**
 * Why text-embedding-3-small:
 *   - 1536 dimensions (matches our pgvector column)
 *   - $0.02 / 1M tokens (cheapest OpenAI tier)
 *   - 8192-token input limit per text — comfortably fits a single function
 *     or a 200-line raw chunk after our 8 KB truncation
 *
 * `embedMany` from the Vercel AI SDK handles batching internally up to the
 * provider's max (OpenAI: 2048 inputs / 8 MB total payload) and parallelizes
 * batches up to `maxParallelCalls`. We pass the whole chunk list at once.
 */
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
/** Per-text safety truncation — keeps every input well under 8192 tokens. */
const MAX_CHARS_PER_INPUT = 8_000;
const MAX_PARALLEL_CALLS = 10;

export const EMBEDDING_INFO = {
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
} as const;

/**
 * Embed an array of text snippets into 1536-dim vectors.
 * Throws a descriptive error if no API key is configured so callers can
 * surface a useful message instead of an OpenAI 401.
 *
 * The fixed signature lets us swap the provider (AI Gateway, Workers AI…)
 * later without touching the ingestion or search code.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY (veya AI_GATEWAY_API_KEY) .env.local'da tanımlı değil — embedding üretimi atlandı.",
    );
  }
  if (texts.length === 0) return [];

  const inputs = texts.map((t) => truncate(t));

  const { embeddings } = await embedMany({
    model: openai.embedding(EMBEDDING_MODEL),
    values: inputs,
    maxParallelCalls: MAX_PARALLEL_CALLS,
    maxRetries: 2,
  });

  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: got ${embeddings.length}, expected ${texts.length}`,
    );
  }
  return embeddings;
}

/** Embed a single query string. Convenience wrapper used by search. */
export async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embedTexts([query]);
  return vec;
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS_PER_INPUT) return text;
  // Keep head + tail so functions whose signature is at top stay distinctive.
  const head = text.slice(0, Math.floor(MAX_CHARS_PER_INPUT * 0.75));
  const tail = text.slice(-Math.floor(MAX_CHARS_PER_INPUT * 0.25));
  return `${head}\n…\n${tail}`;
}
