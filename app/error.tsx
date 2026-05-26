"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        bir şey ters gitti
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Bu sayfa yüklenemedi
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sayfayı yeniden denemek genelde işe yarar. Sorun devam ederse problem
        bizdedir.
      </p>
      {error.digest && (
        <p className="mt-3 rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className={cn(buttonVariants({ variant: "default" }), "mt-6 gap-2")}
      >
        <RotateCcw aria-hidden className="size-4" />
        Yeniden dene
      </button>
    </div>
  );
}
