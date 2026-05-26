"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  GitCompare,
  Loader2,
  MapPin,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewerStore, type TourPlan } from "@/lib/stores/viewerStore";

interface Props {
  repoId: number;
}

/**
 * Tour mode UI. Two states:
 *  1. No active tour → "Repo turuna başla" CTA + optional focus input.
 *  2. Active tour → narration card with prev/next/end + progress dots.
 *
 * When the user types in the chat during a tour, viewerStore.pauseTour()
 * is called from the Chat component; we show a "Devam ettir" banner here.
 */
export function TourPanel({ repoId }: Props) {
  const tour = useViewerStore((s) => s.tour);
  const stepIndex = useViewerStore((s) => s.tourStepIndex);
  const paused = useViewerStore((s) => s.tourPaused);
  const startTour = useViewerStore((s) => s.startTour);
  const nextStep = useViewerStore((s) => s.nextStep);
  const prevStep = useViewerStore((s) => s.prevStep);
  const endTour = useViewerStore((s) => s.endTour);
  const resumeTour = useViewerStore((s) => s.resumeTour);

  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/tour`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(focus.trim() ? { focus: focus.trim() } : {}),
      });
      const data = (await res.json()) as
        | { ok: true; plan: TourPlan; latencyMs: number }
        | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        setError(("error" in data && data.error) || "Tur üretilemedi.");
        return;
      }
      startTour(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!tour) {
    return (
      <div className="rounded-lg border border-primary/30 bg-card/60 p-3">
        <header className="flex items-center gap-2">
          <MapPin aria-hidden className="size-4 text-primary" />
          <span className="text-sm font-semibold">Rehberli tur</span>
        </header>
        <p className="mt-1 text-xs text-muted-foreground">
          Opus 4.7 5-7 adımlı bir turu planlasın — dosyaları otomatik açar,
          satırları işaretler. İstersen bir odak verebilirsin.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Opsiyonel odak: 'build cache', 'plugin sistemi'…"
            disabled={loading}
            className="h-9 text-sm"
          />
          <button
            type="button"
            onClick={handleStart}
            disabled={loading}
            className={cn(
              buttonVariants({ size: "default" }),
              "gap-1.5 whitespace-nowrap",
              !loading && "glow-ring",
            )}
          >
            {loading ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
            {loading ? "Planlanıyor…" : "Turu başlat"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            ⚠ {error}
          </p>
        )}
      </div>
    );
  }

  const step = tour.steps[stepIndex];
  const total = tour.steps.length;
  const atStart = stepIndex === 0;
  const atEnd = stepIndex === total - 1;

  return (
    <div className="rounded-lg border border-primary/40 bg-card/80 p-3 shadow-lg shadow-primary/10">
      <header className="flex items-start gap-2">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
              Tur · adım {stepIndex + 1}/{total}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {tour.generatedBy}
            </span>
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold">{step.title}</h3>
        </div>
        <button
          type="button"
          onClick={endTour}
          title="Turu bitir"
          aria-label="Turu bitir"
          className="text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <p className="mt-2 text-sm leading-relaxed text-foreground">
        {step.narration}
      </p>

      {step.action.type === "focus" && (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          📂 {step.action.path}
          {step.action.startLine && step.action.endLine
            ? ` · L${step.action.startLine}-${step.action.endLine}`
            : ""}
        </p>
      )}
      {step.action.type === "compare" && (
        <p className="mt-2 inline-flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
          <GitCompare aria-hidden className="size-3" />
          {step.action.leftPath} ↔ {step.action.rightPath}
        </p>
      )}

      {paused && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-1.5 text-xs">
          <span className="text-yellow-300">⏸ Tur duraklatıldı</span>
          <button
            type="button"
            onClick={resumeTour}
            className="ml-auto rounded bg-yellow-500/30 px-2 py-0.5 font-medium text-yellow-100 hover:bg-yellow-500/40"
          >
            Devam ettir
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={prevStep}
          disabled={atStart}
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Geri
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={atEnd}
          className={cn(
            buttonVariants({ size: "sm" }),
            "gap-1.5",
          )}
        >
          {atEnd ? "Son adım" : "Devam"}
          {!atEnd && <ArrowRight aria-hidden className="size-3.5" />}
        </button>
        <div className="ml-auto flex items-center gap-1">
          {tour.steps.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "block size-1.5 rounded-full transition-colors",
                i === stepIndex ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
