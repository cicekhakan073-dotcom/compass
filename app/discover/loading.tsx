import { Skeleton } from "@/components/Skeleton";

export default function DiscoverLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Skeleton className="mb-6 h-9 w-full max-w-sm" />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-16 rounded-full" />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
          >
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-12 w-full" />
            <div className="mt-auto flex gap-1">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
