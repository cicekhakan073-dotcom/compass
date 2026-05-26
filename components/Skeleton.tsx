import { cn } from "@/lib/utils";

/**
 * Tailwind animate-pulse rectangle. Used inside all loading.tsx files.
 * Centralized so the muted color matches across pages even when Tailwind
 * theme changes.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-muted/60", className)}
      {...props}
    />
  );
}
