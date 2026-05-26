"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderTree,
  GitMerge,
  Loader2,
  Network,
  Search,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useViewerStore, type Highlight } from "@/lib/stores/viewerStore";

interface Props {
  repoId: number;
  /** Optional starter chips shown when the conversation is empty. */
  suggestions?: string[];
  className?: string;
}

export function Chat({
  repoId,
  suggestions = [
    "Bu repo'nun mimarisini özetle",
    "Entry point dosyaları nereler?",
    "Auth nasıl çalışıyor?",
    "Test stratejisi ne?",
  ],
  className,
}: Props) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { repoId },
    }),
  });

  const scrollerRef = useRef<HTMLDivElement>(null);
  const setActiveFile = useViewerStore((s) => s.setActiveFile);
  const setAIFocus = useViewerStore((s) => s.setAIFocus);
  const consumePendingPrompt = useViewerStore((s) => s.consumePendingPrompt);
  const tourActive = useViewerStore((s) => s.tour !== null);
  const pauseTour = useViewerStore((s) => s.pauseTour);

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, status]);

  // Bridge: any pending prompt from FileTree → push as a user message.
  useEffect(() => {
    if (status === "streaming" || status === "submitted") return;
    const queued = consumePendingPrompt();
    if (queued) void sendMessage({ text: queued });
  }, [consumePendingPrompt, sendMessage, status, messages.length]);

  // Bridge: any new openFile / searchCode tool result updates the viewer
  // store so the middle pane reflects what the agent is doing.
  const lastMessage = messages.at(-1);
  useEffect(() => {
    if (!lastMessage || lastMessage.role !== "assistant") return;
    const parts = (lastMessage.parts ?? []) as Array<{
      type: string;
      toolName?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
    }>;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (!p.type.startsWith("tool-")) continue;
      const tool = p.toolName ?? p.type.slice("tool-".length);
      const input = (p.input ?? {}) as { path?: string; query?: string };
      if (tool === "openFile" && typeof input.path === "string") {
        setActiveFile(input.path, []);
        setAIFocus({
          tool: "openFile",
          path: input.path,
          note: `\`${input.path}\``,
          ts: Date.now(),
        });
        return;
      }
      if (tool === "searchCode" && p.state === "output-available") {
        const out = p.output as { hits?: Array<{ path: string; lines?: string }> };
        const first = out?.hits?.[0];
        if (first?.path) {
          setActiveFile(first.path, hitsToHighlights(out.hits!));
          setAIFocus({
            tool: "searchCode",
            path: first.path,
            note:
              typeof input.query === "string" ? `"${input.query}"` : undefined,
            ts: Date.now(),
          });
          return;
        }
      }
    }
  }, [lastMessage, messages.length, setActiveFile, setAIFocus]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    setInput("");
    // User typing during a tour auto-pauses it — the TourPanel will show a
    // "Devam ettir" banner so they can resume after the side question.
    if (tourActive) pauseTour();
    void sendMessage({ text });
  }

  const isBusy = status === "streaming" || status === "submitted";

  return (
    <section
      aria-label="Repo sohbeti"
      className={cn(
        "flex h-[640px] flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Bot aria-hidden className="size-4 text-primary" />
        <span className="text-sm font-semibold">compass agent</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {messages.length === 0 ? "yeni sohbet" : `${messages.length} mesaj`}
        </span>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        role="log"
      >
        {messages.length === 0 ? (
          <EmptyState
            suggestions={suggestions}
            onPick={(s) => {
              setInput("");
              void sendMessage({ text: s });
            }}
          />
        ) : (
          <ul role="list" className="flex flex-col gap-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {status === "submitted" && (
              <li className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Düşünüyor…
              </li>
            )}
          </ul>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            ⚠ {error.message}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border bg-background/50 px-3 py-2.5"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="compass'a sor…"
          aria-label="Mesaj"
          disabled={isBusy}
          className="flex-1"
        />
        <button
          type="submit"
          disabled={isBusy || !input.trim()}
          aria-label="Gönder"
          className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {isBusy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <ArrowUp aria-hidden className="size-4" />
          )}
        </button>
      </form>
    </section>
  );
}

