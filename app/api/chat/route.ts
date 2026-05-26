import { convertToModelMessages, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  chats,
  messages as messagesTable,
  type ToolCallRecord,
} from "@/db/schema";
import { getOctokit } from "@/lib/github";
import {
  chooseModel,
  loadRepoForChat,
  streamRepoChat,
} from "@/agents/repo-guide";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Multi-step tool loop + Anthropic streaming can run ~30-45s on large repos.
export const maxDuration = 60;

interface ChatRequestBody {
  repoId: number;
  chatId?: number;
  messages: UIMessage[];
}

/**
 * POST /api/chat — streams Claude Sonnet 4.6 with the three repo-guide
 * tools. On the way through:
 *   - upsert the chat row (create on first turn, reuse later)
 *   - persist the user message before kicking off the stream
 *   - on completion, persist the assistant message (text + tool call records)
 */
export async function POST(request: Request) {
  // Rate-limit before anything else — saves DB + LLM cost on abuse.
  const ip = clientIp(request);
  const rl = await rateLimit("chat", ip);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({
        error: `Çok hızlı istek. ${Math.ceil(rl.resetMs / 1000)}s sonra tekrar dene.`,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          ...rateLimitHeaders(rl),
        },
      },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const repoId = Number(body.repoId);
  if (!Number.isFinite(repoId)) return badRequest("repoId is required.");
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return badRequest("messages must be a non-empty array.");
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    return badRequest(
      "ANTHROPIC_API_KEY (veya AI_GATEWAY_API_KEY) sunucuda tanımlı değil.",
    );
  }

  const repo = await loadRepoForChat(repoId);
  if (!repo) return badRequest("Repo not found.", 404);
  if (repo.status !== "ready") {
    return badRequest("Repo henüz indekslenmemiş. /ingest çalıştır önce.", 409);
  }
  if (repo.embeddingCount === 0) {
    return badRequest(
      "Embedding üretilmemiş (OpenAI key eksik?). Tool çağrıları çalışmaz.",
      409,
    );
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Upsert chat row.
  let chatId = body.chatId ?? null;
  if (chatId !== null) {
    const found = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    if (!found) chatId = null;
  }
  if (chatId === null) {
    const lastUserMsg = body.messages.findLast((m) => m.role === "user");
    const title = lastUserMsg ? deriveTitle(plainText(lastUserMsg)) : null;
    const [created] = await db
      .insert(chats)
      .values({ repoId, userId, title })
      .returning({ id: chats.id });
    chatId = created.id;
  }

  // Persist the latest user turn before we begin streaming.
  const lastUserMsg = body.messages.findLast((m) => m.role === "user");
  if (lastUserMsg) {
    await db.insert(messagesTable).values({
      chatId,
      role: "user",
      content: plainText(lastUserMsg),
      toolCalls: null,
    });
  }

  const octokit = await getOctokit();
  const modelMessages = await convertToModelMessages(body.messages);

  const routing = chooseModel(plainText(lastUserMsg ?? body.messages[0]));
  const result = streamRepoChat({
    repo,
    modelMessages,
    octokit,
    tier: routing.tier,
  });

  // The AI SDK lets us tap into completion via onFinish in the UI stream
  // response options — used here to persist the assistant turn.
  return result.toUIMessageStreamResponse({
    sendReasoning: false,
    onFinish: async ({ messages: finalMessages }) => {
      try {
        const last = finalMessages.at(-1);
        if (last && last.role === "assistant") {
          await db.insert(messagesTable).values({
            chatId: chatId!,
            role: "assistant",
            content: plainText(last),
            toolCalls: collectToolCalls(last),
          });
          await db
            .update(chats)
            .set({ updatedAt: new Date() })
            .where(eq(chats.id, chatId!));
        }
      } catch (err) {
        console.warn("[chat] persist assistant turn failed:", err);
      }
    },
  });
}

function badRequest(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function plainText(message: UIMessage): string {
  const parts = (message.parts ?? []) as Array<{ type: string; text?: string }>;
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("");
}

function collectToolCalls(message: UIMessage): ToolCallRecord[] | null {
  const parts = (message.parts ?? []) as Array<{
    type: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    state?: string;
    errorText?: string;
  }>;
  const records: ToolCallRecord[] = [];
  for (const p of parts) {
    if (!p.type.startsWith("tool-")) continue;
    records.push({
      toolName: p.toolName ?? p.type.slice("tool-".length),
      input: p.input,
      output: p.output,
      state: p.state === "output-error" ? "error" : "result",
      errorMessage: p.errorText,
    });
  }
  return records.length > 0 ? records : null;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57) + "…";
}
