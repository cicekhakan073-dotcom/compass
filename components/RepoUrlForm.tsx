"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GitBranch, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { parseRepoUrl } from "@/lib/parseRepoUrl";

const EXAMPLES = [
  "vercel/next.js",
  "openai/whisper",
  "tiangolo/fastapi",
  "facebook/react",
];

interface IngestResponse {
  ok: boolean;
  owner?: string;
  name?: string;
  status?: string;
  message?: string;
  error?: string;
}

export function RepoUrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const valid = parseRepoUrl(url) !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/repos/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = (await res.json()) as IngestResponse;
        if (!res.ok || !data.ok || !data.owner || !data.name) {
          setError(data.error ?? "Repo eklenemedi.");
          return;
        }
        router.push(`/r/${data.owner}/${data.name}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <div className="relative">
        <GitBranch
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="github.com/vercel/next.js"
          autoComplete="off"
          aria-label="GitHub repo URL"
          disabled={isPending}
          className="h-12 pl-9 pr-44 text-base"
        />
        <button
          type="submit"
          disabled={!valid || isPending}
          className={cn(
            buttonVariants({ size: "default" }),
            "absolute right-1.5 top-1/2 h-9 -translate-y-1/2 gap-1.5 disabled:opacity-60",
            valid && !isPending && "glow-ring",
          )}
        >
          {isPending ? "Kuyruğa alınıyor…" : "Repo'mu keşfet"}
          {isPending ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <ArrowRight aria-hidden className="size-4" />
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          ⚠ {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Hızlı dene:</span>
        {EXAMPLES.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setUrl(`https://github.com/${slug}`)}
            disabled={isPending}
            className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
          >
            {slug}
          </button>
        ))}
      </div>
    </form>
  );
}
