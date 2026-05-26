import { Skeleton } from "@/components/Skeleton";

export default function RepoLoading() {
  return (
    <div className="flex flex-col">
      {/* ViewerHeader skeleton */}
      <div className="flex h-12 items-center gap-3 border-b border-border bg-card/40 px-3">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-5 w-16 rounded-full" />
        <Skeleton className="h-6 w-24" />
      </div>
      {/* 3-panel body */}
      <div className="grid h-[calc(100vh-3.5rem-3rem)] grid-cols-[260px_minmax(0,1fr)_360px]">
        <aside className="border-r border-border p-2">
          <Skeleton className="mb-2 h-4 w-20" />
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton
              key={i}
              className="mb-1 h-5"
              style={{ width: `${60 + (i * 13) % 35}%` }}
            />
          ))}
        </aside>
        <main className="flex flex-col gap-3 border-r border-border p-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-full w-full" />
        </main>
        <aside className="flex flex-col gap-2 border-l border-border p-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-auto h-9 w-full" />
        </aside>
      </div>
    </div>
  );
}
