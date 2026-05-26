"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface Props {
  repoId: number;
  status: "queued" | "indexing" | "ready" | "failed";
}

/**
 * Drives the ingest worker from the repo page:
 *   - If queued/failed: shows a primary CTA that triggers ingestion.
 *   - If indexing:      shows a spinner + polls the page every 3s so the
 *                       server-rendered status pill refreshes itself.
 *   - If ready:         shows a "Re-index" outline button.
 */
export function IngestButton({ repoId, status }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<number | null>(null);

  // Auto-poll while indexing. We just refresh the route so server data is
  // re-fetched; the page itself decides whether to re-render the button.
  useEffect(() => {
    if (status !== "indexing") return;
    pollRef.current = window.setInterval(() => router.refresh(), 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [status, router]);

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/ingest`, {
          method: "POST",
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "İndeksleme başarısız.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        router.refresh();
      }
    });
  }

  const busy = isPending || status === "indexing";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        className={cn(
          buttonVariants({
            size: "lg",
            variant: status === "ready" ? "outline" : "default",
          }),
          "gap-2",
          status === "ready" || "glow-ring",
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : status === "ready" ? (
          <RefreshCw aria-hidden className="size-4" />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        {busy
          ? "İndeksleniyor…"
          : status === "ready"
            ? "Yeniden indeksle"
            : status === "failed"
              ? "Yeniden dene"
              : "İndekslemeyi başlat"}
      </button>
      {error && <p className="text-xs text-destructive">⚠ {error}</p>}
    </div>
  );
}