// ─── Message rendering ──────────────────────────────────────────────────────

type UIMessageT = ReturnType<typeof useChat>["messages"][number];
type UIPart = UIMessageT["parts"][number];

function MessageBubble({ message }: { message: UIMessageT }) {
  const isUser = message.role === "user";
  return (
    <li
      className={cn(
        "flex flex-col gap-2",
        isUser ? "items-end" : "items-stretch",
      )}
    >
      {message.parts.map((part, i) => (
        <PartRenderer key={i} part={part} isUser={isUser} />
      ))}
    </li>
  );
}

function PartRenderer({ part, isUser }: { part: UIPart; isUser: boolean }) {
  if (part.type === "text") {
    return (
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50 text-foreground",
        )}
      >
        {part.text}
      </div>
    );
  }
  if (part.type === "reasoning") return null;
  if (part.type.startsWith("tool-")) {
    return <ToolCallCard part={part as ToolPartLike} />;
  }
  return null;
}

interface ToolPartLike {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolCallCard({ part }: { part: ToolPartLike }) {
  const [open, setOpen] = useState(false);
  const toolName = part.toolName ?? part.type.replace(/^tool-/, "");
  const isError = part.state === "output-error";
  const isRunning =
    part.state === "input-streaming" || part.state === "input-available";

  const ToolIcon = TOOL_ICONS[toolName] ?? Wrench;
  const summary = describeInput(toolName, part.input);

  return (
    <div
      className={cn(
        "self-stretch rounded-xl border bg-card/60 transition-colors",
        isError
          ? "border-destructive/40"
          : isRunning
            ? "border-primary/40"
            : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
        )}
        <ToolIcon
          aria-hidden
          className={cn(
            "size-3.5",
            isError
              ? "text-destructive"
              : isRunning
                ? "text-primary"
                : "text-muted-foreground",
          )}
        />
        <span className="font-mono">{toolName}</span>
        {summary && (
          <span className="truncate text-muted-foreground">{summary}</span>
        )}
        {isRunning && (
          <Loader2 aria-hidden className="ml-auto size-3 animate-spin text-primary" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/60 bg-background/40 px-3 py-2 font-mono text-[11px]">
          {part.input != null && (
            <CodeBlock label="input" value={part.input} />
          )}
          {part.output != null && (
            <CodeBlock label="output" value={part.output} />
          )}
          {part.errorText && (
            <p className="text-destructive">{part.errorText}</p>
          )}
        </div>
      )}
    </div>
  );
}

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  searchCode: Search,
  openFile: FileCode,
  findReferences: Search,
  whoCalls: Network,
  whatDoesThisCall: GitMerge,
  moduleOverview: FolderTree,
};

function describeInput(toolName: string, input: unknown): string | null {
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (toolName === "searchCode" && typeof obj.query === "string") {
    return `"${truncate(obj.query, 60)}"`;
  }
  if (
    (toolName === "openFile" || toolName === "moduleOverview") &&
    typeof obj.path === "string"
  ) {
    return obj.path;
  }
  if (
    (toolName === "findReferences" ||
      toolName === "whoCalls" ||
      toolName === "whatDoesThisCall") &&
    typeof obj.symbol === "string"
  ) {
    return obj.symbol;
  }
  return null;
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <pre className="mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-foreground">
        {text}
      </pre>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Convert searchCode hits into viewer highlights for the first hit's file. */
function hitsToHighlights(
  hits: Array<{ path: string; lines?: string | null }>,
): Highlight[] {
  if (hits.length === 0) return [];
  const targetPath = hits[0].path;
  const out: Highlight[] = [];
  for (const h of hits) {
    if (h.path !== targetPath || !h.lines) continue;
    const m = h.lines.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    out.push({ startLine: Number(m[1]), endLine: Number(m[2]) });
  }
  return out;
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <Bot aria-hidden className="size-6 text-primary" />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">
        compass bu repo'yu okudu, sembol grafiğini çıkardı. Bir soru sor —
        gerçek dosyaları açıp satır referansı vererek cevaplasın.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
