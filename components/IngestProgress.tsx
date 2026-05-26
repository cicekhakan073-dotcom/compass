"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  repoId: number;
  /** Initial status — props from server render. */
  status: "queued" | "indexing" | "ready" | "failed";
  initialFileCount: number;
  initialEmbeddingCount: number;
  className?: string;
}

interface Snapshot {
  status: string;
  fileCount: number;
  embeddingCount: number;
  finalFileCount: number;
  finalEmbeddingCount: number;
  lastError: string | null;
}

const POLL_MS = 2_000;

/**
 * Polls /api/repos/[id]/status while the worker is running and renders a
 * live "2,456 / 4,801 chunks embedded" counter. Once status flips to ready
 * or failed we call router.refresh() to pull the next server render and
 * stop polling.
 */
export function IngestProgress({
  repoId,
  status: initialStatus,
  initialFileCount,
  initialEmbeddingCount,
  className,
}: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot>({
    status: initialStatus,
    fileCount: initialFileCount,
    embeddingCount: initialEmbeddingCount,
    finalFileCount: initialFileCount,
    finalEmbeddingCount: initialEmbeddingCount,
    lastError: null,
  });

  useEffect(() => {
    if (snap.status !== "queued" && snap.status !== "indexing") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/status`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { ok?: boolean } & Partial<Snapshot>;
        if (!cancelled && data.ok) {
          setSnap((prev) => ({
            ...prev,
            ...data,
          } as Snapshot));
          if (data.status === "ready" || data.status === "failed") {
            router.refresh();
          }
        }
      } catch {
        /* network blip — try again next tick */
      }
    };
    void tick();
    const handle = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [repoId, router, snap.status]);

  // Compute a "chunks embedded / target" pair. We use the highest seen file
  // count as the denominator since the worker walks files before embeddings.
  const targetFiles = Math.max(snap.fileCount, snap.finalFileCount, 1);
  const targetChunks = Math.max(snap.embeddingCount, snap.finalEmbeddingCount);
  const pctChunks =
    targetChunks > 0
      ? Math.min(100, Math.round((snap.embeddingCount / targetChunks) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-foreground">
        <Loader2 aria-hidden className="size-3.5 animate-spin text-primary" />
        <span className="font-medium">
          {snap.status === "queued"
            ? "Kuyrukta — worker başlamak üzere"
            : snap.status === "indexing"
              ? "İndeksleniyor"
              : snap.status === "ready"
                ? "Hazır"
                : snap.status === "failed"
                  ? "Başarısız"
                  : snap.status}
        </span>
        <span className="ml-auto font-mono tabular-nums text-muted-foreground">
          {snap.fileCount}
          {" / "}
          {targetFiles} files
          <span className="mx-1.5 opacity-40">·</span>
          {snap.embeddingCount.toLocaleString()}
          {targetChunks > 0 ? ` / ${targetChunks.toLocaleString()}` : ""} chunks
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pctChunks}%` }}
        />
      </div>
    </div>
  );
}
